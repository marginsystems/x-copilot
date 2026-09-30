import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CIRCLE_SHARE_HEIGHT,
  CIRCLE_SHARE_WIDTH,
  circleCountsLine,
  circleInitials,
  circleRefreshKey,
  circleRings,
  circleShareCaption,
  circleShareIntentUrl,
  circleShareLayout,
  circleSharePayload,
  drawCircleShareImage,
  parseCircleResponse,
  sharpAvatarUrl,
  type CircleMember,
  type CircleResponse,
} from "./circleShare.ts";
import { FLIGHT_SHARE_DISCLAIMER, FLIGHT_SHARE_SITE } from "./flightShare.ts";

function member(i: number, overrides: Partial<CircleMember> = {}): CircleMember {
  return {
    handle: `friend_${i}`,
    name: `Friend ${i}`,
    avatarUrl: `https://pbs.twimg.com/profile_images/${i}/a_normal.jpg`,
    replies: 100 - i,
    quotes: i % 3,
    score: 200 - i,
    lastAt: "2026-09-29T10:00:00Z",
    ...overrides,
  };
}

function response(n: number): CircleResponse {
  return {
    handle: "me",
    name: "Me Myself",
    avatarUrl: "https://pbs.twimg.com/profile_images/0/me_normal.jpg",
    generatedAt: "2026-09-30T12:00:00Z",
    members: Array.from({ length: n }, (_, i) => member(i)),
    totals: { replies: 638, quotes: 13, people: n },
  };
}

await describe("parseCircleResponse", () => {
  it("rejects non-objects and missing members", () => {
    assert.equal(parseCircleResponse(null), null);
    assert.equal(parseCircleResponse("x"), null);
    assert.equal(parseCircleResponse({ handle: "me" }), null);
  }).catch(assert.fail);

  it("drops malformed members and cleans fields", () => {
    const parsed = parseCircleResponse({
      handle: "@me",
      name: "  ",
      avatarUrl: "javascript:alert(1)",
      generatedAt: "2026-09-30T12:00:00Z",
      members: [
        member(1, { handle: "@ok_one" }),
        { handle: "", replies: 1, quotes: 0 },
        { handle: "bad handle!", replies: 1, quotes: 0 },
        { handle: "noquotes", replies: 1 },
        null,
        { handle: "partial", replies: 2, quotes: 1, avatarUrl: 42, name: 7 },
      ],
      totals: { replies: 9, quotes: 1, people: 2 },
    });
    assert.ok(parsed);
    assert.equal(parsed.handle, "me");
    assert.equal(parsed.name, null);
    assert.equal(parsed.avatarUrl, null);
    assert.deepEqual(
      parsed.members.map((m) => m.handle),
      ["ok_one", "partial"],
    );
    assert.equal(parsed.members[1]?.avatarUrl, null);
    assert.equal(parsed.members[1]?.name, null);
    assert.equal(parsed.members[1]?.score, 0);
    assert.deepEqual(parsed.totals, { replies: 9, quotes: 1, people: 2 });
  }).catch(assert.fail);

  it("derives totals when absent and caps members at 64", () => {
    const raw = response(70);
    const parsed = parseCircleResponse({ ...raw, totals: undefined });
    assert.equal(parsed?.members.length, 64);
    assert.equal(parsed?.totals.people, 64);
    assert.equal(
      parsed?.totals.replies,
      parsed?.members.reduce((s, m) => s + m.replies, 0),
    );
  }).catch(assert.fail);
});

await describe("circleSharePayload", () => {
  it("needs at least three members", () => {
    assert.equal(circleSharePayload(null), null);
    assert.equal(circleSharePayload(response(2)), null);
    assert.equal(circleSharePayload(response(3))?.members.length, 3);
  }).catch(assert.fail);
});

