import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage } from "./deepseek.js";
import {
  FALLBACK_STANCES,
  cleanDraft,
  extractJsonObject,
  generateVoiceCard,
  parseVerifyJson,
  parseStanceOptions,
  parseVoiceCardJson,
  proposeStances,
  suggestReply,
  verifyReplyEdit,
  type ChatFn,
} from "./voiceLlm.ts";

const CARD_JSON = JSON.stringify({
  tone: "Dry, direct, a little playful.",
  typicalLength: "one short sentence, 8-20 words",
  habits: ["lowercase openers", "asks one question"],
  neverDo: ["hashtags", "exclamation stacks"],
  examples: ["ship it", "what broke first?", "same here, sqlite all the way"],
});

function fakeChat(
  content: string,
  capture?: { purpose?: string; messages?: ChatMessage[] },
): ChatFn {
  return async (opts) => {
    if (capture) {
      capture.purpose = opts.purpose;
      capture.messages = opts.messages;
    }
    return {
      ok: true,
      content,
      model: "deepseek-v4-flash",
      provider: "deepseek",
    };
  };
}

describe("voice card parsing", () => {
  it("parses a fenced card", () => {
    const card = parseVoiceCardJson("```json\n" + CARD_JSON + "\n```");
    assert.equal(card?.tone, "Dry, direct, a little playful.");
    assert.equal(card?.examples.length, 3);
  });

  it("accepts snake_case keys", () => {
    const card = parseVoiceCardJson(
      JSON.stringify({
        tone: "warm",
        typical_length: "short",
        habits: [],
        never_do: ["emoji"],
        examples: ["a", "b", "c"],
      }),
    );
    assert.equal(card?.typicalLength, "short");
    assert.deepEqual(card?.neverDo, ["emoji"]);
  });

  it("rejects a card without enough examples", () => {
    assert.equal(
      parseVoiceCardJson(JSON.stringify({ tone: "x", examples: ["one"] })),
      null,
    );
    assert.equal(extractJsonObject("no json here"), null);
  });
});

describe("generateVoiceCard", () => {
  it("tags usage as voice_card and returns the parsed card", async () => {
    const capture: { purpose?: string } = {};
    const result = await generateVoiceCard({
      handle: "margin",
      replies: [
        { id: "1", text: "ship it", conversationId: "c1", postedAt: null, source: "api" },
      ],
      chat: fakeChat(CARD_JSON, capture),
    });
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.card.habits.length, 2);
    assert.equal(capture.purpose, "voice_card");
  });
});

describe("suggestReply", () => {
  it("tags usage as reply_suggest and strips wrapping quotes", async () => {
    const capture: { purpose?: string } = {};
    const result = await suggestReply({
      cardJson: CARD_JSON,
      thread: { author: "@dev", text: "we moved everything to sqlite" },
      chat: fakeChat('"same here, sqlite all the way. what broke first?"', capture),
    });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.draft, "same here, sqlite all the way. what broke first?");
    }
    assert.equal(capture.purpose, "reply_suggest");
  });

  it("strips em dashes from a draft", async () => {
    const result = await suggestReply({
      cardJson: CARD_JSON,
      thread: { author: "@dev", text: "the loop is the work" },
      chat: fakeChat("The tool was never the bottleneck \u2014 the loop is."),
    });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.draft.includes("\u2014"), false);
      assert.match(result.draft, /bottleneck/i);
    }
  });

  it("rejects a draft that stays on the this-isn-t template", async () => {
    const result = await suggestReply({
      cardJson: CARD_JSON,
      thread: { author: "@dev", text: "tools vs process" },
      chat: fakeChat("This isn't a tooling problem. It's a loop problem."),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "draft_slop");
  });

  it("rejects an em-dash if-then draft as slop", async () => {
    const result = await suggestReply({
      cardJson: CARD_JSON,
      thread: { author: "@dev", text: "speed vs process" },
      chat: fakeChat("If you want speed \u2014 then cut process."),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "draft_slop");
  });

  it("rescues a trope draft on retry and returns the clean retry", async () => {
    let call = 0;
    const chat: ChatFn = async () => {
      call += 1;
      return {
        ok: true,
        content:
          call === 1
            ? "If you want speed, then cut process."
            : "Cut process, ship faster.",
        model: "deepseek-v4-flash",
        provider: "deepseek",
      };
    };
    const result = await suggestReply({
      cardJson: CARD_JSON,
      thread: { author: "@dev", text: "speed vs process" },
      chat,
    });
    assert.equal(call, 2);
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.draft, "Cut process, ship faster.");
      assert.equal(result.model, "deepseek-v4-flash");
    }
  });

  it("propagates a retry failure instead of masking it as draft slop", async () => {
    let call = 0;
    const chat: ChatFn = async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          content: "If you want speed, then cut process.",
          model: "deepseek-v4-flash",
          provider: "deepseek",
        };
      }
      return {
        ok: false,
        error: "upstream_quota",
        message: "DeepSeek quota hit.",
      };
    };
    const result = await suggestReply({
      cardJson: CARD_JSON,
      thread: { author: "@dev", text: "speed vs process" },
      chat,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, "upstream_quota");
      assert.equal(result.message, "DeepSeek quota hit.");
    }
  });

  it("cleans fenced drafts and caps length", () => {
    assert.equal(cleanDraft("```\nhello there\n```"), "hello there");
    assert.equal(cleanDraft(`“smart quotes”`), "smart quotes");
    assert.equal(cleanDraft("x".repeat(400)).length, 280);
  });

  it("injects the chosen stance into the draft prompt", async () => {
    const capture: { purpose?: string; messages?: ChatMessage[] } = {};
    const result = await suggestReply({
      cardJson: CARD_JSON,
      thread: { author: "@dev", text: "the tool is never the bottleneck" },
      stance: "The loop is the tax",
      chat: fakeChat("The loop between research and shipping is the real tax.", capture),
    });
    assert.ok(result.ok);
    const userMsg = capture.messages?.find((m) => m.role === "user");
    assert.ok(userMsg);
    assert.match(userMsg.content, /Take this side/);
    assert.ok(userMsg.content.includes("The loop is the tax"));
  });
});

