import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appendThreadsById,
  baitClass,
} from "./threadHelpers.ts";
import type { ThreadCard } from "./types.ts";

function card(id: string, extra: Partial<ThreadCard> = {}): ThreadCard {
  return {
    id,
    author: "@a",
    text: `t${id}`,
    url: `https://x.com/a/status/${id}`,
    ...extra,
  };
}

describe("appendThreadsById", () => {
  it("appends unseen ids and keeps first occurrence", () => {
    const prev = [card("1"), card("2")];
    const out = appendThreadsById(prev, [card("2", { text: "dup" }), card("3")]);
    assert.deepEqual(
      out.map((t) => t.id),
      ["1", "2", "3"],
    );
    assert.equal(out[1].text, "t2");
  });

  it("returns prev when next is empty", () => {
    const prev = [card("1")];
    assert.equal(appendThreadsById(prev, []), prev);
    assert.equal(appendThreadsById(prev, undefined), prev);
  });
});

describe("baitClass", () => {
  it("bins bait scores", () => {
    assert.equal(baitClass(null), "bait");
    assert.equal(baitClass(65), "bait high");
    assert.equal(baitClass(35), "bait mid");
    assert.equal(baitClass(34), "bait low");
  });
});
