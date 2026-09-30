import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getPlatformDb, resetPlatformDbForTests } from "../server/src/db.js";
import { createSession } from "../server/src/auth/sessionStore.js";
import { ensureUserTenant } from "../server/src/billing/billingStore.js";
import { writeInteractionRow } from "../server/src/desk/interactionStore.js";
import type { Interaction } from "../server/src/desk/interactionStore.js";
import { recordCircleLinks, upsertXProfiles } from "../server/src/circle/circleStore.js";
import { saveScoutCache } from "../server/src/scout/scoutCache.js";
import { recordScoutEvidence } from "../server/src/scout/scoutEvidence.js";
import type { ThreadCard } from "../server/src/scout/threadCard.js";

const PREVIEW_USER_ID = "desk-preview-user";
const PREVIEW_HANDLE = "rileypilot";
const WEB_ORIGIN = process.env.DESK_PREVIEW_WEB_ORIGIN?.trim() || "http://localhost:5173";
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

if (process.env.NODE_ENV === "production") {
  console.error("dev-seed-desk refuses to run with NODE_ENV=production");
  process.exit(1);
}

const root = process.cwd();
const previewDir = resolve(root, "data", "desk-preview");
const dbPath = join(previewDir, "platform.sqlite");
const tokenPath = join(previewDir, "session-token.txt");
process.env.PLATFORM_DB_PATH = dbPath;

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = prng(20260930);
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;

const CIRCLE_PEOPLE: ReadonlyArray<readonly [string, string]> = [
  ["maya_builds", "Maya Okafor"],
  ["devon_ships", "Devon Park"],
  ["priya_writes", "Priya Nair"],
  ["tomas_data", "Tomas Reyes"],
  ["lena_designs", "Lena Fischer"],
  ["kofi_indie", "Kofi Mensah"],
  ["sara_growth", "Sara Lindqvist"],
  ["jun_codes", "Jun Watanabe"],
  ["nora_ops", "Nora Haddad"],
  ["ivan_pm", "Ivan Petrov"],
  ["amara_ml", "Amara Diallo"],
  ["felix_seo", "Felix Braun"],
  ["hana_ux", "Hana Suzuki"],
  ["omar_sre", "Omar Farouk"],
  ["clara_vc", "Clara Moreau"],
  ["ben_solo", "Ben Alvarez"],
  ["zoe_content", "Zoe Bennett"],
  ["ravi_infra", "Ravi Menon"],
  ["ines_brand", "Ines Duarte"],
  ["tariq_saas", "Tariq Aziz"],
  ["mei_product", "Mei Lin"],
  ["gus_founder", "Gus Halvorsen"],
];

const OTHER_HANDLES = Array.from({ length: 70 }, (_, i) => `scout_${String(i + 1).padStart(2, "0")}`);

const REPLY_TEXTS = [
  "This matches what we saw when we cut onboarding from 6 steps to 3. Activation moved more than the copy did.",
  "The boring answer is usually right here: measure the retention curve before touching the funnel.",
  "Disagree on the pricing part. Anchoring on the annual plan changed our mix more than any discount did.",
  "We tried this for a quarter. The win was not the tool, it was the weekly review that came with it.",
  "Good thread. The missing piece is who owns the metric after launch.",
  "Ran the same test last month, 4% lift, not significant until week three. Patience matters.",
  "Small correction: the cache hit rate matters less than the p95 on a cold path.",
  "This is the part people skip. Write the postmortem while it still hurts.",
  "Counterpoint from support: the loudest feature request is rarely the one that churns people.",
  "Shipping smaller beat shipping better for us. Two weeks to one, quality held.",
];

const THREAD_TOPICS = [
  "pricing", "onboarding", "retention", "hiring", "latency", "roadmap", "churn", "launch", "seo", "analytics",
];

type ThreadKindValue =
  | "timely_take"
  | "fact_add"
  | "sharp_opinion"
  | "lived_answer"
  | "hollow_ask"
  | "other";
const KINDS: readonly ThreadKindValue[] = [
  "timely_take", "fact_add", "sharp_opinion", "lived_answer", "hollow_ask", "other",
];

const TANK_KINDS: readonly ThreadKindValue[] = [
  "timely_take", "fact_add", "sharp_opinion", "lived_answer",
];

function svgAvatar(handle: string): string {
  return `${WEB_ORIGIN}/__dev/avatar/${encodeURIComponent(handle)}.svg`;
}

