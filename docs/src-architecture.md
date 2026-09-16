# Source architecture map

Revision: `3fb65a89ffe09afc0fee3b0d1b42efdf8b43c8a5` (`main` at Wave 0).  
Scope: root `src/` — 211 files, 52 `*.test.ts` files. This is a map of what exists today, not a rewrite plan.

**Observed** means the current code does this. **Proposed** means a later Wave 0–5 PR. Do not treat proposed rows as live contracts.

This document does not audit `server/src/`, `analytics/`, or `webhook/` except where a frontend caller depends on a named endpoint.

## Ownership

These are the writers that matter to the desk. A hook that only reads is not an owner.

| State or work | Owner | Boundary |
|---|---|---|
| Verified identity | `src/auth/useAuthSession.ts` (`applyAuthUser`, `hydrateAuth`, `onLogout`) | Seeds from `peekDeskBootCache()` at `:26–33`. Logout at `:72–81` clears user + boot cache and calls `onLoggedOut`. App wires that callback to `closeMenu` only (`src/App.tsx:172`). |
| Boot paint cache | `src/lib/deskBoot.ts` (`writeDeskBootCache`, `peekDeskBootCache`, `clearDeskBootCache`) | One `localStorage` key. `peekMemo` at `:278–303` has no session/freshness check. Auth callback query (`auth` / `auth_error`) skips the cache. |
| Boot orchestration | `src/desk/useDeskBoot.ts` | One `useEffect` at `:59–173` with no cleanup or generation token. Writes cache on ok boot (`:140`), clears on unauthenticated/fallback (`:142`, `:154`, `:161`). Then launches coaching, billing, voice, usage, admin work. |
| Approach lock | `src/desk/useApproachTask.ts` commit + `src/lib/deskPhase.ts` / `src/lib/approachTask.ts` | Pure constructors live in `deskPhase` / `approachTask`. The hook persists the lock and PUTs `/api/scout-approach-lock` at `useApproachTask.ts:419`. |
| Browser tank | `src/App.tsx` `threads` (`:65–67`) | `useScoutRun` replaces/appends. `useDeskHistory` and `useSkipDismiss` filter. Approach keeps retained presentation maps; it does not own the tank array. |
| Scout flight | `src/desk/useScoutRun.ts` | POST `/api/scout/run`. `watchTank` at `:371–378` polls `hydrateLastScout(true)` (`autoStart=1`) with no auth/session dependency. App stays mounted on logout. |
| History + For You actions | `src/desk/useDeskHistory.ts` | GET `/api/interacted`, `/api/skipped`, `/api/dismissed`, `/api/expired`, `/api/for-you`. POST `/api/for-you/:id/:action` via `actForYou`. `hydrateInteracted` at `:171–229` applies every response. |
| Row-exit animation | `src/desk/useDeskRowExit.ts` | `beginExit` at `:12–45` schedules `then()` on a timeout. No unmount cancel. Approach skip/dismiss/complete suggestions call it (`useApproachTask.ts:456–528`). |
| Agenda persist | `src/desk/useAgendaPersist.ts` | PUT `/api/agenda`. Owner is checked once at `:39` before awaiting the previous save. Cleanup at `:81–85` flushes again. |
| Settings | `src/settings/useSettingsDraft.ts` | Local `saveSettings` only. Does not rewrite the tank. Copy says filters apply to the next Scout (`:39`). |
| Activity strip | `src/desk/useActivityStrip.ts` | GET `/api/interacted/stats`. Bucket equality at `:47` is the only stale-response guard. Gamification uses a monotonic seq (`:69–73`). |
| Coaching | `src/desk/useCoaching.ts` | GET `/api/coaching`. Has a request seq (`:22–24`). |
| Usage | `src/usage/useUsage.ts` | GET `/api/usage`. Has a request seq (`:14–22`). |
| Billing | `src/billing/useBilling.ts` | GET `/api/billing/me`; POST checkout/portal/confirm. |
| Voice card | `src/App.tsx` `hydrateVoice` + `src/lib/voice.ts` | GET `/api/voice`. Suggest/post live in `src/SuggestPane.tsx`. |
| Routing | `src/routing/useViewRouting.ts` + `src/lib/appView.ts` | `isPublicView` at `appView.ts:24–36` classifies pricing/legal/Learn. App still returns `BootScreen` when `!authChecked` (`App.tsx:389–416`). |
| Public pages | `src/routing/PublicPages.tsx` | Eager imports of every public page. |
| Chrome | `src/chrome/AppHeader.tsx`, `MenuDrawer.tsx`, `useMenu.ts` | Drawer is a declared dialog without focus trap (`MenuDrawer.tsx:13–28`). |
| Presentation | `src/desk/approachPresenter.ts`, `MissionCard.tsx`, `ThreadsTabs.tsx` | Presenter is pure. Tabs assign roles without arrow/Home/End (`ThreadsTabs.tsx:66–85,156`). |

