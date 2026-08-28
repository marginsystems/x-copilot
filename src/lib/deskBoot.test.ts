import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DESK_BOOT_KEY,
  clearDeskBootCache,
  parseAuthSessionUser,
  parseDeskBoot,
  readDeskBootCache,
  writeDeskBootCache,
} from "./deskBoot.ts";

function memoryStore(seed: Record<string, string> = {}) {
  const data = { ...seed };
  return {
    getItem(key: string) {
      return data[key] ?? null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
    removeItem(key: string) {
      delete data[key];
    },
  };
}

const user = {
  id: "u1",
  email: "a@b.com",
  displayName: "Ada",
  avatarUrl: null,
  onboardingCompleted: true,
  agenda: "Ship in public",
  xUsername: "ada",
  xLinked: true,
  xCanPost: true,
  isAdmin: false,
};

const desk = {
  interacted: { interactions: [], activeIds: [] },
  dismissed: { dismissals: [], dismissedIds: [] },
  skipped: { skipped: [], skippedIds: [] },
  expired: { expired: [], expiredIds: [] },
  forYou: {
    suggestions: [],
    tracked: 3,
    needed: 5,
    extra: null,
  },
  lastScout: { ok: true, empty: true },
  scoutLog: { entries: [] },
  gamification: {
    currentStreak: 2,
    longestStreak: 4,
    lifetimeXp: 10,
    level: 2,
    xpIntoLevel: 3,
    xpToNext: 8,
    lastMarkUtcDay: null,
    nextGoal: null,
    achievements: [],
  },
  activityStats: {
    bucket: "day",
    series: [],
    totals: { interactions: 0, views: 0, withStats: 0 },
  },
  coaching: {
    dayUtc: "2026-08-28",
    nextAction: null,
    missions: [
      {
        id: "mark_2",
        label: "Mark 2 replies",
        target: 2,
        progress: 1,
        xpReward: 4,
        completed: false,
        claimed: false,
      },
    ],
  },
};

describe("parseAuthSessionUser", () => {
  it("strips @ from the handle and treats a missing onboarding flag as done", () => {
    const parsed = parseAuthSessionUser({
      id: "u1",
      xUsername: "@Ada",
      agenda: "  ",
    });
    assert.equal(parsed?.id, "u1");
    assert.equal(parsed?.xUsername, "Ada");
    assert.equal(parsed?.onboardingCompleted, true);
    assert.equal(parsed?.agenda, null);
  });
});

describe("parseDeskBoot", () => {
  it("keeps a signed-in payload and parses Approach progress", () => {
    const parsed = parseDeskBoot({
      ok: true,
      authRequired: true,
      user,
      desk,
    });
    assert.ok(parsed);
    assert.equal(parsed.user?.id, "u1");
    assert.equal(parsed.desk?.forYou.progress?.tracked, 3);
    assert.equal(parsed.desk?.gamification.level, 2);
    assert.equal(parsed.desk?.coaching?.missions[0]?.id, "mark_2");
    assert.equal(parsed.desk?.lastScout.empty, true);
  });

  it("rejects a payload that claims ok without a usable user id", () => {
    assert.equal(
      parseDeskBoot({ ok: true, user: { email: "no-id" }, desk }),
      null,
    );
  });
});

describe("desk boot cache", () => {
  it("round-trips a signed-in snapshot and drops signed-out writes", () => {
    const store = memoryStore();
    const payload = parseDeskBoot({ ok: true, authRequired: true, user, desk });
    assert.ok(payload);
    writeDeskBootCache(payload, store);
    assert.ok(store.getItem(DESK_BOOT_KEY));
    const read = readDeskBootCache(store);
    assert.equal(read?.user?.id, "u1");
    assert.equal(read?.desk?.gamification.lifetimeXp, 10);
    writeDeskBootCache({ ...payload, user: null }, store);
    assert.equal(store.getItem(DESK_BOOT_KEY), null);
    clearDeskBootCache(store);
  });
});
