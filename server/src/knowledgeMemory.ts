/**
 * Obsidian-friendly interaction memories under knowledge/ (gitignored).
 * Storage only — no retrieval in v1.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Interaction,
  type InteractionStats,
  type ReplyStatSnapshot,
} from "./interactionStore.js";
import type { StatsCheckpoint } from "./interactionStats.js";
import { normalizeAuthorKey } from "./interactionCooldown.js";

export const MAX_THREAD_EXCERPT_CHARS = 2000;
export const MAX_REPLY_CHARS = 8000;
export const MAX_OP_EXCERPT_CHARS = 2000;

export type InteractionMemoryInput = {
  threadId: string;
  author: string;
  reply: string;
  url?: string;
  text?: string;
  summary?: string;
  opAuthor?: string;
  opText?: string;
  agenda?: string;
  baitScore?: number;
  engage?: string;
  flags?: string[];
  intent?: string;
  reason?: string;
  source?: "manual" | "copy" | "discovered";
  interactedAt?: string;
  /** Platform user who marked this thread — scopes voice folds to their own replies. */
  userId?: string;
  /** Override root for tests. Default: <projectRoot>/knowledge */
  knowledgeRoot?: string;
};

/** Repo root (nearest package.json) — anchors defaults so CLI and server agree regardless of cwd. */
function resolveProjectRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth++) {
    if (existsSync(resolve(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const projectRoot = resolveProjectRoot();

export function defaultKnowledgeRoot(): string {
  return resolve(projectRoot, "knowledge");
}

/** Sanitize threadId for filenames: keep [A-Za-z0-9_-], collapse junk. */
export function safeThreadIdForFilename(threadId: string): string {
  const cleaned = threadId.trim().replace(/[^A-Za-z0-9_-]+/g, "_");
  const collapsed = cleaned.replace(/_+/g, "_").replace(/^_|_$/g, "");
  return collapsed.slice(0, 80) || "unknown";
}

export function utcDatePrefix(iso: string = new Date().toISOString()): string {
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date().toISOString().slice(0, 10);
}

export function buildInteractionNotePath(opts: {
  threadId: string;
  interactedAt?: string;
  knowledgeRoot?: string;
}): string {
  const root = opts.knowledgeRoot ?? defaultKnowledgeRoot();
  const date = utcDatePrefix(opts.interactedAt);
  const id = safeThreadIdForFilename(opts.threadId);
  return resolve(root, "interactions", `${date}-${id}.md`);
}

function yamlString(value: string): string {
  // Prefer double-quoted YAML with escapes for safety.
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  return `"${escaped}"`;
}

function yamlOptionalString(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return yamlString(t);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function optionalStringTrim(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t || undefined;
}

/** Raw post body for ## Post — never substitute summary. */
function postBody(text: string | undefined): string {
  const raw = optionalStringTrim(text);
  return truncate(raw ?? "(no thread text)", MAX_THREAD_EXCERPT_CHARS);
}

/** Append ## Post / ## OP / ## Summary body sections (shared by interaction + dismissal). */
function appendThreadContextSections(
  lines: string[],
  input: {
    text?: string;
    summary?: string;
    opAuthor?: string;
    opText?: string;
    /** Interaction triage rationale — italic under Summary when set. */
    reason?: string;
  },
): void {
  lines.push("## Post", "", postBody(input.text), "");

  const opText = optionalStringTrim(input.opText);
  if (opText) {
    const opAuthor = optionalStringTrim(input.opAuthor);
    const label = opAuthor
      ? `${opAuthor.startsWith("@") ? opAuthor : `@${opAuthor}`}: `
      : "";
    lines.push(
      "## OP",
      "",
      `${label}${truncate(opText, MAX_OP_EXCERPT_CHARS)}`,
      "",
    );
  }

  const summary = optionalStringTrim(input.summary);
  if (summary) {
    lines.push("## Summary", "", truncate(summary, MAX_THREAD_EXCERPT_CHARS), "");
    const reason = optionalStringTrim(input.reason);
    if (reason && reason !== summary) {
      lines.push(`_${truncate(reason, 500)}_`, "");
    }
  } else {
    const reason = optionalStringTrim(input.reason);
    if (reason) {
      lines.push(`_${truncate(reason, 500)}_`, "");
    }
  }
}

export function normalizeReply(reply: unknown): string {
  if (typeof reply !== "string") return "";
  return reply.trim();
}

export type MemoryReplyInput = {
  threadId: string;
  text: string;
  postedAt: string | null;
  /** Owning platform user, when the mark carried one. */
  userId?: string;
};

/** Pull threadId + ## Reply out of an interaction note. */
export function parseInteractionNoteReply(
  markdown: string,
): MemoryReplyInput | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!fm) return null;
  const threadId = /(?:^|\n)threadId:\s*"?(\d+)"?/.exec(fm[1]!)?.[1] ?? "";
  const interactedAt =
    /(?:^|\n)interactedAt:\s*"?([^\s"\n]+)"?/.exec(fm[1]!)?.[1] ?? "";
  const userId = /(?:^|\n)userId:\s*"?([^"\n]+)"?/.exec(fm[1]!)?.[1] ?? "";
  const replyMatch = /^##\s+Reply\s*\r?\n+([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec(
    markdown,
  );
  const text = normalizeReply(replyMatch?.[1] ?? "");
  if (!threadId || !text) return null;
  const parsed: MemoryReplyInput = {
    threadId,
    text,
    postedAt: interactedAt || null,
  };
  if (userId) parsed.userId = userId;
  return parsed;
}

