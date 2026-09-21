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
} from "../db.ts";
import { resetScoutProfileProjectionForTests } from "../scout/scoutProfileProjection.ts";

export type TempPlatformDb = { dir: string };

export function openTempPlatformDb(prefix = "x-desk-"): TempPlatformDb {
  resetPlatformDbForTests();
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
  process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
  // C10 profile projections rebuild on evidence changes whenever the store is
  // loaded (the Scout collector loads it since C11); keep them in the temp
  // root instead of the checkout's data/scout-profile.
  process.env.SCOUT_PROFILE_DIR = join(dir, "scout-profile");
  getPlatformDb();
  return { dir };
}

export function closeTempPlatformDb(temp: TempPlatformDb): void {
  // Drop any projection still scheduled by this test's evidence writes so it
  // cannot fire against the default database or profile dir after teardown.
  // Suites that exercise the hook install it per test.
  resetScoutProfileProjectionForTests();
  resetPlatformDbForTests();
  delete process.env.PLATFORM_DB_PATH;
  delete process.env.PLATFORM_MIGRATIONS_DIR;
  delete process.env.SCOUT_PROFILE_DIR;
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
