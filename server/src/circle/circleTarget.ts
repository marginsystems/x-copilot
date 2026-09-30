import type { CircleLinkKind } from "./circleStore.js";
import type { XUserRecord } from "./xProfiles.js";

export type CircleTarget = { authorKey: string; kind: CircleLinkKind };

function creditableUser(
  userId: string | null | undefined,
  ownXUserId: string,
  users: ReadonlyMap<string, XUserRecord>,
): XUserRecord | undefined {
  return userId && userId !== ownXUserId ? users.get(userId) : undefined;
}

export function circleTargetFromAuthors(opts: {
  quotedAuthorId: string | null | undefined;
  replyUserId: string | null | undefined;
  ownXUserId: string;
  users: ReadonlyMap<string, XUserRecord>;
}): CircleTarget | null {
  const quoted = creditableUser(opts.quotedAuthorId, opts.ownXUserId, opts.users);
  if (quoted) return { authorKey: quoted.authorKey, kind: "quote" };
  const reply = creditableUser(opts.replyUserId, opts.ownXUserId, opts.users);
  return reply ? { authorKey: reply.authorKey, kind: "reply" } : null;
}
