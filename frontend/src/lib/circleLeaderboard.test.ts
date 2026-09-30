import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  barShares,
  circleStatLine,
  emptyCircleLine,
  formatMemberCounts,
  ghostRing,
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

  it("formats compact counts and hides zeros", () => {
    assert.equal(formatMemberCounts({ replies: 15, quotes: 2 }), "15 · 2q");
    assert.equal(formatMemberCounts({ replies: 13, quotes: 0 }), "13");
    assert.equal(formatMemberCounts({ replies: 0, quotes: 3 }), "3q");
    assert.equal(formatMemberCounts({ replies: 0, quotes: 0 }), "");
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

  it("draws a stable ghost ring inside the card box", () => {
    const discs = ghostRing();
    assert.equal(discs.length, 36);
    assert.deepEqual(ghostRing(), discs);
    for (const d of discs) {
      assert.ok(d.x - d.r >= 0 && d.x + d.r <= 100);
      assert.ok(d.y - d.r >= 0 && d.y + d.r <= 125);
    }
  }).catch(assert.fail);

  it("words the empty line with progress", () => {
    assert.equal(emptyCircleLine(1, 3), "Reply to more people to draw your circle (1 of 3).");
    assert.equal(emptyCircleLine(0, 3), "Reply to more people to draw your circle (0 of 3).");
  }).catch(assert.fail);
});
