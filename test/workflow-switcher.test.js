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

test('treats a dangling symlink as development-interrupted when backup exists', async t => {
  const options = await createFixture(t);
  await switchToDevelopment(options);

  const linkTarget = await fs.readlink(options.slotPath);
  await fs.rm(options.sourceRoot, {recursive: true});

  const state = await inspectWorkflow(options);
  assert.equal(state.mode, 'development-interrupted');
  assert.equal(state.releasePreserved, true);
  assert.ok(state.currentTarget.includes(linkTarget) || linkTarget.includes(path.basename(state.currentTarget)));
});

test('recovers from dangling symlink with prod command', async t => {
  const options = await createFixture(t);
  const development = await switchToDevelopment(options);
  await fs.rm(options.sourceRoot, {recursive: true});

  await switchToProduction(options);
  assert.equal(await fs.readFile(path.join(options.slotPath, 'release-marker'), 'utf8'), 'release');
  await assert.rejects(fs.lstat(development.backupPath), {code: 'ENOENT'});
});

test('refuses to switch when local source does not exist', async t => {
  const options = await createFixture(t);
  await fs.rm(options.sourceRoot, {recursive: true});

  await assert.rejects(switchToDevelopment(options), /Local source does not exist/u);
  assert.equal((await inspectWorkflow(options)).mode, 'production');
});

test('refuses dangling foreign links even with backup', async t => {
  const options = await createFixture(t);
  const foreignRoot = path.join(path.dirname(options.sourceRoot), 'foreign');
  await writeWorkflow(foreignRoot, options.developmentBundleId);

  await switchToDevelopment(options);
  await fs.unlink(options.slotPath);
  await fs.symlink(foreignRoot, options.slotPath, 'dir');
  await fs.rm(foreignRoot, {recursive: true});

  const state = await inspectWorkflow(options);
  assert.equal(state.mode, 'foreign-link');
  await assert.rejects(switchToDevelopment(options), /Refusing to replace workflow link/u);
  await assert.rejects(switchToProduction(options), /Refusing to replace workflow link/u);
});

test('recovers from dangling owned link by unlinking first', async t => {
  const options = await createFixture(t);
  await switchToDevelopment(options);

  const linkTarget = await fs.readlink(options.slotPath);
  await fs.rm(options.sourceRoot, {recursive: true});
  await writeWorkflow(options.sourceRoot, options.developmentBundleId);

  await switchToDevelopment(options);
  assert.equal(await fs.realpath(options.slotPath), await fs.realpath(options.sourceRoot));
});

test('recognizes owned dangling links despite path alias mismatch', async t => {
  const options = await createFixture(t);
  const development = await switchToDevelopment(options);

  const aliasedSourcePath = development.sourcePath.replace(/^\/var/, '/private/var');
  const mockFileSystem = {
    ...fs,
    realpath: async (target) => {
      if (target === options.sourceRoot) {
        return aliasedSourcePath;
      }

      return fs.realpath(target);
    },
  };

  await fs.rm(options.sourceRoot, {recursive: true});

  const state = await inspectWorkflow({...options, fileSystem: mockFileSystem});
  assert.equal(state.mode, 'development-interrupted');
  assert.equal(state.releasePreserved, true);
});

test('restores dangling link when prod restore fails after unlink', async t => {
  const options = await createFixture(t);
  const development = await switchToDevelopment(options);
  await fs.rm(options.sourceRoot, {recursive: true});

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

  const slotStats = await fs.lstat(options.slotPath);
  assert.ok(slotStats.isSymbolicLink());
  assert.equal((await inspectWorkflow(options)).mode, 'development-interrupted');
});

test('rollback preserves canonical stored source despite path alias', async t => {
  const options = await createFixture(t);
  const development = await switchToDevelopment(options);

  const aliasedSourcePath = development.sourcePath.replace(/^\/var/, '/private/var');
  const failingFileSystem = {
    ...fs,
    realpath: async (target) => {
      if (target === options.sourceRoot) {
        return '/var/tmp/nonexistent';
      }

      return fs.realpath(target);
    },
    rename: async (source, destination) => {
      if (source === development.backupPath && destination === options.slotPath) {
        throw new Error('simulated restore failure');
      }

      return fs.rename(source, destination);
    },
  };

  await fs.rm(options.sourceRoot, {recursive: true});

  await assert.rejects(
    switchToProduction({...options, fileSystem: failingFileSystem}),
    /simulated restore failure/u,
  );

  const state = await inspectWorkflow(options);
  assert.equal(state.mode, 'development-interrupted');
});

test('switches from source A to source B during interrupted recovery', async t => {
  const options = await createFixture(t);
  await switchToDevelopment(options);

  const sourceB = path.join(path.dirname(options.sourceRoot), 'source-b');
  await writeWorkflow(sourceB, options.developmentBundleId);
  await fs.rm(options.sourceRoot, {recursive: true});

  const state = await inspectWorkflow(options);
  assert.equal(state.mode, 'development-interrupted');

  await switchToDevelopment({...options, sourceRoot: sourceB});
  assert.equal(await fs.realpath(options.slotPath), await fs.realpath(sourceB));
});

test('strips lockInfo from idempotent dev and prod operations', async t => {
  const options = await createFixture(t);

  const firstDev = await switchToDevelopment(options);
  assert.equal(firstDev.changed, true);
  assert.equal(firstDev.lockInfo, undefined);

  const secondDev = await switchToDevelopment(options);
  assert.equal(secondDev.changed, false);
  assert.equal(secondDev.lockInfo, undefined);

  const firstProd = await switchToProduction(options);
  assert.equal(firstProd.changed, true);
  assert.equal(firstProd.lockInfo, undefined);

  const secondProd = await switchToProduction(options);
  assert.equal(secondProd.changed, false);
  assert.equal(secondProd.lockInfo, undefined);
});
