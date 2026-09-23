import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildDismissalNotePath,
  defaultKnowledgeRoot,
  buildInteractionNotePath,
  findInteractionNotePath,
  formatOutcomeSection,
  listInteractionMemoryReplies,
  normalizeReply,
  renderDismissalMarkdown,
  parseInteractionNoteReply,
  renderInteractionMarkdown,
  safeThreadIdForFilename,
  stripManagedOutcomeFrontmatter,
  updateInteractionMemoryOutcome,
  upsertOutcomeSection,
  writeDismissalMemory,
  writeInteractionMemory,
  projectRoot,
} from "./knowledgeMemory.ts";
import type { Interaction } from "../desk/interactionStore.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

await describe("defaultKnowledgeRoot", async () => {
  await it("keeps notes beside the other local data", () => {
    assert.equal(defaultKnowledgeRoot(), resolve(projectRoot, "data", "knowledge"));
  });
});

/** Pre-C07 note at the legacy `<date>-<threadId>.md` path (never written by code now). */
async function writeLegacyNote(
  root: string,
  name: string,
  opts: { threadId: string; userId?: string; interactedAt: string; reply: string; extra?: string },
): Promise<string> {
  const dir = join(root, "interactions");
  await mkdir(dir, { recursive: true });
  const owner = opts.userId ? `userId: "${opts.userId}"\n` : "";
  const path = join(dir, name);
  await writeFile(
    path,
    `---\ntype: interaction\nthreadId: "${opts.threadId}"\n${owner}author: "@A"\nauthorKey: "a"\ninteractedAt: "${opts.interactedAt}"\nsource: manual\n${opts.extra ?? ""}---\n\n## Post\n\nlegacy post\n\n## Reply\n\n${opts.reply}\n`,
    "utf8",
  );
  return path;
}

await describe("safeThreadIdForFilename", async () => {
  await it("keeps alphanumerics and strips junk (legacy reader only)", () => {
    assert.equal(safeThreadIdForFilename("2081314968155111817"), "2081314968155111817");
    assert.equal(safeThreadIdForFilename("../evil/id!!"), "evil_id");
    assert.equal(safeThreadIdForFilename("   "), "unknown");
  });
});

