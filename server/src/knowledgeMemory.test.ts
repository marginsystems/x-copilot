import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildInteractionNotePath,
  normalizeReply,
  renderInteractionMarkdown,
  safeThreadIdForFilename,
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
    assert.match(body, /Original post/);
  });
});
