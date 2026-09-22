import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { testRequest, testResponse } from "./http.testHelpers.ts";
import {
  BODY_CAP_16K,
  BODY_CAP_256K,
  BodyError,
  readBody,
  readJsonBody,
  send,
} from "./httpJson.ts";

function requestWithBody(chunks: Buffer[]): IncomingMessage {
  const req = testRequest();
  queueMicrotask(() => {
    for (const chunk of chunks) {
      req.emit("data", chunk);
    }
    req.emit("end");
  });
  return req;
}

async function readBodyNow(
  chunks: Buffer[],
  opts?: Parameters<typeof readBody>[1],
): Promise<unknown> {
  return readBody(requestWithBody(chunks), opts);
}

async function readJsonNow(
  chunks: Buffer[],
  opts?: Parameters<typeof readJsonBody>[1],
): Promise<Record<string, unknown> | null> {
  return readJsonBody(requestWithBody(chunks), opts);
}

await describe("httpJson readBody", async () => {
  await it("treats an empty body as {}", async () => {
    const body = await readBodyNow([]);
    assert.deepEqual(body, {});
  });

  await it("rejects invalid JSON with 400", async () => {
    await assert.rejects(
      () => readBodyNow([Buffer.from("{not json", "utf8")]),
      (err: unknown) => {
        assert.ok(err instanceof BodyError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.message, "Invalid JSON");
        return true;
      },
    );
  });

  await it("rejects bodies over 1 MB with 413", async () => {
    await assert.rejects(
      () => readBodyNow([Buffer.alloc(1_048_577)]),
      (err: unknown) => {
        assert.ok(err instanceof BodyError);
        assert.equal(err.statusCode, 413);
        assert.equal(err.message, "Request body exceeds 1 MB limit");
        return true;
      },
    );
  });

  await it("requireObject rejects JSON null", async () => {
    await assert.rejects(
      () =>
        readBodyNow([Buffer.from("null", "utf8")], { requireObject: true }),
      (err: unknown) => {
        assert.ok(err instanceof BodyError);
        assert.equal(err.statusCode, 400);
        return true;
      },
    );
  });

  await it("rejectArray rejects a JSON array (onboarding)", async () => {
    await assert.rejects(
      () =>
        readBodyNow([Buffer.from("[1]", "utf8")], {
          requireObject: true,
          rejectArray: true,
        }),
      (err: unknown) => {
        assert.ok(err instanceof BodyError);
        assert.equal(err.statusCode, 400);
        return true;
      },
    );
  });
});

await describe("httpJson readJsonBody", async () => {
  await it("defaults to 256 KiB and returns null on overflow (voice / for-you)", async () => {
    const body = await readJsonNow([Buffer.alloc(BODY_CAP_256K + 1)], {
      maxBytes: BODY_CAP_256K,
    });
    assert.equal(body, null);
  });

  await it("rejects 16 KiB overflow for admin grants", async () => {
    await assert.rejects(
      () =>
        readJsonNow([Buffer.alloc(BODY_CAP_16K + 1)], {
          maxBytes: BODY_CAP_16K,
          onLimit: "reject",
          trimEmpty: true,
        }),
      (err: unknown) => {
        assert.ok(err instanceof BodyError);
        assert.equal(err.statusCode, 413);
        assert.match(err.message, /16 KiB/);
        return true;
      },
    );
  });

  await it("preserves arrays and rejects scalar JSON in the object body reader", async () => {
    assert.deepEqual(await readJsonNow([Buffer.from('[1,{"ok":true}]')]), [1, { ok: true }]);
    for (const raw of ["null", "42", '"text"']) {
      assert.equal(await readJsonNow([Buffer.from(raw)]), null);
    }
  });

  await it("trimEmpty treats whitespace as {}", async () => {
    const body = await readJsonNow([Buffer.from("  \n", "utf8")], {
      trimEmpty: true,
    });
    assert.deepEqual(body, {});
  });
});

await describe("httpJson send", async () => {
  await it("writes JSON plus optional Set-Cookie", () => {
    const req = testRequest();
    const { res, captured: written } = testResponse(req);
    send(req, res, 200, { ok: true }, { "Set-Cookie": "sid=x; Path=/" });
    assert.equal(written.status, 200);
    assert.equal(written.raw, JSON.stringify({ ok: true }));
    const headers = written.headers;
    assert.equal(headers["Content-Type"], "application/json");
    assert.equal(headers["Set-Cookie"], "sid=x; Path=/");
  });
});
