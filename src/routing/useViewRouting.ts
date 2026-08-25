import { useEffect, useRef, useState } from "react";
import { bootAnalytics, trackPageView } from "../lib/analytics";
import {
  pathFromView,
  viewFromPath,
  type AppView,
} from "../lib/appView";
import {
  readConsent,
  writeConsent,
  type ConsentChoice,
} from "../lib/consent";
import { applyDocumentSeo } from "../lib/seo";

export function useViewRouting() {
  const [view, setView] = useState<AppView>(() =>
    typeof window === "undefined" ? "home" : viewFromPath(window.location.pathname),
  );
  const [consent, setConsent] = useState<ConsentChoice | null>(() =>
    typeof window === "undefined" ? null : readConsent(),
  );
  const [consentOpen, setConsentOpen] = useState(
    () => (typeof window === "undefined" ? false : readConsent() === null),
  );
  /** Last path a page_view was sent for, so a re-render can't double-count a landing. */
  const lastTrackedPathRef = useRef<string | null>(null);

  useEffect(() => {
    const onPop = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    bootAnalytics(consent);
  }, [consent]);

  useEffect(() => {
    if (consent !== "accepted") {
      lastTrackedPathRef.current = null;
      return;
    }
    const path = window.location.pathname;
    if (path === lastTrackedPathRef.current) return;
    lastTrackedPathRef.current = path;
    trackPageView(path);
  }, [consent, view]);

  useEffect(() => {
    applyDocumentSeo(document, view);
  }, [view]);

  function chooseConsent(choice: ConsentChoice) {
    writeConsent(choice);
    setConsent(choice);
    setConsentOpen(false);
  }

  function goToView(next: AppView) {
    setView(next);
    const path = pathFromView(next);
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
  }

  return {
    view,
    setView,
    consentOpen,
    setConsentOpen,
    chooseConsent,
    goToView,
  };
}
