import { describe, expect, it } from "vitest";
import { EXTENSION_PAIR } from "../../../shared/src/extensionBridge";
import { pairingFromDesk, parseStoredPairing } from "./pairing";

const EXPIRES = "2026-11-01T00:00:00.000Z";
const NOW = Date.parse("2026-10-02T00:00:00.000Z");

describe("pairingFromDesk", () => {
  it("accepts a pair whose API matches the desk that sent it", () => {
    expect(
      pairingFromDesk({ type: EXTENSION_PAIR, token: "t", expiresAt: EXPIRES, apiBase: "https://api.xcopilot.dev" }, "https://xcopilot.dev"),
    ).toEqual({ token: "t", expiresAt: EXPIRES, apiBase: "https://api.xcopilot.dev", deskOrigin: "https://xcopilot.dev" });
  });

  it("refuses local desks outside development builds", () => {
    expect(
      pairingFromDesk({ type: EXTENSION_PAIR, token: "t", expiresAt: EXPIRES, apiBase: "http://localhost:8787" }, "http://localhost:5173"),
    ).toBeNull();
  });

  it("refuses an API that does not belong to the sending desk", () => {
    expect(
      pairingFromDesk({ type: EXTENSION_PAIR, token: "t", expiresAt: EXPIRES, apiBase: "https://evil.example" }, "https://xcopilot.dev"),
    ).toBeNull();
    expect(
      pairingFromDesk({ type: EXTENSION_PAIR, token: "t", expiresAt: EXPIRES, apiBase: "http://localhost:8787" }, "https://xcopilot.dev"),
    ).toBeNull();
    expect(
      pairingFromDesk({ type: EXTENSION_PAIR, token: "t", expiresAt: EXPIRES, apiBase: "https://api.xcopilot.dev" }, "https://evil.example"),
    ).toBeNull();
  });
});

describe("parseStoredPairing", () => {
  const stored = { token: "t", expiresAt: EXPIRES, apiBase: "https://api.xcopilot.dev", deskOrigin: "https://xcopilot.dev" };

  it("reads a live pairing", () => {
    expect(parseStoredPairing(stored, NOW)).toEqual(stored);
  });

  it("drops expired, tampered or malformed pairings", () => {
    expect(parseStoredPairing(stored, Date.parse(EXPIRES) + 1)).toBeNull();
    expect(parseStoredPairing({ ...stored, apiBase: "https://evil.example" }, NOW)).toBeNull();
    expect(parseStoredPairing({ ...stored, token: "" }, NOW)).toBeNull();
    expect(parseStoredPairing(null, NOW)).toBeNull();
  });
});
