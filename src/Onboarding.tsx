import { useMemo, useState } from "react";
import { apiFetch } from "./lib/apiBase";
import type { LlmProvider } from "./lib/settings";
import {
  AUDIENCE_OPTIONS,
  GOAL_OPTIONS,
  TOPIC_OPTIONS,
  labelsFor,
  parseGeneratedAgendas,
  toggleId,
  writeOnboardingComplete,
  type GeneratedAgenda,
  type OnboardingOption,
} from "./lib/onboarding";

type QuestionId = "topics" | "goals" | "audiences";

const QUESTIONS: Array<{
  id: QuestionId;
  title: string;
  lede: string;
  options: OnboardingOption[];
}> = [
  {
    id: "topics",
    title: "What are you into?",
    lede: "Pick a few topics Scout should watch.",
    options: TOPIC_OPTIONS,
  },
  {
    id: "goals",
    title: "What do you want to do on X?",
    lede: "We’ll point the desk at that.",
    options: GOAL_OPTIONS,
  },
  {
    id: "audiences",
    title: "Who do you want to talk to?",
    lede: "People you actually want in the replies.",
    options: AUDIENCE_OPTIONS,
  },
];

export function Onboarding(props: {
  provider: LlmProvider;
  persist: boolean;
  userId?: string | null;
  onComplete: (agenda: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [topics, setTopics] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [audiences, setAudiences] = useState<string[]>([]);
  const [agendas, setAgendas] = useState<GeneratedAgenda[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [generatedFor, setGeneratedFor] = useState("");

  const fingerprint = useMemo(
    () => JSON.stringify({ topics, goals, audiences }),
    [topics, goals, audiences],
  );

  const question = QUESTIONS[step];
  const onPick = step >= QUESTIONS.length;
  const selected = question
    ? question.id === "topics"
      ? topics
      : question.id === "goals"
        ? goals
        : audiences
    : [];
  const setSelected =
    question?.id === "topics"
      ? setTopics
      : question?.id === "goals"
        ? setGoals
        : setAudiences;

  async function generate(): Promise<boolean> {
    if (generatedFor === fingerprint && agendas.length >= 2) return true;
    setBusy(true);
    setNotice("");
    try {
      const res = await apiFetch("/api/onboarding/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topics: labelsFor(topics, TOPIC_OPTIONS),
          goals: labelsFor(goals, GOAL_OPTIONS),
          audiences: labelsFor(audiences, AUDIENCE_OPTIONS),
          provider: props.provider,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        agendas?: unknown;
        message?: string;
      };
      const parsed = parseGeneratedAgendas(data.agendas);
      if (!res.ok || !parsed) {
        setNotice(data.message || "Could not write agendas. Try again.");
        return false;
      }
      setAgendas(parsed);
      setGeneratedFor(fingerprint);
      const rec = parsed.findIndex((a) => a.recommended);
      setPicked(rec >= 0 ? rec : 0);
      return true;
    } catch {
      setNotice("Could not reach the API. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function goNext() {
    if (question && selected.length === 0) {
      setNotice("Pick at least one.");
      return;
    }
    setNotice("");
    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
      return;
    }
    if (!onPick) {
      const ok = await generate();
      if (ok) setStep(QUESTIONS.length);
      return;
    }
    const choice = picked != null ? agendas[picked] : undefined;
    if (!choice) {
      setNotice("Pick an agenda to continue.");
      return;
    }
    setBusy(true);
    try {
      if (props.persist) {
        const res = await apiFetch("/api/onboarding/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agenda: choice.body }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { message?: string };
          setNotice(data.message || "Could not save your agenda.");
          return;
        }
      }
      writeOnboardingComplete(choice.body, props.userId ?? undefined);
      props.onComplete(choice.body);
    } catch {
      setNotice("Could not save your agenda. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function goPrev() {
    if (busy || step === 0) return;
    setNotice("");
    setStep(step - 1);
  }

  const totalSteps = QUESTIONS.length + 1;
  const currentStep = onPick ? totalSteps : step + 1;

  return (
    <div className="gate onboarding">
      <div className="onboarding-card">
        <p className="onboarding-kicker">Set up your desk</p>
        <div
          className="onboarding-progress"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-valuenow={currentStep}
          aria-label={`Step ${currentStep} of ${totalSteps}`}
        >
          {Array.from({ length: totalSteps }, (_, i) => (
            <span
              key={i}
              className={
                i < currentStep
                  ? "onboarding-dot is-on"
                  : "onboarding-dot"
              }
            />
          ))}
        </div>

        {onPick ? (
          <>
            <h1 className="gate-title">Pick an agenda</h1>
            <p className="gate-lede">
              Scout will search X using this. You can edit it later.
            </p>
            <div className="agenda-pick">
              {agendas.map((agenda, i) => {
                const on = picked === i;
                return (
                  <button
                    key={`${agenda.title}-${i}`}
                    type="button"
                    className={on ? "agenda-option is-on" : "agenda-option"}
                    aria-pressed={on}
                    onClick={() => setPicked(i)}
                  >
                    <span className="agenda-option-head">
                      <span className="agenda-option-title">{agenda.title}</span>
                      {agenda.recommended ? (
                        <span className="agenda-option-rec">Recommended</span>
                      ) : null}
                    </span>
                    <span className="agenda-option-body">{agenda.body}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <h1 className="gate-title">{question.title}</h1>
            <p className="gate-lede">{question.lede}</p>
            <div className="onboarding-chips">
              {question.options.map((opt) => {
                const on = selected.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={on ? "chip is-on" : "chip"}
                    aria-pressed={on}
                    onClick={() => setSelected(toggleId(selected, opt.id))}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {busy && !onPick ? (
          <p className="gate-status" role="status">
            Writing agendas…
          </p>
        ) : null}
        {notice ? (
          <p className="status auth-notice" role="status">
            {notice}
          </p>
        ) : null}

        <div className="onboarding-nav">
          <button
            type="button"
            className="ghost"
            disabled={busy || step === 0}
            onClick={goPrev}
          >
            Previous
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void goNext()}
          >
            {busy && !onPick
              ? "Writing…"
              : onPick
                ? "Continue"
                : step === QUESTIONS.length - 1
                  ? "Generate agendas"
                  : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
