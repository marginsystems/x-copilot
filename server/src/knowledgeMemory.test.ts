import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDismissalNotePath,
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
} from "./knowledgeMemory.ts";
import type { Interaction } from "./interactionStore.ts";

describe("safeThreadIdForFilename", () => {
  it("keeps alphanumerics and strips junk", () => {
    assert.equal(safeThreadIdForFilename("2081314968155111817"), "2081314968155111817");
    assert.equal(safeThreadIdForFilename("../evil/id!!"), "evil_id");
    assert.equal(safeThreadIdForFilename("   "), "unknown");
  });
});

describe("normalizeReply / renderInteractionMarkdown", () => {
  it("renders discovered source", () => {
    const md = renderInteractionMarkdown({
      threadId: "t1",
      author: "@A",
      reply: "off-app reply",
      source: "discovered",
    });
    assert.match(md, /source: discovered/);
  });

  it("rejects empty reply", () => {
    assert.equal(normalizeReply("  \n\t "), "");
    assert.throws(
      () =>
        renderInteractionMarkdown({
          threadId: "1",
          author: "@Foo",
          reply: "   ",
        }),
      /reply is required/,
    );
  });

  it("parses threadId and Reply out of a rendered note", async () => {
    const md = renderInteractionMarkdown({
      threadId: "2081",
      author: "@Builder",
      reply: "Thanks — here's a concrete tip.",
      interactedAt: "2026-07-27T12:00:00.000Z",
    });
    assert.deepEqual(parseInteractionNoteReply(md), {
      threadId: "2081",
      text: "Thanks — here's a concrete tip.",
      postedAt: "2026-07-27T12:00:00.000Z",
    });
  });

  it("round-trips a multi-line Reply body", () => {
    const md = renderInteractionMarkdown({
      threadId: "2081",
      author: "@Builder",
      reply: "Line one\nLine two",
      interactedAt: "2026-07-27T12:00:00.000Z",
    });
    assert.deepEqual(parseInteractionNoteReply(md), {
      threadId: "2081",
      text: "Line one\nLine two",
      postedAt: "2026-07-27T12:00:00.000Z",
    });
  });

  it("includes threadId and reply in markdown", () => {
    const md = renderInteractionMarkdown({
      threadId: "2081",
      author: "@Builder",
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

  it("keeps raw Post separate from Summary when both set", () => {
    const md = renderInteractionMarkdown({
      threadId: "2081",
      author: "@Builder",
      reply: "My reply",
      text: "@Scobleizer He’s also the only guy who can help\n\n Google win a product shipping war",
      summary: "Claiming someone can help Google win a product shipping war against GPT and Claude.",
      reason: "On-agenda but vague; could be worth engaging if more context.",
    });
    assert.match(md, /## Post/);
    assert.match(md, /@Scobleizer/);
    assert.match(md, /## Summary/);
    assert.match(md, /Claiming someone can help Google/);
    // Summary must not be the Post body (old bug: summary || text).
    const postIdx = md.indexOf("## Post");
    const summaryIdx = md.indexOf("## Summary");
    assert.ok(postIdx >= 0 && summaryIdx > postIdx);
    const postSection = md.slice(postIdx, summaryIdx);
    assert.match(postSection, /@Scobleizer/);
    assert.doesNotMatch(postSection, /Claiming someone can help Google/);
  });

  it("includes OP section for reply cards", () => {
    const md = renderInteractionMarkdown({
      threadId: "99",
      author: "@replier",
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

describe("buildInteractionNotePath", () => {
  it("uses UTC date and safe id under knowledge/interactions", () => {
    const path = buildInteractionNotePath({
      threadId: "abc/def",
      interactedAt: "2026-07-27T15:00:00.000Z",
      knowledgeRoot: "/tmp/vault",
    });
    assert.equal(path, join("/tmp/vault", "interactions", "2026-07-27-abc_def.md"));
  });
});

describe("writeInteractionMemory", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "x-copilot-knowledge-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes a file containing threadId and reply", async () => {
    const { path } = await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      reply: "My reply on X",
      text: "Original post",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    const body = await readFile(path, "utf8");
    assert.match(path, /2026-07-27-99\.md$/);
    assert.match(body, /threadId: "99"/);
    assert.match(body, /My reply on X/);
    assert.match(body, /## Post/);
    assert.match(body, /Original post/);
  });
});

describe("buildDismissalNotePath / writeDismissalMemory", () => {
  it("paths under knowledge/dismissals", () => {
    assert.equal(
      buildDismissalNotePath({
        threadId: "42",
        dismissedAt: "2026-07-29T01:00:00.000Z",
        knowledgeRoot: "/tmp/vault",
      }),
      join("/tmp/vault", "dismissals", "2026-07-29-42.md"),
    );
  });

  it("renders dismissal markdown with raw Post, Summary, Reason, and OP", () => {
    const md = renderDismissalMarkdown({
      threadId: "42",
      author: "@x",
      text: "Love this Building in public is a skill not just posting",
      summary: "promo spam",
      opAuthor: "@mentor",
      opText: "Start the audience before the product",
      reason: "not a question",
      dismissedAt: "2026-07-29T01:00:00.000Z",
    });
    assert.match(md, /type: dismissal/);
    assert.match(md, /## Post/);
    assert.match(md, /Love this Building in public/);
    assert.match(md, /## Summary/);
    assert.match(md, /promo spam/);
    assert.match(md, /## OP/);
    assert.match(md, /@mentor: Start the audience/);
    assert.match(md, /not a question/);
    const postIdx = md.indexOf("## Post");
    const summaryIdx = md.indexOf("## Summary");
    const postSection = md.slice(postIdx, summaryIdx > 0 ? summaryIdx : undefined);
    // OP may be between Post and Summary — check Post isn't only summary
    assert.doesNotMatch(
      md.slice(postIdx, md.indexOf("## OP")),
      /^## Post\n\npromo spam$/m,
    );
    assert.ok(postSection.includes("Love this") || md.includes("Love this"));
  });

  it("writes dismissal note without reason defaults to (none)", async () => {
    const root = await mkdtemp(join(tmpdir(), "x-copilot-dismiss-mem-"));
    try {
      const { path } = await writeDismissalMemory({
        threadId: "42",
        author: "@x",
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
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("formatOutcomeSection / upsertOutcomeSection", () => {
  it("formats 1h and 24h lines", () => {
    const body = formatOutcomeSection({
      t1h: {
        views: 100,
        likes: 4,
        replies: 1,
        retweets: 0,
        sampledAt: "2026-08-01T12:00:00.000Z",
      },
      t24h: {
        views: 420,
        likes: 12,
        replies: 3,
        retweets: 1,
        sampledAt: "2026-08-02T12:00:00.000Z",
      },
    });
    assert.match(body, /1h: 100 views · 4 likes · 1 reply · 0 reposts/);
    assert.match(body, /24h: 420 views · 12 likes · 3 replies · 1 repost/);
  });

  it("replaces Outcome without touching other sections", () => {
    const body = `## Post\n\nHello\n\n## Outcome\n\nold\n\n## Reply\n\nYo\n`;
    const next = upsertOutcomeSection(body, "1h: 10 views · 0 likes · 0 replies · 0 reposts");
    assert.match(next, /## Post\n\nHello/);
    assert.match(next, /## Reply\n\nYo/);
    assert.match(next, /1h: 10 views/);
    assert.doesNotMatch(next, /\nold\n/);
  });

  it("replaces Outcome when heading is last line or content spans multiple lines", () => {
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

  it("strips managed frontmatter keys only", () => {
    const fm = `type: interaction\nthreadId: "1"\nviews1h: 9\ncustomNote: keep\nsampledAt24h: "x"`;
    const kept = stripManagedOutcomeFrontmatter(fm);
    assert.match(kept, /type: interaction/);
    assert.match(kept, /customNote: keep/);
    assert.doesNotMatch(kept, /views1h/);
    assert.doesNotMatch(kept, /sampledAt24h/);
  });
});

describe("updateInteractionMemoryOutcome", () => {
  let root: string;

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
      at: "2026-07-27T01:02:03.000Z",
      source: "manual",
      ...partial,
    };
  }

  it("soft-fails when note is missing", async () => {
    const result = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({
        stats: {
          t1h: {
            views: 10,
            likes: 0,
            replies: 0,
            retweets: 0,
            sampledAt: "2026-07-27T02:00:00.000Z",
          },
        },
      }),
      knowledgeRoot: root,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /not found/);
  });

  it("writes t1h-only Outcome and frontmatter", async () => {
    await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      reply: "My reply",
      text: "Original post",
      summary: "A summary",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    const result = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({
        stats: {
          t1h: {
            views: 100,
            likes: 4,
            replies: 1,
            retweets: 0,
            sampledAt: "2026-07-27T02:02:03.000Z",
          },
        },
      }),
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

  it("keeps t1h when writing t24h and is idempotent", async () => {
    await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      reply: "My reply",
      source: "discovered",
      text: "Original post",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    const stats = {
      t1h: {
        views: 100,
        likes: 4,
        replies: 1,
        retweets: 0,
        sampledAt: "2026-07-27T02:02:03.000Z",
      },
      t24h: {
        views: 420,
        likes: 12,
        replies: 3,
        retweets: 1,
        sampledAt: "2026-07-28T01:02:03.000Z",
      },
    };
    const first = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({ stats }),
      knowledgeRoot: root,
      nowIso: "2026-07-28T01:02:03.000Z",
    });
    assert.equal(first.ok, true);
    await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      reply: "My reply",
      source: "discovered",
      text: "Updated original",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    const intermediate = await readFile(
      buildInteractionNotePath({
        threadId: "99",
        interactedAt: "2026-07-27T01:02:03.000Z",
        knowledgeRoot: root,
      }),
      "utf8",
    );
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

  it("preserves manually curated fields during a discovered refresh", async () => {
    await writeInteractionMemory({
      threadId: "100",
      author: "@A",
      reply: "My reply",
      userId: "user-1",
      summary: "Keep this summary",
      agenda: "Keep this agenda",
      source: "manual",
      text: "Curated post",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    await writeInteractionMemory({
      threadId: "100",
      author: "@A",
      reply: "My reply",
      source: "discovered",
      text: "Fresh search result",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    const body = await readFile(
      buildInteractionNotePath({
        threadId: "100",
        interactedAt: "2026-07-27T01:02:03.000Z",
        knowledgeRoot: root,
      }),
      "utf8",
    );
    assert.match(body, /userId: "user-1"/);
    assert.match(body, /Keep this summary/);
    assert.match(body, /Keep this agenda/);
    assert.match(body, /Curated post/);
    assert.doesNotMatch(body, /Fresh search result/);
  });

  it("keeps the earlier checkpoint when a later tick writes only the other", async () => {
    await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      reply: "My reply",
      text: "Original post",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    const first = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({
        stats: {
          t1h: {
            views: 100,
            likes: 4,
            replies: 1,
            retweets: 0,
            sampledAt: "2026-07-27T02:02:03.000Z",
          },
        },
      }),
      knowledgeRoot: root,
      nowIso: "2026-07-27T02:02:03.000Z",
    });
    assert.equal(first.ok, true);
    const second = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({
        stats: {
          t24h: {
            views: 420,
            likes: 12,
            replies: 3,
            retweets: 1,
            sampledAt: "2026-07-28T01:02:03.000Z",
          },
        },
      }),
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

  it("finds legacy notes via filename suffix fallback", async () => {
    // Write with a different date than interaction.at
    await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      reply: "My reply",
      text: "Original post",
      knowledgeRoot: root,
      interactedAt: "2026-07-26T23:00:00.000Z",
    });
    const found = await findInteractionNotePath({
      threadId: "99",
      interactedAt: "2026-07-27T01:02:03.000Z",
      knowledgeRoot: root,
    });
    assert.ok(found);
    assert.match(found!, /2026-07-26-99\.md$/);

    const result = await updateInteractionMemoryOutcome({
      interaction: baseInteraction({
        at: "2026-07-27T01:02:03.000Z",
        stats: {
          t1h: {
            views: 5,
            likes: 0,
            replies: 0,
            retweets: 0,
            sampledAt: "2026-07-27T02:00:00.000Z",
          },
        },
      }),
      knowledgeRoot: root,
    });
    assert.equal(result.ok, true);
  });

  it("fallback prefers a note whose interactedAt matches interaction.at", async () => {
    // A re-marked thread can leave multiple dated notes sharing a threadId.
    // The expected path for interaction.at is absent (no note written on the
    // latest mark), so the suffix fallback must not pick the newest file.
    await writeInteractionMemory({
      threadId: "99",
      author: "@A",
      reply: "Unrelated later reply",
      knowledgeRoot: root,
      interactedAt: "2026-07-28T10:00:00.000Z",
    });
    const legacyDir = join(root, "interactions");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      join(legacyDir, "2026-07-26-99.md"),
      '---\ntype: interaction\nthreadId: "99"\ninteractedAt: "2026-07-27T01:02:03.000Z"\n---\n\n## Reply\n\nMy reply\n',
      "utf8",
    );
    const found = await findInteractionNotePath({
      threadId: "99",
      interactedAt: "2026-07-27T01:02:03.000Z",
      knowledgeRoot: root,
    });
    assert.ok(found);
    assert.match(found!, /2026-07-26-99\.md$/);
  });
});

describe("listInteractionMemoryReplies", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "x-copilot-knowledge-list-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("only returns notes owned by the requested userId", async () => {
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

    const forA = await listInteractionMemoryReplies({
      knowledgeRoot: root,
      userId: "user-a",
    });
    assert.deepEqual(
      forA.map((n) => n.text),
      ["A's reply"],
    );

    const forB = await listInteractionMemoryReplies({
      knowledgeRoot: root,
      userId: "user-b",
    });
    assert.deepEqual(
      forB.map((n) => n.text),
      ["B's reply"],
    );
  });

  it("skips unowned notes so they never leak into a user's corpus", async () => {
    await writeInteractionMemory({
      threadId: "111",
      author: "@A",
      reply: "A's reply",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    const rows = await listInteractionMemoryReplies({
      knowledgeRoot: root,
      userId: "user-a",
    });
    assert.equal(rows.length, 0);
  });

  it("folds unowned notes when the caller opts in (single-user sidecar)", async () => {
    await writeInteractionMemory({
      threadId: "111",
      author: "@A",
      reply: "pre-PR reply",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    const rows = await listInteractionMemoryReplies({
      knowledgeRoot: root,
      userId: "user-a",
      includeUnowned: true,
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.text, "pre-PR reply");
  });

  it("still keeps another user's notes out even with includeUnowned", async () => {
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
    assert.deepEqual(
      rows.map((n) => n.text),
      [],
    );
  });
});
