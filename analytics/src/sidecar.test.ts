import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import {
  createAnalyticsServer,
  resolveAnalyticsPort,
  shouldRunAnalyticsMain,
} from "./sidecar.ts";

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
      shouldRunAnalyticsMain("/root/x-copilot/analytics/dist/sidecar.js"),
      true,
    );
    assert.equal(
      shouldRunAnalyticsMain("/root/x-copilot/analytics/src/sidecar.ts"),
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

  it("returns false for the API entry and test-runner argv", () => {
    assert.equal(
      shouldRunAnalyticsMain("/root/x-copilot/server/dist/index.js", {}),
      false,
    );
    assert.equal(
      shouldRunAnalyticsMain("/root/x-copilot/node_modules/tsx/dist/cli.mjs", {}),
      false,
    );
  });
});

describe("resolveAnalyticsPort", () => {
  it("defaults to 8788 and ignores PORT", () => {
    assert.equal(resolveAnalyticsPort({}), 8788);
    assert.equal(resolveAnalyticsPort({ PORT: "8787" }), 8788);
    assert.equal(resolveAnalyticsPort({ ANALYTICS_PORT: "9000" }), 9000);
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

  it("rejects browser-originated events when no secret is set", async () => {
    const server = createAnalyticsServer({ log: () => {} });
    const base = await listen(server);
    try {
      const browser = await fetch(`${base}/event`, {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "Sec-Fetch-Site": "cross-site",
          "Content-Type": "text/plain",
        },
        body: JSON.stringify({
          name: "user.signin",
          email: "victim@example.com",
        }),
      });
      assert.equal(browser.status, 401);

      const local = await fetch(`${base}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "user.signin" }),
      });
      assert.equal(local.status, 202);
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
