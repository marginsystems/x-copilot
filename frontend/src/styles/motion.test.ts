import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "99-motion.css"), "utf8");

await describe("reduced motion", () => {
  it("disables cockpit dial transitions and circle skeleton animations", () => {
    assert.match(css, /\.dial-needle,\s*\.dial-fill\s*\{\s*transition:\s*none;/);
    assert.match(
      css,
      /\.desk-circle-map\.is-skeleton \.desk-circle-canvas,\s*\.desk-circle-skeleton-row::before\s*\{\s*animation:\s*none;/,
    );
  }).catch(assert.fail);

  it("disables cockpit collapse and toggle icon transitions", () => {
    assert.match(css, /\.desk-top-body,\s*\.desk-top-body-inner,\s*\.desk-top\.is-collapsed \.desk-top-body-inner,\s*\.desk-top-toggle-icon,/);
  }).catch(assert.fail);
});

await describe("cockpit collapse", () => {
  const desk = readFileSync(join(import.meta.dirname, "05-desk.css"), "utf8");

  it("animates the body height and opacity with the shared cubic-bezier token", () => {
    assert.match(readFileSync(join(import.meta.dirname, "00-tokens.css"), "utf8"), /--ease-out:\s*cubic-bezier\(/);
    assert.match(desk, /\.desk-top-body\s*\{[^}]*transition:\s*grid-template-rows 420ms var\(--ease-out\)/);
    assert.match(desk, /\.desk-top\.is-collapsed \.desk-top-body\s*\{\s*grid-template-rows:\s*0fr;/);
    assert.match(desk, /\.desk-top-body-inner\s*\{[^}]*opacity 280ms var\(--ease-out\)/);
  }).catch(assert.fail);

  it("never regroups the desk layout when the cockpit collapses", () => {
    assert.doesNotMatch(desk, /\.desk:has\(\.desk-top\.is-collapsed\)/);
    assert.doesNotMatch(desk, /display:\s*contents/);
  }).catch(assert.fail);
});
