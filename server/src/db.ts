/**
 * Platform SQLite DB + numbered SQL migrations (Postgres-portable dialect).
 * File: data/platform.sqlite (gitignored via data/).
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL_TENANT_ID = "local";

let db: Database.Database | null = null;

export function defaultPlatformDbPath(): string {
  const fromEnv = process.env.PLATFORM_DB_PATH?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(process.cwd(), "data", "platform.sqlite");
}

export function defaultMigrationsDir(): string {
  const fromEnv = process.env.PLATFORM_MIGRATIONS_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  // Prefer cwd (prod / pm2), fall back to package-relative path.
  const cwdDir = resolve(process.cwd(), "server", "migrations");
  if (existsSync(cwdDir)) return cwdDir;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "migrations");
}

export function getLocalTenantId(): string {
  return LOCAL_TENANT_ID;
}

/** Open (or reuse) the platform DB and apply pending migrations. */
export function getPlatformDb(opts?: {
  dbPath?: string;
  migrationsDir?: string;
}): Database.Database {
  const dbPath = opts?.dbPath ?? defaultPlatformDbPath();
  if (db) {
    // Reuse when path matches; otherwise close and reopen (tests).
    try {
      const openPath = db.name;
      if (openPath === dbPath && !opts?.migrationsDir) return db;
    } catch {
      // fall through
    }
    try {
      db.close();
    } catch {
      // ignore
    }
    db = null;
  }

  mkdirSync(dirname(dbPath), { recursive: true });
  const instance = new Database(dbPath);
  try {
    instance.pragma("journal_mode = WAL");
    instance.pragma("busy_timeout = 5000");
    instance.pragma("foreign_keys = ON");
    applyMigrations(instance, opts?.migrationsDir ?? defaultMigrationsDir());
    ensureLocalTenant(instance);
  } catch (err) {
    try {
      instance.close();
    } catch {
      // ignore
    }
    throw err;
  }
  db = instance;
  return instance;
}

export function ensureLocalTenant(database: Database.Database): void {
  database
    .prepare(
      `INSERT INTO tenants (id, slug, name, created_at)
       SELECT ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = ?)`,
    )
    .run(
      LOCAL_TENANT_ID,
      "local",
      "Local operator",
      new Date().toISOString(),
      LOCAL_TENANT_ID,
    );
}

/** Test helper — drop the singleton so the next open uses a fresh path. */
export function resetPlatformDbForTests(): void {
  if (db) {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
  db = null;
}

export function applyMigrations(
  database: Database.Database,
  migrationsDir: string,
): string[] {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (
      database
        .prepare(`SELECT id FROM schema_migrations ORDER BY id`)
        .all() as Array<{ id: string }>
    ).map((r) => r.id),
  );

  if (!existsSync(migrationsDir)) {
    throw new Error(`Migrations dir missing: ${migrationsDir}`);
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d+_.+\.sql$/i.test(f))
    .sort();

  const ran: string[] = [];
  const insert = database.prepare(
    `INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`,
  );

  for (const file of files) {
    const id = file.replace(/\.sql$/i, "");
    if (applied.has(id)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const tx = database.transaction(() => {
      database.exec(sql);
      insert.run(id, new Date().toISOString());
    });
    tx();
    ran.push(id);
  }
  return ran;
}
