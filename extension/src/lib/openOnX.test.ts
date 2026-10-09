import { describe, expect, it } from "vitest";
import { isXUrl, onXPage, planOpenOnX } from "./openOnX";

describe("planOpenOnX", () => {
  it("reuses the active x.com tab without switching", () => {
    expect(planOpenOnX([{ id: 1, url: "https://x.com/home", active: true }, { id: 2, url: "https://x.com/a", active: false }])).toEqual({ kind: "update", tabId: 1, activate: false });
  });

  it("switches to another x.com tab when the active tab is elsewhere", () => {
    expect(planOpenOnX([{ id: 1, url: "https://example.com", active: true }, { id: 2, url: "https://x.com/a", active: false }])).toEqual({ kind: "update", tabId: 2, activate: true });
  });

  it("opens a new tab when no x.com tab exists", () => {
    expect(planOpenOnX([{ id: 1, url: "https://example.com", active: true }])).toEqual({ kind: "create" });
    expect(planOpenOnX([])).toEqual({ kind: "create" });
  });

  it("recognises x.com hosts only", () => {
    expect(isXUrl("https://x.com/home")).toBe(true);
    expect(isXUrl("https://twitter.com/home")).toBe(true);
    expect(isXUrl("https://x.com.evil.example/")).toBe(false);
    expect(isXUrl("not a url")).toBe(false);
    expect(isXUrl(undefined)).toBe(false);
  });
});

describe("onXPage", () => {
  it("matches a post by its status id whatever the author segment", () => {
    expect(onXPage("https://x.com/someone/status/123", "https://x.com/i/status/123")).toBe(true);
    expect(onXPage("https://x.com/someone/status/123/photo/1", "https://x.com/someone/status/123")).toBe(true);
    expect(onXPage("https://x.com/someone/status/124", "https://x.com/someone/status/123")).toBe(false);
    expect(onXPage("https://x.com/someone", "https://x.com/someone/status/123")).toBe(false);
  });

  it("matches a feed page by its path, ignoring query, hash and trailing slash", () => {
    expect(onXPage("https://x.com/home", "https://x.com/home")).toBe(true);
    expect(onXPage("https://x.com/home/?ref=a#top", "https://x.com/home")).toBe(true);
    expect(onXPage("https://x.com/explore", "https://x.com/home")).toBe(false);
    expect(onXPage("https://x.com/someone/status/123", "https://x.com/home")).toBe(false);
  });

  it("is false off x.com or without a tab or target", () => {
    expect(onXPage("https://example.com/home", "https://x.com/home")).toBe(false);
    expect(onXPage(undefined, "https://x.com/home")).toBe(false);
    expect(onXPage("https://x.com/home", null)).toBe(false);
  });
});
