import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canPresentForYouTask,
  shouldHoldForYouTask,
} from "./forYouTask.ts";

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
