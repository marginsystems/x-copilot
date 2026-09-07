import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REPOST_MIN_AGE_MS,
  REPOST_MIN_VIEWS,
  REPOST_MIN_VIEWS_PER_HOUR,
  routeScoutSurface,
} from "./scoutRoute.ts";
import type { ThreadCard } from "./threadCard.ts";

const NOW = Date.parse("2026-09-07T05:00:00.000Z");

function card(overrides: Partial<ThreadCard> = {}): ThreadCard {
  return {
    id: "root-1",
    author: "@builder",
    text: "A useful concrete take",
    url: "https://x.com/builder/status/root-1",
    createdAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    views: 200,
    engage: "priority",
    onAgenda: true,
    baitScore: 20,
    threadKind: "timely_take",
    ...overrides,
  };
}

describe("routeScoutSurface", () => {
  it("routes an established, fast-moving cool root to repost", () => {
    assert.equal(routeScoutSurface(card(), NOW), "repost");
  });

  it("defaults to reply unless every repost gate passes", () => {
    const cases: ThreadCard[] = [
      card({ onAgenda: false }),
      card({ engage: "skip" }),
      card({ baitScore: 46 }),
      card({ isReply: true }),
      card({ threadKind: "hollow_ask" }),
      card({ text: "Is this useful?" }),
      card({ opText: "Root asks why?" }),
      card({ views: REPOST_MIN_VIEWS - 1 }),
      card({ views: undefined }),
      card({ createdAt: undefined }),
      card({
        createdAt: new Date(NOW - REPOST_MIN_AGE_MS + 1).toISOString(),
      }),
      card({
        createdAt: new Date(NOW - 5 * 60 * 60 * 1000).toISOString(),
        views: REPOST_MIN_VIEWS,
      }),
    ];
    for (const candidate of cases) {
      assert.equal(routeScoutSurface(candidate, NOW), "reply");
    }
  });

  it("uses root views when opViews is present", () => {
    assert.equal(
      routeScoutSurface(card({ views: 10, opViews: 200 }), NOW),
      "repost",
    );
    assert.equal(
      routeScoutSurface(card({ views: 1_000, opViews: 99 }), NOW),
      "reply",
    );
  });

  it("uses the OP timestamp when routing a retargeted reply", () => {
    assert.equal(
      routeScoutSurface(
        card({
          createdAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
          opCreatedAt: new Date(NOW - 5 * 60 * 60 * 1000).toISOString(),
          views: 200,
        }),
        NOW,
      ),
      "reply",
    );
  });

  it("keeps the named threshold boundaries inclusive", () => {
    const ageHours = REPOST_MIN_VIEWS / REPOST_MIN_VIEWS_PER_HOUR;
    assert.equal(
      routeScoutSurface(
        card({
          views: REPOST_MIN_VIEWS,
          createdAt: new Date(
            NOW - ageHours * 60 * 60 * 1000,
          ).toISOString(),
        }),
        NOW,
      ),
      "repost",
    );
  });
});
