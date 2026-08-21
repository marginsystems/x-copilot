/**
 * JSON request/response helpers for the sidecar HTTP server.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { corsHeaders } from "./cors.js";

export const BODY_CAP_1MB = 1_048_576;
export const BODY_CAP_256K = 262_144;
export const BODY_CAP_16K = 16_384;

export function send(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string | string[]>,
): void {
  const json = JSON.stringify(body);
  const headers: Record<string, string | string[]> = {
    "Content-Type": "application/json",
    ...corsHeaders(req),
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(json);
}

export class BodyError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type ReadBodyOptions = {
  maxBytes?: number;
  /** Reject JSON null / string / number. Arrays still pass unless rejectArray. */
  requireObject?: boolean;
  rejectArray?: boolean;
};

export function readBody(
  req: IncomingMessage,
  opts?: ReadBodyOptions,
): Promise<unknown> {
  const maxBytes = opts?.maxBytes ?? BODY_CAP_1MB;
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new BodyError(limitMessage(maxBytes), 413));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolveBody({});
      try {
        const parsed: unknown = JSON.parse(raw);
        if (opts?.requireObject) {
          if (!parsed || typeof parsed !== "object") {
            reject(new BodyError("Invalid JSON", 400));
            return;
          }
        }
        if (opts?.rejectArray && Array.isArray(parsed)) {
          reject(new BodyError("Invalid JSON", 400));
          return;
        }
        resolveBody(parsed);
      } catch (err) {
        if (err instanceof BodyError) {
          reject(err);
          return;
        }
        reject(new BodyError("Invalid JSON", 400));
      }
    });
    req.on("error", reject);
  });
}

export type ReadJsonBodyOptions = {
  maxBytes?: number;
  /** `null` matches voice / for-you. `reject` matches admin (413 + BodyError). */
  onLimit?: "null" | "reject";
  /** Admin treats whitespace-only as {}. Voice / for-you do not trim. */
  trimEmpty?: boolean;
};

export function readJsonBody(
  req: IncomingMessage,
  opts?: ReadJsonBodyOptions,
): Promise<Record<string, unknown> | null> {
  const maxBytes = opts?.maxBytes ?? BODY_CAP_256K;
  const onLimit = opts?.onLimit ?? "null";
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let limited = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        limited = true;
        if (onLimit === "reject") {
          reject(new BodyError(limitMessage(maxBytes), 413));
        } else {
          resolve(null);
        }
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (limited) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (opts?.trimEmpty ? !raw.trim() : !raw) return resolve({});
      try {
        const parsed = JSON.parse(raw) as unknown;
        resolve(
          parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : null,
        );
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function limitMessage(maxBytes: number): string {
  if (maxBytes === BODY_CAP_16K) return "Request body exceeds 16 KiB limit";
  if (maxBytes === BODY_CAP_256K) return "Request body exceeds 256 KiB limit";
  if (maxBytes === BODY_CAP_1MB) return "Request body exceeds 1 MB limit";
  return `Request body exceeds ${maxBytes} byte limit`;
}
