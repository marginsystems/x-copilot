import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  APPROACH_SURFACES,
  DESK_PHASES,
  advanceApproach as sharedAdvanceApproach,
  isForYouTask as sharedIsForYouTask,
} from "../../../shared/src/deskPhase.ts";
import {
  canServeApproachOriginal as sharedCanServeApproachOriginal,
  pickApproachSuggestion as sharedPickApproachSuggestion,
} from "../../../shared/src/approachCard.ts";
import {
  advanceApproach,
  canServeApproachOriginal,
  isForYouTask,
  pickApproachSuggestion,
  type ApproachEvent,
} from "./approachPhase.ts";

const EVENTS: ApproachEvent[] = [
  { type: "next" },
  { type: "skip" },
  { type: "dismiss" },
  { type: "mark" },
  { type: "bypass" },
  { type: "posted" },
];

await describe("server approach phase mirrors the desk's", async () => {
  await it("advances every lock exactly as the desk does, for every event and inventory", () => {
    let cases = 0;
    for (const phase of DESK_PHASES) {
      for (const cardId of [null, "a", "s"]) {
        for (const surface of [null, ...APPROACH_SURFACES]) {
          const lock = { phase, cardId, surface };
          assert.equal(isForYouTask(lock), sharedIsForYouTask(lock));
          for (const event of EVENTS) {
            for (const scoutId of [null, "a", "b"]) {
              for (const suggestionId of [null, "s", "t"]) {
                for (const canPresentForYou of [true, false]) {
                  for (const gate of [null, "link_x", "settings"] as const) {
                    const inventory = { scoutId, suggestionId, canPresentForYou, gate };
                    assert.deepEqual(
                      advanceApproach(lock, event, inventory),
                      sharedAdvanceApproach(lock, event, inventory),
                      JSON.stringify({ lock, event, inventory }),
                    );
                    cases += 1;
                  }
                }
              }
            }
          }
        }
      }
    }
    assert.equal(cases, 6 * 3 * 6 * 6 * 3 * 3 * 2 * 3);
  });

  await it("returns the same lock object when an event does not move the card", () => {
    const lock = { phase: "done_for_now" as const, cardId: null, surface: null };
    const empty = { scoutId: null, suggestionId: null, canPresentForYou: true };
    assert.equal(advanceApproach(lock, { type: "next" }, empty), lock);
  });

  await it("serves an original under the same conditions as the desk", () => {
    const missions = [
      null,
      { progress: 0, target: 1, completed: false },
      { progress: 1, target: 1, completed: false },
      { progress: 0, target: 1, completed: true },
    ];
    for (const scoutReplyDone of [true, false]) {
      for (const afterForYou of [true, false]) {
        for (const originalMission of missions) {
          const opts = { scoutReplyDone, afterForYou, originalMission };
          assert.equal(canServeApproachOriginal(opts), sharedCanServeApproachOriginal(opts));
        }
      }
    }
  });

  await it("picks the same suggestion as the desk", () => {
    const row = (id: string, kind: "post" | "quote" | "repost" | "reply", targetId: string | null, targetUrl: string | null) => ({
      id,
      kind,
      why: "",
      targetId,
      targetUrl,
      targetAuthor: null,
    });
    const rows = [
      row("p1", "post", null, null),
      row("r1", "reply", "100", "https://x.com/a/status/100"),
      row("q1", "quote", null, "https://x.com/b/status/200"),
      row("r2", "repost", "300", null),
    ];
    const optionSets = [
      undefined,
      { allowPost: true },
      { interactedIds: ["100"] },
      { interactedIds: ["100", "200", "300"] },
      { interactedIds: ["100", "200", "300"], allowPost: true },
      { interactedIds: ["100", "200", "300"], lockedId: "q1" },
      { history: [{ threadId: "x", conversationId: "100", inReplyToId: "200" }] },
      { history: [{ threadId: "x", url: "https://x.com/a/status/100" }, { threadId: "300" }] },
    ];
    for (const source of [rows, rows.slice(0, 1), rows.slice(1), []]) {
      for (const opts of optionSets) {
        assert.deepEqual(
          pickApproachSuggestion(source, opts)?.id ?? null,
          sharedPickApproachSuggestion(source, opts)?.id ?? null,
          JSON.stringify({ ids: source.map((entry) => entry.id), opts }),
        );
      }
    }
  });
});
