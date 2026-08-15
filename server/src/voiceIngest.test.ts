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
  it("keeps only genuine replies to other people", () => {
    const page = parseUserTweetsPage(
      {
        data: [
          tweet("1", { reply: true }),
          tweet("2"), // original — dropped
          tweet("3", { reply: true, toUser: OWN_ID }), // self-thread — dropped
          { id: "4" }, // malformed — dropped
          tweet("5", { reply: true, conversation: "conv-x" }),
        ],
        meta: { next_token: "tok", newest_id: "5" },
      },
      OWN_ID,
    );
    assert.deepEqual(
      page.replies.map((r) => r.id),
      ["1", "5"],
    );
    assert.equal(page.replies[0]?.inReplyToId, "p1");
    assert.equal(page.replies[1]?.conversationId, "conv-x");
    assert.equal(page.nextToken, "tok");
    assert.equal(page.newestId, "5");
  });

  it("tolerates an empty timeline", () => {
    const page = parseUserTweetsPage({ meta: { result_count: 0 } }, OWN_ID);
    assert.deepEqual(page.replies, []);
    assert.equal(page.nextToken, null);
  });
});

describe("pullOwnReplies", () => {
  it("paginates until the reply target and passes since_id", async () => {
    const calls: Array<Record<string, string | undefined>> = [];
    const get: XApiGetFn = async (opts) => {
      calls.push(opts.query ?? {});
      const pageNo = calls.length;
      return {
        ok: true,
        status: 200,
        json: {
          data: Array.from({ length: 60 }, (_, i) =>
            tweet(`${pageNo}-${i}`, { reply: true }),
          ),
          meta: { next_token: pageNo < 3 ? `t${pageNo}` : undefined, newest_id: "900" },
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
      assert.equal(result.pages, 2);
    }
    assert.equal(calls[0]?.since_id, "555");
    assert.equal(calls[1]?.pagination_token, "t1");
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

  it("keeps partial progress when a later page fails", async () => {
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
    if (result.ok) assert.equal(result.replies.length, 1);
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