/** Every interaction note for `userId` that still has a usable ## Reply. */
export async function listInteractionMemoryReplies(opts?: {
  knowledgeRoot?: string;
  userId?: string;
  /** Fold notes with no `userId:` frontmatter (pre-PR and hourly-discovered). */
  includeUnowned?: boolean;
}): Promise<MemoryReplyInput[]> {
  const root = opts?.knowledgeRoot ?? defaultKnowledgeRoot();
  const dir = join(root, "interactions");
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".md"));
  } catch {
    return [];
  }
  const out: MemoryReplyInput[] = [];
  for (const name of names) {
    try {
      const raw = await readFile(join(dir, name), "utf8");
      const parsed = parseInteractionNoteReply(raw);
      if (!parsed) continue;
      // Fold only the calling user's own notes. Notes without a userId (written
      // before userId scoping, or by the hourly discover tick) fold only when
      // the caller opts in — the single-user sidecar — so they cannot leak into
      // any one user's corpus on a multi-user install.
      if (opts?.userId) {
        if (parsed.userId && parsed.userId !== opts.userId) continue;
        if (!parsed.userId && !opts.includeUnowned) continue;
      }
      out.push(parsed);
    } catch {
      // Skip unreadable notes — one bad file must not block learn.
    }
  }
  return out;
}

