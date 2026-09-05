import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import {
  SUGGESTION_TTL_MS,
  countDoneSuggestionsSince,
  expireOpenSuggestions,
  getSuggestion,
  hasForYouRunToday,
  insertSuggestions,
  listActiveSuggestions,
  markSuggestion,
  replaceDailySuggestions,
  secondPersonWhy,
} from "./forYouStore.ts";

describe("forYouStore", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-foryou-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists active rows and hides expired or acted ones", () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: now,
      drafts: [
        { kind: "post", why: "hiring thread is live", draft: "Ship the recap." },
      ],
    });
    assert.equal(listActiveSuggestions("u1", now + 1000).length, 1);
    assert.equal(
      listActiveSuggestions("u1", now + SUGGESTION_TTL_MS + 1).length,
      0,
    );
  });

  it("replaceDailySuggestions expires leftovers and records the UTC day", () => {
    const morning = Date.parse("2026-08-20T01:00:00.000Z");
    const first = replaceDailySuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: morning,
      drafts: [{ kind: "post", why: "first", draft: "A" }],
    });
    assert.equal(first.length, 1);
    assert.equal(hasForYouRunToday("u1", morning + 3600_000), true);

    const later = morning + 2 * 3600_000;
    replaceDailySuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: later,
      drafts: [{ kind: "post", why: "second", draft: "B" }],
    });
    const active = listActiveSuggestions("u1", later + 1000);
    assert.equal(active.length, 1);
    assert.equal(active[0]?.why, "second");
  });

  it("markSuggestion records distinct done, skipped, and dismissed statuses", () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    const [row] = insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: now,
      drafts: [
        { kind: "reply", why: "open thread", targetId: "99", targetUrl: "https://x.com/a/status/99" },
      ],
    });
    assert.ok(row);
    const done = markSuggestion({
      id: row.id,
      userId: "u1",
      status: "done",
      nowMs: now + 1000,
    });
    assert.equal(done?.status, "done");
    assert.equal(listActiveSuggestions("u1", now + 2000).length, 0);

    const [skippedRow] = insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: now,
      drafts: [{ kind: "post", why: "x", draft: "Y" }],
    });
    const [dismissedRow] = insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: now,
      drafts: [{ kind: "quote", why: "z", targetId: "100" }],
    });
    assert.ok(skippedRow && dismissedRow);
    assert.equal(
      markSuggestion({
        id: skippedRow.id,
        userId: "u1",
        status: "skipped",
        nowMs: now + 2000,
      })?.status,
      "skipped",
    );
    assert.equal(
      markSuggestion({
        id: dismissedRow.id,
        userId: "u1",
        status: "dismissed",
        nowMs: now + 3000,
      })?.status,
      "dismissed",
    );
    assert.equal(listActiveSuggestions("u1", now + 4000).length, 0);
  });

  it("skip buries remixes of the same original and refuses a rewrite", () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    const [first] = insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: now,
      drafts: [
        {
          kind: "post",
          why: "Your 8.7k-view Claude refusal reply is your best shape.",
          draft: "Refusal is a feature, not a bug.",
        },
        {
          kind: "post",
          why: "Your 8.7k Claude refusal still leads. Write the next original.",
          draft: "Your prompts are the real problem.",
        },
        {
          kind: "quote",
          why: "quote a different win",
          targetId: "10",
          targetUrl: "https://x.com/desk/status/10",
        },
      ],
    });
    assert.ok(first);
    markSuggestion({
      id: first.id,
      userId: "u1",
      status: "skipped",
      nowMs: now + 1000,
    });
    const active = listActiveSuggestions("u1", now + 2000);
    assert.equal(active.length, 1);
    assert.equal(active[0]?.kind, "quote");

    const rewritten = insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: now + 3000,
      drafts: [
        {
          kind: "post",
          why: "Your 8.7k Claude refusal still leads.",
          draft: "Limits are your creativity.",
        },
      ],
    });
    assert.equal(rewritten.length, 0);
    assert.equal(listActiveSuggestions("u1", now + 4000).length, 1);
  });

  it("keeps paid extra originals through the daily expiry pass", () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: now,
      drafts: [{ kind: "post", why: "extra", draft: "Paid original." }],
      origin: "extra",
    });
    insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: now,
      drafts: [{ kind: "post", why: "daily", draft: "Daily card." }],
    });
    assert.equal(expireOpenSuggestions("u1", now + 5000), 1);
    const active = listActiveSuggestions("u1", now + 6000);
    assert.equal(active.length, 1);
    assert.equal(active[0]?.origin, "extra");
    assert.equal(active[0]?.draft, "Paid original.");
  });

  it("counts done OG cards today and ignores quotes, skips, and yesterday", () => {
    const day = Date.parse("2026-08-27T12:00:00.000Z");
    const since = "2026-08-27T00:00:00.000Z";
    const [og] = insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: day,
      drafts: [{ kind: "post", why: "ship the recap", draft: "Shipped." }],
    });
    const [quote] = insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: day,
      drafts: [
        {
          kind: "quote",
          why: "quote that rant",
          targetId: "99",
          targetUrl: "https://x.com/a/status/99",
        },
      ],
    });
    const [skip] = insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: day,
      drafts: [{ kind: "post", why: "skip me", draft: "Nope." }],
    });
    assert.ok(og && quote && skip);
    markSuggestion({ id: og.id, userId: "u1", status: "done", nowMs: day });
    markSuggestion({ id: quote.id, userId: "u1", status: "done", nowMs: day });
    markSuggestion({ id: skip.id, userId: "u1", status: "skipped", nowMs: day });
    assert.equal(
      countDoneSuggestionsSince({ userId: "u1", kind: "post", sinceIso: since }),
      1,
    );
    assert.equal(
      countDoneSuggestionsSince({
        userId: "u1",
        kind: "post",
        sinceIso: "2026-08-28T00:00:00.000Z",
      }),
      0,
    );
  });

  it("getSuggestion is scoped to the owner", () => {
    const [row] = insertSuggestions({
      userId: "u1",
      tenantId: "local",
      drafts: [{ kind: "post", why: "best 24h", draft: "Ship it." }],
    });
    assert.ok(row);
    assert.equal(getSuggestion(row.id, "u1")?.why, "best 24h");
    assert.equal(getSuggestion(row.id, "u2"), null);
  });

  it("rewrites stored first-person why on read", () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    getPlatformDb()
      .prepare(
        `INSERT INTO for_you_suggestions (
           id, user_id, tenant_id, kind, status, why, draft,
           target_id, target_url, target_author, created_at, expires_at, acted_at
         ) VALUES (?, ?, ?, ?, 'suggested', ?, ?, NULL, NULL, NULL, ?, ?, NULL)`,
      )
      .run(
        "legacy-1",
        "u1",
        "local",
        "post",
        "My hiring thread is live",
        "I shipped it.",
        new Date(now).toISOString(),
        new Date(now + SUGGESTION_TTL_MS).toISOString(),
      );
    const [listed] = listActiveSuggestions("u1", now + 1000);
    assert.equal(
      listed?.why,
      "Your hiring thread is live",
    );
    const read = getSuggestion("legacy-1", "u1");
    assert.equal(
      read?.why,
      "Your hiring thread is live",
    );
    assert.equal(read?.draft, "I shipped it.");
  });

  it("returns a second-person why from insertSuggestions / replaceDailySuggestions", () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    const [inserted] = insertSuggestions({
      userId: "u1",
      tenantId: "local",
      nowMs: now,
      drafts: [
        {
          kind: "post",
          why: "My hiring thread is live",
          draft: "I shipped it.",
        },
      ],
    });
    assert.ok(inserted);
    assert.equal(inserted.why, "Your hiring thread is live");

    const [replaced] = replaceDailySuggestions({
      userId: "u2",
      tenantId: "local",
      nowMs: now + 1000,
      drafts: [{ kind: "post", why: "I should take the hiring thread", draft: "Ship it." }],
    });
    assert.ok(replaced);
    assert.equal(replaced.why, "You should take the hiring thread");
  });
});

