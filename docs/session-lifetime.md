# Client session lifetime (PR-03)

`src/auth/session.tsx` owns the client session contract. `App` places all of its
state and hooks below `SessionBoundary`. The boundary is keyed by a monotonic
`generation`, so an invalidation or verified owner replacement discards the old
App tree together: desk/history, agenda, voice, billing, usage, admin, overlays,
and hook-local state. Existing effect cleanups run on that unmount.

## Verification and reset

- A fresh document starts with no user and `checked: false`. Persistent boot data
  is display data only: neither auth nor App initializes identity or private
  state from it. `peekDeskBootCache(verifiedOwnerId)` returns data only when the
  caller supplies a verified matching owner; omitted owners get no seed.
  Protected remote views wait for server verification.
- `verify(user, required, generation)` accepts only the current active generation.
  Initial verification establishes an owner in that generation. Same-owner
  refreshes preserve it. Replacing an established owner increments the generation,
  clears boot storage/memo, and resets App before loading the new owner's desk.
- `invalidate(notice?, notifyTabs?)` synchronously expires the generation, clears
  boot storage/memo, removes identity, and marks the session inactive. Account
  401/current-session revocation, explicit logout, and cross-tab reset use it.
  Boot does not restart an inactive session. Signing in uses the existing OAuth
  document navigation; reload starts a new verification.
- Logout invalidates locally before awaiting the server. Only a successful HTTP
  response reports “Signed out.” A failure/timeout explains that server sign-out
  was not confirmed and the server session may remain active on reload.
- `SESSION_RESET_KEY` carries a unique storage-event notification on logout,
  revocation, and owner replacement. Other same-origin tabs invalidate without
  echoing it. A storage-clear event also invalidates. Notifications carry no user
  data. If storage is unavailable, local invalidation still works; cross-tab
  delivery is best effort. Sleeping/closed tabs verify again on document load.

## Contract for subsequent PRs

Obtain the stable controller with `useSession()` inside the boundary:

```ts
const generation = session.capture();
if (!session.isCurrent(generation)) return;
const result = await request();
if (!session.isCurrent(generation)) return;
// Commit result or start the next operation.
```

Capture once when work is scheduled, including before queue waits. Recheck after
awaits and before state commits, cache writes, or subsequent requests/mutations.
Never recapture a new token to authorize old work. `isCurrent` also checks the
active flag; capturing after logout does not authorize work. Auth setters exposed
by `useAuthSession` are bound to their render's generation. Notice updates accept
an explicit generation so a logout result can update its inactive generation
without overwriting a later session's notice.

The generation is a **session** lifetime, not an effect lifetime or request-order
counter. Add local cleanup/abort guards for StrictMode, navigation and effect
restarts, and separate sequence counters for latest-response ordering. Remounting
isolates old React setters but does not cancel network requests or undo accepted
server mutations. PR-03 adds only the boot checks needed to prevent session
resurrection; PR-06 owns boot cancellation, bounded fallback and explicit polling
enablement, PR-07 owns history ordering, and PR-09 owns queued agenda saves.

## Regression coverage

`tests/mounted/session.test.tsx` and `sessionApp.test.tsx` cover untrusted cached identity, immediate logout
reset, HTTP/network failure reporting, owner replacement with late auth/setters,
cross-tab memo invalidation without echo, late boot suppression, and unavailable
storage. Run `npm run test:mounted` and `npm run typecheck:mounted` alongside the
repository unit/build/file-size checks. These are mounted jsdom tests, not real
browser layout or cross-process storage-delivery tests.

PR-06 adds effect-local abort guards to boot and explicit Scout polling enablement
(after auth verification and onboarding in App, including auth-optional mode). Boot preserves callback query flags across
StrictMode replay. Its 24-second overall deadline bounds fallback auth, desk reads,
and checkout waiting; failure releases loading with a reload notice, and failure
before verification leaves the session inactive. Fallback reads commit together
through the existing boot applicators, so canceled reads cannot update hook state.
Polling captures the session when its effect is scheduled, aborts on cleanup or
invalidation, and stops on a 401. Cancellation stops client work; it does not undo
checkout or Scout collection already accepted by the server.
