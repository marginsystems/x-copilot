import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  flushScoutProfileProjections,
  hasScoutProfileRebuild,
  notifyScoutEvidenceChanged,
  resetScoutProfileProjectionForTests,
  scoutProfileProjectionStats,
  setScoutProfileRebuild,
} from "./scoutProfileProjection.ts";

describe("scoutProfileProjection", () => {
  beforeEach(() => resetScoutProfileProjectionForTests());
  afterEach(() => resetScoutProfileProjectionForTests());

  it("drops notifications until a rebuild function is registered", async () => {
    assert.equal(hasScoutProfileRebuild(), false);
    notifyScoutEvidenceChanged({ userId: "u1", revision: 1 });
    await flushScoutProfileProjections();
    assert.deepEqual(scoutProfileProjectionStats(), {
      notified: 0,
      failures: 0,
      pending: 0,
    });
  });

  it("runs the rebuild after the current synchronous work, once per burst", async () => {
    const calls: string[] = [];
    setScoutProfileRebuild(async (userId) => {
      calls.push(userId);
    });
    notifyScoutEvidenceChanged({ userId: "u1", revision: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    notifyScoutEvidenceChanged({ userId: "u1", revision: 2 });
    notifyScoutEvidenceChanged({ userId: "u2", revision: 1 });
    // Nothing has run yet: the caller's transaction is still "open".
    assert.deepEqual(calls, []);
    await flushScoutProfileProjections();
    // Two notifications for u1 arrived before it started → one rebuild,
    // plus one for u2.
    assert.deepEqual(calls.sort(), ["u1", "u2"]);
    assert.equal(scoutProfileProjectionStats().pending, 0);
  });

  it("re-runs when a change arrives while a rebuild is in flight", async () => {
    let release: () => void = () => {};
    let calls = 0;
    setScoutProfileRebuild(async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    });
    notifyScoutEvidenceChanged({ userId: "u1", revision: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 1);
    notifyScoutEvidenceChanged({ userId: "u1", revision: 2 });
    release();
    await flushScoutProfileProjections();
    assert.equal(calls, 2);
  });

  it("swallows rebuild failures and keeps serving later changes", async () => {
    let calls = 0;
    setScoutProfileRebuild(async () => {
      calls += 1;
      if (calls === 1) throw new Error("disk full");
    });
    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      notifyScoutEvidenceChanged({ userId: "u1", revision: 1 });
      await flushScoutProfileProjections();
      notifyScoutEvidenceChanged({ userId: "u1", revision: 2 });
      await flushScoutProfileProjections();
    } finally {
      console.warn = warn;
    }
    assert.equal(calls, 2);
    assert.equal(scoutProfileProjectionStats().failures, 1);
    assert.equal(warnings.length, 1);
  });

  it("ignores blank identities", async () => {
    let calls = 0;
    setScoutProfileRebuild(async () => {
      calls += 1;
    });
    notifyScoutEvidenceChanged({ userId: "  ", revision: 1 });
    await flushScoutProfileProjections();
    assert.equal(calls, 0);
  });
});
