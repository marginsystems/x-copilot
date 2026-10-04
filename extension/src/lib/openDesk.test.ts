import { describe, expect, it } from "vitest";
import { planOpenDesk } from "./openDesk";

const ORIGINS = ["https://xcopilot.dev", "https://www.xcopilot.dev"];
const plan = (tabs: Parameters<typeof planOpenDesk>[0], path = "/account") =>
  planOpenDesk(tabs, path, ORIGINS, "https://xcopilot.dev");

describe("planOpenDesk", () => {
  it("opens a new tab only when no desk tab is open", () => {
    expect(plan([{ id: 1, url: "https://x.com/home", windowId: 7 }, { id: 2 }])).toEqual({
      kind: "create",
      url: "https://xcopilot.dev/account",
    });
  });

  it("takes the first open desk tab to the page instead of opening another", () => {
    expect(plan([
      { id: 1, url: "https://x.com/home", windowId: 7 },
      { id: 2, url: "https://xcopilot.dev/dashboard", windowId: 7 },
      { id: 3, url: "https://xcopilot.dev/learn", windowId: 8 },
    ])).toEqual({ kind: "focus", tabId: 2, windowId: 7, url: "https://xcopilot.dev/account" });
  });

  it("just shows a desk tab that is already on the page, without reloading it", () => {
    expect(plan([
      { id: 2, url: "https://xcopilot.dev/dashboard", windowId: 7 },
      { id: 3, url: "https://xcopilot.dev/account/?from=panel", windowId: 8 },
    ])).toEqual({ kind: "focus", tabId: 3, windowId: 8, url: null });
  });

  it("keeps the desk tab on the origin it is signed in on", () => {
    expect(plan([{ id: 4, url: "https://www.xcopilot.dev/dashboard", windowId: 1 }], "/learn")).toEqual({
      kind: "focus",
      tabId: 4,
      windowId: 1,
      url: "https://www.xcopilot.dev/learn",
    });
  });

  it("ignores look-alike hosts and tabs it cannot read", () => {
    expect(plan([
      { id: 5, url: "https://xcopilot.dev.evil.example/account" },
      { id: 6, url: "not a url" },
      { url: "https://xcopilot.dev/account" },
    ]).kind).toBe("create");
  });
});
