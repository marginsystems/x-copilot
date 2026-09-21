/**
 * Owner-safe note identity, metadata parsing, resolution and atomic
 * persistence for knowledge/{interactions,dismissals}.
 *
 * Canonical filename: `<date>-u<sha256(userId)>-<threadKey>.md`, where the
 * thread key keeps readable numeric X ids and hashes anything else. One
 * owner has one note per thread and date; reply ids are note metadata and
 * SQL evidence keys, never part of the filename. Every lookup verifies
 * frontmatter userId/threadId; the filename alone is never proof of
 * ownership. Legacy `<date>-<safeThreadId>.md` notes and previously written
 * `<canonical>-r<16hex>.md` reply-suffixed notes are still resolvable when
 * their metadata verifies; both are noncanonical fallback input and are
 * never deleted.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { withFileLock } from "../platform/fileLock.js";

export type OwnedNoteKind = "interaction" | "dismissal";

export const OWNED_NOTE_DIRS: Record<OwnedNoteKind, string> = {
  interaction: "interactions",
  dismissal: "dismissals",
};

/** Trim and require a platform user id; new notes never exist unowned. */
export function requireNoteOwner(userId: unknown): string {
  const id = typeof userId === "string" ? userId.trim() : "";
  if (!id) throw new Error("userId is required");
  return id;
}

export function requireThreadId(threadId: unknown): string {
  const id = typeof threadId === "string" ? threadId.trim() : "";
  if (!id) throw new Error("threadId is required");
  return id;
}

export function utcDatePrefix(iso: string = new Date().toISOString()): string {
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10);
}

/** Full SHA-256 of the trimmed owner id — the owner filename component. */
export function ownerHash(userId: string): string {
  return createHash("sha256").update(requireNoteOwner(userId)).digest("hex");
}

/**
 * Collision-safe thread component: numeric X ids stay readable; anything
 * else is hashed (prefixed `h` so it can never equal a numeric id).
 */
export function threadKey(threadId: string): string {
  const id = requireThreadId(threadId);
  if (/^\d{1,40}$/.test(id)) return id;
  return `h${createHash("sha256").update(id).digest("hex")}`;
}

/** Legacy sanitizer kept for reading pre-C07 filenames (lossy). */
export function safeThreadIdForFilename(threadId: string): string {
  const cleaned = threadId.trim().replace(/[^A-Za-z0-9_-]+/g, "_");
  const collapsed = cleaned.replace(/_+/g, "_").replace(/^_|_$/g, "");
  return collapsed.slice(0, 80) || "unknown";
}

/** The one canonical name for this owner/thread/date; independent of any reply id. */
export function ownedNoteFilename(opts: {
  userId: string;
  threadId: string;
  at?: string;
}): string {
  return `${utcDatePrefix(opts.at)}-u${ownerHash(opts.userId)}-${threadKey(opts.threadId)}.md`;
}

export function legacyNoteFilename(threadId: string, at?: string): string {
  return `${utcDatePrefix(at)}-${safeThreadIdForFilename(threadId)}.md`;
}

export function ownedNoteDir(kind: OwnedNoteKind, knowledgeRoot: string): string {
  return resolve(knowledgeRoot, OWNED_NOTE_DIRS[kind]);
}

export function buildOwnedNotePath(opts: {
  kind: OwnedNoteKind;
  userId: string;
  threadId: string;
  at?: string;
  knowledgeRoot: string;
}): string {
  return join(ownedNoteDir(opts.kind, opts.knowledgeRoot), ownedNoteFilename(opts));
}

export function buildLegacyNotePath(opts: {
  kind: OwnedNoteKind;
  threadId: string;
  at?: string;
  knowledgeRoot: string;
}): string {
  return join(
    ownedNoteDir(opts.kind, opts.knowledgeRoot),
    legacyNoteFilename(opts.threadId, opts.at),
  );
}

export type OwnedNoteName = {
  date: string;
  ownerHash: string;
  threadKey: string;
  /** Set only for previously written reply-suffixed names; those are not canonical. */
  replyKey: string | null;
};

