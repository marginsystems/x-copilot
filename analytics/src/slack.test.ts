import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { postSlackWebhook } from "./slack.ts";

describe("postSlackWebhook", () => {
  it("POSTs text JSON to the webhook", async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response("ok", { status: 200 });
    };
    const ok = await postSlackWebhook(
      "https://hooks.slack.com/services/T/B/xxx",
      "*signup* · alice@example.com",
      fetchImpl,
    );
    assert.equal(ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://hooks.slack.com/services/T/B/xxx");
    assert.equal(
      calls[0].body,
      JSON.stringify({ text: "*signup* · alice@example.com" }),
    );
  });

  it("returns false on empty url, HTTP error, or throw", async () => {
    assert.equal(await postSlackWebhook("", "hi"), false);
    const fail: typeof fetch = async () => new Response("nope", { status: 500 });
    assert.equal(
      await postSlackWebhook("https://hooks.slack.com/x", "hi", fail),
      false,
    );
    const boom: typeof fetch = async () => {
      throw new Error("net");
    };
    assert.equal(
      await postSlackWebhook("https://hooks.slack.com/x", "hi", boom),
      false,
    );
  });
});
