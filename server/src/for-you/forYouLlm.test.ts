import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FOR_YOU_DIGEST_SYSTEM,
  FOR_YOU_SCOUT_ORIGINAL_SYSTEM,
  pickForYouActions,
  pickForYouScoutOriginal,
} from "./forYouLlm.ts";
import type { ForYouDigest } from "./forYouDigest.ts";
import type { ChatFn } from "../platform/llmJson.ts";

const digest: ForYouDigest = {
  agenda: "Find builders",
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
  memories: [
    {
      threadId: "mem-hit",
      author: "@builder",
      url: "https://x.com/builder/status/88",
      views: 140,
    },
  ],
  leftoverScout: [
    {
      id: "77",
      author: "@a",
      text: "who is hiring",
      url: "https://x.com/a/status/77",
    },
  ],
  skipped: [],
};

function fakeChat(
  content: string,
  capture?: { purposes: string[]; prompts?: string[] },
): ChatFn {
  return async (opts) => {
    capture?.purposes.push(opts.purpose ?? "");
    capture?.prompts?.push(
      opts.messages.map((message) => message.content).join("\n"),
    );
    return {
      ok: true,
      content,
      model: "deepseek-v4-flash",
      provider: "deepseek",
    };
  };
}

await describe("pickForYouActions", async () => {
  await it("asks for at least one original angle and never for post text", () => {
    assert.match(FOR_YOU_DIGEST_SYSTEM, /At least one kind=post/);
    assert.match(FOR_YOU_DIGEST_SYSTEM, /invite replies/);
    assert.match(FOR_YOU_DIGEST_SYSTEM, /names that angle or topic/);
    assert.match(FOR_YOU_DIGEST_SYSTEM, /never write post text/i);
    assert.match(FOR_YOU_DIGEST_SYSTEM, /Never write a draft/);
    assert.doesNotMatch(FOR_YOU_DIGEST_SYSTEM, /"draft"/);
    assert.doesNotMatch(FOR_YOU_DIGEST_SYSTEM, /voice card/i);
    assert.match(FOR_YOU_DIGEST_SYSTEM, /max 90 characters/);
    assert.match(FOR_YOU_DIGEST_SYSTEM, /second person/);
    assert.match(FOR_YOU_DIGEST_SYSTEM, /younger than 1 hour/);
    assert.match(FOR_YOU_DIGEST_SYSTEM, /AVOID_24H/);
    assert.match(FOR_YOU_DIGEST_SYSTEM, /100\+ views only/);
    assert.match(FOR_YOU_DIGEST_SYSTEM, /Under 100 views is a miss/);
    assert.match(FOR_YOU_DIGEST_SYSTEM, /kind=post is a NEW angle from the agenda/);
    assert.match(FOR_YOU_DIGEST_SYSTEM, /memory that already earned attention/);
    assert.doesNotMatch(FOR_YOU_DIGEST_SYSTEM, /LIVE_SCOUT/);
    assert.match(FOR_YOU_DIGEST_SYSTEM, /Do not name, rewrite/);
    assert.doesNotMatch(FOR_YOU_DIGEST_SYSTEM, /reply farm/i);
    assert.doesNotMatch(FOR_YOU_DIGEST_SYSTEM, /echoing BEST_24H/);
    assert.match(FOR_YOU_SCOUT_ORIGINAL_SYSTEM, /Topic from the agenda only/);
    assert.match(FOR_YOU_SCOUT_ORIGINAL_SYSTEM, /named other side/);
    assert.match(FOR_YOU_SCOUT_ORIGINAL_SYSTEM, /never write the post/i);
    assert.doesNotMatch(FOR_YOU_SCOUT_ORIGINAL_SYSTEM, /"draft"/);
    assert.doesNotMatch(FOR_YOU_SCOUT_ORIGINAL_SYSTEM, /LIVE_SCOUT/);
  });

  await it("parses a valid first pass", async () => {
    const capture = { purposes: [] as string[], prompts: [] as string[] };
    const result = await pickForYouActions({
      digest,
      chat: fakeChat(
        JSON.stringify({
          actions: [
            { kind: "post", why: "builder agenda has an open question" },
            {
              kind: "reply",
              why: "builder memory earned attention",
              targetId: "mem-hit",
              targetUrl: "https://x.com/builder/status/88",
            },
          ],
        }),
        capture,
      ),
    });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.actions.length, 2);
    assert.deepEqual(capture.purposes, ["for_you_digest"]);
    assert.doesNotMatch(capture.prompts[0] ?? "", /LIVE_SCOUT/);
    assert.doesNotMatch(capture.prompts[0] ?? "", /who is hiring/);
    assert.doesNotMatch(capture.prompts[0] ?? "", /\nVOICE\n/);
  });

  await it("drops draft text the model returns anyway", async () => {
    const result = await pickForYouActions({
      digest,
      chat: fakeChat(
        JSON.stringify({
          actions: [
            {
              kind: "post",
              why: "builder agenda has an open question",
              draft: "Who is hiring builders this week?",
            },
            {
              kind: "reply",
              why: "builder memory earned attention",
              draft: "Still true.",
              targetId: "mem-hit",
              targetUrl: "https://x.com/builder/status/88",
            },
          ],
        }),
      ),
    });
    assert.equal(result.ok, true);
    assert.equal(
      result.ok && result.actions.some((a) => Object.hasOwn(a, "draft")),
      false,
    );
  });

  await it("repairs invalid JSON", async () => {
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
            { kind: "post", why: "builder agenda has an open question" },
            {
              kind: "reply",
              why: "builder memory earned attention",
              targetId: "mem-hit",
              targetUrl: "https://x.com/builder/status/88",
            },
          ],
        }),
        model: "deepseek-v4-flash",
        provider: "deepseek",
      };
    };
    const result = await pickForYouActions({ digest, chat });
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.actions.length, 2);
    assert.deepEqual(capture.purposes, [
      "for_you_digest",
      "for_you_digest_repair",
    ]);
  });

  await it("repairs a first pass that has 2+ actions but no post", async () => {
    const capture = { purposes: [] as string[] };
    const noPost = JSON.stringify({
      actions: [
        {
          kind: "reply",
          why: "builder memory earned attention",
          targetId: "mem-hit",
          targetUrl: "https://x.com/builder/status/88",
        },
        {
          kind: "quote",
          why: "quote the winner",
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
            { kind: "post", why: "builder agenda has an open question" },
            {
              kind: "reply",
              why: "builder memory earned attention",
              targetId: "mem-hit",
              targetUrl: "https://x.com/builder/status/88",
            },
          ],
        }),
        model: "deepseek-v4-flash",
        provider: "deepseek",
      };
    };
    const result = await pickForYouActions({ digest, chat });
    assert.equal(result.ok, true);
    assert.equal(
      result.ok && result.actions.some((a) => a.kind === "post"),
      true,
    );
    assert.deepEqual(capture.purposes, [
      "for_you_digest",
      "for_you_digest_repair",
    ]);
  });

  await it("rejects a repair pass that still has no post", async () => {
    const capture = { purposes: [] as string[] };
    const noPost = JSON.stringify({
      actions: [
        {
          kind: "reply",
          why: "builder memory earned attention",
          targetId: "mem-hit",
          targetUrl: "https://x.com/builder/status/88",
        },
        {
          kind: "quote",
          why: "quote the winner",
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
    const result = await pickForYouActions({ digest, chat });
    assert.equal(result.ok, false);
    assert.deepEqual(capture.purposes, [
      "for_you_digest",
      "for_you_digest_repair",
    ]);
  });

  await it("rejects a repair pass that returns a single post", async () => {
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
            { kind: "post", why: "builder agenda has an open question" },
          ],
        }),
        model: "deepseek-v4-flash",
        provider: "deepseek",
      };
    };
    const result = await pickForYouActions({ digest, chat });
    assert.equal(result.ok, false);
    assert.deepEqual(capture.purposes, [
      "for_you_digest",
      "for_you_digest_repair",
    ]);
  });

  await it("reports an LLM failure without actions", async () => {
    const chat: ChatFn = async () => ({
      ok: false,
      status: 429,
      error: "rate_limited",
      message: "Too many requests",
    });
    const result = await pickForYouActions({ digest, chat });
    assert.equal(result.ok, false);
  });

  await it("reports a repair-call LLM failure as an error", async () => {
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
    const result = await pickForYouActions({ digest, chat });
    assert.equal(result.ok, false);
    assert.equal(result.ok || result.error, "Upstream blew up");
    assert.deepEqual(capture.purposes, [
      "for_you_digest",
      "for_you_digest_repair",
    ]);
  });
});

await describe("pickForYouScoutOriginal", async () => {
  await it("returns one post angle with no draft text", async () => {
    const capture = { purposes: [] as string[] };
    const result = await pickForYouScoutOriginal({
      digest,
      chat: fakeChat(
        JSON.stringify({
          actions: [
            {
              kind: "post",
              why: "Ask builders what they cut first this week",
              draft: "What did you cut first?",
            },
          ],
        }),
        capture,
      ),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.actions, [
      { kind: "post", why: "Ask builders what they cut first this week" },
    ]);
    assert.deepEqual(capture.purposes, ["for_you_scout_original"]);
  });
});
