import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    clearScoutLogMemory();
    dir = await mkdtemp(join(tmpdir(), "x-copilot-scout-log-"));
    storePath = join(dir, "scout-log.json");
  });

  afterEach(async () => {
    clearScoutLogMemory();
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects empty message", async () => {
    await assert.rejects(
      () => appendScoutLog({ message: "  " }, { storePath }),
      /message is required/,
    );
  });

  it("round-trips memory and disk", async () => {
    await appendScoutLog(
      { message: "Scout planning", stage: "planning", at: "2026-07-27T12:00:00.000Z" },
      { storePath },
    );
    clearScoutLogMemory();
    const entries = await getScoutLog({ storePath });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].message, "Scout planning");
    const raw = JSON.parse(await readFile(storePath, "utf8")) as {
      entries: unknown[];
    };
    assert.equal(raw.entries.length, 1);
  });

  it("trims to MAX_SCOUT_LOG_ENTRIES", async () => {
    for (let i = 0; i < MAX_SCOUT_LOG_ENTRIES + 25; i++) {
      await appendScoutLog(
        {
          message: `line ${i}`,
          at: new Date(1_700_000_000_000 + i * 1000).toISOString(),
        },
        { storePath },
      );
    }
    const entries = await getScoutLog({ storePath });
    assert.equal(entries.length, MAX_SCOUT_LOG_ENTRIES);
    assert.equal(entries[0].message, "line 25");
    assert.equal(entries[entries.length - 1].message, `line ${MAX_SCOUT_LOG_ENTRIES + 24}`);
  });

  it("coalesces consecutive identical messages and bumps at", async () => {
    await appendScoutLog(
      { message: "same", at: "2026-07-28T10:00:00.000Z" },
      { storePath },
    );
    await appendScoutLog(
      { message: "same", at: "2026-07-28T11:00:00.000Z" },
      { storePath },
    );
    const entries = await getScoutLog({ storePath });
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.at, "2026-07-28T11:00:00.000Z");
  });
});
