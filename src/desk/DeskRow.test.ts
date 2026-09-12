import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeskRow } from "./DeskRow";

describe("DeskRow card chrome", () => {
  it("owns one left-aligned button row on the collapsed article", () => {
    const html = renderToStaticMarkup(
      createElement(DeskRow, {
        lead: "FY",
        summary: "Waiting",
        expandable: true,
        openHref: "https://x.com/home",
        openLabel: "Open For You",
        onNext() {},
        onSkip() {},
        onDismiss() {},
      }),
    );

    assert.match(html, /^<article class="thread-row">/);
    assert.equal(html.match(/class="row"/g)?.length, 1);
    assert.match(html, />Open For You</);
    assert.match(html, />Next</);
    assert.match(html, />Skip</);
    assert.match(html, />Not interested</);
    assert.doesNotMatch(html, /approach-card-actions|justify-content/);
  });

  it("uses full-card collapsed hover without head hover overrides", () => {
    const css = readFileSync(
      new URL("../styles/12-threads.css", import.meta.url),
      "utf8",
    );

    assert.match(
      css,
      /\.thread-row:not\(\.open\):hover\s*,\s*\.thread-row\.open:not\(:has\(> \.row-head:is\(button\)\)\):hover\s*\{\s*background: var\(--raised\)/,
    );
    assert.doesNotMatch(css, /\.row-head:hover|\.next-action-head:hover/);
    assert.doesNotMatch(css, /\.approach-card-actions|justify-content:\s*flex-end/);
  });

  it("lets the pace help details span the row for right anchoring", () => {
    const css = readFileSync(
      new URL("../styles/12-threads.css", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(
      css,
      /\.reply-pace-help\s*\{[^}]*align-self:\s*flex-start/,
    );
    assert.match(css, /\.reply-pace-help-panel\s*\{[^}]*right:\s*0/);
  });

  it("keeps non-expandable details visible", () => {
    const html = renderToStaticMarkup(
      createElement(
        DeskRow,
        { lead: "PACE", summary: "Waiting" },
        createElement("span", null, "Help"),
      ),
    );

    assert.match(html, /^<article class="thread-row open">/);
    assert.match(html, /class="row-detail-inner"/);
    assert.match(html, />Help</);
  });
});
