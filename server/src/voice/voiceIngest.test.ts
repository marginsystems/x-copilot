import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseUserTweetsPage,
  pullOwnReplies,
  resolveXUser,
  type XApiGetFn,
} from "./voiceIngest.ts";

const OWN_ID = "42";

function tweet(
  id: string,
  opts?: {
    reply?: boolean;
    toUser?: string;
    conversation?: string;
    text?: string;
  },
) {
  return {
    id,
    text: opts?.text ?? `tweet ${id}`,
    conversation_id: opts?.conversation ?? `c${id}`,
    created_at: "2026-08-10T12:00:00.000Z",
    ...(opts?.reply
      ? {
          in_reply_to_user_id: opts.toUser ?? "77",
          referenced_tweets: [{ type: "replied_to", id: `p${id}` }],
        }
      : {}),
  };
}

await describe("parseUserTweetsPage", async () => {
  await it("keeps originals, self-replies, and replies; drops retweets", () => {
    const page = parseUserTweetsPage(
      {
        data: [
          tweet("1", { reply: true }),
          tweet("2"),
          tweet("3", { reply: true, toUser: OWN_ID }),
          { id: "4" },
          tweet("5", { reply: true, conversation: "conv-x" }),
          {
            id: "6",
            text: "rt",
            referenced_tweets: [{ type: "retweeted", id: "other" }],
          },
        ],
        meta: { next_token: "tok", newest_id: "5" },
      },
      OWN_ID,
    );
    assert.deepEqual(
      page.replies.map((r) => r.id),
      ["1", "2", "3", "5"],
    );
    assert.equal(page.replies[0]?.inReplyToId, "p1");
    assert.equal(page.replies[1]?.inReplyToId, null);
    assert.equal(page.replies[2]?.inReplyToId, "p3");
    assert.equal(page.replies[3]?.conversationId, "conv-x");
    assert.equal(page.nextToken, "tok");
    assert.equal(page.newestId, "5");
    assert.equal(page.replies[1]?.kind, "original");
    assert.equal(page.replies[0]?.kind, "reply");
  });

  await it("labels a quote as quote, not original", () => {
    const page = parseUserTweetsPage(
      {
        data: [
          {
            id: "q1",
            text: "sharper take",
            created_at: "2026-08-10T12:00:00.000Z",
            referenced_tweets: [{ type: "quoted", id: "p9" }],
          },
        ],
      },
      OWN_ID,
    );
    assert.equal(page.replies[0]?.kind, "quote");
    assert.equal(page.replies[0]?.inReplyToId, null);
  });

  await it("tolerates an empty timeline", () => {
    const page = parseUserTweetsPage({ meta: { result_count: 0 } }, OWN_ID);
    assert.deepEqual(page.replies, []);
    assert.deepEqual(page.profiles, []);
    assert.equal(page.nextToken, null);
  });

  await it("resolves reply and quote targets and profiles from includes", () => {
    const page = parseUserTweetsPage(
      {
        data: [
          tweet("1", { reply: true, toUser: "77" }),
          {
            id: "2",
            text: "quote take",
            created_at: "2026-08-10T12:00:00.000Z",
            referenced_tweets: [{ type: "quoted", id: "p9" }],
          },
          tweet("3", { reply: true, toUser: OWN_ID }),
          tweet("4", { reply: true, toUser: "404" }),
          {
            id: "5",
            text: "quoting myself",
            referenced_tweets: [{ type: "quoted", id: "own-1" }],
          },
          tweet("6"),
        ],
        includes: {
          users: [
            {
              id: "77",
              username: "Alice",
              name: "Alice A",
              profile_image_url: "https://pbs.twimg.com/profile_images/7/a_normal.jpg",
            },
            { id: "88", username: "bob", name: "Bob" },
            { id: OWN_ID, username: "me", name: "Me" },
          ],
          tweets: [
            { id: "p9", author_id: "88", text: "original" },
            { id: "own-1", author_id: OWN_ID, text: "mine" },
          ],
        },
      },
      OWN_ID,
      "2026-09-30T00:00:00.000Z",
    );
    assert.deepEqual(
      page.replies.map((r) => [r.id, r.inReplyToUserId, r.circleTarget]),
      [
        ["1", "77", { authorKey: "alice", kind: "reply" }],
        ["2", null, { authorKey: "bob", kind: "quote" }],
        ["3", OWN_ID, null],
        ["4", "404", null],
        ["5", null, null],
        ["6", null, null],
      ],
    );
    assert.deepEqual(page.profiles, [
      {
        authorKey: "alice",
        handle: "Alice",
        name: "Alice A",
        avatarUrl: "https://pbs.twimg.com/profile_images/7/a_400x400.jpg",
        updatedAt: "2026-09-30T00:00:00.000Z",
      },
      {
        authorKey: "bob",
        handle: "bob",
        name: "Bob",
        avatarUrl: null,
        updatedAt: "2026-09-30T00:00:00.000Z",
      },
    ]);
  });
});

