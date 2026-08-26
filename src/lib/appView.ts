import type { LegalKind } from "./legal";

/** Desk panes. Account is identity/sessions; Settings is Scout filters; Usage is billing. */
export type AppView =
  | "home"
  | "dashboard"
  | "voice"
  | "settings"
  | "account"
  | "usage"
  | "admin"
  | "analytics"
  | "pricing"
  | "changelog"
  | "learn"
  | "learnWeights"
  | "learnReply"
  | "learnVolume"
  | "learnFollow"
  | LegalKind;

/** Signed-out public pages — no desk, no X gate, no onboarding wall. */
export function isPublicView(view: string): boolean {
  return (
    view === "privacy" ||
    view === "terms" ||
    view === "pricing" ||
    view === "changelog" ||
    view === "learn" ||
    view === "learnWeights" ||
    view === "learnReply" ||
    view === "learnVolume" ||
    view === "learnFollow"
  );
}

export function viewFromPath(pathname: string): AppView {
  if (pathname === "/privacy" || pathname.startsWith("/privacy/")) return "privacy";
  if (pathname === "/terms" || pathname.startsWith("/terms/")) return "terms";
  if (pathname === "/pricing" || pathname.startsWith("/pricing/")) return "pricing";
  if (pathname === "/changelog" || pathname.startsWith("/changelog/")) {
    return "changelog";
  }
  if (pathname === "/learn/follow" || pathname.startsWith("/learn/follow/")) {
    return "learnFollow";
  }
  if (
    pathname === "/learn/what-a-like-is-worth" ||
    pathname.startsWith("/learn/what-a-like-is-worth/")
  ) {
    return "learnWeights";
  }
  if (
    pathname === "/learn/posts-that-get-a-reply" ||
    pathname.startsWith("/learn/posts-that-get-a-reply/")
  ) {
    return "learnReply";
  }
  if (
    pathname === "/learn/how-many-replies" ||
    pathname.startsWith("/learn/how-many-replies/")
  ) {
    return "learnVolume";
  }
  if (pathname === "/learn" || pathname.startsWith("/learn/")) return "learn";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (pathname === "/usage" || pathname === "/billing") return "usage";
  if (pathname === "/analytics") return "analytics";
  if (pathname === "/voice") return "voice";
  if (pathname === "/account") return "account";
  if (pathname === "/settings") return "settings";
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return "dashboard";
  }
  return "home";
}

export function pathFromView(view: AppView): string {
  if (view === "privacy") return "/privacy";
  if (view === "terms") return "/terms";
  if (view === "pricing") return "/pricing";
  if (view === "changelog") return "/changelog";
  if (view === "learn") return "/learn";
  if (view === "learnWeights") return "/learn/what-a-like-is-worth";
  if (view === "learnReply") return "/learn/posts-that-get-a-reply";
  if (view === "learnVolume") return "/learn/how-many-replies";
  if (view === "learnFollow") return "/learn/follow";
  if (view === "admin") return "/admin";
  if (view === "usage") return "/usage";
  if (view === "analytics") return "/analytics";
  if (view === "voice") return "/voice";
  if (view === "account") return "/account";
  if (view === "settings") return "/settings";
  if (view === "dashboard") return "/dashboard";
  return "/";
}
