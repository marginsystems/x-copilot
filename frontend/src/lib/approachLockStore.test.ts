import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { readApproachLock, writeApproachLock } from "./approachLockStore.ts";
import type { ApproachLock } from "../../../shared/src/deskPhase.ts";

const store = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  },
});

await describe("Approach lock persistence", () => {
  beforeEach(() => {
    store.clear();
  });

  it("round-trips scout and organic reply locks per user", () => {
    const locks: ApproachLock[] = [
      { phase: "scout_reply", cardId: "scout-1", surface: null },
      { phase: "organic_reply", cardId: "organic-1", surface: null },
    ];

    writeApproachLock("scout-user", locks[0]);
    writeApproachLock("organic-user", locks[1]);

    assert.deepEqual(readApproachLock("scout-user"), locks[0]);
    assert.deepEqual(readApproachLock("organic-user"), locks[1]);
  }).catch(assert.fail);
});
