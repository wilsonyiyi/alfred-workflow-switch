import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {acquireOperationLock} from '../src/operation-lock.js';
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
