# Source operating and test guide

As of this revision: `0be9793` (`main`, Waves 0–4 landed), 2026-09-17.

This is the live `src/` operating contract. Read it instead of treating
`docs/src-architecture.md` as current — that file is the Wave 0 snapshot, and
its **Proposed** rows are not the desk you are running. Session generation
details stay in `docs/session-lifetime.md`.

Scope: root `src/` (194 TypeScript files, 52 colocated `*.test.ts` / `*.test.tsx`
files). This guide does not audit `server/src/`, `analytics/`, or `webhook/`
except where a frontend caller depends on a named endpoint. A `server/src`
reorg is out of scope.

**Owner** means the writer of that state. A hook that only reads is not an
owner.

## Ownership

| State or work | Owner | Boundary |
|---|---|---|
| Client session | `src/auth/session.tsx` (`createSession`, `SessionBoundary`) | Monotonic `generation`. `invalidate` clears the boot cache, drops identity, and remounts `App` via `key={generation}`. Cross-tab reset uses `SESSION_RESET_KEY`. |
| Verified identity | `src/auth/useAuthSession.ts` | Seeds nothing from storage. `applyAuthUser` is `session.verify`. Logout invalidates locally first, then POST `/api/auth/logout`. |
| Boot paint cache | `src/lib/deskBoot.ts` | Display data only. `peekDeskBootCache(verifiedOwnerId)` returns a seed only when the caller supplies a matching verified owner. Auth callback query (`auth` / `auth_error`) skips the cache. |
| Boot orchestration | `src/desk/useDeskBoot.ts` | One-shot `/api/boot` with `AbortController` plus `session.isCurrent`. Cleanup aborts the controller and drops the deadline timer. Writes cache on ok boot; clears on unauthenticated or fallback. Then launches coaching, billing, voice, usage, admin work. |
| Approach lock | `src/desk/useApproachTask.ts` commit + `src/lib/deskPhase.ts` / `src/lib/approachTask.ts` | Pure constructors live in `deskPhase` / `approachTask`. The hook persists the lock and PUTs `/api/scout-approach-lock`. Detected For You Next waits for `actForYou(..., "done")` before `advanceCard`. |
| Browser tank | `src/App.tsx` `threads` | `useScoutRun` replaces/appends. `useDeskHistory` and `useSkipDismiss` filter. Approach keeps retained presentation maps; it does not own the tank array. |
| Scout flight | `src/desk/useScoutRun.ts` | GET `/api/scout/last` (`autoStart=1` while watching). Poll starts only when `pollingEnabled` and the session is current; unsubscribe + abort on generation change or unmount. 401 invalidates the session. |
| History + For You actions | `src/desk/useDeskHistory.ts` | GET `/api/interacted`, `/api/skipped`, `/api/dismissed`, `/api/expired`, `/api/for-you`. POST `/api/for-you/{done,skip,dismiss}` via `actForYou`. Each hydrate uses `beginRefresh` (session generation + mount lifetime + per-key seq) and commits only the latest response. |
| Row-exit animation | `src/desk/useDeskRowExit.ts` | `beginExit` timers clear on unmount. A skip/dismiss/complete that the operator can no longer see does not fire. |
| Agenda persist | `src/desk/useAgendaPersist.ts` | PUT `/api/agenda`. Rechecks owner and generation after awaiting the previous save. |
| Settings | `src/settings/useSettingsDraft.ts` | Local `saveSettings` only. Does not rewrite the tank. Filters apply to the next Scout. |
| Activity strip | `src/desk/useActivityStrip.ts` | GET `/api/interacted/stats`. Per-request seq plus in-flight bucket; a later toggle wins. Boot snapshot is ignored after a user toggle or a successful refresh. |
| Coaching | `src/desk/useCoaching.ts` | GET `/api/coaching`. Monotonic seq. |
| Usage | `src/usage/useUsage.ts` | GET `/api/usage`. Monotonic seq plus `parseUsage`. |
| Billing | `src/billing/useBilling.ts` | GET `/api/billing/me`; POST checkout/portal/confirm. Parses with `parseBilling`. |
| Suggest | `src/useSuggestPane.ts` + `src/SuggestPane.tsx` | Hook owns stance → suggest → edit → verify → post. The component is presentation. Session, pane-session, and attempt guards live in the hook. |
| Routing | `src/routing/useViewRouting.ts` + `src/lib/appView.ts` | `isPublicView` classifies pricing, legal, changelog, and Learn. Public views paint without waiting for desk boot. |
| Public pages | `src/routing/PublicPages.tsx` | Lazy `Legal`, `Pricing`, `Changelog`, and Learn lessons via `lazyRoute`. |
| Desk composition | `src/desk/DeskView.tsx` | Lazy default export. Loads only after session, onboarding, and X-link gates. |
| Route parsers | `src/lib/routePayloads.ts` + `src/lib/deskBoot.ts` `parseDeskBoot` | Account, mail, sessions, analytics, usage, and billing return `null` on malformed JSON. Boot parse failure is a boot error, not a throw. |
| Chunk recovery | `src/routing/lazyRoute.tsx` | Recreates React's cached lazy promise on **Try again**. **Reload page** covers a stale deploy URL. |
| Chrome | `src/chrome/AppHeader.tsx`, `MenuDrawer.tsx`, `useMenu.ts`, `src/useDialogFocus.ts` | Drawer is a modal dialog with focus trap and inert siblings. |
| Presentation | `src/desk/approachPresenter.ts`, `MissionCard.tsx`, `ThreadsTabs.tsx` | Presenter is pure. Tabs are a `tablist` with Arrow / Home / End. |
| Root recovery | `src/RootBoundary.tsx` | Catches a render throw. Reload or back to `/`. |

