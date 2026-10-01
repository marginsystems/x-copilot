import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import {
  IDLE_CLOCK,
  attentionLabel,
  attentionReady,
  statusIdFromPath,
  tickAttention,
} from "../lib/attention";
import { ATTENTION_GATE_KEY, parseAttentionGate } from "../lib/settings";
import { readAttentionGate } from "../lib/settingsStore";
import { X_SELECTORS, chipPosition, rectInViewport } from "../lib/xSelectors";

const TICK_MS = 250;
const CHIP_HEIGHT = 24;

const CHIP_CSS = `
  :host { all: initial; }
  .chip {
    position: fixed;
    z-index: 2147483647;
    height: ${CHIP_HEIGHT}px;
    padding: 0 10px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    font: 600 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
    font-variant-numeric: tabular-nums;
    background: #536471;
    color: #ffffff;
    pointer-events: none;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
  .chip.ready { background: #00ba7c; }
  .chip[hidden] { display: none; }
`;

function createChip(): HTMLDivElement {
  const host = document.createElement("div");
  host.setAttribute("data-x-copilot", "attention");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CHIP_CSS;
  const chip = document.createElement("div");
  chip.className = "chip";
  chip.hidden = true;
  chip.setAttribute("aria-hidden", "true");
  shadow.append(style, chip);
  document.documentElement.append(host);
  return chip;
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function postInView(): boolean {
  const size = viewport();
  for (const post of document.querySelectorAll(X_SELECTORS.post)) {
    if (rectInViewport(post.getBoundingClientRect(), size)) return true;
  }
  return false;
}

export default defineContentScript({
  matches: ["https://x.com/*"],
  runAt: "document_idle",
  main(ctx) {
    let enabled = true;
    let clock = IDLE_CLOCK;
    const chip = createChip();

    readAttentionGate().then((on) => { enabled = on; }, () => undefined);
    browser.storage.onChanged.addListener((changes, area) => {
      const change = changes[ATTENTION_GATE_KEY];
      if (area === "local" && change) enabled = parseAttentionGate(change.newValue);
    });

    function render() {
      const composer = clock.statusId ? document.querySelector(X_SELECTORS.replyComposer) : null;
      const rect = composer?.getBoundingClientRect();
      if (!enabled || !rect || !rectInViewport(rect, viewport())) {
        chip.hidden = true;
        return;
      }
      const position = chipPosition(rect, CHIP_HEIGHT);
      chip.style.top = `${position.top}px`;
      chip.style.left = `${position.left}px`;
      chip.textContent = attentionLabel(clock);
      chip.classList.toggle("ready", attentionReady(clock));
      chip.hidden = false;
    }

    ctx.setInterval(() => {
      clock = tickAttention(clock, {
        statusId: statusIdFromPath(window.location.pathname),
        nowMs: Date.now(),
        visible: document.visibilityState === "visible",
        focused: document.hasFocus(),
        postInView: postInView(),
      });
      render();
    }, TICK_MS);
  },
});
