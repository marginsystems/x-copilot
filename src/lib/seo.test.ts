import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { seoForView, SITE_TITLE } from "./seo.ts";

describe("seoForView", () => {
  it("keeps the homepage on the index.html tagline", () => {
    const home = seoForView("home");
    assert.equal(home.title, SITE_TITLE);
    assert.match(home.title, /X copilot for growing your account/);
    assert.doesNotMatch(home.title, /independent research desk/);
  });

  it("gives privacy, terms, and pricing their own titles", () => {
    assert.equal(seoForView("privacy").title, "Privacy Policy — x-copilot");
    assert.equal(seoForView("terms").title, "Terms of Service — x-copilot");
    assert.equal(seoForView("pricing").title, "Pricing — x-copilot");
    assert.match(seoForView("pricing").description, /\$12/);
  });

  it("does not give desk panes a second tagline", () => {
    assert.equal(seoForView("dashboard").title, SITE_TITLE);
    assert.equal(seoForView("usage").title, SITE_TITLE);
  });
});
