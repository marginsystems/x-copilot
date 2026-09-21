/**
 * C11: the run-profile loader is owner-checked and soft-failing. Blank
 * identity never reads; a thrown error, absent result, foreign owner or
 * unusable shape all yield null with no retry or fallback owner.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import { emptyScoutProfile, type ScoutProfile } from "./scoutProfile.ts";
import { readScoutProfile } from "./scoutProfileStore.ts";
import {
  isUsableScoutRunProfile,
  loadScoutRunProfile,
} from "./scoutRunProfile.ts";

function spy(backing: () => ScoutProfile | null | undefined) {
  const calls: string[] = [];
  return {
    calls,
    load: async (userId: string) => {
      calls.push(userId);
      return backing();
    },
  };
}

describe("loadScoutRunProfile", () => {
  it("performs no read for a blank or missing identity", async () => {
    const loader = spy(() => emptyScoutProfile("user-a"));
    for (const userId of [undefined, "", "   "]) {
      assert.equal(await loadScoutRunProfile(userId, loader.load), null);
    }
    assert.deepEqual(loader.calls, []);
  });

  it("reads once with the trimmed identity and returns the same object", async () => {
    const profile = { ...emptyScoutProfile("user-a"), revision: 4 };
    const loader = spy(() => profile);
    const loaded = await loadScoutRunProfile(" user-a ", loader.load);
    assert.equal(loaded, profile, "same reference, not a copy");
    assert.deepEqual(loader.calls, ["user-a"]);
  });

  it("fails soft when the loader throws, with no retry", async () => {
    const loader = spy(() => {
      throw new Error("evidence db locked");
    });
    assert.equal(await loadScoutRunProfile("user-a", loader.load), null);
    assert.deepEqual(loader.calls, ["user-a"]);
  });

  it("treats an absent result as no profile", async () => {
    assert.equal(await loadScoutRunProfile("user-a", spy(() => null).load), null);
    assert.equal(await loadScoutRunProfile("user-a", spy(() => undefined).load), null);
  });

  it("drops a foreign owner's profile instead of substituting it", async () => {
    const foreign = spy(() => emptyScoutProfile("user-b"));
    assert.equal(await loadScoutRunProfile("user-a", foreign.load), null);
    assert.deepEqual(foreign.calls, ["user-a"]);
    // Owner comparison is exact on the trimmed identity.
    const padded = spy(() => emptyScoutProfile(" user-a"));
    assert.equal(await loadScoutRunProfile("user-a", padded.load), null);
  });

  it("drops unusable shapes", async () => {
    const base = emptyScoutProfile("user-a");
    const unusable: unknown[] = [
      "user-a",
      42,
      [],
      { ...base, version: 2 },
      { ...base, revision: -1 },
      { ...base, revision: 1.5 },
      { ...base, revision: "1" },
      { ...base, kinds: null },
      { ...base, overall: [] },
      { ...base, familiarity: "supported" },
      { ...base, topics: {} },
      { ...base, authors: "none" },
    ];
    for (const value of unusable) {
      assert.equal(isUsableScoutRunProfile(value, "user-a"), false);
      assert.equal(
        await loadScoutRunProfile("user-a", spy(() => value as ScoutProfile).load),
        null,
      );
    }
    assert.equal(isUsableScoutRunProfile(base, "user-a"), true);
    assert.equal(isUsableScoutRunProfile(base, "user-b"), false);
  });
});

describe("loadScoutRunProfile with the real store", () => {
  let temp: TempPlatformDb | undefined;
  let profileDir: string | undefined;
  afterEach(() => {
    if (temp) closeTempPlatformDb(temp);
    temp = undefined;
    if (profileDir) rmSync(profileDir, { recursive: true, force: true });
    profileDir = undefined;
  });

  it("accepts the store's owner-safe read for a user with no evidence", async () => {
    temp = openTempPlatformDb("x-run-profile-store-");
    profileDir = mkdtempSync(join(tmpdir(), "x-run-profile-dir-"));
    const userId = seedUser("run-profile-user");
    const dir = profileDir;
    const loaded = await loadScoutRunProfile(userId, (id) =>
      readScoutProfile(id, { profileDir: dir, reconcile: false }),
    );
    assert.ok(loaded);
    assert.equal(loaded.userId, userId);
    assert.equal(loaded.revision, 0);
    assert.equal(loaded.familiarity.state, "empty");
  });

  it("returns null for a blank identity before touching the store", async () => {
    let reads = 0;
    const loaded = await loadScoutRunProfile("", (id) => {
      reads += 1;
      return readScoutProfile(id);
    });
    assert.equal(loaded, null);
    assert.equal(reads, 0);
  });
});
