export const FOR_YOU_KINDS = ["post", "quote", "repost", "reply"] as const;
export type ForYouKind = (typeof FOR_YOU_KINDS)[number];

/** Desk tab for Scout leads + daily digest. Aviation register; not the X feed. */
export const APPROACH_TAB_LABEL = "Approach";
export const APPROACH_MIN_TRACKED = 5;

const UTC_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type ForYouProgress = {
  tracked: number;
  needed: number;
};

export type ForYouExtraUsage = {
  cost: number;
  batchSize: number;
  used: number;
  limit: number;
  remaining: number;
  creditsRemaining: number;
  canExtra: boolean;
};

export function parseForYouExtra(raw: unknown): ForYouExtraUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const extra =
    row.extra && typeof row.extra === "object"
      ? (row.extra as Record<string, unknown>)
      : row;
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.floor(value))
      : null;
  const cost = num(extra.cost);
  const batchSize = num(extra.batchSize);
  const used = num(extra.used);
  const limit = num(extra.limit);
  const remaining = num(extra.remaining);
  const creditsRemaining = num(extra.creditsRemaining);
  if (
    cost == null ||
    batchSize == null ||
    used == null ||
    limit == null ||
    remaining == null ||
    creditsRemaining == null
  ) {
    return null;
  }
  return {
    cost,
    batchSize,
    used,
    limit,
    remaining,
    creditsRemaining,
    canExtra: extra.canExtra === true,
  };
}

export function extraButtonLabel(extra: ForYouExtraUsage): string {
  return `${extra.batchSize} more originals · ${extra.cost} credits · ${extra.remaining} left today`;
}

export function extrasUnlocked(progress?: ForYouProgress | null): boolean {
  return Boolean(progress && progress.tracked >= progress.needed);
}

export function parseForYouProgress(raw: unknown): ForYouProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const tracked =
    typeof row.tracked === "number" && Number.isFinite(row.tracked)
      ? Math.max(0, Math.floor(row.tracked))
      : null;
  const needed =
    typeof row.needed === "number" && Number.isFinite(row.needed)
      ? Math.max(1, Math.floor(row.needed))
      : APPROACH_MIN_TRACKED;
  if (tracked == null) return null;
  return { tracked, needed };
}

/** First digest weekday if they keep posting about one new own-post per UTC day. */
export function firstDigestWeekday(
  tracked: number,
  needed: number,
  now = new Date(),
): string {
  if (tracked >= needed) return "the next UTC daily pass";
  const remaining = needed - tracked;
  const when = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + remaining + 1,
    ),
  );
  return UTC_WEEKDAYS[when.getUTCDay()] ?? "soon";
}

export function approachEmptyCopy(opts: {
  searching: boolean;
  progress?: ForYouProgress | null;
  now?: Date;
}): string {
  if (opts.searching) return "Scout is working…";
  const progress = opts.progress;
  if (!progress) {
    return "Nothing on Approach yet. Scout refuels in the background. Daily suggestions land here once we have enough of your 24h post stats.";
  }
  if (progress.tracked >= progress.needed) {
    return `Nothing on Approach yet. Scout refuels in the background. ${progress.tracked} of ${progress.needed} posts tracked — first digest after the next UTC daily pass.`;
  }
  const day = firstDigestWeekday(
    progress.tracked,
    progress.needed,
    opts.now,
  );
  return `Nothing on Approach yet. Scout refuels in the background. ${progress.tracked} of ${progress.needed} posts tracked — first digest ~${day}.`;
}

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

/** Two-letter badge in the Approach row square. */
export function forYouKindShort(kind: ForYouKind): string {
  if (kind === "post") return "OG";
  if (kind === "quote") return "QT";
  if (kind === "repost") return "RT";
  return "RE";
}

export function forYouKindClass(kind: ForYouKind): string {
  return `kind-${kind}`;
}

/**
 * Own-account originals/quotes may post from the desk. Quote cards need a
 * numeric targetId — the desk quotes that status id, and a quote without one
 * cannot be desk-posted or quoted via the compose intent. Scout replies may not.
 */
export function forYouUsesDeskCompose(row: ForYouSuggestion): boolean {
  if (row.kind === "post") return true;
  if (row.kind === "quote") {
    return row.targetId !== null && /^\d+$/.test(row.targetId);
  }
  return false;
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
