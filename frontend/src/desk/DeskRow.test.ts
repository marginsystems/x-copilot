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

  await it("clips a departing action on one line instead of stacking its label", () => {
    const css = readFileSync(
      new URL("../styles/10-scout.css", import.meta.url),
      "utf8",
    );
    const motion = readFileSync(
      new URL("../styles/99-motion.css", import.meta.url),
      "utf8",
    );

    assert.match(css, /\.row-action\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    assert.match(css, /\.row-action\s*\{[^}]*white-space:\s*nowrap/);
    assert.match(
      css,
      /\.row-action\.is-collapsed\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*0fr\)/,
    );
    assert.doesNotMatch(
      css,
      /\.row-action(?:\.is-collapsed)?\s*\{[^}]*grid-template-columns:\s*[01]fr/,
    );
    assert.match(css, /\.row-action-clip\s*\{[^}]*overflow:\s*hidden/);
    assert.match(css, /\.row-action \.has-tip::after\s*\{[^}]*white-space:\s*normal/);
    assert.match(motion, /\.row-action\s*\{\s*transition:\s*none/);
  });

  await it("keeps the Approach head on one line when detection lands", () => {
    const css = readFileSync(
      new URL("../styles/12-threads.css", import.meta.url),
      "utf8",
    );
    const status = /\.for-you-status,\s*\.for-you-detected-summary\s*\{[^}]*\}/.exec(css)?.[0];

    assert.ok(status);
    assert.match(status, /white-space:\s*nowrap/);
    assert.doesNotMatch(status, /flex-wrap:\s*wrap/);
    assert.match(css, /\.for-you-detected-id\s*\{[^}]*text-overflow:\s*ellipsis/);
    assert.match(css, /\.approach-frame \.row-meta\s*\{[^}]*grid-auto-flow:\s*column/);
    assert.match(css, /\.approach-frame \.row-meta\s*\{[^}]*white-space:\s*nowrap/);
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