export function renderInteractionMarkdown(
  input: InteractionMemoryInput,
): string {
  const reply = normalizeReply(input.reply);
  if (!reply) {
    throw new Error("reply is required");
  }
  if (reply.length > MAX_REPLY_CHARS) {
    throw new Error(`reply exceeds ${MAX_REPLY_CHARS} characters`);
  }

  const threadId = input.threadId.trim();
  const author = input.author.trim();
  const authorKey = normalizeAuthorKey(author);
  if (!threadId || !author || !authorKey) {
    throw new Error("threadId and author are required");
  }

  const interactedAt = input.interactedAt ?? new Date().toISOString();
  const source =
    input.source === "copy" || input.source === "discovered"
      ? input.source
      : "manual";

  const lines: string[] = ["---", "type: interaction"];
  lines.push(`threadId: ${yamlString(threadId)}`);
  const userId = optionalStringTrim(input.userId);
  if (userId) lines.push(`userId: ${yamlString(userId)}`);
  const url = yamlOptionalString(input.url);
  if (url) lines.push(`url: ${url}`);
  lines.push(`author: ${yamlString(author)}`);
  lines.push(`authorKey: ${yamlString(authorKey)}`);
  const agenda = yamlOptionalString(input.agenda);
  if (agenda) lines.push(`agenda: ${agenda}`);
  lines.push(`interactedAt: ${yamlString(interactedAt)}`);
  lines.push(`source: ${source}`);
  if (typeof input.baitScore === "number" && Number.isFinite(input.baitScore)) {
    lines.push(`baitScore: ${Math.round(input.baitScore)}`);
  }
  const engage = yamlOptionalString(input.engage);
  if (engage) lines.push(`engage: ${engage}`);
  if (Array.isArray(input.flags) && input.flags.length) {
    const flags = input.flags
      .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
      .map((f) => yamlString(f.trim()));
    if (flags.length) lines.push(`flags: [${flags.join(", ")}]`);
  }
  const intent = yamlOptionalString(input.intent);
  if (intent) lines.push(`intent: ${intent}`);
  lines.push("---", "");
  appendThreadContextSections(lines, input);
  lines.push("## Reply", "", reply, "");
  return `${lines.join("\n")}\n`;
}

export async function writeInteractionMemory(
  input: InteractionMemoryInput,
): Promise<{ path: string; markdown: string }> {
  let markdown = renderInteractionMarkdown(input);
  const path = buildInteractionNotePath({
    threadId: input.threadId,
    interactedAt: input.interactedAt,
    knowledgeRoot: input.knowledgeRoot,
  });
  try {
    const existing = await readFile(path, "utf8");
    markdown = preserveInteractionOutcome(existing, markdown);
    if (existing === markdown) return { path, markdown };
  } catch {
    // The note does not exist yet.
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, markdown, "utf8");
  return { path, markdown };
}

export type DismissalMemoryInput = {
  threadId: string;
  author: string;
  url?: string;
  text?: string;
  summary?: string;
  opAuthor?: string;
  opText?: string;
  reason?: string;
  dismissedAt?: string;
  knowledgeRoot?: string;
};

const MAX_DISMISSAL_REASON_CHARS = 500;

export function buildDismissalNotePath(opts: {
  threadId: string;
  dismissedAt?: string;
  knowledgeRoot?: string;
}): string {
  const root = opts.knowledgeRoot ?? defaultKnowledgeRoot();
  const date = utcDatePrefix(opts.dismissedAt);
  const id = safeThreadIdForFilename(opts.threadId);
  return resolve(root, "dismissals", `${date}-${id}.md`);
}

export function renderDismissalMarkdown(input: DismissalMemoryInput): string {
  const threadId = input.threadId.trim();
  const author = input.author.trim();
  const authorKey = normalizeAuthorKey(author);
  if (!threadId || !author || !authorKey) {
    throw new Error("threadId and author are required");
  }

  const dismissedAt = input.dismissedAt ?? new Date().toISOString();
  const reason = optionalStringTrim(input.reason);

  const lines: string[] = ["---", "type: dismissal"];
  lines.push(`threadId: ${yamlString(threadId)}`);
  const url = yamlOptionalString(input.url);
  if (url) lines.push(`url: ${url}`);
  lines.push(`author: ${yamlString(author)}`);
  lines.push(`authorKey: ${yamlString(authorKey)}`);
  lines.push(`dismissedAt: ${yamlString(dismissedAt)}`);
  lines.push("---", "");
  // Dismissal user reason goes in ## Reason — do not reuse triage reason italic.
  appendThreadContextSections(lines, {
    text: input.text,
    summary: input.summary,
    opAuthor: input.opAuthor,
    opText: input.opText,
  });
  if (reason) {
    lines.push(
      "## Reason",
      "",
      truncate(reason, MAX_DISMISSAL_REASON_CHARS),
      "",
    );
  } else {
    lines.push("## Reason", "", "(none)", "");
  }
  return `${lines.join("\n")}\n`;
}

