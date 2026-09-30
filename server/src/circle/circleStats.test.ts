import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Interaction } from "../desk/interactionStore.ts";
import { buildCircle } from "./circleStats.ts";
import type { CircleLink } from "./circleStore.ts";
import type { XProfile } from "./xProfiles.ts";

function row(author: string, threadId: string, at: string, replyId?: string): Interaction {
  return {
    threadId,
    author,
    authorKey: author.replace(/^@+/, "").toLowerCase(),
    at,
    source: "manual",
    userId: "u1",
    replyId,
  };
}

function link(authorKey: string, postId: string, kind: CircleLink["kind"], at: string): CircleLink {
  return { authorKey, postId, kind, at };
}

await describe("buildCircle", async () => {
  await it("ranks by score, then most recent, then handle", () => {
    const circle = buildCircle({
      selfHandle: "me",
      history: [
        row("@Alice", "t1", "2026-09-01T00:00:00.000Z", "r1"),
        row("@Alice", "t2", "2026-09-02T00:00:00.000Z", "r2"),
        row("@bob", "t3", "2026-09-03T00:00:00.000Z", "r3"),
        row("@carol", "t4", "2026-09-05T00:00:00.000Z", "r4"),
        row("@dave", "t5", "2026-09-05T00:00:00.000Z", "r5"),
      ],
      links: [link("bob", "q1", "quote", "2026-09-04T00:00:00.000Z")],
      profiles: [],
    });
    assert.deepEqual(
      circle.members.map((m) => [m.handle, m.replies, m.quotes, m.score]),
      [
        ["bob", 1, 1, 3],
        ["Alice", 2, 0, 2],
        ["carol", 1, 0, 1],
        ["dave", 1, 0, 1],
      ],
    );
    assert.equal(circle.members[0]?.lastAt, "2026-09-04T00:00:00.000Z");
    assert.deepEqual(circle.totals, { replies: 5, quotes: 1, people: 4 });
  });

  await it("counts a reply once when history and links share the post id", () => {
    const circle = buildCircle({
      selfHandle: null,
      history: [row("@alice", "t1", "2026-09-01T00:00:00.000Z", "r1")],
      links: [
        link("alice", "r1", "reply", "2026-09-01T00:00:00.000Z"),
        link("alice", "r2", "reply", "2026-09-06T00:00:00.000Z"),
      ],
      profiles: [],
    });
    assert.equal(circle.members.length, 1);
    assert.equal(circle.members[0]?.replies, 2);
    assert.equal(circle.members[0]?.lastAt, "2026-09-06T00:00:00.000Z");
  });

  await it("attributes a shared reply post id to its history author", () => {
    const circle = buildCircle({
      selfHandle: null,
      history: [row("@bob", "t1", "2026-09-01T00:00:00.000Z", "r1")],
      links: [link("alice", "r1", "reply", "2026-09-01T00:00:00.000Z")],
      profiles: [],
    });
    assert.deepEqual(circle.members.map((member) => [member.handle, member.replies]), [["bob", 1]]);
    assert.deepEqual(circle.totals, { replies: 1, quotes: 0, people: 1 });
  });

  await it("counts a quoted post as a quote even when a desk row points at it", () => {
    const circle = buildCircle({
      selfHandle: null,
      history: [row("@alice", "t1", "2026-09-01T00:00:00.000Z", "q1")],
      links: [link("alice", "q1", "quote", "2026-09-01T00:00:00.000Z")],
      profiles: [],
    });
    assert.deepEqual(
      circle.members.map((m) => [m.replies, m.quotes, m.score]),
      [[0, 1, 2]],
    );
  });

  await it("excludes self, unknown, and numeric-only authors", () => {
    const circle = buildCircle({
      selfHandle: "@Me",
      history: [
        row("@me", "t1", "2026-09-01T00:00:00.000Z", "r1"),
        row("@unknown", "t2", "2026-09-01T00:00:00.000Z", "r2"),
        row("@12345", "t3", "2026-09-01T00:00:00.000Z", "r3"),
        row("@real", "t4", "2026-09-01T00:00:00.000Z", "r4"),
      ],
      links: [link("me", "q1", "quote", "2026-09-02T00:00:00.000Z")],
      profiles: [],
    });
    assert.deepEqual(circle.members.map((m) => m.handle), ["real"]);
    assert.deepEqual(circle.totals, { replies: 1, quotes: 0, people: 1 });
  });

  await it("applies the limit after counting people and fills profile fields", () => {
    const history = Array.from({ length: 5 }, (_, i) =>
      row(`@user${i}`, `t${i}`, `2026-09-0${i + 1}T00:00:00.000Z`, `r${i}`),
    );
    const profiles: XProfile[] = [
      {
        authorKey: "user4",
        handle: "User4",
        name: "User Four",
        avatarUrl: "https://pbs.twimg.com/profile_images/4/a_400x400.jpg",
        updatedAt: "2026-09-10T00:00:00.000Z",
      },
    ];
    const circle = buildCircle({ selfHandle: null, history, links: [], profiles, limit: 2 });
    assert.equal(circle.totals.people, 5);
    assert.deepEqual(circle.members, [
      {
        handle: "User4",
        name: "User Four",
        avatarUrl: "https://pbs.twimg.com/profile_images/4/a_400x400.jpg",
        replies: 1,
        quotes: 0,
        score: 1,
        lastAt: "2026-09-05T00:00:00.000Z",
      },
      {
        handle: "user3",
        name: null,
        avatarUrl: null,
        replies: 1,
        quotes: 0,
        score: 1,
        lastAt: "2026-09-04T00:00:00.000Z",
      },
    ]);
  });
});
