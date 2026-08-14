import type { ConsentChoice } from "./consent";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function gaMeasurementId(): string {
  const id = import.meta.env.VITE_GA_MEASUREMENT_ID;
  return typeof id === "string" ? id.trim() : "";
}

export function gscVerification(): string {
  const v = import.meta.env.VITE_GSC_VERIFICATION;
  return typeof v === "string" ? v.trim() : "";
}

export function applyGscVerification(): void {
  const content = gscVerification();
  if (!content || typeof document === "undefined") return;
  let el = document.querySelector<HTMLMetaElement>(
    'meta[name="google-site-verification"]',
  );
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", "google-site-verification");
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function ensureGtag(): void {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag(...args: unknown[]) {
      window.dataLayer!.push(args);
    };
}

function injectGtagScript(id: string): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("xc-ga4")) return;
  const script = document.createElement("script");
  script.id = "xc-ga4";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

/** Consent Mode denied by default. Analytics storage granted only after accept. */
export function bootAnalytics(consent: ConsentChoice | null): void {
  applyGscVerification();
  const id = gaMeasurementId();
  if (!id || typeof window === "undefined") return;
  ensureGtag();
  window.gtag!("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "denied",
  });
  if (consent !== "accepted") return;
  if (document.getElementById("xc-ga4")) return;
  injectGtagScript(id);
  window.gtag!("js", new Date());
  window.gtag!("config", id, { anonymize_ip: true });
  applyAnalyticsConsent("accepted");
}

export function applyAnalyticsConsent(choice: ConsentChoice): void {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("consent", "update", {
    analytics_storage: choice === "accepted" ? "granted" : "denied",
  });
}