Largest application files that still pass the 1,000-line ratchet (observed
sizes at this revision): `src/Analytics.tsx` 744, `src/App.tsx` 729,
`src/desk/useApproachTask.ts` 583, `src/desk/useDeskHistory.ts` 532,
`src/useSuggestPane.ts` 444.

## Boot and session flow

1. `App` wraps `SessionApp` in `SessionBoundary`. No desk slice is seeded from
   `localStorage` until a verified owner id is known.
2. `useAuthSession` starts with `checked: false` and no user. Protected remote
   views wait for server verification. Public views do not.
3. `useDeskBoot` captures the generation, installs an `AbortController`, and
   subscribes so a later invalidation aborts in-flight work:
   - consume `auth` / checkout query flags and clean the URL
   - `fetchDeskBoot` → `/api/boot` (12s fetch timeout; 24s boot deadline)
   - on ok: `applyAuthUser`, `applyDesk`, `writeDeskBootCache`, `refreshAfterPaint`
   - on unauthenticated: `applyAuthUser(null)`, `clearDeskBootCache`
   - on other failure: clear cache, then hydrate `/api/auth/me` plus the
     per-endpoint desk reads, still gated by `current()`
   - effect cleanup aborts the controller, unsubscribes, and clears the deadline
4. `refreshAfterPaint` fires coaching, activity stats (fallback path), billing,
   voice, usage, admin, and `ensureActivitySubscribe()`.
5. Account 401 / current-session revoke calls `onSignedOut` →
   `invalidateSession()` and `goToView("home")`. That is the same invalidation
   as logout: boot cache cleared, generation advanced, `App` remounted.
6. Menu logout calls `onLogout`: local `invalidate("Signing out…")` first, then
   POST `/api/auth/logout`. Only a successful HTTP response reports
   “Signed out.” Failure or timeout explains that this tab was cleared but
   server sign-out was not confirmed.

Local UI (`localhost`) does not show `BootScreen`. Remote non-public views show
it until `authChecked`. After a timeout or hard boot failure, if the session is
still unchecked, boot invalidates with a reload notice.

## Routes and bundles

`isPublicView` is pricing, privacy, terms, changelog, and the Learn catalog /
lessons. `App` returns `BootScreen` only when `booting && !publicView`. A public
deep link paints `PublicPages` while `/api/boot` is still in flight.

`DeskView` is a `lazyRoute` default import. Admin, Analytics, and Account are
also lazy. Public pages lazy-load their own modules. A failed chunk shows
“This page could not be loaded.” with **Try again** (new lazy promise) and
**Reload page**.

Measured entry JS after PR-13 (deployed `index-tgDNNJaD.js`): **324.68 kB** /
**102.72 kB** gzip. Re-measure with `npm run build` after a bundling change;
do not copy older proposed sizes from the Wave 0 map.

## Approach acknowledgment

A detected For You / suggested reply stays locked until the server acknowledges
`POST /api/for-you/done` for that id.

- `onSuggestionNext` sets a pending flag, awaits `actForYou(id, "done")`, and
  calls `advanceCard` only when the result is not `false`, the hook is still
  mounted, the session is current, and the lock has not changed.
- A detected reply that posts from the desk goes through the same Next path.
- Skip and dismiss also wait for `actForYou` success before advancing.
- Scout Next (non-suggestion) advances locally; it is not a For You ack.

`actForYou` returns `true` on success, `false` on network / non-404 failure, and
`"gone"` when a done request hits 404 (the row is already gone). Detected Next
treats `"gone"` as acknowledgment and advances; it stays locked only when the
result is `false`. A non-detected desk post waits for `=== true`, so a 404 there
does not advance. Failed done (`false`) leaves the card locked so the operator
can retry the same id.

