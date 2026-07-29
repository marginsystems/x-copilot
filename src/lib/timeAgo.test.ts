import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAbsoluteTime, formatTimeAgo, parseCreatedAt } from "./timeAgo.ts";

const twitter = "Sat Jul 25 12:00:00 +0000 2026";

describe("parseCreatedAt", () => {
  it("parses twitter created_at", () => {
    const d = parseCreatedAt(twitter);
    assert.ok(d);
    assert.equal(d!.toISOString(), "2026-07-25T12:00:00.000Z");
  });

  it("returns null for garbage", () => {
    assert.equal(parseCreatedAt("not-a-date"), null);
    assert.equal(parseCreatedAt(""), null);
    assert.equal(parseCreatedAt(undefined), null);
  });
});

describe("formatTimeAgo", () => {
  const now = Date.parse("2026-07-25T15:00:00.000Z");

  it("returns Now / minutes / hours / days", () => {
    assert.equal(formatTimeAgo("2026-07-25T14:59:30.000Z", now), "Now");
    assert.equal(formatTimeAgo("2026-07-25T14:59:45.000Z", now), "Now");
    assert.equal(formatTimeAgo("2026-07-25T14:50:00.000Z", now), "10m");
    assert.equal(formatTimeAgo("2026-07-25T12:00:00.000Z", now), "3h");
    assert.equal(formatTimeAgo("2026-07-23T15:00:00.000Z", now), "2d");
  });

  it("uses short date after a week (same year)", () => {
    const label = formatTimeAgo("2026-07-01T12:00:00.000Z", now);
    assert.ok(label);
    // Day/month use local timezone; assert month token + day present
    assert.match(label!, /Jul/);
    assert.doesNotMatch(label!, /^\d+[mhd]$/);
  });

  it("includes year when different from now", () => {
    const label = formatTimeAgo("2024-01-12T12:00:00.000Z", now);
    assert.ok(label);
    assert.match(label!, /2024/);
  });

  it("returns null when unparseable", () => {
    assert.equal(formatTimeAgo("???"), null);
  });

  it("treats small future skew as Now (stale nowMs)", () => {
    assert.equal(formatTimeAgo("2026-07-25T15:00:15.000Z", now), "Now");
    assert.equal(formatTimeAgo("2026-07-25T15:00:59.000Z", now), "Now");
  });

  it("still uses short date for large future skew", () => {
    const label = formatTimeAgo("2026-07-25T16:00:00.000Z", now);
    assert.ok(label);
    assert.match(label!, /Jul/);
  });
});

describe("formatAbsoluteTime", () => {
  it("returns a locale string for valid dates", () => {
    const abs = formatAbsoluteTime(twitter);
    assert.ok(abs);
    assert.notEqual(abs, "Invalid Date");
  });
});
