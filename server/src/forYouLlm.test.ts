import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { draftForYouActions } from "./forYouLlm.ts";
import type { ForYouDigest } from "./forYouDigest.ts";
import type { ChatFn } from "./voiceLlm.ts";

const digest: ForYouDigest = {
  agenda: "Find builders",
  voice: {
    tone: "short and dry",
    typicalLength: "one sentence",
    habits: ["lowercase"],
    neverDo: ["hype"],
    examples: ["shipped", "shipped it", "ok"],
  },
  best: [
    {
      id: "10",
      kind: "original",
      text: "shipped",
      url: "https://x.com/desk/status/10",
      views: 900,
      likes: 20,
      replies: 4,
      retweets: 2,
      postedAt: "2026-08-18T00:00:00.000Z",
    },
  ],
  worst: [],
  recentOriginals: [],
  recentReplies: [],
  recentQuotes: [],
  memories: [],
  leftoverScout: [
    {
      id: "77",
      author: "@a",
      text: "who is hiring",
      url: "https://x.com/a/status/77",
    },
  ],
};

function fakeChat(content: string, capture?: { purposes: string[] }): ChatFn {
  return async (opts) => {
    capture?.purposes.push(opts.purpose ?? "");
    return {
      ok: true,
      content,
      model: "deepseek-v4-flash",
      provider: "deepseek",
    };
  };
}

describe("draftForYouActions", () => {
  it("parses a valid first pass", async () => {
    const capture = { purposes: [] as string[] };
    const actions = await draftForYouActions({
      digest,
      chat: fakeChat(
        JSON.stringify({
          actions: [
            { kind: "post", why: "900 views on the recap", draft: "Another recap." },
            {
              kind: "reply",
              why: "leftover scout",
              targetId: "77",
              targetUrl: "https://x.com/a/status/77",
            },
          ],
        }),
        capture,
      ),
    });
    assert.equal(actions.length, 2);
    assert.deepEqual(capture.purposes, ["for_you_digest"]);
  });

  it("repairs invalid JSON", async () => {
    const capture = { purposes: [] as string[] };
    let calls = 0;
    const chat: ChatFn = async (opts) => {
      capture.purposes.push(opts.purpose ?? "");
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          content: "not json",
          model: "deepseek-v4-flash",
          provider: "deepseek",
        };
      }
      return {
        ok: true,
        content: JSON.stringify({
          actions: [
            { kind: "post", why: "900 views", draft: "Recap." },
            {
              kind: "quote",
              why: "quote the winner",
              draft: "still true",
              targetId: "10",
              targetUrl: "https://x.com/desk/status/10",
            },
          ],
        }),
        model: "deepseek-v4-flash",
        provider: "deepseek",
      };
    };
    const actions = await draftForYouActions({ digest, chat });
    assert.equal(actions.length, 2);
    assert.deepEqual(capture.purposes, [
      "for_you_digest",
      "for_you_digest_repair",
    ]);
  });
});
