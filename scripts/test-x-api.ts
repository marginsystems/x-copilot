#!/usr/bin/env npx tsx
/**
 * Prove the Pay Per Use app bearer works. No operator identity.
 *
 *   npm run test:x-api
 *
 * Exit 0 on success, 1 on failure. Never prints full token values.
 */
import { resolve } from "node:path";
import { loadEnv } from "../server/src/loadEnv.js";
import { getXApiCredsFromEnv, xApiGet } from "../server/src/xApi.js";

const envPath = resolve(process.cwd(), ".env");
if (!loadEnv(envPath)) {
  console.error("FAIL: no .env file. Run: cp .env.example .env");
  process.exit(1);
}

const creds = getXApiCredsFromEnv();
console.log("x-copilot X API test");
console.log(`  .env:                    ${envPath}`);
console.log(
  `  X_API_BEARER_TOKEN set:  ${Boolean(creds.bearerToken)} (len ${creds.bearerToken.length})`,
);

if (!creds.configured) {
  console.error("\nFAIL: missing X_API_BEARER_TOKEN in .env");
  console.error("See README → Official X API");
  process.exit(1);
}

const result = await xApiGet({
  path: "/users/by/username/X",
  query: { "user.fields": "username" },
  creds,
  skipUsage: true,
});

if (!result.ok) {
  console.error(`\nFAIL: ${result.error} (HTTP ${result.status})`);
  if (result.message) console.error(`  ${result.message}`);
  if (result.status === 402) {
    console.error("  Buy Pay Per Use credits in console.x.com → Billing.");
  }
  process.exit(1);
}

console.log("\nOK via api_bearer_probe");
process.exit(0);