describe("proposeStances", () => {
  it("skips the picker on a fact add", async () => {
    const result = await proposeStances({
      thread: {
        author: "@dev",
        text: "sqlite 3.46 shipped",
        threadKind: "fact_add",
      },
      chat: fakeChat('{"options":["should never run"]}'),
    });
    assert.deepEqual(result, { needed: false, options: [] });
  });

  it("returns 2-3 sides for a sharp opinion", async () => {
    const capture: { purpose?: string } = {};
    const result = await proposeStances({
      thread: {
        author: "@dev",
        text: "the tool is never the bottleneck",
        threadKind: "sharp_opinion",
      },
      chat: fakeChat(
        '{"options":["The loop is the tax","The tool still matters","Ask what they measure"]}',
        capture,
      ),
    });
    assert.equal(result.needed, true);
    assert.equal(result.options.length, 3);
    assert.equal(capture.purpose, "reply_stances");
  });

  it("parses stance JSON and drops empties", () => {
    assert.deepEqual(parseStanceOptions('{"options":["Agree","", "Push back"]}'), [
      "Agree",
      "Push back",
    ]);
    assert.deepEqual(parseStanceOptions("nope"), []);
  });

  it("falls back to generic sides when the model finds no side on an opinion post", async () => {
    const result = await proposeStances({
      thread: {
        author: "@dev",
        text: "just reporting a fix",
        threadKind: "sharp_opinion",
      },
      chat: fakeChat('{"options":[]}'),
    });
    assert.equal(result.needed, true);
    assert.deepEqual(result.options, FALLBACK_STANCES);
  });

  it("falls back to generic stances only when the LLM call fails", async () => {
    const result = await proposeStances({
      thread: {
        author: "@dev",
        text: "the tool is never the bottleneck",
        threadKind: "sharp_opinion",
      },
      chat: async () => ({
        ok: false as const,
        status: 500,
        error: "deepseek_http",
        message: "deepseek HTTP 500",
      }),
    });
    assert.equal(result.needed, true);
    assert.deepEqual(result.options, FALLBACK_STANCES);
  });
});

describe("verifyReplyEdit", () => {
  it("tags usage as reply_verify and parses the verdict", async () => {
    const capture: { purpose?: string } = {};
    const result = await verifyReplyEdit({
      draft: "a",
      edited: "b",
      chat: fakeChat('{"ok":false,"reason":"Swap more than a word — make it yours."}', capture),
    });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.verdict.ok, false);
      assert.match(result.verdict.reason, /make it yours/i);
    }
    assert.equal(capture.purpose, "reply_verify");
  });

  it("rejects malformed verdicts", () => {
    assert.equal(parseVerifyJson("not json"), null);
    assert.equal(parseVerifyJson('{"reason":"no ok flag"}'), null);
    assert.deepEqual(parseVerifyJson('{"ok":true}'), { ok: true, reason: "" });
  });
});
