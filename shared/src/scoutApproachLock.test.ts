import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approachSuggestionCard,
  approachSuggestionCardId,
  deskApproachState,
  lockMovedAfterNext,
  parseDeskApproachState,
  parseScoutApproachLockResponse,
} from "./scoutApproachLock.ts";

const card = {
  id: "c9",
  conversationId: "conv-9",
  inReplyToId: null,
  surface: "reply",
  author: "@dana",
  url: "https://x.com/dana/status/9",
  text: "hi",
};

await describe("scout approach lock response", () => {
  it("reads a card or an empty lock", () => {
    assert.deepEqual(parseScoutApproachLockResponse({ ok: true, card }), { card, next: null, state: null });
    assert.deepEqual(parseScoutApproachLockResponse({ ok: true, card: null }), { card: null, next: null, state: null });
  }).catch(assert.fail);

  it("reads the card the desk would lock after Next, or For You as next", () => {
    const upNext = { ...card, id: "c10" };
    assert.deepEqual(parseScoutApproachLockResponse({ ok: true, card, next: { card: upNext } }), { card, next: { card: upNext }, state: null });
    assert.deepEqual(parseScoutApproachLockResponse({ ok: true, card, next: { card: null } }), { card, next: { card: null }, state: null });
  }).catch(assert.fail);

  it("treats a missing or malformed next as unknown and keeps the lock", () => {
    for (const next of [undefined, null, "c10", {}, { card: { id: "" } }]) {
      assert.deepEqual(parseScoutApproachLockResponse({ ok: true, card, next }), { card, next: null, state: null });
    }
  }).catch(assert.fail);

  it("rejects malformed responses", () => {
    for (const bad of [null, {}, { ok: false, card }, { ok: true }, { ok: true, card: { ...card, id: "" } }, { ok: true, card: { ...card, surface: "quote" } }, { ok: true, card: { ...card, url: 3 } }]) {
      assert.equal(parseScoutApproachLockResponse(bad), null);
    }
  }).catch(assert.fail);
});

await describe("lock moved after Next", () => {
  it("after a Scout card, any other card or For You counts as moved", () => {
    assert.equal(lockMovedAfterNext({ fromCardId: "c9" }, card), false);
    assert.equal(lockMovedAfterNext({ fromCardId: "c9" }, { ...card, id: "c10" }), true);
    assert.equal(lockMovedAfterNext({ fromCardId: "c9" }, null), true);
  }).catch(assert.fail);

  it("after For You, only a card counts as moved", () => {
    assert.equal(lockMovedAfterNext({ forYou: true }, null), false);
    assert.equal(lockMovedAfterNext({ forYou: true }, card), true);
  }).catch(assert.fail);
});

await describe("desk approach state", () => {
  const base = { phase: "hold", cardId: null, forYouTask: false, scoutDetected: false, suggestionDetected: false, forYouDetected: false };

  it("names the card the desk is showing and whether the desk detected it", () => {
    assert.deepEqual(deskApproachState({ ...base, forYouTask: true, forYouDetected: true }), { view: "for_you", detected: true });
    assert.deepEqual(deskApproachState({ ...base, phase: "scout_reply", cardId: "c1", scoutDetected: true }), { view: "scout", detected: true });
    assert.deepEqual(deskApproachState({ ...base, phase: "organic_reply", cardId: "s1" }), { view: "suggestion", detected: false });
    assert.deepEqual(deskApproachState({ ...base, phase: "done_for_now" }), { view: "collecting", detected: false });
    assert.deepEqual(deskApproachState({ ...base, phase: "scout_reply" }), { view: "collecting", detected: false });
    assert.deepEqual(deskApproachState({ ...base, phase: "silent_refuel" }), { view: "other", detected: false });
  }).catch(assert.fail);

  it("reads the state from the lock answer and drops a malformed one", () => {
    assert.deepEqual(parseScoutApproachLockResponse({ ok: true, card: null, state: { view: "collecting", detected: false } })?.state, { view: "collecting", detected: false });
    for (const state of [undefined, null, {}, { view: "nope", detected: false }, { view: "for_you" }]) {
      assert.equal(parseScoutApproachLockResponse({ ok: true, card: null, state })?.state, null);
    }
  }).catch(assert.fail);
});