const OWNED_NAME_RE =
  /^(\d{4}-\d{2}-\d{2})-u([0-9a-f]{64})-(\d{1,40}|h[0-9a-f]{64})(-r([0-9a-f]{16}))?\.md$/;

/**
 * Parse an owned filename (canonical, or an existing reply-suffixed
 * compatibility name); null for legacy or foreign names.
 */
export function parseOwnedNoteName(name: string): OwnedNoteName | null {
  const m = OWNED_NAME_RE.exec(name);
  if (!m) return null;
  return { date: m[1]!, ownerHash: m[2]!, threadKey: m[3]!, replyKey: m[5] ?? null };
}

/** True only for the C07 `<date>-u<hash>-<threadKey>.md` name. */
export function isCanonicalOwnedNoteName(name: string): boolean {
  const parsed = parseOwnedNoteName(name);
  return parsed !== null && parsed.replyKey === null;
}

/** Filename reply key of an existing suffixed note for this reply id. */
function replyKeyFor(replyId: string | undefined): string | null {
  const id = replyId?.trim();
  return id ? createHash("sha256").update(id).digest("hex").slice(0, 16) : null;
}

export type OwnerState = "owned" | "unowned" | "conflict";

export type OwnedNoteMetadata = {
  type: OwnedNoteKind | null;
  /** Null when missing or declared more than once. */
  threadId: string | null;
  /** Set only when ownerState is "owned". */
  userId: string | null;
  ownerState: OwnerState;
  /** interactedAt / dismissedAt as written. */
  actionAt: string | null;
  /** Normalized ## Reply body; empty when absent. */
  reply: string;
  frontmatter: string;
  body: string;
};

function unquoteYamlScalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    let out = "";
    for (let i = 1; i < value.length; i++) {
      const ch = value[i]!;
      if (ch === "\\" && i + 1 < value.length) {
        const next = value[++i]!;
        out +=
          next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : next;
        continue;
      }
      if (ch === '"') break;
      out += ch;
    }
    return out;
  }
  if (value.startsWith("'")) {
    let out = "";
    for (let i = 1; i < value.length; i++) {
      const ch = value[i]!;
      if (ch === "'") {
        if (value[i + 1] === "'") {
          out += "'";
          i++;
          continue;
        }
        break;
      }
      out += ch;
    }
    return out;
  }
  return value;
}

function splitFrontmatter(
  markdown: string,
): { frontmatter: string; body: string } | null {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!m) return null;
  return { frontmatter: m[1]!, body: markdown.slice(m[0].length) };
}

/** Parse owner/thread/time/reply from a note. Null when there is no frontmatter. */
export function parseOwnedNoteMetadata(markdown: string): OwnedNoteMetadata | null {
  const split = splitFrontmatter(markdown);
  if (!split) return null;
  const values = new Map<string, string[]>();
  for (const line of split.frontmatter.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const list = values.get(m[1]!) ?? [];
    list.push(m[2]!);
    values.set(m[1]!, list);
  }
  const single = (key: string): string | null | "conflict" => {
    const list = values.get(key);
    if (!list) return null;
    if (list.length > 1) return "conflict";
    const value = unquoteYamlScalar(list[0]!).trim();
    return value || null;
  };
  const typeRaw = single("type");
  const type =
    typeRaw === "interaction" || typeRaw === "dismissal" ? typeRaw : null;
  const owner = single("userId");
  const thread = single("threadId");
  let ownerState: OwnerState = "unowned";
  let userId: string | null = null;
  if (owner === "conflict" || thread === "conflict") {
    ownerState = "conflict";
  } else if (owner) {
    ownerState = "owned";
    userId = owner;
  }
  const at = single("interactedAt") ?? single("dismissedAt");
  const replyMatch = /^##\s+Reply\s*\r?\n+([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec(
    markdown,
  );
  return {
    type,
    threadId: thread === "conflict" ? null : thread,
    userId,
    ownerState,
    actionAt: at === "conflict" ? null : at,
    reply: (replyMatch?.[1] ?? "").trim(),
    frontmatter: split.frontmatter,
    body: split.body,
  };
}

