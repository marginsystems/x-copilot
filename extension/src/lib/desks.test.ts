import { describe, expect, it } from "vitest";
import { deskMatches, deskTargets } from "./desks";

describe("desk targets", () => {
  it("ship only the xcopilot.dev desks outside development", () => {
    expect(deskMatches(deskTargets("production"))).toEqual([
      "https://xcopilot.dev/*",
      "https://www.xcopilot.dev/*",
    ]);
    expect(deskMatches(deskTargets(undefined))).toHaveLength(2);
  });

  it("add the local desks in development, without unsupported port components", () => {
    expect(deskMatches(deskTargets("development"))).toEqual([
      "https://xcopilot.dev/*",
      "https://www.xcopilot.dev/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ]);
  });
});
