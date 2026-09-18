import { mkdir, rmdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = filePath + ".lock";
  await mkdir(dirname(lockPath), { recursive: true });
  for (let retries = 0; ; retries++) {
    try {
      await mkdir(lockPath);
      break;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== "EEXIST") throw err;
      if (retries > 200) {
        throw new Error("Could not acquire lock: " + filePath);
      }
      // After ~1s, check if the lock dir is stale (crash orphan).
      if (retries > 50) {
        try {
          const lockStat = await stat(lockPath);
          if (Date.now() - lockStat.mtimeMs > 60_000) {
            await rmdir(lockPath).catch(() => {});
            continue;
          }
        } catch {}
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  try {
    return await fn();
  } finally {
    await rmdir(lockPath).catch(() => {});
  }
}
