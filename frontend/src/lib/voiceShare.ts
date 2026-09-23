/**
 * User-triggered Voice-card PNG. They download (or share) their own card
 * and post it on X. Not a public URL, not an account page, and never a
 * watermark on replies they send.
 */
import { LEGAL_ENTITY, PRODUCT_NAME } from "./legal";
import type { VoiceState } from "./voice";

export const VOICE_SHARE_WIDTH = 1080;
export const VOICE_SHARE_HEIGHT = 1350;
export const VOICE_SHARE_SITE = "xcopilot.dev";
export const VOICE_SHARE_DISCLAIMER = `Built by ${LEGAL_ENTITY}. Not affiliated with X Corp.`;

const MAX_HABITS = 6;
const MAX_NEVER = 4;
const MAX_EXAMPLES = 3;

const C = {
  bg: "#161310",
  panel: "#1f1b17",
  raised: "#26211c",
  border: "#3a332c",
  borderStrong: "#4d453c",
  text: "#f4eee6",
  muted: "#a89f94",
  accent: "#7eb8dc",
  danger: "#d4847a",
};

const FONT_HEAD = '"Space Grotesk", "Segoe UI", sans-serif';
const FONT_BODY = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';

export type VoiceSharePayload = {
  starter: boolean;
  handle: string | null;
  replyCount: number;
  unlockAt: number;
  tone: string;
  typicalLength: string | null;
  habits: string[];
  neverDo: string[];
  examples: string[];
};

