import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceApproach,
  approachGate,
  approachTabLiveCount,
  emptyDeskBeats,
  initialApproachLock,
  isForYouTask,
  normalizeApproachLock,
  type ApproachLock,
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
    assert.deepEqual(
      advanceApproach(scout, { type: "next" }, inventory),
      { phase: "organic_reply", cardId: "suggested-1", surface: null },
    );
    assert.deepEqual(
      advanceApproach(scout, { type: "skip" }, inventory),
      { phase: "organic_reply", cardId: "suggested-1", surface: null },
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

  it("For You Next with no stock collects instead of opening another wait", () => {
    const inventoryWithoutCards = {
      scoutId: null,
      suggestionId: null,
      canPresentForYou: true,
    };
    for (const phase of ["silent_refuel", "hold"] as const) {
      assert.deepEqual(
        advanceApproach(
          { phase, cardId: null, surface: "for_you" },
          { type: "next" },
          inventoryWithoutCards,
        ),
        { phase: "done_for_now", cardId: null, surface: null },
      );
    }
  });

  it("For You Next hands off to an unused suggestion when Scout is empty", () => {
    assert.deepEqual(
      advanceApproach(
        { phase: "silent_refuel", cardId: null, surface: "for_you" },
        { type: "next" },
        {
          scoutId: null,
          suggestionId: "original-1",
          canPresentForYou: true,
        },
      ),
      { phase: "organic_reply", cardId: "original-1", surface: null },
    );
  });

  it("Next honors the reply minute on a For You task and on a detected Scout", () => {
    const paced = { ...inventory, paceLocked: true };
    const forYou = {
      phase: "silent_refuel",
      cardId: null,
      surface: "for_you",
    } as const;
    const hold = { phase: "hold", cardId: null, surface: "for_you" } as const;
    assert.equal(advanceApproach(forYou, { type: "next" }, paced), forYou);
    assert.equal(advanceApproach(hold, { type: "next" }, paced), hold);
    assert.deepEqual(
      advanceApproach(
        { phase: "scout_reply", cardId: "scout-1", surface: null },
        { type: "next" },
        paced,
      ),
      { phase: "hold", cardId: null, surface: "for_you" },
    );
    assert.deepEqual(
      advanceApproach(forYou, { type: "bypass" }, paced),
      { phase: "scout_reply", cardId: "scout-2", surface: null },
    );
  });

  it("falls back to the gate card, never done_for_now, when the feed is closed", () => {
    assert.deepEqual(
      advanceApproach(
        { phase: "scout_reply", cardId: "scout-1", surface: null },
        { type: "skip" },
        {
          scoutId: null,
          suggestionId: null,
          canPresentForYou: false,
          gate: "link_x",
        },
      ),
      { phase: "silent_refuel", cardId: null, surface: "link_x" },
    );
  });

  it("routes posted Suggested to the next scout, For You, or done_for_now", () => {
    const posted = {
      phase: "organic_reply",
      cardId: "suggested-1",
      surface: null,
    } as const;
    assert.deepEqual(
      advanceApproach(posted, { type: "posted" }, inventory),
      { phase: "scout_reply", cardId: "scout-2", surface: null },
    );
    assert.deepEqual(
      advanceApproach(
        posted,
        { type: "posted" },
        { scoutId: null, suggestionId: "suggested-2", canPresentForYou: false },
      ),
      { phase: "organic_reply", cardId: "suggested-2", surface: null },
    );
    assert.deepEqual(
      advanceApproach(
        posted,
        { type: "posted" },
        { scoutId: null, suggestionId: "suggested-1", canPresentForYou: true },
      ),
      { phase: "silent_refuel", cardId: null, surface: "for_you" },
    );
    assert.deepEqual(
      advanceApproach(
        posted,
        { type: "posted" },
        { scoutId: null, suggestionId: "suggested-1", canPresentForYou: false },
      ),
      { phase: "done_for_now", cardId: null, surface: null },
    );
    assert.deepEqual(
      advanceApproach(
        posted,
        { type: "skip" },
        { scoutId: null, suggestionId: "suggested-1", canPresentForYou: false },
      ),
      { phase: "done_for_now", cardId: null, surface: null },
    );
  });

  it("bypasses a hold into the next card or collecting idle", () => {
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
      { phase: "done_for_now", cardId: null, surface: null },
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

describe("normalizeApproachLock", () => {
  const open = {
    gate: null,
    scoutId: "scout-1",
    suggestionId: null,
    canOpenForYou: true,
  };
  const empty = { ...open, scoutId: null };

  it("keeps a valid active task by identity", () => {
    const locks: ApproachLock[] = [
      { phase: "scout_reply", cardId: "scout-9", surface: null },
      { phase: "organic_reply", cardId: "suggested-9", surface: null },
      { phase: "silent_refuel", cardId: null, surface: "for_you" },
      { phase: "hold", cardId: null, surface: "for_you" },
    ];
    for (const lock of locks) {
      assert.equal(normalizeApproachLock(lock, open), lock);
      assert.equal(normalizeApproachLock(lock, empty), lock);
    }
  });

  it("keeps Collecting on restore until Scout or a leftover lands", () => {
    const done = {
      phase: "done_for_now",
      cardId: null,
      surface: null,
    } as const;
    assert.deepEqual(normalizeApproachLock(done, open), {
      phase: "scout_reply",
      cardId: "scout-1",
      surface: null,
    });
    assert.equal(normalizeApproachLock(done, empty), done);
    assert.deepEqual(normalizeApproachLock(done, { ...empty, suggestionId: "leftover" }), {
      phase: "organic_reply", cardId: "leftover", surface: null,
    });
  });

  it("turns legacy usage and wait surfaces into the For You task", () => {
    for (const surface of ["usage", "wait"] as const) {
      assert.deepEqual(
        normalizeApproachLock(
          { phase: "silent_refuel", cardId: null, surface },
          empty,
        ),
        { phase: "silent_refuel", cardId: null, surface: "for_you" },
      );
    }
  });

  it("resolves a cleared gate into the available task", () => {
    const linkX = {
      phase: "silent_refuel",
      cardId: null,
      surface: "link_x",
    } as const;
    assert.deepEqual(normalizeApproachLock(linkX, open), {
      phase: "scout_reply",
      cardId: "scout-1",
      surface: null,
    });
    assert.deepEqual(normalizeApproachLock(linkX, empty), {
      phase: "silent_refuel",
      cardId: null,
      surface: "for_you",
    });
  });

  it("replaces a For You task with the gate when a prerequisite appears", () => {
    const gated = { ...empty, gate: "link_x", canOpenForYou: false } as const;
    assert.deepEqual(
      normalizeApproachLock(
        { phase: "silent_refuel", cardId: null, surface: "for_you" },
        gated,
      ),
      { phase: "silent_refuel", cardId: null, surface: "link_x" },
    );
    const stale = { phase: "silent_refuel", cardId: null, surface: "settings" } as const;
    assert.deepEqual(normalizeApproachLock(stale, gated), {
      phase: "silent_refuel",
      cardId: null,
      surface: "link_x",
    });
    assert.deepEqual(normalizeApproachLock(
      { phase: "done_for_now", cardId: null, surface: null },
      gated,
    ), {
      phase: "silent_refuel",
      cardId: null,
      surface: "link_x",
    });
    const active = {
      phase: "scout_reply",
      cardId: "scout-1",
      surface: null,
    } as const;
    assert.equal(normalizeApproachLock(active, gated), active);
  });

  it("repairs legacy needs_onboarding and malformed combos", () => {
    const malformed: ApproachLock[] = [
      { phase: "needs_onboarding", cardId: null, surface: null },
      { phase: "scout_reply", cardId: null, surface: null },
      { phase: "organic_reply", cardId: null, surface: null },
      { phase: "silent_refuel", cardId: null, surface: null },
    ];
    for (const lock of malformed) {
      assert.deepEqual(normalizeApproachLock(lock, empty), {
        phase: "silent_refuel",
        cardId: null,
        surface: "for_you",
      });
    }
    assert.deepEqual(
      normalizeApproachLock(
        { phase: "hold", cardId: "stray", surface: null },
        empty,
      ),
      { phase: "hold", cardId: null, surface: "for_you" },
    );
  });

  it("names the gate from the prerequisites, never from Scout state", () => {
    assert.equal(approachGate({ needsXLink: true, hasAgenda: false }), "link_x");
    assert.equal(
      approachGate({ needsXLink: false, hasAgenda: false }),
      "settings",
    );
    assert.equal(approachGate({ needsXLink: false, hasAgenda: true }), null);
  });

  it("treats hold and silent_refuel/for_you as one For You task", () => {
    assert.equal(
      isForYouTask({ phase: "hold", cardId: null, surface: "for_you" }),
      true,
    );
    assert.equal(
      isForYouTask({ phase: "silent_refuel", cardId: null, surface: "for_you" }),
      true,
    );
    assert.equal(
      isForYouTask({ phase: "silent_refuel", cardId: null, surface: "link_x" }),
      false,
    );
    assert.equal(
      isForYouTask({ phase: "scout_reply", cardId: "s", surface: null }),
      false,
    );
  });
});

describe("approachTabLiveCount", () => {
  it("is 1 for a real For You task whatever phase carries it", () => {
    for (const phase of ["silent_refuel", "hold", "done_for_now"] as const) {
      assert.equal(
        approachTabLiveCount({
          phase,
          hasScoutCard: false,
          hasSuggestion: false,
          holdForYouTask: true,
          refillState: "terminal_empty",
        }),
        1,
      );
    }
  });

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
    assert.equal(
      approachTabLiveCount({
        phase: "done_for_now",
        hasScoutCard: false,
        hasSuggestion: false,
      }),
      0,
    );
    for (const refillState of ["queued", "waiting", "flying"] as const) {
      assert.equal(
        approachTabLiveCount({
          phase: "done_for_now",
          hasScoutCard: false,
          hasSuggestion: false,
          refillState,
        }),
        1,
      );
    }
    assert.equal(
      approachTabLiveCount({
        phase: "done_for_now",
        hasScoutCard: false,
        hasSuggestion: false,
        refillState: "terminal_empty",
      }),
      0,
    );
  });
});

describe("S10 skip-next", () => {
  const firstScout = {
    phase: "scout_reply",
    cardId: "scout-1",
    surface: null,
  } as const;

  it("Skip of a scout alternates to For You when no suggestion exists", () => {
    assert.deepEqual(
      advanceApproach(
        firstScout,
        { type: "skip" },
        { scoutId: "scout-2", suggestionId: null, canPresentForYou: true },
      ),
      { phase: "silent_refuel", cardId: null, surface: "for_you" },
    );
  });

  it("last Skip with no other scout presents For You when canPresentForYou; otherwise done_for_now", () => {
    assert.deepEqual(
      advanceApproach(
        firstScout,
        { type: "skip" },
        { scoutId: "scout-1", suggestionId: null, canPresentForYou: true },
      ),
      { phase: "silent_refuel", cardId: null, surface: "for_you" },
    );
    assert.deepEqual(
      advanceApproach(
        firstScout,
        { type: "skip" },
        { scoutId: "scout-1", suggestionId: null, canPresentForYou: false },
      ),
      { phase: "done_for_now", cardId: null, surface: null },
    );
  });

  it("For You Next collects while last Scout Skip may land on For You", () => {
    const emptyTank = {
      scoutId: null,
      suggestionId: null,
      canPresentForYou: true,
    };
    assert.deepEqual(
      advanceApproach(
        { phase: "silent_refuel", cardId: null, surface: "for_you" },
        { type: "next" },
        emptyTank,
      ),
      { phase: "done_for_now", cardId: null, surface: null },
    );
    assert.deepEqual(
      advanceApproach(firstScout, { type: "skip" }, emptyTank),
      { phase: "silent_refuel", cardId: null, surface: "for_you" },
    );
  });

  it("last Skip badge is 1 while refill is queued, waiting, or flying; terminal_empty is 0", () => {
    const lastSkip = advanceApproach(
      firstScout,
      { type: "skip" },
      { scoutId: "scout-1", suggestionId: null, canPresentForYou: false },
    );
    assert.deepEqual(lastSkip, {
      phase: "done_for_now",
      cardId: null,
      surface: null,
    });
    for (const refillState of ["queued", "waiting", "flying"] as const) {
      assert.equal(
        approachTabLiveCount({
          phase: lastSkip.phase,
          hasScoutCard: false,
          hasSuggestion: false,
          refillState,
        }),
        1,
      );
    }
    assert.equal(
      approachTabLiveCount({
        phase: lastSkip.phase,
        hasScoutCard: false,
        hasSuggestion: false,
        refillState: "terminal_empty",
      }),
      0,
    );
  });

  it("Mark on a scout lock holds For You", () => {
    assert.deepEqual(
      advanceApproach(
        firstScout,
        { type: "mark" },
        { scoutId: "scout-2", suggestionId: null, canPresentForYou: true },
      ),
      { phase: "hold", cardId: null, surface: "for_you" },
    );
  });
});
