import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeskRow } from "./DeskRow";

await describe("DeskRow card chrome", async () => {
  await it("owns one left-aligned button row on the collapsed article", () => {
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

  await it("keeps the card inside the pane without a horizontal scrollbar", () => {
    const threads = readFileSync(
      new URL("../styles/12-threads.css", import.meta.url),
      "utf8",
    );
    const desk = readFileSync(
      new URL("../styles/05-desk.css", import.meta.url),
      "utf8",
    );
    const responsive = readFileSync(
      new URL("../styles/90-responsive.css", import.meta.url),
      "utf8",
    );
    const tips = readFileSync(
      new URL("../styles/18-tooltip.css", import.meta.url),
      "utf8",
    );

    assert.match(threads, /\.thread-row\s*\{[^}]*min-width:\s*0/);
    assert.match(threads, /\.row-head\s*\{[^}]*min-width:\s*0/);
    assert.match(desk, /\.threads-scroll\s*\{[^}]*min-width:\s*0/);
    assert.match(desk, /\.threads-scroll\s*\{[^}]*overflow-x:\s*clip/);
    assert.doesNotMatch(desk, /\.threads-scroll\s*\{[^}]*overflow-x:\s*auto/);
    assert.match(responsive, /\.threads-scroll\s*\{[^}]*overflow-x:\s*clip/);
    assert.match(tips, /\.has-tip::after\s*\{[^}]*left:\s*0/);
    assert.match(tips, /\.has-tip::after\s*\{[^}]*color:\s*var\(--text\)/);
    assert.match(tips, /\.has-tip::after\s*\{[^}]*background:\s*var\(--panel\)/);
    assert.doesNotMatch(tips, /\.has-tip::after\s*\{[^}]*color:\s*var\(--muted\)/);
  });

  await it("does not fade the hover tip with the disabled Next face", () => {
    const buttons = readFileSync(
      new URL("../styles/11-buttons.css", import.meta.url),
      "utf8",
    );

    assert.match(buttons, /button:disabled:not\(\.has-tip\)\s*\{[^}]*opacity:\s*0\.4/);
    assert.match(buttons, /button\.has-tip:disabled\s*\{[^}]*opacity:\s*1/);
  });

  await it("uses full-card collapsed hover without head hover overrides", () => {
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

  await it("anchors the pace help panel under the question chip", () => {
    const css = readFileSync(
      new URL("../styles/12-threads.css", import.meta.url),
      "utf8",
    );

    assert.match(
      css,
      /\.reply-pace-help\s*\{[^}]*align-self:\s*flex-start/,
    );
    assert.match(css, /\.reply-pace-help-panel\s*\{[^}]*left:\s*0/);
    assert.doesNotMatch(css, /\.reply-pace-help-panel\s*\{[^}]*right:\s*0/);
  });

  await it("keeps non-expandable details visible", () => {
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