Large files that still pass the 1,000-line ratchet (observed sizes): `App.tsx` 754, `Analytics.tsx` 734, `SuggestPane.tsx` 657, `useApproachTask.ts` 542, `useDeskHistory.ts` 463.

## Boot and session flow

Observed sequence on a dashboard load:

1. `App` calls `peekDeskBootCache()` (`App.tsx:58`) and seeds `agenda` / `threads` from it (`:59–67`).
2. `useAuthSession` seeds `authUser` and `authChecked` from the same cache (`useAuthSession.ts:25–30`). If a user is cached, `authChecked` starts true and `App.tsx:389` will not show `BootScreen`.
3. `useDeskBoot` starts an uncancellable async IIFE (`useDeskBoot.ts:94–171`):
   - consume `auth` / checkout query flags
   - `fetchDeskBoot` → `/api/boot`
   - on ok: `applyAuthUser`, `applyDesk`, `writeDeskBootCache`, `refreshAfterPaint`
   - on unauthenticated: `applyAuthUser(null)`, `clearDeskBootCache`
   - on other failure: `clearDeskBootCache`, `hydrateAuth` (`/api/auth/me`, 8s timeout), then `hydrateDeskWithoutBoot` (no deadline on the fallback requests)
4. `refreshAfterPaint` (`useDeskBoot.ts:114–131`) fires coaching, activity stats, billing, voice, usage, admin, and `ensureActivitySubscribe()`.
5. Account 401 / current-session revoke calls `onSignedOut` (`Account.tsx:81–83`, `:147–156`). App handles that at `:582–586` by clearing user, setting a notice, and going home. It does not call `onLogout`, does not clear the boot cache, and does not reset tank / history / voice / polling.
6. Menu logout uses `onLogout` (`useAuthSession.ts:72–81`). That POST `/api/auth/logout` ignores HTTP status (`:73–77`) and still announces “Signed out.”

Observed gaps (not proposed behavior):

- Cached identity can paint a previous session’s desk until boot rejects it (F01).
- Another tab’s logout does not invalidate `peekMemo`.
- Failed logout still looks successful.
- Boot work and `watchTank` polling can continue after logout because App stays mounted and those effects have no session token (F02).
- Public routes wait on `authChecked` even though `isPublicView` already classifies them (F07). Cold public paint can wait the 12s boot deadline plus the 8s auth timeout.

Proposed (PR-03, PR-06, PR-11): a single invalidation/generation contract; session-scoped boot and polling; public routes independent of desk readiness. Not implemented.

## Mutation inventory

Client writes that change server or durable client state. Reads are omitted unless they replace owned state unsafely.

| Mutation | Caller | Observed risk |
|---|---|---|
| POST `/api/auth/logout` | `useAuthSession.ts:74` | Status ignored. Local clear happens anyway. |
| DELETE `/api/auth/sessions/:id`, POST revoke-others | `Account.tsx:141`, `:172` | Current-session revoke uses App’s thin `onSignedOut`, not `onLogout`. |
| PUT `/api/agenda` | `useAgendaPersist.ts:52` | Queued save can run after logout / owner change (F05). |
| POST `/api/scout/run` | `useScoutRun.ts:181` | In-flight abort on unmount (`:359–363`) does not roll back accepted server work. |
| GET `/api/scout/last?autoStart=1` | `useScoutRun.ts:135–137`, `:373–376` | Poll can request automatic collection while signed out. Server branch is `server/src/scoutHttp.ts` `autoStart`. |
| PUT `/api/scout-approach-lock` | `useApproachTask.ts:419` | Detection correlation for the webhook. Not a second card chooser. |
| POST `/api/skipped`, `/api/dismissed` | `useSkipDismiss.ts:51`, `:123` | Fired from Approach via `beginExit`. Timer can fire after unmount (F03). |
| POST `/api/for-you/:id/{done,skip,dismiss}` | `useDeskHistory.ts` `actForYou` | Detected-suggestion next (`useApproachTask.ts:503–517`) awaits `actForYou` and advances only after acknowledgment. Other suggestion actions wait for success (`useApproachTask.ts:560–579`). |
| POST `/api/watch`, `/api/activity/subscribe` | `src/desk/watch.ts:39–47` | Fire-and-forget. Boot also calls subscribe. |
| POST `/api/onboarding/generate`, `/complete` | `Onboarding.tsx:130`, `:184` | First-run only. |
| POST `/api/voice/stances`, `/suggest`, `/verify`, `/post` | `SuggestPane.tsx` | Stance → suggest → edit → verify → post. Session/attempt guards live here. |
| POST `/api/stripe/checkout`, `/confirm`, `/portal` | `useBilling.ts` | Boot may `confirmCheckout` after cleanup (F02). |
| PATCH `/api/mail/preferences` | `Account.tsx:104` | Digest opt-in. |
| POST `/api/admin/grants` | `AdminPanel.tsx:130` | Operator-only. |
| `localStorage` boot cache | `deskBoot.ts:305–334` | Shared across tabs; memoized in-process. |
| `localStorage` settings | `useSettingsDraft.ts:20` | Next Scout only. |
| Approach lock storage | `useApproachTask` + `src/lib/approachLock.ts` | Survives reload. |

