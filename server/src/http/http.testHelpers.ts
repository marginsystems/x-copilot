import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse, type OutgoingHttpHeaders, type OutgoingHttpHeader } from "node:http";
import { Socket } from "node:net";
import { isRecord } from "../platform/unknownValue.js";

export function testRequest(): IncomingMessage {
  return new IncomingMessage(new Socket());
}

export function testResponse(req: IncomingMessage) {
  const captured: { status: number; headers: Record<string, unknown>; raw: string } = {
    status: 0,
    headers: {},
    raw: "",
  };
  const res = new ServerResponse(req);
  res.writeHead = (
    status: number,
    headersOrMessage?: string | OutgoingHttpHeaders | OutgoingHttpHeader[],
    headers?: OutgoingHttpHeaders | OutgoingHttpHeader[],
  ) => {
    captured.status = status;
    const values = typeof headersOrMessage === "string" ? headers : headersOrMessage;
    if (values && !Array.isArray(values)) captured.headers = values;
    return res;
  };
  res.end = (chunk: unknown) => {
    assert.equal(typeof chunk, "string");
    if (typeof chunk === "string") captured.raw = chunk;
    return res;
  };
  return { res, captured };
}

export function expectRecord(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value));
  return value;
}

export function expectRecords(value: unknown): Record<string, unknown>[] {
  assert.ok(Array.isArray(value));
  return value.map(expectRecord);
}
