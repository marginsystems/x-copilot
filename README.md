# x-copilot

Research + reply assistant for X (Twitter): **session-backed search → DeepSeek analysis → draft replies** in a Vite dashboard. You review and post manually.

**Status:** Stream 1 — TypeScript sidecar + Vite dashboard. Search and draft wiring are next.

## Idea

1. Paste an **agenda** (who/what to engage, voice, avoid list).
2. Pull candidate threads via your own **X session cookies** (For You or query) — not the official paid API.
3. **DeepSeek** ranks relevance and drafts 1–3 reply options.
4. **Copy** a draft and post yourself (no auto-engage in MVP).
5. Optional later: **OpenCode** multi-turn dig on a hard thread.

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
| `server/src/` | TypeScript sidecar (HTTP API + X session) |
| `server/dist/` | Compiled sidecar (gitignored; from `build:server`) |
| `scripts/test-session.ts` | CLI session smoke test |
| `tsconfig.server.json` | Server emit config |
| `.cursor/rules/` | Agent rules (e.g. Graphite stack PRs) |
| `docs/MVP_PLAN.md` | Stream 1 scope |
| `.env.example` | Required secrets (no real values) |

## Stream 1 definition of done

- Agenda → thread cards → DeepSeek draft → copy reply
- Human-in-the-loop posting only
- README documents cookie setup + risks

## License

MIT — see [LICENSE](LICENSE).
