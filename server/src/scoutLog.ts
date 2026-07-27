/**
 * Scout stage log — in-memory ring + data/scout-log.json (gitignored).
 * Soft-degrades on IO/parse errors.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const MAX_SCOUT_LOG_ENTRIES = 1000;

export type ScoutLogEntry = {
  at: string;
  message: string;
  stage?: string;
};

export function defaultScoutLogPath(): string {
  return resolve(process.cwd(), "data", "scout-log.json");
}

let memory: ScoutLogEntry[] | null = null;
let writeLock: Promise<void> = Promise.resolve();

async function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let release: () => void;
  writeLock = new Promise<void>((resolveLock) => {
    release = resolveLock;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release!();
  }
}

export function parseScoutLogEntry(raw: unknown): ScoutLogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const at = typeof obj.at === "string" ? obj.at : "";
  const message = typeof obj.message === "string" ? obj.message.trim() : "";
  if (!message || !at || !Number.isFinite(Date.parse(at))) return null;
  const entry: ScoutLogEntry = { at, message };
  if (typeof obj.stage === "string" && obj.stage.trim()) {
    entry.stage = obj.stage.trim();
  }
  return entry;
}

export function parseScoutLogFile(raw: unknown): ScoutLogEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.entries) ? obj.entries : [];
  const out: ScoutLogEntry[] = [];
  for (const row of list) {
    const parsed = parseScoutLogEntry(row);
    if (parsed) out.push(parsed);
  }
  return out.slice(-MAX_SCOUT_LOG_ENTRIES);
}

async function readDisk(path: string): Promise<ScoutLogEntry[]> {
  try {
    const raw = await readFile(path, "utf8");
    return parseScoutLogFile(JSON.parse(raw) as unknown);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return [];
    console.error("scoutLog read failed:", err);
    return [];
  }
}

async function writeDisk(path: string, entries: ScoutLogEntry[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({ entries }, null, 2)}\n`,
    "utf8",
  );
}

async function ensureLoaded(storePath?: string): Promise<ScoutLogEntry[]> {
  if (memory) return memory;
  const path = storePath ?? defaultScoutLogPath();
  memory = await readDisk(path);
  return memory;
}

/** Oldest → newest, max 1000. */
export async function getScoutLog(opts?: {
  storePath?: string;
}): Promise<ScoutLogEntry[]> {
  return serialized(async () => {
    const entries = await ensureLoaded(opts?.storePath);
    return [...entries];
  });
}

export async function appendScoutLog(
  input: { message: string; stage?: string; at?: string },
  opts?: { storePath?: string },
): Promise<ScoutLogEntry> {
  const message = input.message.trim();
  if (!message) {
    throw new Error("message is required");
  }
  const at =
    typeof input.at === "string" && Number.isFinite(Date.parse(input.at))
      ? input.at
      : new Date().toISOString();
  const entry: ScoutLogEntry = { at, message };
  if (typeof input.stage === "string" && input.stage.trim()) {
    entry.stage = input.stage.trim();
  }

  const path = opts?.storePath ?? defaultScoutLogPath();
  return serialized(async () => {
    const entries = await ensureLoaded(path);
    const last = entries[entries.length - 1];
    if (last && last.message === entry.message) {
      return last;
    }
    entries.push(entry);
    memory = entries.slice(-MAX_SCOUT_LOG_ENTRIES);
    try {
      await writeDisk(path, memory);
    } catch (err) {
      console.error("scoutLog write failed:", err);
    }
    return entry;
  });
}

/** Test helper. */
export function clearScoutLogMemory(): void {
  memory = null;
}