await describe("normalizeReply / renderInteractionMarkdown", async () => {
  await it("renders discovered source", () => {
    const md = renderInteractionMarkdown({
      threadId: "t1",
      author: "@A",
      userId: "user-1",
      reply: "off-app reply",
      source: "discovered",
    });
    assert.match(md, /source: discovered/);
    assert.match(md, /userId: "user-1"/);
  });

  await it("rejects empty reply", () => {
    assert.equal(normalizeReply("  \n\t "), "");
    assert.throws(
      () =>
        renderInteractionMarkdown({
          threadId: "1",
          author: "@Foo",
          userId: "user-1",
          reply: "   ",
        }),
      /reply is required/,
    );
  });

  await it("rejects a blank owner", () => {
    assert.throws(
      () =>
        renderInteractionMarkdown({
          threadId: "1",
          author: "@Foo",
          userId: "   ",
          reply: "hi",
        }),
      /userId is required/,
    );
    assert.throws(
      () =>
        buildInteractionNotePath({
          userId: "",
          threadId: "1",
          interactedAt: "2026-07-27T12:00:00.000Z",
          knowledgeRoot: "/tmp/vault",
        }),
      /userId is required/,
    );
  });

  await it("parses threadId, owner and Reply out of a rendered note", async () => {
    const md = renderInteractionMarkdown({
      threadId: "2081",
      author: "@Builder",
      userId: "user-1",
      reply: "Thanks — here's a concrete tip.",
      interactedAt: "2026-07-27T12:00:00.000Z",
    });
    assert.deepEqual(parseInteractionNoteReply(md), {
      threadId: "2081",
      text: "Thanks — here's a concrete tip.",
      postedAt: "2026-07-27T12:00:00.000Z",
      userId: "user-1",
    });
  });

  await it("round-trips a multi-line Reply body", () => {
    const md = renderInteractionMarkdown({
      threadId: "2081",
      author: "@Builder",
      userId: "user-1",
      reply: "Line one\nLine two",
      interactedAt: "2026-07-27T12:00:00.000Z",
    });
    assert.equal(parseInteractionNoteReply(md)?.text, "Line one\nLine two");
  });

  await it("includes threadId and reply in markdown", () => {
    const md = renderInteractionMarkdown({
      threadId: "2081",
      author: "@Builder",
      userId: "user-1",
      reply: "Thanks — here's a concrete tip.",
      text: "How do I ship AI tools in public?",
      summary: "Asking about shipping AI tools",
      baitScore: 12,
      engage: "consider",
      flags: ["genuine_question"],
      agenda: "Find builders",
      interactedAt: "2026-07-27T12:00:00.000Z",
    });
    assert.match(md, /threadId: "2081"/);
    assert.match(md, /## Reply/);
    assert.match(md, /Thanks — here's a concrete tip\./);
    assert.match(md, /baitScore: 12/);
    assert.match(md, /authorKey: "builder"/);
  });

  await it("keeps raw Post separate from Summary when both set", () => {
    const md = renderInteractionMarkdown({
      threadId: "2081",
      author: "@Builder",
      userId: "user-1",
      reply: "My reply",
      text: "@Scobleizer He’s also the only guy who can help\n\n Google win a product shipping war",
      summary: "Claiming someone can help Google win a product shipping war against GPT and Claude.",
      reason: "On-agenda but vague; could be worth engaging if more context.",
    });
    assert.match(md, /## Post/);
    assert.match(md, /@Scobleizer/);
    assert.match(md, /## Summary/);
    const postIdx = md.indexOf("## Post");
    const summaryIdx = md.indexOf("## Summary");
    assert.ok(postIdx >= 0 && summaryIdx > postIdx);
    const postSection = md.slice(postIdx, summaryIdx);
    assert.match(postSection, /@Scobleizer/);
    assert.doesNotMatch(postSection, /Claiming someone can help Google/);
  });

  await it("includes OP section for reply cards", () => {
    const md = renderInteractionMarkdown({
      threadId: "99",
      author: "@replier",
      userId: "user-1",
      reply: "Agree",
      text: "Love this Building in public is a skill",
      summary: "Reply praising mentor advice",
      opAuthor: "@ClawUpAI",
      opText: "Don't build in silence. Build in public.",
    });
    assert.match(md, /## OP/);
    assert.match(md, /@ClawUpAI: Don't build in silence/);
    assert.match(md, /## Post/);
    assert.match(md, /Love this Building in public/);
  });
});

await describe("buildInteractionNotePath", async () => {
  await it("uses UTC date, hashed owner and collision-safe thread key under knowledge/interactions", () => {
    const path = buildInteractionNotePath({
      userId: "user-1",
      threadId: "abc/def",
      interactedAt: "2026-07-27T15:00:00.000Z",
      knowledgeRoot: "/tmp/vault",
    });
    assert.equal(
      path,
      join("/tmp/vault", "interactions", `2026-07-27-u${sha("user-1")}-h${sha("abc/def")}.md`),
    );
    assert.equal(
      buildInteractionNotePath({
        userId: "user-1",
        threadId: "2081",
        interactedAt: "2026-07-27T15:00:00.000Z",
        knowledgeRoot: "/tmp/vault",
      }),
      join("/tmp/vault", "interactions", `2026-07-27-u${sha("user-1")}-2081.md`),
    );
  });
});

await describe("writeInteractionMemory", async () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "x-copilot-knowledge-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await it("writes a file containing threadId, owner and reply", async () => {
    const { path } = await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      userId: "user-1",
      reply: "My reply on X",
      text: "Original post",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    const body = await readFile(path, "utf8");
    assert.match(path, new RegExp(`2026-07-27-u${sha("user-1")}-99\\.md$`));
    assert.match(body, /threadId: "99"/);
    assert.match(body, /userId: "user-1"/);
    assert.match(body, /My reply on X/);
    assert.match(body, /## Post/);
    assert.match(body, /Original post/);
  });

  await it("rejects a blank owner without writing", async () => {
    await assert.rejects(
      writeInteractionMemory({
        threadId: "99",
        author: "@A",
        userId: " ",
        reply: "My reply on X",
        knowledgeRoot: root,
      }),
      /userId is required/,
    );
    await assert.rejects(readdir(join(root, "interactions")), /ENOENT/);
  });

  await it("lets two owners save the same thread and date independently", async () => {
    const a = await writeInteractionMemory({
      threadId: "2081",
      author: "@A",
      userId: "user-a",
      reply: "A's reply",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    const b = await writeInteractionMemory({
      threadId: "2081",
      author: "@A",
      userId: "user-b",
      reply: "B's reply",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    assert.notEqual(a.path, b.path);
    assert.match(await readFile(a.path, "utf8"), /A's reply/);
    assert.match(await readFile(b.path, "utf8"), /B's reply/);
    const names = (await readdir(join(root, "interactions"))).filter((n) => n.endsWith(".md"));
    assert.equal(names.length, 2);
  });

  await it("adopts a verified legacy note without deleting the original", async () => {
    const legacy = await writeLegacyNote(root, "2026-07-27-99.md", {
      threadId: "99",
      userId: "user-1",
      interactedAt: "2026-07-27T01:02:03.000Z",
      reply: "legacy reply",
      extra: 'agenda: "Legacy agenda"\nviews1h: 7\n',
    });
    const legacyBefore = await readFile(legacy, "utf8");
    const { path } = await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      userId: "user-1",
      reply: "legacy reply",
      source: "discovered",
      text: "refreshed",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    assert.notEqual(path, legacy);
    const body = await readFile(path, "utf8");
    assert.match(body, /Legacy agenda/);
    assert.match(body, /views1h: 7/);
    assert.match(body, /userId: "user-1"/);
    assert.equal(await readFile(legacy, "utf8"), legacyBefore);
  });

  await it("starts a fresh note across an action-date boundary", async () => {
    const legacy = await writeLegacyNote(root, "2026-07-26-99.md", {
      threadId: "99",
      userId: "user-1",
      interactedAt: "2026-07-26T23:59:00.000Z",
      reply: "legacy reply",
      extra: 'agenda: "Legacy agenda"\nviews24h: 9\n',
    });
    const { path } = await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      userId: "user-1",
      reply: "updated reply",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T00:01:00.000Z",
    });
    assert.notEqual(path, legacy);
    const body = await readFile(path, "utf8");
    assert.match(body, /updated reply/);
    assert.doesNotMatch(body, /Legacy agenda/);
    assert.doesNotMatch(body, /views24h: 9/);
  });

  await it("does not adopt an unowned legacy note on the same thread and date", async () => {
    const legacy = await writeLegacyNote(root, "2026-07-27-99.md", {
      threadId: "99",
      interactedAt: "2026-07-27T01:02:03.000Z",
      reply: "unowned legacy reply",
    });
    const { path } = await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      userId: "user-1",
      reply: "my new reply",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    assert.notEqual(path, legacy);
    assert.doesNotMatch(await readFile(path, "utf8"), /unowned legacy reply/);
    assert.match(await readFile(legacy, "utf8"), /unowned legacy reply/);
  });

  await it("keeps one canonical note for a second same-day reply and labels it with that reply", async () => {
    const interactedAt = "2026-07-27T01:02:03.000Z";
    const first = await writeInteractionMemory({
      threadId: "2081",
      author: "@A",
      userId: "user-1",
      reply: "first take",
      replyId: "reply-1",
      knowledgeRoot: root,
      interactedAt,
    });
    const outcome = await updateInteractionMemoryOutcome({
      interaction: {
        threadId: "2081",
        author: "@A",
        authorKey: "a",
        at: interactedAt,
        source: "manual",
        userId: "user-1",
        replyId: "reply-1",
        stats: {
          t1h: { views: 100, likes: 4, replies: 1, retweets: 0, sampledAt: "2026-07-27T02:02:03.000Z" },
        },
      } as Interaction,
      knowledgeRoot: root,
      nowIso: "2026-07-27T02:02:03.000Z",
    });
    assert.equal(outcome.ok, true);
    const second = await writeInteractionMemory({
      threadId: "2081",
      author: "@A",
      userId: "user-1",
      reply: "second take",
      replyId: "reply-2",
      knowledgeRoot: root,
      interactedAt,
    });
    assert.equal(second.path, first.path);
    assert.equal(
      second.path,
      buildInteractionNotePath({ userId: "user-1", threadId: "2081", interactedAt, knowledgeRoot: root }),
    );
    const names = (await readdir(join(root, "interactions"))).filter((n) => n.endsWith(".md"));
    assert.deepEqual(names, [`2026-07-27-u${sha("user-1")}-2081.md`]);
    const body = await readFile(second.path, "utf8");
    // Reply metadata and the Reply body agree; the canonical Outcome survives.
    assert.match(body, /replyId: "reply-2"/);
    assert.doesNotMatch(body, /replyId: "reply-1"/);
    assert.match(body, /## Reply\n\nsecond take\n/);
    assert.doesNotMatch(body, /first take/);
    assert.match(body, /## Outcome\n\n1h: 100 views/);
    assert.match(body, /views1h: 100/);
    assert.equal((body.match(/## Reply/g) ?? []).length, 1);
  });

  await it("labels a curated Reply with a discovered reply id only when the text matches", async () => {
    const interactedAt = "2026-07-27T01:02:03.000Z";
    const write = (reply: string, replyId: string, source: "manual" | "discovered") =>
      writeInteractionMemory({
        threadId: "2081",
        author: "@A",
        userId: "user-1",
        reply,
        replyId: source === "manual" ? undefined : replyId,
        source,
        text: source === "manual" ? "Curated post" : "Fresh search result",
        summary: source === "manual" ? "Keep this summary" : undefined,
        knowledgeRoot: root,
        interactedAt,
      });
    // Curated note without a reply id; rediscovery of that same reply text
    // may attach its id without touching the curated body.
    const curated = await write("kept reply", "unused", "manual");
    const matched = await write("kept reply", "reply-1", "discovered");
    assert.equal(matched.path, curated.path);
    let body = await readFile(curated.path, "utf8");
    assert.match(body, /replyId: "reply-1"/);
    assert.match(body, /source: manual/);
    assert.match(body, /## Reply\n\nkept reply\n/);
    assert.match(body, /Keep this summary/);
    assert.match(body, /Curated post/);
    assert.doesNotMatch(body, /Fresh search result/);

    // A different reply text keeps the curated Reply and its existing id.
    await write("some other reply", "reply-2", "discovered");
    body = await readFile(curated.path, "utf8");
    assert.match(body, /replyId: "reply-1"/);
    assert.doesNotMatch(body, /replyId: "reply-2"/);
    assert.match(body, /## Reply\n\nkept reply\n/);
    assert.doesNotMatch(body, /some other reply/);

    // A curated note with no id is never relabelled by a non-matching reply.
    const other = await writeInteractionMemory({
      threadId: "3090",
      author: "@A",
      userId: "user-1",
      reply: "hand-written take",
      source: "manual",
      knowledgeRoot: root,
      interactedAt,
    });
    await writeInteractionMemory({
      threadId: "3090",
      author: "@A",
      userId: "user-1",
      reply: "different text on X",
      replyId: "reply-3",
      source: "discovered",
      knowledgeRoot: root,
      interactedAt,
    });
    body = await readFile(other.path, "utf8");
    assert.doesNotMatch(body, /replyId:/);
    assert.match(body, /## Reply\n\nhand-written take\n/);
    assert.equal(
      (await readdir(join(root, "interactions"))).filter((n) => n.endsWith(".md")).length,
      2,
    );
  });
});

await describe("buildDismissalNotePath / writeDismissalMemory", async () => {
  await it("paths under knowledge/dismissals with an owner component", () => {
    assert.equal(
      buildDismissalNotePath({
        userId: "user-1",
        threadId: "42",
        dismissedAt: "2026-07-29T01:00:00.000Z",
        knowledgeRoot: "/tmp/vault",
      }),
      join("/tmp/vault", "dismissals", `2026-07-29-u${sha("user-1")}-42.md`),
    );
    assert.throws(
      () =>
        buildDismissalNotePath({
          userId: "",
          threadId: "42",
          knowledgeRoot: "/tmp/vault",
        }),
      /userId is required/,
    );
  });

  await it("renders dismissal markdown with owner, raw Post, Summary, Reason, and OP", () => {
    const md = renderDismissalMarkdown({
      threadId: "42",
      author: "@x",
      userId: "user-1",
      text: "Love this Building in public is a skill not just posting",
      summary: "promo spam",
      opAuthor: "@mentor",
      opText: "Start the audience before the product",
      reason: "not a question",
      dismissedAt: "2026-07-29T01:00:00.000Z",
    });
    assert.match(md, /type: dismissal/);
    assert.match(md, /userId: "user-1"/);
    assert.match(md, /## Post/);
    assert.match(md, /Love this Building in public/);
    assert.match(md, /## Summary/);
    assert.match(md, /promo spam/);
    assert.match(md, /## OP/);
    assert.match(md, /@mentor: Start the audience/);
    assert.match(md, /not a question/);
    assert.throws(
      () => renderDismissalMarkdown({ threadId: "42", author: "@x", userId: "" }),
      /userId is required/,
    );
  });

  await it("writes dismissal note without reason defaults to (none)", async () => {
    const root = await mkdtemp(join(tmpdir(), "x-copilot-dismiss-mem-"));
    try {
      const { path } = await writeDismissalMemory({
        threadId: "42",
        author: "@x",
        userId: "user-1",
        text: "raw tweet body",
        summary: "promo spam",
        knowledgeRoot: root,
        dismissedAt: "2026-07-29T01:00:00.000Z",
      });
      const body = await readFile(path, "utf8");
      assert.match(body, /\(none\)/);
      assert.match(body, /## Post/);
      assert.match(body, /raw tweet body/);
      assert.match(body, /## Summary/);
      assert.match(body, /promo spam/);
      await assert.rejects(
        writeDismissalMemory({ threadId: "42", author: "@x", userId: "", knowledgeRoot: root }),
        /userId is required/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

await describe("formatOutcomeSection / upsertOutcomeSection", async () => {
  await it("formats 1h and 24h lines", () => {
    const body = formatOutcomeSection({
      t1h: { views: 100, likes: 4, replies: 1, retweets: 0, sampledAt: "2026-08-01T12:00:00.000Z" },
      t24h: { views: 420, likes: 12, replies: 3, retweets: 1, sampledAt: "2026-08-02T12:00:00.000Z" },
    });
    assert.match(body, /1h: 100 views · 4 likes · 1 reply · 0 reposts/);
    assert.match(body, /24h: 420 views · 12 likes · 3 replies · 1 repost/);
  });

  await it("replaces Outcome without touching other sections", () => {
    const body = `## Post\n\nHello\n\n## Outcome\n\nold\n\n## Reply\n\nYo\n`;
    const next = upsertOutcomeSection(body, "1h: 10 views · 0 likes · 0 replies · 0 reposts");
    assert.match(next, /## Post\n\nHello/);
    assert.match(next, /## Reply\n\nYo/);
    assert.match(next, /1h: 10 views/);
    assert.doesNotMatch(next, /\nold\n/);
  });

  await it("replaces Outcome when heading is last line or content spans multiple lines", () => {
    const bare = upsertOutcomeSection(
      "## Post\n\nHello\n\n## Outcome",
      "1h: 10 views · 0 likes · 0 replies · 0 reposts",
    );
    assert.equal((bare.match(/## Outcome/g) ?? []).length, 1);
    assert.match(bare, /1h: 10 views/);

    const multi = upsertOutcomeSection(
      `## Outcome\n\n1h: 100 views\n24h: 420 views\n\n## Reply\n\nYo\n`,
      "1h: 999 views · 0 likes · 0 replies · 0 reposts",
    );
    assert.equal((multi.match(/## Outcome/g) ?? []).length, 1);
    assert.match(multi, /## Reply\n\nYo/);
    assert.match(multi, /1h: 999 views/);
    assert.doesNotMatch(multi, /24h: 420 views/);
  });

  await it("strips managed frontmatter keys only", () => {
    const fm = `type: interaction\nthreadId: "1"\nviews1h: 9\ncustomNote: keep\nsampledAt24h: "x"`;
    const kept = stripManagedOutcomeFrontmatter(fm);
    assert.match(kept, /type: interaction/);
    assert.match(kept, /customNote: keep/);
    assert.doesNotMatch(kept, /views1h/);
    assert.doesNotMatch(kept, /sampledAt24h/);
  });
});

await describe("updateInteractionMemoryOutcome", async () => {
  let root: string;
  const userId = "user-1";
  const interactedAt = "2026-07-27T01:02:03.000Z";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "x-copilot-outcome-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function baseInteraction(partial: Partial<Interaction> = {}): Interaction {
    return {
      threadId: "99",
      author: "@A",
      authorKey: "a",
      at: interactedAt,
      source: "manual",
      userId,
      ...partial,
    };
  }

  const t1h = {
    views: 100,
    likes: 4,
    replies: 1,
    retweets: 0,
    sampledAt: "2026-07-27T02:02:03.000Z",
  };
  const t24h = {
    views: 420,
    likes: 12,
    replies: 3,
    retweets: 1,
    sampledAt: "2026-07-28T01:02:03.000Z",
  };

  await it("soft-fails when note is missing", async () => {
    const result = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({ stats: { t1h } }),
      knowledgeRoot: root,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /not found/);
  });

  await it("soft-fails for an interaction without an owner", async () => {
    await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      userId,
      reply: "My reply",
      knowledgeRoot: root,
      interactedAt,
    });
    const result = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({ userId: "", stats: { t1h } }),
      knowledgeRoot: root,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /no owner/);
  });

  await it("writes t1h-only Outcome and frontmatter", async () => {
    await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      userId,
      reply: "My reply",
      text: "Original post",
      summary: "A summary",
      knowledgeRoot: root,
      interactedAt,
    });
    const result = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({ stats: { t1h } }),
      knowledgeRoot: root,
      nowIso: "2026-07-27T02:02:03.000Z",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const body = await readFile(result.path, "utf8");
    assert.match(body, /views1h: 100/);
    assert.match(body, /likes1h: 4/);
    assert.match(body, /sampledAt1h: "2026-07-27T02:02:03\.000Z"/);
    assert.match(body, /## Outcome/);
    assert.match(body, /1h: 100 views · 4 likes · 1 reply · 0 reposts/);
    assert.match(body, /## Post/);
    assert.match(body, /Original post/);
    assert.match(body, /## Reply/);
    assert.match(body, /My reply/);
    assert.doesNotMatch(body, /views24h/);
  });

  await it("locates outcomes by postedAt when it crosses a UTC date boundary", async () => {
    const at = "2026-07-27T23:59:00.000Z";
    const postedAt = "2026-07-28T00:01:00.000Z";
    await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      userId,
      reply: "Earlier reply",
      knowledgeRoot: root,
      interactedAt: at,
    });
    await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      userId,
      reply: "Canonical reply",
      knowledgeRoot: root,
      interactedAt: postedAt,
    });

    const result = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({
        at,
        postedAt,
        stats: { t1h: { views: 5, likes: 1, replies: 0, retweets: 0, sampledAt: postedAt } },
      }),
      knowledgeRoot: root,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.match(result.path, /2026-07-28-u[0-9a-f]{64}-99\.md$/);
    const body = await readFile(result.path, "utf8");
    assert.match(body, /Canonical reply/);
    assert.doesNotMatch(body, /Earlier reply/);
  });

  await it("never updates another owner's note for the same thread and date", async () => {
    const foreign = await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      userId: "user-other",
      reply: "Other's reply",
      knowledgeRoot: root,
      interactedAt,
    });
    const result = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({ stats: { t1h } }),
      knowledgeRoot: root,
    });
    assert.equal(result.ok, false);
    assert.doesNotMatch(await readFile(foreign.path, "utf8"), /views1h/);
  });

  await it("keeps t1h when writing t24h and is idempotent", async () => {
    const input = {
      threadId: "99",
      author: "@A",
      userId,
      reply: "My reply",
      source: "discovered" as const,
      knowledgeRoot: root,
      interactedAt,
    };
    await writeInteractionMemory({ ...input, text: "Original post" });
    const stats = { t1h, t24h };
    const first = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({ stats }),
      knowledgeRoot: root,
      nowIso: "2026-07-28T01:02:03.000Z",
    });
    assert.equal(first.ok, true);
    await writeInteractionMemory({ ...input, text: "Updated original" });
    const notePath = buildInteractionNotePath({
      userId,
      threadId: "99",
      interactedAt,
      knowledgeRoot: root,
    });
    const intermediate = await readFile(notePath, "utf8");
    assert.match(intermediate, /## Outcome/);
    assert.match(intermediate, /views1h: 100/);
    assert.match(intermediate, /views24h: 420/);
    const second = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({ stats }),
      knowledgeRoot: root,
      nowIso: "2026-07-28T01:02:03.000Z",
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    const body = await readFile(second.path, "utf8");
    assert.equal((body.match(/## Outcome/g) ?? []).length, 1);
    assert.equal((body.match(/views1h: 100/g) ?? []).length, 1);
    assert.equal((body.match(/views24h: 420/g) ?? []).length, 1);
    assert.match(body, /Updated original/);
    assert.match(body, /24h: 420 views · 12 likes · 3 replies · 1 repost/);
  });

  await it("preserves curated context and both checkpoints across repeated same-user projections", async () => {
    const input = {
      threadId: "100",
      author: "@A",
      userId,
      reply: "My reply",
      knowledgeRoot: root,
      interactedAt,
    };
    await writeInteractionMemory({
      ...input,
      summary: "Keep this summary",
      agenda: "Keep this agenda",
      source: "manual",
      text: "Curated post",
    });
    assert.equal(
      (
        await updateInteractionMemoryOutcome({
          interaction: baseInteraction({ threadId: "100", stats: { t1h } }),
          knowledgeRoot: root,
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await updateInteractionMemoryOutcome({
          interaction: baseInteraction({ threadId: "100", stats: { t24h } }),
          knowledgeRoot: root,
        })
      ).ok,
      true,
    );
    for (let i = 0; i < 3; i++) {
      await writeInteractionMemory({
        ...input,
        source: "discovered",
        text: `Fresh search result ${i}`,
      });
    }
    const names = (await readdir(join(root, "interactions"))).filter((n) => n.endsWith(".md"));
    assert.equal(names.length, 1);
    const body = await readFile(
      buildInteractionNotePath({ userId, threadId: "100", interactedAt, knowledgeRoot: root }),
      "utf8",
    );
    assert.match(body, /type: interaction/);
    assert.match(body, /threadId: "100"/);
    assert.match(body, /userId: "user-1"/);
    assert.match(body, /source: manual/);
    assert.match(body, /Keep this summary/);
    assert.match(body, /Keep this agenda/);
    assert.match(body, /Curated post/);
    assert.match(body, /views1h: 100/);
    assert.match(body, /views24h: 420/);
    assert.equal((body.match(/## Outcome/g) ?? []).length, 1);
    assert.doesNotMatch(body, /Fresh search result/);
  });

  await it("updates a manually written note when it is written again manually", async () => {
    const input = {
      threadId: "101",
      author: "@A",
      userId,
      source: "manual" as const,
      knowledgeRoot: root,
      interactedAt,
    };
    await writeInteractionMemory({
      ...input,
      reply: "First reply",
      text: "First post",
      agenda: "First agenda",
      intent: "First intent",
      url: "https://example.com/first",
    });
    await writeInteractionMemory({
      ...input,
      reply: "Updated reply",
      text: "Updated post",
      agenda: "Updated agenda",
      intent: "Updated intent",
      url: "https://example.com/updated",
    });
    const body = await readFile(
      buildInteractionNotePath({ userId, threadId: "101", interactedAt, knowledgeRoot: root }),
      "utf8",
    );
    assert.match(body, /Updated reply/);
    assert.match(body, /Updated post/);
    assert.match(body, /Updated agenda/);
    assert.match(body, /Updated intent/);
    assert.match(body, /url: "https:\/\/example.com\/updated"/);
    assert.doesNotMatch(body, /First agenda/);
    assert.doesNotMatch(body, /First intent/);
    assert.doesNotMatch(body, /First reply/);
  });

  await it("does not overwrite an interaction note planted at another owner's path", async () => {
    // Same filename can only mean a hand-edited or planted file; metadata wins.
    const path = buildInteractionNotePath({
      userId: "user-2",
      threadId: "foreign-owner",
      interactedAt,
      knowledgeRoot: root,
    });
    await mkdir(join(root, "interactions"), { recursive: true });
    await writeFile(
      path,
      `---\ntype: interaction\nthreadId: "foreign-owner"\nuserId: "user-1"\ninteractedAt: "${interactedAt}"\n---\n\n## Reply\n\nFirst user's reply\n`,
      "utf8",
    );
    await assert.rejects(
      writeInteractionMemory({
        threadId: "foreign-owner",
        author: "@A",
        reply: "Second user's reply",
        source: "manual",
        userId: "user-2",
        knowledgeRoot: root,
        interactedAt,
      }),
      /belongs to another user/,
    );
    const body = await readFile(path, "utf8");
    assert.match(body, /userId: "user-1"/);
    assert.match(body, /First user's reply/);
    assert.doesNotMatch(body, /Second user's reply/);
  });

  await it("removes omitted fields when a manual note is rewritten", async () => {
    const input = {
      threadId: "103",
      author: "@A",
      userId,
      knowledgeRoot: root,
      interactedAt,
    } as const;
    await writeInteractionMemory({
      ...input,
      reply: "First reply",
      text: "First post",
      agenda: "First agenda",
      intent: "First intent",
      url: "https://example.com/first",
    });
    await writeInteractionMemory({ ...input, reply: "Updated reply", text: "Updated post" });
    const body = await readFile(buildInteractionNotePath(input), "utf8");
    assert.match(body, /Updated reply/);
    assert.match(body, /Updated post/);
    assert.doesNotMatch(body, /agenda:/);
    assert.doesNotMatch(body, /intent:/);
    assert.doesNotMatch(body, /url:/);
  });

  await it("keeps manual content after replacing a discovered note", async () => {
    const input = {
      threadId: "102",
      author: "@A",
      userId,
      knowledgeRoot: root,
      interactedAt,
    } as const;
    await writeInteractionMemory({
      ...input,
      reply: "Discovered reply",
      source: "discovered",
      text: "Discovered post",
    });
    await writeInteractionMemory({
      ...input,
      reply: "Curated reply",
      source: "manual",
      text: "Curated post",
      summary: "Curated summary",
    });
    await writeInteractionMemory({
      ...input,
      reply: "Refreshed reply",
      source: "discovered",
      text: "Refreshed post",
    });
    const body = await readFile(buildInteractionNotePath(input), "utf8");
    assert.match(body, /source: manual/);
    assert.match(body, /Curated reply/);
    assert.match(body, /Curated post/);
    assert.match(body, /Curated summary/);
    assert.doesNotMatch(body, /Refreshed reply/);
  });

  await it("keeps the earlier checkpoint when a later tick writes only the other", async () => {
    await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      userId,
      reply: "My reply",
      text: "Original post",
      knowledgeRoot: root,
      interactedAt,
    });
    const first = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({ stats: { t1h } }),
      knowledgeRoot: root,
      nowIso: "2026-07-27T02:02:03.000Z",
    });
    assert.equal(first.ok, true);
    const second = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({ stats: { t24h } }),
      knowledgeRoot: root,
      nowIso: "2026-07-28T01:02:03.000Z",
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    const body = await readFile(second.path, "utf8");
    assert.match(body, /views1h: 100/);
    assert.match(body, /views24h: 420/);
    assert.match(body, /1h: 100 views · 4 likes · 1 reply · 0 reposts/);
    assert.match(body, /24h: 420 views · 12 likes · 3 replies · 1 repost/);
    assert.equal((body.match(/## Outcome/g) ?? []).length, 1);
  });

  await it("adopts a verified legacy note found via suffix fallback into the canonical path", async () => {
    const legacy = await writeLegacyNote(root, "2026-07-26-99.md", {
      threadId: "99",
      userId,
      interactedAt: "2026-07-26T23:00:00.000Z",
      reply: "My reply",
    });
    const legacyBefore = await readFile(legacy, "utf8");
    const found = await findInteractionNotePath({
      userId,
      threadId: "99",
      interactedAt,
      knowledgeRoot: root,
    });
    assert.equal(found, legacy);

    const result = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({ stats: { t1h } }),
      knowledgeRoot: root,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.path,
      buildInteractionNotePath({ userId, threadId: "99", interactedAt, knowledgeRoot: root }),
    );
    assert.match(await readFile(result.path, "utf8"), /views1h: 100/);
    assert.equal(await readFile(legacy, "utf8"), legacyBefore);
    assert.equal(
      await findInteractionNotePath({ userId, threadId: "99", interactedAt, knowledgeRoot: root }),
      result.path,
    );
  });

  await it("ignores unowned legacy notes and stays unavailable when candidates are ambiguous", async () => {
    await writeLegacyNote(root, "2026-07-26-99.md", {
      threadId: "99",
      interactedAt: "2026-07-26T23:00:00.000Z",
      reply: "unowned",
    });
    assert.equal(
      await findInteractionNotePath({ userId, threadId: "99", interactedAt, knowledgeRoot: root }),
      null,
    );
    assert.equal(
      (await updateInteractionMemoryOutcome({
        interaction: baseInteraction({ stats: { t1h } }),
        knowledgeRoot: root,
      })).ok,
      false,
    );
    await writeLegacyNote(root, "2026-07-24-99.md", {
      threadId: "99",
      userId,
      interactedAt: "2026-07-24T23:00:00.000Z",
      reply: "first",
    });
    await writeLegacyNote(root, "2026-07-25-99.md", {
      threadId: "99",
      userId,
      interactedAt: "2026-07-25T23:00:00.000Z",
      reply: "second",
    });
    assert.equal(
      await findInteractionNotePath({ userId, threadId: "99", interactedAt, knowledgeRoot: root }),
      null,
    );
  });

  await it("fallback prefers a note whose interactedAt matches interaction.at", async () => {
    await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      userId,
      reply: "Unrelated later reply",
      knowledgeRoot: root,
      interactedAt: "2026-07-28T10:00:00.000Z",
    });
    await writeLegacyNote(root, "2026-07-26-99.md", {
      threadId: "99",
      userId,
      interactedAt,
      reply: "My reply",
    });
    const found = await findInteractionNotePath({
      userId,
      threadId: "99",
      interactedAt,
      knowledgeRoot: root,
    });
    assert.ok(found);
    assert.match(found!, /2026-07-26-99\.md$/);
  });
});

await describe("listInteractionMemoryReplies", async () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "x-copilot-knowledge-list-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  await it("only returns notes owned by the requested userId", async () => {
    await writeInteractionMemory({
      threadId: "111",
      author: "@A",
      reply: "A's reply",
      userId: "user-a",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    await writeInteractionMemory({
      threadId: "222",
      author: "@B",
      reply: "B's reply",
      userId: "user-b",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });

    const forA = await listInteractionMemoryReplies({ knowledgeRoot: root, userId: "user-a" });
    assert.deepEqual(forA.map((n) => n.text), ["A's reply"]);
    const forB = await listInteractionMemoryReplies({ knowledgeRoot: root, userId: "user-b" });
    assert.deepEqual(forB.map((n) => n.text), ["B's reply"]);
  });

  await it("skips unowned notes so they never leak into a user's corpus", async () => {
    await writeLegacyNote(root, "2026-07-27-111.md", {
      threadId: "111",
      interactedAt: "2026-07-27T01:02:03.000Z",
      reply: "A's reply",
    });
    const rows = await listInteractionMemoryReplies({ knowledgeRoot: root, userId: "user-a" });
    assert.equal(rows.length, 0);
  });

  await it("folds unowned notes when the caller opts in (single-user sidecar)", async () => {
    await writeLegacyNote(root, "2026-07-27-111.md", {
      threadId: "111",
      interactedAt: "2026-07-27T01:02:03.000Z",
      reply: "pre-PR reply",
    });
    const rows = await listInteractionMemoryReplies({
      knowledgeRoot: root,
      userId: "user-a",
      includeUnowned: true,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.text, "pre-PR reply");
  });

  await it("still keeps another user's notes out even with includeUnowned", async () => {
    await writeInteractionMemory({
      threadId: "111",
      author: "@B",
      reply: "B's reply",
      userId: "user-b",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    const rows = await listInteractionMemoryReplies({
      knowledgeRoot: root,
      userId: "user-a",
      includeUnowned: true,
    });
    assert.deepEqual(rows.map((n) => n.text), []);
  });

  await it("returns one entry per migrated legacy note and excludes conflicting owners", async () => {
    await writeLegacyNote(root, "2026-07-27-111.md", {
      threadId: "111",
      userId: "user-a",
      interactedAt: "2026-07-27T01:02:03.000Z",
      reply: "owned legacy reply",
    });
    await mkdir(join(root, "interactions"), { recursive: true });
    await writeFile(
      join(root, "interactions", "2026-07-27-333.md"),
      `---\ntype: interaction\nthreadId: "333"\nuserId: "user-a"\nuserId: "user-b"\ninteractedAt: "2026-07-27T01:02:03.000Z"\n---\n\n## Reply\n\nconflicting\n`,
      "utf8",
    );
    const first = await listInteractionMemoryReplies({
      knowledgeRoot: root,
      userId: "user-a",
      includeUnowned: true,
    });
    assert.deepEqual(first.map((n) => n.text), ["owned legacy reply"]);
    // The scan copied the owned legacy note; the original stays and the
    // canonical copy is what gets listed on the next pass — still once.
    const names = (await readdir(join(root, "interactions"))).filter((n) => n.endsWith(".md"));
    assert.equal(names.length, 3);
    assert.ok(names.includes("2026-07-27-111.md"));
    const second = await listInteractionMemoryReplies({ knowledgeRoot: root, userId: "user-a" });
    assert.deepEqual(second.map((n) => n.text), ["owned legacy reply"]);
  });
});
