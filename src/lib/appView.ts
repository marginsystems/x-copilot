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
  | LegalKind;

export function viewFromPath(pathname: string): AppView {
  if (pathname === "/privacy" || pathname.startsWith("/privacy/")) return "privacy";
  if (pathname === "/terms" || pathname.startsWith("/terms/")) return "terms";
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
  if (view === "admin") return "/admin";
  if (view === "usage") return "/usage";
  if (view === "analytics") return "/analytics";
  if (view === "voice") return "/voice";
  if (view === "account") return "/account";
  if (view === "settings") return "/settings";
  if (view === "dashboard") return "/dashboard";
  return "/";
}
