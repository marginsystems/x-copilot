import type { ThreadCard } from "./types";

export function pickApproachScout(threads: ThreadCard[]): ThreadCard | null {
  return threads[0] ?? null;
}
