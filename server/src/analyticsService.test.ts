import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import {
  createAnalyticsServer,
  shouldRunAnalyticsMain,
} from "./analyticsService.ts";

function listen(server: ReturnType<typeof createAnalyticsServer>): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

async function close(server: ReturnType<typeof createAnalyticsServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe("shouldRunAnalyticsMain", () => {
  it("returns true for the analytics entry file", () => {
    assert.equal(
      shouldRunAnalyticsMain("/root/x-copilot/server/dist/analyticsService.js"),
      true,
    );
    assert.equal(
      shouldRunAnalyticsMain("/root/x-copilot/server/src/analyticsService.ts"),
      true,
    );
  });

  it("returns true under PM2 ProcessContainerFork when pm_id is set", () => {
    assert.equal(
      shouldRunAnalyticsMain(
        "/usr/lib/node_modules/pm2/lib/ProcessContainerFork.js",
        { pm_id: "2" },
      ),
      true,
    );
  });

  it("returns false for test-runner argv", () => {
    assert.equal(
      shouldRunAnalyticsMain("/root/x-copilot/node_modules/tsx/dist/cli.mjs", {}),
      false,
    );
  });
});

describe("analytics HTTP", () => {
  it("serves health and accepts a signed event", async () => {
    const slack: { url: string; body: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      slack.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response("ok", { status: 200 });
    };
    const server = createAnalyticsServer({
      secret: "s3cret",
      slackWebhookUrl: "https://hooks.slack.com/services/T/B/xxx",
      fetchImpl,
      now: () => new Date("2026-08-19T12:00:00.000Z"),
    });
    const base = await listen(server);
    try {
      const health = await fetch(`${base}/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { ok: true });

      const res = await fetch(`${base}/event`, {
        method: "POST",
        headers: {
          Authorization: "Bearer s3cret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "user.signup",
          email: "alice@example.com",
          provider: "google",
        }),
      });
      assert.equal(res.status, 202);
      assert.deepEqual(await res.json(), { ok: true });
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(slack.length, 1);
      assert.match(slack[0].body, /signup/);
      assert.match(slack[0].body, /alice@example.com/);
    } finally {
      await close(server);
    }
  });

  it("rejects a bad name and a missing bearer", async () => {
    const server = createAnalyticsServer({ secret: "s3cret" });
    const base = await listen(server);
    try {
      const bad = await fetch(`${base}/event`, {
        method: "POST",
        headers: {
          Authorization: "Bearer s3cret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "not.a.thing" }),
      });
      assert.equal(bad.status, 400);
      assert.deepEqual(await bad.json(), { error: "unknown_event" });

      const unauth = await fetch(`${base}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "user.signin" }),
      });
      assert.equal(unauth.status, 401);
    } finally {
      await close(server);
    }
  });

  it("accepts an event and logs when Slack is unset", async () => {
    const logs: string[] = [];
    const server = createAnalyticsServer({
      secret: "s3cret",
      log: (msg) => logs.push(msg),
    });
    const base = await listen(server);
    try {
      const res = await fetch(`${base}/event`, {
        method: "POST",
        headers: {
          Authorization: "Bearer s3cret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "scout.takeoff", detail: "2 queries" }),
      });
      assert.equal(res.status, 202);
      assert.equal(logs.length, 1);
      assert.match(logs[0], /takeoff/);
      assert.match(logs[0], /2 queries/);
    } finally {
      await close(server);
    }
  });
});
