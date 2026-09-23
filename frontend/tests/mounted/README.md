# Mounted UI tests

Run from the repository root after `npm ci` (Node 22, matching CI):

| Command | Scope |
| --- | --- |
| `npm test` / `npm run test:unit` | Existing `tsx --test` node suite, with its original discovery patterns unchanged |
| `npm run test:mounted` | Only `frontend/tests/mounted/**/*.test.{ts,tsx}`, recursively |
| `npm run test:mounted:list` | List mounted tests without executing them |
| `npm run typecheck:mounted` | Strict typecheck of mounted tests, support, and configuration |

The mounted suite uses Vitest 3 (compatible with the existing Vite 5), jsdom,
React Testing Library, and user-event. It mounts real React hooks/components,
runs effects, and dispatches DOM input/keyboard interactions. It does **not**
launch a browser or the Vite application server. jsdom does not establish real
browser layout, scrolling, or focus containment; those need future browser tests.
The separate config does not load the application Vite plugins or API proxy.
CI runs both `npm run test:unit` and `npm run test:mounted`. The live command
matrix is `docs/src-operating-guide.md`.

If installing with `--omit=optional` to skip Transformers, restore the matching
Rollup/esbuild native packages using the procedure in `.github/workflows/ci.yml`.
These binaries are also needed by the existing build/unit tooling.

## Adding a test

Keep mounted tests in this tree; keep existing `node:test` files in their current
source trees. Do not import `node:test` into this suite. Use `render`/`renderHook`
and `rerender`/`unmount` from React Testing Library. Use `userEvent.setup()` for
interactions and `act()` around manually resolved async work or clock advances.

`support/setup.ts` unmounts React roots before restoring fake clocks, spies, and
stubbed globals after every test, including failures. It clears storage and rejects
unexpected fetches so tests cannot silently call live APIs. Stub fetch with
`vi.stubGlobal("fetch", ...)`; use `support/deferred.ts` for controlled responses.
Resolve or reject every deferred request you start. Use `vi.useFakeTimers()` and
`vi.setSystemTime()` for clocks; when combining clocks with user-event, pass
`{ advanceTimers: vi.advanceTimersByTime }` to `userEvent.setup`.

The billing example verifies StrictMode effect replay, a rerender, a deferred
response, and cancellation of the rearmed timer on unmount. The dismissal example
verifies controlled typing, keyboard confirmation, busy-state suppression, and
pointer cancellation against the production component. No application behavior is
changed by these tests.
