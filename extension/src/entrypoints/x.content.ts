import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import {
  IDLE_CLOCK,
  attentionSecondsLeft,
  chipPhase,
  parseAttentionMemory,
  rememberAttention,
  readySince,
  statusIdFromPath,
  tickAttention,
} from "../lib/attention";
import { REPLY_SEEN } from "../lib/messages";
import { postedStatusUrl } from "../lib/replySeen";
import { ATTENTION_GATE_KEY, parseAttentionGate } from "../lib/settings";
import { readAttentionGate } from "../lib/settingsStore";
import { X_SELECTORS, chipPagePosition, rectInViewport } from "../lib/xSelectors";

const TICK_MS = 250;
const CHIP_HEIGHT = 22;
const CHIP_HOST_SELECTOR = '[data-x-copilot="attention"]';
const MEMORY_KEY = "x-copilot:attention";

function readMemory() {
  try {
    return parseAttentionMemory(window.sessionStorage.getItem(MEMORY_KEY));
  } catch {
    return [];
  }
}

function writeMemory(memory: ReturnType<typeof readMemory>) {
  try {
    window.sessionStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    return;
  }
}

const CHIP_CSS = `
  :host { all: initial; }
  .chip {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 2147483647;
    box-sizing: border-box;
    height: ${CHIP_HEIGHT}px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid #4d453c;
    border-radius: 4px;
    background: #1f1b17;
    color: #a89f94;
    font: 600 10px/1 "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    white-space: nowrap;
    pointer-events: none;
    opacity: 1;
    translate: -100% 0;
    transition: opacity 0.3s ease, color 0.2s ease, border-color 0.2s ease;
  }
  .count {
    color: #7eb8dc;
    letter-spacing: 0;
    text-transform: none;
    font-variant-numeric: tabular-nums;
  }
  .chip.ready { color: #7dba8a; border-color: #7dba8a; }
  .chip.gone { opacity: 0; }
  .chip[hidden] { display: none; }
  @media (prefers-reduced-motion: reduce) {
    .chip { transition: none; }
  }
`;

type Chip = { host: HTMLDivElement; root: HTMLDivElement; label: HTMLSpanElement; count: HTMLSpanElement };

function createChip(): Chip {
  document.querySelector(CHIP_HOST_SELECTOR)?.remove();
  const host = document.createElement("div");
  host.setAttribute("data-x-copilot", "attention");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CHIP_CSS;
  const root = document.createElement("div");
  root.className = "chip";
  root.hidden = true;
  root.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  const count = document.createElement("span");
  count.className = "count";
  root.append(label, count);
  shadow.append(style, root);
  document.documentElement.append(host);
  return { host, root, label, count };
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
    let memory = readMemory();
    const chip = createChip();
    ctx.onInvalidated(() => chip.host.remove());

    readAttentionGate().then((on) => { enabled = on; }, () => undefined);
    browser.storage.onChanged.addListener((changes, area) => {
      const change = changes[ATTENTION_GATE_KEY];
      if (area === "local" && change) enabled = parseAttentionGate(change.newValue);
    });

    let since: number | null = null;
    let placed = "";

    function render(nowMs: number) {
      const composer = clock.statusId ? document.querySelector(X_SELECTORS.replyComposer) : null;
      const rect = composer?.getBoundingClientRect();
      if (!enabled || !rect || rect.width <= 0 || rect.height <= 0) {
        since = null;
        chip.root.hidden = true;
        return;
      }
      since = readySince(clock, since, nowMs);
      const phase = chipPhase(clock, since, nowMs);
      const replyButton = document.querySelector(X_SELECTORS.inlineReplyButton)?.getBoundingClientRect();
      const position = chipPagePosition(
        rect,
        { x: window.scrollX, y: window.scrollY },
        CHIP_HEIGHT,
        replyButton,
      );
      const next = `${position.top}:${position.right}`;
      if (next !== placed) {
        chip.root.style.top = `${position.top}px`;
        chip.root.style.left = `${position.right}px`;
        placed = next;
      }
      const label = phase === "counting" ? "Reading" : "Ready";
      const count = phase === "counting" ? `${attentionSecondsLeft(clock)}s` : "";
      if (chip.label.textContent !== label) chip.label.textContent = label;
      if (chip.count.textContent !== count) chip.count.textContent = count;
      chip.count.hidden = count === "";
      chip.root.classList.toggle("ready", phase !== "counting");
      chip.root.classList.toggle("gone", phase === "gone");
      chip.root.hidden = false;
    }

    const reported = new Set<string>();
    const attempts = new Map<string, number>();
    const pending = new Map<string, HTMLAnchorElement>();
    function reportSentPosts(records: MutationRecord[]) {
      const links = new Set<HTMLAnchorElement>();
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(X_SELECTORS.sentToastLink)) links.add(node as HTMLAnchorElement);
          for (const link of node.querySelectorAll<HTMLAnchorElement>(X_SELECTORS.sentToastLink)) {
            links.add(link);
          }
        }
      }
      for (const [replyUrl, link] of pending) {
        if (link.isConnected) links.add(link);
        else pending.delete(replyUrl);
      }
      for (const link of links) {
        const replyUrl = postedStatusUrl(link.getAttribute("href"));
        if (!replyUrl || reported.has(replyUrl) || (attempts.get(replyUrl) ?? 0) >= 2) continue;
        const attempt = (attempts.get(replyUrl) ?? 0) + 1;
        attempts.set(replyUrl, attempt);
        pending.delete(replyUrl);
        reported.add(replyUrl);
        browser.runtime
          .sendMessage({ type: REPLY_SEEN, replyUrl, pageStatusId: clock.statusId })
          .then((response) => {
            if (response?.ok) {
              pending.delete(replyUrl);
              return;
            }
            reported.delete(replyUrl);
            if (attempt < 2) pending.set(replyUrl, link);
          })
          .catch(() => {
            reported.delete(replyUrl);
            if (attempt < 2) pending.set(replyUrl, link);
          });
      }
    }
    const observer = new MutationObserver(reportSentPosts);
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => observer.disconnect());

    ctx.setInterval(() => {
      const statusId = statusIdFromPath(window.location.pathname);
      const nowMs = Date.now();
      clock = tickAttention(clock, {
        statusId,
        nowMs,
        visible: document.visibilityState === "visible",
        focused: document.hasFocus(),
        postInView: enabled && statusId !== null && statusId === clock.statusId ? postInView() : false,
      }, memory);
      const remembered = rememberAttention(memory, clock);
      if (remembered !== memory) {
        memory = remembered;
        writeMemory(memory);
      }
      render(nowMs);
    }, TICK_MS);
  },
});
