import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pickApproachScout } from "./approachScout";
import { ApproachLoadingCard, MissionCard } from "./MissionCard";
import { FYP_HOLD_ACTION_COPY } from "./approachPresenter";
import { ForYouFeedRow } from "./ForYouFeedRow";
import {
  FYP_DETECTED_COPY,
  FYP_DETECTING_COPY,
  type ForYouSuggestion,
} from "../lib/forYou";
import { approachCollectingCopy, SCOUT_DETECTED_COPY } from "../lib/phaseWhy";
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

function escapeRe(copy: string): RegExp {
  return new RegExp(copy.replace(/[.;]/g, (m) => `\\${m}`));
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
    surface: null,
    clock: "",
    remainingMs: 0,
    onBypass() {},
    scout: null,
    scoutDetected: false,
    suggestion: null,
    suggestionDetected: false,
    forYou: null,
    actionBusy: false,
    expandedId: null,
    setExpandedId() {},
    interactedIds: new Set(),
    voice: null,
    agenda: "Builders",
    authUser: null,
    setVoice() {},
    exitingIds: new Set(),
    onScoutSkip() {},
    onScoutDismiss() {},
    onSuggestionPosted() {},
    onSuggestionSkip() {},
    onSuggestionDismiss() {},
    onOpenVoice() {},
    onLinkX() {},
    ...overrides,
  };
}

const suggestedReply: ForYouSuggestion = {
  id: "suggested-reply",
  kind: "reply",
  why: "A suggested reply",
  draft: null,
  targetId: null,
  targetUrl: null,
  targetAuthor: null,
};
const detectedSuggestedReply: ForYouSuggestion = {
  ...suggestedReply,
  id: "target-backed-reply",
  targetId: "123456",
  targetUrl: "https://x.com/target/status/123456",
  targetAuthor: "@target",
};

describe("Reply pace", () => {
  it("hides the pace bar when the hold clock has expired", () => {
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "hold",
          surface: "for_you",
          clock: "0:00",
          remainingMs: 0,
        }),
      ),
    );
    assert.doesNotMatch(html, /reply-pace/);
    assert.doesNotMatch(html, /0:00/);
  });

  it("keeps the live pace clock under the For You row", () => {
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "hold",
          surface: "for_you",
          clock: "0:42",
          remainingMs: 42_000,
        }),
      ),
    );
    assert.match(html, /reply-pace/);
    assert.match(html, /0:42/);
    assert.match(html, />Bypass</);
  });

  it("keeps the live pace clock under a Scout row", () => {
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "scout_reply",
          scout: thread("live-scout", 42),
          clock: "0:42",
          remainingMs: 42_000,
        }),
      ),
    );
    assert.match(html, /live-scout/);
    assert.match(html, /reply-pace/);
    assert.match(html, /0:42/);
  });

  it("hides the pace bar under a Scout row when the clock expires", () => {
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "scout_reply",
          scout: thread("expired-scout", 42),
          clock: "0:00",
          remainingMs: 0,
        }),
      ),
    );
    assert.match(html, /expired-scout/);
    assert.doesNotMatch(html, /reply-pace/);
    assert.doesNotMatch(html, /0:00/);
  });

  it("keeps the live pace clock under a Suggested row", () => {
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "organic_reply",
          suggestion: suggestedReply,
          clock: "0:42",
          remainingMs: 42_000,
        }),
      ),
    );
    assert.match(html, /Suggested reply/);
    assert.match(html, /reply-pace/);
    assert.match(html, /0:42/);
  });

  it("hides the pace bar under a Suggested row when the clock expires", () => {
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "organic_reply",
          suggestion: suggestedReply,
          clock: "0:00",
          remainingMs: 0,
        }),
      ),
    );
    assert.match(html, /Suggested reply/);
    assert.doesNotMatch(html, /reply-pace/);
    assert.doesNotMatch(html, /0:00/);
  });
});

