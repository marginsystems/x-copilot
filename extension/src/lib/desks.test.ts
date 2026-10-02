import { describe, expect, it } from "vitest";
import { DESK_MATCHES } from "./desks";

describe("DESK_MATCHES", () => {
  it("matches desk hosts without unsupported port components", () => {
    expect(DESK_MATCHES).toEqual([
      "https://xcopilot.dev/*",
      "https://www.xcopilot.dev/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ]);
  });
});
