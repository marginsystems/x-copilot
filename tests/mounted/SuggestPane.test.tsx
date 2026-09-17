import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { SuggestPane } from "../../src/SuggestPane";
import { createSession, SessionContext } from "../../src/auth/session";
import { deferred } from "./support/deferred";

const usage = { used: 0, limit: 10, remaining: 10, canSuggest: true, planKey: "free" };
const draft = "A useful reference draft about building software.";
const edited = "I learned this the hard way: small experiments make debugging much easier for my team.";
function setup(compose = false) {
  const requests: { url: string; body: Record<string, unknown>; pending: ReturnType<typeof deferred<Response>> }[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
    const pending = deferred<Response>();
    requests.push({ url, body: JSON.parse(String(init.body)), pending });
    return pending.promise;
  }));
  const session = createSession();
  const onUsage = vi.fn();
  const onDeskPosted = vi.fn();
  const onOpenIntent = vi.fn();
  const view = render(<StrictMode><SessionContext.Provider value={session}>
    <SuggestPane threadId="thread" author="author" text="Original text" usage={usage}
      variant={compose ? "compose" : "reply"} suggestionId={compose ? "suggestion" : undefined}
      onUsage={onUsage} onDeskPosted={onDeskPosted} onOpenIntent={onOpenIntent} />
  </SessionContext.Provider></StrictMode>);
  const user = userEvent.setup();
  const respond = async (index: number, body: unknown, status = 200) => {
    await act(async () => { requests[index].pending.resolve(Response.json(body, { status })); });
  };
  const start = async () => {
    await user.click(screen.getByRole("button", { name: compose ? "Suggest post" : "Suggest reply" }));
  };
  const editing = async () => {
    await start();
    await respond(0, { ok: true, needed: false });
    await respond(1, { ok: true, draft, suggests: { ...usage, used: 1, remaining: 9 } });
    await user.type(screen.getByRole("textbox"), edited);
  };
  const verify = async () => { await user.click(screen.getByRole("button", { name: "Check my edit" })); };
  const pass = { ok: true, pass: true, canPost: true, intentUrl: "https://x.com/intent/post?text=edited" };
  return { ...view, session, requests, respond, start, editing, verify, pass, user, onUsage, onDeskPosted, onOpenIntent };
}

test("stance selection and close/reopen cannot spend twice while suggest is pending", async () => {
  const h = setup();
  await h.start();
  await h.respond(0, { ok: true, needed: true, options: ["Agree", "Disagree"], fallback: true });
  const side = screen.getByRole("button", { name: "Agree" });
  act(() => { fireEvent.click(side); fireEvent.click(side); });
  expect(h.requests).toHaveLength(2);
  expect(h.requests[1].body.stance).toBe("Agree");
  await h.user.click(screen.getByRole("button", { name: "Close" }));
  await h.start();
  expect(h.requests).toHaveLength(2);
  await h.respond(1, { ok: true, draft, suggests: { ...usage, used: 1 } });
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(h.onUsage).not.toHaveBeenCalled();
  await h.start();
  await h.respond(2, { ok: true, needed: false });
  await h.respond(3, { ok: true, draft });
  expect(screen.getByRole("textbox")).toBeTruthy();
});

test("a delayed stance lookup cannot start a suggest after close/reopen", async () => {
  const h = setup();
  await h.start();
  await h.user.click(screen.getByRole("button", { name: "Close" }));
  await h.start();
  await h.respond(0, { ok: true, needed: false });
  expect(h.requests).toHaveLength(2);
  await h.respond(1, { ok: true, needed: false });
  await h.respond(2, { ok: true, draft });
  expect(h.requests.filter(r => r.url.endsWith("/suggest"))).toHaveLength(1);
});

