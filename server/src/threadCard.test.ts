import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dedupeThreads, type ThreadCard } from "./threadCard.ts";

describe("dedupeThreads", () => {
  it("keeps first occurrence by id", () => {
    const input: ThreadCard[] = [
      {
        id: "1",
        author: "@a",
        text: "one",
        url: "https://x.com/a/status/1",
      },
      {
        id: "1",
        author: "@a",
        text: "dup",
        url: "https://x.com/a/status/1",
      },
      {
        id: "2",
        author: "@b",
        text: "two",
        url: "https://x.com/b/status/2",
      },
    ];
    const out = dedupeThreads(input);
    assert.equal(out.length, 2);
    assert.equal(out[0].text, "one");
    assert.equal(out[1].id, "2");
  });
});
