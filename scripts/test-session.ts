#!/usr/bin/env npx tsx
/**
 * Basic X session test — loads .env and calls GraphQL Viewer verify.
 *
 *   npm run test:session
 *
 * Exit 0 on success, 1 on failure. Never prints full cookie values.
 */
import { resolve } from "node:path";
import { loadEnv } from "../server/src/loadEnv.js";
import { getSessionFromEnv, verifySession } from "../server/src/xSession.js";

const envPath = resolve(process.cwd(), ".env");
if (!loadEnv(envPath)) {
  console.error("FAIL: no .env file. Run: cp .env.example .env");
  process.exit(1);
}

const session = getSessionFromEnv();
console.log("x-copilot session test");
console.log(`  .env:              ${envPath}`);
console.log(
  `  X_AUTH_TOKEN set:  ${Boolean(session.authToken)} (len ${session.authToken.length})`,
);
console.log(
  `  X_CT0 set:         ${Boolean(session.ct0)} (len ${session.ct0.length})`,
);

if (!session.configured) {
  console.error("\nFAIL: missing X_AUTH_TOKEN and/or X_CT0 in .env");
  console.error("See README → Session cookies");
  process.exit(1);
}

let result;
try {
  result = await verifySession(session);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\nFAIL: ${message}`);
  process.exit(1);
}
if (!result.ok) {
  console.error(`\nFAIL: ${result.message || result.error}`);
  if (result.status) console.error(`  HTTP ${result.status}`);
  process.exit(1);
}

console.log("\nOK: session verified");
console.log(`  method: ${result.method}`);
console.log(`  @${result.user.screen_name} (${result.user.name})`);
if (result.user.id) console.log(`  id ${result.user.id}`);
if (result.warning) console.warn(`  warning: ${result.warning}`);
process.exit(0);
