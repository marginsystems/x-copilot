import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  OwnedNoteCache,
  buildOwnedNotePath,
  noteVerifiedFor,
  ownedNoteFilename,
  ownerHash,
  parseOwnedNoteMetadata,
  parseOwnedNoteName,
  requireNoteOwner,
  resolveOwnedNote,
  threadKey,
  writeOwnedNoteAtomically,
} from "./ownedMemoryNotes.ts";
import {
  buildInteractionNotePath,
  updateInteractionMemoryOutcome,
  writeInteractionMemory,
} from "./knowledgeMemory.ts";
import type { Interaction } from "../desk/interactionStore.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const at = "2026-09-04T03:00:00.000Z";

function note(opts: {
  userId?: string | string[];
  threadId?: string | string[];
  reply?: string;
  interactedAt?: string;
}): string {
  const lines = ["---", "type: interaction"];
  for (const t of [opts.threadId ?? "2081"].flat()) lines.push(`threadId: "${t}"`);
  for (const u of [opts.userId ?? []].flat()) lines.push(`userId: "${u}"`);
  lines.push(`interactedAt: "${opts.interactedAt ?? at}"`, "---", "");
  lines.push("## Post", "", "parent", "");
  if (opts.reply !== undefined) lines.push("## Reply", "", opts.reply, "");
  return `${lines.join("\n")}\n`;
}

describe("owned note identity", () => {
  it("rejects blank owners and blank threads", () => {
    assert.throws(() => requireNoteOwner("   "), /userId is required/);
    assert.throws(() => requireNoteOwner(undefined), /userId is required/);
    assert.throws(() => threadKey("  "), /threadId is required/);
    assert.throws(
      () =>
        buildOwnedNotePath({
          kind: "interaction",
          userId: "",
          threadId: "1",
          at,
          knowledgeRoot: "/tmp/vault",
        }),
      /userId is required/,
    );
  });

  it("uses the full SHA-256 owner hash and keeps numeric thread ids readable", () => {
    assert.equal(ownerHash(" user-1 "), sha("user-1"));
    assert.equal(threadKey("2081314968155111817"), "2081314968155111817");
    assert.equal(
      ownedNoteFilename({ userId: "user-1", threadId: "2081", at }),
      `2026-09-04-u${sha("user-1")}-2081.md`,
    );
    assert.equal(
      buildOwnedNotePath({
        kind: "dismissal",
        userId: "user-1",
        threadId: "2081",
        at,
        knowledgeRoot: "/tmp/vault",
      }),
      join("/tmp/vault", "dismissals", `2026-09-04-u${sha("user-1")}-2081.md`),
    );
  });

  it("hashes noncanonical thread ids so hostile or colliding strings cannot alias", () => {
    const evil = threadKey("../evil/id!!");
    assert.match(evil, /^h[0-9a-f]{64}$/);
    assert.notEqual(threadKey("../evil/id!!"), threadKey("evil_id"));
    assert.notEqual(threadKey("a/b"), threadKey("a_b"));
    // A literal id that looks like a hashed key is itself hashed: no alias.
    assert.notEqual(threadKey(`h${sha("x")}`), `h${sha("x")}`);
    // Owner strings that used to sanitize identically stay distinct.
    assert.notEqual(
      ownedNoteFilename({ userId: "user/1", threadId: "1", at }),
      ownedNoteFilename({ userId: "user_1", threadId: "1", at }),
    );
    const parsed = parseOwnedNoteName(
      ownedNoteFilename({ userId: "user-1", threadId: "../evil", at }),
    );
    assert.ok(parsed);
    assert.equal(parsed.ownerHash, sha("user-1"));
    assert.equal(parsed.date, "2026-09-04");
    assert.equal(parseOwnedNoteName("2026-09-04-parent-1.md"), null);
    assert.equal(parseOwnedNoteName(`2026-09-04-u${sha("u")}-x.md`), null);
  });
});

