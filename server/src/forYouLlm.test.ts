import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  draftForYouActions,
  draftForYouExtraPosts,
  FOR_YOU_DIGEST_SYSTEM,
} from "./forYouLlm.ts";
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
  it("asks for at least one original that invites a reply", () => {
    assert.match(FOR_YOU_DIGEST_SYSTEM, /At least one kind=post/);
    assert.match(FOR_YOU_DIGEST_SYSTEM, /invite a reply/);
    assert.match(FOR_YOU_DIGEST_SYSTEM, /named other side/);
    assert.doesNotMatch(FOR_YOU_DIGEST_SYSTEM, /reply farm/i);
  });

  it("parses a valid first pass", async () => {
    const capture = { purposes: [] as string[] };
    const result = await draftForYouActions({
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
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.drafts.length, 2);
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
    const result = await draftForYouActions({ digest, chat });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.drafts.length, 2);
    assert.deepEqual(capture.purposes, [
      "for_you_digest",
      "for_you_digest_repair",
    ]);
  });

  it("repairs a first pass that has 2+ actions but no post", async () => {
    const capture = { purposes: [] as string[] };
    const noPost = JSON.stringify({
      actions: [
        {
          kind: "reply",
          why: "leftover scout",
          targetId: "77",
          targetUrl: "https://x.com/a/status/77",
        },
        {
          kind: "quote",
          why: "quote the winner",
          draft: "still true",
          targetId: "10",
          targetUrl: "https://x.com/desk/status/10",
        },
      ],
    });
    let calls = 0;
    const chat: ChatFn = async (opts) => {
      capture.purposes.push(opts.purpose ?? "");
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          content: noPost,
          model: "deepseek-v4-flash",
          provider: "deepseek",
        };
      }
      return {
        ok: true,
        content: JSON.stringify({
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
        model: "deepseek-v4-flash",
        provider: "deepseek",
      };
    };
    const result = await draftForYouActions({ digest, chat });
    assert.equal(result.ok, true);
    assert.equal(
      result.ok && result.drafts.some((a) => a.kind === "post"),
      true,
    );
    assert.deepEqual(capture.purposes, [
      "for_you_digest",
      "for_you_digest_repair",
    ]);
  });

  it("rejects a repair pass that still has no post", async () => {
    const capture = { purposes: [] as string[] };
    const noPost = JSON.stringify({
      actions: [
        {
          kind: "reply",
          why: "leftover scout",
          targetId: "77",
          targetUrl: "https://x.com/a/status/77",
        },
        {
          kind: "quote",
          why: "quote the winner",
          draft: "still true",
          targetId: "10",
          targetUrl: "https://x.com/desk/status/10",
        },
      ],
    });
    const chat: ChatFn = async (opts) => {
      capture.purposes.push(opts.purpose ?? "");
      return {
        ok: true,
        content: noPost,
        model: "deepseek-v4-flash",
        provider: "deepseek",
      };
    };
    const result = await draftForYouActions({ digest, chat });
    assert.equal(result.ok, false);
    assert.deepEqual(capture.purposes, [
      "for_you_digest",
      "for_you_digest_repair",
    ]);
  });

  it("rejects a repair pass that returns a single post", async () => {
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
            { kind: "post", why: "900 views on the recap", draft: "Another recap." },
          ],
        }),
        model: "deepseek-v4-flash",
        provider: "deepseek",
      };
    };
    const result = await draftForYouActions({ digest, chat });
    assert.equal(result.ok, false);
    assert.deepEqual(capture.purposes, [
      "for_you_digest",
      "for_you_digest_repair",
    ]);
  });

  it("reports an LLM failure without drafts", async () => {
    const chat: ChatFn = async () => ({
      ok: false,
      status: 429,
      error: "rate_limited",
      message: "Too many requests",
    });
    const result = await draftForYouActions({ digest, chat });
    assert.equal(result.ok, false);
  });

  it("reports a repair-call LLM failure as an error", async () => {
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
        ok: false,
        status: 500,
        error: "upstream",
        message: "Upstream blew up",
      };
    };
    const result = await draftForYouActions({ digest, chat });
    assert.equal(result.ok, false);
    assert.equal(result.ok || result.error, "Upstream blew up");
    assert.deepEqual(capture.purposes, [
      "for_you_digest",
      "for_you_digest_repair",
    ]);
  });
});

describe("draftForYouExtraPosts", () => {
  it("keeps three unique originals", async () => {
    const capture = { purposes: [] as string[] };
    const result = await draftForYouExtraPosts({
      digest,
      chat: fakeChat(
        JSON.stringify({
          actions: [
            { kind: "post", why: "900 views", draft: "What would you cut?" },
            { kind: "reply", why: "scout", targetId: "77" },
            { kind: "post", why: "4 replies", draft: "Is the other side wrong?" },
            { kind: "post", why: "20 likes", draft: "I'll take the under." },
          ],
        }),
        capture,
      ),
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.drafts.length, 3);
    assert.ok(result.ok && result.drafts.every((d) => d.kind === "post"));
    assert.deepEqual(capture.purposes, ["for_you_extra"]);
  });

  it("repairs when the first pass is short", async () => {
    const capture = { purposes: [] as string[] };
    let calls = 0;
    const chat: ChatFn = async (opts) => {
      capture.purposes.push(opts.purpose ?? "");
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          content: JSON.stringify({
            actions: [{ kind: "post", why: "900 views", draft: "One." }],
          }),
          model: "deepseek-v4-flash",
          provider: "deepseek",
        };
      }
      return {
        ok: true,
        content: JSON.stringify({
          actions: [
            { kind: "post", why: "900 views", draft: "What would you cut?" },
            { kind: "post", why: "4 replies", draft: "Is the other side wrong?" },
            { kind: "post", why: "20 likes", draft: "I'll take the under." },
          ],
        }),
        model: "deepseek-v4-flash",
        provider: "deepseek",
      };
    };
    const result = await draftForYouExtraPosts({ digest, chat });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.drafts.length, 3);
    assert.deepEqual(capture.purposes, [
      "for_you_extra",
      "for_you_extra_repair",
    ]);
  });

  it("rejects a repair pass that is still short", async () => {
    const capture = { purposes: [] as string[] };
    let calls = 0;
    const chat: ChatFn = async (opts) => {
      capture.purposes.push(opts.purpose ?? "");
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          content: JSON.stringify({
            actions: [{ kind: "post", why: "900 views", draft: "One." }],
          }),
          model: "deepseek-v4-flash",
          provider: "deepseek",
        };
      }
      return {
        ok: true,
        content: JSON.stringify({
          actions: [{ kind: "post", why: "900 views", draft: "Two." }],
        }),
        model: "deepseek-v4-flash",
        provider: "deepseek",
      };
    };
    const result = await draftForYouExtraPosts({ digest, chat });
    assert.equal(result.ok, false);
    assert.equal(result.ok || result.exhausted, true);
    assert.equal(
      result.ok || result.error,
      "repair did not return 3 originals",
    );
    assert.deepEqual(capture.purposes, [
      "for_you_extra",
      "for_you_extra_repair",
    ]);
  });
});
