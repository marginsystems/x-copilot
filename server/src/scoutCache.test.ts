import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearScoutCacheMemory,
  getLastScout,
  mergeThreadsById,
  parseScoutSnapshot,
  saveScoutCache,
  type LastScoutSnapshot,
} from "./scoutCache.ts";

function sample(overrides: Partial<LastScoutSnapshot> = {}): LastScoutSnapshot {
  return {
    savedAt: "2026-07-27T02:00:00.000Z",
    agenda: "Find builders",
    queries: ["ship AI"],
    threads: [
      {
        id: "1",
        author: "@a",
        text: "hello",
        url: "https://x.com/a/status/1",
      },
    ],
    message: "Scout found 1 threads.",
    ...overrides,
  };
}

describe("parseScoutSnapshot", () => {
  it("rejects invalid payloads", () => {
    assert.equal(parseScoutSnapshot(null), null);
    assert.equal(parseScoutSnapshot({ savedAt: "nope" }), null);
  });

  it("keeps valid threads and drops junk rows", () => {
    const parsed = parseScoutSnapshot({
      savedAt: "2026-07-27T02:00:00.000Z",
      queries: ["q"],
      threads: [
        {
          id: "1",
          author: "@a",
          text: "t",
          url: "https://x.com/a/status/1",
        },
        { id: 2 },
      ],
    });
    assert.ok(parsed);
    assert.equal(parsed.threads.length, 1);
    assert.deepEqual(parsed.queries, ["q"]);
  });
});

describe("saveScoutCache / getLastScout", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    clearScoutCacheMemory();
    dir = await mkdtemp(join(tmpdir(), "x-copilot-scout-"));
    storePath = join(dir, "last-scout.json");
  });

  afterEach(async () => {
    clearScoutCacheMemory();
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips memory and disk", async () => {
    const snap = sample();
    const saved = {
      ...snap,
      threads: snap.threads.map((thread) => ({ ...thread, scoutAgendaSet: true })),
    };
    await saveScoutCache(snap, { storePath });
    assert.deepEqual(await getLastScout({ storePath }), saved);

    clearScoutCacheMemory();
    const fromDisk = await getLastScout({ storePath });
    assert.deepEqual(fromDisk, saved);

    const raw = await readFile(storePath, "utf8");
    assert.ok(raw.includes('"id": "1"'));
  });

  it("replaces metadata but merges threads by id", async () => {
    await saveScoutCache(sample({ message: "first" }), { storePath });
    await saveScoutCache(
      sample({
        message: "second",
        threads: [
          {
            id: "2",
            author: "@b",
            text: "next",
            url: "https://x.com/b/status/2",
          },
        ],
      }),
      { storePath },
    );
    clearScoutCacheMemory();
    const last = await getLastScout({ storePath });
    assert.equal(last?.message, "second");
    assert.deepEqual(
      last?.threads.map((t) => t.id),
      ["1", "2"],
    );
  });

  it("keeps agenda provenance when runs accumulate threads", async () => {
    await saveScoutCache(sample({ agenda: undefined }), { storePath });
    await saveScoutCache(
      sample({
        agenda: "Find builders",
        threads: [
          {
            id: "2",
            author: "@b",
            text: "next",
            url: "https://x.com/b/status/2",
          },
        ],
      }),
      { storePath },
    );
    const last = await getLastScout({ storePath });
    assert.equal(last?.threads.find((t) => t.id === "1")?.scoutAgendaSet, false);
    assert.equal(last?.threads.find((t) => t.id === "2")?.scoutAgendaSet, true);
  });

  it("preserves missing agenda provenance from a legacy disk cache", async () => {
    await writeFile(
      storePath,
      JSON.stringify({
        savedAt: "2026-07-27T02:00:00.000Z",
        agenda: "Legacy agenda",
        queries: ["old query"],
        threads: sample().threads,
      }),
      "utf8",
    );

    await saveScoutCache(
      sample({
        agenda: "New agenda",
        threads: [
          {
            id: "2",
            author: "@b",
            text: "next",
            url: "https://x.com/b/status/2",
          },
        ],
      }),
      { storePath },
    );

    const last = await getLastScout({ storePath });
    assert.equal(last?.threads.find((t) => t.id === "1")?.scoutAgendaSet, undefined);
    assert.equal(last?.threads.find((t) => t.id === "2")?.scoutAgendaSet, true);
  });
});

describe("mergeThreadsById", () => {
  it("appends unseen ids and skips duplicates", () => {
    const a = {
      id: "1",
      author: "@a",
      text: "a",
      url: "https://x.com/a/status/1",
    };
    const b = {
      id: "2",
      author: "@b",
      text: "b",
      url: "https://x.com/b/status/2",
    };
    assert.deepEqual(
      mergeThreadsById([a], [a, b]).map((t) => t.id),
      ["1", "2"],
    );
  });
});
