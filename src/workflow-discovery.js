import fs from 'node:fs/promises';
import path from 'node:path';
import {readWorkflowBundleId} from './plist.js';

async function readBundleIdIfPresent(plistPath, fileSystem) {
  try {
    return await readWorkflowBundleId(plistPath, {fileSystem});
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return undefined;
    }

    return undefined;
  }
}

export async function findWorkflowSlotsByBundleId({
  bundleId,
  fileSystem = fs,
  preferencesRoot,
}) {
  const workflowsRoot = path.join(preferencesRoot, 'workflows');
  let entries;
  try {
    entries = await fileSystem.readdir(workflowsRoot, {withFileTypes: true});
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    const slotPath = path.join(workflowsRoot, entry.name);
    const candidateBundleId = await readBundleIdIfPresent(
      path.join(slotPath, 'info.plist'),
      fileSystem,
    );
    if (candidateBundleId === bundleId) {
      matches.push(slotPath);
    }
  }

  return matches.sort((left, right) => left.localeCompare(right));
}

export function assertWorkflowSlotPath(slotPath, preferencesRoot) {
  const workflowsRoot = path.resolve(preferencesRoot, 'workflows');
  const resolvedSlot = path.resolve(slotPath);
  if (path.dirname(resolvedSlot) !== workflowsRoot) {
    throw new Error(`Workflow slot is outside the Alfred workflows directory: ${slotPath}`);
  }

  return resolvedSlot;
}
