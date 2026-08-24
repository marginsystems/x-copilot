# x-copilot

Independent research + triage desk for posting on X. **Not affiliated with, endorsed by, or part of X Corp.**

**Live:** [xcopilot.dev](https://xcopilot.dev)

Official X API search → DeepSeek triage in a Vite dashboard. Scout finds cool threads worth a human reply — no AI-written reply drafts.

**Status:** Stream 1 — agenda → DeepSeek Chat queries → recent search (official X API) → triaged thread cards (Start/Stop Scout).

## Idea

1. Paste an **agenda** (who/what to engage, voice, avoid list).
2. **DeepSeek Chat** expands the agenda into 2–4 short X search queries (one LLM call).
3. Sidecar runs those queries via the official X API **recent search** (`GET /2/tweets/search/recent`, app-only bearer).
4. A second DeepSeek call **triages** the results (summary + bait risk + engage hint).
5. Review cool thread cards, **Open on X**, and reply yourself (no auto-engage; no AI draft replies).

## Thread triage

After search, `POST /api/search` sends the returned threads (max 20) to DeepSeek in **one batched call** and enriches each card with:

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

**Mark interacted** records the thread + author in a local sidecar file `data/interactions.json` (gitignored). For the next **24 hours**, later searches drop other posts from that same `@handle` *before* triage, so we do not keep hammering the same account or waste DeepSeek tokens on them. The search status line reports how many posts were filtered. Restarting the sidecar keeps the cooldown (file persist).

The same action also writes an Obsidian-friendly Markdown note under **`knowledge/interactions/`** (gitignored) that includes the thread context and the **reply you typed on X** (`POST /api/interacted` requires `reply`). Point Obsidian at the `knowledge/` folder to browse agent memories locally — never commit that directory.

The last successful Scout run is also cached in memory and `data/last-scout.json` (gitignored). On dashboard load, `GET /api/scout/last` restores Threads / queries (cooled-down authors filtered out) so a reload or API restart does not wipe the list.

Scout stage lines are appended to `data/scout-log.json` (gitignored; last 1000) via `GET/POST /api/scout/log` and shown in the Scout strip with time-ago + 100-line pages.

## Length filter

Before triage, posts with more than **480** characters (or obvious `N/M` thread openers like `1/17 …`) are dropped so walls of text never reach DeepSeek or the accordion. The same cap applies to the **hydrated parent** a reply sits under. Override with `X_MAX_THREAD_CHARS` in `.env`, or via **Settings → Max post characters** — the UI sends `filters` on each Scout run and wins over env for that request. **X Articles and replies to them** are hard-dropped by default when the payload marks an article (`tweet.fields=article`, or leftover GraphQL article nodes). When a **note tweet** body is present, that text is used for the char cap instead of the short `full_text` teaser. The search status line reports how many were dropped.

## Scout

**Scout** is x-copilot’s search mini-agent. Use **Start Scout** / **Stop Scout** on the dashboard. Flow:

1. Plan queries (DeepSeek), then pace X recent search (**20** hits/query).
2. **Hard-filter bucket** (cooldown + Article/char/links/self-reply) with **no LLM** until the bucket has **K** candidates (UI sends `bucketSize: 20`; server accepts 5|10|20). Keep searching / cycling queries (one replan, search budget) while the bucket is short.
3. **LLM-qualify** the full bucket. Cool = `engage` `priority`/`consider` and `baitScore ≤ 45`.
4. Keep cool threads and refill until **Cool threads** target (`targetCool`, 1–20) or supply is exhausted. If a full bucket yields **0 cool**, discard and refill. Budget/Stop → `exhausted` / `aborted`; hit target → `stopReason: target`.

Status shows `Candidates n/K` while filling and `Cool n/target` as cools accumulate. Prefer `POST /api/scout/run` (NDJSON; `done` includes `coolCount`, `bucketSize`, `stopReason`, threads, `opencodeTurns`). `POST /api/search` remains a non-streaming batch JSON fallback. Sessions are rate-limited: one run at a time, then a **15s** cooldown (UI + sidecar `429`) before the next Start — Stop does not bypass that gate.

## Architecture

```
Vite UI  →  local Node sidecar  →  X API v2 (app-only bearer)
                 ↓
              DeepSeek v4-flash
```

Bearer token and LLM keys stay in `.env` on the sidecar. The browser never stores credentials. Public DNS + bind notes: [docs/PUBLIC_DEPLOY.md](docs/PUBLIC_DEPLOY.md).

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
| `npm test` | Unit tests (`node:test` via tsx) |
| `npm run test:search -- "query"` | Live recent-search smoke |

UI typecheck stays on root `tsconfig.json` (`noEmit`); the API uses `tsconfig.server.json` (NodeNext emit).

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

Reads use `GET /2/tweets/search/recent` and tweet lookup. Personal tooling only — no mass automation, no auto-posting in this MVP. You are responsible for complying with X’s terms and applicable law.

## Repo layout

| Path | Role |
|------|------|
| `src/` | Vite dashboard (agenda, Scout, threads) |
| `server/src/` | TypeScript sidecar (HTTP API + X API v2 + recent search) |
| `server/dist/` | Compiled sidecar (gitignored; from `build:server`) |
| `scripts/test-x-api.ts` | CLI X API bearer smoke test |
| `tsconfig.server.json` | Server emit config |
| `pm2-manager.sh` | start/stop/restart/status/logs/setup-logrotate |
| `ecosystem.config.example.cjs` | PM2 template (copy → local `ecosystem.config.cjs`) |
| `.cursor/rules/` | Agent rules (e.g. Graphite stack PRs) |
| `docs/MVP_PLAN.md` | Stream 1 scope |
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
- Human-in-the-loop posting only (Open on X; no AI reply drafts)
- README documents official X API setup + Pay Per Use credits

## License

MIT — see [LICENSE](LICENSE).
