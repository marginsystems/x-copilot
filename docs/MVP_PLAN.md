# x-copilot — Stream 1 MVP

See also the Cursor canvas: `x-copilot-livestream-mvp.canvas.tsx`.

## Goal

Ship a demoable loop in ~2 hours on stream:

**Agenda → session search / For You → thread cards → DeepSeek triage → human reply on X.**

## In scope

- Vite + React dashboard
- TypeScript sidecar holding `X_AUTH_TOKEN` + `X_CT0` (PM2 via `./pm2-manager.sh` for prod-shaped deploys)
- Search or timeline pull → normalized thread cards
- DeepSeek triage (summary, bait risk, engage hint)
- Mark interacted / author cooldown

## Out of scope

- Official X API
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
