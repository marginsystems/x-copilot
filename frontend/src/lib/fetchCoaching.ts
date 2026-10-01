import { apiFetch } from "./apiBase";
import {
  coachingPath,
  parseCoachingPayload,
  type CoachingFetchOptions,
  type CoachingState,
} from "../../../shared/src/coaching";

export async function fetchCoaching(
  opts?: CoachingFetchOptions,
): Promise<CoachingState | null> {
  try {
    const res = await apiFetch(coachingPath(opts));
    if (!res.ok) return null;
    return parseCoachingPayload(await res.json());
  } catch {
    return null;
  }
}
