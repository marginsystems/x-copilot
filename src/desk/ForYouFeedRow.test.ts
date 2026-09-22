import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ForYouFeedRow } from "./ForYouFeedRow";
import {
  FYP_ACTION_COPY,
  FYP_DETECTING_COPY,
  X_FOR_YOU_URL,
  X_INSPIRATION_URL,
} from "../lib/forYou";

await describe("ForYouFeedRow outbound doors", async () => {
  await it("offers For You and Inspiration while waiting", () => {
    const html = renderToStaticMarkup(
      createElement(ForYouFeedRow, {
        status: FYP_DETECTING_COPY,
        detected: false,
        onNext() {},
      }),
    );

    assert.match(
      html,
      new RegExp(`href="${X_FOR_YOU_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>Open For You<`),
    );
    assert.match(
      html,
      new RegExp(
        `href="${X_INSPIRATION_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>Open Inspiration<`,
      ),
    );
    assert.match(html, new RegExp(FYP_ACTION_COPY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, />Next</);
  });

  await it("hides both outbound doors after a post is detected", () => {
    const html = renderToStaticMarkup(
      createElement(ForYouFeedRow, {
        detected: true,
        activity: {
          id: "1",
          kind: "original",
          text: "Posted.",
          url: "https://x.com/desk/status/1",
          postedAt: "2026-09-21T00:00:00.000Z",
        },
        onNext() {},
      }),
    );

    assert.match(html, /chip-interacted/);
    assert.match(html, />interacted</);
    assert.doesNotMatch(html, />Open For You</);
    assert.doesNotMatch(html, />Open Inspiration</);
    assert.doesNotMatch(html, new RegExp(X_INSPIRATION_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, />Next</);
  });
});
