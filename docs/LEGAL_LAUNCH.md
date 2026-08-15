# Legal, Search Console, Analytics, Stripe

Operator steps that cannot live in git. Product copy below matches `server/src/plans.ts`.

These Privacy / Terms pages are MVP templates, not a lawyer sign-off.

## Mail

`contact@mergestorm.ai` is the public inbox (same as mergestorm.ai). Confirm it receives mail before launch.

## Google Search Console

1. [Search Console](https://search.google.com/search-console) → Add property → **URL prefix** `https://xcopilot.dev`
2. Verify with a **DNS TXT** record on the `xcopilot.dev` zone (no deploy). HTML-file or meta-tag also work.
3. Meta-tag path: put the verification string in `VITE_GSC_VERIFICATION` and `npm run deploy:workers`.
4. Sitemaps → submit `https://xcopilot.dev/sitemap.xml` (`/`, `/privacy`, `/terms`).
5. Request indexing on `/` after the first deploy that includes those URLs.

## Google Analytics 4

1. Create a **separate** GA4 property named `x-copilot` (do not reuse the mergestorm.ai Measurement ID unless you intend one property for both products).
2. Web stream URL: `https://xcopilot.dev`
3. Copy the Measurement ID (`G-…`) into the **SPA build** env:

```bash
export VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
npm run deploy:workers
```

The site loads gtag only after the visitor accepts analytics. Consent Mode defaults to denied. Leave the var empty and no GA script is injected.

## Stripe (Mergestorm, Inc.)

Use the same Stripe account as mergestorm.ai if you want. Keep x-copilot prices in their own products so the Customer Portal does not list Mergestorm plans.

### Business profile (required for Checkout ToS)

Settings → Public business information (or Checkout settings):

- Terms of service: `https://xcopilot.dev/terms`
- Privacy policy: `https://xcopilot.dev/privacy`
- Statement descriptor: `MERGESTORM` or `XCOPILOT` (≤22 chars)

Checkout will fail with `consent_collection.terms_of_service` until the ToS URL is set on the account.

### Products — create three, recurring monthly USD

| Dashboard product name | Price | In-app name | Credits / UTC month | Takeoffs / UTC day |
|---|---|---|---|---|
| x-copilot Pulse | $12 | Pulse | 1,500 | 4 |
| x-copilot Radar | $36 | Radar | 6,000 | 8 |
| x-copilot Horizon | $99 | Horizon | 20,000 | 20 |

**x-copilot Pulse** — description to paste:

> Monthly x-copilot desk from Mergestorm, Inc. 1,500 X post-read credits per UTC month and 4 Scout takeoffs per day. Unused credits do not roll over. You review and post on X yourself — no auto-engage.

**x-copilot Radar** — description to paste:

> Monthly x-copilot desk from Mergestorm, Inc. 6,000 X post-read credits per UTC month and 8 Scout takeoffs per day. Unused credits do not roll over. You review and post on X yourself — no auto-engage.

**x-copilot Horizon** — description to paste:

> Monthly x-copilot desk from Mergestorm, Inc. 20,000 X post-read credits per UTC month and 20 Scout takeoffs per day. Unused credits do not roll over. You review and post on X yourself — no auto-engage.

Each price: **Recurring → Monthly → USD**. Copy the `price_…` IDs into the sidecar `.env`:

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PULSE=price_...
STRIPE_PRICE_RADAR=price_...
STRIPE_PRICE_HORIZON=price_...
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
```

Optional test-mode twins: `STRIPE_PRICE_*_DEV`.

### Webhook

Endpoint: `https://api.xcopilot.dev/api/stripe/webhook`

Events:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

### Customer Portal

Create a portal configuration that lists **only** these three prices (so mergestorm.ai plans stay off this desk). Put the `bpc_…` id in `STRIPE_PORTAL_CONFIGURATION_ID`.

Then `./pm2-manager.sh restart` on the VPS.

## After merge

Redeploy the SPA so `/privacy`, `/terms`, the sitemap, and the cookie banner are live. Checkout stays dark until the Stripe keys above are on the sidecar.
