#!/usr/bin/env npx tsx
/**
 * Live probe: search a few X queries, triage with DeepSeek, summarize flag/intent
 * distributions, and ask DeepSeek which exclude tags look missing/redundant.
 *
 *   npm run probe:tags
 *   npm run probe:tags -- "AI agents" "startup revenue"
 */
import { resolve } from "node:path";
import { loadEnv } from "../server/src/loadEnv.ts";
import { chatCompletions } from "../server/src/deepseek.ts";
import { getXApiCredsFromEnv } from "../server/src/xApi.ts";
import type { ThreadCard } from "../server/src/threadCard.ts";
import { searchTimeline } from "../server/src/xSearch.ts";
import { triageThreads } from "../server/src/threadTriage.ts";
import {
  EXCLUDEABLE_TAG_VOCAB,
  DEFAULT_EXCLUDED_TAGS,
  normalizeTagToken,
} from "../server/src/threadFilters.ts";

const envPath = resolve(process.cwd(), ".env");
if (!loadEnv(envPath)) {
  console.error("FAIL: no .env file");
  process.exit(1);
}

const queries = (process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "AI agents",
      "startup MRR",
      "election",
      "open source",
      "what's your favorite",
    ]
).map((q) => q.trim()).filter(Boolean);

const agenda =
  "Find concrete builder / AI / infra threads worth a short technical reply. Skip hollow engagement asks, promo, and pure politics.";

const creds = getXApiCredsFromEnv();
console.log("x-copilot triage tag probe");
console.log(`  queries: ${queries.join(" | ")}`);
console.log(`  api: ${creds.configured}`);
console.log(`  official exclude vocab: ${EXCLUDEABLE_TAG_VOCAB.join(", ")}`);
console.log(`  default excludes: ${DEFAULT_EXCLUDED_TAGS.join(", ")}`);

if (!creds.bearerToken) {
  console.error("FAIL: missing X_API_BEARER_TOKEN");
  process.exit(1);
}
if (!process.env.DEEPSEEK_API_KEY?.trim()) {
  console.error("FAIL: missing DEEPSEEK_API_KEY");
  process.exit(1);
}

const collected: ThreadCard[] = [];
const seen = new Set<string>();
for (const query of queries) {
  const result = await searchTimeline({ query, count: 12, product: "Latest" });
  if (!result.ok) {
    console.warn(`  search fail (${query}): ${result.message}`);
    continue;
  }
  for (const t of result.threads) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    collected.push(t);
  }
  console.log(`  search OK (${query}): +${result.threads.length} (unique ${collected.length})`);
  await new Promise((r) => setTimeout(r, 800));
}

const sample = collected.slice(0, 20);
if (!sample.length) {
  console.error("FAIL: no threads collected");
  process.exit(1);
}

console.log(`\nTriaging ${sample.length} threads…`);
const triaged = await triageThreads({
  agenda,
  threads: sample,
  searchMemory: async () => ({ hits: [] }),
});
if (triaged.warning) console.warn(`  triage warning: ${triaged.warning}`);
console.log(`  scored: ${triaged.threads.length}`);

const flagCounts = new Map<string, number>();
const intentCounts = new Map<string, number>();
const kindCounts = new Map<string, number>();
const unknownFlags = new Map<string, number>();
const official = new Set<string>(EXCLUDEABLE_TAG_VOCAB);

for (const t of triaged.threads) {
  const kind = t.threadKind ?? "unset";
  kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
  for (const flag of t.flags ?? []) {
    const token = normalizeTagToken(flag) ?? flag;
    flagCounts.set(token, (flagCounts.get(token) ?? 0) + 1);
    if (!official.has(token)) {
      unknownFlags.set(token, (unknownFlags.get(token) ?? 0) + 1);
    }
  }
  const intent = normalizeTagToken(t.intent);
  if (intent) intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1);
}

function top(map: Map<string, number>, n = 20): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

console.log("\n=== threadKind ===");
for (const [k, n] of top(kindCounts)) console.log(`  ${n}\t${k}`);
console.log("\n=== flags ===");
for (const [k, n] of top(flagCounts)) console.log(`  ${n}\t${k}`);
console.log("\n=== intents (normalized) ===");
for (const [k, n] of top(intentCounts)) console.log(`  ${n}\t${k}`);
console.log("\n=== flags not in official exclude vocab ===");
if (!unknownFlags.size) console.log("  (none)");
else for (const [k, n] of top(unknownFlags)) console.log(`  ${n}\t${k}`);

const unusedOfficial = EXCLUDEABLE_TAG_VOCAB.filter((t) => !flagCounts.has(t));
console.log("\n=== official vocab unused in this sample ===");
console.log(`  ${unusedOfficial.join(", ") || "(all seen)"}`);

const histogram = {
  flags: Object.fromEntries(top(flagCounts)),
  intents: Object.fromEntries(top(intentCounts)),
  threadKinds: Object.fromEntries(top(kindCounts)),
  unknownFlags: Object.fromEntries(top(unknownFlags)),
  unusedOfficial,
  officialVocab: [...EXCLUDEABLE_TAG_VOCAB],
  defaultExcludes: [...DEFAULT_EXCLUDED_TAGS],
  sampleSize: triaged.threads.length,
};

console.log("\nAsking DeepSeek for vocabulary recommendations…");
const advice = await chatCompletions({
  temperature: 0.2,
  messages: [
    {
      role: "system",
      content:
        "You help design a small closed tag vocabulary for excluding X posts from a reply-copilot Curated feed. Be concrete and brief. Prefer fewer high-signal tags over a long taxonomy.",
    },
    {
      role: "user",
      content: `Official excludeable flags/intents today:\n${EXCLUDEABLE_TAG_VOCAB.join(", ")}\n\nDefault excludes: ${DEFAULT_EXCLUDED_TAGS.join(", ")}\n\nObserved triage histogram from a live Scout-like sample (JSON):\n${JSON.stringify(histogram, null, 2)}\n\nRecommend:\n1) tags to ADD for operator excludes (snake_case), with one-line why\n2) tags that seem REDUNDANT / rarely useful to expose\n3) whether political + supportive_encouragement as defaults look right\nReply as short markdown bullets only.`,
    },
  ],
});

if (!advice.ok) {
  console.error(`FAIL advice: ${advice.message}`);
  process.exit(1);
}

console.log("\n=== DeepSeek recommendations ===\n");
console.log(advice.content.trim());
console.log("\nDONE");
process.exit(0);
