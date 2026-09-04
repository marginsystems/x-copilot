# Public API + DNS (`api.xcopilot.dev`)

The Node sidecar is the API. Cloudflare Workers host the SPA; they do **not** replace this process. `api` is a grey-cloud (DNS-only) A record to the VPS, so the VPS itself terminates TLS (Let's Encrypt on 443) in front of the API — port 8787 stays bound to loopback and is never exposed on the public internet.

Operational requirement: port 8787 must never be reachable from the public internet. Forwarded headers are trusted from two peer classes: `X-Forwarded-Proto` from loopback (a local TLS terminator / tunnel) for `Secure` cookies, and `CF-Connecting-IP` / `X-Forwarded-For` from Cloudflare IPs. From loopback, `clientIp()` also trusts terminator-set `X-Real-IP` (nginx `$remote_addr`) for session rows and the login rate limiter. It does not trust `X-Forwarded-For` or `CF-Connecting-IP` from loopback — those can keep a client-supplied first hop. Keep 8787 loopback-bound and reach it only through the local TLS terminator.

## Bind

`api` is grey-cloud, so the VPS fronts the API itself. Keep the API on loopback and proxy to it from nginx with a Let's Encrypt cert on 443. The terminator must overwrite `X-Real-IP` before proxying (nginx: `proxy_set_header X-Real-IP $remote_addr;`); Caddy and plain tunnels do not set that header and would forward a client-supplied `X-Real-IP` unchanged, so they must not be used in front of 8787:

```
BIND_HOST=127.0.0.1
PORT=8787
AUTH_REQUIRED=1
ALLOWED_ORIGINS=https://xcopilot.dev
FRONTEND_ORIGIN=https://xcopilot.dev
GOOGLE_REDIRECT_URI=https://api.xcopilot.dev/api/auth/google/callback
X_OAUTH_CALLBACK=https://api.xcopilot.dev/api/auth/x/callback
```

Signup is open (Free plan). A session is still required: public bind always gates, and loopback defaults to gated unless `AUTH_REQUIRED=0`. Set `AUTH_REQUIRED=0` only for break-glass local debugging — never on the deployed `.env`. Keep `ADMIN_EMAILS` for the operator admin panel.

### Keep 8787 off the public internet

`clientIp()` (used for login rate limiting and session IP) trusts `CF-Connecting-IP` / `X-Forwarded-For` only when the direct peer is a Cloudflare IP. From loopback it trusts a single `X-Real-IP` only when the terminator overwrites that header, as nginx does with `proxy_set_header X-Real-IP $remote_addr;`. Any terminator that forwards a client-supplied `X-Real-IP` unchanged (Caddy, cloudflared, SSH tunnels) would let a remote client pick its own rate-limit and session IP, so only a terminator that overwrites the header may sit in front of 8787. A caller that reaches `IP:8787` directly is not a loopback or Cloudflare peer, so its forwarded headers are ignored and it is rate-limited by its own socket IP. Bind 8787 to loopback and reach it only through the local TLS terminator. If you switch `api` to a proxied record instead, keep 8787 firewalled to Cloudflare's published ranges ([`ips-v4`](https://www.cloudflare.com/ips-v4) / [`ips-v6`](https://www.cloudflare.com/ips-v6)).

Keep the server-side copy of these ranges in `server/src/authGuard.ts` in sync
with the published lists — forwarded IPs are trusted only from peers matching
those ranges, and `X-Forwarded-Proto` from those ranges or loopback. If
Cloudflare adds ranges and the copy drifts, requests from the new edge nodes
fall back to the socket address (shared rate buckets) and lose
`X-Forwarded-Proto` trust (no `Secure` cookie).

Restart after `.env` changes: `./pm2-manager.sh restart`.

The analytics sidecar (`analytics/`, process `x-copilot-analytics`) binds **127.0.0.1:8788** only. It is not proxied and must never be reachable from the public internet. The API fire-and-forgets `POST /event` to `ANALYTICS_URL`; a down sidecar or missing Slack webhook does not affect signup, sign-in, or takeoff. Recycle the sidecar alone with `./pm2-manager.sh restart analytics`.

The X Activity webhook process (`webhook/`, process `x-copilot-webhook`) binds
**127.0.0.1:8789** only. Keep the public webhook URL unchanged and route only
that path to the isolated process:

```nginx
location = /api/x/activity {
    proxy_pass http://127.0.0.1:8789;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

Apply this nginx change only after the webhook process is healthy. Until then,
the API keeps serving the same handler on port 8787, including CRC.

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

Scout continues to use the **app-only** `X_API_BEARER_TOKEN` (Pay Per Use). User X login is identity, plus optional desk posting with that user’s stored X tokens when they send a reply.

## Postgres later

Auth + usage tables are numbered SQL under `server/migrations/` (ISO-8601 `TEXT` timestamps). Moving to Supabase/Postgres is a later cutover of `db.ts`, not a new schema.

Privacy, Terms, Search Console, GA4, and Stripe product copy: [LEGAL_LAUNCH.md](./LEGAL_LAUNCH.md).
