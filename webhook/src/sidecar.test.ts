import assert from "node:assert/strict";
import { once } from "node:events";
import { afterEach, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import {
  createWebhookServer,
  shouldRunWebhookMain,
} from "./sidecar.ts";

const servers = new Set<ReturnType<typeof createWebhookServer>>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  servers.clear();
});

describe("shouldRunWebhookMain", () => {
  it("returns true for the webhook entry file", () => {
    assert.equal(
      shouldRunWebhookMain("/root/x-copilot/webhook/src/sidecar.ts"),
      true,
    );
    assert.equal(
      shouldRunWebhookMain(
        "/root/x-copilot/webhook/dist/webhook/src/sidecar.js",
      ),
      true,
    );
  });

  it("returns true under PM2 when XCOPILOT_ROLE=webhook", () => {
    assert.equal(
      shouldRunWebhookMain(
        "/usr/lib/node_modules/pm2/lib/ProcessContainerFork.js",
        { XCOPILOT_ROLE: "webhook", pm_id: "3" },
      ),
      true,
    );
  });

  it("returns false for ProcessContainerFork without the webhook role", () => {
    assert.equal(
      shouldRunWebhookMain(
        "/usr/lib/node_modules/pm2/lib/ProcessContainerFork.js",
        { pm_id: "3" },
      ),
      false,
    );
    assert.equal(
      shouldRunWebhookMain(
        "/usr/lib/node_modules/pm2/lib/ProcessContainerFork.js",
        { XCOPILOT_ROLE: "api", pm_id: "0" },
      ),
      false,
    );
  });
});

describe("webhook process", () => {
  it("answers the loopback health check", async () => {
    const server = createWebhookServer();
    servers.add(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const response = await fetch(`http://127.0.0.1:${port}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
});
