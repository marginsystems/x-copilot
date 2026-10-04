import { describe, expect, it, vi } from "vitest";
import { SCOUT_VISIT, SCOUT_VISIT_ACCEPTED } from "../../../shared/src/scoutVisit";
import { answerScoutVisit, measureStageShift, panelSide, relayScoutVisit } from "./scoutVisit";

const visit = { type: SCOUT_VISIT, groundFromBottomPx: 58 } as const;

describe("relayScoutVisit", () => {
  it("sends the visit to the extension and reports acceptance with the panel side", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    await expect(relayScoutVisit(send, "right", visit)).resolves.toEqual({ type: SCOUT_VISIT_ACCEPTED, side: "right" });
    expect(send).toHaveBeenCalledWith({ type: SCOUT_VISIT, groundFromBottomPx: 58 });
  });

  it("passes the desk's ground distance on to the panel, or null when the desk sent none", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    await relayScoutVisit(send, "left", { type: SCOUT_VISIT, groundFromBottomPx: null });
    expect(send).toHaveBeenCalledWith({ type: SCOUT_VISIT, groundFromBottomPx: null });
  });

  it("reports nothing when no panel answers or the send fails", async () => {
    await expect(relayScoutVisit(vi.fn().mockResolvedValue(undefined), "left", visit)).resolves.toBeNull();
    await expect(relayScoutVisit(vi.fn().mockResolvedValue({ ok: false }), "left", visit)).resolves.toBeNull();
    await expect(relayScoutVisit(vi.fn().mockRejectedValue(new Error("no receiver")), "left", visit)).resolves.toBeNull();
  });
});

describe("answerScoutVisit", () => {
  it("answers ok only for the visit message and only when the stage hosts", async () => {
    const host = vi.fn().mockReturnValue(true);
    await expect(answerScoutVisit({ type: SCOUT_VISIT }, host)).resolves.toEqual({ ok: true });
    expect(host).toHaveBeenCalledExactlyOnceWith({ type: SCOUT_VISIT, groundFromBottomPx: null });
  });

  it("hands the stage the strictly parsed ground distance", () => {
    const host = vi.fn().mockReturnValue(true);
    answerScoutVisit({ type: SCOUT_VISIT, groundFromBottomPx: 58 }, host);
    answerScoutVisit({ type: SCOUT_VISIT, groundFromBottomPx: "58" }, host);
    answerScoutVisit({ type: SCOUT_VISIT, groundFromBottomPx: Number.NaN }, host);
    expect(host.mock.calls.map((call) => call[0])).toEqual([
      { type: SCOUT_VISIT, groundFromBottomPx: 58 },
      { type: SCOUT_VISIT, groundFromBottomPx: null },
      { type: SCOUT_VISIT, groundFromBottomPx: null },
    ]);
  });

  it("stays silent for other messages without touching the stage", () => {
    const host = vi.fn().mockReturnValue(true);
    expect(answerScoutVisit({ type: "x-copilot:reply-seen" }, host)).toBeUndefined();
    expect(answerScoutVisit("x-copilot:scout-visit", host)).toBeUndefined();
    expect(host).not.toHaveBeenCalled();
  });

  it("stays silent when the stage cannot host", () => {
    expect(answerScoutVisit({ type: SCOUT_VISIT }, () => false)).toBeUndefined();
  });
});

describe("panelSide", () => {
  it("is a page side", () => {
    expect(["left", "right"]).toContain(panelSide());
  });
});

function rectOf(top: number, bottom: number) {
  return { getBoundingClientRect: () => ({ top, bottom }) };
}

function stageIn(opts: { canvas: [number, number]; above?: [number, number]; belowTop?: number }) {
  const parent = { nextElementSibling: opts.belowTop === undefined ? null : rectOf(opts.belowTop, opts.belowTop + 16) };
  return Object.assign(rectOf(...opts.canvas), {
    previousElementSibling: opts.above ? rectOf(...opts.above) : null,
    parentElement: parent,
  }) as unknown as HTMLElement;
}

describe("measureStageShift", () => {
  it("lowers the panel stage by how much its ground sits above the desk's", () => {
    const canvas = stageIn({ canvas: [468, 600], above: [440, 460], belowTop: 612 });
    expect(measureStageShift(canvas, 98, 700)).toBe(12);
  });

  it("raises it when the ground sits below the desk's, as far as the gap above allows", () => {
    const canvas = stageIn({ canvas: [468, 600], above: [440, 460], belowTop: 612 });
    expect(measureStageShift(canvas, 118, 700)).toBe(-8);
    expect(measureStageShift(canvas, 125, 700)).toBe(-8);
  });

  it("stops at the free room below and does nothing without a desk distance", () => {
    const canvas = stageIn({ canvas: [468, 600], above: [440, 460], belowTop: 612 });
    expect(measureStageShift(canvas, 91, 700)).toBe(19);
    expect(measureStageShift(canvas, 78, 700)).toBe(19);
    expect(measureStageShift(canvas, null, 700)).toBe(0);
    const tight = stageIn({ canvas: [468, 600], above: [468, 468] });
    expect(measureStageShift(tight, 100, 700)).toBe(7);
    expect(measureStageShift(tight, 120, 700)).toBe(0);
  });
});
