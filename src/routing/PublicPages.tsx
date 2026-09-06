import { LegalPage } from "../Legal";
import { PricingPage } from "../Pricing";
import { ChangelogPage } from "../Changelog";
import { LearnPage } from "../Learn";
import { LearnHubPage } from "../LearnHub";
import { LearnReplyPage } from "../LearnReply";
import { LearnVolumePage } from "../LearnVolume";
import { LearnGivePage } from "../LearnGive";
import { LearnFollowPage } from "../LearnFollow";
import { isLegalKind } from "../lib/legal";
import type { AppView } from "../lib/appView";

type PublicPagesProps = {
  view: AppView;
  signedIn: boolean;
  goToView: (view: AppView) => void;
  onSignIn: () => void;
};

/** Signed-out public pages: legal, pricing, changelog, and the Learn lessons. */
export function PublicPages({
  view,
  signedIn,
  goToView,
  onSignIn,
}: PublicPagesProps) {
  const onHome = () => goToView("home");
  const onCatalog = () => goToView("learn");
  const onOpenLesson = (lesson: AppView) => goToView(lesson);

  const page = isLegalKind(view) ? (
    <LegalPage
      kind={view}
      onHome={onHome}
      onOther={() => goToView(view === "privacy" ? "terms" : "privacy")}
    />
  ) : view === "pricing" ? (
    <PricingPage
      signedIn={signedIn}
      onHome={onHome}
      onSignIn={onSignIn}
      onOpenDesk={() => goToView("dashboard")}
      onUsage={() => goToView("usage")}
    />
  ) : view === "changelog" ? (
    <ChangelogPage onHome={onHome} />
  ) : view === "learn" ? (
    <LearnHubPage onHome={onHome} onOpenLesson={onOpenLesson} />
  ) : view === "learnWeights" ? (
    <LearnPage
      onHome={onHome}
      onCatalog={onCatalog}
      onOpenLesson={onOpenLesson}
      onFollow={() => goToView("learnFollow")}
      onReply={() => goToView("learnReply")}
      onVolume={() => goToView("learnVolume")}
    />
  ) : view === "learnReply" ? (
    <LearnReplyPage
      onHome={onHome}
      onCatalog={onCatalog}
      onOpenLesson={onOpenLesson}
      onWeights={() => goToView("learnWeights")}
      onVolume={() => goToView("learnVolume")}
    />
  ) : view === "learnVolume" ? (
    <LearnVolumePage
      onHome={onHome}
      onCatalog={onCatalog}
      onOpenLesson={onOpenLesson}
      onWeights={() => goToView("learnWeights")}
      onReply={() => goToView("learnReply")}
    />
  ) : view === "learnGive" ? (
    <LearnGivePage goToView={goToView} />
  ) : view === "learnFollow" ? (
    <LearnFollowPage
      onHome={onHome}
      onCatalog={onCatalog}
      onOpenLesson={onOpenLesson}
    />
  ) : null;

  if (!page) return null;
  return <main className="app-main app-main-scroll">{page}</main>;
}
