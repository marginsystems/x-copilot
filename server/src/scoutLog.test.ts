import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SCOUT_LOG_ENTRIES,
  appendScoutLog,
  clearScoutLogMemory,
  getScoutLog,
  parseScoutLogFile,
} from "./scoutLog.ts";

describe("parseScoutLogFile", () => {
  it("keeps valid rows and drops junk", () => {
    const entries = parseScoutLogFile({
      entries: [
        { at: "2026-07-27T12:00:00.000Z", message: "ok", stage: "searching" },
        { at: "bad", message: "x" },
        { message: "no at" },
        null,
      ],
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].message, "ok");
  });
});

describe("appendScoutLog / getScoutLog", () => {
  beforeEach(() => {
    clearScoutLogMemory();
  });

  afterEach(() => {
    clearScoutLogMemory();
  });

  it("rejects empty message", async () => {
    await assert.rejects(
      () => appendScoutLog({ message: "  " }),
      /message is required/,
    );
  });

  it("keeps entries in memory only", async () => {
    await appendScoutLog({
      message: "Scout planning",
      stage: "planning",
      at: "2026-07-27T12:00:00.000Z",
    });
    const entries = await getScoutLog();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].message, "Scout planning");
    clearScoutLogMemory();
    assert.deepEqual(await getScoutLog(), []);
  });

  it("trims to MAX_SCOUT_LOG_ENTRIES", async () => {
    for (let i = 0; i < MAX_SCOUT_LOG_ENTRIES + 25; i++) {
      await appendScoutLog({
        message: `line ${i}`,
        at: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      });
    }
    const entries = await getScoutLog();
    assert.equal(entries.length, MAX_SCOUT_LOG_ENTRIES);
    assert.equal(entries[0].message, "line 25");
    assert.equal(entries[entries.length - 1].message, `line ${MAX_SCOUT_LOG_ENTRIES + 24}`);
  });

  it("coalesces consecutive identical messages and bumps at", async () => {
    await appendScoutLog({ message: "same", at: "2026-07-28T10:00:00.000Z" });
    await appendScoutLog({ message: "same", at: "2026-07-28T11:00:00.000Z" });
    const entries = await getScoutLog();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.at, "2026-07-28T11:00:00.000Z");
  });
});
