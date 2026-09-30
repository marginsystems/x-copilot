import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(import.meta.dirname, "22-cockpit.css"), "utf8");

function blocks(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(?:^|[\\s{}])${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(
    (match) => match[1] ?? "",
  );
}

function rowTracks(block: string): string[] {
  return [...block.matchAll(/grid-template-rows:\s*([^;]+);/g)].map((match) => match[1] ?? "");
}

await describe("cockpit geometry", () => {
  it("declares fixed row heights for every layout so data can never move the Threads list", () => {
    const declared = blocks(".cockpit").flatMap(rowTracks);
    assert.ok(declared.length >= 3, "base, tablet and phone layouts each declare rows");
    for (const tracks of declared) {
      assert.doesNotMatch(tracks, /\b(auto|min-content|max-content|fit-content)\b|\dfr\b/);
      assert.match(tracks, /(var\(--cockpit-[a-z-]+\)|\d+px)/);
    }
  }).catch(assert.fail);

  it("keeps every fixed row height a px length or a cockpit variable defined in px", () => {
    const vars = [...css.matchAll(/--cockpit-(?:gauges-h|row-h):\s*([^;]+);/g)].map((m) => m[1]);
    assert.ok(vars.length >= 3);
    for (const value of vars) assert.match(value ?? "", /^\d+px$/);
  }).catch(assert.fail);

  it("has no tab chrome left in the desk top", () => {
    assert.doesNotMatch(css, /desk-top-tabs/);
  }).catch(assert.fail);
});
