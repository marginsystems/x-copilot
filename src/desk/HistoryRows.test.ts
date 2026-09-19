import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InteractedRow } from "./HistoryRows";
import type { InteractionHistoryEntry } from "./types";

function entry(
  memory?: InteractionHistoryEntry["memory"],
): InteractionHistoryEntry {
  return {
    threadId: "t1",
    author: "@ada",
    at: "2026-09-19T12:00:00.000Z",
    ...(memory ? { memory } : {}),
  };
}

describe("InteractedRow remembered line", () => {
  it("shows one accessible Remembered line only for a saved receipt", () => {
    const saved = renderToStaticMarkup(
      createElement(InteractedRow, { entry: entry({ state: "saved" }) }),
    );
    assert.match(saved, /role="status"/);
    assert.match(saved, />Remembered</);
    assert.match(saved, /chip-interacted/);
  });

  it("stays quiet when the receipt is missing or not saved", () => {
    for (const memory of [
      undefined,
      { state: "unavailable" as const },
      { state: "no_reply_text" as const },
    ]) {
      const html = renderToStaticMarkup(
        createElement(InteractedRow, { entry: entry(memory) }),
      );
      assert.doesNotMatch(html, /Remembered/);
      assert.doesNotMatch(html, /role="status"/);
      assert.match(html, /chip-interacted/);
    }
  });
});