await describe("pullOwnReplies", async () => {
  await it("takes one page of posts and passes since_id", async () => {
    const calls: Array<Record<string, string | undefined>> = [];
    const get: XApiGetFn = async (opts) => {
      calls.push(opts.query ?? {});
      return {
        ok: true,
        status: 200,
        json: {
          data: Array.from({ length: 100 }, (_, i) => tweet(`${i}`)),
          meta: { next_token: "more", newest_id: "900" },
        },
      };
    };
    const result = await pullOwnReplies({
      xUserId: OWN_ID,
      sinceId: "555",
      deps: { get },
    });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.replies.length, 100);
      assert.equal(result.newestId, "900");
      assert.equal(result.pages, 1);
      assert.equal(result.completed, true);
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.since_id, "555");
    assert.equal(calls[0]?.max_results, "100");
    assert.equal(
      calls[0]?.expansions,
      "in_reply_to_user_id,referenced_tweets.id",
    );
    assert.equal(
      calls[0]?.["tweet.fields"],
      "author_id,conversation_id,created_at,in_reply_to_user_id,referenced_tweets",
    );
    assert.equal(calls[0]?.["user.fields"], "username,name,profile_image_url");
  });

  await it("resolves quote targets from the referenced tweets returned by the pull", async () => {
    const get: XApiGetFn = async (opts) => {
      assert.equal(
        opts.query?.expansions,
        "in_reply_to_user_id,referenced_tweets.id",
      );
      assert.equal(
        opts.query?.["tweet.fields"],
        "author_id,conversation_id,created_at,in_reply_to_user_id,referenced_tweets",
      );
      return {
        ok: true,
        status: 200,
        json: {
          data: [
            {
              id: "q1",
              text: "quote take",
              referenced_tweets: [{ type: "quoted", id: "p9" }],
            },
          ],
          includes: {
            tweets: [{ id: "p9", author_id: "88" }],
            users: [{ id: "88", username: "bob", name: "Bob" }],
          },
          meta: { newest_id: "q1" },
        },
      };
    };
    const result = await pullOwnReplies({ xUserId: OWN_ID, deps: { get } });
    assert.ok(result.ok);
    if (result.ok) {
      assert.deepEqual(result.replies[0]?.circleTarget, {
        authorKey: "bob",
        kind: "quote",
      });
    }
  });

  await it("asks X for five tweets when the confirm target is five", async () => {
    const calls: Array<Record<string, string | undefined>> = [];
    const get: XApiGetFn = async (opts) => {
      calls.push(opts.query ?? {});
      return {
        ok: true,
        status: 200,
        json: { data: [tweet("1")], meta: { newest_id: "1" } },
      };
    };
    const result = await pullOwnReplies({
      xUserId: OWN_ID,
      targetReplies: 5,
      deps: { get },
    });
    assert.ok(result.ok);
    assert.equal(calls[0]?.max_results, "5");
  });

  await it("does not walk a second page even when the first is short", async () => {
    let n = 0;
    const get: XApiGetFn = async () => {
      n += 1;
      return {
        ok: true,
        status: 200,
        json: {
          data: [tweet("1"), tweet("2")],
          meta: { next_token: "t1", newest_id: "1" },
        },
      };
    };
    const result = await pullOwnReplies({ xUserId: OWN_ID, deps: { get } });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(n, 1);
      assert.equal(result.pages, 1);
      assert.equal(result.replies.length, 2);
      // Page cap stopped the walk below target with a next_token still
      // pending: not completed, so callers keep the previous since_id.
      assert.equal(result.completed, false);
    }
  });

  await it("marks completed when the timeline is exhausted below target", async () => {
    const get: XApiGetFn = async () => ({
      ok: true,
      status: 200,
      json: {
        data: [tweet("1"), tweet("2")],
        meta: { newest_id: "2" },
      },
    });
    const result = await pullOwnReplies({ xUserId: OWN_ID, deps: { get } });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.completed, true);
    }
  });

  await it("surfaces a first-page failure", async () => {
    const get: XApiGetFn = async () => ({
      ok: false,
      status: 429,
      error: "rate_limited",
      message: "X API HTTP 429",
    });
    const result = await pullOwnReplies({ xUserId: OWN_ID, deps: { get } });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "rate_limited");
  });

  await it("never requests a later page so a mid-walk 429 cannot happen", async () => {
    let n = 0;
    const get: XApiGetFn = async () => {
      n += 1;
      if (n === 1) {
        return {
          ok: true,
          status: 200,
          json: {
            data: [tweet("1", { reply: true })],
            meta: { next_token: "t1", newest_id: "1" },
          },
        };
      }
      return { ok: false, status: 429, error: "rate_limited", message: "429" };
    };
    const result = await pullOwnReplies({ xUserId: OWN_ID, deps: { get } });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(n, 1);
      assert.equal(result.replies.length, 1);
      assert.equal(result.completed, false);
    }
  });
});

await describe("resolveXUser", async () => {
  await it("returns id and protected flag", async () => {
    const get: XApiGetFn = async () => ({
      ok: true,
      status: 200,
      json: { data: { id: "42", username: "margin", protected: true } },
    });
    const result = await resolveXUser("@margin", { get });
    assert.deepEqual(result, {
      ok: true,
      id: "42",
      username: "margin",
      protected: true,
    });
  });

  await it("maps a missing user to x_user_not_found", async () => {
    const get: XApiGetFn = async () => ({
      ok: true,
      status: 200,
      json: { errors: [{ title: "Not Found Error" }] },
    });
    const result = await resolveXUser("ghost", { get });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "x_user_not_found");
  });
});
