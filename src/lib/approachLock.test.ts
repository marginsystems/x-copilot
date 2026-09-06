import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  parseApproachLock,
  readApproachLock,
  writeApproachLock,
} from "./approachLock.ts";
import type { ApproachLock } from "./deskPhase.ts";

const store = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  },
});

describe("Approach lock persistence", () => {
  beforeEach(() => {
    store.clear();
  });

  it("rejects garbage and snapshots without a valid phase", () => {
    assert.equal(parseApproachLock("not json"), null);
    assert.equal(
      parseApproachLock(JSON.stringify({ cardId: "1", surface: null })),
      null,
    );
    assert.equal(
      parseApproachLock(
        JSON.stringify({ phase: "fork", cardId: null, surface: null }),
      ),
      null,
    );
    assert.equal(
      parseApproachLock(
        JSON.stringify({ phase: "original", cardId: null, surface: null }),
      ),
      null,
    );
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
  });
});
