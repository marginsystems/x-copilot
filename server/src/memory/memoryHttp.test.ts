import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tryHandleMemory } from "./memoryHttp.ts";

async function post(
  path: string,
  opts: { origin?: string; body?: unknown } = {},
): Promise<{ handled: boolean; status: number; body: Record<string, unknown> }> {
  const req = new EventEmitter() as unknown as IncomingMessage;
  const headers: Record<string, string> = {};
  if (opts.origin) headers.origin = opts.origin;
  Object.assign(req, {
    method: "POST",
    headers,
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
  const handledPromise = tryHandleMemory(
    req,
    res,
    new URL(`http://localhost${path}`),
  );
  if (opts.body !== undefined) {
    (req as EventEmitter).emit("data", Buffer.from(JSON.stringify(opts.body)));
  }
  (req as EventEmitter).emit("end");
  const handled = await handledPromise;
  return {
    handled,
    status,
    body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
  };
}

describe("memoryHttp", () => {
  it("rejects a non-local Origin on search", async () => {
    const { handled, status, body } = await post("/api/memory/search", {
      origin: "https://evil.example",
      body: { query: "hi" },
    });
    assert.equal(handled, true);
    assert.equal(status, 403);
    assert.equal(body.error, "forbidden");
  });

  it("rejects a non-local Origin on reindex", async () => {
    const { handled, status, body } = await post("/api/memory/reindex", {
      origin: "https://evil.example",
    });
    assert.equal(handled, true);
    assert.equal(status, 403);
    assert.equal(body.error, "forbidden");
  });

  it("rejects a missing search query", async () => {
    const { handled, status, body } = await post("/api/memory/search", {
      origin: "http://127.0.0.1:5173",
      body: {},
    });
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.equal(body.error, "bad_request");
  });

  it("ignores unrelated paths", async () => {
    const { handled, status } = await post("/api/usage", { body: {} });
    assert.equal(handled, false);
    assert.equal(status, 0);
  });
});
