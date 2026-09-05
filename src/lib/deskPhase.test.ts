import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceApproach,
  approachTabLiveCount,
  emptyDeskBeats,
  initialApproachLock,
} from "./deskPhase.ts";

describe("emptyDeskBeats", () => {
  it("returns all-false beats with no fork choice", () => {
    assert.deepEqual(emptyDeskBeats(), {
      scoutReplyDone: false,
      organicReplyDone: false,
      forkChoice: null,
      forkDone: false,
    });
  });
});

describe("Approach lock", () => {
  const inventory = {
    scoutId: "scout-2",
    suggestionId: "suggested-1",
    canPresentForYou: true,
  };

  it("locks an existing For You wait before boot inventory", () => {
    assert.deepEqual(
      initialApproachLock({
        forYouHeld: true,
        paceLocked: false,
        scoutId: "scout-1",
        fallback: "for_you",
      }),
      { phase: "silent_refuel", cardId: null, surface: "for_you" },
    );
  });

  it("locks a boot Scout card, otherwise For You", () => {
    assert.deepEqual(
      initialApproachLock({
        forYouHeld: false,
        paceLocked: false,
        scoutId: "scout-1",
        fallback: "for_you",
      }),
      { phase: "scout_reply", cardId: "scout-1", surface: null },
    );
    assert.deepEqual(
      initialApproachLock({
        forYouHeld: false,
        paceLocked: false,
        scoutId: null,
        fallback: "for_you",
      }),
      { phase: "silent_refuel", cardId: null, surface: "for_you" },
    );
    assert.deepEqual(
      initialApproachLock({
        forYouHeld: false,
        paceLocked: true,
        scoutId: "scout-1",
        fallback: "for_you",
      }),
      { phase: "hold", cardId: null, surface: "for_you" },
    );
  });

  it("locks the first-paint gate surface", () => {
    assert.deepEqual(
      initialApproachLock({
        forYouHeld: false,
        paceLocked: false,
        scoutId: null,
        fallback: "link_x",
      }),
      { phase: "silent_refuel", cardId: null, surface: "link_x" },
    );
  });

  it("changes only for legal buttons and picks inventory once", () => {
    const scout = {
      phase: "scout_reply",
      cardId: "scout-1",
      surface: null,
    } as const;
    assert.strictEqual(
      advanceApproach(scout, { type: "next" }, inventory),
      scout,
    );
    assert.deepEqual(
      advanceApproach(scout, { type: "skip" }, inventory),
      { phase: "scout_reply", cardId: "scout-2", surface: null },
    );
    assert.deepEqual(
      advanceApproach(
        scout,
        { type: "skip" },
        { scoutId: "scout-1", suggestionId: null, canPresentForYou: false },
      ),
      { phase: "done_for_now", cardId: null, surface: null },
    );
    assert.deepEqual(
      advanceApproach(scout, { type: "mark" }, inventory),
      { phase: "hold", cardId: null, surface: "for_you" },
    );
    assert.deepEqual(
      advanceApproach(
        { phase: "silent_refuel", cardId: null, surface: "for_you" },
        { type: "next" },
        inventory,
      ),
      { phase: "scout_reply", cardId: "scout-2", surface: null },
    );
    assert.deepEqual(
      advanceApproach(
        { phase: "hold", cardId: null, surface: "for_you" },
        { type: "next" },
        inventory,
      ),
      { phase: "scout_reply", cardId: "scout-2", surface: null },
    );
  });

  it("routes posted Suggested through Fork and Original", () => {
    const fork = advanceApproach(
      { phase: "organic_reply", cardId: "suggested-1", surface: null },
      { type: "posted" },
      inventory,
    );
    assert.deepEqual(fork, { phase: "fork", cardId: null, surface: null });
    assert.deepEqual(
      advanceApproach(
        fork,
        { type: "fork", choice: "original" },
        inventory,
      ),
      { phase: "original", cardId: null, surface: null },
    );
    assert.deepEqual(
      advanceApproach(
        fork,
        { type: "fork", choice: "reply" },
        inventory,
      ),
      { phase: "scout_reply", cardId: "scout-2", surface: null },
    );
    assert.deepEqual(
      advanceApproach(
        { phase: "original", cardId: null, surface: null },
        { type: "posted" },
        inventory,
      ),
      { phase: "scout_reply", cardId: "scout-2", surface: null },
    );
    assert.deepEqual(
      advanceApproach(
        { phase: "organic_reply", cardId: "suggested-1", surface: null },
        { type: "skip" },
        { scoutId: null, suggestionId: "suggested-1", canPresentForYou: false },
      ),
      { phase: "done_for_now", cardId: null, surface: null },
    );
  });

  it("bypasses a hold into the next card or For You", () => {
    assert.deepEqual(
      advanceApproach(
        { phase: "hold", cardId: null, surface: "for_you" },
        { type: "bypass" },
        { scoutId: "scout-2", suggestionId: null, canPresentForYou: false },
      ),
      { phase: "scout_reply", cardId: "scout-2", surface: null },
    );
    assert.deepEqual(
      advanceApproach(
        { phase: "hold", cardId: null, surface: "for_you" },
        { type: "bypass" },
        { scoutId: null, suggestionId: null, canPresentForYou: true },
      ),
      { phase: "silent_refuel", cardId: null, surface: "for_you" },
    );
  });

  it("reopens a completed lock when new inventory lands", () => {
    assert.deepEqual(
      advanceApproach(
        { phase: "done_for_now", cardId: null, surface: null },
        { type: "next" },
        { scoutId: "scout-3", suggestionId: null, canPresentForYou: false },
      ),
      { phase: "scout_reply", cardId: "scout-3", surface: null },
    );
  });
});

describe("approachTabLiveCount", () => {
  it("counts the card on the desk", () => {
    assert.equal(
      approachTabLiveCount({
        phase: "scout_reply",
        hasScoutCard: true,
        hasSuggestion: true,
      }),
      1,
    );
    assert.equal(
      approachTabLiveCount({
        phase: "organic_reply",
        hasScoutCard: false,
        hasSuggestion: true,
      }),
      1,
    );
    assert.equal(
      approachTabLiveCount({
        phase: "silent_refuel",
        hasScoutCard: false,
        hasSuggestion: false,
      }),
      0,
    );
    assert.equal(
      approachTabLiveCount({
        phase: "silent_refuel",
        hasScoutCard: true,
        hasSuggestion: false,
        holdForYouTask: true,
      }),
      1,
    );
  });
});
