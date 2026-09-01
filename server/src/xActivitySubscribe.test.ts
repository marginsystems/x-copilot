import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  X_ACTIVITY_SUBSCRIPTIONS_PATH,
  X_WEBHOOKS_PATH,
  findListedSubscriptionId,
  findListedWebhookId,
  registerActivityWebhook,
  subscriptionIdFromCreate,
  webhookIdFromCreate,
} from "./xActivitySubscribe.ts";

describe("XAA webhook paths", () => {
  it("lists and creates at /webhooks, not /activity/webhooks", () => {
    assert.equal(X_WEBHOOKS_PATH, "/webhooks");
    assert.notEqual(X_WEBHOOKS_PATH, "/activity/webhooks");
    assert.equal(X_ACTIVITY_SUBSCRIPTIONS_PATH, "/activity/subscriptions");
  });
});

describe("findListedWebhookId", () => {
  const url = "https://api.xcopilot.dev/api/x/activity";

  it("returns the id for a matching url", () => {
    assert.equal(
      findListedWebhookId(
        { data: [{ id: "wh-1", url }, { id: "wh-2", url: "https://other" }] },
        url,
      ),
      "wh-1",
    );
  });

  it("returns null when the url is absent or data is not a list", () => {
    assert.equal(findListedWebhookId({ data: [{ id: "wh-1", url: "https://other" }] }, url), null);
    assert.equal(findListedWebhookId({ data: { id: "wh-1", url } }, url), null);
    assert.equal(findListedWebhookId(null, url), null);
  });
});

describe("webhookIdFromCreate", () => {
  it("reads data.id from the official create shape", () => {
    assert.equal(
      webhookIdFromCreate({
        data: {
          id: "wh-9",
          url: "https://api.xcopilot.dev/api/x/activity",
          valid: true,
          created_at: "2026-09-01T00:00:00.000Z",
        },
      }),
      "wh-9",
    );
    assert.equal(webhookIdFromCreate({ data: {} }), null);
  });
});

describe("subscriptionIdFromCreate", () => {
  it("reads the official object shape and the list-shaped array", () => {
    assert.equal(
      subscriptionIdFromCreate({
        data: { subscription_id: "sub-obj", event_type: "post.create" },
      }),
      "sub-obj",
    );
    assert.equal(
      subscriptionIdFromCreate({
        data: [{ subscription_id: "sub-arr", event_type: "post.create" }],
      }),
      "sub-arr",
    );
    assert.equal(subscriptionIdFromCreate({ data: {} }), null);
  });
});

describe("findListedSubscriptionId", () => {
  it("matches post.create for that x user and webhook", () => {
    assert.equal(
      findListedSubscriptionId(
        {
          data: [
            {
              subscription_id: "other",
              event_type: "profile.update.bio",
              filter: { user_id: "99" },
              webhook_id: "wh-1",
            },
            {
              subscription_id: "mine",
              event_type: "post.create",
              filter: { user_id: "99" },
              webhook_id: "wh-1",
            },
          ],
        },
        "99",
        "wh-1",
      ),
      "mine",
    );
    assert.equal(
      findListedSubscriptionId(
        {
          data: [
            {
              subscription_id: "mine",
              event_type: "post.create",
              filter: { user_id: "1" },
              webhook_id: "wh-1",
            },
          ],
        },
        "99",
        "wh-1",
      ),
      null,
    );
    assert.equal(
      findListedSubscriptionId(
        {
          data: [
            {
              subscription_id: "old-webhook",
              event_type: "post.create",
              filter: { user_id: "99" },
              webhook_id: "wh-old",
            },
          ],
        },
        "99",
        "wh-current",
      ),
      null,
    );
  });
});

describe("registerActivityWebhook", () => {
  const url = "https://api.xcopilot.dev/api/x/activity";

  it("reuses a listed webhook and does not POST", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const id = await registerActivityWebhook({
      url,
      request: async (opts) => {
        calls.push({ method: opts.method, path: opts.path });
        return {
          ok: true,
          status: 200,
          json: { data: [{ id: "wh-listed", url }] },
        };
      },
    });
    assert.equal(id, "wh-listed");
    assert.deepEqual(calls, [{ method: "GET", path: "/webhooks" }]);
  });

  it("POSTs /webhooks when the list is empty", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const id = await registerActivityWebhook({
      url,
      request: async (opts) => {
        calls.push({ method: opts.method, path: opts.path, body: opts.body });
        if (opts.method === "GET") {
          return { ok: true, status: 200, json: { data: [] } };
        }
        if (opts.method === "POST") {
          return {
            ok: true,
            status: 200,
            json: { data: { id: "wh-new", url, valid: false } },
          };
        }
        return {
          ok: true,
          status: 204,
          json: null,
        };
      },
    });
    assert.equal(id, "wh-new");
    assert.deepEqual(calls, [
      { method: "GET", path: "/webhooks", body: undefined },
      { method: "POST", path: "/webhooks", body: { url } },
      { method: "PUT", path: "/webhooks/wh-new", body: undefined },
    ]);
  });

  it("registers a listed webhook that is invalid", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const id = await registerActivityWebhook({
      url,
      request: async (opts) => {
        calls.push({ method: opts.method, path: opts.path });
        if (opts.method === "GET") {
          return {
            ok: true,
            status: 200,
            json: { data: [{ id: "wh-invalid", url, valid: false }] },
          };
        }
        return { ok: true, status: 204, json: null };
      },
    });
    assert.equal(id, "wh-invalid");
    assert.deepEqual(calls, [
      { method: "GET", path: "/webhooks" },
      { method: "PUT", path: "/webhooks/wh-invalid" },
    ]);
  });

  it("returns null when create fails", async () => {
    const id = await registerActivityWebhook({
      url,
      request: async (opts) => {
        if (opts.method === "GET") {
          return { ok: true, status: 200, json: { data: [] } };
        }
        return { ok: false, status: 404, json: null };
      },
    });
    assert.equal(id, null);
  });
});
