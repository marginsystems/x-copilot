# Public API + DNS (`api.xcopilot.dev`)

The Node sidecar is the API. Cloudflare Workers will host the SPA; they do **not** replace this process. Do not expose port 8787 on the public internet without TLS in front (Cloudflare orange-cloud proxy or a tunnel).

## Bind

Default remains loopback:

```
BIND_HOST=127.0.0.1
PORT=8787
```

For Cloudflare to reach the origin:

```
BIND_HOST=0.0.0.0
AUTH_REQUIRED=1
AUTH_EMAIL_WHITELIST=margin707@gmail.com
ALLOWED_ORIGINS=https://xcopilot.dev,https://www.xcopilot.dev
FRONTEND_ORIGIN=https://xcopilot.dev
GOOGLE_REDIRECT_URI=https://api.xcopilot.dev/api/auth/google/callback
X_OAUTH_CALLBACK=https://api.xcopilot.dev/api/auth/x/callback
```

`AUTH_REQUIRED` is implied when a whitelist is set **or** `BIND_HOST` is `0.0.0.0`; `AUTH_REQUIRED=0` cannot override the public bind, so the session gate stays on. Set `AUTH_REQUIRED=0` only for break-glass local debugging on the loopback bind — never on the public bind.

### Restrict the origin port to Cloudflare

The API trusts `CF-Connecting-IP` / `X-Forwarded-For` only when the direct peer is a Cloudflare IP (otherwise it falls back to the socket address for rate limiting). Anyone who can reach `IP:8787` directly can spoof those headers and bypass the login rate limiter, so the VPS firewall must allow 8787 only from Cloudflare's published ranges:

- [`https://www.cloudflare.com/ips-v4`](https://www.cloudflare.com/ips-v4)
- [`https://www.cloudflare.com/ips-v6`](https://www.cloudflare.com/ips-v6)

Example (ufw):

```
ufw allow from 173.245.48.0/20 to any port 8787 proto tcp
ufw allow from 104.16.0.0/13 to any port 8787 proto tcp
ufw allow from 2400:cb00::/32 to any port 8787 proto tcp
ufw deny 8787
```

Restart after `.env` changes: `./pm2-manager.sh restart`.

## Cloudflare DNS (zone `xcopilot.dev`)

| Name | Type | Content | Proxy | When |
|------|------|---------|-------|------|
| `api` | A | `159.223.169.152` (this VPS) | Proxied (orange cloud) | **Now**, before prod OAuth redirects |
| `@` | Workers custom domain | SPA | Proxied | After `npm run deploy:workers` + attach `xcopilot.dev` |
| `www` | CNAME `@` or Workers route | SPA | Proxied | Same as apex |

Deploy the SPA (no secrets in the Worker):

```bash
npm run deploy:workers
```

`wrangler.toml` serves Vite `dist/` as a single-page app. Attach custom domains in the Cloudflare dashboard once the Worker exists.

SSL/TLS mode: **Full (strict)** once the origin has a valid cert, or **Full** behind Cloudflare while using the proxy. Enable **WebSockets** off (not needed). Keep **Always Use HTTPS** on.

OAuth callback hosts are the **API**, not the SPA:

- `https://api.xcopilot.dev/api/auth/google/callback`
- `https://api.xcopilot.dev/api/auth/x/callback`

Local aliases stay on `http://127.0.0.1:8787/api/auth/...`.

## What stays private

Google client secret, X consumer secret, X bearer, and LLM keys live in the API `.env` only. The SPA and Workers must not receive them.

Scout continues to use the **app-only** `X_API_BEARER_TOKEN` (Pay Per Use). User X login is identity only.

## Postgres later

Auth + usage tables are numbered SQL under `server/migrations/` (ISO-8601 `TEXT` timestamps). Moving to Supabase/Postgres is a later cutover of `db.ts`, not a new schema.
