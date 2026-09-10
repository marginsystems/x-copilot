import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  reconcileApproachGate,
  restoreApproachTask,
  shouldAutoAdvanceIdle,
  transitionApproachTask,
  type ApproachTaskState,
} from "./approachTask.ts";
import { eligibleScoutCards, shouldArmScoutOnBoot, shouldBackgroundScout } from "./deskRefuel.ts";
import { advanceApproach, type ApproachLock } from "./deskPhase.ts";
import {
  forYouWaitDetected,
  openForYouWait,
  settleForYouWait,
} from "./forYouTask.ts";
import { presentApproach } from "../desk/approachPresenter.ts";
import {
  FYP_DETECTED_COPY,
  FYP_DETECTING_COPY,
  type ForYouSuggestion,
} from "./forYou.ts";

const OWNER = "operator-1";
const T0 = Date.parse("2026-09-07T10:00:00.000Z");
const coaching = {
  postsToday: 1,
  postAt: ["2026-09-07T09:00:00.000Z"],
  replyAt: ["2026-09-07T09:30:00.000Z"],
};
const open = {
  gate: null,
  scoutId: null,
  suggestionId: null,
  canOpenForYou: true,
};
const FOR_YOU: ApproachLock = {
  phase: "silent_refuel",
  cardId: null,
  surface: "for_you",
};

function present(
  state: ApproachTaskState,
  extra: Partial<Parameters<typeof presentApproach>[0]> = {},
) {
  return presentApproach({
    phase: state.lock.phase,
    surface: state.lock.surface,
    scout: null,
    scoutDetected: false,
    suggestion: null,
    suggestionDetected: false,
    forYou: state.wait
      ? { detected: forYouWaitDetected(state.wait, coaching) }
      : null,
    remainingMs: 0,
    ...extra,
  });
}

describe("restored lock", () => {
  it("recovers the stored For You wait together with its lock", () => {
    const storedWait = openForYouWait({ owner: OWNER, coaching, now: T0 });
    const state = restoreApproachTask({
      stored: FOR_YOU,
      storedWait,
      normalize: open,
      paceLocked: false,
      task: { owner: OWNER, coaching, now: T0 + 60_000 },
    });
    assert.equal(state.lock, FOR_YOU);
    assert.equal(state.wait, storedWait);
    assert.equal(present(state).detector, "for_you");
  });

  it("establishes a fresh baseline when no wait was stored, before claiming detection", () => {
    const state = restoreApproachTask({
      stored: FOR_YOU,
      storedWait: null,
      normalize: open,
      paceLocked: false,
      task: { owner: OWNER, coaching, now: T0 },
    });
    assert.equal(state.wait?.enteredAt, "2026-09-07T10:00:00.000Z");
    assert.equal(state.wait?.detectedAt, null);
    assert.equal(forYouWaitDetected(state.wait!, coaching), false);
  });

  it("drops a wait that belongs to another owner or to a non-For You lock", () => {
    const foreign = openForYouWait({ owner: "someone-else", coaching, now: T0 });
    const restored = restoreApproachTask({
      stored: FOR_YOU,
      storedWait: foreign,
      normalize: open,
      paceLocked: false,
      task: { owner: OWNER, coaching, now: T0 },
    });
    assert.notEqual(restored.wait, foreign);
    assert.equal(restored.wait?.owner, OWNER);
    const scout = restoreApproachTask({
      stored: { phase: "scout_reply", cardId: "A", surface: null },
      storedWait: openForYouWait({ owner: OWNER, coaching, now: T0 }),
      normalize: { ...open, scoutId: "A" },
      paceLocked: false,
      task: { owner: OWNER, coaching, now: T0 },
    });
    assert.equal(scout.wait, null);
    assert.equal(present(scout, { scout: null }).detector, null);
  });

  it("restores Collecting without reopening For You when the tank is empty", () => {
    const state = restoreApproachTask({
      stored: { phase: "done_for_now", cardId: null, surface: null },
      storedWait: null,
      normalize: open,
      paceLocked: false,
      task: { owner: OWNER, coaching, now: T0 },
    });
    assert.deepEqual(state.lock, { phase: "done_for_now", cardId: null, surface: null });
    assert.equal(state.wait, null);
    const view = present(state);
    assert.equal(view.verb, "Collecting");
    assert.equal(view.forYou, null);
  });
});

