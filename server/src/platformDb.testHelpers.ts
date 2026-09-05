/**
 * Temp platform.sqlite for desk-history tests. Mirrors the bootHttp.test.ts
 * isolation pattern: PLATFORM_DB_PATH + resetPlatformDbForTests per test.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";

export type TempPlatformDb = { dir: string };

export function openTempPlatformDb(prefix = "x-desk-"): TempPlatformDb {
  resetPlatformDbForTests();
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
  process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
  getPlatformDb();
  return { dir };
}

export function closeTempPlatformDb(temp: TempPlatformDb): void {
  resetPlatformDbForTests();
  delete process.env.PLATFORM_DB_PATH;
  delete process.env.PLATFORM_MIGRATIONS_DIR;
  rmSync(temp.dir, { recursive: true, force: true });
}

/** Insert a bare platform user so ensureUserTenant() can scope rows to it. */
export function seedUser(id: string, email = `${id}@example.com`): string {
  const now = new Date().toISOString();
  getPlatformDb()
    .prepare(
      `INSERT INTO users (id, email, created_at, last_login_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
    )
    .run(id, email, now, now);
  return id;
}