function resetPreviewFiles(): void {
  resetPlatformDbForTests();
  mkdirSync(previewDir, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
  rmSync(resolve(root, "data", "gamification", `${PREVIEW_USER_ID}.json`), { force: true });
}

function ensureEnvFile(): void {
  const envPath = resolve(root, ".env");
  if (existsSync(envPath)) return;
  writeFileSync(
    envPath,
    [
      "PORT=8787",
      "PLATFORM_DB_PATH=data/desk-preview/platform.sqlite",
      "DESK_EVENTS_SECRET=desk-preview",
      "AUTH_REQUIRED=1",
      "",
    ].join("\n"),
  );
  console.log("wrote .env for the preview server (gitignored)");
}

function seedUser(nowIso: string): void {
  const db = getPlatformDb();
  db.prepare(
    `INSERT INTO users (id, email, display_name, avatar_url, created_at, last_login_at,
       onboarding_completed_at, agenda, x_username)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    PREVIEW_USER_ID,
    "riley.pilot@example.test",
    "Riley Pilot",
    svgAvatar(PREVIEW_HANDLE),
    new Date(Date.now() - 60 * DAY_MS).toISOString(),
    nowIso,
    nowIso,
    "SaaS growth, indie hacking, product analytics",
    PREVIEW_HANDLE,
  );
  db.prepare(
    `INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, email, username, created_at)
     VALUES (?, ?, 'x', ?, NULL, ?, ?)`,
  ).run("desk-preview-x", PREVIEW_USER_ID, "9000000001", PREVIEW_HANDLE, nowIso);
  ensureUserTenant(PREVIEW_USER_ID);
}

type OwnPostSeed = {
  id: string;
  kind: "reply" | "original" | "quote";
  text: string;
  postedAtMs: number;
  inReplyToId?: string;
  quotedPostId?: string;
  views24h: number | null;
};

function insertOwnPosts(posts: readonly OwnPostSeed[], tenantId: string, nowMs: number): void {
  const stmt = getPlatformDb().prepare(
    `INSERT INTO own_posts (
       id, user_id, tenant_id, x_user_id, kind, text, posted_at, in_reply_to_id,
       conversation_id, url,
       t1h_views, t1h_likes, t1h_replies, t1h_retweets, t1h_bookmarks, t1h_at,
       t24h_views, t24h_likes, t24h_replies, t24h_retweets, t24h_bookmarks, t24h_at,
       created_at, quoted_post_id
     ) VALUES (?, ?, ?, '9000000001', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  getPlatformDb().transaction(() => {
    for (const p of posts) {
      const at = new Date(p.postedAtMs).toISOString();
      const has1h = nowMs - p.postedAtMs > HOUR_MS;
      const v24 = p.views24h;
      const v1 = v24 === null ? Math.max(20, Math.round(between(60, 900))) : Math.round(v24 * 0.4);
      const has24 = v24 !== null && nowMs - p.postedAtMs > 24 * HOUR_MS;
      const like = (v: number, k: number) => Math.round(v * k);
      stmt.run(
        p.id,
        PREVIEW_USER_ID,
        tenantId,
        p.kind,
        p.text,
        at,
        p.inReplyToId ?? null,
        p.inReplyToId ?? p.id,
        `https://x.com/${PREVIEW_HANDLE}/status/${p.id}`,
        has1h ? v1 : null,
        has1h ? like(v1, 0.03) : null,
        has1h ? like(v1, 0.004) : null,
        has1h ? like(v1, 0.005) : null,
        has1h ? like(v1, 0.002) : null,
        has1h ? new Date(p.postedAtMs + HOUR_MS).toISOString() : null,
        has24 ? v24 : null,
        has24 ? like(v24, 0.03) : null,
        has24 ? like(v24, 0.004) : null,
        has24 ? like(v24, 0.005) : null,
        has24 ? like(v24, 0.002) : null,
        has24 ? new Date(p.postedAtMs + 24 * HOUR_MS).toISOString() : null,
        at,
        p.quotedPostId ?? null,
      );
    }
  })();
}

function seedHistory(nowMs: number, tenantId: string): {
  ownPosts: OwnPostSeed[];
  interactions: Interaction[];
} {
  const interactions: Interaction[] = [];
  const ownPosts: OwnPostSeed[] = [];
  const weighted = CIRCLE_PEOPLE.flatMap(([handle], i) =>
    Array.from({ length: Math.max(1, 24 - i) }, () => handle),
  );
  let seq = 0;
  for (let day = 0; day < 30; day += 1) {
    const perDay = day < 14 ? between(9, 17) : between(3, 9);
    for (let n = 0; n < perDay; n += 1) {
      const ageMs = day * DAY_MS + rand() * (day === 0 ? nowMs % DAY_MS : DAY_MS);
      const atMs = Math.round(nowMs - ageMs);
      if (atMs > nowMs - 3 * HOUR_MS) continue;
      seq += 1;
      const author = rand() < 0.62 ? pick(weighted) : pick(OTHER_HANDLES);
      const threadId = `1900${String(100000 + seq)}`;
      const replyId = `1910${String(100000 + seq)}`;
      const text = pick(REPLY_TEXTS);
      const views = rand() < 0.08 ? between(6000, 26000) : between(120, 3400);
      const at = new Date(atMs).toISOString();
      const ageH = (nowMs - atMs) / HOUR_MS;
      const stats: Interaction["stats"] = {};
      if (ageH > 1.2) {
        stats.t1h = {
          views: Math.round(views * 0.4),
          likes: between(0, 9),
          replies: between(0, 2),
          retweets: between(0, 1),
          sampledAt: new Date(atMs + HOUR_MS).toISOString(),
        };
      }
      if (ageH > 25) {
        stats.t24h = {
          views,
          likes: Math.round(views * 0.03),
          replies: between(0, 4),
          retweets: between(0, 3),
          sampledAt: new Date(atMs + 24 * HOUR_MS).toISOString(),
        };
      }
      interactions.push({
        threadId,
        author,
        authorKey: author.toLowerCase(),
        at,
        source: rand() < 0.2 ? "discovered" : "manual",
        userId: PREVIEW_USER_ID,
        url: `https://x.com/${author}/status/${threadId}`,
        summary: `${author} on ${pick(THREAD_TOPICS)}`,
        text,
        replyId,
        replyUrl: `https://x.com/${PREVIEW_HANDLE}/status/${replyId}`,
        postedAt: at,
        conversationId: threadId,
        stats: Object.keys(stats).length ? stats : undefined,
      });
      ownPosts.push({
        id: replyId,
        kind: "reply",
        text,
        postedAtMs: atMs,
        inReplyToId: threadId,
        views24h: views,
      });
    }
    const originals = day === 0 ? 2 : between(0, 2);
    for (let n = 0; n < originals; n += 1) {
      seq += 1;
      ownPosts.push({
        id: `1920${String(100000 + seq)}`,
        kind: "original",
        text: pick([
          "Three things I would tell a founder about weekly metrics reviews.",
          "Shipped a boring fix that removed 40% of support tickets. The dull work pays.",
          "Hot take: your onboarding checklist is a to-do list for the team, not the user.",
          "Retention beats acquisition until it does not. Here is the switch point we found.",
        ]),
        postedAtMs: Math.round(nowMs - day * DAY_MS - (day === 0 ? (n + 1) * 2 * HOUR_MS : rand() * DAY_MS)),
        views24h: between(700, 32000),
      });
    }
    if (day === 0 || rand() < 0.45) {
      seq += 1;
      ownPosts.push({
        id: `1930${String(100000 + seq)}`,
        kind: "quote",
        text: "Worth reading in full. The second chart is the whole argument.",
        postedAtMs: Math.round(nowMs - day * DAY_MS - (day === 0 ? 3 * HOUR_MS : rand() * DAY_MS)),
        quotedPostId: `1940${String(100000 + seq)}`,
        views24h: between(400, 9000),
      });
    }
  }
  for (const row of interactions) writeInteractionRow(row, tenantId);
  insertOwnPosts(ownPosts, tenantId, nowMs);
  return { ownPosts, interactions };
}

function seedCircle(ownPosts: readonly OwnPostSeed[], nowMs: number): void {
  const nowIso = new Date(nowMs).toISOString();
  upsertXProfiles(
    CIRCLE_PEOPLE.map(([handle, name]) => ({
      authorKey: handle.toLowerCase(),
      handle,
      name,
      avatarUrl: svgAvatar(handle),
      updatedAt: nowIso,
    })),
  );
  const quotes = ownPosts.filter((p) => p.kind === "quote");
  const links = quotes.slice(0, 12).map((post, i) => ({
    postId: post.id,
    authorKey: CIRCLE_PEOPLE[i % 9]![0].toLowerCase(),
    kind: "quote" as const,
    at: new Date(post.postedAtMs).toISOString(),
  }));
  recordCircleLinks(PREVIEW_USER_ID, links, PREVIEW_HANDLE);
}

function seedEvidence(nowMs: number): void {
  for (let i = 0; i < 48; i += 1) {
    const actedAt = new Date(nowMs - (i + 1) * 5 * HOUR_MS).toISOString();
    const author = pick(CIRCLE_PEOPLE)[0].toLowerCase();
    const kind = KINDS[i % 4]!;
    const take = i % 3 !== 0;
    recordScoutEvidence({
      userId: PREVIEW_USER_ID,
      eventKey: take ? `reply:1910${900000 + i}` : `skip:scout:seed-${i}`,
      action: take ? "take" : "skip",
      source: take ? "manual" : "scout",
      targetId: `1900${900000 + i}`,
      replyId: take ? `1910${900000 + i}` : null,
      actedAt,
      noteState: take ? "stored" : "unknown",
      threadKind: kind,
      targetAuthor: author,
      topics: [pick(THREAD_TOPICS), pick(THREAD_TOPICS)],
      contextSource: "scout_cache",
      nowMs,
    });
  }
}

async function seedThreads(nowMs: number): Promise<void> {
  const threads: ThreadCard[] = Array.from({ length: 7 }, (_, i) => {
    const handle = `lead_${String(i + 1).padStart(2, "0")}`;
    const id = `1950${String(100000 + i)}`;
    const topic = pick(THREAD_TOPICS);
    return {
      id,
      author: handle,
      text: `Honest question for people who run ${topic}: what did you stop doing that actually made the numbers better? We removed three steps and nothing broke.`,
      url: `https://x.com/${handle}/status/${id}`,
      surface: "reply",
      createdAt: new Date(nowMs - between(8, 90) * 60_000).toISOString(),
      summary: `Asks what to stop doing in ${topic}`,
      views: between(900, 42000),
      score: Math.round(60 + rand() * 38),
      baitScore: between(2, 30),
      engage: i < 5 ? "priority" : "consider",
      threadKind: pick(TANK_KINDS),
      onAgenda: true,
      reason: "Fresh conversation from an author you have not replied to with room for a lived answer.",
    };
  });
  await saveScoutCache(
    {
      savedAt: new Date(nowMs).toISOString(),
      agenda: "SaaS growth, indie hacking, product analytics",
      queries: ["saas retention", "onboarding", "pricing"],
      threads,
      message: "Preview tank",
    },
    { userId: PREVIEW_USER_ID },
  );
}

function seedApproach(nowMs: number, tenantId: string): void {
  const rows: Array<{ kind: string; why: string; draft: string | null; author: string | null }> = [
    {
      kind: "post",
      why: "Your posts on retention got 3x your median views this week. Write another original while it is warm.",
      draft: "Retention is a lagging metric. The leading one is how many users hit the second session in 48 hours.",
      author: null,
    },
    {
      kind: "reply",
      why: "Maya replied to you twice this week. A third reply keeps the thread alive.",
      draft: "That is fair. What did you change first, the onboarding copy or the trigger email?",
      author: "maya_builds",
    },
    {
      kind: "quote",
      why: "Devon posted a chart that fits your agenda. A quote with one opinion would travel.",
      draft: "The second bar is the story. Everything before it is setup.",
      author: "devon_ships",
    },
    {
      kind: "repost",
      why: "Priya's launch note is squarely on topic and still fresh.",
      draft: null,
      author: "priya_writes",
    },
  ];
  const stmt = getPlatformDb().prepare(
    `INSERT INTO for_you_suggestions
       (id, user_id, tenant_id, kind, status, why, draft, target_id, target_url, target_author,
        created_at, expires_at, acted_at)
     VALUES (?, ?, ?, ?, 'suggested', ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );
  rows.forEach((row, i) => {
    const targetId = row.author ? `1960${100000 + i}` : null;
    stmt.run(
      `preview-suggestion-${i}`,
      PREVIEW_USER_ID,
      tenantId,
      row.kind,
      row.why,
      row.draft,
      targetId,
      row.author && targetId ? `https://x.com/${row.author}/status/${targetId}` : null,
      row.author,
      new Date(nowMs - i * 20 * 60_000).toISOString(),
      new Date(nowMs + 40 * HOUR_MS).toISOString(),
    );
  });
  getPlatformDb()
    .prepare(`INSERT INTO for_you_runs (id, user_id, at) VALUES (?, ?, ?)`)
    .run("preview-run", PREVIEW_USER_ID, new Date(nowMs).toISOString());
}

async function main(): Promise<void> {
  resetPreviewFiles();
  ensureEnvFile();
  const nowMs = Date.now();
  getPlatformDb();
  seedUser(new Date(nowMs).toISOString());
  const tenantId = ensureUserTenant(PREVIEW_USER_ID);
  const { ownPosts, interactions } = seedHistory(nowMs, tenantId);
  seedCircle(ownPosts, nowMs);
  seedEvidence(nowMs);
  await seedThreads(nowMs);
  seedApproach(nowMs, tenantId);
  const session = createSession(PREVIEW_USER_ID, { userAgent: "desk-preview-seed" });
  writeFileSync(tokenPath, `${session.token}\n`, { mode: 0o600 });
  console.log(`seeded ${interactions.length} marks, ${ownPosts.length} own posts, ${CIRCLE_PEOPLE.length} circle people`);
  console.log(`db: ${dbPath}`);
  console.log(`sign in: ${WEB_ORIGIN}/__dev/login`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
