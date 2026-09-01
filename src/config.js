import fs from 'node:fs/promises';
import path from 'node:path';
import {readWorkflowBundleId} from './plist.js';

function requireBundleId(value, field) {
  const bundleId = String(value ?? '').trim();
  if (!bundleId) {
    throw new Error(`Missing package.json alfredWorkflowSwitch.${field}`);
  }

  return bundleId;
}

export async function readProjectConfig({
  fileSystem = fs,
  projectRoot = process.cwd(),
} = {}) {
  const packageRoot = await fileSystem.realpath(projectRoot);
  const packagePath = path.join(packageRoot, 'package.json');
  const packageJson = JSON.parse(await fileSystem.readFile(packagePath, 'utf8'));
  const rawConfig = packageJson.alfredWorkflowSwitch ?? {};
  const releaseBundleId = requireBundleId(rawConfig.releaseBundleId, 'releaseBundleId');
  const developmentBundleId = String(
    rawConfig.developmentBundleId ?? releaseBundleId,
  ).trim();
  const sourceRoot = await fileSystem.realpath(path.resolve(
    packageRoot,
    rawConfig.workflowPath ?? '.',
  ));
  const sourcePlistPath = path.join(sourceRoot, 'info.plist');
  const sourceBundleId = await readWorkflowBundleId(sourcePlistPath, {fileSystem});

  if (sourceBundleId !== developmentBundleId) {
    throw new Error(
      `Development bundle ID mismatch: expected ${developmentBundleId}, found ${sourceBundleId}`,
    );
  }

  return {
    developmentBundleId,
    packageName: String(packageJson.name ?? path.basename(packageRoot)),
    packageRoot,
    releaseBundleId,
    sourceBundleId,
    sourcePlistPath,
    sourceRoot,
  };
}
