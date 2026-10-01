import type { ThreadCard } from "../../../shared/src/deskTypes";

export function pickApproachScout(threads: ThreadCard[]): ThreadCard | null {
  return threads[0] ?? null;
}
