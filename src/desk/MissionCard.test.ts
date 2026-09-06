import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickApproachScout } from "./approachScout";
import type { ThreadCard } from "./types";

function thread(id: string, views: number): ThreadCard {
  return {
    id,
    author: `@${id}`,
    text: id,
    url: `https://x.com/${id}/status/${id}`,
    views,
  };
}

describe("pickApproachScout", () => {
  it("locks the first tank row even when a later row has more views", () => {
    const quieter = thread("quiet-root", 10);
    const louder = thread("loud-leaf", 9000);
    assert.equal(pickApproachScout([quieter, louder]), quieter);
  });

  it("returns null when the tank is empty", () => {
    assert.equal(pickApproachScout([]), null);
  });
});
