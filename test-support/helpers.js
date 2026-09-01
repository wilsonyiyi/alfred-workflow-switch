import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import plist from 'plist';

export async function createSandbox(t, prefix = 'alfred-workflow-switch-') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, {force: true, recursive: true}));
  return directory;
}

export async function writeWorkflow(directory, bundleId, marker) {
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(
    path.join(directory, 'info.plist'),
    plist.build({bundleid: bundleId}),
    'utf8',
  );
  if (marker) {
    await fs.writeFile(path.join(directory, 'release-marker'), marker, 'utf8');
  }
}
