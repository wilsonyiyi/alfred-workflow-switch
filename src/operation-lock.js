import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_LOCK_STALE_MS = 30_000;

export async function acquireOperationLock({
  clock = Date.now,
  fileSystem = fs,
  lockPath,
  staleAfterMs = DEFAULT_LOCK_STALE_MS,
}) {
  await fileSystem.mkdir(path.dirname(lockPath), {recursive: true});

  const createLock = async () => {
    await fileSystem.mkdir(lockPath);
    await fileSystem.writeFile(
      path.join(lockPath, 'owner.json'),
      `${JSON.stringify({pid: process.pid, startedAt: clock()})}\n`,
      'utf8',
    );
  };

  try {
    await createLock();
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }

    const stats = await fileSystem.stat(lockPath);
    if (clock() - stats.mtimeMs <= staleAfterMs) {
      throw new Error(`Another workflow switch operation is active at ${lockPath}`);
    }

    await fileSystem.rm(lockPath, {force: true, recursive: true});
    await createLock();
  }

  let released = false;
  return async () => {
    if (!released) {
      released = true;
      await fileSystem.rm(lockPath, {force: true, recursive: true});
    }
  };
}
