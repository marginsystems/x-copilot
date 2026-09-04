import assert from "node:assert/strict";
import { once } from "node:events";
import { afterEach, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import { createWebhookServer } from "./sidecar.ts";

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
