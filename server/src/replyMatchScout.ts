export type LockedScoutCard = {
  id: string;
  conversationId?: string | null;
  inReplyToId?: string | null;
};

export type OwnReplyTarget = {
  conversationId?: string | null;
  inReplyToId?: string | null;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

export function replyMatchesLockedScout(
  reply: OwnReplyTarget,
  card: LockedScoutCard,
): boolean {
  const cardId = clean(card.id);
  if (!cardId) return false;

  const cardConversationId = clean(card.conversationId);
  const cardInReplyToId = clean(card.inReplyToId);
  const replyConversationId = clean(reply.conversationId);
  const replyInReplyToId = clean(reply.inReplyToId);
  const conversationIds = new Set(
    [cardId, cardConversationId].filter((id): id is string => Boolean(id)),
  );

  if (
    replyConversationId &&
    !conversationIds.has(replyConversationId)
  ) {
    return false;
  }

  return Boolean(
    replyInReplyToId &&
      [cardId, cardInReplyToId, cardConversationId].includes(
        replyInReplyToId,
      ),
  );
}
