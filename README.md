# x-copilot

Research + reply assistant for X (Twitter): **session-backed search → DeepSeek analysis → draft replies** in a Vite dashboard. You review and post manually.

**Status:** Stream 1 scaffold — dashboard shell + local sidecar stubs. Search and draft wiring are next.

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
# set X_AUTH_TOKEN, X_CT0, DEEPSEEK_API_KEY

npm install
npm run dev:server   # http://127.0.0.1:8787
npm run dev          # http://127.0.0.1:5173  (proxies /api → sidecar)
```

Health check: `curl http://127.0.0.1:8787/api/health`

## Session cookies

Use **your own** browser session (`auth_token` + `ct0`). Keep them local. Never commit `.env`.

This path is **experimental**: X can change shapes, rate-limit, or lock accounts. Personal tooling only — no mass automation, no auto-posting in this MVP. You are responsible for complying with X’s terms and applicable law.

## Repo layout

| Path | Role |
|------|------|
| `src/` | Vite dashboard (agenda, threads, draft) |
| `server/` | Local sidecar (session + DeepSeek; stubs for now) |
| `docs/MVP_PLAN.md` | Stream 1 scope |
| `.env.example` | Required secrets (no real values) |

## Stream 1 definition of done

- Agenda → thread cards → DeepSeek draft → copy reply
- Human-in-the-loop posting only
- README documents cookie setup + risks

## License

MIT — see [LICENSE](LICENSE).