describe("Hold presentation", () => {
  it("holds the same For You card while the minute runs: no Next, Bypass exits", () => {
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "hold",
          surface: "for_you",
          forYou: { detected: false },
          clock: "0:42",
          remainingMs: 42_000,
        }),
      ),
    );
    assert.match(html, />Hold</);
    assert.match(html, escapeRe(FYP_DETECTING_COPY));
    assert.match(html, />Open For You</);
    assert.match(html, escapeRe(FYP_HOLD_ACTION_COPY));
    assert.doesNotMatch(html, />Next</);
    assert.match(html, />Bypass</);
    assert.doesNotMatch(html, /Reply, original, or quote/);
  });

  it("becomes For You on the same card when the minute is over", () => {
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "hold",
          surface: "for_you",
          forYou: { detected: false },
          clock: "0:00",
          remainingMs: 0,
          onForYouNext() {},
        }),
      ),
    );
    assert.match(html, />For You</);
    assert.doesNotMatch(html, />Hold</);
    assert.match(html, />Open For You</);
    assert.match(html, />Next</);
    assert.doesNotMatch(html, /reply-pace/);
    assert.doesNotMatch(html, escapeRe(FYP_HOLD_ACTION_COPY));
  });
});

describe("Gate cards", () => {
  it("names the missing prerequisite instead of For You", () => {
    const linkX = renderToStaticMarkup(
      MissionCard(missionProps({ phase: "silent_refuel", surface: "link_x" })),
    );
    assert.match(linkX, />Link X</);
    assert.doesNotMatch(linkX, />For You</);
    assert.doesNotMatch(linkX, />Open For You</);
    const settings = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "silent_refuel",
          surface: "settings",
          onOpenSettings() {},
        }),
      ),
    );
    assert.match(settings, />Set agenda</);
    assert.match(settings, />Settings</);
    assert.doesNotMatch(settings, />For You</);
  });

  it("no longer paints usage or wait gates: the feed is open", () => {
    for (const surface of ["usage", "wait"] as const) {
      const html = renderToStaticMarkup(
        MissionCard(
          missionProps({
            phase: "silent_refuel",
            surface,
            onForYouNext() {},
          }),
        ),
      );
      assert.match(html, />For You</);
      assert.match(html, />Open For You</);
      assert.match(html, />Next</);
      assert.doesNotMatch(html, /Approach is holding/);
      assert.doesNotMatch(html, /Grounded/);
    }
  });
});

