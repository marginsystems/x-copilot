import { describe, expect, it, vi } from "vitest";
import { SCOUT_VISIT, SCOUT_VISIT_ACCEPTED } from "../../../shared/src/scoutVisit";
import { answerScoutVisit, panelSide, relayScoutVisit } from "./scoutVisit";

describe("relayScoutVisit", () => {
  it("sends the visit to the extension and reports acceptance with the panel side", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    await expect(relayScoutVisit(send, "right")).resolves.toEqual({ type: SCOUT_VISIT_ACCEPTED, side: "right" });
    expect(send).toHaveBeenCalledWith({ type: SCOUT_VISIT });
  });

  it("reports nothing when no panel answers or the send fails", async () => {
    await expect(relayScoutVisit(vi.fn().mockResolvedValue(undefined), "left")).resolves.toBeNull();
    await expect(relayScoutVisit(vi.fn().mockResolvedValue({ ok: false }), "left")).resolves.toBeNull();
    await expect(relayScoutVisit(vi.fn().mockRejectedValue(new Error("no receiver")), "left")).resolves.toBeNull();
  });
});

describe("answerScoutVisit", () => {
  it("answers ok only for the visit message and only when the stage hosts", async () => {
    const host = vi.fn().mockReturnValue(true);
    await expect(answerScoutVisit({ type: SCOUT_VISIT }, host)).resolves.toEqual({ ok: true });
    expect(host).toHaveBeenCalledOnce();
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