export async function writeDismissalMemory(
  input: DismissalMemoryInput,
): Promise<{ path: string; markdown: string }> {
  const markdown = renderDismissalMarkdown(input);
  const path = buildDismissalNotePath({
    threadId: input.threadId,
    dismissedAt: input.dismissedAt,
    knowledgeRoot: input.knowledgeRoot,
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, markdown, "utf8");
  return { path, markdown };
}

/** Frontmatter keys owned by the stats → memory projection (replaced, never duplicated). */
export const MANAGED_OUTCOME_FRONTMATTER_KEYS = [
  "statsUpdatedAt",
  "views1h",
  "likes1h",
  "replies1h",
  "retweets1h",
  "sampledAt1h",
  "views24h",
  "likes24h",
  "replies24h",
  "retweets24h",
  "sampledAt24h",
] as const;

function preserveInteractionOutcome(existing: string, next: string): string {
  const oldFm = /^---\n([\s\S]*?)\n---\n/.exec(existing)?.[1] ?? "";
  const nextMatch = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(next);
  if (!nextMatch) return next;

  const managed = oldFm
    .split("\n")
    .filter((line) => {
      const key = /^([A-Za-z0-9_]+)\s*:/.exec(line)?.[1];
      return key !== undefined && MANAGED_OUTCOME_FRONTMATTER_KEYS.includes(
        key as (typeof MANAGED_OUTCOME_FRONTMATTER_KEYS)[number],
      );
    });
  const fm = [nextMatch[1], ...managed].filter(Boolean).join("\n");
  let body = nextMatch[2];
  const outcome = /^##\s+Outcome[^\S\n]*\n?[\s\S]*?(?=^##\s|(?![\s\S]))/m.exec(
    existing,
  )?.[0];
  if (outcome && !/^##\s+Outcome[^\S\n]*$/m.test(body)) {
    body = `${body.replace(/\s*$/, "")}\n\n${outcome.trim()}\n`;
  }
  return `---\n${fm}\n---\n${body.replace(/^\n/, "")}`;
}

export type UpdateInteractionMemoryOutcomeResult =
  | { ok: true; path: string; markdown: string }
  | { ok: false; error: string; path?: string };

function formatMetricLine(
  label: "1h" | "24h",
  snap: ReplyStatSnapshot,
): string {
  const views =
    typeof snap.views === "number" && Number.isFinite(snap.views)
      ? snap.views
      : "—";
  const likes =
    typeof snap.likes === "number" && Number.isFinite(snap.likes)
      ? snap.likes
      : "—";
  const replies =
    typeof snap.replies === "number" && Number.isFinite(snap.replies)
      ? snap.replies
      : "—";
  const retweets =
    typeof snap.retweets === "number" && Number.isFinite(snap.retweets)
      ? snap.retweets
      : "—";
  const replyWord =
    typeof replies === "number" && replies === 1 ? "reply" : "replies";
  const repostWord =
    typeof retweets === "number" && retweets === 1 ? "repost" : "reposts";
  return `${label}: ${views} views · ${likes} likes · ${replies} ${replyWord} · ${retweets} ${repostWord}`;
}

/** Compact ## Outcome body from available checkpoints (exported for tests). */
export function formatOutcomeSection(stats: InteractionStats): string {
  const lines: string[] = [];
  if (stats.t1h) lines.push(formatMetricLine("1h", stats.t1h));
  if (stats.t24h) lines.push(formatMetricLine("24h", stats.t24h));
  return lines.join("\n");
}

function checkpointFrontmatterLines(
  prefix: "1h" | "24h",
  snap: ReplyStatSnapshot,
): string[] {
  const lines: string[] = [];
  if (typeof snap.views === "number" && Number.isFinite(snap.views)) {
    lines.push(`views${prefix}: ${Math.round(snap.views)}`);
  }
  if (typeof snap.likes === "number" && Number.isFinite(snap.likes)) {
    lines.push(`likes${prefix}: ${Math.round(snap.likes)}`);
  }
  if (typeof snap.replies === "number" && Number.isFinite(snap.replies)) {
    lines.push(`replies${prefix}: ${Math.round(snap.replies)}`);
  }
  if (typeof snap.retweets === "number" && Number.isFinite(snap.retweets)) {
    lines.push(`retweets${prefix}: ${Math.round(snap.retweets)}`);
  }
  if (snap.sampledAt?.trim()) {
    lines.push(`sampledAt${prefix}: ${yamlString(snap.sampledAt.trim())}`);
  }
  return lines;
}

