import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import { ensureUserTenant } from "../billing/billingStore.ts";
import { upsertOwnPost } from "../desk/ownPostStore.ts";
import {
  explicitEventKey,
  readScoutEvidenceRevision,
  recordScoutEvidence,
  setScoutEvidenceNoteState,
  takeEventKey,
  type ScoutEvidenceInput,
} from "./scoutEvidence.ts";
import { emptyScoutProfile, type ScoutProfile } from "./scoutProfile.ts";
import {
  flushScoutProfileProjections,
  setScoutProfileRebuild,
} from "./scoutProfileProjection.ts";
import {
  installScoutProfileProjection,
  parseStoredScoutProfile,
  readScoutProfile,
  rebuildScoutProfile,
  scoutProfilePathForUser,
} from "./scoutProfileStore.ts";

const T0 = Date.parse("2026-09-20T10:00:00.000Z");
const USER = "user-a";
const OTHER = "user-b";

let temp: TempPlatformDb;
let root: string;
let profileDir: string;

function noReconcile(userId: string) {
  return readScoutProfile(userId, { profileDir, reconcile: false });
}

let seq = 0;
function take(
  userId: string,
  overrides: Partial<ScoutEvidenceInput> = {},
): ReturnType<typeof recordScoutEvidence> {
  seq += 1;
  const replyId = overrides.replyId ?? `r${seq}`;
  return recordScoutEvidence({
    userId,
    eventKey: takeEventKey(replyId),
    action: "take",
    source: "manual",
    targetId: `t${seq}`,
    replyId,
    actedAt: new Date(T0 + seq * 1000).toISOString(),
    threadKind: "fact_add",
    nowMs: T0 + seq * 1000,
    ...overrides,
  });
}

function skip(
  userId: string,
  overrides: Partial<ScoutEvidenceInput> = {},
): ReturnType<typeof recordScoutEvidence> {
  seq += 1;
  const cardId = overrides.cardId ?? `c${seq}`;
  return recordScoutEvidence({
    userId,
    eventKey: explicitEventKey("skip", "scout", cardId),
    action: "skip",
    source: "scout",
    targetId: overrides.targetId ?? cardId,
    cardId,
    actedAt: new Date(T0 + seq * 1000).toISOString(),
    threadKind: "hollow_ask",
    nowMs: T0 + seq * 1000,
    ...overrides,
  });
}

function readFileProfile(userId: string): unknown {
  return JSON.parse(readFileSync(scoutProfilePathForUser(userId, profileDir), "utf8"));
}

