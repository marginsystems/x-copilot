/** Display bits for an X-like expanded card. No extra API — card fields only. */

export function displayHandle(author: string): string {
  const handle = author.replace(/^@+/, "").trim();
  return handle || "unknown";
}

export function handleInitial(author: string): string {
  const handle = author.replace(/^@+/, "").trim();
  const ch = handle[0];
  return ch && /[a-z0-9]/i.test(ch) ? ch.toUpperCase() : "?";
}

export function hasParentContext(thread: {
  opAuthor?: string | null;
  opText?: string | null;
}): boolean {
  return Boolean(thread.opAuthor?.trim() && thread.opText?.trim());
}

export function parentKind(thread: {
  isQuote?: boolean;
  isReply?: boolean;
  inReplyToId?: string | null;
}): "quote" | "reply" {
  if (thread.isQuote && !thread.isReply && !thread.inReplyToId) return "quote";
  if (thread.isQuote) return "quote";
  return "reply";
}