describe("parseOwnedNoteMetadata", () => {
  it("reads owner, thread, time and reply from rendered notes", () => {
    const meta = parseOwnedNoteMetadata(
      note({ userId: "user-1", threadId: "2081", reply: "hi\nthere" }),
    );
    assert.ok(meta);
    assert.equal(meta.type, "interaction");
    assert.equal(meta.ownerState, "owned");
    assert.equal(meta.userId, "user-1");
    assert.equal(meta.threadId, "2081");
    assert.equal(meta.actionAt, at);
    assert.equal(meta.reply, "hi\nthere");
    assert.equal(noteVerifiedFor(meta, { userId: "user-1", threadId: "2081" }), true);
    assert.equal(noteVerifiedFor(meta, { userId: "user-2", threadId: "2081" }), false);
    assert.equal(noteVerifiedFor(meta, { userId: "user-1", threadId: "2082" }), false);
  });

  it("unescapes quoted scalars and accepts single quotes", () => {
    const meta = parseOwnedNoteMetadata(
      `---\ntype: interaction\nthreadId: '2081'\nuserId: "we\\"ird\\\\user"\n---\n\n## Reply\n\nok\n`,
    );
    assert.equal(meta?.userId, 'we"ird\\user');
    assert.equal(meta?.threadId, "2081");
  });

  it("treats duplicate or conflicting owner fields as unverifiable", () => {
    const dup = parseOwnedNoteMetadata(note({ userId: ["user-1", "user-2"] }));
    assert.equal(dup?.ownerState, "conflict");
    assert.equal(dup?.userId, null);
    assert.equal(noteVerifiedFor(dup, { userId: "user-1", threadId: "2081" }), false);
    const same = parseOwnedNoteMetadata(note({ userId: ["user-1", "user-1"] }));
    assert.equal(same?.ownerState, "conflict");
    const threads = parseOwnedNoteMetadata(
      note({ userId: "user-1", threadId: ["2081", "2082"] }),
    );
    assert.equal(threads?.ownerState, "conflict");
    assert.equal(threads?.threadId, null);
  });

  it("reports unowned and blank owners, and null without frontmatter", () => {
    assert.equal(parseOwnedNoteMetadata(note({}))?.ownerState, "unowned");
    assert.equal(
      parseOwnedNoteMetadata(`---\ntype: interaction\nuserId: ""\nthreadId: "1"\n---\n`)
        ?.ownerState,
      "unowned",
    );
    assert.equal(parseOwnedNoteMetadata("not a note"), null);
  });
});