describe("gate resolution", () => {
  const gated = { ...open, gate: "link_x", canOpenForYou: false } as const;

  it("shows the gate while X is unlinked, then the task once it clears", () => {
    const boot = restoreApproachTask({
      stored: null,
      storedWait: null,
      normalize: gated,
      paceLocked: false,
      task: { owner: OWNER, coaching, now: T0 },
    });
    assert.deepEqual(boot.lock, {
      phase: "silent_refuel",
      cardId: null,
      surface: "link_x",
    });
    assert.equal(boot.wait, null);
    assert.equal(present(boot).kind, "gate");
    assert.equal(present(boot).detector, null);

    const linked = reconcileApproachGate(boot, open, {
      owner: OWNER,
      coaching,
      now: T0 + 5_000,
    });
    assert.deepEqual(linked.lock, FOR_YOU);
    assert.equal(linked.wait?.enteredAt, "2026-09-07T10:00:05.000Z");
    assert.equal(present(linked).kind, "for_you");
  });

  it("prefers stock over the wait when the gate clears", () => {
    const boot = restoreApproachTask({
      stored: { phase: "silent_refuel", cardId: null, surface: "settings" },
      storedWait: null,
      normalize: { ...open, gate: "settings", canOpenForYou: false },
      paceLocked: false,
      task: { owner: OWNER, coaching, now: T0 },
    });
    const ready = reconcileApproachGate(
      boot,
      { ...open, scoutId: "A" },
      { owner: OWNER, coaching, now: T0 },
    );
    assert.deepEqual(ready.lock, {
      phase: "scout_reply",
      cardId: "A",
      surface: null,
    });
    assert.equal(ready.wait, null);
  });

  it("does not touch an active task when nothing changed", () => {
    const state = restoreApproachTask({
      stored: FOR_YOU,
      storedWait: null,
      normalize: open,
      paceLocked: false,
      task: { owner: OWNER, coaching, now: T0 },
    });
    assert.equal(
      reconcileApproachGate(state, { ...open, scoutId: "landed" }, {
        owner: OWNER,
        coaching,
      }),
      state,
    );
  });
});

describe("cooldown expiry", () => {
  it("a stored cooldown wait restores as For You with Open For You and Next", () => {
    const state = restoreApproachTask({
      stored: { phase: "silent_refuel", cardId: null, surface: "wait" },
      storedWait: null,
      normalize: open,
      paceLocked: false,
      task: { owner: OWNER, coaching, now: T0 },
    });
    assert.deepEqual(state.lock, FOR_YOU);
    const view = present(state);
    assert.equal(view.kind, "for_you");
    assert.equal(view.verb, "For You");
    assert.equal(view.forYou?.showNext, true);
    assert.equal(view.forYou?.detected, false);
    assert.equal(view.why, "");
    assert.equal(view.forYou?.status, FYP_DETECTING_COPY);
  });
});

describe("late baseline", () => {
  it("coaching that arrives after entry cannot absorb a post made since entry", () => {
    const state = restoreApproachTask({
      stored: FOR_YOU,
      storedWait: null,
      normalize: open,
      paceLocked: false,
      task: { owner: OWNER, coaching: null, now: T0 },
    });
    assert.equal(state.wait?.snapshot, null);
    const late = {
      postsToday: 2,
      postAt: ["2026-09-07T10:00:20.000Z"],
      replyAt: coaching.replyAt,
    };
    const settled = settleForYouWait(state.wait!, late, T0 + 30_000);
    assert.equal(forYouWaitDetected(settled, late), true);
    const view = present({ lock: state.lock, wait: settled }, {
      forYou: { detected: forYouWaitDetected(settled, late) },
    });
    assert.equal(view.why, "");
    assert.equal(view.forYou?.status, FYP_DETECTED_COPY);
    assert.equal(view.detector, null);
  });
});

describe("detection with a landing", () => {
  it("new stock updates inventory only; the detected wait keeps its card until Next", () => {
    const wait = settleForYouWait(
      openForYouWait({ owner: OWNER, coaching, now: T0 }),
      { ...coaching, replyAt: ["2026-09-07T10:01:00.000Z"] },
      T0 + 70_000,
    );
    const state: ApproachTaskState = { lock: FOR_YOU, wait };
    const landed = { ...open, scoutId: "landed-1" };
    assert.equal(
      reconcileApproachGate(state, landed, { owner: OWNER, coaching }),
      state,
    );
    const view = present(state, { forYou: { detected: true } });
    assert.equal(view.kind, "for_you");
    assert.equal(view.forYou?.detected, true);
    assert.equal(view.forYou?.showNext, true);
    assert.equal(view.detector, null);
    const released = transitionApproachTask(
      state,
      { type: "next" },
      {
        scoutId: "landed-1",
        suggestionId: null,
        canPresentForYou: true,
      },
      { owner: OWNER, coaching },
    );
    assert.deepEqual(released.lock, {
      phase: "scout_reply",
      cardId: "landed-1",
      surface: null,
    });
    assert.equal(released.wait, null);
  });
});

