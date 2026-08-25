import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHANGELOG,
  changelogByDate,
  formatChangelogDate,
  isChangelogDate,
} from "./changelog.ts";

describe("CHANGELOG", () => {
  it("lists newest ships first with a title, body, and date", () => {
    assert.ok(CHANGELOG.length >= 1);
    for (let i = 1; i < CHANGELOG.length; i += 1) {
      assert.ok(
        CHANGELOG[i - 1]!.date >= CHANGELOG[i]!.date,
        `out of order: ${CHANGELOG[i - 1]!.date} then ${CHANGELOG[i]!.date}`,
      );
    }
    for (const entry of CHANGELOG) {
      assert.ok(isChangelogDate(entry.date), entry.date);
      assert.ok(entry.title.trim());
      assert.ok(entry.body.trim());
      if (entry.href) {
        assert.match(entry.href, /^https:\/\/github.com\/marginsystems\/x-copilot\/pull\/\d+$/);
      }
    }
  });

  it("opens with Voice card share", () => {
    assert.equal(CHANGELOG[0]?.title, "Share your Voice card");
  });
});

describe("changelogByDate", () => {
  it("groups consecutive same-day rows and keeps newest first", () => {
    const days = changelogByDate([
      { date: "2026-08-25", title: "A", body: "a" },
      { date: "2026-08-25", title: "B", body: "b" },
      { date: "2026-08-24", title: "C", body: "c" },
    ]);
    assert.deepEqual(
      days.map((d) => [d.date, d.items.map((i) => i.title)]),
      [
        ["2026-08-25", ["A", "B"]],
        ["2026-08-24", ["C"]],
      ],
    );
  });
});

describe("formatChangelogDate", () => {
  it("formats a UTC day without shifting the calendar date", () => {
    assert.equal(formatChangelogDate("2026-08-25"), "August 25, 2026");
    assert.equal(isChangelogDate("2026-08-25"), true);
    assert.equal(isChangelogDate("25-08-2026"), false);
    assert.equal(isChangelogDate("2026-13-01"), false);
    assert.equal(isChangelogDate("2026-02-31"), false);
  });
});
