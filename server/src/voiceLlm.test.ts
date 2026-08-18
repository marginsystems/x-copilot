import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
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

function fakeChat(content: string, capture?: { purpose?: string }): ChatFn {
  return async (opts) => {
    if (capture) capture.purpose = opts.purpose;
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

  it("cleans fenced drafts and caps length", () => {
    assert.equal(cleanDraft("```\nhello there\n```"), "hello there");
    assert.equal(cleanDraft(`“smart quotes”`), "smart quotes");
    assert.equal(cleanDraft("x".repeat(400)).length, 280);
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