## Suggest pane

`useSuggestPane` owns the pane session. Close or unmount bumps `sessionRef` /
`attemptRef` so an in-flight stance, suggest, verify, or post cannot reopen or
overwrite the next attempt. `suggestBusyRef` blocks a double-click from burning
two suggest slots. Compose (For You original / quote) can POST `/api/voice/post`;
Scout replies stay on Open on X.

## Failure states

| Failure | What the desk does |
|---|---|
| Logout | Local invalidation remounts `App` and clears the boot cache before the logout POST. Other same-origin tabs see `SESSION_RESET_KEY` and invalidate without echoing. |
| 401 | Account load / digest / session revoke calls `onSignedOut` (invalidate + home). Scout last-poll 401 calls `session.invalidate("Your session has ended.")`. Required-session boot 401 takes the unauthenticated path. |
| Stale responses | History hydrates drop a response whose seq, mount lifetime, or generation is no longer current. Activity stats drop a response whose seq or requested bucket is stale. Usage and coaching drop a response whose seq lost. Local history mutations increment the matching seq so an older GET cannot overwrite them. |
| Failed Approach done | Lock and card stay. Status comes from `actForYou` (“Could not update For You. Try again.”). Retry posts the same id. |
| Malformed JSON | `parseDeskBoot` / `routePayloads` return `null`. Boot treats that as an error and falls back or shows the reload notice. Account, usage, billing, and analytics surfaces show `payloadError` and keep the last good state. `RootBoundary` catches a render throw. |
| Chunk load failure | `lazyRoute` shows the page-level alert. **Try again** rebuilds the lazy import. **Reload page** recovers a stale hashed asset. |

## Tests

Run from the repository root after `npm ci` (Node 22, matching CI). These
scripts exist on this branch:

| Command | What it is |
|---|---|
| `npm run test:unit` | Recursive inventory (`scripts/test-inventory.ts`) of `*.test.ts` / `*.test.tsx` under `server/src`, `frontend/src`, `analytics/src`, and `webhook/src`, then `tsx --test` on that list. `npm test` is this command. |
| `npm run test:unit:list` | Print the same list without running. |
| `npm run test:mounted` | Vitest 3 + jsdom, only `frontend/tests/mounted/**/*.test.{ts,tsx}`. |
| `npm run test:mounted:list` | List mounted tests without executing them. |
| `npm run typecheck:mounted` | `tsc --noEmit -p frontend/tsconfig.mounted.json` (mounted tests, support, and `vitest.mounted.config.ts`). |
| `npm run build` | webhook / server / analytics emit, root `tsc --noEmit`, then `vite build`. |
| `npm run check:file-sizes` | 1,000-line ratchet over `frontend/src`, `server/src`, `webhook/src`, and `analytics/src`. |

`npm run lint:hooks` is the Wave 5 hook-lint ratchet (PR-15). It is **not** a
script on this branch; do not run it here.

CI (`.github/workflows/ci.yml`) runs `test:unit:list`, `test:unit`,
`test:mounted:list`, `test:mounted`, and `build`. It does not run
`typecheck:mounted` or `check:file-sizes`. File sizes are a separate workflow
(`.github/workflows/file-sizes.yml`) that invokes the same ratchet script. There
is no coverage gate and no browser job.

What the suites establish:

- **Unit (`tsx --test`)** — parsers, Approach constructors/gates, settings
  normalization, boot cache, coaching/usage helpers, routes, SEO, media. Several
  `src/desk/*.test.ts` files still assert static markup or CSS source; they do
  not mount effects.
- **Mounted (Vitest + jsdom)** — session invalidation and App remount, boot
  cancel / Scout poll stop, history and strip latest-response, Approach
  ack-before-advance, public routes without boot wait, route parsers, dialog
  focus, row-exit cancel, `lazyRoute` retry, Suggest pane guards.

jsdom is not a real browser. It does not establish layout, scrolling, paint, or
true focus containment. Mounted tests prove effect cleanup and dispatched
DOM events; they do not replace a browser pass for visual or keyboard-trap
regressions.

How to add coverage:

- Pure / node contracts stay next to the source as `*.test.ts` or `*.test.tsx`
  so `test:unit` discovers them.
- Mounted effect and interaction tests go under `frontend/tests/mounted/`. Follow
  `frontend/tests/mounted/README.md`. Do not import `node:test` into that suite.

## Out of scope

- `server/src/` folder layout and sidecar ownership (see the README server map).
- Live probes (`test:x-api`, `test:stripe`, `test:search`). Not CI.
- Starting the Vite dev server or deploying.
- Legal-copy correctness, billing enforcement, OAuth provider upgrades, and
  dependency CVEs unless a later issue asks for them.
