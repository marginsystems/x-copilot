import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "./session.tsx";
import { parseDeskBoot, peekDeskBootCache, writeDeskBootCache } from "../lib/deskBoot.ts";
import type { AuthSessionUser } from "./types.ts";

const HINT = "0123456789abcdef0123456789abcdef";

const owner = (id: string): AuthSessionUser => ({
  id,
  email: null,
  displayName: id,
  avatarUrl: null,
  onboardingCompleted: true,
  agenda: null,
  xUsername: null,
  xLinked: true,
  isAdmin: false,
});

function provisionalPayload(id: string) {
  const payload = parseDeskBoot({ ok: true, ownerHint: HINT, user: owner(id), desk: {} });
  assert.ok(payload);
  return payload;
}

function provisionalSession(id = "a") {
  const payload = provisionalPayload(id);
  writeDeskBootCache(payload);
  return createSession({ provisional: payload });
}

await describe("session phases", () => {
  it("starts unchecked without a provisional payload", () => {
    const session = createSession();
    const snapshot = session.getSnapshot();
    assert.equal(snapshot.phase, "unchecked");
    assert.equal(snapshot.checked, false);
    assert.equal(snapshot.provisional, null);
    assert.equal(session.writesAllowed(), true);
  }).catch(assert.fail);

  it("starts provisional with a cached payload and blocks writes", () => {
    const session = provisionalSession();
    const snapshot = session.getSnapshot();
    assert.equal(snapshot.phase, "provisional");
    assert.equal(snapshot.provisional?.id, "a");
    assert.equal(snapshot.user, null);
    assert.equal(snapshot.checked, false);
    assert.equal(snapshot.ownerHint, HINT);
    assert.equal(session.writesAllowed(), false);
  }).catch(assert.fail);

  it("verifies the same owner without a generation bump and keeps the cache", () => {
    const session = provisionalSession();
    const generation = session.capture();
    const verified = session.verify(owner("a"), true, generation);
    const snapshot = session.getSnapshot();
    assert.equal(verified?.id, "a");
    assert.equal(snapshot.phase, "verified");
    assert.equal(snapshot.checked, true);
    assert.equal(snapshot.provisional, null);
    assert.equal(snapshot.generation, generation);
    assert.equal(peekDeskBootCache("a")?.user?.id, "a");
    assert.equal(session.writesAllowed(), true);
  }).catch(assert.fail);

  it("bumps the generation and clears the cache when a different owner verifies", () => {
    const session = provisionalSession();
    const generation = session.capture();
    session.verify(owner("b"), true, generation);
    const snapshot = session.getSnapshot();
    assert.equal(snapshot.phase, "verified");
    assert.equal(snapshot.user?.id, "b");
    assert.equal(snapshot.generation, generation + 1);
    assert.equal(peekDeskBootCache("a"), null);
  }).catch(assert.fail);

  it("bumps the generation and clears the cache when an optional boot has no user", () => {
    const session = provisionalSession();
    const generation = session.capture();
    session.verify(null, false, generation);
    const snapshot = session.getSnapshot();
    assert.equal(snapshot.phase, "verified");
    assert.equal(snapshot.user, null);
    assert.equal(snapshot.generation, generation + 1);
    assert.equal(peekDeskBootCache("a"), null);
  }).catch(assert.fail);

  it("rejects and clears the cache when a required boot has no user", () => {
    const session = provisionalSession();
    const generation = session.capture();
    assert.equal(session.verify(null, true, generation), null);
    const snapshot = session.getSnapshot();
    assert.equal(snapshot.phase, "rejected");
    assert.equal(snapshot.checked, true);
    assert.equal(snapshot.provisional, null);
    assert.equal(snapshot.active, false);
    assert.equal(peekDeskBootCache("a"), null);
    assert.equal(session.writesAllowed(), true);
  }).catch(assert.fail);

  it("keeps the desk and the cache when boot fails while provisional", () => {
    const session = provisionalSession();
    const generation = session.capture();
    session.fail("offline", generation);
    const snapshot = session.getSnapshot();
    assert.equal(snapshot.phase, "provisional");
    assert.equal(snapshot.provisional?.id, "a");
    assert.equal(snapshot.offline, true);
    assert.equal(snapshot.notice, "offline");
    assert.equal(snapshot.active, true);
    assert.equal(peekDeskBootCache("a")?.user?.id, "a");
    assert.equal(session.writesAllowed(), false);
  }).catch(assert.fail);

  it("invalidates without clearing the cache when boot fails while unchecked", () => {
    const session = createSession();
    writeDeskBootCache(provisionalPayload("a"));
    session.fail("could not load", session.capture());
    const snapshot = session.getSnapshot();
    assert.equal(snapshot.phase, "rejected");
    assert.equal(snapshot.notice, "could not load");
    assert.equal(peekDeskBootCache("a")?.user?.id, "a");
  }).catch(assert.fail);

  it("invalidate clears the cache by default and leaves it when asked", () => {
    const cleared = provisionalSession();
    cleared.invalidate("Signed out.", false);
    assert.equal(peekDeskBootCache("a"), null);
    assert.equal(cleared.getSnapshot().phase, "rejected");
    const kept = provisionalSession();
    kept.invalidate("kept", false, { clearCache: false });
    assert.equal(peekDeskBootCache("a")?.user?.id, "a");
  }).catch(assert.fail);

  it("invalidates when the cookie hint no longer matches the verified hint", () => {
    const session = provisionalSession();
    session.checkOwnerHint(HINT);
    assert.equal(session.getSnapshot().phase, "provisional");
    session.checkOwnerHint("fedcba9876543210fedcba9876543210");
    assert.equal(session.getSnapshot().phase, "rejected");
    assert.equal(session.getSnapshot().notice, "Your session changed. Reload to continue.");
    assert.equal(peekDeskBootCache("a"), null);
  }).catch(assert.fail);

  it("invalidates when the cookie hint disappears", () => {
    const session = provisionalSession();
    session.checkOwnerHint(null);
    assert.equal(session.getSnapshot().phase, "rejected");
  }).catch(assert.fail);

  it("ignores the cookie check when no hint was verified", () => {
    const session = createSession();
    session.verify(owner("a"), true, session.capture());
    session.checkOwnerHint(null);
    assert.equal(session.getSnapshot().phase, "verified");
  }).catch(assert.fail);
});
