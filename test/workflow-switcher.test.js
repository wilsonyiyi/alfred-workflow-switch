import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  inspectWorkflow,
  switchToDevelopment,
  switchToProduction,
} from '../src/workflow-switcher.js';
import {createSandbox, writeWorkflow} from '../test-support/helpers.js';

async function createFixture(t) {
  const sandbox = await createSandbox(t);
  const preferencesRoot = path.join(sandbox, 'preferences');
  const sourceRoot = path.join(sandbox, 'source');
  const slotPath = path.join(preferencesRoot, 'workflows', 'user.workflow.EXAMPLE');
  await writeWorkflow(sourceRoot, 'com.example.workflow.dev');
  await writeWorkflow(slotPath, 'com.example.workflow', 'release');
  return {
    developmentBundleId: 'com.example.workflow.dev',
    fileSystem: fs,
    preferencesRoot,
    releaseBundleId: 'com.example.workflow',
    slotPath,
    sourceRoot,
  };
}

test('switches one discovered Alfred slot between release and local source', async t => {
  const options = await createFixture(t);
  assert.equal((await inspectWorkflow(options)).mode, 'production');

  const development = await switchToDevelopment(options);
  assert.equal(development.mode, 'development');
  assert.equal(await fs.realpath(options.slotPath), await fs.realpath(options.sourceRoot));
  assert.equal(
    await fs.readFile(path.join(development.backupPath, 'release-marker'), 'utf8'),
    'release',
  );
  assert.equal((await switchToDevelopment(options)).changed, false);

  const production = await switchToProduction(options);
  assert.equal(production.mode, 'production');
  assert.equal(await fs.readFile(path.join(options.slotPath, 'release-marker'), 'utf8'), 'release');
  assert.equal((await switchToProduction(options)).changed, false);
});

test('restores or resumes an operation interrupted after preserving the release', async t => {
  const options = await createFixture(t);
  const development = await switchToDevelopment(options);
  await fs.unlink(options.slotPath);

  assert.equal((await inspectWorkflow(options)).mode, 'development-interrupted');
  await switchToDevelopment(options);
  assert.equal(await fs.realpath(options.slotPath), await fs.realpath(options.sourceRoot));

  await fs.unlink(options.slotPath);
  assert.equal((await inspectWorkflow(options)).mode, 'development-interrupted');
  await switchToProduction(options);
  assert.equal(await fs.readFile(path.join(options.slotPath, 'release-marker'), 'utf8'), 'release');
  await assert.rejects(fs.lstat(development.backupPath), {code: 'ENOENT'});
});

test('refuses foreign links and duplicate production bundle IDs', async t => {
  const options = await createFixture(t);
  const foreignRoot = path.join(path.dirname(options.sourceRoot), 'foreign');
  await writeWorkflow(foreignRoot, options.releaseBundleId);
  await fs.rm(options.slotPath, {recursive: true});
  await fs.symlink(foreignRoot, options.slotPath, 'dir');

  assert.equal((await inspectWorkflow(options)).mode, 'foreign-link');
  await assert.rejects(switchToDevelopment(options), /Refusing to replace workflow link/u);

  await fs.unlink(options.slotPath);
  await writeWorkflow(options.slotPath, options.releaseBundleId);
  await writeWorkflow(
    path.join(options.preferencesRoot, 'workflows', 'user.workflow.DUPLICATE'),
    options.releaseBundleId,
  );
  assert.equal((await inspectWorkflow(options)).mode, 'multiple-releases');
});

test('rolls the release back when creating the development link fails', async t => {
  const options = await createFixture(t);
  const failingFileSystem = {
    ...fs,
    symlink: async () => {
      throw new Error('simulated link failure');
    },
  };

  await assert.rejects(
    switchToDevelopment({...options, fileSystem: failingFileSystem}),
    /simulated link failure/u,
  );
  assert.equal(await fs.readFile(path.join(options.slotPath, 'release-marker'), 'utf8'), 'release');
  assert.equal((await inspectWorkflow(options)).mode, 'production');
});

test('restores the development link when restoring the release fails', async t => {
  const options = await createFixture(t);
  const development = await switchToDevelopment(options);
  const failingFileSystem = {
    ...fs,
    rename: async (source, destination) => {
      if (source === development.backupPath && destination === options.slotPath) {
        throw new Error('simulated restore failure');
      }

      return fs.rename(source, destination);
    },
  };

  await assert.rejects(
    switchToProduction({...options, fileSystem: failingFileSystem}),
    /simulated restore failure/u,
  );
  assert.equal(await fs.realpath(options.slotPath), await fs.realpath(options.sourceRoot));
  assert.equal((await inspectWorkflow(options)).mode, 'development');
});
