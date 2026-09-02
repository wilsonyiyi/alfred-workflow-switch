import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {acquireOperationLock, readLockInfo} from '../src/operation-lock.js';
import {createSandbox} from '../test-support/helpers.js';

test('acquireOperationLock prevents concurrent operations and can be released', async t => {
  const sandbox = await createSandbox(t);
  const lockPath = path.join(sandbox, 'operation.lock');
  const release = await acquireOperationLock({lockPath});

  await assert.rejects(acquireOperationLock({lockPath}), /operation is active/u);
  await release();

  const releaseAgain = await acquireOperationLock({lockPath});
  await releaseAgain();
});

test('acquireOperationLock replaces a stale lock', async t => {
  const sandbox = await createSandbox(t);
  const lockPath = path.join(sandbox, 'operation.lock');
  await fs.mkdir(lockPath);
  await fs.utimes(lockPath, new Date(0), new Date(0));

  const release = await acquireOperationLock({clock: () => 60_000, lockPath, staleAfterMs: 1_000});
  await release();
});

test('acquireOperationLock records the command in owner.json', async t => {
  const sandbox = await createSandbox(t);
  const lockPath = path.join(sandbox, 'operation.lock');
  const release = await acquireOperationLock({command: 'dev', lockPath});

  const owner = JSON.parse(await fs.readFile(path.join(lockPath, 'owner.json'), 'utf8'));
  assert.equal(owner.command, 'dev');
  assert.ok(owner.pid);
  assert.ok(owner.startedAt);

  await release();
});

test('readLockInfo returns lock status and metadata', async t => {
  const sandbox = await createSandbox(t);
  const lockPath = path.join(sandbox, 'operation.lock');

  let lockInfo = await readLockInfo({lockPath});
  assert.equal(lockInfo.exists, false);

  const release = await acquireOperationLock({command: 'prod', lockPath});

  lockInfo = await readLockInfo({lockPath});
  assert.equal(lockInfo.exists, true);
  assert.equal(lockInfo.isStale, false);
  assert.ok(lockInfo.ageMs >= 0);
  assert.equal(lockInfo.owner.command, 'prod');

  await fs.utimes(lockPath, new Date(0), new Date(0));
  lockInfo = await readLockInfo({clock: () => 50_000, lockPath});
  assert.equal(lockInfo.isStale, true);

  await release();
  lockInfo = await readLockInfo({lockPath});
  assert.equal(lockInfo.exists, false);
});