describe("secondPersonWhy", () => {
  it("addresses the operator, not the copilot", () => {
    assert.equal(
      secondPersonWhy(
        "My recent originals about AI model lineups got 18-23 views",
      ),
      "Your recent originals about AI model lineups got 18-23 views",
    );
    assert.equal(
      secondPersonWhy("I got a lot of views on the recap"),
      "You got a lot of views on the recap",
    );
  });

  it("leaves already-second-person copy alone", () => {
    assert.equal(
      secondPersonWhy("Your reply hit 1588 views — double down"),
      "Your reply hit 1588 views — double down",
    );
  });

  it("rewrites contractions and lowercase first-person variants", () => {
    assert.equal(
      secondPersonWhy("I'm shipping, I've got it, I'd go, I'll try"),
      "You're shipping, You've got it, You'd go, You'll try",
    );
    assert.equal(
      secondPersonWhy("i got 900 views on the recap"),
      "you got 900 views on the recap",
    );
    assert.equal(
      secondPersonWhy("my recap got 900 views"),
      "your recap got 900 views",
    );
    assert.equal(
      secondPersonWhy("MY recap got 900 views"),
      "Your recap got 900 views",
    );
    assert.equal(
      secondPersonWhy("I'M shipping, I'VE got it, I'D go, I'LL try"),
      "You're shipping, You've got it, You'd go, You'll try",
    );
    assert.equal(
      secondPersonWhy("give me the recap"),
      "give you the recap",
    );
    assert.equal(secondPersonWhy("Mine got 3"), "Yours got 3");
  });

  it("handles uncontracted first-person slips", () => {
    assert.equal(
      secondPersonWhy("I am seeing 900 views on the recap"),
      "You're seeing 900 views on the recap",
    );
    assert.equal(
      secondPersonWhy("I was the top performer this week"),
      "You were the top performer this week",
    );
    assert.equal(
      secondPersonWhy("I wasn't sure the recap would hit 900 views"),
      "You weren't sure the recap would hit 900 views",
    );
  });

  it("is stable under a second pass", () => {
    const cases = [
      "I was the top performer this week",
      "My recent originals about shipping got 18 views",
      "I'm seeing 900 views on the recap",
      "i got a lot of views on the recap",
    ];
    for (const c of cases) {
      assert.equal(secondPersonWhy(secondPersonWhy(c)), secondPersonWhy(c));
    }
  });
});
