# x-copilot

Independent research + triage desk for posting on X. **Not affiliated with, endorsed by, or part of X Corp.**

**Live:** [xcopilot.dev](https://xcopilot.dev)

Official X API search → DeepSeek triage in a Vite dashboard. Scout finds cool threads worth a human reply. Suggest can draft in your Voice; you rewrite it before Copy / Open on X or posting from the desk. No auto-engage.

**Status:** Stream 1 — agenda → DeepSeek Chat queries → recent search (official X API) → triaged thread cards.

## Idea

1. Paste an **agenda** (who/what to engage, voice, avoid list).
2. **DeepSeek Chat** expands the agenda into 2–4 short X search queries (one LLM call).
3. Sidecar runs those queries via the official X API **recent search** (`GET /2/tweets/search/recent`, app-only bearer).
4. A second DeepSeek call **triages** the results (summary + bait risk + engage hint).
5. Review cool thread cards. Suggest can offer a Voice-matched draft you must rewrite; then Copy / Open on X, or post from the desk. No auto-engage.

## Thread triage

Scout triages candidate buckets with DeepSeek and enriches each card with:

| Field | Meaning |
|-------|---------|
| `summary` | One sentence: what the post is about and why it was likely posted |
| `baitScore` | `0–100` engagement-bait risk — **higher is worse** (mirrored onto `score`) |
| `flags` | e.g. `engagement_bait`, `promo`, `github_plug`, `genuine_question`, `on_agenda` |
| `intent` | Short read, e.g. "engagement farming" |
| `engage` | `skip` \| `consider` \| `priority` |
| `reason` | One clause explaining the score |

The agenda is passed along, so a specific on-agenda question scores low even though it is a question. **Only posts with a numeric bait score are returned** to the UI — incomplete triage items, omitted ids (after one repair), and overflow past the 20-thread triage cap are dropped and noted in `triageWarning`. If triage fails entirely, search still returns 200 with an empty thread list plus the warning (never a wall of unscored `—` rows). In the UI, summaries replace the tweet text as the card headline (original stays underneath) and `skip` threads are dimmed.

## Interacted + author cooldown

**Mark interacted** records the thread + author in `data/platform.sqlite` (`desk_interactions`; `data/` is gitignored). For the next **24 hours**, later searches drop other posts from that same `@handle` *before* triage, so we do not keep hammering the same account or waste DeepSeek tokens on them. The search status line reports how many posts were filtered. Restarting the sidecar keeps the cooldown (SQLite persist).

The same action also writes an Obsidian-friendly Markdown note under **`knowledge/interactions/`** (gitignored) that includes the thread context and the **reply you typed on X** (`POST /api/interacted` requires `reply`). Point Obsidian at the `knowledge/` folder to browse agent memories locally — never commit that directory.

The last successful Scout run is cached per user in `scout_tanks` in the same SQLite file (not `data/last-scout.json`). On dashboard load, `GET /api/scout/last` restores Threads / queries (cooled-down authors filtered out) so a reload or API restart does not wipe the list.

## Length filter

Before triage, posts with more than **480** characters (or obvious `N/M` thread openers like `1/17 …`) are dropped so walls of text never reach DeepSeek or the accordion. The same cap applies to the **hydrated parent** a reply sits under. Override with `X_MAX_THREAD_CHARS` in `.env`, or via **Settings → Max post characters** — the UI sends `filters` on each Scout run and wins over env for that request. **X Articles and replies to them** are hard-dropped by default when the payload marks an article (`tweet.fields=article`, or leftover GraphQL article nodes). When a **note tweet** body is present, that text is used for the char cap instead of the short `full_text` teaser. The search status line reports how many were dropped.

## Scout

**Scout** is x-copilot’s search mini-agent. The desk arms a run when the tank is low (`GET /api/scout/last?autoStart=1`); there is no dashboard Start/Stop control. Flow:

1. Plan queries (DeepSeek), then pace X recent search (**20** hits/query).
2. **Hard-filter bucket** (cooldown + Article/char/links/self-reply) with **no LLM** until the bucket has **K** candidates (UI sends `bucketSize: 20`; server accepts 5|10|20). Keep searching / cycling queries (one replan, search budget) while the bucket is short.
3. **LLM-qualify** the full bucket. Cool = `engage` `priority`/`consider` and `baitScore ≤ 45`.
4. Keep cool threads and refill until **Cool threads** target (`targetCool`, 1–20) or supply is exhausted. If a full bucket yields **0 cool**, discard and refill. Budget/abort → `exhausted` / `aborted`; hit target → `stopReason: target`.

Status shows `Candidates n/K` while filling and `Cool n/target` as cools accumulate. Use `POST /api/scout/run` (NDJSON; `done` includes `coolCount`, `bucketSize`, `stopReason`, threads). Sessions are rate-limited: one run at a time, then a **15s** cooldown (sidecar `429`) before the next run.

## Architecture

```
Vite UI  →  local Node sidecar  →  X API v2 (app-only bearer)
                 ↓
              DeepSeek v4-flash
```

Bearer token and LLM keys stay in `.env` on the sidecar. The browser never stores credentials. Public DNS + bind notes: [docs/PUBLIC_DEPLOY.md](docs/PUBLIC_DEPLOY.md).

### Server source map

`server/src/` is **237 files across ten ownership folders and five root files**: 130 production modules, 103 `*.test.ts` files, 3 test-support files (`platform/platformDb.testHelpers.ts`, `scout/scoutCollect.testHelpers.ts`, `x-api/xGraphqlParse.test.fixtures.ts`), and 1 declaration (`xenova-transformers.d.ts`).

`scripts/test-inventory.ts` already walks nested paths under `server/src`, `frontend/src`, `analytics/src`, and `webhook/src` for `*.test.ts` / `*.test.tsx`. `npm test` and `npm run test:unit` run that inventory; `npm run test:unit:list` prints it. Tests stay adjacent to their owners. No barrels.

D5 (unused Voice helpers) and D6 (batch Scout/log) already landed. Those deleted helpers and batch/log routes are not current APIs. Live Scout HTTP is `POST /api/scout/run` (NDJSON) and `GET /api/scout/last`.

Ownership folders under `server/src/`:

| Folder | Owners |
|----------------|-----------------|
| `auth/` | session, OAuth, guards |
| `billing/` | Stripe, quotas, plans |
| `scout/` | collect, cache, gate, run |
| `for-you/` | digest, remix, theme, mail |
| `voice/` | suggest, ingest, post |
| `desk/` | history, interactions, beats |
| `x-api/` | search, tweets, GraphQL parse |
| `http/` | boot composition, JSON, CORS, request context |
| `memory/` | knowledge notes, index |
| `platform/` | env, LLM, file locks, cross-domain test support |

Root keeps `index.ts`, `statsWorker.ts`, `statsWorker.test.ts`, `db.ts`, and `xenova-transformers.d.ts` for PM2 entrypoints and numbered SQL migrations (`server/migrations/`). `tsconfig.server.json` already includes `server/src/**/*.ts`. `ecosystem.config.example.cjs` points `x-copilot-api` at `server/src/index.ts` (or `server/dist/index.js`) and `x-copilot-stats` at `statsWorker`.

## Quick start

```bash
cp .env.example .env
# set X_API_BEARER_TOKEN and DEEPSEEK_API_KEY

npm install
npm run test:x-api     # prove Pay Per Use bearer works
npm run build:server   # emit server/dist for production-shaped runs
npm run dev:server     # tsx watch → http://127.0.0.1:8787
npm run dev            # http://127.0.0.1:5173  (proxies /api → sidecar)
```

Health: `curl http://127.0.0.1:8787/api/health`

**Important:** Vite alone is not enough. If you only run `npm run dev`, Search hits a dead proxy and shows a proxy/500 error. Always run `dev:server` too.

### TypeScript sidecar

| Script | What it runs |
|--------|----------------|
| `npm run dev:server` | `tsx watch server/src/index.ts` |
| `npm run build:server` | `tsc -p tsconfig.server.json` → `server/dist/` |
| `npm run test:x-api` | `tsx scripts/test-x-api.ts` |
| `npm test` / `npm run test:unit` | `tsx scripts/test-inventory.ts run` (recursive `*.test.ts` / `*.test.tsx`) |
| `npm run test:unit:list` | Print the same inventory |
| `npm run test:search -- "query"` | Live recent-search smoke |

UI typecheck stays on root `tsconfig.json` (`noEmit`, include `frontend/src`); the API uses `tsconfig.server.json` (NodeNext emit).

## Official X API

Use a **Pay Per Use** project/app from [console.x.com](https://console.x.com) (not Ads).

| Env var | Role |
|---------|------|
| `X_API_BEARER_TOKEN` | App-only Bearer (keep URL-encoding as issued) |
| `X_API_KEY` / `X_API_SECRET` | Consumer key/secret (optional; stored for OAuth later) |

### Setup

1. Create a Project/App under **Pay Per Use**.
2. Billing → buy credits + set a spending limit.
3. Copy the App **Bearer Token** into `.env` as `X_API_BEARER_TOKEN=...` (do not decode `%2F` / `%2B` / `%3D`).
4. Run:

```bash
npm run test:x-api
```

Expected success looks like:

```
OK via api_bearer_probe
```

If you see HTTP **402**, buy credits. HTTP **401** usually means the bearer was URL-decoded or rotated — paste it again as shown in the console.

Reads use `GET /2/tweets/search/recent` and tweet lookup. Personal tooling only — no mass automation. Desk posting is a click you make after rewriting a suggestion, using your official X login. You are responsible for complying with X’s terms and applicable law.

## Repo layout

| Path | Role |
|------|------|
| `src/` | Vite dashboard (agenda, Scout, threads) |
| `server/src/` | TypeScript sidecar — 237 files in ownership folders (see Server source map) |
| `server/dist/` | Compiled sidecar (gitignored; from `build:server`) |
| `scripts/test-x-api.ts` | CLI X API bearer smoke test |
| `tsconfig.server.json` | Server emit config |
| `pm2-manager.sh` | start/stop/restart/status/logs/setup-logrotate |
| `ecosystem.config.example.cjs` | PM2 template (copy → local `ecosystem.config.cjs`) |
| `.cursor/rules/` | Agent rules (e.g. Graphite stack PRs) |
| `docs/MVP_PLAN.md` | Stream 1 scope |
| `docs/src-operating-guide.md` | Live `src/` owners, boot/session, failure states, and test commands |
| `docs/src-architecture.md` | Wave 0 snapshot only — do not treat Proposed rows as current |
| `docs/PUBLIC_DEPLOY.md` | `api.xcopilot.dev` DNS, bind, TLS |
| `wrangler.toml` | Cloudflare Workers static SPA (`xcopilot.dev`) |
| `.env.example` | Required secrets (no real values) |

## PM2 (prod-shaped API)

One script manages every process. Logs live under `./logs/` (rotated; **never wiped on restart**). Profiles recycle everything or one service.

```bash
cp ecosystem.config.example.cjs ecosystem.config.cjs   # once; gitignored
npm i -g pm2                                           # if needed
./pm2-manager.sh setup-logrotate                       # once: pm2-logrotate defaults
./pm2-manager.sh start                                 # api + stats + analytics
./pm2-manager.sh restart                               # or: ./pm2-manager.sh restart prod
./pm2-manager.sh restart analytics                     # Slack sidecar only
./pm2-manager.sh restart api --skip-build              # reuse server/dist
./pm2-manager.sh status
./pm2-manager.sh logs                                  # tail x-copilot-api
./pm2-manager.sh logs analytics
./pm2-manager.sh stop
```

| Item | Value |
|------|--------|
| Apps | `x-copilot-api` (`:8787`), `x-copilot-stats`, `x-copilot-analytics` (`:8788` loopback) |
| Profiles | `all` / `prod` (default), `api`, `stats`, `analytics` |
| Out / err logs | `logs/<app>.out.log`, `logs/<app>.err.log` |
| Ecosystem | `ecosystem.config.cjs` (from example; **not** tracked) |

`setup-logrotate` sets `pm2-logrotate` to `max_size=10M`, `retain=14`, `compress=true`. Restart/start/stop **do not** truncate `logs/`.

## Cloudflare Workers (SPA)

The dashboard is a static Vite build. Workers holds **no secrets** — the browser picks `http://127.0.0.1:8787` on localhost and `https://api.xcopilot.dev` otherwise (`src/lib/apiBase.ts`).

```bash
npm run deploy:workers   # vite build && npx wrangler deploy
```

Then attach the custom domain `xcopilot.dev` in the Cloudflare dashboard (or `wrangler.toml` `[[routes]]`). There is no `www`. DNS for `api` is a grey-cloud A record to the VPS — see [docs/PUBLIC_DEPLOY.md](docs/PUBLIC_DEPLOY.md).

Sign-in: hamburger menu → **Continue with Google** or **Continue with X**. New accounts land on Free. OAuth redirects hit the API host, then bounce back to this SPA.

## Stream 1 definition of done

- Agenda → Scout → triaged cool thread cards
- Human-in-the-loop posting (rewrite a Suggest draft, then Open on X or post from the desk)
- README documents official X API setup + Pay Per Use credits

## License

MIT — see [LICENSE](LICENSE).
