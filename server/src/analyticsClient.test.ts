import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  analyticsBaseUrl,
  analyticsClientEnabled,
  defaultAnalyticsUrl,
  trackAnalytics,
} from "./analyticsClient.ts";

describe("analyticsClientEnabled", () => {
  it("is on by default and ANALYTICS_DISABLE wins", () => {
    assert.equal(analyticsClientEnabled({}), true);
    assert.equal(
      analyticsClientEnabled({ ANALYTICS_URL: "http://127.0.0.1:8788" }),
      true,
    );
    assert.equal(
      analyticsClientEnabled({
        ANALYTICS_URL: "http://127.0.0.1:8788",
        ANALYTICS_DISABLE: "1",
      }),
      false,
    );
  });

  it("defaults to loopback 8788 and honors ANALYTICS_PORT", () => {
    assert.equal(defaultAnalyticsUrl({}), "http://127.0.0.1:8788");
    assert.equal(defaultAnalyticsUrl({ ANALYTICS_PORT: "9000" }), "http://127.0.0.1:9000");
    assert.equal(
      analyticsBaseUrl({ ANALYTICS_URL: "http://127.0.0.1:1/" }),
      "http://127.0.0.1:1/",
    );
  });
});

describe("trackAnalytics", () => {
  const prevUrl = process.env.ANALYTICS_URL;
  const prevSecret = process.env.ANALYTICS_SECRET;
  const prevDisable = process.env.ANALYTICS_DISABLE;

  beforeEach(() => {
    delete process.env.ANALYTICS_URL;
    delete process.env.ANALYTICS_SECRET;
    delete process.env.ANALYTICS_DISABLE;
  });

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.ANALYTICS_URL;
    else process.env.ANALYTICS_URL = prevUrl;
    if (prevSecret === undefined) delete process.env.ANALYTICS_SECRET;
    else process.env.ANALYTICS_SECRET = prevSecret;
    if (prevDisable === undefined) delete process.env.ANALYTICS_DISABLE;
    else process.env.ANALYTICS_DISABLE = prevDisable;
  });

  it("is a no-op when ANALYTICS_DISABLE=1", () => {
    process.env.ANALYTICS_DISABLE = "1";
    let called = 0;
    const fetchImpl: typeof fetch = async () => {
      called += 1;
      return new Response("ok", { status: 202 });
    };
    trackAnalytics({ name: "user.signup", email: "a@b.c" }, { fetchImpl });
    assert.equal(called, 0);
  });

  it("POSTs the loopback sidecar when ANALYTICS_URL is unset", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const started = new Promise<void>((resolveWait) => {
      resolveFetch = () => {
        resolveWait();
        return undefined as unknown as void;
      };
    });
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input));
      resolveFetch(new Response("ok", { status: 202 }));
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    };
    trackAnalytics({ name: "user.signup", email: "a@b.c" }, { fetchImpl });
    await started;
    assert.deepEqual(urls, ["http://127.0.0.1:8788/event"]);
  });

  it("POSTs /event with the bearer and does not await", async () => {
    process.env.ANALYTICS_URL = "http://127.0.0.1:8788/";
    process.env.ANALYTICS_SECRET = "s3cret";
    let resolveFetch: (value: Response) => void = () => {};
    const started = new Promise<void>((resolveWait) => {
      resolveFetch = () => {
        resolveWait();
        return undefined as unknown as void;
      };
    });
    const calls: { url: string; auth: string; body: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        auth: String(
          init?.headers &&
            typeof init.headers === "object" &&
            "Authorization" in init.headers
            ? (init.headers as Record<string, string>).Authorization
            : "",
        ),
        body: String(init?.body ?? ""),
      });
      resolveFetch(new Response("ok", { status: 202 }));
      return new Response(JSON.stringify({ ok: true }), { status: 202 });
    };
    trackAnalytics(
      {
        name: "scout.takeoff",
        userId: "u-1",
        handle: "@alice",
        detail: "2 queries",
      },
      { fetchImpl, now: () => new Date("2026-08-19T12:00:00.000Z") },
    );
    await started;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:8788/event");
    assert.equal(calls[0].auth, "Bearer s3cret");
    const body = JSON.parse(calls[0].body) as Record<string, unknown>;
    assert.equal(body.name, "scout.takeoff");
    assert.equal(body.handle, "alice");
    assert.equal(body.userId, "u-1");
    assert.equal(body.at, "2026-08-19T12:00:00.000Z");
  });

  it("swallows a rejected fetch", () => {
    process.env.ANALYTICS_URL = "http://127.0.0.1:9";
    const fetchImpl: typeof fetch = async () => {
      throw new Error("down");
    };
    assert.doesNotThrow(() =>
      trackAnalytics({ name: "user.signin" }, { fetchImpl }),
    );
  });

  it("swallows a throwing fetchImpl setup", () => {
    process.env.ANALYTICS_URL = "http://127.0.0.1:8788";
    const fetchImpl: typeof fetch = () => {
      throw new Error("sync");
    };
    assert.doesNotThrow(() =>
      trackAnalytics({ name: "scout.failed", ok: false }, { fetchImpl }),
    );
  });
});
