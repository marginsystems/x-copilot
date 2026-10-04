import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import {
  APPROACH_TASK_CARD_ID_MAX,
  approachTaskLockFromBody,
  getApproachTask,
  setApproachTask,
} from "./approachTaskStore.ts";

await describe("approach task store", async () => {
  let temp: TempPlatformDb;
  let userId: string;

  beforeEach(() => {
    temp = openTempPlatformDb("x-approach-task-");
    userId = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-task",
      email: "task@example.com",
      emailVerified: true,
    }).id;
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  await it("reads a full lock and rejects a malformed one", () => {
    assert.deepEqual(approachTaskLockFromBody({ phase: "scout_reply", cardId: "c1", surface: null }), {
      phase: "scout_reply",
      cardId: "c1",
      surface: null,
    });
    assert.deepEqual(approachTaskLockFromBody({ phase: "hold", cardId: null, surface: "for_you" }), {
      phase: "hold",
      cardId: null,
      surface: "for_you",
    });
    for (const bad of [
      null,
      "hold",
      { phase: "nope", cardId: null, surface: null },
      { phase: "hold", cardId: 3, surface: null },
      { phase: "hold", cardId: "", surface: null },
      { phase: "hold", cardId: "x".repeat(APPROACH_TASK_CARD_ID_MAX + 1), surface: null },
      { phase: "hold", cardId: null, surface: "nope" },
      { phase: "hold", cardId: null },
    ]) {
      assert.equal(approachTaskLockFromBody(bad), null);
    }
  });

  await it("has no task until one is written", () => {
    assert.equal(getApproachTask(userId), null);
  });

  await it("raises the version only when the lock or its owner changes", () => {
    const forYou = { phase: "hold" as const, cardId: null, surface: "for_you" as const };
    const scout = { phase: "scout_reply" as const, cardId: "c1", surface: null };
    assert.equal(setApproachTask(userId, forYou, "desk").version, 1);
    assert.equal(setApproachTask(userId, forYou, "desk").version, 1);
    assert.equal(setApproachTask(userId, scout, "desk").version, 2);
    assert.equal(setApproachTask(userId, scout, "server").version, 3);
    assert.deepEqual(getApproachTask(userId)?.lock, scout);
    assert.equal(getApproachTask(userId)?.owner, "server");
  });
});
