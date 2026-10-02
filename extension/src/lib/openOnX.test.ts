import { describe, expect, it } from "vitest";
import { isXUrl, planOpenOnX } from "./openOnX";

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