await describe("caption and intent", () => {
  it("names the member count, site, and disclaimer", () => {
    const payload = circleSharePayload(response(64))!;
    const caption = circleShareCaption(payload);
    assert.match(caption, /^My X Circle — the 64 people I talk with most on X\./);
    assert.ok(caption.includes(FLIGHT_SHARE_SITE));
    assert.ok(caption.endsWith(FLIGHT_SHARE_DISCLAIMER));
    const url = new URL(circleShareIntentUrl(payload));
    assert.equal(url.origin + url.pathname, "https://x.com/intent/tweet");
    assert.equal(url.searchParams.get("text"), caption);
  }).catch(assert.fail);

  it("formats the counts line", () => {
    assert.equal(
      circleCountsLine(circleSharePayload(response(64))!),
      "638 replies · 13 quotes · 64 people",
    );
  }).catch(assert.fail);
});

await describe("circleRings", () => {
  const L = circleShareLayout(CIRCLE_SHARE_WIDTH, CIRCLE_SHARE_HEIGHT);
  const full = circleRings(64, L.cx, L.cy, L.radiusMax);

  it("fills rings of 8, 20, and 36 in score order", () => {
    assert.equal(full.length, 64);
    const perRing = [0, 1, 2].map((r) => full.filter((p) => p.ring === r).length);
    assert.deepEqual(perRing, [8, 20, 36]);
    assert.deepEqual(full.map((p) => p.index), Array.from({ length: 64 }, (_, i) => i));
    assert.ok(full[0]!.r > full[8]!.r && full[8]!.r > full[28]!.r);
  }).catch(assert.fail);

  it("keeps partial rings and never exceeds 64", () => {
    assert.deepEqual(
      [0, 1].map((r) => circleRings(10, 0, 0, 390).filter((p) => p.ring === r).length),
      [8, 2],
    );
    assert.equal(circleRings(100, 0, 0, 390).length, 64);
    assert.equal(circleRings(0, 0, 0, 390).length, 0);
  }).catch(assert.fail);

  it("does not overlap any two avatars or the center", () => {
    for (let a = 0; a < full.length; a++) {
      const p = full[a]!;
      assert.ok(Math.hypot(p.x - L.cx, p.y - L.cy) - p.r >= L.selfR + 12, `center ${a}`);
      for (let b = a + 1; b < full.length; b++) {
        const q = full[b]!;
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        assert.ok(d >= p.r + q.r + 4, `overlap ${a}/${b}: ${d}`);
      }
    }
  }).catch(assert.fail);

  it("stays inside the circle area and the card", () => {
    for (const p of full) {
      assert.ok(Math.hypot(p.x - L.cx, p.y - L.cy) + p.r <= L.radiusMax);
      assert.ok(p.x - p.r >= L.padX && p.x + p.r <= L.padX + L.contentW);
      assert.ok(p.y - p.r > L.ruleY && p.y + p.r < L.handleY);
    }
  }).catch(assert.fail);
});

await describe("helpers", () => {
  it("builds initials from name, then handle", () => {
    assert.equal(circleInitials("Ada Lovelace", "ada"), "AL");
    assert.equal(circleInitials("plato", "p"), "PL");
    assert.equal(circleInitials(null, "_zed"), "ZE");
    assert.equal(circleInitials(null, null), "?");
  }).catch(assert.fail);

  it("upgrades X avatar sizes", () => {
    assert.equal(
      sharpAvatarUrl("https://pbs.twimg.com/profile_images/1/a_normal.jpg", "200x200"),
      "https://pbs.twimg.com/profile_images/1/a_200x200.jpg",
    );
    assert.equal(
      sharpAvatarUrl("https://example.com/a.png", "400x400"),
      "https://example.com/a.png",
    );
  }).catch(assert.fail);
});

