import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tryHandleHistory } from "./historyHttp.ts";

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ handled: boolean; status: number; json: Record<string, unknown> }> {
  const req = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(req, {
    method,
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  });
  let status = 0;
  let raw = "";
  const res = {
    writeHead: (code: number) => {
      status = code;
    },
    end: (chunk: string) => {
      raw = chunk;
    },
  } as unknown as ServerResponse;
  const handledPromise = tryHandleHistory(
    req,
    res,
    new URL(`http://localhost${path}`),
  );
  if (body !== undefined) {
    (req as EventEmitter).emit("data", Buffer.from(JSON.stringify(body)));
  }
  (req as EventEmitter).emit("end");
  const handled = await handledPromise;
  return {
    handled,
    status,
    json: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
  };
}

describe("historyHttp", () => {
  it("GET /api/expired returns expired + expiredIds", async () => {
    const { handled, status, json } = await call("GET", "/api/expired");
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.expired));
    assert.ok(Array.isArray(json.expiredIds));
  });

  it("GET /api/dismissed strips authorKey from the list", async () => {
    const { handled, status, json } = await call("GET", "/api/dismissed");
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.dismissals));
    assert.ok(Array.isArray(json.dismissedIds));
    for (const row of json.dismissals as Record<string, unknown>[]) {
      assert.equal("authorKey" in row, false);
    }
  });

  it("GET /api/skipped strips authorKey from the list", async () => {
    const { handled, status, json } = await call("GET", "/api/skipped");
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.skipped));
    assert.ok(Array.isArray(json.skippedIds));
    for (const row of json.skipped as Record<string, unknown>[]) {
      assert.equal("authorKey" in row, false);
    }
  });

  it("POST /api/skipped rejects a missing threadId or author", async () => {
    const { handled, status, json } = await call("POST", "/api/skipped", {
      threadId: "t1",
    });
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.equal(json.error, "bad_request");
  });

  it("POST /api/dismissed rejects a missing threadId or author", async () => {
    const { handled, status, json } = await call("POST", "/api/dismissed", {
      author: "@x",
    });
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.equal(json.error, "bad_request");
  });

  it("ignores unrelated paths", async () => {
    const { handled, status } = await call("GET", "/api/interacted");
    assert.equal(handled, false);
    assert.equal(status, 0);
  });
});
