# x-copilot

Research + reply assistant for X (Twitter): **session-backed search → DeepSeek analysis → draft replies** in a Vite dashboard. You review and post manually.

**Status:** Stream 1 — agenda → DeepSeek Chat queries → session SearchTimeline → triaged thread cards. Draft API still stub.

## Idea

1. Paste an **agenda** (who/what to engage, voice, avoid list).
2. **DeepSeek Chat** expands the agenda into 2–4 short X search queries (one LLM call).
3. Sidecar runs those queries via session-backed **SearchTimeline** (not the official paid API).
4. A second DeepSeek call **triages** the results (summary + bait risk) so bait never reaches a draft.
5. Review thread cards; **draft** replies come next (stub for now).
6. **Copy** and post yourself (no auto-engage in MVP).

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

**Mark interacted** (or **Copy reply**) records the thread + author in a local sidecar file `data/interactions.json` (gitignored). For the next **24 hours**, later searches drop other posts from that same `@handle` *before* triage, so we do not keep hammering the same account or waste DeepSeek tokens on them. The search status line reports how many posts were filtered. Restarting the sidecar keeps the cooldown (file persist).

## Length filter

Before triage, posts with more than **480** characters (or obvious `N/M` thread openers like `1/17 …`) are dropped so walls of text never reach DeepSeek or the accordion. Override with `X_MAX_THREAD_CHARS` in `.env`. The search status line reports how many were dropped.

## Scout

**Scout** is x-copilot’s search mini-agent. The UI activity strip shows live stages while Scout plans queries, searches X, filters, and triages. Prefer `POST /api/scout/run` (NDJSON stream of `{ agent: "scout", stage, message, … }` lines, final `done` includes threads + `opencodeTurns`). `POST /api/search` remains a non-streaming JSON fallback. `opencodeTurns` is a thin structured agent log (not a full OpenCode CLI session).

## Architecture

```
Vite UI  →  local Node sidecar  →  X (session cookie)
                 ↓
              DeepSeek API
```

Cookies and API keys stay in `.env` on the sidecar. The browser never stores the session.

## Quick start

```bash
cp .env.example .env
# set X_AUTH_TOKEN + X_CT0 (see below), optional DEEPSEEK_API_KEY

npm install
npm run test:session   # prove cookies work (GraphQL Viewer)
npm run build:server   # emit server/dist for production-shaped runs
npm run dev:server     # tsx watch → http://127.0.0.1:8787
npm run dev            # http://127.0.0.1:5173  (proxies /api → sidecar)
```

Health: `curl http://127.0.0.1:8787/api/health`  
Session: `curl http://127.0.0.1:8787/api/session/verify`

**Important:** Vite alone is not enough. If you only run `npm run dev`, Search hits a dead proxy and shows a proxy/500 error. Always run `dev:server` too.

### TypeScript sidecar

| Script | What it runs |
|--------|----------------|
| `npm run dev:server` | `tsx watch server/src/index.ts` |
| `npm run build:server` | `tsc -p tsconfig.server.json` → `server/dist/` |
| `npm run test:session` | `tsx scripts/test-session.ts` |
| `npm test` | Unit tests (`node:test` via tsx) |
| `npm run test:search -- "query"` | Live SearchTimeline smoke |

UI typecheck stays on root `tsconfig.json` (`noEmit`); the API uses `tsconfig.server.json` (NodeNext emit).

## Session cookies

Use **your own** logged-in browser session. We need two cookie values:

| Cookie | Env var | Role |
|--------|---------|------|
| `auth_token` | `X_AUTH_TOKEN` | Session identity |
| `ct0` | `X_CT0` | CSRF token (also sent as `x-csrf-token`) |

### How to copy them (Chrome / Edge / Brave)

1. Log into [https://x.com](https://x.com) in a normal browser tab.
2. Open DevTools → **Application** → **Cookies** → `https://x.com`.
3. Find `auth_token` → copy **Value** into `.env` as `X_AUTH_TOKEN=...`
4. Find `ct0` → copy **Value** into `.env` as `X_CT0=...`
5. Save `.env` (never commit it) and run:

```bash
npm run test:session
```

Expected success looks like:

```
OK: session verified
  @yourhandle (Your Name)
  id 123456789
```

If it fails with 401/403, log out/in on x.com and re-copy **both** cookies (they rotate).

### What the test hits

Read-only GraphQL `Viewer` (with `badge_count` fallback) using your cookies + the public web-client bearer. No posts.

If Viewer starts 404ing after an X web deploy, refresh `X_VIEWER_QUERY_ID` in `.env` (query IDs rotate).

This path is **experimental**: X can change shapes, rate-limit, or lock accounts. Personal tooling only — no mass automation, no auto-posting in this MVP. You are responsible for complying with X’s terms and applicable law.

## Repo layout

| Path | Role |
|------|------|
| `src/` | Vite dashboard (agenda, threads, draft) |
| `server/src/` | TypeScript sidecar (HTTP API + X session + SearchTimeline) |
| `server/dist/` | Compiled sidecar (gitignored; from `build:server`) |
| `scripts/test-session.ts` | CLI session smoke test |
| `tsconfig.server.json` | Server emit config |
| `pm2-manager.sh` | start/stop/restart/status/logs/setup-logrotate |
| `ecosystem.config.example.cjs` | PM2 template (copy → local `ecosystem.config.cjs`) |
| `.cursor/rules/` | Agent rules (e.g. Graphite stack PRs) |
| `docs/MVP_PLAN.md` | Stream 1 scope |
| `.env.example` | Required secrets (no real values) |

## PM2 (prod-shaped API)

The sidecar can run under PM2 with logs under `./logs/` (rotated; **never wiped on restart**).

```bash
cp ecosystem.config.example.cjs ecosystem.config.cjs   # once; gitignored
npm i -g pm2                                           # if needed
./pm2-manager.sh setup-logrotate                       # once: pm2-logrotate defaults
./pm2-manager.sh start                                 # build:server + start x-copilot-api
./pm2-manager.sh restart                               # or: ./pm2-manager.sh restart prod
./pm2-manager.sh restart --skip-build                  # reuse server/dist
./pm2-manager.sh status
./pm2-manager.sh logs                                  # tail x-copilot-api
./pm2-manager.sh stop
```

| Item | Value |
|------|--------|
| App name | `x-copilot-api` |
| Port | `8787` (bind `127.0.0.1` in server) |
| Out log | `logs/x-copilot-api.out.log` |
| Err log | `logs/x-copilot-api.err.log` |
| Ecosystem | `ecosystem.config.cjs` (from example; **not** tracked) |

`setup-logrotate` sets `pm2-logrotate` to `max_size=10M`, `retain=14`, `compress=true`. Restart/start/stop **do not** truncate `logs/`.

## Stream 1 definition of done

- Agenda → thread cards → DeepSeek draft → copy reply
- Human-in-the-loop posting only
- README documents cookie setup + risks

## License

MIT — see [LICENSE](LICENSE).
