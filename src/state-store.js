import fs from 'node:fs/promises';
import path from 'node:path';

export const STATE_SCHEMA_VERSION = 1;

export function workflowStatePaths({preferencesRoot, releaseBundleId}) {
  const stateRoot = path.join(
    preferencesRoot,
    '.workflow-switch',
    encodeURIComponent(releaseBundleId),
  );
  return {
    backupPath: path.join(stateRoot, 'workflow'),
    lockPath: path.join(stateRoot, 'operation.lock'),
    statePath: path.join(stateRoot, 'state.json'),
    stateRoot,
  };
}

export async function readWorkflowState(statePath, {fileSystem = fs} = {}) {
  try {
    const state = JSON.parse(await fileSystem.readFile(statePath, 'utf8'));
    if (state.schemaVersion !== STATE_SCHEMA_VERSION) {
      throw new Error(`Unsupported workflow switch state version at ${statePath}`);
    }

    return state;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

export async function writeWorkflowState(statePath, state, {fileSystem = fs} = {}) {
  await fileSystem.mkdir(path.dirname(statePath), {recursive: true});
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await fileSystem.writeFile(
    temporaryPath,
    `${JSON.stringify({...state, schemaVersion: STATE_SCHEMA_VERSION}, null, 2)}\n`,
    'utf8',
  );
  await fileSystem.rename(temporaryPath, statePath);
}
