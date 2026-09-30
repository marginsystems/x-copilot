import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REPLY_HOUR_ZONES,
  REPLY_RATE_CEILING_PER_HOUR,
  TANK_LOW_FUEL,
  deltaSpoken,
  deskGaugeSpecs,
  gaugeValueText,
  repliesDayScaleMax,
  replyHourZone,
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
  it("bands replies in the last hour as normal, busy, hot and over pace", () => {
    assert.equal(replyHourZone(0), "normal");
    assert.equal(replyHourZone(19), "normal");
    assert.equal(replyHourZone(20), "busy");
    assert.equal(replyHourZone(34), "busy");
    assert.equal(replyHourZone(35), "hot");
    assert.equal(replyHourZone(49), "hot");
    assert.equal(replyHourZone(50), "over");
    assert.equal(replyHourZone(Number.NaN), "normal");
  }).catch(assert.fail);

  it("draws replies per hour as the last 60 minutes on a 0 to 60 dial with pace zones", () => {
    assert.equal(REPLY_RATE_CEILING_PER_HOUR, 60);
    const replyAtMs = Array.from({ length: 40 }, (_, i) => NOW - i * 60_000);
    const replyAtOld = Array.from({ length: 300 }, (_, i) => NOW - 2 * 3_600_000 - i * 3_600_000);
    const rate = deskGaugeSpecs(instruments({ replyAtMs: [...replyAtMs, ...replyAtOld] }))[0]!;
    assert.equal(rate.value, 40);
    assert.equal(rate.valueText, "40");
    assert.equal(rate.max, 60);
    assert.deepEqual(rate.zones, REPLY_HOUR_ZONES);
    assert.deepEqual(rate.zones, [
      { from: 0, to: 20, tone: "gain" },
      { from: 35, to: 50, tone: "warn" },
      { from: 50, to: 60, tone: "danger" },
    ]);
    assert.equal(rate.tone, "warn");
    assert.match(rate.unit, /last 60 minutes, hot$/);
    const quiet = deskGaugeSpecs(instruments({ replyAtMs: replyAtOld }))[0]!;
    assert.equal(quiet.value, 0);
    assert.equal(quiet.tone, null);
    const over = deskGaugeSpecs(
      instruments({ replyAtMs: Array.from({ length: 55 }, (_, i) => NOW - i * 60_000) }),
    )[0]!;
    assert.equal(over.tone, "danger");
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
      valueText: "12",
      delta: { pct24h: 1.3, pct7d: null },
    });
    assert.equal(
      text,
      "12 replies in the last 60 minutes, normal pace, up 1.3% over 24h, new over 7d",
    );
    assert.equal(deltaSpoken(-6.3, "24h"), "down 6.3% over 24h");
    assert.equal(deltaSpoken(0, "7d"), "unchanged over 7d");
    assert.equal(gaugeValueText(deskGaugeSpecs(instruments())[4]!), "7 / 10 usable scouted replies");
  }).catch(assert.fail);
});
