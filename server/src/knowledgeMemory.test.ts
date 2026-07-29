import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDismissalNotePath,
  buildInteractionNotePath,
  normalizeReply,
  renderDismissalMarkdown,
  renderInteractionMarkdown,
  safeThreadIdForFilename,
  writeDismissalMemory,
  writeInteractionMemory,
} from "./knowledgeMemory.ts";

describe("safeThreadIdForFilename", () => {
  it("keeps alphanumerics and strips junk", () => {
    assert.equal(safeThreadIdForFilename("2081314968155111817"), "2081314968155111817");
    assert.equal(safeThreadIdForFilename("../evil/id!!"), "evil_id");
    assert.equal(safeThreadIdForFilename("   "), "unknown");
  });
});

describe("normalizeReply / renderInteractionMarkdown", () => {
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
