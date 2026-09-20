import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  projectConfirmedReplyMemory,
  resetInteractionMemoryProjectionForTests,
} from "./interactionMemoryProjection.ts";
import {
  buildInteractionNotePath,
  updateInteractionMemoryOutcome,
  writeInteractionMemory,
} from "./knowledgeMemory.ts";
import { createHashEmbedder, type Embedder } from "./memoryIndex.ts";
import type { Interaction } from "../desk/interactionStore.ts";

const interactedAt = "2026-07-27T12:00:00.000Z";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    threadId: "2081",
    author: "@Builder",
    reply: "Thanks — here's a concrete tip.",
    interactedAt,
    source: "manual" as const,
    ...overrides,
  };
}

describe("projectConfirmedReplyMemory", () => {
  let root: string;

  beforeEach(async () => {
    resetInteractionMemoryProjectionForTests();
    root = await mkdtemp(join(tmpdir(), "x-copilot-c01-proj-"));
  });

  afterEach(async () => {
    resetInteractionMemoryProjectionForTests();
    await rm(root, { recursive: true, force: true });
  });

  it("saves confirmed reply text and returns the note path", async () => {
    const result = await projectConfirmedReplyMemory(
      baseInput({
        knowledgeRoot: root,
        text: "How do I ship AI tools in public?",
        upsertMemory: false,
      }),
    );
    assert.equal(result.state, "saved");
    assert.ok(result.memoryPath);
    const body = await readFile(result.memoryPath!, "utf8");
    assert.match(body, /userId: "user-1"/);
    assert.match(body, /Thanks — here's a concrete tip\./);
    assert.match(body, /How do I ship AI tools in public\?/);
    assert.match(body, /source: manual/);
  });

  it("returns no_reply_text without writing when reply text is missing", async () => {
    const result = await projectConfirmedReplyMemory(
      baseInput({
        reply: "  \n\t ",
        text: "Parent post text from a detector must not become a reply.",
        knowledgeRoot: root,
      }),
    );
    assert.deepEqual(result, { state: "no_reply_text" });
    await assert.rejects(
      () =>
        readFile(
          buildInteractionNotePath({
            threadId: "2081",
            interactedAt,
            knowledgeRoot: root,
          }),
          "utf8",
        ),
      /ENOENT/,
    );
  });

  it("returns unavailable when the note write is injected to fail", async () => {
    resetInteractionMemoryProjectionForTests({
      writeNote: async () => {
        throw new Error("EACCES: injected filesystem failure");
      },
    });
    const result = await projectConfirmedReplyMemory(
      baseInput({ knowledgeRoot: root }),
    );
    assert.deepEqual(result, { state: "unavailable" });
    await assert.rejects(
      () =>
        readFile(
          buildInteractionNotePath({
            threadId: "2081",
            interactedAt,
            knowledgeRoot: root,
          }),
          "utf8",
        ),
      /ENOENT/,
    );
  });

  it("keeps a saved note when MiniLM upsert is unavailable", async () => {
    const bad: Embedder = {
      dimensions: 8,
      async embed() {
        throw new Error("MiniLM unavailable");
      },
    };
    const result = await projectConfirmedReplyMemory(
      baseInput({
        knowledgeRoot: root,
        indexDir: join(root, "index"),
        embedder: bad,
        awaitUpsert: true,
      }),
    );
    assert.equal(result.state, "saved");
    assert.ok(result.memoryPath);
    const body = await readFile(result.memoryPath!, "utf8");
    assert.match(body, /Thanks — here's a concrete tip\./);
  });

  it("keeps a saved note when index upsert is injected to fail", async () => {
    let upserted = "";
    resetInteractionMemoryProjectionForTests({
      upsertNote: async (notePath) => {
        upserted = notePath;
        return { ok: false, path: notePath, error: "injected index failure" };
      },
    });
    const result = await projectConfirmedReplyMemory(
      baseInput({
        knowledgeRoot: root,
        awaitUpsert: true,
      }),
    );
    assert.equal(result.state, "saved");
    assert.equal(result.memoryPath, upserted);
    const body = await readFile(result.memoryPath!, "utf8");
    assert.match(body, /Thanks — here's a concrete tip\./);
  });

  it("preserves existing outcome and curated context on a discovered refresh", async () => {
    const first = await writeInteractionMemory({
      threadId: "2081",
      author: "@Builder",
      reply: "Thanks — here's a concrete tip.",
      userId: "user-1",
      source: "manual",
      text: "Curated post",
      summary: "Keep this summary",
      agenda: "Keep this agenda",
      knowledgeRoot: root,
      interactedAt,
    });
    const outcome = await updateInteractionMemoryOutcome({
      interaction: {
        threadId: "2081",
        author: "@Builder",
        authorKey: "builder",
        at: interactedAt,
        source: "manual",
        userId: "user-1",
        stats: {
          t1h: {
            views: 100,
            likes: 4,
            replies: 1,
            retweets: 0,
            sampledAt: "2026-07-27T13:00:00.000Z",
          },
        },
      } as Interaction,
      knowledgeRoot: root,
      nowIso: "2026-07-27T13:00:00.000Z",
    });
    assert.equal(outcome.ok, true);

    const result = await projectConfirmedReplyMemory(
      baseInput({
        source: "discovered",
        text: "Fresh search result",
        knowledgeRoot: root,
        upsertMemory: false,
      }),
    );
    assert.equal(result.state, "saved");
    assert.equal(result.memoryPath, first.path);
    const body = await readFile(first.path, "utf8");
    assert.match(body, /## Outcome/);
    assert.match(body, /views1h: 100/);
    assert.match(body, /Keep this summary/);
    assert.match(body, /Keep this agenda/);
    assert.match(body, /Curated post/);
    assert.doesNotMatch(body, /Fresh search result/);
  });

  it("schedules MiniLM by default after a successful write", async () => {
    const scheduled: string[] = [];
    resetInteractionMemoryProjectionForTests({
      writeNote: (input) =>
        writeInteractionMemory({ ...input, knowledgeRoot: root }),
      scheduleUpsert: (notePath) => {
        scheduled.push(notePath);
      },
    });
    const result = await projectConfirmedReplyMemory(baseInput());
    assert.equal(result.state, "saved");
    assert.deepEqual(scheduled, [result.memoryPath]);
  });

  it("waits for the scheduled upsert before returning", async () => {
    let release!: () => void;
    let started = false;
    const upsertFinished = new Promise<void>((resolve) => {
      release = resolve;
    });
    resetInteractionMemoryProjectionForTests({
      writeNote: (input) =>
        writeInteractionMemory({ ...input, knowledgeRoot: root }),
      scheduleUpsert: async () => {
        started = true;
        await upsertFinished;
      },
    });

    let returned = false;
    const resultPromise = projectConfirmedReplyMemory(baseInput()).then(
      (result) => {
        returned = true;
        return result;
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(started, true);
    assert.equal(returned, false);
    release();

    const result = await resultPromise;
    assert.equal(result.state, "saved");
  });

  it("indexes a saved note when a hash embedder is injected", async () => {
    const result = await projectConfirmedReplyMemory(
      baseInput({
        knowledgeRoot: root,
        indexDir: join(root, "index"),
        embedder: createHashEmbedder(16),
        awaitUpsert: true,
      }),
    );
    assert.equal(result.state, "saved");
    assert.ok(result.memoryPath);
  });
});
