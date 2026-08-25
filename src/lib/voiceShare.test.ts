import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VoiceState } from "./voice.ts";
import {
  drawVoiceShareImage,
  ellipsize,
  voiceShareCaption,
  voiceShareFilename,
  voiceSharePayload,
  VOICE_SHARE_DISCLAIMER,
  VOICE_SHARE_SITE,
  wrapLines,
} from "./voiceShare.ts";

const suggests: VoiceState["suggests"] = {
  used: 3,
  limit: 10,
  remaining: 7,
  canSuggest: true,
  planKey: "free",
};

function voice(over: Partial<VoiceState> = {}): VoiceState {
  return {
    status: "ready",
    handle: "margin",
    replyCount: 140,
    conversationCount: 120,
    unlockAt: 100,
    unlocked: true,
    card: {
      tone: "dry, short, slightly sarcastic",
      typicalLength: "short",
      habits: ["asks a follow-up", "names the tradeoff"],
      neverDo: ["hype", "thread-length throat-clearing"],
      examples: ["Ship the small version.", "What changed your mind?"],
    },
    cardUpdatedAt: "2026-08-15T00:00:00.000Z",
    lastPullAt: "2026-08-15T00:00:00.000Z",
    needsDailyUpdate: false,
    needsLearn: false,
    lastError: null,
    suggests,
    ...over,
  };
}

describe("voiceSharePayload", () => {
  it("returns null without a tone card", () => {
    assert.equal(voiceSharePayload(null), null);
    assert.equal(voiceSharePayload(voice({ card: null })), null);
    assert.equal(
      voiceSharePayload(
        voice({
          card: {
            tone: "   ",
            typicalLength: "",
            habits: [],
            neverDo: [],
            examples: [],
          },
        }),
      ),
      null,
    );
  });

  it("keeps a full card and caps lists", () => {
    const payload = voiceSharePayload(
      voice({
        card: {
          tone: "dry",
          typicalLength: "short",
          habits: ["a", "b", "c", "d", "e", "f", "g"],
          neverDo: ["n1", "n2", "n3", "n4", "n5"],
          examples: ["e1", "e2", "e3", "e4"],
        },
      }),
    );
    assert.equal(payload?.starter, false);
    assert.equal(payload?.handle, "margin");
    assert.deepEqual(payload?.habits, ["a", "b", "c", "d", "e", "f"]);
    assert.deepEqual(payload?.neverDo, ["n1", "n2", "n3", "n4"]);
    assert.deepEqual(payload?.examples, ["e1", "e2", "e3"]);
  });

  it("strips habits and examples from a starter card even if they are present", () => {
    const payload = voiceSharePayload(
      voice({
        unlocked: false,
        status: "insufficient",
        replyCount: 12,
        card: {
          tone: "Brief and matter-of-fact.",
          typicalLength: "invented",
          habits: ["do not invent this"],
          neverDo: ["or this"],
          examples: ["fake example"],
          starter: true,
        },
      }),
    );
    assert.equal(payload?.starter, true);
    assert.equal(payload?.tone, "Brief and matter-of-fact.");
    assert.equal(payload?.typicalLength, null);
    assert.deepEqual(payload?.habits, []);
    assert.deepEqual(payload?.neverDo, []);
    assert.deepEqual(payload?.examples, []);
  });

  it("treats an unlocked=false card as starter even without the flag", () => {
    const payload = voiceSharePayload(
      voice({
        unlocked: false,
        card: {
          tone: "dry",
          typicalLength: "short",
          habits: ["asks"],
          neverDo: [],
          examples: ["hi"],
        },
      }),
    );
    assert.equal(payload?.starter, true);
    assert.deepEqual(payload?.examples, []);
  });
});

