import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { pickApproachScout } from "./approachScout";
import {
  ApproachLoadingCard,
  MissionCard,
  approachRefillLine,
} from "./MissionCard";
import type { ThreadCard } from "./types";

function thread(id: string, views: number): ThreadCard {
  return {
    id,
    author: `@${id}`,
    text: id,
    url: `https://x.com/${id}/status/${id}`,
    views,
  };
}

describe("pickApproachScout", () => {
  it("locks the first tank row even when a later row has more views", () => {
    const quieter = thread("quiet-root", 10);
    const louder = thread("loud-leaf", 9000);
    assert.equal(pickApproachScout([quieter, louder]), quieter);
  });

  it("returns null when the tank is empty", () => {
    assert.equal(pickApproachScout([]), null);
  });
});

function missionProps(
  overrides: Partial<Parameters<typeof MissionCard>[0]> = {},
): Parameters<typeof MissionCard>[0] {
  return {
    phase: "done_for_now",
    hold: false,
    clock: "",
    remainingMs: 0,
    onBypass() {},
    scout: null,
    suggestion: null,
    refillState: "flying",
    flightLine: "Plotting the route…",
    actionBusy: false,
    expandedId: null,
    setExpandedId() {},
    interactedIds: new Set(),
    voice: null,
    agenda: "Builders",
    authUser: null,
    setVoice() {},
    exitingIds: new Set(),
    onScoutMark() {},
    onScoutSkip() {},
    onScoutDismiss() {},
    onSuggestionPosted() {},
    onSuggestionSkip() {},
    onSuggestionDismiss() {},
    onChooseFork() {},
    onOriginalPosted() {},
    onOpenVoice() {},
    onLinkX() {},
    ...overrides,
  };
}

describe("Approach flight frame", () => {
  it("renders a busy thread row with the live flight line", () => {
    const html = renderToStaticMarkup(MissionCard(missionProps()));
    assert.match(html, /class="mission-card approach-frame"/);
    assert.match(html, /class="thread-row approach-flight-row is-flying"/);
    assert.match(html, /role="status"/);
    assert.match(html, /Plotting the route…/);
    assert.doesNotMatch(html, />In the air…<\/p>/);
  });

  it("updates stage copy without replacing the card frame", () => {
    const plotting = renderToStaticMarkup(MissionCard(missionProps()));
    const airborne = renderToStaticMarkup(
      MissionCard(missionProps({ flightLine: "In the air…" })),
    );
    assert.equal(
      (plotting.match(/mission-card approach-frame/g) ?? []).length,
      1,
    );
    assert.equal(
      (airborne.match(/mission-card approach-frame/g) ?? []).length,
      1,
    );
    assert.match(airborne, /In the air…/);
  });

  it("fills the shared frame with the first locked scout thread", () => {
    const lead = thread("first-lead", 42);
    lead.summary = "A real landed summary";
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "scout_reply",
          scout: lead,
          refillState: "landed",
        }),
      ),
    );
    assert.match(html, /class="mission-card approach-frame"/);
    assert.match(html, /class="thread-row"/);
    assert.match(html, /A real landed summary/);
  });

  it("fills a landed scout thread while the desk is done for now", () => {
    const lead = thread("restored-lead", 42);
    lead.summary = "A restored landed summary";
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          scout: lead,
          refillState: "landed",
        }),
      ),
    );
    assert.match(html, /A restored landed summary/);
    assert.doesNotMatch(html, /Scout landed\. Loading Approach\./);
  });

  it("keeps a done-for-now scout visible during refill flight", () => {
    const lead = thread("flying-lead", 42);
    lead.summary = "A flying refill lead";
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          scout: lead,
          refillState: "flying",
        }),
      ),
    );
    assert.match(html, /A flying refill lead/);
    assert.doesNotMatch(html, /Scout is queued for takeoff\./);
  });

  it("uses the shared frame for boot", () => {
    const html = renderToStaticMarkup(ApproachLoadingCard());
    assert.match(html, /class="mission-card approach-frame"/);
    assert.match(html, /mission-skel-card/);
  });

  it("keeps queued and waiting copy in the row slot", () => {
    assert.equal(
      approachRefillLine("queued"),
      "Scout is queued for takeoff.",
    );
    assert.equal(
      approachRefillLine("waiting"),
      "Scout is waiting for the cooldown.",
    );
  });
});