describe("Next with an empty tank", () => {
  it("leaves a completed For You wait for collecting idle", () => {
    const first = restoreApproachTask({
      stored: FOR_YOU,
      storedWait: null,
      normalize: open,
      paceLocked: false,
      task: { owner: OWNER, coaching, now: T0 },
    });
    const detected = {
      lock: first.lock,
      wait: settleForYouWait(
        first.wait!,
        { ...coaching, postsToday: 2, postAt: ["2026-09-07T10:02:00.000Z"] },
        T0 + 130_000,
      ),
    };
    const second = transitionApproachTask(
      detected,
      { type: "next" },
      { scoutId: null, suggestionId: null, canPresentForYou: true },
      {
        owner: OWNER,
        coaching: { ...coaching, postsToday: 2 },
        now: T0 + 131_000,
      },
    );
    assert.deepEqual(second.lock, {
      phase: "done_for_now",
      cardId: null,
      surface: null,
    });
    assert.equal(second.wait, null);
    assert.equal(present(second).kind, "scout_missing");
    assert.equal(present(second).detector, null);
  });

  it("reopens collecting idle for either scout or suggestion inventory", () => {
    assert.equal(shouldAutoAdvanceIdle("done_for_now", null, 1, null), true);
    assert.equal(shouldAutoAdvanceIdle("done_for_now", null, 0, "original_1"), true);
    assert.equal(shouldAutoAdvanceIdle("done_for_now", null, 0, null), false);
    assert.equal(shouldAutoAdvanceIdle("scout_reply", "scout-1", 1, "original_1"), false);

    const next = transitionApproachTask(
      {
        lock: { phase: "done_for_now", cardId: null, surface: null },
        wait: null,
      },
      { type: "next" },
      { scoutId: null, suggestionId: "original_1", canPresentForYou: true },
      { owner: OWNER, coaching },
    );
    assert.deepEqual(next.lock, {
      phase: "organic_reply",
      cardId: "original_1",
      surface: null,
    });
  });
});

describe("same-phase Scout release", () => {
  it("fills the empty Scout lock on eligible stock only and never opens a wait", () => {
    let state: ApproachTaskState = {
      lock: { phase: "scout_reply", cardId: "A", surface: null }, wait: null,
    };
    const inventory = { scoutId: null, suggestionId: "original-1", canPresentForYou: true };
    state = transitionApproachTask(state, { type: "skip" }, inventory, { owner: OWNER });
    assert.deepEqual(state.lock, { phase: "scout_reply", cardId: null, surface: null });
    assert.equal(state.wait, null);
    assert.equal(present(state).verb, "Collecting");
    assert.equal(present(state).detector, null);
    assert.equal(shouldAutoAdvanceIdle(state.lock.phase, state.lock.cardId, 0, "original-1"), false);
    assert.equal(transitionApproachTask(state, { type: "next" }, inventory, { owner: OWNER }), state);
    assert.equal(shouldAutoAdvanceIdle(state.lock.phase, state.lock.cardId, 1, "original-1"), true);
    state = transitionApproachTask(state, { type: "next" }, {
      ...inventory, scoutId: "B", paceLocked: true,
    }, { owner: OWNER });
    assert.deepEqual(state.lock, { phase: "scout_reply", cardId: "B", surface: null });
    assert.equal(state.wait, null);
    assert.equal(shouldAutoAdvanceIdle(state.lock.phase, state.lock.cardId, 2, "original-1"), false);
  });

  it("A detected, Next to B, Skip B before hydrate never resurfaces A", () => {
    const tank = [{ id: "A" }, { id: "B" }];
    const interacted = new Set(["A"]);
    const released = new Set<string>();
    const stock = () => eligibleScoutCards(tank, interacted, released);
    assert.deepEqual(stock().map((row) => row.id), ["B"]);

    let state: ApproachTaskState = {
      lock: { phase: "scout_reply", cardId: "A", surface: null },
      wait: null,
    };
    const inventory = (excludeId: string | null) => ({
      scoutId: stock().find((row) => row.id !== excludeId)?.id ?? null,
      suggestionId: null,
      canPresentForYou: false,
    });
    state = transitionApproachTask(
      state,
      { type: "next" },
      inventory("A"),
      { owner: OWNER, coaching },
    );
    released.add("A");
    assert.equal(state.lock.cardId, "B");

    state = transitionApproachTask(
      state,
      { type: "skip" },
      inventory("B"),
      { owner: OWNER, coaching },
    );
    released.add("B");
    assert.deepEqual(state.lock, {
      phase: "scout_reply",
      cardId: null,
      surface: null,
    });
    assert.notEqual(state.lock.cardId, "A");
    assert.deepEqual(stock(), []);
  });

  it("the retained detected card is presentation, not stock", () => {
    const tank = [{ id: "A" }];
    assert.deepEqual(eligibleScoutCards(tank, new Set(["A"])), []);
    assert.deepEqual(eligibleScoutCards(tank, new Set()), tank);
  });
});

