export const FOR_YOU_KINDS = ["post", "quote", "repost", "reply"] as const;
export type ForYouKind = (typeof FOR_YOU_KINDS)[number];

export type ForYouSuggestion = {
  id: string;
  kind: ForYouKind;
  why: string;
  draft: string | null;
  targetId: string | null;
  targetUrl: string | null;
  targetAuthor: string | null;
};

export function parseForYouSuggestion(raw: unknown): ForYouSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const kind = typeof row.kind === "string" ? row.kind : "";
  if (!(FOR_YOU_KINDS as readonly string[]).includes(kind)) return null;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const why = typeof row.why === "string" ? row.why.trim() : "";
  if (!id || !why) return null;
  const optional = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  return {
    id,
    kind: kind as ForYouKind,
    why,
    draft: optional(row.draft),
    targetId: optional(row.targetId),
    targetUrl: optional(row.targetUrl),
    targetAuthor: optional(row.targetAuthor),
  };
}

export function forYouKindLabel(kind: ForYouKind): string {
  if (kind === "post") return "Post";
  if (kind === "quote") return "Quote";
  if (kind === "repost") return "Repost";
  return "Reply";
}

/** Own-account originals/quotes may post from the desk. Scout replies may not. */
export function forYouUsesDeskCompose(kind: ForYouKind): boolean {
  return kind === "post" || kind === "quote";
}

/** Why + digest draft — seed for the Suggest compose stance/draft pass. */
export function forYouComposeSeed(row: ForYouSuggestion): string {
  return [row.why, row.draft].filter(Boolean).join("\n\n");
}

/** Open on X — target post, reply intent, or a compose intent with the draft. */
export function forYouOpenUrl(row: ForYouSuggestion): string | null {
  if (row.targetUrl && /^https?:\/\//i.test(row.targetUrl)) {
    return row.targetUrl;
  }
  if (row.kind === "reply" && row.targetId && /^\d+$/.test(row.targetId)) {
    const params = new URLSearchParams({
      in_reply_to: row.targetId,
      text: row.draft ?? "",
    });
    return `https://x.com/intent/tweet?${params.toString()}`;
  }
  if (row.draft) {
    const params = new URLSearchParams({ text: row.draft });
    return `https://x.com/intent/tweet?${params.toString()}`;
  }
  return null;
}
