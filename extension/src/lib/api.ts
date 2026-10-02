import type { Pairing } from "./pairing";

export class UnpairedError extends Error {
  constructor() {
    super("The extension's sign-in expired. Connect it again from the desk.");
    this.name = "UnpairedError";
  }
}

export class ApiStatusError extends Error {
  readonly path: string;
  readonly status: number;

  constructor(path: string, status: number) {
    super(`${path} failed (${status})`);
    this.name = "ApiStatusError";
    this.path = path;
    this.status = status;
  }
}

export async function apiRequest(
  pairing: Pairing,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${pairing.apiBase}${path}`, {
    ...init,
    credentials: "omit",
    headers: { ...init.headers, Authorization: `Bearer ${pairing.token}` },
  });
  if (res.status === 401) throw new UnpairedError();
  if (!res.ok) throw new ApiStatusError(path, res.status);
  return res.json();
}
