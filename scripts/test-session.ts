#!/usr/bin/env npx tsx
/**
 * Basic X API test — loads .env and verifies the Pay Per Use bearer.
 *
 *   npm run test:session
 *
 * Exit 0 on success, 1 on failure. Never prints full token values.
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
console.log("x-copilot X API test");
console.log(`  .env:                    ${envPath}`);
console.log(
  `  X_API_BEARER_TOKEN set:  ${Boolean(session.bearerToken)} (len ${session.bearerToken.length})`,
);
console.log(
  `  X_OPERATOR_USERNAME:     ${session.operatorUsername || "(unset)"}`,
);

if (!session.configured) {
  console.error("\nFAIL: missing X_API_BEARER_TOKEN in .env");
  console.error("See README → Official X API");
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
  console.error(`\nFAIL: ${result.error} (HTTP ${result.status})`);
  if (result.message) console.error(`  ${result.message}`);
  if (result.status === 402) {
    console.error("  Buy Pay Per Use credits in console.x.com → Billing.");
  }
  process.exit(1);
}

console.log(`\nOK via ${result.method}`);
console.log(`  @${result.user.screen_name} (id=${result.user.id || "n/a"})`);
if (result.warning) console.log(`  warning: ${result.warning}`);
process.exit(0);
