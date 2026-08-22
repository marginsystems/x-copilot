import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appendThreadsById,
  baitClass,
  coolProgressLabel,
  parseStatusIdFromUrl,
  scoutProgressPrefix,
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

describe("parseStatusIdFromUrl", () => {
  it("parses x.com and twitter.com status URLs", () => {
    assert.equal(
      parseStatusIdFromUrl("https://x.com/me/status/1234567890"),
      "1234567890",
    );
    assert.equal(
      parseStatusIdFromUrl("https://twitter.com/me/status/99?s=20"),
      "99",
    );
    assert.equal(
      parseStatusIdFromUrl("x.com/foo/statuses/42"),
      "42",
    );
  });

  it("rejects non-status URLs", () => {
    assert.equal(parseStatusIdFromUrl("https://x.com/home"), null);
    assert.equal(parseStatusIdFromUrl("not a url"), null);
    assert.equal(parseStatusIdFromUrl(""), null);
  });
});

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

describe("coolProgressLabel", () => {
  it("uses explicit counts or the fallback target", () => {
    assert.equal(coolProgressLabel(2, 5, 8), "Cool 2/5");
    assert.equal(coolProgressLabel(undefined, undefined, 8), "Cool 0/8");
  });
});

describe("scoutProgressPrefix", () => {
  it("shows candidate fill before the first cool", () => {
    assert.equal(
      scoutProgressPrefix({ candidates: 4, bucketSize: 20, coolCount: 0 }),
      "Cand. 4/20",
    );
  });

  it("shows cool progress once cools exist", () => {
    assert.equal(
      scoutProgressPrefix({ coolCount: 3, targetCool: 8 }),
      "Cool 3/8",
    );
    assert.equal(scoutProgressPrefix({ coolCount: 3 }), "Cool 3");
  });

  it("returns null when there is nothing to show", () => {
    assert.equal(scoutProgressPrefix({}), null);
  });
});