describe("resolveOwnedNote", () => {
  let root: string;
  let dir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "x-copilot-owned-resolve-"));
    dir = join(root, "interactions");
    await mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const resolveFor = (userId: string, extra: Record<string, unknown> = {}) =>
    resolveOwnedNote({
      kind: "interaction",
      userId,
      threadId: "2081",
      at,
      knowledgeRoot: root,
      ...extra,
    });

  it("finds each owner's own note when two users saved the same thread and date", async () => {
    const a = await writeInteractionMemory({
      userId: "user-a",
      threadId: "2081",
      author: "@x",
      reply: "A's take",
      interactedAt: at,
      knowledgeRoot: root,
    });
    const b = await writeInteractionMemory({
      userId: "user-b",
      threadId: "2081",
      author: "@x",
      reply: "B's take",
      interactedAt: at,
      knowledgeRoot: root,
    });
    assert.notEqual(a.path, b.path);
    assert.deepEqual((await readdir(dir)).filter((n) => n.endsWith(".md")).length, 2);
    const forA = await resolveFor("user-a");
    const forB = await resolveFor("user-b");
    assert.equal(forA.state, "found");
    assert.equal(forB.state, "found");
    if (forA.state !== "found" || forB.state !== "found") return;
    assert.equal(forA.meta.reply, "A's take");
    assert.equal(forB.meta.reply, "B's take");
    assert.equal(forA.canonical, true);
    assert.match(await readFile(a.path, "utf8"), /A's take/);
    assert.match(await readFile(b.path, "utf8"), /B's take/);
  });

  it("verifies metadata even on an expected-path hit", async () => {
    const expected = buildOwnedNotePath({
      kind: "interaction",
      userId: "user-a",
      threadId: "2081",
      at,
      knowledgeRoot: root,
    });
    await writeFile(expected, note({ userId: "user-b", reply: "planted" }), "utf8");
    assert.deepEqual(await resolveFor("user-a"), { state: "foreign" });
    await writeFile(
      expected,
      note({ userId: "user-a", threadId: "9999", reply: "wrong thread" }),
      "utf8",
    );
    assert.deepEqual(await resolveFor("user-a"), { state: "foreign" });
  });

  it("resolves a metadata-verified legacy note and rejects unowned or foreign ones", async () => {
    await writeFile(
      join(dir, "2026-09-04-2081.md"),
      note({ userId: "user-a", reply: "legacy owned" }),
      "utf8",
    );
    const found = await resolveFor("user-a");
    assert.equal(found.state, "found");
    if (found.state !== "found") return;
    assert.equal(found.canonical, false);
    assert.equal(basename(found.path), "2026-09-04-2081.md");
    assert.deepEqual(await resolveFor("user-b"), { state: "foreign" });

    await writeFile(join(dir, "2026-09-04-2081.md"), note({ reply: "unowned" }), "utf8");
    assert.deepEqual(await resolveFor("user-a"), { state: "foreign" });
    await writeFile(
      join(dir, "2026-09-04-2081.md"),
      note({ userId: ["user-a", "user-b"], reply: "conflict" }),
      "utf8",
    );
    assert.deepEqual(await resolveFor("user-a"), { state: "foreign" });
  });

  it("reports missing when nothing for that thread/date exists", async () => {
    await writeFile(
      join(dir, "2026-09-04-7777.md"),
      note({ userId: "user-a", threadId: "7777", reply: "other" }),
      "utf8",
    );
    assert.deepEqual(await resolveFor("user-a"), { state: "missing" });
    assert.deepEqual(
      await resolveOwnedNote({
        kind: "interaction",
        userId: "user-a",
        threadId: "2081",
        at,
        knowledgeRoot: join(root, "nope"),
      }),
      { state: "missing" },
    );
  });

  it("uses other dates only when allowed and never picks among ambiguous candidates", async () => {
    await writeFile(
      join(dir, "2026-09-01-2081.md"),
      note({ userId: "user-a", reply: "older", interactedAt: "2026-09-01T00:00:00.000Z" }),
      "utf8",
    );
    assert.deepEqual(await resolveFor("user-a"), { state: "missing" });
    const relaxed = await resolveFor("user-a", { allowOtherDates: true });
    assert.equal(relaxed.state, "found");
    if (relaxed.state !== "found") return;
    assert.equal(relaxed.meta.reply, "older");

    await writeFile(
      join(dir, "2026-09-02-2081.md"),
      note({ userId: "user-a", reply: "newer", interactedAt: "2026-09-02T00:00:00.000Z" }),
      "utf8",
    );
    assert.deepEqual(await resolveFor("user-a", { allowOtherDates: true }), {
      state: "ambiguous",
    });
    assert.deepEqual(
      await resolveOwnedNote({
        kind: "interaction",
        userId: "user-a",
        threadId: "2081",
        knowledgeRoot: root,
      }),
      { state: "ambiguous" },
    );
  });

  it("matches a legacy note by its metadata date when the filename date differs", async () => {
    await writeFile(
      join(dir, "2026-09-03-2081.md"),
      note({ userId: "user-a", reply: "late file", interactedAt: at }),
      "utf8",
    );
    const found = await resolveFor("user-a");
    assert.equal(found.state, "found");
  });

  it("reuses a batch listing and cache, and reports unreadable notes", async () => {
    await writeFile(join(dir, "2026-09-04-2081.md"), "garbage", "utf8");
    const cache = new OwnedNoteCache();
    const names = await cache.list(dir);
    assert.deepEqual(names, ["2026-09-04-2081.md"]);
    assert.deepEqual(await resolveFor("user-a", { cache, names }), {
      state: "foreign",
    });
    assert.deepEqual(await resolveFor("user-a", { cache, names: [] }), {
      state: "missing",
    });
  });

  it("refreshes cached listings after a note is written", async () => {
    const cache = new OwnedNoteCache();
    assert.deepEqual(await cache.list(dir), []);
    await writeInteractionMemory({
      userId: "user-a",
      threadId: "2081",
      author: "@x",
      reply: "new note",
      interactedAt: at,
      knowledgeRoot: root,
    });
    const found = await resolveFor("user-a", { cache });
    assert.equal(found.state, "found");
  });
});

