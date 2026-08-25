import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seoForView, SITE_TITLE } from "./seo.ts";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../../public");

describe("seoForView", () => {
  it("keeps the homepage on the index.html tagline", () => {
    const home = seoForView("home");
    assert.equal(
      home.title,
      "x-copilot — the X copilot for growing your account",
    );
    assert.doesNotMatch(home.title, /independent research desk/);
  });

  it("gives privacy, terms, pricing, and changelog their own titles", () => {
    assert.equal(seoForView("privacy").title, "Privacy Policy — x-copilot");
    assert.equal(seoForView("terms").title, "Terms of Service — x-copilot");
    assert.equal(seoForView("pricing").title, "Pricing — x-copilot");
    assert.match(seoForView("pricing").description, /\$12/);
    assert.equal(seoForView("changelog").title, "Changelog — x-copilot");
    assert.match(seoForView("changelog").description, /launch notes/i);
  });

  it("noindexes Privacy and Terms and keeps product pages indexable", () => {
    assert.equal(seoForView("privacy").robots, "noindex,follow");
    assert.equal(seoForView("terms").robots, "noindex,follow");
    assert.equal(seoForView("home").robots, "index,follow");
    assert.equal(seoForView("pricing").robots, "index,follow");
    assert.equal(seoForView("changelog").robots, "index,follow");
    assert.equal(seoForView("dashboard").robots, "index,follow");
  });

  it("does not give desk panes a second tagline", () => {
    assert.equal(seoForView("dashboard").title, SITE_TITLE);
    assert.equal(seoForView("usage").title, SITE_TITLE);
  });
});

describe("public crawl files", () => {
  it("keeps Privacy and Terms out of the sitemap", () => {
    const xml = readFileSync(join(publicDir, "sitemap.xml"), "utf8");
    assert.match(xml, /https:\/\/xcopilot\.dev\/</);
    assert.match(xml, /https:\/\/xcopilot\.dev\/pricing</);
    assert.match(xml, /https:\/\/xcopilot\.dev\/changelog</);
    assert.doesNotMatch(xml, /\/privacy/);
    assert.doesNotMatch(xml, /\/terms/);
  });

  it("sends X-Robots-Tag on Privacy and Terms without Disallowing them", () => {
    const headers = readFileSync(join(publicDir, "_headers"), "utf8");
    const robots = readFileSync(join(publicDir, "robots.txt"), "utf8");
    assert.match(headers, /\/privacy\n\s+X-Robots-Tag: noindex, follow/);
    assert.match(headers, /\/terms\n\s+X-Robots-Tag: noindex, follow/);
    assert.doesNotMatch(robots, /Disallow: \/privacy/);
    assert.doesNotMatch(robots, /Disallow: \/terms/);
  });
});
