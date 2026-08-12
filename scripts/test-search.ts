#!/usr/bin/env npx tsx
/**
 * Live recent-search smoke test.
 *
 *   npm run test:search -- "AI tools"
 */
import { resolve } from "node:path";
import { loadEnv } from "../server/src/loadEnv.ts";
import { getSessionFromEnv } from "../server/src/xSession.ts";
import { searchTimeline } from "../server/src/xSearch.ts";

const envPath = resolve(process.cwd(), ".env");
if (!loadEnv(envPath)) {
  console.error("FAIL: no .env file");
  process.exit(1);
}

const query = (process.argv.slice(2).join(" ") || "AI tools").trim();
const session = getSessionFromEnv();
console.log("x-copilot search test");
console.log(`  query: ${query}`);
console.log(`  api: ${session.configured}`);

if (!session.bearerToken) {
  console.error("FAIL: missing X_API_BEARER_TOKEN");
  process.exit(1);
}

const result = await searchTimeline({ query, count: 5, product: "Latest" });
if (!result.ok) {
  console.error(`FAIL: ${result.message}`);
  process.exit(1);
}

console.log(`\nOK: ${result.threads.length} threads (queryId ${result.queryId})`);
for (const t of result.threads.slice(0, 5)) {
  console.log(`  ${t.author}: ${t.text.slice(0, 80).replace(/\n/g, " ")}`);
}
process.exit(0);
