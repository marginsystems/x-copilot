import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canPresentForYouTask,
  clearForYouWait,
  hasDetectedForYouPost,
  readForYouWait,
  snapshotForYouWait,
  shouldHoldForYouTask,
  writeForYouWait,
} from "./forYouTask.ts";

const coaching = {
  postsToday: 2,
  postAt: ["2026-09-05T12:00:00.000Z"],
  replyAt: ["2026-09-05T11:00:00.000Z"],
};

describe("canPresentForYouTask", () => {
  const ready = {
    needsXLink: false,
    hasAgenda: true,
    grounded: false,
    cooldownRemaining: 0,
  };

  it("presents when X is linked, agenda is set, and Scout is not gated", () => {
    assert.equal(canPresentForYouTask(ready), true);
  });

  it("hides when X is unlinked, agenda is missing, or Scout is gated", () => {
    assert.equal(canPresentForYouTask({ ...ready, needsXLink: true }), false);
    assert.equal(canPresentForYouTask({ ...ready, hasAgenda: false }), false);
    assert.equal(canPresentForYouTask({ ...ready, grounded: true }), false);
    assert.equal(
      canPresentForYouTask({ ...ready, cooldownRemaining: 12 }),
      false,
    );
  });
});

describe("shouldHoldForYouTask", () => {
  it("arms when both tanks are empty and For You can present", () => {
    assert.equal(
      shouldHoldForYouTask({
        held: false,
        tanksEmpty: true,
        canPresent: true,
      }),
      true,
    );
  });

  it("stays held after Scout fills the tank", () => {
    assert.equal(
      shouldHoldForYouTask({
        held: true,
        tanksEmpty: false,
        canPresent: true,
      }),
      true,
    );
  });

  it("clears after Next when a scouted card is ready", () => {
    assert.equal(
      shouldHoldForYouTask({
        held: false,
        tanksEmpty: false,
        canPresent: true,
      }),
      false,
    );
  });

  it("stays held while Scout cooldown prevents presenting", () => {
    assert.equal(
      shouldHoldForYouTask({
        held: true,
        tanksEmpty: false,
        canPresent: false,
      }),
      true,
    );
  });

  it("does not arm when For You cannot present", () => {
    assert.equal(
      shouldHoldForYouTask({
        held: false,
        tanksEmpty: true,
        canPresent: false,
      }),
      false,
    );
  });

  it("does not arm after skip or not interested on a scouted card", () => {
    assert.equal(
      shouldHoldForYouTask({
        held: false,
        tanksEmpty: true,
        canPresent: true,
        arm: false,
      }),
      false,
    );
  });

  it("stays held when the operator was already on the wait", () => {
    assert.equal(
      shouldHoldForYouTask({
        held: true,
        tanksEmpty: true,
        canPresent: true,
        arm: false,
      }),
      true,
    );
  });
});

describe("For You wait detection", () => {
  it("detects a newer post after a UTC day rollover", () => {
    assert.equal(
      hasDetectedForYouPost(
        {
          postsToday: 2,
          postAt: "2026-09-04T12:00:00.000Z",
          replyAt: null,
        },
        { postsToday: 1, postAt: ["2026-09-05T08:00:00.000Z"] },
      ),
      true,
    );
  });

  it("detects a newer reply without a new original", () => {
    assert.equal(
      hasDetectedForYouPost(
        {
          postsToday: 2,
          postAt: "2026-09-05T10:00:00.000Z",
          replyAt: "2026-09-05T09:00:00.000Z",
        },
        {
          postsToday: 2,
          postAt: ["2026-09-05T10:00:00.000Z"],
          replyAt: ["2026-09-05T11:00:00.000Z"],
        },
      ),
      true,
    );
  });

  it("does not detect an unchanged baseline and handles missing coaching", () => {
    const snapshot = snapshotForYouWait(coaching)!;
    assert.equal(hasDetectedForYouPost(snapshot, coaching), false);
    assert.equal(hasDetectedForYouPost(snapshot, null), false);
  });

  it("detects activity against a conservative late-coaching baseline", () => {
    assert.equal(
      hasDetectedForYouPost(
        { postsToday: 0, postAt: null, replyAt: null },
        { postsToday: 1, postAt: ["2026-09-05T12:00:00.000Z"] },
      ),
      true,
    );
  });

  it("round-trips a held wait through session storage", () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    const wait = { held: true as const, snapshot: snapshotForYouWait(coaching) };
    writeForYouWait(wait);
    assert.deepEqual(readForYouWait(), wait);
    clearForYouWait();
    assert.equal(readForYouWait(), null);
  });
});
