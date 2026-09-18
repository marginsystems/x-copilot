import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AGENDA_CHARS,
  MIN_AGENDA_CHARS,
  fallbackAgendas,
  parseLabelList,
  parseOnboardingAgendasJson,
  validateAgendaText,
  validateOnboardingAgendas,
  validateOnboardingAnswers,
} from "./onboarding.ts";

describe("validateAgendaText", () => {
  it("accepts a trimmed agenda in range", () => {
    const agenda = "Find builders sharing opinions on shipping AI tools in public.";
    const parsed = validateAgendaText(`  ${agenda}  `);
    assert.deepEqual(parsed, { ok: true, agenda });
  });

  it("rejects short or missing text", () => {
    assert.equal(validateAgendaText("too short").ok, false);
    assert.equal(validateAgendaText("   ").ok, false);
    assert.equal(validateAgendaText(null).ok, false);
    assert.equal(validateAgendaText(1).ok, false);
  });

  it("rejects overlong text", () => {
    const parsed = validateAgendaText("x".repeat(MAX_AGENDA_CHARS + 1));
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.error, "agenda_too_long");
  });

  it("documents the minimum length", () => {
    assert.equal(MIN_AGENDA_CHARS, 40);
  });
});

describe("validateOnboardingAnswers", () => {
  it("trims, dedupes, and requires all three lists", () => {
    const parsed = validateOnboardingAnswers({
      topics: ["  AI  ", "AI", "startups"],
      goals: ["Find threads worth a reply"],
      audiences: ["Engineers"],
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.deepEqual(parsed.answers.topics, ["AI", "startups"]);
    }
    assert.equal(validateOnboardingAnswers({ topics: [], goals: ["a"], audiences: ["b"] }).ok, false);
    assert.equal(parseLabelList(["", "  "]), null);
  });
});

describe("parseOnboardingAgendasJson", () => {
  const longEnough =
    "Find founders sharing concrete takes on shipping. Prefer a point of view. Skip empty polls.";

  it("parses fenced JSON and forces exactly one recommended", () => {
    const parsed = parseOnboardingAgendasJson(
      `\`\`\`json
{"agendas":[
  {"title":"Reply first","body":"${longEnough}","recommended":true},
  {"title":"Research first","body":"${longEnough}","recommended":true}
]}
\`\`\``,
    );
    assert.ok(parsed);
    assert.equal(parsed?.length, 2);
    assert.equal(parsed?.filter((a) => a.recommended).length, 1);
    assert.equal(parsed?.[0].recommended, true);
  });

  it("defaults the first card when none are recommended", () => {
    const parsed = validateOnboardingAgendas([
      { title: "A", body: longEnough },
      { title: "B", body: longEnough },
    ]);
    assert.equal(parsed?.[0].recommended, true);
    assert.equal(parsed?.[1].recommended, false);
  });

  it("rejects fewer than two valid agendas", () => {
    assert.equal(
      parseOnboardingAgendasJson(`{"agendas":[{"title":"Only","body":"${longEnough}"}]}`),
      null,
    );
  });
});

describe("fallbackAgendas", () => {
  it("returns three distinct Scout-ready agendas", () => {
    const agendas = fallbackAgendas({
      topics: ["AI"],
      goals: ["Find threads worth a reply"],
      audiences: ["Engineers"],
    });
    assert.equal(agendas.length, 3);
    assert.equal(agendas.filter((a) => a.recommended).length, 1);
    for (const agenda of agendas) {
      assert.ok(agenda.body.length >= MIN_AGENDA_CHARS);
      assert.match(agenda.body, /AI|Engineers/);
    }
  });
});
