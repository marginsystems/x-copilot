import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatScoutFailure,
  isScoutGateError,
  isScoutFlightStatus,
  scoutStageMessage,
} from "./scoutStages.ts";

describe("scoutStages", () => {
  it("returns flight-style stage copy", () => {
    assert.match(scoutStageMessage("planning"), /route/i);
    assert.match(scoutStageMessage("searching"), /air/i);
    assert.match(scoutStageMessage("done"), /Landed/);
  });

  it("hides flight theater from the desk bar and keeps user lines", () => {
    assert.equal(isScoutFlightStatus("Picking the approach… 1/20"), true);
    assert.equal(isScoutFlightStatus("In the air… 4/20"), true);
    assert.equal(isScoutFlightStatus("Landed."), true);
    assert.equal(
      isScoutFlightStatus("Restored 5 threads (80 → 12) from 16:02."),
      true,
    );
    assert.equal(isScoutFlightStatus("Skipped @alice"), false);
    assert.equal(isScoutFlightStatus("Scout failed: stream ended without results"), false);
    assert.equal(isScoutFlightStatus("Couldn't land."), false);
  });

  it("treats 429 cooldown/busy as soft gate errors", () => {
    assert.equal(
      isScoutGateError(429, { error: "scout_cooldown", message: "Wait 12s before searching again." }),
      true,
    );
    assert.equal(
      isScoutGateError(429, { error: "scout_busy" }),
      true,
    );
    assert.equal(isScoutGateError(429, { error: "scout_daily_limit" }), true);
    assert.equal(isScoutGateError(402, { error: "credits_exhausted" }), true);
    assert.equal(isScoutGateError(500, { error: "deepseek_error" }), false);
  });

  it("formats hard failures with Scout failed prefix", () => {
    assert.equal(
      formatScoutFailure("stream ended without results"),
      "Scout failed: stream ended without results",
    );
    assert.equal(
      formatScoutFailure("Wait 12s before searching again.", { soft: true }),
      "Wait 12s before searching again.",
    );
  });

  it("does not expose local operations instructions", () => {
    for (const detail of [
      "Sidecar offline — run ./pm2-manager.sh restart",
      "Try npm run dev:server on localhost",
    ]) {
      const line = formatScoutFailure(detail);
      assert.equal(line, "Scout is unavailable right now.");
      assert.doesNotMatch(line, /sidecar|pm2|npm|localhost|\.\//i);
    }
  });
});
