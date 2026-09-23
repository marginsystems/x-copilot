import { lazyRoute } from "./lazyRoute";
import { isLegalKind } from "../lib/legal";
import type { AppView } from "../lib/appView";

const LegalPage = lazyRoute(() => import("../Legal").then((m) => ({ default: m.LegalPage })));
const PricingPage = lazyRoute(() => import("../Pricing").then((m) => ({ default: m.PricingPage })));
const ChangelogPage = lazyRoute(() => import("../Changelog").then((m) => ({ default: m.ChangelogPage })));
const LearnPage = lazyRoute(() => import("../Learn").then((m) => ({ default: m.LearnPage })));
const LearnHubPage = lazyRoute(() => import("../LearnHub").then((m) => ({ default: m.LearnHubPage })));
const LearnReplyPage = lazyRoute(() => import("../LearnReply").then((m) => ({ default: m.LearnReplyPage })));
const LearnVolumePage = lazyRoute(() => import("../LearnVolume").then((m) => ({ default: m.LearnVolumePage })));
const LearnGivePage = lazyRoute(() => import("../LearnGive").then((m) => ({ default: m.LearnGivePage })));
const LearnFollowPage = lazyRoute(() => import("../LearnFollow").then((m) => ({ default: m.LearnFollowPage })));

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
