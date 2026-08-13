# Public API + DNS (`api.xcopilot.dev`)

The Node sidecar is the API. Cloudflare Workers host the SPA; they do **not** replace this process. `api` is a grey-cloud (DNS-only) A record to the VPS, so the VPS itself terminates TLS (Let's Encrypt on 443) in front of the API — port 8787 stays bound to loopback and is never exposed on the public internet.

Operational requirement: port 8787 must never be reachable from the public internet. Forwarded headers are trusted from only two peer classes: `X-Forwarded-Proto` from loopback (a local TLS terminator / tunnel) for `Secure` cookies, and `CF-Connecting-IP` / `X-Forwarded-For` from Cloudflare IPs. Loopback is never trusted for the forwarded IP used by the login rate limiter, so under this grey-cloud topology every request arrives with peer `127.0.0.1` and `clientIp()` returns `127.0.0.1` for all users — the login rate limiter becomes one shared bucket for the whole deployment. Keep 8787 loopback-bound and reach it only through the local TLS terminator.

## Bind

`api` is grey-cloud, so the VPS fronts the API itself. Keep the API on loopback and proxy to it from a local TLS terminator (e.g. Caddy/nginx with a Let's Encrypt cert on 443):

```
BIND_HOST=127.0.0.1
PORT=8787
AUTH_REQUIRED=1
AUTH_EMAIL_WHITELIST=margin707@gmail.com
ALLOWED_ORIGINS=https://xcopilot.dev
FRONTEND_ORIGIN=https://xcopilot.dev
GOOGLE_REDIRECT_URI=https://api.xcopilot.dev/api/auth/google/callback
X_OAUTH_CALLBACK=https://api.xcopilot.dev/api/auth/x/callback
```

`AUTH_REQUIRED` is implied when a whitelist is set **or** `BIND_HOST` is `0.0.0.0`; `AUTH_REQUIRED=0` cannot override the public bind, so the session gate stays on. Set `AUTH_REQUIRED=0` only for break-glass local debugging — never on the public bind.

### Keep 8787 off the public internet

`clientIp()` (used for login rate limiting) trusts `CF-Connecting-IP` / `X-Forwarded-For` only when the direct peer is a Cloudflare IP; loopback peers are not trusted, so behind the local TLS terminator every request is seen as `127.0.0.1` and the login rate limiter is effectively a single global bucket (20 login starts per 10 minutes for the whole deployment). A caller that reaches `IP:8787` directly is not a Cloudflare peer, so its forwarded headers are ignored and it is rate-limited by its own socket IP — per-IP protection is lost behind the terminator, not via header spoofing. If a per-IP limit is needed, key it on a header the TLS terminator sets itself (e.g. `X-Real-IP`). Bind 8787 to loopback and reach it only through the local TLS terminator. If you switch `api` to a proxied record instead, keep 8787 firewalled to Cloudflare's published ranges ([`ips-v4`](https://www.cloudflare.com/ips-v4) / [`ips-v6`](https://www.cloudflare.com/ips-v6)).

Keep the server-side copy of these ranges in `server/src/authGuard.ts` in sync
with the published lists — forwarded IPs are trusted only from peers matching
those ranges, and `X-Forwarded-Proto` from those ranges or loopback. If
Cloudflare adds ranges and the copy drifts, requests from the new edge nodes
fall back to the socket address (shared rate buckets) and lose
`X-Forwarded-Proto` trust (no `Secure` cookie).

Restart after `.env` changes: `./pm2-manager.sh restart`.

## Cloudflare DNS (zone `xcopilot.dev`)

| Name | Type | Content | Proxy | When |
|------|------|---------|-------|------|
| `api` | A | `159.223.169.152` (this VPS) | DNS only (grey cloud) — VPS terminates Let's Encrypt TLS on 443 | **Now**, before prod OAuth redirects |
| `@` | Workers custom domain | SPA | Proxied | After `npm run deploy:workers` + attach `xcopilot.dev` |

Deploy the SPA (no secrets in the Worker):

```bash
npm run deploy:workers
```

`wrangler.toml` serves Vite `dist/` as a single-page app. Attach custom domains in the Cloudflare dashboard once the Worker exists.

`api` is DNS-only, so its TLS is the VPS's own Let's Encrypt cert (Cloudflare's proxy SSL/TLS mode does not apply to it). Enable **WebSockets** off (not needed). Keep **Always Use HTTPS** on.

OAuth callback hosts are the **API**, not the SPA:

- `https://api.xcopilot.dev/api/auth/google/callback`
- `https://api.xcopilot.dev/api/auth/x/callback`

Local aliases stay on `http://127.0.0.1:8787/api/auth/...`.

## What stays private

Google client secret, X consumer secret, X bearer, and LLM keys live in the API `.env` only. The SPA and Workers must not receive them.

Scout continues to use the **app-only** `X_API_BEARER_TOKEN` (Pay Per Use). User X login is identity only.

## Postgres later

Auth + usage tables are numbered SQL under `server/migrations/` (ISO-8601 `TEXT` timestamps). Moving to Supabase/Postgres is a later cutover of `db.ts`, not a new schema.
