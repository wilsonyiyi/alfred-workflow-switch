import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_LOCK_STALE_MS = 30_000;

export async function readLockInfo({clock = Date.now, fileSystem = fs, lockPath}) {
  try {
    const [stats, ownerData] = await Promise.all([
      fileSystem.stat(lockPath),
      fileSystem.readFile(path.join(lockPath, 'owner.json'), 'utf8').catch(() => null),
    ]);
    const owner = ownerData ? JSON.parse(ownerData) : undefined;
    const ageMs = clock() - stats.mtimeMs;
    return {
      ageMs,
      exists: true,
      isStale: ageMs > DEFAULT_LOCK_STALE_MS,
      lockPath,
      owner,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {exists: false, lockPath};
    }

    throw error;
  }
}

export async function acquireOperationLock({
  clock = Date.now,
  command,
  fileSystem = fs,
  lockPath,
  staleAfterMs = DEFAULT_LOCK_STALE_MS,
}) {
  await fileSystem.mkdir(path.dirname(lockPath), {recursive: true});

  const createLock = async () => {
    await fileSystem.mkdir(lockPath);
    const owner = {pid: process.pid, startedAt: clock()};
    if (command) {
      owner.command = command;
    }

    await fileSystem.writeFile(
      path.join(lockPath, 'owner.json'),
      `${JSON.stringify(owner)}\n`,
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
