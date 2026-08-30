import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHANGELOG } from "./changelog.ts";
import {
  LEARN_DESCRIPTION,
  LEARN_FOLLOW_DESCRIPTION,
  LEARN_FOLLOW_TITLE,
  LEARN_HUB_DESCRIPTION,
  LEARN_HUB_TITLE,
  LEARN_IMAGE,
  LEARN_REPLY_DESCRIPTION,
  LEARN_REPLY_TITLE,
  LEARN_TITLE,
  LEARN_VOLUME_DESCRIPTION,
  LEARN_VOLUME_TITLE,
  LEARN_GIVE_DESCRIPTION,
  LEARN_GIVE_IMAGE,
  LEARN_GIVE_TITLE,
} from "./learn.ts";
import {
  CHANGELOG_IMAGE,
  CHANGELOG_TITLE,
  changelogJsonLd,
  htmlWithSeo,
  learnFollowJsonLd,
  learnJsonLd,
  learnReplyJsonLd,
  learnGiveJsonLd,
  learnVolumeJsonLd,
  learnWeightsJsonLd,
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
    assert.equal(seoForView("learn").title, LEARN_HUB_TITLE);
    assert.equal(seoForView("learn").description, LEARN_HUB_DESCRIPTION);
    assert.match(seoForView("learn").description, /P\(action\)/);
    assert.match(seoForView("learn").description, /not affiliated/i);
    assert.equal(seoForView("learn").image, LEARN_IMAGE);
    assert.equal(seoForView("learnWeights").title, LEARN_TITLE);
    assert.equal(seoForView("learnWeights").description, LEARN_DESCRIPTION);
    assert.equal(seoForView("learnWeights").image, LEARN_IMAGE);
    assert.equal(seoForView("learnReply").title, LEARN_REPLY_TITLE);
    assert.equal(seoForView("learnReply").description, LEARN_REPLY_DESCRIPTION);
    assert.match(seoForView("learnReply").description, /P\(reply\)/);
    assert.equal(seoForView("learnReply").image, LEARN_IMAGE);
    assert.equal(seoForView("learnVolume").title, LEARN_VOLUME_TITLE);
    assert.equal(seoForView("learnVolume").description, LEARN_VOLUME_DESCRIPTION);
    assert.match(seoForView("learnVolume").description, /no daily/);
    assert.match(seoForView("learnVolume").description, /not affiliated/i);
    assert.equal(seoForView("learnVolume").image, LEARN_IMAGE);
    assert.equal(seoForView("learnGive").title, LEARN_GIVE_TITLE);
    assert.equal(seoForView("learnGive").description, LEARN_GIVE_DESCRIPTION);
    assert.match(seoForView("learnGive").description, /not subtracted/);
    assert.match(seoForView("learnGive").description, /not affiliated/i);
    assert.equal(seoForView("learnGive").image, LEARN_GIVE_IMAGE);
    assert.equal(seoForView("learnFollow").title, LEARN_FOLLOW_TITLE);
    assert.equal(seoForView("learnFollow").description, LEARN_FOLLOW_DESCRIPTION);
    assert.match(seoForView("learnFollow").description, /0\.75/);
    assert.match(seoForView("learnFollow").description, /not affiliated/i);
    assert.equal(seoForView("learnFollow").image, LEARN_IMAGE);
  });

  it("noindexes Privacy and Terms and keeps product pages indexable", () => {
    assert.equal(seoForView("privacy").robots, "noindex,follow");
    assert.equal(seoForView("terms").robots, "noindex,follow");
    assert.equal(seoForView("home").robots, "index,follow");
    assert.equal(seoForView("pricing").robots, "index,follow");
    assert.equal(seoForView("changelog").robots, "index,follow");
    assert.equal(seoForView("learn").robots, "index,follow");
    assert.equal(seoForView("learnWeights").robots, "index,follow");
    assert.equal(seoForView("learnReply").robots, "index,follow");
    assert.equal(seoForView("learnVolume").robots, "index,follow");
    assert.equal(seoForView("learnGive").robots, "index,follow");
    assert.equal(seoForView("learnFollow").robots, "index,follow");
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
  it("is a CollectionPage of the published lessons", () => {
    const graph = learnJsonLd()["@graph"];
    assert.ok(Array.isArray(graph));
    const page = graph.find((node) => node["@type"] === "CollectionPage");
    const list = graph.find((node) => node["@type"] === "ItemList");
    const crumbs = graph.find((node) => node["@type"] === "BreadcrumbList");
    assert.ok(page && list && crumbs);
    assert.equal(page.name, LEARN_HUB_TITLE);
    assert.equal(page.image, "https://xcopilot.dev/og-learn.png");
    assert.equal(list.numberOfItems, 4);
    assert.equal(
      list.itemListElement[0]?.url,
      "https://xcopilot.dev/learn/what-a-like-is-worth",
    );
    assert.equal(
      list.itemListElement[1]?.url,
      "https://xcopilot.dev/learn/posts-that-get-a-reply",
    );
    assert.equal(
      list.itemListElement[2]?.url,
      "https://xcopilot.dev/learn/how-many-replies",
    );
    assert.equal(
      list.itemListElement[3]?.url,
      "https://xcopilot.dev/learn/likes-and-follows-you-give",
    );
    assert.equal(crumbs.itemListElement[1]?.item, "https://xcopilot.dev/learn");
  });

  it("is an Article for the weights lesson with a learn breadcrumb", () => {
    const graph = learnWeightsJsonLd()["@graph"];
    assert.ok(Array.isArray(graph));
    const page = graph.find((node) => node["@type"] === "Article");
    const crumbs = graph.find((node) => node["@type"] === "BreadcrumbList");
    assert.ok(page && crumbs);
    assert.equal(page.name, LEARN_TITLE);
    assert.match(String(page.citation), /\/blob\/d011592\/home-mixer\/params\/param\.rs/);
    assert.equal(page.sameAs, "https://github.com/xai-org/x-algorithm/tree/d011592");
    assert.equal(page.image, "https://xcopilot.dev/og-learn.png");
    assert.equal(crumbs.itemListElement[1]?.item, "https://xcopilot.dev/learn");
    assert.equal(
      crumbs.itemListElement[2]?.item,
      "https://xcopilot.dev/learn/what-a-like-is-worth",
    );
  });

  it("is an Article for the reply lesson with a learn breadcrumb", () => {
    const graph = learnReplyJsonLd()["@graph"];
    assert.ok(Array.isArray(graph));
    const page = graph.find((node) => node["@type"] === "Article");
    const crumbs = graph.find((node) => node["@type"] === "BreadcrumbList");
    assert.ok(page && crumbs);
    assert.equal(page.name, LEARN_REPLY_TITLE);
    assert.match(String(page.citation), /\/blob\/d011592\/home-mixer\/params\/param\.rs#L315/);
    assert.equal(
      crumbs.itemListElement[2]?.item,
      "https://xcopilot.dev/learn/posts-that-get-a-reply",
    );
  });

  it("is an Article for the volume lesson with a learn breadcrumb", () => {
    const graph = learnVolumeJsonLd()["@graph"];
    assert.ok(Array.isArray(graph));
    const page = graph.find((node) => node["@type"] === "Article");
    const crumbs = graph.find((node) => node["@type"] === "BreadcrumbList");
    assert.ok(page && crumbs);
    assert.equal(page.name, LEARN_VOLUME_TITLE);
    assert.match(
      String(page.citation),
      /\/blob\/d011592\/home-mixer\/scorers\/ranking_scorer\.rs#L643-L645/,
    );
    assert.equal(
      crumbs.itemListElement[2]?.item,
      "https://xcopilot.dev/learn/how-many-replies",
    );
  });

  it("is an Article for the give lesson with a learn breadcrumb", () => {
    const graph = learnGiveJsonLd()["@graph"];
    assert.ok(Array.isArray(graph));
    const page = graph.find((node) => node["@type"] === "Article");
    const crumbs = graph.find((node) => node["@type"] === "BreadcrumbList");
    assert.ok(page && crumbs);
    assert.equal(page.name, LEARN_GIVE_TITLE);
    assert.match(
      String(page.citation),
      /\/blob\/d011592\/bdsm\/runtime\/heads\.py#L29-L39/,
    );
    assert.equal(page.image, "https://xcopilot.dev/og-learn-give.png");
    assert.equal(
      crumbs.itemListElement[2]?.item,
      "https://xcopilot.dev/learn/likes-and-follows-you-give",
    );
  });

  it("is an Article for /learn/follow with a learn breadcrumb", () => {
    const graph = learnFollowJsonLd()["@graph"];
    assert.ok(Array.isArray(graph));
    const page = graph.find((node) => node["@type"] === "Article");
    const crumbs = graph.find((node) => node["@type"] === "BreadcrumbList");
    assert.ok(page && crumbs);
    assert.equal(page.name, LEARN_FOLLOW_TITLE);
    assert.match(String(page.citation), /\/blob\/d011592\/home-mixer\/params\/param\.rs#L252-L257/);
    assert.equal(crumbs.itemListElement[1]?.item, "https://xcopilot.dev/learn");
    assert.equal(crumbs.itemListElement[2]?.item, "https://xcopilot.dev/learn/follow");
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
    assert.match(html, /<title>Learn the X algorithm — x-copilot<\/title>/);
    assert.match(html, /content="https:\/\/xcopilot\.dev\/learn"/);
    assert.match(html, /content="https:\/\/xcopilot\.dev\/og-learn\.png"/);
    assert.match(html, /P\(action\)/);
    assert.match(html, /CollectionPage/);
    assert.match(html, /d011592/);
    assert.doesNotMatch(html, /<title>x-copilot — the X copilot/);
  });

  it("rewrites the SPA shell for the weights lesson", () => {
    const source = readFileSync(join(root, "index.html"), "utf8");
    const html = htmlWithSeo(source, "learnWeights");
    assert.match(html, /<title>What a like is worth — x-copilot<\/title>/);
    assert.match(html, /content="https:\/\/xcopilot\.dev\/learn\/what-a-like-is-worth"/);
    assert.match(html, /content="https:\/\/xcopilot\.dev\/og-learn\.png"/);
    assert.match(html, /P\(action\)/);
    assert.match(html, /"@type":"Article"/);
    assert.match(html, /d011592/);
    assert.doesNotMatch(html, /<title>x-copilot — the X copilot/);
  });

  it("rewrites the SPA shell for the reply lesson", () => {
    const source = readFileSync(join(root, "index.html"), "utf8");
    const html = htmlWithSeo(source, "learnReply");
    assert.match(html, /<title>Posts that get a reply — x-copilot<\/title>/);
    assert.match(html, /content="https:\/\/xcopilot\.dev\/learn\/posts-that-get-a-reply"/);
    assert.match(html, /content="https:\/\/xcopilot\.dev\/og-learn\.png"/);
    assert.match(html, /P\(reply\)/);
    assert.match(html, /"@type":"Article"/);
    assert.doesNotMatch(html, /<title>x-copilot — the X copilot/);
  });

  it("rewrites the SPA shell for the volume lesson", () => {
    const source = readFileSync(join(root, "index.html"), "utf8");
    const html = htmlWithSeo(source, "learnVolume");
    assert.match(html, /<title>How many replies a day — x-copilot<\/title>/);
    assert.match(html, /content="https:\/\/xcopilot\.dev\/learn\/how-many-replies"/);
    assert.match(html, /content="https:\/\/xcopilot\.dev\/og-learn\.png"/);
    assert.match(html, /no daily/);
    assert.match(html, /"@type":"Article"/);
    assert.doesNotMatch(html, /<title>x-copilot — the X copilot/);
  });

  it("rewrites the SPA shell for the give lesson", () => {
    const source = readFileSync(join(root, "index.html"), "utf8");
    const html = htmlWithSeo(source, "learnGive");
    assert.match(html, /<title>Likes and follows you give — x-copilot<\/title>/);
    assert.match(html, /content="https:\/\/xcopilot\.dev\/learn\/likes-and-follows-you-give"/);
    assert.match(html, /content="https:\/\/xcopilot\.dev\/og-learn-give\.png"/);
    assert.match(html, /not subtracted/);
    assert.match(html, /"@type":"Article"/);
    assert.doesNotMatch(html, /<title>x-copilot — the X copilot/);
  });

  it("rewrites the SPA shell for /learn/follow without touching the home copy", () => {
    const source = readFileSync(join(root, "index.html"), "utf8");
    const html = htmlWithSeo(source, "learnFollow");
    assert.match(html, /<title>Follow and out-of-network — x-copilot<\/title>/);
    assert.match(html, /content="https:\/\/xcopilot\.dev\/learn\/follow"/);
    assert.match(html, /0\.75/);
    assert.match(html, /"@type":"Article"/);
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
    assert.match(xml, /https:\/\/xcopilot\.dev\/learn\/what-a-like-is-worth</);
    assert.match(xml, /https:\/\/xcopilot\.dev\/learn\/posts-that-get-a-reply</);
    assert.match(xml, /https:\/\/xcopilot\.dev\/learn\/how-many-replies</);
    assert.match(xml, /https:\/\/xcopilot\.dev\/learn\/likes-and-follows-you-give</);
    assert.match(xml, /https:\/\/xcopilot\.dev\/learn\/follow</);
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

  it("keeps the learn featured image at the OG size", () => {
    const size = pngSize(join(publicDir, "og-learn.png"));
    assert.deepEqual(size, { width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT });
  });

  it("keeps the give lesson featured image at the OG size", () => {
    const size = pngSize(join(publicDir, "og-learn-give.png"));
    assert.deepEqual(size, { width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT });
  });
});
