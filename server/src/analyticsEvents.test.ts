import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatSlackText,
  parseAnalyticsEvent,
} from "./analyticsEvents.ts";

const frozen = () => new Date("2026-08-19T12:00:00.000Z");

describe("parseAnalyticsEvent", () => {
  it("accepts an allowlisted signup", () => {
    const parsed = parseAnalyticsEvent(
      {
        name: "user.signup",
        userId: "u-1",
        email: "alice@example.com",
        handle: "@alice",
        provider: "google",
      },
      frozen,
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.event.name, "user.signup");
    assert.equal(parsed.event.at, "2026-08-19T12:00:00.000Z");
    assert.equal(parsed.event.handle, "alice");
    assert.equal(parsed.event.email, "alice@example.com");
  });

  it("rejects unknown names and non-objects", () => {
    assert.equal(parseAnalyticsEvent({ name: "drop.table" }).ok, false);
    assert.equal(parseAnalyticsEvent(null).ok, false);
    assert.equal(parseAnalyticsEvent("user.signup").ok, false);
  });

  it("keeps a valid at and drops empty optional fields", () => {
    const parsed = parseAnalyticsEvent(
      {
        name: "scout.takeoff",
        at: "2026-01-02T03:04:05.000Z",
        email: "  ",
        detail: "3 queries",
        ok: true,
      },
      frozen,
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.event.at, "2026-01-02T03:04:05.000Z");
    assert.equal(parsed.event.email, undefined);
    assert.equal(parsed.event.detail, "3 queries");
    assert.equal(parsed.event.ok, true);
  });
});

describe("formatSlackText", () => {
  it("renders signup with identity", () => {
    const text = formatSlackText({
      name: "user.signup",
      at: "2026-08-19T12:00:00.000Z",
      userId: "u-1",
      email: "alice@example.com",
      handle: "alice",
      provider: "google",
    });
    assert.equal(text, "*signup* · alice@example.com · @alice · google\n`u-1`");
  });

  it("marks a failed takeoff", () => {
    const text = formatSlackText({
      name: "scout.failed",
      at: "2026-08-19T12:00:00.000Z",
      detail: "x_rate_limit",
      ok: false,
    });
    assert.equal(text, "*scout failed* · failed · x_rate_limit");
  });
});