await describe("published suggested card", () => {
  const post = { id: "s1", kind: "post" as const, why: "Take a side on AI wealth gains", targetId: null, targetUrl: null, targetAuthor: null };
  const reply = { id: "s2", kind: "reply" as const, why: "Join this thread", targetId: null, targetUrl: "https://x.com/erin/status/900", targetAuthor: "@erin" };
  const quote = { id: "s3", kind: "quote" as const, why: "Quote this", targetId: "901", targetUrl: null, targetAuthor: "@finn" };

  it("carries what the desk shows and the URL its Open on X uses", () => {
    assert.deepEqual(approachSuggestionCard(post), { ...post, openUrl: "https://x.com/home" });
    assert.deepEqual(approachSuggestionCard(reply), { ...reply, targetId: "900", openUrl: "https://x.com/erin/status/900" });
    assert.equal(approachSuggestionCard(quote).openUrl, "https://x.com/i/status/901");
    assert.equal(approachSuggestionCardId(approachSuggestionCard(reply)), "900");
    assert.equal(approachSuggestionCardId(approachSuggestionCard(post)), null);
    assert.equal(approachSuggestionCardId(approachSuggestionCard(quote)), null);
  }).catch(assert.fail);

  it("is part of the desk's state on a suggested card of any kind", () => {
    const base = { phase: "organic_reply", cardId: "s1", forYouTask: false, scoutDetected: false, suggestionDetected: false, forYouDetected: false };
    assert.deepEqual(deskApproachState({ ...base, suggestion: post }), {
      view: "suggestion",
      detected: false,
      suggestion: approachSuggestionCard(post),
    });
    assert.deepEqual(deskApproachState({ ...base, suggestion: reply }), { view: "suggestion", detected: false });
    assert.deepEqual(deskApproachState({ ...base, phase: "scout_reply", suggestion: post }), { view: "scout", detected: false });
  }).catch(assert.fail);

  it("reads the suggested card and stays compatible with states that have none", () => {
    const suggestion = approachSuggestionCard(post);
    assert.deepEqual(parseDeskApproachState({ view: "suggestion", detected: false, suggestion }), { view: "suggestion", detected: false, suggestion });
    assert.deepEqual(parseDeskApproachState({ view: "suggestion", detected: true }), { view: "suggestion", detected: true });
    assert.deepEqual(parseDeskApproachState({ view: "suggestion", detected: false, suggestion: { ...suggestion, kind: "thread" } }), { view: "suggestion", detected: false });
    assert.deepEqual(parseDeskApproachState({ view: "suggestion", detected: false, suggestion: { ...suggestion, why: " " } }), { view: "suggestion", detected: false });
    assert.deepEqual(parseDeskApproachState({ view: "scout", detected: false, suggestion }), { view: "scout", detected: false });
    assert.deepEqual(
      parseScoutApproachLockResponse({ ok: true, card: null, state: { view: "suggestion", detected: false, suggestion } })?.state,
      { view: "suggestion", detected: false, suggestion },
    );
  }).catch(assert.fail);

  it("names the detected post only on a detected original post card", () => {
    const base = { phase: "organic_reply", cardId: "s1", forYouTask: false, scoutDetected: false, forYouDetected: false };
    const detectedPost = { id: "1900000001", url: "https://x.com/me/status/1900000001" };
    const suggestion = approachSuggestionCard(post);
    assert.deepEqual(deskApproachState({ ...base, suggestionDetected: true, suggestion: post, detectedPost }), {
      view: "suggestion",
      detected: true,
      suggestion,
      post: detectedPost,
    });
    assert.deepEqual(deskApproachState({ ...base, suggestionDetected: false, suggestion: post, detectedPost }), {
      view: "suggestion",
      detected: false,
      suggestion,
    });
    const detected = { view: "suggestion", detected: true, suggestion, post: detectedPost };
    assert.deepEqual(parseDeskApproachState(detected), detected);
    assert.deepEqual(parseDeskApproachState({ ...detected, detected: false }), { view: "suggestion", detected: false, suggestion });
    assert.deepEqual(parseDeskApproachState({ ...detected, post: { id: "x1", url: detectedPost.url } }), { view: "suggestion", detected: true, suggestion });
    assert.deepEqual(parseDeskApproachState({ ...detected, post: { ...detectedPost, url: "https://evil.example/1" } }), { view: "suggestion", detected: true, suggestion });
    const quoteCard = approachSuggestionCard(quote);
    assert.deepEqual(parseDeskApproachState({ ...detected, suggestion: quoteCard }), { view: "suggestion", detected: true, suggestion: quoteCard });
  }).catch(assert.fail);

  it("counts a move off a suggested card only once the desk shows another card", () => {
    const suggested = { view: "suggestion" as const, detected: false, suggestion: approachSuggestionCard(post) };
    assert.equal(lockMovedAfterNext({ fromCardId: "s1" }, null, suggested), false);
    assert.equal(lockMovedAfterNext({ fromCardId: "s1" }, null, null), true);
    assert.equal(lockMovedAfterNext({ forYou: true }, null, suggested), true);
    assert.equal(lockMovedAfterNext({ forYou: true }, null, { view: "for_you", detected: false }), false);
    const replySuggested = { view: "suggestion" as const, detected: false, suggestion: approachSuggestionCard(reply) };
    assert.equal(lockMovedAfterNext({ fromCardId: "s2" }, { ...card, id: "900" }, replySuggested), false);
  }).catch(assert.fail);
});