/** True only when metadata names exactly this owner and thread. */
export function noteVerifiedFor(
  meta: OwnedNoteMetadata | null,
  expected: { userId: string; threadId: string },
): boolean {
  return (
    meta !== null &&
    meta.ownerState === "owned" &&
    meta.userId === expected.userId.trim() &&
    meta.threadId === expected.threadId.trim()
  );
}

/** mtime-keyed listing/content cache so one batch reuses directory work. */
export class OwnedNoteCache {
  private names = new Map<string, { mtimeNs: bigint; names: string[] }>();
  private contents = new Map<string, { mtimeNs: bigint; raw: string }>();

  clear(): void {
    this.names.clear();
    this.contents.clear();
  }

  async list(dir: string): Promise<string[] | null> {
    try {
      const mtimeNs = (await stat(dir, { bigint: true })).mtimeNs;
      const cached = this.names.get(dir);
      if (cached?.mtimeNs === mtimeNs) return cached.names;
      const names = (await readdir(dir)).filter((n) => n.endsWith(".md"));
      this.names.set(dir, { mtimeNs, names });
      return names;
    } catch {
      this.names.delete(dir);
      return null;
    }
  }

  async read(path: string): Promise<string> {
    const mtimeNs = (await stat(path, { bigint: true })).mtimeNs;
    const cached = this.contents.get(path);
    if (cached?.mtimeNs === mtimeNs) return cached.raw;
    const raw = await readFile(path, "utf8");
    this.contents.set(path, { mtimeNs, raw });
    return raw;
  }
}

/** `.md` names in a note directory; null when the directory is unreadable. */
export async function listNoteNames(
  dir: string,
  cache?: OwnedNoteCache,
): Promise<string[] | null> {
  if (cache) return cache.list(dir);
  try {
    return (await readdir(dir)).filter((n) => n.endsWith(".md"));
  } catch {
    return null;
  }
}

export type OwnedNoteResolution =
  | {
      state: "found";
      path: string;
      name: string;
      markdown: string;
      meta: OwnedNoteMetadata;
      canonical: boolean;
    }
  /** Nothing for this thread/date exists. */
  | { state: "missing" }
  /** Same thread/date notes exist, none verified for this owner. */
  | { state: "foreign" }
  /** Several verified candidates; none uniquely selectable. */
  | { state: "ambiguous" }
  | { state: "unreadable" };

/**
 * Resolve this owner's note for a thread. The canonical path first, then
 * metadata-verified legacy / reply-suffixed / other-date candidates, with a
 * canonical-named candidate preferred. Never picks arbitrarily.
 */