`useUsage.ts` and `useCoaching.ts` already drop stale responses with a monotonic seq. That is observed good behavior. `useDeskHistory.hydrateInteracted` and `useActivityStrip.hydrateActivityStats` do not (F04). Proposed: PR-07 extends the seq pattern; it does not replace those hooks wholesale.

## Test commands

Observed today (`package.json`):

| Command | What it is |
|---|---|
| `npm test` | `tsx --test server/src/**/*.test.ts src/**/*.test.ts analytics/src/**/*.test.ts webhook/src/**/*.test.ts` |
| `./node_modules/.bin/tsx --test src/**/*.test.ts` | Frontend-only slice of the same node runner |
| `npm run build` | webhook/server/analytics emit, root `tsc --noEmit`, Vite production build |
| `npm run check:file-sizes` | 1,000-line ratchet |
| `npm run test:x-api` / `test:stripe` / `test:search` | Live probes. Not CI. |

CI (`.github/workflows/ci.yml`) runs `npm ci --omit=optional`, unpacks Rollup/esbuild Linux binaries, then `npm test` and `npm run build`. No browser job. No coverage gate. `src/**/*.test.ts` does not pick up `.test.tsx` or nested files that fail the glob.

What the 52 frontend test files establish (observed):

- Strong: Approach transitions/gates and card selection; settings normalization; boot parse/cache; coaching/usage helpers; routes; SEO; media.
- `src/desk/MissionCard.test.ts` is static markup. `DeskRow.test.ts` is static render plus CSS-source assertions. Neither fires focus, DOM events, effects, or layout.
- `src/desk/useDeskHistory.test.ts:91` server-renders a hook and uses a never-resolving fetch. That does not execute mounted effects or prove response order.
- `src/settings/useSettingsDraft.test.ts` tests `commitSettingsDraft`, not a mounted form.
- `scoutTank`, `seo`, and `DeskRow` tests read source/assets. Keep the SEO/asset contracts; replace implementation-sensitive UI assertions when behavioral tests land.

Proposed (PR-01, not this PR): a second discovery path for mounted/browser tests; one effect-cleanup test; one real interaction test; existing node tests remain on their current command. Proposed (PR-05): CI runs both layers. Do not invent a coverage percentage from test counts.

## Backlog priorities

From the Wave 0 src audit. **P1** = session correctness or unintended mutation. **P2** = resilience / accessibility. **P3** = maintainability. “Confirmed” in the audit means the implementation establishes the gap; frequency still needs the listed tests.

| ID | Pri | Observed gap | Proposed PR |
|---|---|---|---|
| F01 | P1 | Cached identity and sign-out are not one boundary. | PR-03 Fable / hard |
| F02 | P1 | Boot and `watchTank` outlive the session that started them. | PR-06 Fable / hard (needs PR-03) |
| F03 | P1 | `useDeskRowExit` timers can mutate after unmount. | PR-04 Fable / medium |
| F04 | P2 | History/strip apply out-of-order responses. | PR-07 Fable / hard |
| F05 | P2 | Agenda queue does not recheck owner after await. | PR-09 Fable / medium |
| F06 | P2 | Detected suggestion advances before `actForYou` succeeds. | Fixed by PR-08 |
| F07 | P2 | Public routes wait on auth. | PR-11 Fable / medium |
| F08 | P2 | Modals/tabs lack keyboard behavior. | PR-10 Fable / medium |
| F09 | P2 | Unvalidated JSON can throw outside fetch catch; no root error boundary. | PR-12 Fable / medium–hard |
| F10 | P3 | Obsolete `onSearch` path and unused Approach inputs; large owners. | PR-13 Fable / hard (after behavior PRs) |
| F11 | P3 | Public and private routes share one eager bundle. | PR-13 (measure first) |

Wave 0 (this pair): PR-01 mounted test foundation (Astra) · this document (PR-02). Merge PR-01 before Wave 1 implementation branches adopt the harness.

Wave 1, parallel after PR-01: PR-03 session invalidation · PR-04 row-exit cancel · PR-05 CI inventory (GPT 5.6 medium; waits for PR-01 lockfile).

Wave 2, after PR-03’s session API is frozen: PR-06 boot/polling (owns App) · PR-07 history/strip · PR-09 agenda · PR-10 dialogs/tabs.

Wave 3: PR-08 Approach ack · PR-11 public routes · PR-12 parsers/recovery.

Wave 4: PR-13 App/Scout/lazy routes · PR-14 SuggestPane split.

Wave 5: PR-15 hook-lint ratchet (GPT 5.6 small) · PR-16 final operating guide (Grok 4.6).

Stacked or multi-PR work uses Graphite (`gt create` / `gt submit`). Unrelated parallel PRs do not share a stack. See `.cursor/rules/graphite-stack-prs.mdc`.

Out of scope unless separately requested: backend authorization, OAuth, billing enforcement, model/provider upgrades, legal-copy correctness, dependency CVEs.
