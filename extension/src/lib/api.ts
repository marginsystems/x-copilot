import type { Pairing } from "./pairing";

export class UnpairedError extends Error {
  constructor() {
    super("The extension's sign-in expired. Connect it again from the desk.");
    this.name = "UnpairedError";
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
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return res.json();
}
