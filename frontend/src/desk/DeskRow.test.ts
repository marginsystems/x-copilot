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

  await it("renders each action group as one keyed unit", () => {
    const scout = renderToStaticMarkup(
      createElement(DeskRow, {
        lead: "7",
        summary: "Thread",
        openHref: "https://x.com/a/status/1",
        openLabel: "Open on X",
        onNext() {},
        onSkip() {},
        onDismiss() {},
      }),
    );
    const wait = renderToStaticMarkup(
      createElement(DeskRow, {
        lead: "FY",
        summary: "Waiting",
        openHref: "https://x.com/home",
        openLabel: "Open For You",
        secondaryOpenHref: "https://x.com/i/inspiration",
        secondaryOpenLabel: "Open Inspiration",
        onNext() {},
      }),
    );

    assert.match(
      scout,
      /<span class="row-action" data-action="skip"><button[^>]*>Skip<\/button><button[^>]*>Not interested<\/button><\/span>/,
    );
    assert.match(
      wait,
      /<span class="row-action" data-action="open">(?:(?!row-action).)*>Open For You<(?:(?!row-action).)*>Open Inspiration</,
    );
    assert.equal(wait.match(/class="row-action"/g)?.length, 2);
    assert.doesNotMatch(scout + wait, /is-leaving|row-action-track/);
  });

  await it("never animates a button's box while an action leaves", () => {
    const css = readFileSync(
      new URL("../styles/10-scout.css", import.meta.url),
      "utf8",
    );
    const tokens = readFileSync(
      new URL("../styles/00-tokens.css", import.meta.url),
      "utf8",
    );
    const rules = [
      ...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
    ]
      .map(([, selector, body]) => ({ selector: selector.trim(), body }))
      .filter((rule) => /\.row-action(?![\w-])/.test(rule.selector) && !rule.selector.startsWith(".thread-row:has"));

    assert.ok(rules.length > 0);
    for (const rule of rules) {
      assert.doesNotMatch(rule.body, /grid-template-columns|transition|animation|overflow/, rule.selector);
    }

    assert.match(css, /\.thread-row > \.row\s*\{[^}]*position:\s*relative/);
    assert.match(css, /\.row-action\s*\{[^}]*white-space:\s*nowrap/);
    assert.match(css, /\.row-action\s*\{[^}]*flex:\s*none/);
    assert.match(css, /\.row-action\.is-leaving\s*\{[^}]*position:\s*absolute/);
    assert.match(css, /\.row-action\.is-leaving\s*\{[^}]*pointer-events:\s*none/);
    assert.match(css, /\.thread-row > \.row\.is-draining\s*\{[^}]*overflow:\s*hidden/);
    assert.doesNotMatch(css, /row-action-track|translateX\(-?100%\)/);
    assert.match(css, /\.row-action \.has-tip::after\s*\{[^}]*white-space:\s*normal/);
    assert.match(tokens, /--row-action-exit:\s*280ms/);
  });

  await it("fades the interacted chip in only while a unit is leaving the same row", () => {
    const css = readFileSync(
      new URL("../styles/10-scout.css", import.meta.url),
      "utf8",
    );
    const threads = readFileSync(
      new URL("../styles/12-threads.css", import.meta.url),
      "utf8",
    );
    const motion = readFileSync(
      new URL("../styles/99-motion.css", import.meta.url),
      "utf8",
    );
    const leavingGate = ".thread-row:has(> .row > .row-action.is-leaving)";
    const arrivals = [
      ...(css + threads).replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
    ]
      .map(([, selector, body]) => ({ selector: selector.trim(), body }))
      .filter(
        (rule) =>
          /chip-interacted|for-you-detected-summary/.test(rule.selector) &&
          /animation/.test(rule.body),
      );

    assert.equal(arrivals.length, 1);
    for (const part of arrivals[0].selector.split(",")) {
      assert.ok(part.trim().startsWith(leavingGate), part);
    }
    assert.match(
      arrivals[0].body,
      /animation:\s*row-action-arrive var\(--row-action-exit\) var\(--ease-out\) both/,
    );
    assert.match(css, /@keyframes row-action-arrive\s*\{\s*from\s*\{\s*opacity:\s*0;?\s*\}\s*\}/);
    assert.match(
      motion,
      /\.thread-row:has\(> \.row > \.row-action\.is-leaving\) \.row-meta \.chip-interacted,\s*\.thread-row:has\(> \.row > \.row-action\.is-leaving\) \.for-you-detected-summary,[^{]*\{\s*animation:\s*none/,
    );
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
