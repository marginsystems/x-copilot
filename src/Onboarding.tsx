import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./lib/apiBase";
import {
  AUDIENCE_OPTIONS,
  GOAL_OPTIONS,
  TOPIC_OPTIONS,
  agendaSeedFromStored,
  labelsFor,
  onboardingPostsComplete,
  onboardingWritesLocalStorage,
  parseGeneratedAgendas,
  resolveOnboardingMode,
  toggleId,
  writeOnboardingComplete,
  type GeneratedAgenda,
  type OnboardingMode,
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
  persist?: boolean;
  mode?: OnboardingMode;
  userId?: string | null;
  hidden?: boolean;
  embedded?: boolean;
  initialAgenda?: string | null;
  completeLabel?: string;
  kicker?: string;
  onComplete: (agenda: string) => void;
}) {
  const mode = resolveOnboardingMode(props.mode, props.persist);
  const seededAgenda = agendaSeedFromStored(props.initialAgenda);
  const [step, setStep] = useState(
    seededAgenda ? QUESTIONS.length : 0,
  );
  const [topics, setTopics] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [audiences, setAudiences] = useState<string[]>([]);
  const [agendas, setAgendas] = useState<GeneratedAgenda[]>(
    seededAgenda ? [seededAgenda] : [],
  );
  const [picked, setPicked] = useState<number | null>(
    seededAgenda ? 0 : null,
  );
  const [usingSeededAgenda, setUsingSeededAgenda] = useState(
    Boolean(seededAgenda),
  );
  const [seedDismissed, setSeedDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [generatedFor, setGeneratedFor] = useState("");

  useEffect(() => {
    const next = agendaSeedFromStored(props.initialAgenda);
    const untouched =
      step === 0 &&
      topics.length === 0 &&
      goals.length === 0 &&
      audiences.length === 0 &&
      agendas.length === 0;
    if (!next || !untouched || seedDismissed) return;
    setAgendas([next]);
    setPicked(0);
    setUsingSeededAgenda(true);
    setStep(QUESTIONS.length);
  }, [
    props.initialAgenda,
    step,
    topics.length,
    goals.length,
    audiences.length,
    agendas.length,
    seedDismissed,
  ]);

  const fingerprint = useMemo(
    () => JSON.stringify({ topics, goals, audiences }),
    [topics, goals, audiences],
  );

  const question = QUESTIONS[step];
  const onPick = step === QUESTIONS.length;
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
      if (onboardingPostsComplete(mode)) {
        const res = await apiFetch("/api/onboarding/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agenda: choice.body,
          }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { message?: string };
          setNotice(data.message || "Could not save your setup.");
          return;
        }
      }
      if (onboardingWritesLocalStorage(mode)) {
        writeOnboardingComplete(choice.body, props.userId ?? undefined);
      }
      props.onComplete(choice.body);
    } catch {
      setNotice("Could not save your setup. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function goPrev() {
    if (busy || step === 0) return;
    setNotice("");
    if (onPick && usingSeededAgenda) {
      setUsingSeededAgenda(false);
      setSeedDismissed(true);
      setAgendas([]);
      setPicked(null);
      setStep(0);
      return;
    }
    setStep(step - 1);
  }

  const totalSteps = QUESTIONS.length + 1;
  const currentStep = onPick ? QUESTIONS.length + 1 : step + 1;

  return (
    <div
      className={props.embedded ? "onboarding onboarding-embedded" : "gate onboarding"}
      hidden={props.hidden}
    >
      <div className="onboarding-card">
        <p className="onboarding-kicker">
          {props.kicker ?? "Set up your desk"}
        </p>
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

        <div
          className={
            busy && !onPick
              ? "onboarding-pane is-writing"
              : "onboarding-pane"
          }
        >
          <div
            key={onPick ? "pick" : `q-${step}`}
            className="onboarding-pane-inner"
          >
            {onPick ? (
              <>
                {props.embedded ? (
                  <h3 className="gate-title">Pick an agenda</h3>
                ) : (
                  <h1 className="gate-title">Pick an agenda</h1>
                )}
                <p className="gate-lede">
                  {usingSeededAgenda
                    ? "Your pick made it through sign-in. Confirm it to set up the desk."
                    : "Scout will search X using this. You can edit it later."}
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
                          <span className="agenda-option-title">
                            {agenda.title}
                          </span>
                          {agenda.recommended ? (
                            <span className="agenda-option-rec">
                              Recommended
                            </span>
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
                {props.embedded ? (
                  <h3 className="gate-title">{question.title}</h3>
                ) : (
                  <h1 className="gate-title">{question.title}</h1>
                )}
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
          </div>
        </div>

        <p
          className={
            notice && !(busy && !onPick)
              ? "status auth-notice onboarding-status"
              : "gate-status onboarding-status"
          }
          role="status"
          aria-live="polite"
        >
          {busy && !onPick ? "Writing agendas…" : notice || "\u00a0"}
        </p>

        <div className="onboarding-nav">
          <button
            type="button"
            className="ghost"
            disabled={busy || step === 0}
            onClick={goPrev}
          >
            {onPick && usingSeededAgenda ? "Start over" : "Previous"}
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
                ? props.completeLabel ?? "Continue"
                : step === QUESTIONS.length - 1
                  ? "Generate agendas"
                  : "Next"}
          </button>
        </div>
        {!props.embedded ? (
          <p className="onboarding-brand">
            Built by Mergestorm, Inc. Not affiliated with X Corp.
          </p>
        ) : null}
      </div>
    </div>
  );
}
