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

describe("parseUserTweetsPage", () => {
  it("keeps originals, self-replies, and replies; drops retweets", () => {
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

  it("labels a quote as quote, not original", () => {
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

  it("tolerates an empty timeline", () => {
    const page = parseUserTweetsPage({ meta: { result_count: 0 } }, OWN_ID);
    assert.deepEqual(page.replies, []);
    assert.equal(page.nextToken, null);
  });
});

describe("pullOwnReplies", () => {
  it("takes one page of posts and passes since_id", async () => {
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
  });

  it("asks X for five tweets when the confirm target is five", async () => {
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

  it("does not walk a second page even when the first is short", async () => {
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

  it("marks completed when the timeline is exhausted below target", async () => {
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

  it("surfaces a first-page failure", async () => {
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

  it("never requests a later page so a mid-walk 429 cannot happen", async () => {
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

describe("resolveXUser", () => {
  it("returns id and protected flag", async () => {
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

  it("maps a missing user to x_user_not_found", async () => {
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
