import fs from 'node:fs/promises';
import path from 'node:path';
import {acquireOperationLock, readLockInfo} from './operation-lock.js';
import {readWorkflowBundleId} from './plist.js';
import {
  readWorkflowState,
  workflowStatePaths,
  writeWorkflowState,
} from './state-store.js';
import {
  assertWorkflowSlotPath,
  findWorkflowSlotsByBundleId,
} from './workflow-discovery.js';

async function lstatIfPresent(fileSystem, target) {
  if (!target) {
    return undefined;
  }

  try {
    return await fileSystem.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

function isOwnedLink(linkTarget, {sourcePath, sourceRoot, storedSourcePath}) {
  const normalizedTarget = path.resolve(linkTarget);
  const normalizedSource = path.resolve(sourcePath);
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const normalizedStored = storedSourcePath ? path.resolve(storedSourcePath) : undefined;

  return (
    normalizedTarget === normalizedSource ||
    normalizedTarget === resolvedSourceRoot ||
    (normalizedStored && normalizedTarget === normalizedStored)
  );
}

function assertBackup(stats, backupPath) {
  if (stats && (!stats.isDirectory() || stats.isSymbolicLink())) {
    throw new Error(`Release backup is not a directory: ${backupPath}`);
  }
}

function baseResult(options, paths, sourcePath, state) {
  return {
    backupPath: paths.backupPath,
    developmentBundleId: options.developmentBundleId,
    preferencesRoot: options.preferencesRoot,
    releaseBundleId: options.releaseBundleId,
    sourcePath,
    statePath: paths.statePath,
    storedState: state,
  };
}

export async function inspectWorkflow({
  developmentBundleId,
  fileSystem = fs,
  preferencesRoot,
  releaseBundleId,
  sourceRoot,
}) {
  const options = {
    developmentBundleId,
    fileSystem,
    preferencesRoot,
    releaseBundleId,
    sourceRoot,
  };
  const paths = workflowStatePaths({preferencesRoot, releaseBundleId});

  let sourcePath;
  try {
    sourcePath = await fileSystem.realpath(sourceRoot);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sourcePath = path.resolve(sourceRoot);
    } else {
      throw error;
    }
  }

  const [state, releaseSlots, lockInfo] = await Promise.all([
    readWorkflowState(paths.statePath, {fileSystem}),
    findWorkflowSlotsByBundleId({bundleId: releaseBundleId, fileSystem, preferencesRoot}),
    readLockInfo({fileSystem, lockPath: paths.lockPath}),
  ]);
  const result = baseResult(options, paths, sourcePath, state);
  result.lockInfo = lockInfo;

  if (releaseSlots.length > 1) {
    return {...result, mode: 'multiple-releases', releaseSlots};
  }

  if (state && state.releaseBundleId !== releaseBundleId) {
    return {
      ...result,
      mode: 'source-mismatch',
      reason: 'stored-release-bundle-id-mismatch',
    };
  }

  const storedSlotPath = state?.slotPath
    ? assertWorkflowSlotPath(state.slotPath, preferencesRoot)
    : undefined;
  const slotPath = storedSlotPath ?? releaseSlots[0];
  const [slotStats, backupStats] = await Promise.all([
    lstatIfPresent(fileSystem, slotPath),
    lstatIfPresent(fileSystem, paths.backupPath),
  ]);
  assertBackup(backupStats, paths.backupPath);

  if (!slotPath) {
    return {
      ...result,
      mode: backupStats ? 'invalid' : 'missing',
      reason: backupStats ? 'backup-without-slot-state' : undefined,
    };
  }

  if (!slotStats) {
    return {
      ...result,
      mode: backupStats ? 'development-interrupted' : 'missing',
      slotPath,
    };
  }

  if (slotStats.isSymbolicLink()) {
    let currentTarget;
    let isDangling = false;
    try {
      currentTarget = await fileSystem.realpath(slotPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }

      isDangling = true;
      currentTarget = path.resolve(path.dirname(slotPath), await fileSystem.readlink(slotPath));
    }

    const owned = isOwnedLink(currentTarget, {
      sourcePath,
      sourceRoot,
      storedSourcePath: state?.sourcePath,
    });

    if (isDangling && backupStats && owned) {
      return {
        ...result,
        currentTarget,
        mode: 'development-interrupted',
        releasePreserved: true,
        slotPath,
      };
    }

    return {
      ...result,
      currentTarget,
      mode: owned ? 'development' : 'foreign-link',
      releasePreserved: Boolean(backupStats),
      slotPath,
    };
  }

  if (!slotStats.isDirectory()) {
    return {...result, mode: 'invalid', reason: 'slot-is-not-a-directory', slotPath};
  }

  if (backupStats) {
    return {...result, mode: 'conflict', slotPath};
  }

  const installedBundleId = await readWorkflowBundleId(
    path.join(slotPath, 'info.plist'),
    {fileSystem},
  );
  if (installedBundleId !== releaseBundleId) {
    return {
      ...result,
      installedBundleId,
      mode: 'source-mismatch',
      reason: 'installed-release-bundle-id-mismatch',
      slotPath,
    };
  }

  return {...result, mode: 'production', slotPath};
}

function invalidModeError(state) {
  if (state.mode === 'foreign-link') {
    return new Error(`Refusing to replace workflow link to ${state.currentTarget}`);
  }

  if (state.mode === 'multiple-releases') {
    return new Error(
      `Multiple installed workflows use ${state.releaseBundleId}:\n${state.releaseSlots.join('\n')}`,
    );
  }

  if (state.mode === 'conflict') {
    return new Error(
      `Both an installed release and backup exist:\n${state.slotPath}\n${state.backupPath}`,
    );
  }

  if (state.mode === 'source-mismatch') {
    return new Error(`Workflow source does not match the stored switch state: ${state.reason}`);
  }

  if (state.mode === 'invalid') {
    return new Error(`Invalid workflow switch state: ${state.reason ?? state.slotPath}`);
  }

  return new Error(`Cannot switch workflow from mode: ${state.mode}`);
}

function persistedState(state, status) {
  return {
    developmentBundleId: state.developmentBundleId,
    releaseBundleId: state.releaseBundleId,
    slotPath: state.slotPath,
    sourcePath: state.sourcePath,
    status,
    updatedAt: new Date().toISOString(),
  };
}

async function withOperationLock(options, command, operation) {
  const paths = workflowStatePaths(options);
  const release = await acquireOperationLock({
    command,
    fileSystem: options.fileSystem ?? fs,
    lockPath: paths.lockPath,
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}

export async function switchToDevelopment(options) {
  return withOperationLock(options, 'dev', async () => {
    const state = await inspectWorkflow(options);
    const fileSystem = options.fileSystem ?? fs;

    if (state.mode === 'development') {
      if (!state.releasePreserved) {
        throw new Error(`No preserved release exists at ${state.backupPath}`);
      }

      const result = {...state, changed: false};
      delete result.lockInfo;
      return result;
    }

    if (state.mode === 'missing') {
      throw new Error(`No installed release exists for ${state.releaseBundleId}`);
    }

    if (!['production', 'development-interrupted'].includes(state.mode)) {
      throw invalidModeError(state);
    }

    let sourceStats;
    try {
      sourceStats = await fileSystem.lstat(options.sourceRoot);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Local source does not exist: ${options.sourceRoot}`);
      }

      throw error;
    }

    if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) {
      throw new Error(`Local source is not a directory: ${options.sourceRoot}`);
    }

    await writeWorkflowState(
      state.statePath,
      persistedState(state, 'switching-to-development'),
      {fileSystem},
    );

    if (state.mode === 'production') {
      await fileSystem.rename(state.slotPath, state.backupPath);
    } else if (state.mode === 'development-interrupted') {
      const slotStats = await lstatIfPresent(fileSystem, state.slotPath);
      if (slotStats?.isSymbolicLink()) {
        let linkTarget;
        try {
          linkTarget = await fileSystem.realpath(state.slotPath);
        } catch (error) {
          if (error.code === 'ENOENT') {
            linkTarget = path.resolve(
              path.dirname(state.slotPath),
              await fileSystem.readlink(state.slotPath),
            );
          } else {
            throw error;
          }
        }

        const owned = isOwnedLink(linkTarget, {
          sourcePath: state.sourcePath,
          sourceRoot: options.sourceRoot,
          storedSourcePath: state.storedState?.sourcePath,
        });

        if (!owned) {
          throw new Error(`Refusing to replace workflow link to ${linkTarget}`);
        }

        await fileSystem.unlink(state.slotPath);
      }
    }

    try {
      await fileSystem.symlink(state.sourcePath, state.slotPath, 'dir');
    } catch (error) {
      if (state.mode === 'production') {
        await fileSystem.rename(state.backupPath, state.slotPath);
        await writeWorkflowState(
          state.statePath,
          persistedState(state, 'production'),
          {fileSystem},
        );
      } else if (state.mode === 'development-interrupted') {
        const slotStats = await lstatIfPresent(fileSystem, state.slotPath);
        if (!slotStats) {
          try {
            await fileSystem.symlink(state.sourcePath, state.slotPath, 'dir');
          } catch {
            // Best effort rollback of unlink failed
          }
        }
      }

      throw error;
    }

    await writeWorkflowState(
      state.statePath,
      persistedState(state, 'development'),
      {fileSystem},
    );
    const result = {...state, changed: true, mode: 'development', releasePreserved: true};
    delete result.lockInfo;
    return result;
  });
}

export async function switchToProduction(options) {
  return withOperationLock(options, 'prod', async () => {
    const state = await inspectWorkflow(options);
    const fileSystem = options.fileSystem ?? fs;

    if (state.mode === 'production') {
      const result = {...state, changed: false};
      delete result.lockInfo;
      return result;
    }

    if (state.mode === 'missing') {
      throw new Error(`No installed release or backup exists for ${state.releaseBundleId}`);
    }

    if (!['development', 'development-interrupted'].includes(state.mode)) {
      throw invalidModeError(state);
    }

    if (!state.releasePreserved && state.mode === 'development') {
      throw new Error(`No preserved release exists at ${state.backupPath}`);
    }

    await writeWorkflowState(
      state.statePath,
      persistedState(state, 'switching-to-production'),
      {fileSystem},
    );

    let wasUnlinked = false;
    let danglingTarget;
    let originalStoredSourcePath;

    if (state.mode === 'development') {
      let currentTarget;
      try {
        currentTarget = await fileSystem.realpath(state.slotPath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }

      if (currentTarget) {
        const owned = isOwnedLink(currentTarget, {
          sourcePath: state.sourcePath,
          sourceRoot: options.sourceRoot,
          storedSourcePath: state.storedState?.sourcePath,
        });

        if (!owned) {
          throw new Error(`Refusing to remove workflow link to ${currentTarget}`);
        }

        await fileSystem.unlink(state.slotPath);
        wasUnlinked = true;
      }
    } else if (state.mode === 'development-interrupted') {
      try {
        danglingTarget = await fileSystem.readlink(state.slotPath);
        originalStoredSourcePath = state.storedState?.sourcePath || danglingTarget;
        await fileSystem.unlink(state.slotPath);
        wasUnlinked = true;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    try {
      await fileSystem.rename(state.backupPath, state.slotPath);
    } catch (error) {
      if (wasUnlinked) {
        if (state.mode === 'development') {
          await fileSystem.symlink(state.sourcePath, state.slotPath, 'dir');
        } else if (state.mode === 'development-interrupted' && danglingTarget) {
          await fileSystem.symlink(danglingTarget, state.slotPath, 'dir');
        }

        const rollbackState = {
          ...state,
          sourcePath: originalStoredSourcePath || state.storedState?.sourcePath || state.sourcePath,
        };

        await writeWorkflowState(
          state.statePath,
          persistedState(
            rollbackState,
            state.mode === 'development' ? 'development' : 'development-interrupted',
          ),
          {fileSystem},
        );
      }

      throw error;
    }

    await writeWorkflowState(
      state.statePath,
      persistedState(state, 'production'),
      {fileSystem},
    );
    const result = {...state, changed: true, mode: 'production'};
    delete result.lockInfo;
    return result;
  });
}
