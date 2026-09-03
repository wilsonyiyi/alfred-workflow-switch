import fs from 'node:fs/promises';
import plist from 'plist';

export async function readWorkflowBundleId(plistPath, {fileSystem = fs} = {}) {
  const document = plist.parse(await fileSystem.readFile(plistPath, 'utf8'));
  const bundleId = String(document.bundleid ?? '').trim();
  if (!bundleId) {
    const error = new Error(`Missing bundleid in ${plistPath}`);
    error.code = 'MISSING_BUNDLEID';
    throw error;
  }

  return bundleId;
}