describe("writeOwnedNoteAtomically", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "x-copilot-owned-atomic-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("publishes through a same-directory temp file and leaves no stragglers", async () => {
    const path = join(root, "interactions", "note.md");
    const first = await writeOwnedNoteAtomically({ path, merge: () => "one\n" });
    assert.equal(first.changed, true);
    const second = await writeOwnedNoteAtomically({
      path,
      merge: (existing) => `${existing}two\n`,
    });
    assert.equal(second.markdown, "one\ntwo\n");
    const skipped = await writeOwnedNoteAtomically({ path, merge: () => null });
    assert.equal(skipped.changed, false);
    assert.equal(await readFile(path, "utf8"), "one\ntwo\n");
    assert.deepEqual(await readdir(join(root, "interactions")), ["note.md"]);
  });

  it("serializes concurrent in-process merges so no update is lost", async () => {
    const path = join(root, "interactions", "counter.md");
    await Promise.all(
      Array.from({ length: 25 }, () =>
        writeOwnedNoteAtomically({
          path,
          merge: async (existing) => {
            await new Promise((r) => setTimeout(r, 1));
            return `${existing ?? ""}x`;
          },
        }),
      ),
    );
    assert.equal(await readFile(path, "utf8"), "x".repeat(25));
  });
});

describe("cross-process reply and stats writes", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "x-copilot-owned-xproc-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function baseInteraction(stats: Interaction["stats"]): Interaction {
    return {
      threadId: "2081",
      author: "@x",
      authorKey: "x",
      at,
      source: "manual",
      userId: "user-a",
      stats,
    };
  }

  it("keeps curated context and both checkpoints when a sibling process writes concurrently", async () => {
    await writeInteractionMemory({
      userId: "user-a",
      threadId: "2081",
      author: "@x",
      reply: "kept reply",
      summary: "Keep this summary",
      agenda: "Keep this agenda",
      interactedAt: at,
      knowledgeRoot: root,
    });
    const knowledgeMemoryUrl = new URL("./knowledgeMemory.ts", import.meta.url).href;
    const script = `
      import { writeInteractionMemory, updateInteractionMemoryOutcome } from ${JSON.stringify(knowledgeMemoryUrl)};
      const root = process.argv[2];
      const at = ${JSON.stringify(at)};
      for (let i = 0; i < 12; i++) {
        await writeInteractionMemory({
          userId: "user-a", threadId: "2081", author: "@x", reply: "kept reply",
          source: "discovered", text: "refresh " + i, interactedAt: at, knowledgeRoot: root,
        });
        const r = await updateInteractionMemoryOutcome({
          interaction: {
            threadId: "2081", author: "@x", authorKey: "x", at, source: "manual", userId: "user-a",
            stats: { t24h: { views: 420, likes: 12, replies: 3, retweets: 1, sampledAt: "2026-09-05T03:00:00.000Z" } },
          },
          knowledgeRoot: root,
          nowIso: "2026-09-05T03:00:00.000Z",
        });
        if (!r.ok) throw new Error("sibling outcome failed: " + r.error);
      }
    `;
    const scriptPath = join(root, "sibling.mts");
    await writeFile(scriptPath, script, "utf8");
    const sibling = spawn(
      process.execPath,
      ["--import", "tsx", scriptPath, root],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let siblingErr = "";
    sibling.stderr.on("data", (chunk) => {
      siblingErr += String(chunk);
    });
    const siblingDone = new Promise<number>((resolve) =>
      sibling.on("exit", (code) => resolve(code ?? -1)),
    );

    for (let i = 0; i < 12; i++) {
      const result = await updateInteractionMemoryOutcome({
        interaction: baseInteraction({
          t1h: {
            views: 100,
            likes: 4,
            replies: 1,
            retweets: 0,
            sampledAt: "2026-09-04T04:00:00.000Z",
          },
        }),
        knowledgeRoot: root,
        nowIso: "2026-09-04T04:00:00.000Z",
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(await siblingDone, 0, siblingErr);

    const body = await readFile(
      buildInteractionNotePath({
        userId: "user-a",
        threadId: "2081",
        interactedAt: at,
        knowledgeRoot: root,
      }),
      "utf8",
    );
    assert.match(body, /views1h: 100/);
    assert.match(body, /views24h: 420/);
    assert.match(body, /1h: 100 views/);
    assert.match(body, /24h: 420 views/);
    assert.match(body, /Keep this summary/);
    assert.match(body, /Keep this agenda/);
    assert.match(body, /kept reply/);
    assert.equal((body.match(/## Outcome/g) ?? []).length, 1);
    const names = (await readdir(join(root, "interactions"))).filter((n) =>
      !n.endsWith(".md"),
    );
    assert.deepEqual(names, []);
  });
});