await describe("drawCircleShareImage", () => {
  function recordCtx() {
    const texts: string[] = [];
    const drawn: unknown[] = [];
    let depth = 0;
    let clips = 0;
    const gradient = { addColorStop() {} };
    const ctx = {
      fillStyle: "" as string | CanvasGradient | CanvasPattern,
      strokeStyle: "" as string | CanvasGradient | CanvasPattern,
      font: "",
      textBaseline: "top" as CanvasTextBaseline,
      textAlign: "left" as CanvasTextAlign,
      lineWidth: 1,
      lineJoin: "round" as CanvasLineJoin,
      lineCap: "round" as CanvasLineCap,
      shadowBlur: 0,
      shadowColor: "",
      fillRect() {},
      beginPath() {},
      closePath() {},
      fill() {},
      stroke() {},
      moveTo() {},
      lineTo() {},
      roundRect() {},
      rect() {},
      arc() {},
      save() {
        depth++;
      },
      restore() {
        depth--;
      },
      clip() {
        clips++;
      },
      drawImage(image: CanvasImageSource) {
        assert.ok(depth > 0, "drawImage outside a clip");
        drawn.push(image);
      },
      fillText(text: string) {
        texts.push(text);
      },
      measureText(text: string) {
        return { width: String(text).length * 8 };
      },
      createLinearGradient() {
        return gradient;
      },
      createRadialGradient() {
        return gradient;
      },
    };
    return { ctx, texts, drawn, depth: () => depth, clips: () => clips };
  }

  it("clips loaded avatars and paints initials for missing ones", () => {
    const payload = circleSharePayload(response(64))!;
    const images = new Map<string, CanvasImageSource | null>();
    const selfImg: CanvasImageSource = { width: 1, height: 1, close() {} };
    const firstImg: CanvasImageSource = { width: 2, height: 2, close() {} };
    images.set(payload.avatarUrl!, selfImg);
    images.set(payload.members[0]!.avatarUrl!, firstImg);
    images.set(payload.members[1]!.avatarUrl!, null);
    const rec = recordCtx();
    drawCircleShareImage(rec.ctx, payload, images);
    assert.equal(rec.drawn.length, 2);
    assert.ok(rec.drawn.includes(selfImg));
    assert.ok(rec.drawn.includes(firstImg));
    assert.equal(rec.clips(), 2);
    assert.equal(rec.depth(), 0);
    assert.ok(rec.texts.includes("F1"));
    assert.ok(!rec.texts.includes("F0"));
    assert.ok(!rec.texts.includes("MM"));
    const joined = rec.texts.join("\n");
    assert.match(joined, /x-copilot/);
    assert.match(joined, /X CIRCLE/);
    assert.ok(rec.texts.includes("@me"));
    assert.ok(rec.texts.some((t) => /^X Circle · Sep 30, 2026$/.test(t)));
    assert.ok(rec.texts.includes("638 replies · 13 quotes · 64 people"));
    assert.ok(rec.texts.includes(FLIGHT_SHARE_SITE));
    assert.ok(rec.texts.includes(FLIGHT_SHARE_DISCLAIMER));
  }).catch(assert.fail);

  it("draws initials for the center when the self avatar is missing", () => {
    const payload = { ...circleSharePayload(response(3))!, avatarUrl: null, handle: null };
    const rec = recordCtx();
    drawCircleShareImage(rec.ctx, payload, new Map());
    assert.equal(rec.drawn.length, 0);
    assert.ok(rec.texts.includes("MM"));
    assert.ok(rec.texts.includes("Me Myself"));
  }).catch(assert.fail);
});

await describe("circleRefreshKey", async () => {
  await it("changes when a reply is marked and stays put otherwise", () => {
    const history = [
      { threadId: "a", at: "2026-09-29T10:00:00.000Z" },
      { threadId: "b", at: "2026-09-30T08:00:00.000Z" },
    ];
    const key = circleRefreshKey(history);
    assert.equal(key, "2:2026-09-30T08:00:00.000Z");
    assert.equal(circleRefreshKey([...history].reverse()), key);
    assert.notEqual(
      circleRefreshKey([...history, { threadId: "c", at: "2026-09-30T09:00:00.000Z" }]),
      key,
    );
    assert.equal(circleRefreshKey([]), "0:");
  });
});
