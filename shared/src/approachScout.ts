import type { ThreadCard } from "./deskTypes";

export function pickApproachScout(threads: ThreadCard[]): ThreadCard | null {
  return threads[0] ?? null;
}
