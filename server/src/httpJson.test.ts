import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { BodyError, readBody } from "./httpJson.ts";

function requestWithBody(chunks: Buffer[]): Promise<unknown> {
  const req = new EventEmitter() as unknown as IncomingMessage;
  const pending = readBody(req);
  for (const chunk of chunks) {
    (req as EventEmitter).emit("data", chunk);
  }
  (req as EventEmitter).emit("end");
  return pending;
}

describe("httpJson readBody", () => {
  it("treats an empty body as {}", async () => {
    const body = await requestWithBody([]);
    assert.deepEqual(body, {});
  });

  it("rejects invalid JSON with 400", async () => {
    await assert.rejects(
      () => requestWithBody([Buffer.from("{not json", "utf8")]),
      (err: unknown) => {
        assert.ok(err instanceof BodyError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.message, "Invalid JSON");
        return true;
      },
    );
  });

  it("rejects bodies over 1 MB with 413", async () => {
    await assert.rejects(
      () => requestWithBody([Buffer.alloc(1_048_577)]),
      (err: unknown) => {
        assert.ok(err instanceof BodyError);
        assert.equal(err.statusCode, 413);
        assert.equal(err.message, "Request body exceeds 1 MB limit");
        return true;
      },
    );
  });
});
