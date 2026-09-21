import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalAliasFor,
  enumerateMemoryNotes,
  migrateLegacyNotes,
  resetLegacyMigrationDiagnosticsForTests,
} from "./memoryLegacyMigration.ts";
import { parseOwnedNoteMetadata } from "./ownedMemoryNotes.ts";
import { writeInteractionMemory } from "./knowledgeMemory.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function legacy(opts: {
  type?: "interaction" | "dismissal";
  threadId?: string;
  userId?: string | string[];
  at?: string;
  body?: string;
}): string {
  const owner = [opts.userId ?? []]
    .flat()
    .map((u) => `userId: "${u}"\n`)
    .join("");
  const type = opts.type ?? "interaction";
  const timeKey = type === "interaction" ? "interactedAt" : "dismissedAt";
  const thread = opts.threadId === undefined ? 'threadId: "2081"\n' : opts.threadId ? `threadId: "${opts.threadId}"\n` : "";
  return `---\ntype: ${type}\n${thread}${owner}${timeKey}: "${opts.at ?? "2026-07-27T12:00:00.000Z"}"\n---\n\n## Post\n\nparent\n\n${opts.body ?? "## Reply\n\nlegacy reply\n"}`;
}

describe("memoryLegacyMigration", () => {
  let root: string;
  let interactions: string;
  let dismissals: string;
  let logs: string[];

  beforeEach(async () => {
    resetLegacyMigrationDiagnosticsForTests();
    root = await mkdtemp(join(tmpdir(), "x-copilot-legacy-mig-"));
    interactions = join(root, "interactions");
    dismissals = join(root, "dismissals");
    await mkdir(interactions, { recursive: true });
    await mkdir(dismissals, { recursive: true });
    logs = [];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const listMd = async (dir: string) =>
    (await readdir(dir)).filter((n) => n.endsWith(".md")).sort();

  it("copies verifiably owned legacy notes, keeps originals, and is idempotent", async () => {
    const owned = legacy({ userId: "user-a", body: "## Reply\n\nkept\n\n## Outcome\n\n1h: 10 views\n" });
    await writeFile(join(interactions, "2026-07-27-2081.md"), owned, "utf8");
    await writeFile(
      join(interactions, "2026-07-28-2082.md"),
      legacy({ threadId: "2082", at: "2026-07-28T00:00:00.000Z" }),
      "utf8",
    );
    await writeFile(
      join(interactions, "2026-07-27-2083.md"),
      legacy({ threadId: "2083", userId: ["user-a", "user-b"] }),
      "utf8",
    );
    await writeFile(join(interactions, "2026-07-27-2084.md"), "garbage without frontmatter", "utf8");
    await writeFile(
      join(dismissals, "2026-07-29-42.md"),
      legacy({ type: "dismissal", threadId: "42", userId: "user-a", at: "2026-07-29T01:00:00.000Z", body: "## Reason\n\nspam\n" }),
      "utf8",
    );

    const [first, firstDismissals] = await migrateLegacyNotes({
      knowledgeRoot: root,
      log: (m) => logs.push(m),
    });
    assert.deepEqual(first, {
      kind: "interaction",
      scanned: 4,
      copied: 1,
      alreadyCanonical: 0,
      unowned: 2,
      conflict: 1,
      invalid: 0,
      unreadable: 0,
      failed: 0,
    });
    assert.equal(firstDismissals?.copied, 1);
    const canonical = `2026-07-27-u${sha("user-a")}-2081.md`;
    assert.deepEqual(await listMd(interactions), [
      "2026-07-27-2081.md",
      "2026-07-27-2083.md",
      "2026-07-27-2084.md",
      canonical,
      "2026-07-28-2082.md",
    ]);
    assert.equal(await readFile(join(interactions, canonical), "utf8"), owned);
    assert.equal(await readFile(join(interactions, "2026-07-27-2081.md"), "utf8"), owned);
    assert.deepEqual(await listMd(dismissals), [
      "2026-07-29-42.md",
      `2026-07-29-u${sha("user-a")}-42.md`,
    ]);
    assert.ok(logs.some((l) => /copied 1 owned legacy/.test(l)));
    assert.ok(
      logs.some((l) => /interaction: left 3 legacy note\(s\) unmigrated \(unowned 2, conflicting 1/.test(l)),
      logs.join("\n"),
    );

    // Modify the canonical copy, then re-run: nothing is overwritten or re-copied.
    await writeFile(join(interactions, canonical), `${owned}\n## Outcome\n\n24h: 99 views\n`, "utf8");
    logs.length = 0;
    const [second] = await migrateLegacyNotes({ knowledgeRoot: root, log: (m) => logs.push(m) });
    assert.equal(second?.copied, 0);
    assert.equal(second?.alreadyCanonical, 1);
    assert.equal(second?.unowned, 2);
    assert.match(await readFile(join(interactions, canonical), "utf8"), /24h: 99 views/);
    assert.equal((await listMd(interactions)).length, 5);
    // Aggregate exclusion diagnostic is not repeated for an unchanged state.
    assert.equal(logs.filter((l) => /unmigrated/.test(l)).length, 0);
  });

  it("does not use a lone installed user or a thread id as proof of ownership", async () => {
    await writeFile(join(interactions, "2026-07-27-2081.md"), legacy({}), "utf8");
    const [report] = await migrateLegacyNotes({ knowledgeRoot: root, log: () => {} });
    assert.equal(report?.copied, 0);
    assert.equal(report?.unowned, 1);
    assert.deepEqual(await listMd(interactions), ["2026-07-27-2081.md"]);
  });

  it("places the canonical copy by metadata time and treats a missing thread as unplaceable", () => {
    const shifted = parseOwnedNoteMetadata(
      legacy({ userId: "user-a", at: "2026-07-28T00:30:00.000Z" }),
    );
    assert.equal(
      canonicalAliasFor("2026-07-27-2081.md", shifted),
      `2026-07-28-u${sha("user-a")}-2081.md`,
    );
    assert.equal(
      canonicalAliasFor("2026-07-27-2081.md", parseOwnedNoteMetadata(legacy({ userId: "user-a", threadId: "" }))),
      null,
    );
    assert.equal(canonicalAliasFor("2026-07-27-2081.md", parseOwnedNoteMetadata(legacy({}))), null);
  });

  it("enumerates each migrated note once and keeps unmigrated legacy notes visible", async () => {
    await writeFile(join(interactions, "2026-07-27-2081.md"), legacy({ userId: "user-a" }), "utf8");
    await writeFile(join(interactions, "2026-07-27-2082.md"), legacy({ threadId: "2082" }), "utf8");
    await writeInteractionMemory({
      userId: "user-b",
      threadId: "2090",
      author: "@x",
      reply: "canonical from the start",
      interactedAt: "2026-07-27T12:00:00.000Z",
      knowledgeRoot: root,
    });

    const before = await enumerateMemoryNotes({ knowledgeRoot: root, kind: "interaction" });
    assert.deepEqual(
      before.map((n) => [n.name, n.canonical]).sort(),
      [
        ["2026-07-27-2081.md", false],
        ["2026-07-27-2082.md", false],
        [`2026-07-27-u${sha("user-b")}-2090.md`, true],
      ].sort(),
    );

    const after = await enumerateMemoryNotes({ knowledgeRoot: root, kind: "interaction", migrate: true });
    assert.deepEqual(
      after.map((n) => [n.name, n.canonical]).sort(),
      [
        ["2026-07-27-2082.md", false],
        [`2026-07-27-u${sha("user-a")}-2081.md`, true],
        [`2026-07-27-u${sha("user-b")}-2090.md`, true],
      ].sort(),
    );
    assert.equal(after.find((n) => n.name === "2026-07-27-2082.md")?.meta?.ownerState, "unowned");
    assert.equal((await listMd(interactions)).length, 4);
    assert.deepEqual(await enumerateMemoryNotes({ knowledgeRoot: join(root, "missing"), kind: "interaction" }), []);
  });
});