describe("Approach flight frame", () => {
  it("listens for a target-backed Suggested reply without I posted", () => {
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "organic_reply",
          suggestion: detectedSuggestedReply,
          expandedId: `suggest:${detectedSuggestedReply.id}`,
        }),
      ),
    );
    assert.match(html, escapeRe(FYP_DETECTING_COPY));
    assert.match(html, /Open on X/);
    assert.match(html, />Skip</);
    assert.match(html, />Not interested</);
    assert.doesNotMatch(html, /I posted on X/);
  });

  it("offers only Next after a Suggested reply is detected", () => {
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "organic_reply",
          suggestion: detectedSuggestedReply,
          suggestionDetected: true,
          expandedId: `suggest:${detectedSuggestedReply.id}`,
        }),
      ),
    );
    assert.match(html, escapeRe(SCOUT_DETECTED_COPY));
    assert.match(html, /chip-interacted/);
    assert.match(html, />Next</);
    assert.doesNotMatch(html, /Open on X|Open original/);
    assert.doesNotMatch(html, />Skip</);
    assert.doesNotMatch(html, /I posted on X/);
    assert.doesNotMatch(html, /Not interested/);
  });

  it("fills the shared frame with the first locked scout thread", () => {
    const lead = thread("first-lead", 42);
    lead.summary = "A real landed summary";
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "scout_reply",
          scout: lead,
          expandedId: lead.id,
        }),
      ),
    );
    assert.match(html, /class="mission-card approach-frame"/);
    assert.match(html, /class="thread-row open"/);
    assert.match(html, /A real landed summary/);
    assert.match(html, />Reply</);
    assert.match(html, /Open on X/);
    assert.match(html, />Skip</);
    assert.match(html, /Not interested/);
    assert.match(html, /Suggest reply — locked/);
    assert.match(html, escapeRe(FYP_DETECTING_COPY));
    assert.doesNotMatch(html, /I posted on X/);
  });

  it("says the reply was detected and offers Next on a retained scout", () => {
    const lead = thread("detected-lead", 42);
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "scout_reply",
          scout: lead,
          scoutDetected: true,
          expandedId: lead.id,
          onScoutNext() {},
        }),
      ),
    );
    assert.match(html, escapeRe(SCOUT_DETECTED_COPY));
    assert.doesNotMatch(html, escapeRe(FYP_DETECTING_COPY));
    assert.match(html, /chip-interacted/);
    assert.match(html, />Next</);
    assert.doesNotMatch(html, /Open on X/);
    assert.doesNotMatch(html, />Skip</);
    assert.doesNotMatch(html, /I posted on X/);
  });

  it("renders repost scout cards without a Suggest pane", () => {
    const lead = thread("repost-lead", 420);
    lead.surface = "repost";
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "scout_reply",
          scout: lead,
          expandedId: lead.id,
        }),
      ),
    );
    assert.match(html, />Repost</);
    assert.match(html, /Open on X/);
    assert.match(html, />Skip</);
    assert.match(html, /Not interested/);
    assert.doesNotMatch(html, /Suggest reply/);
    assert.doesNotMatch(html, /I posted on X/);
  });

  it("keeps an empty Scout lock in the existing collecting flight row", () => {
    for (const searching of [false, true]) {
      const html = renderToStaticMarkup(MissionCard(missionProps({
        phase: "scout_reply", scout: null, searching,
        suggestion: suggestedReply, onScoutNext() {}, onForYouNext() {},
      })));
      assert.match(html, />Collecting</);
      assert.match(html, escapeRe(approachCollectingCopy({ searching })));
      assert.match(html, /approach-flight-row/);
      assert.match(html, /aria-busy="true"/);
      assert.equal(html.includes("is-flying"), searching);
      assert.doesNotMatch(html, escapeRe(FYP_DETECTING_COPY));
      assert.doesNotMatch(html, />Next<|>For You<|>Scout<|>Land<|>Take Off<|Suggested reply/);
    }
  });

  it("fills a landed scout thread while the desk is done for now", () => {
    const lead = thread("restored-lead", 42);
    lead.summary = "A restored landed summary";
    const html = renderToStaticMarkup(
      MissionCard(missionProps({ scout: lead })),
    );
    assert.match(html, /A restored landed summary/);
    assert.doesNotMatch(html, /Scout landed\. Loading Approach\./);
  });

  it("renders a busy panel loader without skeleton rows for boot", () => {
    const html = renderToStaticMarkup(ApproachLoadingCard());
    assert.match(html, /class="approach-panel-loader"/);
    assert.match(html, /role="status"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /aria-label="Loading Approach"/);
    assert.doesNotMatch(html, /mission-skel|thread-row|mission-card/);
  });

  it("keeps an empty idle Approach collecting for Scout", () => {
    const html = renderToStaticMarkup(
      MissionCard(missionProps({ onForYouNext() {} })),
    );
    assert.match(html, />Collecting</);
    assert.match(html, /Scout is getting the next reply/);
    assert.doesNotMatch(html, />For You</);
    assert.doesNotMatch(html, />Open For You</);
    assert.doesNotMatch(html, />Next</);
    assert.match(html, /approach-flight-row/);
    assert.match(html, /aria-busy="true"/);
    assert.doesNotMatch(html, /is-flying/);
  });

  it("shows the in-air line and flying row while Collecting searches", () => {
    const html = renderToStaticMarkup(MissionCard(missionProps({ searching: true })));
    assert.match(html, />Collecting</);
    assert.match(html, escapeRe(approachCollectingCopy({ searching: true })));
    assert.match(html, /approach-flight-row is-flying/);
    assert.match(html, /aria-busy="true"/);
    assert.doesNotMatch(html, /Scout is getting the next reply/);
  });

  it("never leaks refill internals onto the For You wait", () => {
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "silent_refuel",
          surface: "for_you",
          forYou: { detected: false },
          onForYouNext() {},
        }),
      ),
    );
    assert.match(html, />For You</);
    assert.match(html, />Open For You</);
    assert.match(html, />Next</);
    assert.doesNotMatch(html, /queued for takeoff/);
    assert.doesNotMatch(html, /waiting for the cooldown/);
    assert.doesNotMatch(html, /In the air/);
    assert.doesNotMatch(html, /approach-flight-row/);
    assert.doesNotMatch(html, /Scouting/);
  });

  it("shows detecting copy on an empty For You wait", () => {
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "silent_refuel",
          surface: "for_you",
          forYou: { detected: false },
          onForYouNext() {},
        }),
      ),
    );
    assert.match(html, escapeRe(FYP_DETECTING_COPY));
    assert.equal(html.split(FYP_DETECTING_COPY).length - 1, 1);
    assert.match(html, /mission-card-why"><\/p>/);
    assert.match(html, /for-you-status/);
    assert.match(html, /approach-panel-loader-mark/);
    assert.match(html, />Open For You</);
    assert.match(html, />Next</);
    assert.doesNotMatch(html, /You&#x27;re clean/);
  });

  it("keeps a detected hold visible with its post and no Next", () => {
    const html = renderToStaticMarkup(
      MissionCard(
        missionProps({
          phase: "hold",
          surface: "for_you",
          forYou: { detected: true },
          remainingMs: 42_000,
          clock: "0:42",
          coaching: {
            dayUtc: "2026-09-08",
            nextAction: null,
            missions: [],
            beats: {
              scoutReplyDone: false,
              organicReplyDone: false,
              forkChoice: null,
              forkDone: false,
            },
            replyAt: ["2026-09-08T04:00:01.000Z"],
            ownActivity: {
              id: "196504221778",
              url: "https://x.com/desk/status/196504221778",
              text: "The detected post text.",
              kind: "reply",
              postedAt: "2026-09-08T04:00:00.000Z",
            },
          },
          onForYouNext() {},
        }),
      ),
    );
    assert.match(html, escapeRe(FYP_DETECTED_COPY));
    assert.equal(html.split(FYP_DETECTED_COPY).length - 1, 1);
    assert.match(html, /196504221778/);
    assert.match(html, /href="https:\/\/x\.com\/desk\/status\/196504221778"/);
    assert.match(html, /The detected post text\./);
    assert.match(html, /aria-label="Open detected post 196504221778 on X"/);
    assert.match(html, /class="caret"/);
    assert.doesNotMatch(html, />Next</);
    assert.doesNotMatch(html, />Open For You</);
    assert.doesNotMatch(html, /Likes do not count/);
    assert.match(html, />Bypass</);
  });

  it("paints the same For You presenter for both For You phases", () => {
    const entries = [
      { phase: "silent_refuel", surface: "for_you" },
      { phase: "hold", surface: "for_you" },
    ] as const;
    const rendered = entries.map(({ phase, surface }) =>
      renderToStaticMarkup(
        MissionCard(
          missionProps({
            phase,
            surface,
            forYou: { detected: true },
            onForYouNext() {},
          }),
        ),
      ),
    );
    assert.equal(new Set(rendered).size, 1);
    assert.match(rendered[0], />Next</);
  });
});