function cleanList(items: string[], cap: number): string[] {
  const out: string[] = [];
  for (const raw of items) {
    const item = raw.trim();
    if (!item) continue;
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

export function voiceSharePayload(voice: VoiceState | null): VoiceSharePayload | null {
  const card = voice?.card;
  if (!voice || !card?.tone.trim()) return null;
  const starter = card.starter === true || !voice.unlocked;
  if (starter) {
    return {
      starter: true,
      handle: voice.handle,
      replyCount: voice.replyCount,
      unlockAt: voice.unlockAt,
      tone: card.tone.trim(),
      typicalLength: null,
      habits: [],
      neverDo: [],
      examples: [],
    };
  }
  return {
    starter: false,
    handle: voice.handle,
    replyCount: voice.replyCount,
    unlockAt: voice.unlockAt,
    tone: card.tone.trim(),
    typicalLength: card.typicalLength.trim() || null,
    habits: cleanList(card.habits, MAX_HABITS),
    neverDo: cleanList(card.neverDo, MAX_NEVER),
    examples: cleanList(card.examples, MAX_EXAMPLES),
  };
}

export function voiceShareFilename(payload: VoiceSharePayload): string {
  const handle = (payload.handle ?? "").replace(/[^a-zA-Z0-9_]/g, "");
  return handle ? `xcopilot-voice-${handle}.png` : "xcopilot-voice.png";
}

export function voiceShareCaption(payload: VoiceSharePayload): string {
  const who = payload.handle ? `@${payload.handle} — ` : "";
  const head = payload.starter
    ? `${who}Starter Voice card from ${PRODUCT_NAME}. Tone only until ${payload.unlockAt} public posts.`
    : `${who}Here's what Voice learned from my last ${payload.replyCount} public posts.`;
  return [head, "", VOICE_SHARE_SITE, VOICE_SHARE_DISCLAIMER].join("\n");
}

export function wrapLines(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  const pushHard = (word: string) => {
    let chunk = "";
    for (const ch of word) {
      const next = chunk + ch;
      if (chunk && measure(next) > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk = next;
      }
    }
    current = chunk;
  };
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (measure(next) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (measure(word) > maxWidth) pushHard(word);
    else current = word;
  }
  if (current) lines.push(current);
  return lines;
}

export function ellipsize(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string {
  if (measure(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && measure(`${t}…`) > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

function capLines(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  const last = kept[max - 1] ?? "";
  kept[max - 1] = last.endsWith("…") ? last : `${last}…`;
  return kept;
}

type DrawCtx = {
  fillStyle: CanvasRenderingContext2D["fillStyle"];
  strokeStyle: CanvasRenderingContext2D["strokeStyle"];
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
  lineWidth: number;
  fillRect: CanvasRenderingContext2D["fillRect"];
  beginPath: CanvasRenderingContext2D["beginPath"];
  fill: CanvasRenderingContext2D["fill"];
  stroke: CanvasRenderingContext2D["stroke"];
  fillText: CanvasRenderingContext2D["fillText"];
  measureText: (text: string) => { width: number };
  createLinearGradient: (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) => { addColorStop: (offset: number, color: string) => void };
  roundRect: CanvasRenderingContext2D["roundRect"];
  moveTo: CanvasRenderingContext2D["moveTo"];
  lineTo: CanvasRenderingContext2D["lineTo"];
};

export function drawVoiceShareImage(
  ctx: DrawCtx,
  payload: VoiceSharePayload,
  width = VOICE_SHARE_WIDTH,
  height = VOICE_SHARE_HEIGHT,
): void {
  const padX = 80;
  const contentW = width - padX * 2;
  const footerTop = height - 148;
  const measure = (s: string) => ctx.measureText(s).width;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = C.panel;
  ctx.beginPath();
  ctx.roundRect(36, 36, width - 72, height - 72, 18);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  const wash = ctx.createLinearGradient(0, 36, 0, 360);
  wash.addColorStop(0, "rgba(126, 184, 220, 0.14)");
  wash.addColorStop(1, "rgba(22, 19, 16, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(36, 36, width - 72, 324);

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = C.text;
  ctx.font = `600 40px ${FONT_HEAD}`;
  ctx.fillText(PRODUCT_NAME, padX, 72);
  ctx.fillStyle = C.accent;
  ctx.font = `600 20px ${FONT_HEAD}`;
  ctx.textAlign = "right";
  ctx.fillText("VOICE", width - padX, 86);
  ctx.textAlign = "left";

  let y = 140;
  if (payload.handle) {
    ctx.fillStyle = C.accent;
    ctx.font = `500 30px ${FONT_BODY}`;
    ctx.fillText(
      ellipsize(`@${payload.handle}`, contentW, measure),
      padX,
      y,
    );
    y += 48;
  }

  ctx.fillStyle = C.muted;
  ctx.font = `600 18px ${FONT_HEAD}`;
  const kicker = payload.starter
    ? `STARTER CARD · TONE ONLY UNTIL ${payload.unlockAt} POSTS`
    : `LEARNED FROM ${payload.replyCount} PUBLIC POSTS`;
  ctx.fillText(ellipsize(kicker, contentW, measure), padX, y);
  y += 36;

  ctx.fillStyle = C.accent;
  ctx.fillRect(padX, y, 72, 4);
  y += 36;

  const room = () => y < footerTop - 48;

  const section = (label: string) => {
    if (!room()) return false;
    ctx.fillStyle = C.accent;
    ctx.font = `600 16px ${FONT_HEAD}`;
    ctx.fillText(label, padX, y);
    y += 28;
    return true;
  };

  const paragraph = (text: string, maxLines: number, color = C.text) => {
    ctx.font = `400 24px ${FONT_BODY}`;
    const lines = capLines(wrapLines(text, contentW, measure), maxLines);
    ctx.fillStyle = color;
    for (const line of lines) {
      if (!room()) break;
      ctx.fillText(line, padX, y);
      y += 34;
    }
    y += 16;
  };

  const chips = (items: string[], never: boolean) => {
    ctx.font = `400 20px ${FONT_BODY}`;
    let x = padX;
    const rowH = 42;
    const gap = 10;
    for (const raw of items) {
      if (y + rowH > footerTop) return;
      const label = ellipsize(raw, contentW - 36, measure);
      const w = Math.min(contentW, Math.ceil(measure(label) + 32));
      if (x + w > padX + contentW && x > padX) {
        x = padX;
        y += rowH + gap;
      }
      if (y + rowH > footerTop) return;
      ctx.fillStyle = never ? "rgba(212, 132, 122, 0.08)" : C.raised;
      ctx.strokeStyle = never ? C.danger : C.borderStrong;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, w, rowH, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = never ? C.danger : C.text;
      ctx.fillText(label, x + 16, y + 10);
      x += w + gap;
    }
    y += rowH + 24;
  };

  if (section("TONE")) paragraph(payload.tone, payload.starter ? 8 : 5);

  if (!payload.starter && payload.typicalLength && section("LENGTH")) {
    paragraph(payload.typicalLength, 2);
  }
  if (!payload.starter && payload.habits.length > 0 && section("HABITS")) {
    chips(payload.habits, false);
  }
  if (!payload.starter && payload.neverDo.length > 0 && section("NEVER")) {
    chips(payload.neverDo, true);
  }
  if (!payload.starter && payload.examples.length > 0 && section("IN YOUR WORDS")) {
    for (const example of payload.examples) {
      if (!room()) break;
      ctx.fillStyle = C.accent;
      ctx.fillRect(padX, y, 3, 8);
      ctx.font = `400 22px ${FONT_BODY}`;
      const lines = capLines(wrapLines(example, contentW - 24, measure), 3);
      ctx.fillStyle = C.text;
      for (const line of lines) {
        if (!room()) break;
        ctx.fillText(line, padX + 18, y);
        y += 32;
      }
      y += 14;
    }
  }

  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, footerTop);
  ctx.lineTo(width - padX, footerTop);
  ctx.stroke();

  ctx.fillStyle = C.accent;
  ctx.font = `600 24px ${FONT_HEAD}`;
  ctx.fillText(VOICE_SHARE_SITE, padX, footerTop + 24);
  ctx.fillStyle = C.muted;
  ctx.font = `400 16px ${FONT_BODY}`;
  ctx.fillText(VOICE_SHARE_DISCLAIMER, padX, footerTop + 62);
}

export function renderVoiceShareBlob(payload: VoiceSharePayload): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = VOICE_SHARE_WIDTH;
  canvas.height = VOICE_SHARE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Could not draw the Voice card."));
  drawVoiceShareImage(ctx, payload);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode PNG."))),
      "image/png",
    );
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function copyVoiceShareCaption(payload: VoiceSharePayload): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(voiceShareCaption(payload));
    return true;
  } catch {
    return false;
  }
}

export type VoiceShareResult = {
  method: "share" | "download";
  copiedCaption: boolean;
};

export async function shareVoiceCard(payload: VoiceSharePayload): Promise<VoiceShareResult> {
  const blob = await renderVoiceShareBlob(payload);
  const filename = voiceShareFilename(payload);
  const file = new File([blob], filename, { type: "image/png" });
  const caption = voiceShareCaption(payload);

  if (typeof navigator.share === "function") {
    try {
      const can = navigator.canShare?.({ files: [file] }) ?? false;
      if (can) {
        await navigator.share({ files: [file], text: caption, title: "Voice card" });
        return { method: "share", copiedCaption: false };
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
    }
  }

  triggerDownload(blob, filename);
  return { method: "download", copiedCaption: await copyVoiceShareCaption(payload) };
}
