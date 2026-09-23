export type VanishHistoryRow = {
  threadId: string;
  conversationId?: string;
  inReplyToId?: string;
};

function addId(ids: Set<string>, value: string | null | undefined): void {
  const id = value?.trim();
  if (id) ids.add(id);
}

export function vanishEvent(opts: {
  cardId: string;
  conversationId?: string | null;
  inReplyToId?: string | null;
  interactedIds: Iterable<string>;
  history: VanishHistoryRow[];
}): "mark" | "skip" {
  const cardIds = new Set<string>();
  addId(cardIds, opts.cardId);
  addId(cardIds, opts.conversationId);
  addId(cardIds, opts.inReplyToId);

  for (const id of opts.interactedIds) {
    if (cardIds.has(id.trim())) return "mark";
  }
  for (const row of opts.history) {
    if (
      cardIds.has(row.threadId.trim()) ||
      (row.conversationId && cardIds.has(row.conversationId.trim())) ||
      (row.inReplyToId && cardIds.has(row.inReplyToId.trim()))
    ) {
      return "mark";
    }
  }
  return "skip";
}