export async function resolveOwnedNote(opts: {
  kind: OwnedNoteKind;
  userId: string;
  threadId: string;
  /** Canonical action time. Without it only a unique verified candidate resolves. */
  at?: string;
  /**
   * Compatibility only: narrows existing reply-suffixed fallback files to
   * this reply. It never changes the canonical path.
   */
  replyId?: string;
  knowledgeRoot: string;
  /** Accept a unique verified note from another date (legacy re-marks). */
  allowOtherDates?: boolean;
  cache?: OwnedNoteCache;
  /** Pre-listed `.md` names for batch callers; null means directory missing. */
  names?: string[] | null;
}): Promise<OwnedNoteResolution> {
  const userId = opts.userId.trim();
  const threadId = opts.threadId.trim();
  if (!userId || !threadId) return { state: "missing" };
  const dir = ownedNoteDir(opts.kind, opts.knowledgeRoot);
  const names =
    opts.names === undefined ? await listNoteNames(dir, opts.cache) : opts.names;
  if (!names) return { state: "missing" };

  const hash = ownerHash(userId);
  const key = threadKey(threadId);
  const replyKey = replyKeyFor(opts.replyId);
  const ownedSuffix = `-u${hash}-${key}.md`;
  const legacySuffix = `-${safeThreadIdForFilename(threadId)}.md`;
  const wantDate = opts.at ? utcDatePrefix(opts.at) : null;
  const canonicalName = wantDate ? `${wantDate}${ownedSuffix}` : null;
  const nameSet = new Set(names);

  const read = async (name: string): Promise<string> => {
    const path = join(dir, name);
    return opts.cache ? opts.cache.read(path) : readFile(path, "utf8");
  };

  let foreignSeen = false;
  let unreadableSeen = false;
  if (canonicalName && nameSet.has(canonicalName)) {
    try {
      const markdown = await read(canonicalName);
      const meta = parseOwnedNoteMetadata(markdown);
      if (noteVerifiedFor(meta, { userId, threadId })) {
        return {
          state: "found",
          path: join(dir, canonicalName),
          name: canonicalName,
          markdown,
          meta: meta!,
          canonical: true,
        };
      }
      foreignSeen = true;
    } catch {
      unreadableSeen = true;
    }
  }

  const verified: Array<{
    name: string;
    markdown: string;
    meta: OwnedNoteMetadata;
    dateMatches: boolean;
    canonical: boolean;
  }> = [];
  for (const name of names) {
    if (name === canonicalName) continue;
    const parsedName = parseOwnedNoteName(name);
    let candidate = false;
    if (parsedName) {
      if (parsedName.threadKey !== key) continue;
      // An existing reply-suffixed file for a different reply is not a
      // candidate when the caller names the reply it is looking for.
      if (
        replyKey !== null &&
        parsedName.replyKey !== null &&
        parsedName.replyKey !== replyKey
      ) continue;
      if (parsedName.ownerHash !== hash) {
        if (wantDate === null || parsedName.date === wantDate) foreignSeen = true;
        continue;
      }
      candidate = true;
    } else if (name.endsWith(legacySuffix)) {
      candidate = true;
    }
    if (!candidate) continue;
    let markdown: string;
    try {
      markdown = await read(name);
    } catch {
      unreadableSeen = true;
      continue;
    }
    const meta = parseOwnedNoteMetadata(markdown);
    const dateMatches =
      wantDate === null ||
      name.slice(0, 10) === wantDate ||
      (meta?.actionAt ? utcDatePrefix(meta.actionAt) === wantDate : false);
    if (noteVerifiedFor(meta, { userId, threadId })) {
      verified.push({
        name,
        markdown,
        meta: meta!,
        dateMatches,
        canonical: parsedName !== null && parsedName.replyKey === null,
      });
    } else if (dateMatches) {
      foreignSeen = true;
    }
  }

  // A verified canonical-named note wins over legacy / reply-suffixed
  // aliases; several of the same rank stay ambiguous rather than letting
  // directory order choose.
  const pick = (list: typeof verified): OwnedNoteResolution | null => {
    const canonical = list.filter((v) => v.canonical);
    const ranked = canonical.length > 0 ? canonical : list;
    if (ranked.length === 1) {
      const hit = ranked[0]!;
      return {
        state: "found",
        path: join(dir, hit.name),
        name: hit.name,
        markdown: hit.markdown,
        meta: hit.meta,
        canonical: hit.canonical,
      };
    }
    if (ranked.length > 1) return { state: "ambiguous" };
    return null;
  };
  const exact = pick(verified.filter((v) => v.dateMatches));
  if (exact) return exact;
  if (opts.allowOtherDates || wantDate === null) {
    const any = pick(verified);
    if (any) return any;
  }
  if (foreignSeen) return { state: "foreign" };
  if (unreadableSeen) return { state: "unreadable" };
  return { state: "missing" };
}

/**
 * Locked read → merge → same-directory temp → rename. The lock is shared by
 * every writer of this path across server and webhook processes.
 */
export async function writeOwnedNoteAtomically(opts: {
  path: string;
  /** Current content (undefined when absent) → next content, or null to leave as is. */
  merge: (
    existing: string | undefined,
  ) => string | null | Promise<string | null>;
}): Promise<{ path: string; markdown: string; changed: boolean }> {
  const path = opts.path;
  await mkdir(dirname(path), { recursive: true });
  return withFileLock(path, async () => {
    let existing: string | undefined;
    try {
      existing = await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const next = await opts.merge(existing);
    if (next === null || next === existing) {
      return { path, markdown: existing ?? next ?? "", changed: false };
    }
    const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await writeFile(tmp, next, "utf8");
      await rename(tmp, path);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
    return { path, markdown: next, changed: true };
  });
}
