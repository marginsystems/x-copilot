# x-copilot — Stream 1 MVP

See also the Cursor canvas: `x-copilot-livestream-mvp.canvas.tsx`.

## Goal

Ship a demoable loop in ~2 hours on stream:

**Agenda → session search / For You → thread cards → DeepSeek drafts → copy reply (manual post).**

## In scope

- Vite + React dashboard
- Local Node sidecar holding `X_AUTH_TOKEN` + `X_CT0`
- Search or timeline pull → normalized thread cards
- DeepSeek relevance + draft replies
- Copy-to-clipboard

## Out of scope

- Official X API
- Auto-like / auto-reply / mass DMs
- Browser extension
- Multi-account / proxies
- OpenCode as the default path (stretch only)
- SaaS / billing

## Stretch

- OpenCode multi-turn exploration on one selected thread
- Better ranking UI (score chips, filters)
- Fixture tests for X response shape drift