describe("Hold at zero", () => {
  const hold: ApproachTaskState = {
    lock: { phase: "hold", cardId: null, surface: "for_you" },
    wait: openForYouWait({ owner: OWNER, coaching, now: T0 }),
  };

  it("changes presentation, not card identity", () => {
    const running = present(hold, { remainingMs: 30_000 });
    assert.equal(running.verb, "Hold");
    assert.equal(running.forYou?.holding, true);
    assert.equal(running.forYou?.showNext, false);
    assert.equal(running.showPace, true);
    const over = present(hold, { remainingMs: 0 });
    assert.equal(over.verb, "For You");
    assert.equal(over.forYou?.holding, false);
    assert.equal(over.forYou?.showNext, true);
    assert.equal(over.showPace, false);
    assert.equal(running.detector, over.detector);
  });

  it("Next during the minute is a no-op; after it Next releases", () => {
    const inventory = {
      scoutId: "S",
      suggestionId: null,
      canPresentForYou: true,
    };
    assert.equal(
      transitionApproachTask(
        hold,
        { type: "next" },
        { ...inventory, paceLocked: true },
        { owner: OWNER, coaching },
      ),
      hold,
    );
    const after = transitionApproachTask(
      hold,
      { type: "next" },
      { ...inventory, paceLocked: false },
      { owner: OWNER, coaching },
    );
    assert.equal(after.lock.cardId, "S");
    assert.equal(after.wait, null);
  });
});

describe("Bypass", () => {
  it("clears the wait and stops its poll in the same transition", () => {
    const held: ApproachTaskState = {
      lock: { phase: "hold", cardId: null, surface: "for_you" },
      wait: openForYouWait({ owner: OWNER, coaching, now: T0 }),
    };
    assert.equal(present(held, { remainingMs: 40_000 }).detector, "for_you");
    const next = transitionApproachTask(
      held,
      { type: "bypass" },
      {
        scoutId: "S",
        suggestionId: null,
        canPresentForYou: true,
        paceLocked: true,
      },
      { owner: OWNER, coaching },
    );
    assert.equal(next.lock.phase, "scout_reply");
    assert.equal(next.wait, null);
    const view = present(next, {
      scout: { id: "S", author: "@s", text: "s", url: "https://x.com/s" },
    });
    assert.equal(view.detector, "scout");
    assert.equal(view.forYou, null);
  });

  it("bypass onto an empty tank clears the old wait and collects", () => {
    const held: ApproachTaskState = {
      lock: { phase: "hold", cardId: null, surface: "for_you" },
      wait: openForYouWait({ owner: OWNER, coaching, now: T0 }),
    };
    const next = transitionApproachTask(
      held,
      { type: "bypass" },
      { scoutId: null, suggestionId: null, canPresentForYou: true },
      { owner: OWNER, coaching, now: T0 + 10_000 },
    );
    assert.deepEqual(next.lock, {
      phase: "done_for_now",
      cardId: null,
      surface: null,
    });
    assert.equal(next.wait, null);
  });
});