describe("scoutProfileStore", () => {
  beforeEach(() => {
    temp = openTempPlatformDb("x-scout-profile-");
    seedUser(USER);
    seedUser(OTHER);
    root = mkdtempSync(join(tmpdir(), "x-scout-profile-data-"));
    profileDir = join(root, "data", "scout-profile");
    installScoutProfileProjection({ profileDir });
  });

  afterEach(async () => {
    await flushScoutProfileProjections();
    setScoutProfileRebuild(null);
    closeTempPlatformDb(temp);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects a blank identity", async () => {
    await assert.rejects(() => noReconcile("  "), /userId is required/);
    assert.throws(() => scoutProfilePathForUser(""));
  });

  it("stores beside gamification under a hashed owner key", () => {
    const path = scoutProfilePathForUser(USER, profileDir);
    const hash = createHash("sha256").update(USER).digest("hex");
    assert.equal(path, join(profileDir, `u${hash}.json`));
    assert.ok(!path.includes("gamification"));
    assert.equal(
      scoutProfilePathForUser("../../etc/passwd", profileDir).startsWith(profileDir),
      true,
    );
  });

  it("returns and persists the deterministic empty profile for no evidence", async () => {
    const profile = await noReconcile(USER);
    assert.deepEqual(profile, emptyScoutProfile(USER));
    assert.deepEqual(readFileProfile(USER), profile);
    const again = await noReconcile(USER);
    assert.deepEqual(again, profile);
    assert.equal(existsSync(join(root, "data", "gamification")), false);
    assert.equal(existsSync(join(root, "data", "gamification.json")), false);
  });

  it("builds from evidence and reuses the file while the revision matches", async () => {
    setScoutProfileRebuild(null); // sidecar wrote evidence, no projection ran
    take(USER, { noteState: "stored" });
    take(USER, { noteState: "stored" });
    skip(USER);
    const profile = await noReconcile(USER);
    assert.equal(profile.revision, readScoutEvidenceRevision(USER).revision);
    assert.deepEqual(profile.counts, { takes: 2, skips: 1, dismissals: 0 });
    assert.equal(profile.coverage.storedConfirmedReplies, 2);
    assert.equal(profile.kinds.fact_add.takes, 2);
    assert.equal(profile.kinds.hollow_ask.skips, 1);
    assert.equal(profile.familiarity.state, "learning");
    assert.equal(profile.updatedAt, readScoutEvidenceRevision(USER).updatedAt);
    assert.deepEqual(profile.lastLearned, {
      at: new Date(T0 + seq * 1000).toISOString(),
      action: "skip",
      threadKind: "hollow_ask",
    });

    const path = scoutProfilePathForUser(USER, profileDir);
    const before = statSync(path).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 15));
    const again = await noReconcile(USER);
    assert.deepEqual(again, profile);
    assert.equal(statSync(path).mtimeMs, before);
  });

  it("repairs a stale projection on read after out-of-process evidence", async () => {
    setScoutProfileRebuild(null);
    take(USER);
    const first = await noReconcile(USER);
    assert.equal(first.counts.takes, 1);
    skip(USER);
    const second = await noReconcile(USER);
    assert.equal(second.counts.skips, 1);
    assert.equal(second.revision, first.revision + 1);
    assert.deepEqual(readFileProfile(USER), second);
  });

  it("repairs corrupt, foreign, and wrong-version files instead of serving them", async () => {
    setScoutProfileRebuild(null);
    take(USER, { noteState: "stored" });
    const expected = await noReconcile(USER);
    const path = scoutProfilePathForUser(USER, profileDir);

    writeFileSync(path, "{ not json");
    assert.deepEqual(await noReconcile(USER), expected);

    writeFileSync(path, JSON.stringify({ ...expected, userId: OTHER }));
    assert.deepEqual(await noReconcile(USER), expected);

    writeFileSync(path, JSON.stringify({ ...expected, version: 2 }));
    assert.deepEqual(await noReconcile(USER), expected);

    // Same revision but fabricated support: shape validation rejects it.
    writeFileSync(
      path,
      JSON.stringify({ ...expected, familiarity: { state: "supported", score: 500 } }),
    );
    assert.deepEqual(await noReconcile(USER), expected);

    // A tampered-but-valid file at the current revision is still replaced
    // when the revision no longer matches durable evidence.
    writeFileSync(path, JSON.stringify({ ...expected, revision: 99 }));
    assert.deepEqual(await noReconcile(USER), expected);
  });

  it("parseStoredScoutProfile drops unknown keys and keeps the frozen shape", () => {
    const profile = { ...emptyScoutProfile(USER), extra: "no" };
    const parsed = parseStoredScoutProfile(JSON.stringify(profile), USER);
    assert.deepEqual(parsed, emptyScoutProfile(USER));
    assert.equal(parseStoredScoutProfile(JSON.stringify(profile), OTHER), null);
    assert.equal(parseStoredScoutProfile("[]", USER), null);
    const noKind = { ...emptyScoutProfile(USER), kinds: {} };
    assert.equal(parseStoredScoutProfile(JSON.stringify(noKind), USER), null);
  });

  it("keeps users isolated", async () => {
    setScoutProfileRebuild(null);
    take(USER, { noteState: "stored" });
    skip(OTHER);
    skip(OTHER);
    const a = await noReconcile(USER);
    const b = await noReconcile(OTHER);
    assert.deepEqual(a.counts, { takes: 1, skips: 0, dismissals: 0 });
    assert.deepEqual(b.counts, { takes: 0, skips: 2, dismissals: 0 });
    assert.equal(b.coverage.storedConfirmedReplies, 0);
    assert.notEqual(
      scoutProfilePathForUser(USER, profileDir),
      scoutProfilePathForUser(OTHER, profileDir),
    );
    const files = await readdir(profileDir);
    assert.equal(files.filter((f) => f.endsWith(".json")).length, 2);
  });

  it("rebuilds the projection after a material evidence change via the hook", async () => {
    const path = scoutProfilePathForUser(USER, profileDir);
    take(USER, { replyId: "r1" });
    await flushScoutProfileProjections();
    assert.equal(existsSync(path), true);
    const stored = readFileProfile(USER) as ScoutProfile;
    assert.equal(stored.revision, 1);
    assert.equal(stored.counts.takes, 1);

    // Duplicate delivery: no material change, no revision, no rewrite.
    const mtime = statSync(path).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 15));
    const dup = take(USER, { replyId: "r1", source: "webhook" });
    assert.equal(dup.changed, false);
    await flushScoutProfileProjections();
    assert.equal(statSync(path).mtimeMs, mtime);
    assert.equal(readScoutEvidenceRevision(USER).revision, 1);

    // Saved-note repair is material: stored-reply credit appears.
    assert.equal(
      setScoutEvidenceNoteState({ userId: USER, replyId: "r1", state: "stored", nowMs: T0 + 99_000 }),
      true,
    );
    await flushScoutProfileProjections();
    const repaired = readFileProfile(USER) as ScoutProfile;
    assert.equal(repaired.revision, 2);
    assert.equal(repaired.coverage.storedConfirmedReplies, 1);
    assert.equal(repaired.familiarity.state, "learning");
    assert.equal(repaired.updatedAt, new Date(T0 + 99_000).toISOString());
    assert.deepEqual(repaired.lastLearned, {
      at: new Date(T0 + 99_000).toISOString(),
      action: "take",
      threadKind: "fact_add",
    });
    // A read at that revision serves the file without rebuilding.
    assert.deepEqual(await noReconcile(USER), repaired);
  });

  it("reconciles legacy own replies before the hook publishes the profile", async () => {
    upsertOwnPost({
      userId: USER,
      tenantId: ensureUserTenant(USER),
      parsed: {
        eventUuid: "legacy-event",
        xUserId: "x-user",
        postId: "legacy-reply",
        kind: "reply",
        text: "legacy reply",
        postedAt: new Date(T0).toISOString(),
        inReplyToId: "legacy-target",
        inReplyToUserId: "target-user",
        conversationId: "legacy-target",
        authorUsername: "user-a",
        metrics: {},
      },
    });

    take(USER);
    await flushScoutProfileProjections();

    const profile = readFileProfile(USER) as ScoutProfile;
    assert.equal(profile.counts.takes, 2);
    assert.equal(profile.revision, readScoutEvidenceRevision(USER).revision);
  });

  it("bootstraps reconciliation only when no valid projection exists", async () => {
    setScoutProfileRebuild(null);
    let calls = 0;
    const reconcile = async (userId: string) => {
      calls += 1;
      assert.equal(userId, USER);
      // The pass may surface a legacy confirmed reply as evidence.
      take(USER, { source: "reconcile", noteState: "stored" });
    };
    const first = await readScoutProfile(USER, { profileDir, reconcile });
    assert.equal(calls, 1);
    assert.equal(first.counts.takes, 1);
    assert.equal(first.coverage.storedConfirmedReplies, 1);
    await readScoutProfile(USER, { profileDir, reconcile });
    assert.equal(calls, 1);
    // Stale (not missing) projections rebuild without a bootstrap pass.
    skip(USER);
    const stale = await readScoutProfile(USER, { profileDir, reconcile });
    assert.equal(calls, 1);
    assert.equal(stale.counts.skips, 1);
    // Corrupt projections bootstrap again.
    writeFileSync(scoutProfilePathForUser(USER, profileDir), "nope");
    await readScoutProfile(USER, { profileDir, reconcile });
    assert.equal(calls, 2);
  });

  it("runs the real bounded reconciliation pass against local facts only", async () => {
    setScoutProfileRebuild(null);
    const knowledgeRoot = join(root, "knowledge-missing");
    const profile = await readScoutProfile(USER, { profileDir, knowledgeRoot });
    assert.deepEqual(profile, emptyScoutProfile(USER));
  });

  it("recovers from an interrupted atomic write and rebuilds identically after restart", async () => {
    setScoutProfileRebuild(null);
    take(USER, { noteState: "stored", topics: ["rates"] });
    skip(USER, { topics: ["rates"] });
    const path = scoutProfilePathForUser(USER, profileDir);
    mkdirSync(profileDir, { recursive: true });
    // A crash left a temp file behind and a truncated target.
    writeFileSync(`${path}.123.deadbeef.tmp`, "{");
    const built = await noReconcile(USER);
    writeFileSync(path, JSON.stringify(built).slice(0, 40));
    const repaired = await noReconcile(USER);
    assert.deepEqual(repaired, built);
    // Restart: projection gone, evidence intact → identical data.
    rmSync(path);
    const rebuilt = await rebuildScoutProfile(USER, { profileDir });
    assert.deepEqual(rebuilt, built);
    assert.deepEqual(readFileProfile(USER), built);
  });

  it("serializes concurrent server/sidecar rebuilds to one valid file", async () => {
    setScoutProfileRebuild(null);
    for (let i = 0; i < 6; i++) take(USER, { noteState: "stored" });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        i % 2 ? rebuildScoutProfile(USER, { profileDir }) : noReconcile(USER),
      ),
    );
    for (const result of results) assert.deepEqual(result, results[0]);
    assert.deepEqual(readFileProfile(USER), results[0]);
    const leftovers = (await readdir(profileDir)).filter(
      (f) => f.endsWith(".tmp") || f.endsWith(".lock"),
    );
    assert.deepEqual(leftovers, []);
  });

  it("fails closed when profile storage is unusable", async () => {
    setScoutProfileRebuild(null);
    take(USER);
    const asFile = join(root, "not-a-dir");
    writeFileSync(asFile, "x");
    await assert.rejects(() =>
      readScoutProfile(USER, { profileDir: asFile, reconcile: false }),
    );
  });

  it("fails closed when evidence storage is unusable", async () => {
    setScoutProfileRebuild(null);
    closeTempPlatformDb(temp);
    process.env.PLATFORM_DB_PATH = join(root, "not-a-dir", "platform.sqlite");
    writeFileSync(join(root, "not-a-dir"), "x");
    try {
      await assert.rejects(() => noReconcile(USER));
      assert.equal(existsSync(scoutProfilePathForUser(USER, profileDir)), false);
    } finally {
      temp = openTempPlatformDb("x-scout-profile-");
    }
  });
});
