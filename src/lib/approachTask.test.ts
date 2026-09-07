import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approachTaskKey,
  reconcileApproachGate,
  restoreApproachTask,
  transitionApproachTask,
  type ApproachTaskState,
} from "./approachTask.ts";
import { eligibleScoutCards } from "./deskRefuel.ts";
import { advanceApproach, type ApproachLock } from "./deskPhase.ts";
import {
  forYouWaitDetected,
  openForYouWait,
  settleForYouWait,
} from "./forYouTask.ts";
import { presentApproach } from "../desk/approachPresenter.ts";
import { FYP_DETECTED_COPY, FYP_DETECTING_COPY } from "./forYou.ts";

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
    assert.equal(present(scout, { scout: null }).detector, "scout");
  });

  it("normalizes a restored done_for_now into the same For You task law", () => {
    const state = restoreApproachTask({
      stored: { phase: "done_for_now", cardId: null, surface: null },
      storedWait: null,
      normalize: open,
      paceLocked: false,
      task: { owner: OWNER, coaching, now: T0 },
    });
    assert.deepEqual(state.lock, FOR_YOU);
    assert.notEqual(state.wait, null);
    const view = present(state);
    assert.equal(view.kind, "for_you");
    assert.equal(view.badge, 1);
    assert.equal(view.forYou?.showNext, true);
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
  it("keeps a coherent For You task with a fresh baseline and a new task key", () => {
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
    assert.deepEqual(second.lock, FOR_YOU);
    assert.equal(second.wait?.enteredAt, "2026-09-07T10:02:11.000Z");
    assert.equal(second.wait?.detectedAt, null);
    assert.equal(second.wait?.snapshot?.postsToday, 2);
    assert.notEqual(approachTaskKey(second), approachTaskKey(detected));
    assert.equal(present(second).forYou?.detected, false);
  });
});

describe("same-phase Scout release", () => {
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
      canPresentForYou: true,
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
    assert.deepEqual(state.lock, FOR_YOU);
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
    assert.equal(
      approachTaskKey(hold),
      `for_you:${hold.wait!.enteredAt}`,
    );
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

  it("bypass onto an empty tank opens a new wait, never the old one", () => {
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
    assert.deepEqual(next.lock, FOR_YOU);
    assert.notEqual(next.wait, held.wait);
    assert.equal(next.wait?.enteredAt, "2026-09-07T10:00:10.000Z");
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
      forYou: null,
      remainingMs: 0,
    });
    assert.equal(listening.detector, "scout");
    assert.equal(listening.why, FYP_DETECTING_COPY);
    const detected = presentApproach({
      ...listening,
      phase: "scout_reply",
      surface: null,
      scout,
      scoutDetected: true,
      suggestion: null,
      forYou: null,
      remainingMs: 0,
    });
    assert.equal(detected.detector, null);
    assert.equal(detected.why, "Reply detected. Tap Next.");
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
      { phase: "scout_reply", cardId: "B", surface: null },
    );
  });
});
