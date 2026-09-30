import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatThousands,
  levelBarPercent,
  levelXpLabel,
  levelXpRemaining,
  postsViewsLabel,
} from "./flightStats.ts";

await describe("flightStats", () => {
  it("groups thousands", () => {
    assert.equal(formatThousands(1175401), "1,175,401");
    assert.equal(formatThousands(999), "999");
    assert.equal(formatThousands(1000), "1,000");
    assert.equal(formatThousands(Number.NaN), "0");
    assert.equal(formatThousands(-5), "0");
  }).catch(assert.fail);

  it("words the posts and views chip", () => {
    assert.equal(postsViewsLabel(307, 1175401), "307 posts · 1,175,401 views");
    assert.equal(postsViewsLabel(1, 20), "1 post · 20 views");
  }).catch(assert.fail);

  it("reports XP left in the level and the next level", () => {
    const g = { level: 46, xpIntoLevel: 2109 - 2025, xpToNext: 91 };
    assert.equal(levelXpRemaining(g), 7);
    assert.equal(levelXpLabel(g), "7 XP to Lv 47");
    assert.equal(levelXpRemaining({ xpIntoLevel: 500, xpToNext: 10 }), 0);
    assert.equal(levelXpLabel({ level: 1, xpIntoLevel: 0, xpToNext: 1 }), "1 XP to Lv 2");
  }).catch(assert.fail);

  it("fills the level bar between 0 and 100", () => {
    assert.equal(levelBarPercent({ xpIntoLevel: 45, xpToNext: 90 }), 50);
    assert.equal(levelBarPercent({ xpIntoLevel: 900, xpToNext: 90 }), 100);
    assert.equal(levelBarPercent({ xpIntoLevel: Number.NaN, xpToNext: 0 }), 0);
  }).catch(assert.fail);
});
