import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { completeOnboarding } from "../auth/authStore.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { ensureUserTenant } from "../billing/billingStore.ts";
import { insertSuggestions } from "../for-you/forYouStore.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import { saveScoutCache } from "../scout/scoutCache.ts";
import { nextApproachStep } from "./approachSelector.ts";
import {
  AGENDA_MIN_CHARS,
  APPROACH_RELEASED_TTL_MS,
  approachGateFor,
  listReleasedCardIds,
  loadApproachStock,
  releaseCardIds,
  scoutCardsFromTank,
} from "./approachStock.ts";
import { markDismissed } from "./dismissalStore.ts";
import { markInteracted } from "./interactionStore.ts";

const AGENDA = "Building developer tools for people who ship small products every week.";

function thread(id: string, author: string) {
  return {
    id,
    author,
    text: `${author} shipped something`,
    url: `https://x.com/${author.slice(1)}/status/${id}`,
    createdAt: new Date().toISOString(),
    engage: "consider" as const,
    baitScore: 10,
    onAgenda: true,
  };
}

await describe("approach stock", async () => {
  let temp: TempPlatformDb;
  let userId: string;

  beforeEach(() => {
    temp = openTempPlatformDb("x-approach-stock-");
    userId = upsertOauthUser({
      provider: "x",
      providerUserId: "xid-stock",
      username: "pilot_stock",
      emailVerified: false,
    }).id;
    completeOnboarding(userId, AGENDA);
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  await it("raises the same gates as the desk: link X first, then a long enough agenda", () => {
    assert.equal(approachGateFor({ xLinked: false, agenda: AGENDA }), "link_x");
    assert.equal(approachGateFor({ xLinked: true, agenda: null }), "settings");
    assert.equal(approachGateFor({ xLinked: true, agenda: "x".repeat(AGENDA_MIN_CHARS - 1) }), "settings");
    assert.equal(approachGateFor({ xLinked: true, agenda: AGENDA }), null);
  });

  await it("reads card fields from tank threads and skips rows without an id", () => {
    assert.deepEqual(scoutCardsFromTank([thread("a1", "@alpha"), { author: "@x" }, null]), [
      {
        id: "a1",
        conversationId: null,
        inReplyToId: null,
        author: "@alpha",
        url: "https://x.com/alpha/status/a1",
        text: "@alpha shipped something",
      },
    ]);
  });

  await it("remembers released cards for a day", () => {
    const now = Date.now();
    releaseCardIds(userId, ["a1", "a2"], now);
    releaseCardIds(userId, ["a2"], now + 1_000);
    assert.deepEqual(listReleasedCardIds(userId, now + 2_000), ["a1", "a2"]);
    assert.deepEqual(listReleasedCardIds(userId, now + APPROACH_RELEASED_TTL_MS + 5_000), []);
  });

  await it("is null for an unknown user", async () => {
    assert.equal(await loadApproachStock("no-such-user"), null);
  });

  await it("loads one user's stock from the tank, suggestions, replies and released cards", async () => {
    await saveScoutCache(
      {
        savedAt: new Date().toISOString(),
        agenda: AGENDA,
        queries: ["q"],
        threads: [thread("a1", "@alpha"), thread("a2", "@bravo"), thread("a3", "@carol"), thread("a4", "@dave")],
      },
      { userId },
    );
    await markDismissed({ threadId: "a2", author: "@bravo", userId });
    await markInteracted({ threadId: "a1", author: "@alpha", userId });
    releaseCardIds(userId, ["a3"]);
    insertSuggestions({
      userId,
      tenantId: ensureUserTenant(userId),
      actions: [{ kind: "reply", why: "Join this thread", targetId: "900", targetUrl: "https://x.com/erin/status/900" }],
    });

    const loaded = await loadApproachStock(userId);
    assert.ok(loaded);
    assert.equal(loaded.stock.gate, null);
    assert.ok(!loaded.stock.scoutIds.includes("a2"));
    assert.ok(loaded.stock.interactedIds.includes("a1"));
    assert.deepEqual(loaded.stock.releasedIds, ["a3"]);
    assert.deepEqual(loaded.stock.suggestions.map((row) => row.targetId), ["900"]);
    assert.equal(loaded.stock.originalMission?.completed, false);

    const forYou = { phase: "hold" as const, cardId: null, surface: "for_you" as const };
    assert.deepEqual(nextApproachStep(loaded.stock, forYou)?.lock, {
      phase: "scout_reply",
      cardId: "a4",
      surface: null,
    });
  });
});