test("rejected verification keeps the edit; editing a pass relocks copy, open and post", async () => {
  const h = setup(true);
  await h.editing();
  await h.verify();
  await h.respond(2, { ok: true, pass: false, reason: "Make it personal." });
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(edited);
  expect(screen.getByText("Make it personal.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement).disabled).toBe(true);
  await h.verify();
  await h.respond(3, h.pass);
  expect(screen.getByRole("link", { name: "Open on X" }).getAttribute("href")).toBe(h.pass.intentUrl);
  expect(screen.getByRole("button", { name: "Post" })).toBeTruthy();
  await h.user.type(screen.getByRole("textbox"), " More.");
  expect(screen.queryByRole("link", { name: "Open on X" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
  expect((screen.getByRole("button", { name: "Copy" }) as HTMLButtonElement).disabled).toBe(true);
});

test.each(["http", "network"])("%s post failure preserves the edit and retries with the same key", async (failure) => {
  const h = setup(true);
  await h.editing();
  await h.verify();
  await h.respond(2, h.pass);
  await h.user.click(screen.getByRole("button", { name: "Post" }));
  const first = h.requests[3].body;
  expect(first.requestKey).toMatch(/^fy-suggestion-/);
  if (failure === "http") await h.respond(3, { ok: false, message: "Try again." }, 500);
  else await act(async () => { h.requests[3].pending.reject(new Error("offline")); });
  expect(h.onDeskPosted).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(edited);
  await h.user.click(screen.getByRole("button", { name: "Post" }));
  expect(h.requests[4].body).toEqual(first);
  await h.respond(4, { ok: true });
  expect(h.onDeskPosted).toHaveBeenCalledTimes(1);
  await h.user.type(screen.getByRole("textbox"), " More.");
  await h.verify();
  await h.respond(5, h.pass);
  await h.user.click(screen.getByRole("button", { name: "Post" }));
  expect(h.requests[6].body.requestKey).not.toBe(first.requestKey);
  await h.respond(6, { ok: true });
});

test.each(["stances", "suggest", "verify", "post"])("session invalidation ignores delayed %s work", async (phase) => {
  const h = setup(true);
  if (phase === "stances" || phase === "suggest") {
    await h.start();
    if (phase === "suggest") await h.respond(0, { ok: true, needed: false });
  } else {
    await h.editing();
    await h.verify();
    if (phase === "post") {
      await h.respond(2, h.pass);
      await h.user.click(screen.getByRole("button", { name: "Post" }));
    }
  }
  h.onUsage.mockClear();
  const count = h.requests.length;
  act(() => { h.session.invalidate("", false); });
  await h.respond(count - 1, { ...h.pass, needed: false, draft, suggests: usage });
  expect(h.requests).toHaveLength(count);
  expect(h.onUsage).not.toHaveBeenCalled();
  expect(h.onDeskPosted).not.toHaveBeenCalled();
  if (phase === "verify") expect(screen.queryByRole("link", { name: "Open on X" })).toBeNull();
});

test.each(["verify", "post"])("close ignores a delayed %s result", async (phase) => {
  const h = setup(true);
  await h.editing();
  await h.verify();
  if (phase === "post") {
    await h.respond(2, h.pass);
    await h.user.click(screen.getByRole("button", { name: "Post" }));
  }
  await h.user.click(screen.getByRole("button", { name: "Close" }));
  await h.respond(h.requests.length - 1, h.pass);
  expect(screen.getByRole("button", { name: "Suggest post" })).toBeTruthy();
  expect(h.onDeskPosted).not.toHaveBeenCalled();
});

test("reply verification keeps its payload and opens the existing intent flow", async () => {
  const h = setup();
  await h.editing();
  expect(h.onUsage).toHaveBeenCalledWith({ ...usage, used: 1, remaining: 9 });
  await h.verify();
  expect(h.requests[2].body).toEqual({ draft, edited, inReplyToId: "thread" });
  await h.respond(2, h.pass);
  expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Open on X" }));
  expect(h.onOpenIntent).toHaveBeenCalledTimes(1);
});

test("unmount ignores a delayed suggest and its usage callback", async () => {
  const h = setup();
  await h.start();
  await h.respond(0, { ok: true, needed: false });
  h.unmount();
  await h.respond(1, { ok: true, draft, suggests: usage });
  expect(h.onUsage).not.toHaveBeenCalled();
});