describe("Scout detection ownership", () => {
  const scout = { id: "A", author: "@a", text: "a", url: "https://x.com/a" };

  it("says detected and stops the poll once the reply is recorded", () => {
    const listening = presentApproach({
      phase: "scout_reply",
      surface: null,
      scout,
      scoutDetected: false,
      suggestion: null,
      suggestionDetected: false,
      forYou: null,
      remainingMs: 0,
    });
    assert.equal(listening.detector, "scout");
    assert.equal(listening.why, "");
    const detected = presentApproach({
      ...listening,
      phase: "scout_reply",
      surface: null,
      scout,
      scoutDetected: true,
      suggestion: null,
      suggestionDetected: false,
      forYou: null,
      remainingMs: 0,
    });
    assert.equal(detected.detector, null);
    assert.equal(detected.why, "");
    assert.equal(detected.badge, 1);
  });

  it("gives a target-backed Suggested reply the same detector ownership", () => {
    const suggestion: ForYouSuggestion = {
      id: "digest-1",
      kind: "reply",
      why: "Join this thread.",
      draft: "A useful reply.",
      targetId: "parent-1",
      targetUrl: "https://x.com/target/status/parent-1",
      targetAuthor: "@target",
    };
    const listening = presentApproach({
      phase: "organic_reply",
      surface: null,
      scout: null,
      scoutDetected: false,
      suggestion,
      suggestionDetected: false,
      forYou: null,
      remainingMs: 0,
    });
    assert.equal(listening.detector, "scout");
    assert.equal(listening.why, "");

    const detected = presentApproach({
      phase: "organic_reply",
      surface: null,
      scout: null,
      scoutDetected: false,
      suggestion,
      suggestionDetected: true,
      forYou: null,
      remainingMs: 0,
    });
    assert.equal(detected.detector, null);
    assert.equal(detected.why, "");
    assert.equal(detected.badge, 1);
  });

  it("Next on a detected Scout during the minute holds; otherwise it takes stock", () => {
    const lock: ApproachLock = { phase: "scout_reply", cardId: "A", surface: null };
    assert.deepEqual(
      advanceApproach(
        lock,
        { type: "next" },
        { scoutId: "B", suggestionId: null, canPresentForYou: true, paceLocked: true },
      ),
      { phase: "hold", cardId: null, surface: "for_you" },
    );
    assert.deepEqual(
      advanceApproach(
        lock,
        { type: "next" },
        { scoutId: "B", suggestionId: null, canPresentForYou: true },
      ),
      { phase: "silent_refuel", cardId: null, surface: "for_you" },
    );
  });

  it("Next on a detected Suggested card honors the reply minute", () => {
    const state: ApproachTaskState = {
      lock: { phase: "organic_reply", cardId: "digest-1", surface: null },
      wait: null,
    };
    assert.deepEqual(
      transitionApproachTask(
        state,
        { type: "next" },
        { scoutId: null, suggestionId: "digest-2", canPresentForYou: true, paceLocked: true },
        { owner: OWNER, coaching },
      ).lock,
      { phase: "hold", cardId: null, surface: "for_you" },
    );
    assert.deepEqual(
      transitionApproachTask(
        state,
        { type: "next" },
        { scoutId: null, suggestionId: "digest-2", canPresentForYou: true },
        { owner: OWNER, coaching },
      ).lock,
      { phase: "organic_reply", cardId: "digest-2", surface: null },
    );
  });
});

describe("Suggested presentation", () => {
  it("does not add frame explanation copy", () => {
    const view = presentApproach({
      phase: "organic_reply",
      surface: null,
      scout: null,
      scoutDetected: false,
      suggestionDetected: false,
      suggestion: {
        id: "suggested-reply",
        kind: "reply",
        why: "A suggested reply",
        draft: null,
        targetId: null,
        targetUrl: null,
        targetAuthor: null,
      },
      forYou: null,
      remainingMs: 0,
    });
    assert.equal(view.why, "");
  });
});

describe("Collecting refill handoff", () => {
  it("flies on hydrated empty boot before Next, then ignores extra Next and empty landings", () => {
    let state: ApproachTaskState = {
      lock: FOR_YOU,
      wait: openForYouWait({ owner: OWNER, now: T0 }),
    };
    let handledThisOpen = false;
    let alreadyTried = true;
    let searches = 0;
    const boot = (tankKnown: boolean, usableScoutCount = 0) => {
      if (!shouldArmScoutOnBoot({
        tankKnown, usableScoutCount, handledThisOpen, alreadyTried, searching: false,
      })) return;
      handledThisOpen = true;
      alreadyTried = false;
      if (shouldBackgroundScout({
        phase: state.lock.phase, searching: false, grounded: false,
        cooldownRemainingSec: 0, needsXLink: false, hasAgenda: true,
        scoutCount: usableScoutCount, alreadyTried,
      })) {
        alreadyTried = true;
        searches += 1;
      }
    };
    boot(false);
    assert.equal(searches, 0);
    boot(true, 2);
    assert.equal(searches, 0);
    // Late history hydration reveals that retained cards were already used.
    boot(true);
    assert.equal(searches, 1);
    assert.equal(state.lock, FOR_YOU);
    for (let press = 0; press < 3; press += 1) {
      state = transitionApproachTask(state, { type: "next" },
        { scoutId: null, suggestionId: null, canPresentForYou: true },
        { owner: OWNER });
      assert.equal(state.wait, null);
      boot(true);
      assert.equal(searches, 1);
    }
    // A new page may retry the dry tank even though the session flag is spent.
    handledThisOpen = false;
    boot(true);
    assert.equal(searches, 2);
  });
});
