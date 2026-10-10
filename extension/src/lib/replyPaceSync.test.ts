import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergeReplyPaceAt,
  newestReplyIso,
  newestReplyMs,
  paceReplies,
  onlyReplyPaceChanged,
  resetReplyPaceSync,
  storeServerReplyPace,
  syncReplyPace,
} from "./replyPaceSync";

const state = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  stored: {} as Record<string, unknown>,
  set: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: state.stored[key] }),
        set: state.set,
      },
    },
  },
}));

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  apiRequest: state.apiRequest,
}));

const pairing = { apiBase: "https://desk.example", token: "token", expiresAt: "2026-11-01T00:00:00.000Z", deskOrigin: "https://desk.example" };
const at = (ms: number) => new Date(ms).toISOString();

describe("reply pace from the server", () => {
  beforeEach(() => {
    state.apiRequest.mockReset();
    state.set.mockReset();
    state.set.mockImplementation(async (values: Record<string, unknown>) => { Object.assign(state.stored, values); });
    for (const key of Object.keys(state.stored)) delete state.stored[key];
    resetReplyPaceSync();
  });

  it("reads the newest reply time", () => {
    expect(newestReplyMs([at(2_000_000), at(5_000_000), "nope"])).toBe(5_000_000);
    expect(newestReplyMs([])).toBeNull();
    expect(newestReplyMs(undefined)).toBeNull();
  });

  it("counts a reply the X webhook saw, such as one sent from a phone, when it is newer than the desk's", () => {
    const phoneReply = { id: "9", url: "https://x.com/me/status/9", text: "", kind: "reply" as const, postedAt: at(5_000_000) };
    expect(newestReplyIso({ replyAt: [at(2_000_000)], ownActivity: phoneReply })).toBe(at(5_000_000));
    expect(newestReplyIso({ replyAt: [at(6_000_000)], ownActivity: phoneReply })).toBe(at(6_000_000));
    expect(newestReplyIso({ replyAt: [at(2_000_000)], ownActivity: { ...phoneReply, kind: "original" } })).toBe(at(2_000_000));
    expect(newestReplyIso({ replyAt: [], ownActivity: phoneReply })).toBe(at(5_000_000));
    expect(newestReplyIso(null)).toBeNull();
    expect(paceReplies({ replyAt: [at(2_000_000)], paceReplyAt: at(5_000_000) })).toEqual([at(5_000_000), at(2_000_000)]);
    expect(paceReplies({ replyAt: [at(2_000_000)] })).toEqual([at(2_000_000)]);
  });

  it("takes the server's time, except when this browser saw a newer reply the server does not have yet", () => {
    expect(mergeReplyPaceAt(null, 1_000_000)).toBe(1_000_000);
    expect(mergeReplyPaceAt(1_000_000, null)).toBe(1_000_000);
    expect(mergeReplyPaceAt(1_000_000, 1_030_000)).toBe(1_030_000);
    expect(mergeReplyPaceAt(1_002_000, 1_000_000)).toBe(1_000_000);
    expect(mergeReplyPaceAt(1_030_000, 1_000_000)).toBe(1_030_000);
  });

  it("stores a reply made elsewhere, and writes nothing when the time is unchanged", async () => {
    await storeServerReplyPace([at(1_000_000)]);
    expect(state.stored.lastReplyPaceAt).toBe(1_000_000);
    await storeServerReplyPace([at(1_000_000)]);
    await storeServerReplyPace([]);
    expect(state.set).toHaveBeenCalledTimes(1);
  });

  it("fetches the lite coaching read for a paired extension, at most once per five seconds", async () => {
    state.apiRequest.mockResolvedValue({
      dayUtc: "2026-10-10",
      missions: [],
      replyAt: [at(900_000)],
      ownActivity: { id: "9", url: "https://x.com/me/status/9", text: "", kind: "reply", postedAt: at(1_000_000) },
    });

    expect(await syncReplyPace(null, 50_000)).toBe(false);
    expect(state.apiRequest).not.toHaveBeenCalled();

    expect(await syncReplyPace(pairing, 50_000)).toBe(true);
    expect(state.apiRequest).toHaveBeenCalledWith(pairing, "/api/coaching?lite=1");
    expect(state.stored.lastReplyPaceAt).toBe(1_000_000);

    expect(await syncReplyPace(pairing, 54_000)).toBe(true);
    expect(state.apiRequest).toHaveBeenCalledTimes(1);
    expect(await syncReplyPace(pairing, 55_000)).toBe(true);
    expect(state.apiRequest).toHaveBeenCalledTimes(2);
  });

  it("tells a change of only the reply time from any other storage change", () => {
    expect(onlyReplyPaceChanged({ lastReplyPaceAt: {} })).toBe(true);
    expect(onlyReplyPaceChanged({ lastReplyPaceAt: {}, lastReplySeenAt: {} })).toBe(false);
    expect(onlyReplyPaceChanged({})).toBe(false);
  });
});
