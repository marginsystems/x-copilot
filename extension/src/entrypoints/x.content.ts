import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import {
  IDLE_CLOCK,
  attentionReady,
  chipView,
  parseAttentionMemory,
  rememberAttention,
  readySince,
  statusIdFromPath,
  tickAttention,
} from "../lib/attention";
import { REPLY_SEEN, WINDOW_FOCUSED } from "../lib/messages";
import { REPLY_PACE_MS, replyPaceRemainingMs } from "../../../shared/src/replyPace";
import { readReplyPaceAt } from "../lib/detectionStore";
import { parseReplyPaceAt, postedStatusUrl, REPLY_PACE_AT_KEY } from "../lib/replySeen";
import { ATTENTION_GATE_KEY, parseAttentionGate } from "../lib/settings";
import { readAttentionGate } from "../lib/settingsStore";
import { X_SELECTORS, chipPagePosition, rectInViewport } from "../lib/xSelectors";

const TICK_MS = 250;
const WINDOW_FOCUS_ASK_MS = 1_000;
const MEMORY_WRITE_MS = 1_000;
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

    let replyPaceAt: number | null = null;
    readAttentionGate().then((on) => { enabled = on; }, () => undefined);
    readReplyPaceAt().then((at) => { replyPaceAt = at; }, () => undefined);
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const change = changes[ATTENTION_GATE_KEY];
      if (change) enabled = parseAttentionGate(change.newValue);
      const paced = changes[REPLY_PACE_AT_KEY];
      if (paced) replyPaceAt = parseReplyPaceAt(paced.newValue);
    });

    let since: number | null = null;
    let placed = "";
    let renderedStatusId: string | null = null;
    let renderedGone = false;

    function hideChip() {
      since = null;
      renderedGone = false;
      chip.root.hidden = true;
    }

    function render(nowMs: number) {
      if (clock.statusId !== renderedStatusId) {
        renderedStatusId = clock.statusId;
        since = null;
        renderedGone = false;
      }
      if (!enabled || !clock.statusId) {
        hideChip();
        return;
      }
      const paceRemainingMs = replyPaceAt === null ? 0 : replyPaceRemainingMs(replyPaceAt + REPLY_PACE_MS, nowMs);
      if (paceRemainingMs <= 0 && renderedGone && attentionReady(clock)) return;
      const composer = document.querySelector(X_SELECTORS.replyComposer);
      const rect = composer?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        hideChip();
        return;
      }
      since = paceRemainingMs > 0 ? null : readySince(clock, since, nowMs);
      const shown = chipView(clock, since, paceRemainingMs, nowMs);
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
      if (chip.label.textContent !== shown.label) chip.label.textContent = shown.label;
      if (chip.count.textContent !== shown.count) chip.count.textContent = shown.count;
      chip.count.hidden = shown.count === "";
      chip.root.classList.toggle("ready", shown.ready);
      chip.root.classList.toggle("gone", shown.gone);
      chip.root.hidden = false;
      renderedGone = shown.gone;
    }

    const reported = new Set<string>();
    const attempts = new Map<string, number>();
    function reportSentPosts() {
      for (const link of document.body.querySelectorAll<HTMLAnchorElement>(X_SELECTORS.sentToastLink)) {
        const replyUrl = postedStatusUrl(link.getAttribute("href"));
        if (!replyUrl || reported.has(replyUrl) || (attempts.get(replyUrl) ?? 0) >= 2) continue;
        attempts.set(replyUrl, (attempts.get(replyUrl) ?? 0) + 1);
        reported.add(replyUrl);
        browser.runtime
          .sendMessage({ type: REPLY_SEEN, replyUrl, pageStatusId: clock.statusId })
          .then((response) => {
            if (!response?.ok) reported.delete(replyUrl);
          })
          .catch(() => {
            reported.delete(replyUrl);
          });
      }
    }

    let windowFocused = false;
    let askingWindowFocus = false;
    let windowFocusAskedAt = -Infinity;
    function askWindowFocus(nowMs: number) {
      if (askingWindowFocus || nowMs - windowFocusAskedAt < WINDOW_FOCUS_ASK_MS) return;
      askingWindowFocus = true;
      windowFocusAskedAt = nowMs;
      browser.runtime
        .sendMessage({ type: WINDOW_FOCUSED })
        .then(
          (response) => { windowFocused = response?.focused === true; },
          () => { windowFocused = false; },
        )
        .finally(() => { askingWindowFocus = false; });
    }

    let memoryDirty = false;
    let memoryWrittenAt = -Infinity;

    ctx.setInterval(() => {
      const statusId = statusIdFromPath(window.location.pathname);
      const nowMs = Date.now();
      const visible = document.visibilityState === "visible";
      const pageFocused = visible && document.hasFocus();
      const counting = statusId !== clock.statusId || !attentionReady(clock);
      const postIsInView = visible && enabled && statusId !== null && counting &&
        (statusId === clock.statusId || !pageFocused)
        ? postInView()
        : false;
      if (pageFocused) windowFocused = false;
      else if (postIsInView && !attentionReady(clock)) askWindowFocus(nowMs);
      clock = tickAttention(clock, {
        statusId,
        nowMs,
        visible,
        focused: pageFocused || windowFocused,
        postInView: postIsInView,
      }, memory);
      const remembered = rememberAttention(memory, clock);
      if (remembered !== memory) {
        memory = remembered;
        memoryDirty = true;
      }
      if (memoryDirty && (attentionReady(clock) || nowMs - memoryWrittenAt >= MEMORY_WRITE_MS)) {
        writeMemory(memory);
        memoryDirty = false;
        memoryWrittenAt = nowMs;
      }
      if (visible) {
        render(nowMs);
        reportSentPosts();
      }
    }, TICK_MS);
  },
});
