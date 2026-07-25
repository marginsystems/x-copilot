#!/usr/bin/env node
/**
 * Basic X session test — loads .env and calls verify_credentials.
 *
 *   npm run test:session
 *
 * Exit 0 on success, 1 on failure. Never prints full cookie values.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getSessionFromEnv, verifySession } from "../server/xSession.mjs";

function loadEnv(path) {
  if (!existsSync(path)) return false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    const key = trimmed.slice(0, i).trim();
    let val = trimmed.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
  return true;
}

const envPath = resolve(process.cwd(), ".env");
if (!loadEnv(envPath)) {
  console.error("FAIL: no .env file. Run: cp .env.example .env");
  process.exit(1);
}

const session = getSessionFromEnv();
console.log("x-copilot session test");
console.log(`  .env:              ${envPath}`);
console.log(`  X_AUTH_TOKEN set:  ${Boolean(session.authToken)} (len ${session.authToken.length})`);
console.log(`  X_CT0 set:         ${Boolean(session.ct0)} (len ${session.ct0.length})`);

if (!session.configured) {
  console.error("\nFAIL: missing X_AUTH_TOKEN and/or X_CT0 in .env");
  console.error("See README → Session cookies");
  process.exit(1);
}

const result = await verifySession(session);
if (!result.ok) {
  console.error(`\nFAIL: ${result.message || result.error}`);
  if (result.status) console.error(`  HTTP ${result.status}`);
  if (result.body) console.error(`  body: ${result.body}`);
  process.exit(1);
}

console.log("\nOK: session verified");
console.log(`  method: ${result.method}`);
console.log(`  @${result.user.screen_name} (${result.user.name})`);
if (result.user.id) console.log(`  id ${result.user.id}`);
if (result.warning) console.warn(`  warning: ${result.warning}`);
process.exit(0);
