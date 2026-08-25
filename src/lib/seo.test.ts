import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGELOG } from "./changelog.ts";
import { LEARN_DESCRIPTION, LEARN_TITLE } from "./learn.ts";
import {
  CHANGELOG_IMAGE,
  CHANGELOG_TITLE,
  changelogJsonLd,
  htmlWithSeo,
  learnJsonLd,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  seoForView,
  SITE_TITLE,
} from "./seo.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = join(root, "public");

function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("seoForView", () => {
  it("keeps the homepage on the index.html tagline", () => {
    const home = seoForView("home");
    assert.equal(
      home.title,
      "x-copilot — the X copilot for growing your account",
    );
    assert.doesNotMatch(home.title, /independent research desk/);
    assert.equal(home.image, "/og.png");
  });

  it("gives privacy, terms, pricing, changelog, and learn their own titles", () => {
    assert.equal(seoForView("privacy").title, "Privacy Policy — x-copilot");
    assert.equal(seoForView("terms").title, "Terms of Service — x-copilot");
    assert.equal(seoForView("pricing").title, "Pricing — x-copilot");
    assert.match(seoForView("pricing").description, /\$12/);
    assert.equal(seoForView("changelog").title, CHANGELOG_TITLE);
    assert.match(seoForView("changelog").title, /what shipped/i);
    assert.match(seoForView("changelog").description, /launch notes/i);
    assert.match(seoForView("changelog").description, /flight-path/i);
    assert.equal(seoForView("changelog").image, CHANGELOG_IMAGE);
    assert.equal(seoForView("learn").title, LEARN_TITLE);
    assert.match(seoForView("learn").description, /P\(action\)/);
    assert.equal(seoForView("learn").description, LEARN_DESCRIPTION);
    assert.match(seoForView("learn").description, /not affiliated/i);
    assert.equal(seoForView("learn").image, "/og.png");
  });

  it("noindexes Privacy and Terms and keeps product pages indexable", () => {
    assert.equal(seoForView("privacy").robots, "noindex,follow");
    assert.equal(seoForView("terms").robots, "noindex,follow");
    assert.equal(seoForView("home").robots, "index,follow");
    assert.equal(seoForView("pricing").robots, "index,follow");
    assert.equal(seoForView("changelog").robots, "index,follow");
    assert.equal(seoForView("learn").robots, "index,follow");
    assert.equal(seoForView("dashboard").robots, "index,follow");
  });

  it("does not give desk panes a second tagline", () => {
    assert.equal(seoForView("dashboard").title, SITE_TITLE);
    assert.equal(seoForView("usage").title, SITE_TITLE);
  });
});

describe("changelog schema", () => {
  it("is a CollectionPage with breadcrumbs and newest-first ships", () => {
    const graph = changelogJsonLd()["@graph"];
    assert.ok(Array.isArray(graph));
    const page = graph.find((node) => node["@type"] === "CollectionPage");
    const list = graph.find((node) => node["@type"] === "ItemList");
    const crumbs = graph.find((node) => node["@type"] === "BreadcrumbList");
    assert.ok(page && list && crumbs);
    assert.equal(page.name, CHANGELOG_TITLE);
    assert.equal(page.image, "https://xcopilot.dev/og-changelog.png");
    assert.equal(page.dateModified, CHANGELOG[0]?.date);
    assert.equal(list.numberOfItems, CHANGELOG.length);
    assert.equal(list.itemListOrder, "https://schema.org/ItemListOrderDescending");
    assert.equal(list.itemListElement[0]?.item?.name, CHANGELOG[0]?.title);
    assert.equal(crumbs.itemListElement[1]?.item, "https://xcopilot.dev/changelog");
  });
});

describe("learn schema", () => {
  it("is an Article with breadcrumbs and the cited SHA", () => {
    const graph = learnJsonLd()["@graph"];
    assert.ok(Array.isArray(graph));
    const page = graph.find((node) => node["@type"] === "Article");
    const crumbs = graph.find((node) => node["@type"] === "BreadcrumbList");
    assert.ok(page && crumbs);
    assert.equal(page.name, LEARN_TITLE);
    assert.match(String(page.citation), /\/blob\/d011592\/home-mixer\/params\/param\.rs/);
    assert.equal(page.sameAs, "https://github.com/xai-org/x-algorithm/tree/d011592");
    assert.equal(crumbs.itemListElement[1]?.item, "https://xcopilot.dev/learn");
  });
});

describe("htmlWithSeo", () => {
  it("rewrites the SPA shell for /changelog without touching the home copy", () => {
    const source = readFileSync(join(root, "index.html"), "utf8");
    const html = htmlWithSeo(source, "changelog");
    assert.match(html, /<title>Changelog — what shipped on x-copilot<\/title>/);
    assert.match(html, /content="https:\/\/xcopilot\.dev\/changelog"/);
    assert.match(html, /content="https:\/\/xcopilot\.dev\/og-changelog\.png"/);
    assert.match(html, /CollectionPage/);
    assert.match(html, /Share your flight path/);
    assert.match(html, /BreadcrumbList/);
    assert.doesNotMatch(html, /<title>x-copilot — the X copilot/);
    assert.match(source, /<title>x-copilot — the X copilot/);
  });

  it("rewrites the SPA shell for /learn without touching the home copy", () => {
    const source = readFileSync(join(root, "index.html"), "utf8");
    const html = htmlWithSeo(source, "learn");
    assert.match(html, /<title>What a like is worth — x-copilot<\/title>/);
    assert.match(html, /content="https:\/\/xcopilot\.dev\/learn"/);
    assert.match(html, /P\(action\)/);
    assert.match(html, /"@type":"Article"/);
    assert.match(html, /d011592/);
    assert.doesNotMatch(html, /<title>x-copilot — the X copilot/);
  });
});

describe("public crawl files", () => {
  it("keeps Privacy and Terms out of the sitemap", () => {
    const xml = readFileSync(join(publicDir, "sitemap.xml"), "utf8");
    assert.match(xml, /https:\/\/xcopilot\.dev\/</);
    assert.match(xml, /https:\/\/xcopilot\.dev\/pricing</);
    assert.match(xml, /https:\/\/xcopilot\.dev\/changelog</);
    assert.match(xml, /https:\/\/xcopilot\.dev\/learn</);
    assert.match(
      xml,
      new RegExp(
        `<loc>https://xcopilot\\.dev/changelog</loc>\\s*<lastmod>${CHANGELOG[0]!.date}</lastmod>`,
      ),
    );
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

  it("keeps the changelog featured image at the OG size", () => {
    const size = pngSize(join(publicDir, "og-changelog.png"));
    assert.deepEqual(size, { width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT });
  });
});
