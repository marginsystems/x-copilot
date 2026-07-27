/**
 * Obsidian-friendly interaction memories under knowledge/ (gitignored).
 * Storage only — no retrieval in v1.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { normalizeAuthorKey } from "./interactionStore.js";

export const MAX_THREAD_EXCERPT_CHARS = 2000;
export const MAX_REPLY_CHARS = 8000;

export type InteractionMemoryInput = {
  threadId: string;
  author: string;
  reply: string;
  url?: string;
  text?: string;
  summary?: string;
  agenda?: string;
  baitScore?: number;
  engage?: string;
  flags?: string[];
  intent?: string;
  reason?: string;
  source?: "manual" | "copy";
  interactedAt?: string;
  /** Override root for tests. Default: <cwd>/knowledge */
  knowledgeRoot?: string;
};

export function defaultKnowledgeRoot(): string {
  return resolve(process.cwd(), "knowledge");
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
  const threadBody = truncate(
    (input.summary?.trim() || input.text?.trim() || "(no thread text)").trim(),
    MAX_THREAD_EXCERPT_CHARS,
  );

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
  lines.push("---", "", "## Thread", "", threadBody, "");
  if (input.reason?.trim()) {
    lines.push(`_${truncate(input.reason.trim(), 500)}_`, "");
  }
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