describe("voiceShareFilename and caption", () => {
  it("names the file after a sanitized handle", () => {
    const payload = voiceSharePayload(voice())!;
    assert.equal(voiceShareFilename(payload), "xcopilot-voice-margin.png");
    assert.equal(
      voiceShareFilename({ ...payload, handle: "@weird name!" }),
      "xcopilot-voice-weirdname.png",
    );
    assert.equal(voiceShareFilename({ ...payload, handle: null }), "xcopilot-voice.png");
  });

  it("writes a post caption with the site and affiliation line", () => {
    const full = voiceShareCaption(voiceSharePayload(voice())!);
    assert.match(full, /@margin/);
    assert.match(full, /140 public posts/);
    assert.match(full, new RegExp(VOICE_SHARE_SITE));
    assert.match(full, /Not affiliated with X Corp/);
    assert.doesNotMatch(full, /remaining/);
    assert.doesNotMatch(full, /7/);

    const starter = voiceShareCaption(
      voiceSharePayload(
        voice({
          unlocked: false,
          card: {
            tone: "dry",
            typicalLength: "",
            habits: [],
            neverDo: [],
            examples: [],
            starter: true,
          },
        }),
      )!,
    );
    assert.match(starter, /Tone only until 100/);
    assert.match(starter, new RegExp(VOICE_SHARE_DISCLAIMER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

describe("wrapLines and ellipsize", () => {
  const measure = (s: string) => s.length * 10;

  it("wraps on width and hard-breaks a long token", () => {
    assert.deepEqual(wrapLines("one two three", 50, measure), ["one", "two", "three"]);
    assert.deepEqual(wrapLines("abcdefghij", 40, measure), ["abcd", "efgh", "ij"]);
    assert.deepEqual(wrapLines("   ", 40, measure), []);
  });

  it("adds an ellipsis when a line does not fit", () => {
    assert.equal(ellipsize("short", 100, measure), "short");
    assert.equal(ellipsize("toolongword", 50, measure), "tool…");
  });
});

describe("drawVoiceShareImage", () => {
  function recordCtx() {
    const texts: string[] = [];
    const ctx = {
      fillStyle: "",
      strokeStyle: "",
      font: "",
      textBaseline: "top" as CanvasTextBaseline,
      textAlign: "left" as CanvasTextAlign,
      lineWidth: 1,
      fillRect() {},
      beginPath() {},
      fill() {},
      stroke() {},
      moveTo() {},
      lineTo() {},
      roundRect() {},
      fillText(text: string) {
        texts.push(text);
      },
      measureText(text: string) {
        return { width: String(text).length * 8 };
      },
      createLinearGradient() {
        return { addColorStop() {} };
      },
    };
    return { ctx, texts };
  }

  it("paints the full card including examples and the watermark", () => {
    const { ctx, texts } = recordCtx();
    drawVoiceShareImage(ctx, voiceSharePayload(voice())!);
    const joined = texts.join("\n");
    assert.match(joined, /@margin/);
    assert.match(joined, /LEARNED FROM 140 PUBLIC POSTS/);
    assert.match(joined, /dry, short, slightly sarcastic/);
    assert.match(joined, /asks a follow-up/);
    assert.match(joined, /Ship the small version/);
    assert.match(joined, new RegExp(VOICE_SHARE_SITE));
    assert.match(joined, /Not affiliated with X Corp/);
    assert.doesNotMatch(joined, /remaining/);
  });

  it("does not invent habits or examples on a starter card", () => {
    const { ctx, texts } = recordCtx();
    drawVoiceShareImage(
      ctx,
      voiceSharePayload(
        voice({
          unlocked: false,
          replyCount: 12,
          card: {
            tone: "Brief and matter-of-fact.",
            typicalLength: "short",
            habits: ["secret habit"],
            neverDo: ["secret never"],
            examples: ["secret example"],
            starter: true,
          },
        }),
      )!,
    );
    const joined = texts.join("\n");
    assert.match(joined, /STARTER CARD/);
    assert.match(joined, /Brief and matter-of-fact/);
    assert.doesNotMatch(joined, /secret habit/);
    assert.doesNotMatch(joined, /secret never/);
    assert.doesNotMatch(joined, /secret example/);
    assert.match(joined, new RegExp(VOICE_SHARE_SITE));
  });
});