describe("ForYouFeedRow", () => {
  it("keeps detected status and fallback text without activity detail", () => {
    const html = renderToStaticMarkup(
      createElement(ForYouFeedRow, {
        detected: true,
        activity: null,
        expandable: true,
      }),
    );
    assert.match(html, escapeRe(FYP_DETECTED_COPY));
    assert.match(html, /Post text unavailable\./);
    assert.match(html, /class="caret"/);
  });

  it("lets a detected wait collapse while keeping its status visible", () => {
    const html = renderToStaticMarkup(
      createElement(ForYouFeedRow, {
        status: FYP_DETECTED_COPY,
        detected: true,
        activity: null,
        defaultOpen: false,
        expandable: true,
        onNext() {},
      }),
    );
    assert.match(html, escapeRe(FYP_DETECTED_COPY));
    assert.match(html, /class="caret"/);
    assert.doesNotMatch(html, />Next</);
    assert.doesNotMatch(html, /thread-row for-you-row next-action-row kind-reply open/);
  });

  it("lets an undetected wait collapse its details", () => {
    const html = renderToStaticMarkup(
      createElement(ForYouFeedRow, {
        status: FYP_DETECTING_COPY,
        detected: false,
        defaultOpen: false,
        expandable: true,
        onNext() {},
      }),
    );
    assert.match(html, /class="caret"/);
    assert.doesNotMatch(html, /thread-row for-you-row next-action-row kind-reply open/);
  });
});
