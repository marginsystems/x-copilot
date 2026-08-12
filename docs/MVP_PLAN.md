# x-copilot — Stream 1 MVP

See also the Cursor canvas: `x-copilot-livestream-mvp.canvas.tsx`.

## Goal

Ship a demoable loop in ~2 hours on stream:

**Agenda → official X API search → thread cards → LLM triage → human reply on X.**

## In scope

- Vite + React dashboard
- TypeScript sidecar holding `X_API_BEARER_TOKEN` (PM2 via `./pm2-manager.sh` for prod-shaped deploys)
- Search or timeline pull → normalized thread cards
- LLM triage (summary, bait risk, engage hint)
- Mark interacted / author cooldown

## Out of scope

- Session-cookie GraphQL (deprecated — use Pay Per Use API)
- AI-generated reply drafts / copy-paste reply helpers
- Auto-like / auto-reply / mass DMs
- Browser extension
- Multi-account / proxies
- OpenCode as the default path (stretch only)
- SaaS / billing

## Stretch

- OpenCode multi-turn exploration on one selected thread
- Better ranking UI (score chips, filters)
- Fixture tests for X response shape drift
