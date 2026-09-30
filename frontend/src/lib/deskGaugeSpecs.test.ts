import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REPLY_RATE_CEILING_PER_HOUR,
  TANK_LOW_FUEL,
  deltaSpoken,
  deskGaugeSpecs,
  gaugeValueText,
  repliesDayScaleMax,
  replyRateScaleMax,
} from "./deskGaugeSpecs.ts";
import { readDeskInstruments } from "./deskInstruments.ts";

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);

function instruments(over: Partial<Parameters<typeof readDeskInstruments>[0]> = {}) {
  return readDeskInstruments({
    nowMs: NOW,
    marks: [],
    postsToday: 3,
    originalsToday: 2,
    dailyPostCap: 8,
    replyPaceUntil: null,
    usableScoutCount: 7,
    ...over,
  });
}

await describe("deskGaugeSpecs", () => {
  it("derives the replies per hour scale from the rate, capped at the one-a-minute pace", () => {
    assert.equal(REPLY_RATE_CEILING_PER_HOUR, 60);
    assert.equal(replyRateScaleMax(0.54), 1);
    assert.equal(replyRateScaleMax(1.9), 5);
    assert.equal(replyRateScaleMax(0), 1);
    assert.equal(replyRateScaleMax(500), 60);
  }).catch(assert.fail);

  it("derives the replies today scale from the count", () => {
    assert.equal(repliesDayScaleMax(0), 10);
    assert.equal(repliesDayScaleMax(15), 20);
    assert.equal(repliesDayScaleMax(1000), 200);
  }).catch(assert.fail);

  it("scales OG today and Posts / day to the daily cap and warns at the cap", () => {
    const specs = deskGaugeSpecs(instruments({ postsToday: 8 }));
    const og = specs.find((s) => s.id === "ogToday")!;
    const posts = specs.find((s) => s.id === "postsPerDay")!;
    assert.equal(og.max, 8);
    assert.equal(posts.max, 8);
    assert.deepEqual(posts.zones, [{ from: 7, to: 8, tone: "warn" }]);
    assert.equal(posts.tone, "warn");
    assert.equal(deskGaugeSpecs(instruments({ postsToday: 3 }))[3]!.tone, null);
    assert.equal(deskGaugeSpecs(instruments({ postsToday: 9 }))[3]!.tone, "danger");
  }).catch(assert.fail);

  it("draws the tank as a 0 to 10 fuel gauge with E and F and a low-fuel zone", () => {
    const tank = deskGaugeSpecs(instruments())[4]!;
    assert.equal(tank.max, 10);
    assert.equal(tank.valueText, "7 / 10");
    assert.deepEqual(tank.tickLabels.map((t) => t.text), ["E", "F"]);
    assert.deepEqual(tank.zones, [{ from: 0, to: TANK_LOW_FUEL, tone: "danger" }]);
  }).catch(assert.fail);

  it("places the inbound needle in its band and empties the dial without one", () => {
    const empty = deskGaugeSpecs(instruments())[5]!;
    assert.equal(empty.value, null);
    assert.equal(empty.valueText, "–");
    const marks = Array.from({ length: 5 }, (_, i) => ({
      atMs: NOW - i * 60_000,
      t24hViews: 10,
    }));
    const clear = deskGaugeSpecs(instruments({ marks }))[5]!;
    assert.equal(clear.valueText, "Clear");
    assert.equal(clear.value, 0.5);
    const quiet = deskGaugeSpecs(
      instruments({ marks: marks.map((m) => ({ ...m, t24hViews: 0, t24hLikes: 0 })) }),
    )[5]!;
    assert.equal(quiet.valueText, "Quiet");
    assert.equal(quiet.value, 2.5);
    assert.equal(quiet.tone, "danger");
  }).catch(assert.fail);

  it("speaks the unit and both deltas in the meter text", () => {
    const spec = deskGaugeSpecs(instruments())[0]!;
    const text = gaugeValueText({
      ...spec,
      valueText: "0.54",
      delta: { pct24h: 1.3, pct7d: null },
    });
    assert.equal(text, "0.54 replies per hour, up 1.3% over 24h, new over 7d");
    assert.equal(deltaSpoken(-6.3, "24h"), "down 6.3% over 24h");
    assert.equal(deltaSpoken(0, "7d"), "unchanged over 7d");
    assert.equal(gaugeValueText(deskGaugeSpecs(instruments())[4]!), "7 / 10 usable scouted replies");
  }).catch(assert.fail);
});
