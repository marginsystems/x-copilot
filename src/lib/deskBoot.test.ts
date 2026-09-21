import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DESK_BOOT_KEY,
  clearDeskBootCache,
  parseAuthSessionUser,
  parseDeskBoot,
  peekDeskBootCache,
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
    totals: { interactions: 0, originals: 0, quotes: 0, replies: 0, views: 0, withStats: 0 },
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

  it("keeps a persisted lastScout flight failure", () => {
    const parsed = parseDeskBoot({
      ok: true,
      authRequired: true,
      user,
      desk: {
        ...desk,
        lastScout: {
          ok: true,
          empty: true,
          flight: { active: false, stage: null, failure: true },
        },
      },
    });
    assert.equal(parsed?.desk?.lastScout.flight?.failure, true);
  });

  it("rejects a payload that claims ok without a usable user id", () => {
    assert.equal(
      parseDeskBoot({ ok: true, user: { email: "no-id" }, desk }),
      null,
    );
  });

  it("keeps an older boot payload that has no memory receipt", () => {
    const parsed = parseDeskBoot({
      ok: true,
      authRequired: true,
      user,
      desk: {
        ...desk,
        interacted: {
          interactions: [
            { threadId: "t1", author: "@ada", at: "2026-09-19T12:00:00.000Z" },
          ],
          activeIds: ["t1"],
        },
      },
    });
    assert.equal(parsed?.desk?.interacted.interactions.length, 1);
    assert.equal(parsed?.desk?.interacted.interactions[0]?.memory, undefined);
  });

  it("treats a missing familiarity field as absent and a present one as parsed", () => {
    const older = parseDeskBoot({ ok: true, authRequired: true, user, desk });
    assert.ok(older?.desk);
    assert.equal("scoutFamiliarity" in older.desk, false);
    assert.equal(older.desk.scoutFamiliarity, undefined);

    const familiarity = {
      state: "learning",
      version: 1,
      revision: 2,
      score: 0,
      coverage: { storedConfirmedReplies: 1, knownKindResolvedActions: 1 },
      biases: [],
      hints: [],
      lastLearned: { at: "2026-09-20T10:00:01.000Z", action: "take", threadKind: "fact_add" },
      updatedAt: "2026-09-20T10:00:01.000Z",
    };
    const withField = parseDeskBoot({
      ok: true,
      authRequired: true,
      user,
      desk: { ...desk, scoutFamiliarity: { ...familiarity, userId: "u1", notes: ["x"] } },
    });
    assert.deepEqual(withField?.desk?.scoutFamiliarity, familiarity);
    assert.equal(withField?.desk?.gamification.level, 2);

    const nulled = parseDeskBoot({
      ok: true,
      authRequired: true,
      user,
      desk: { ...desk, scoutFamiliarity: null },
    });
    assert.ok(nulled?.desk);
    assert.equal("scoutFamiliarity" in nulled.desk, true);
    assert.equal(nulled.desk.scoutFamiliarity, null);

    const malformed = parseDeskBoot({
      ok: true,
      authRequired: true,
      user,
      desk: { ...desk, scoutFamiliarity: { state: "supported", score: 500 } },
    });
    assert.equal(malformed?.desk?.scoutFamiliarity, null);
    assert.equal(malformed?.desk?.coaching?.missions[0]?.id, "mark_2");
    assert.equal(malformed?.desk?.lastScout.empty, true);
  });

  it("keeps a saved memory receipt and drops a malformed one", () => {
    const parsed = parseDeskBoot({
      ok: true,
      authRequired: true,
      user,
      desk: {
        ...desk,
        interacted: {
          interactions: [
            {
              threadId: "saved",
              author: "@ada",
              at: "2026-09-19T12:00:00.000Z",
              memory: { state: "saved", memoryPath: "/secret.md" },
            },
            {
              threadId: "missing",
              author: "@ada",
              at: "2026-09-19T12:01:00.000Z",
              memory: { state: "no_reply_text" },
            },
            {
              threadId: "bad",
              author: "@ada",
              at: "2026-09-19T12:02:00.000Z",
              memory: { state: "yes" },
            },
          ],
          activeIds: ["saved", "missing", "bad"],
        },
      },
    });
    const rows = parsed?.desk?.interacted.interactions ?? [];
    assert.deepEqual(rows[0]?.memory, { state: "saved" });
    assert.equal("memoryPath" in (rows[0]?.memory ?? {}), false);
    assert.deepEqual(rows[1]?.memory, { state: "no_reply_text" });
    assert.equal(rows[2]?.memory, undefined);
  });
});

describe("desk boot cache", () => {
  it("round-trips a snapshot without scoutLog and drops signed-out writes", () => {
    const store = memoryStore();
    const payload = parseDeskBoot({ ok: true, authRequired: true, user, desk });
    assert.ok(payload);
    writeDeskBootCache(payload, store);
    assert.ok(store.getItem(DESK_BOOT_KEY));
    const read = readDeskBootCache(store);
    assert.equal(read?.user?.id, "u1");
    assert.equal(read?.desk?.gamification.lifetimeXp, 10);
    assert.ok(read?.desk);
    assert.equal("scoutLog" in read.desk, false);
    assert.equal(read?.desk?.forYou.progress?.tracked, 3);
    writeDeskBootCache({ ...payload, user: null }, store);
    assert.equal(store.getItem(DESK_BOOT_KEY), null);
    clearDeskBootCache(store);
  });

  it("caches familiarity only inside the owned envelope and never seeds another owner", () => {
    const store = memoryStore();
    const familiarity = {
      state: "empty",
      version: 1,
      revision: 0,
      score: 0,
      coverage: { storedConfirmedReplies: 0, knownKindResolvedActions: 0 },
      biases: [],
      hints: [],
      lastLearned: null,
      updatedAt: null,
    };
    const payload = parseDeskBoot({
      ok: true,
      authRequired: true,
      user,
      desk: { ...desk, scoutFamiliarity: familiarity },
    });
    assert.ok(payload);
    writeDeskBootCache(payload, store);
    assert.deepEqual(readDeskBootCache(store)?.desk?.scoutFamiliarity, familiarity);
    assert.equal(store.getItem(DESK_BOOT_KEY)?.includes("scoutFamiliarity"), true);
    writeDeskBootCache(payload);
    assert.deepEqual(peekDeskBootCache("u1")?.desk?.scoutFamiliarity, familiarity);
    assert.equal(peekDeskBootCache("other-user"), null);
    assert.equal(peekDeskBootCache(null), null);
    clearDeskBootCache();
    clearDeskBootCache(store);
  });

  it("persists a saved receipt and hides it from another account", () => {
    const store = memoryStore();
    const payload = parseDeskBoot({
      ok: true,
      authRequired: true,
      user,
      desk: {
        ...desk,
        interacted: {
          interactions: [
            {
              threadId: "t1",
              author: "@ada",
              at: "2026-09-19T12:00:00.000Z",
              memory: { state: "saved" },
            },
          ],
          activeIds: ["t1"],
        },
      },
    });
    assert.ok(payload);
    writeDeskBootCache(payload, store);
    const read = readDeskBootCache(store);
    assert.equal(read?.desk?.interacted.interactions[0]?.memory?.state, "saved");
    writeDeskBootCache(payload);
    assert.equal(
      peekDeskBootCache("u1")?.desk?.interacted.interactions[0]?.memory?.state,
      "saved",
    );
    assert.equal(peekDeskBootCache("other-user"), null);
    clearDeskBootCache();
    clearDeskBootCache(store);
  });
});
