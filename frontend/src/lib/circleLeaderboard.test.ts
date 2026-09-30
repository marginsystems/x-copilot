import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  barShares,
  circleStatLine,
  emptyCircleLine,
  formatQuotes,
  formatReplies,
  GHOST_SCORES,
  bubbleMapLabel,
  memberDetail,
  memberInitial,
  memberScore,
} from "./circleLeaderboard.ts";

await describe("circleLeaderboard", () => {
  it("scores a quote as two replies", () => {
    assert.equal(memberScore({ replies: 15, quotes: 2 }), 19);
    assert.equal(memberScore({ replies: -3, quotes: Number.NaN }), 0);
  }).catch(assert.fail);

  it("scales bars to the top score with reply and quote weights that sum to the score share", () => {
    const top = memberScore({ replies: 15, quotes: 2 });
    const first = barShares({ replies: 15, quotes: 2 }, top);
    assert.ok(Math.abs(first.replyPct + first.quotePct - 100) < 1e-9);
    const half = barShares({ replies: 5, quotes: 2 }, 18);
    assert.ok(Math.abs(half.replyPct - (5 / 18) * 100) < 1e-9);
    assert.ok(Math.abs(half.quotePct - (4 / 18) * 100) < 1e-9);
  }).catch(assert.fail);

  it("never overflows the bar and survives a missing top score", () => {
    const over = barShares({ replies: 30, quotes: 10 }, 10);
    assert.equal(over.replyPct, 100);
    assert.equal(over.quotePct, 0);
    assert.deepEqual(barShares({ replies: 3, quotes: 1 }, 0), { replyPct: 0, quotePct: 0 });
    assert.deepEqual(barShares({ replies: 0, quotes: 0 }, 9), { replyPct: 0, quotePct: 0 });
  }).catch(assert.fail);

  it("formats reply and quote cells separately and leaves zeros empty", () => {
    assert.equal(formatReplies({ replies: 15, quotes: 2 }), "15");
    assert.equal(formatQuotes({ replies: 15, quotes: 2 }), "2q");
    assert.equal(formatQuotes({ replies: 13, quotes: 0 }), "");
    assert.equal(formatReplies({ replies: 0, quotes: 3 }), "");
    assert.equal(formatQuotes({ replies: 0, quotes: 3 }), "3q");
  }).catch(assert.fail);

  it("words the tooltip detail and hides zero counts", () => {
    assert.equal(memberDetail({ replies: 13, quotes: 6 }), "13 replies · 6 quotes");
    assert.equal(memberDetail({ replies: 1, quotes: 1 }), "1 reply · 1 quote");
    assert.equal(memberDetail({ replies: 8, quotes: 0 }), "8 replies");
    assert.equal(memberDetail({ replies: 0, quotes: 3 }), "3 quotes");
    assert.equal(memberDetail({ replies: 0, quotes: 0 }), "");
  }).catch(assert.fail);

  it("summarises the top people in the map label", () => {
    const members = [
      { handle: "a", replies: 13, quotes: 6 },
      { handle: "b", replies: 8, quotes: 0 },
      { handle: "c", replies: 0, quotes: 2 },
      { handle: "d", replies: 1, quotes: 0 },
    ];
    assert.equal(
      bubbleMapLabel(members, 12),
      "Bubble map of your X Circle, 12 people. Closest: @a (13 replies · 6 quotes), @b (8 replies), @c (2 quotes).",
    );
  }).catch(assert.fail);

  it("builds the stat line from real totals and drops zero counts", () => {
    assert.equal(circleStatLine({ people: 64, replies: 843, quotes: 12 }), "64 people · 843 replies · 12 quotes");
    assert.equal(circleStatLine({ people: 5, replies: 9, quotes: 0 }), "5 people · 9 replies");
    assert.equal(circleStatLine({ people: 4, replies: 1, quotes: 1 }), "4 people · 1 reply · 1 quote");
    assert.equal(circleStatLine({ people: 0, replies: 0, quotes: 0 }), "");
  }).catch(assert.fail);

  it("picks an initial from the name, then the handle", () => {
    assert.equal(memberInitial("maya_builds", "Maya Okafor"), "M");
    assert.equal(memberInitial("@zed", null), "Z");
    assert.equal(memberInitial("", null), "?");
  }).catch(assert.fail);

  it("keeps ghost scores descending and positive", () => {
    assert.ok(GHOST_SCORES.length >= 10);
    for (let i = 1; i < GHOST_SCORES.length; i++) {
      assert.ok(GHOST_SCORES[i]! > 0 && GHOST_SCORES[i]! <= GHOST_SCORES[i - 1]!);
    }
  }).catch(assert.fail);

  it("words the empty line with progress", () => {
    assert.equal(emptyCircleLine(1, 3), "Reply to more people to draw your circle (1 of 3).");
    assert.equal(emptyCircleLine(0, 3), "Reply to more people to draw your circle (0 of 3).");
  }).catch(assert.fail);
});
