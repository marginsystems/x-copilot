/**
 * Obsidian-friendly interaction memories under knowledge/ (gitignored).
 * Storage only — no retrieval in v1.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAuthorKey } from "./interactionStore.js";

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
  source?: "manual" | "copy";
  interactedAt?: string;
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
  const source = input.source === "copy" ? "copy" : "manual";

  const lines: string[] = ["---", "type: interaction"];
  lines.push(`threadId: ${yamlString(threadId)}`);
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
  const markdown = renderInteractionMarkdown(input);
  const path = buildInteractionNotePath({
    threadId: input.threadId,
    interactedAt: input.interactedAt,
    knowledgeRoot: input.knowledgeRoot,
  });
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
