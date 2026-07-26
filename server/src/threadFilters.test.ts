import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAX_THREAD_CHARS,
  filterThreadsByLength,
  isOversizedThread,
  isThreadOpener,
  resolveMaxThreadChars,
} from "./threadFilters.ts";
import type { ThreadCard } from "./xSearch.ts";

function thread(id: string, text: string): ThreadCard {
  return {
    id,
    author: "@a",
    text,
    url: `https://x.com/a/status/${id}`,
  };
}

describe("resolveMaxThreadChars", () => {
  it("defaults when empty or invalid", () => {
    assert.equal(resolveMaxThreadChars(), DEFAULT_MAX_THREAD_CHARS);
    assert.equal(resolveMaxThreadChars(""), DEFAULT_MAX_THREAD_CHARS);
    assert.equal(resolveMaxThreadChars("abc"), DEFAULT_MAX_THREAD_CHARS);
    assert.equal(resolveMaxThreadChars("0"), DEFAULT_MAX_THREAD_CHARS);
    assert.equal(resolveMaxThreadChars("-10"), DEFAULT_MAX_THREAD_CHARS);
    assert.equal(resolveMaxThreadChars("12.5"), DEFAULT_MAX_THREAD_CHARS);
  });

  it("accepts a positive integer override", () => {
    assert.equal(resolveMaxThreadChars("320"), 320);
    assert.equal(resolveMaxThreadChars(" 900 "), 900);
  });
});

describe("isOversizedThread", () => {
  it("keeps exact max and drops max+1", () => {
    const max = 480;
    assert.equal(isOversizedThread("a".repeat(max), max), false);
    assert.equal(isOversizedThread("a".repeat(max + 1), max), true);
  });
});

describe("isThreadOpener", () => {
  it("matches N/M openers", () => {
    assert.equal(isThreadOpener("1/12 Starting a thread about AI"), true);
    assert.equal(isThreadOpener("  3 / 7  More thoughts"), true);
    assert.equal(isThreadOpener("Here's a short take on AI tools"), false);
  });
});

describe("filterThreadsByLength", () => {
  it("keeps 480-char posts and drops 481", () => {
    const ok = thread("1", "x".repeat(480));
    const long = thread("2", "y".repeat(481));
    const result = filterThreadsByLength([ok, long], 480);
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["1"],
    );
    assert.equal(result.filteredCount, 1);
    assert.equal(result.openerFilteredCount, 0);
  });

  it("drops thread openers even under the char cap", () => {
    const opener = thread("1", "1/12 Starting a thread about shipping");
    const short = thread("2", "Concrete take: ship weekly.");
    const result = filterThreadsByLength([opener, short], 480);
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["2"],
    );
    assert.equal(result.filteredCount, 1);
    assert.equal(result.openerFilteredCount, 1);
  });
});