/** Date prefix of an interaction note's `interactedAt` frontmatter, if any. */
async function noteInteractedAtDate(path: string): Promise<string | null> {
  try {
    const raw = await readFile(path, "utf8");
    const m = /^interactedAt:\s*"?(\d{4}-\d{2}-\d{2})/m.exec(raw);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Find an interaction note by expected path from `at` + threadId, then
 * filename-suffix fallback for legacy / re-marked notes. Never uses postedAt.
 */
export async function findInteractionNotePath(opts: {
  threadId: string;
  interactedAt?: string;
  knowledgeRoot?: string;
}): Promise<string | null> {
  const threadId = opts.threadId.trim();
  if (!threadId) return null;
  const root = opts.knowledgeRoot ?? defaultKnowledgeRoot();
  const expected = buildInteractionNotePath({
    threadId,
    interactedAt: opts.interactedAt,
    knowledgeRoot: root,
  });
  if (existsSync(expected)) return expected;

  const dir = join(root, "interactions");
  if (!existsSync(dir)) return null;
  const safeId = safeThreadIdForFilename(threadId);
  const suffix = `-${safeId}.md`;
  try {
    const names = await readdir(dir);
    const matches = names
      .filter((n) => n.endsWith(suffix))
      .sort()
      .reverse();
    if (!matches.length) return null;
    // Re-marked threads can leave several dated notes for one threadId; prefer
    // one whose interactedAt matches the interaction date over the newest file.
    const wantDate = opts.interactedAt ? utcDatePrefix(opts.interactedAt) : null;
    if (wantDate) {
      for (const name of matches) {
        if ((await noteInteractedAtDate(join(dir, name))) === wantDate) {
          return join(dir, name);
        }
      }
    }
    return join(dir, matches[0]!);
  } catch {
    return null;
  }
}

/**
 * Strip managed outcome keys from raw frontmatter; keep everything else.
 * When `prefixes` is given, only keys for those checkpoints are stripped so
 * the other checkpoint's stats survive partial tick writes.
 */
export function stripManagedOutcomeFrontmatter(
  fm: string,
  prefixes?: ReadonlySet<"1h" | "24h">,
): string {
  const managed = new Set<string>(MANAGED_OUTCOME_FRONTMATTER_KEYS);
  return fm
    .split("\n")
    .filter((line) => {
      const m = /^([A-Za-z0-9_]+)\s*:/.exec(line);
      if (!m) return true;
      const key = m[1]!;
      if (!managed.has(key)) return true;
      if (prefixes === undefined) return false;
      if (key === "statsUpdatedAt") return false;
      const suffix = key.endsWith("1h")
        ? "1h"
        : key.endsWith("24h")
          ? "24h"
          : null;
      return suffix === null || !prefixes.has(suffix);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Replace or append ## Outcome; preserve other body sections. */
export function upsertOutcomeSection(body: string, outcomeBody: string): string {
  const trimmedBody = body.replace(/^\s*\n/, "");
  const outcomeBlock = `## Outcome\n\n${outcomeBody.trim()}\n`;
  const re = /^##\s+Outcome\s*$/m;
  if (!re.test(trimmedBody)) {
    const base = trimmedBody.replace(/\s*$/, "");
    return base ? `${base}\n\n${outcomeBlock}` : outcomeBlock;
  }
  // Replace from ## Outcome through the next ## heading or EOF.
  return trimmedBody.replace(
    /^##\s+Outcome[^\S\n]*\n?[\s\S]*?(?=^##\s|(?![\s\S]))/m,
    `${outcomeBlock}\n`,
  );
}

/** Merge fresh checkpoint lines with the note's existing ## Outcome body. */
function mergedOutcomeSection(body: string, stats: InteractionStats): string {
  const fresh = new Map<string, string>();
  for (const line of formatOutcomeSection(stats).split("\n")) {
    const label = /^(1h|24h):/.exec(line)?.[1];
    if (label) fresh.set(label, line);
  }
  const existing =
    /^##\s+Outcome[^\S\n]*\n?([\s\S]*?)(?=^##\s|$(?![\s\S]))/m.exec(body)?.[1] ??
    "";
  for (const line of existing.split("\n")) {
    const label = /^(1h|24h):/.exec(line.trim())?.[1];
    if (label && !fresh.has(label)) fresh.set(label, line.trim());
  }
  return ["1h", "24h"]
    .filter((label) => fresh.has(label))
    .map((label) => fresh.get(label)!)
    .join("\n");
}

/**
 * Project interaction stats onto the matching knowledge note.
 * Soft-fails (ok:false) when the note is missing — never throws for that case.
 */
export async function updateInteractionMemoryOutcome(opts: {
  interaction: Interaction;
  /** Checkpoint just patched by the stats worker (SyncOutcomeFn contract). */
  checkpoint?: StatsCheckpoint;
  knowledgeRoot?: string;
  /** Override clock for statsUpdatedAt (tests). */
  nowIso?: string;
}): Promise<UpdateInteractionMemoryOutcomeResult> {
  const { interaction } = opts;
  const stats = interaction.stats;
  if (!stats?.t1h && !stats?.t24h) {
    return { ok: false, error: "no stats snapshots on interaction" };
  }

  const path = await findInteractionNotePath({
    threadId: interaction.threadId,
    interactedAt: interaction.at,
    knowledgeRoot: opts.knowledgeRoot,
  });
  if (!path) {
    return {
      ok: false,
      error: `interaction note not found for threadId=${interaction.threadId}`,
    };
  }

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    return {
      ok: false,
      path,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const trimmed = raw.replace(/^\uFEFF/, "");
  let fm = "";
  let body = trimmed;
  if (trimmed.startsWith("---")) {
    const end = trimmed.indexOf("\n---", 3);
    if (end >= 0) {
      fm = trimmed.slice(3, end).trim();
      body = trimmed.slice(end + 4);
    }
  }

  // Only replace the checkpoints present in this interaction's stats so the
  // other checkpoint's keys survive separate t1h / t24h tick runs.
  const activeCheckpoints = new Set<"1h" | "24h">();
  if (stats.t1h) activeCheckpoints.add("1h");
  if (stats.t24h) activeCheckpoints.add("24h");
  const keptFm = stripManagedOutcomeFrontmatter(fm, activeCheckpoints);
  const updatedAt = opts.nowIso ?? new Date().toISOString();
  const outcomeLines: string[] = [
    keptFm,
    `statsUpdatedAt: ${yamlString(updatedAt)}`,
  ].filter(Boolean);
  if (stats.t1h) {
    outcomeLines.push(...checkpointFrontmatterLines("1h", stats.t1h));
  }
  if (stats.t24h) {
    outcomeLines.push(...checkpointFrontmatterLines("24h", stats.t24h));
  }

  const outcomeBody = mergedOutcomeSection(body, stats);
  if (!outcomeBody) {
    return { ok: false, path, error: "empty outcome body" };
  }
  const nextBody = upsertOutcomeSection(body, outcomeBody);
  const markdown = `---\n${outcomeLines.join("\n")}\n---\n${nextBody.replace(/^\n/, "")}`;
  // Ensure trailing newline
  const finalMd = markdown.endsWith("\n") ? markdown : `${markdown}\n`;

  try {
    await writeFile(path, finalMd, "utf8");
  } catch (err) {
    return {
      ok: false,
      path,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true, path, markdown: finalMd };
}
