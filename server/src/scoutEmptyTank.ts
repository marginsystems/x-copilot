/** One background sortie when a desk read finds no usable Scout posts. */
import { getUserById } from "./authStore.js";
import { creditsExhaustedResponse, sortiesExhaustedResponse } from "./billingQuotas.js";
import { ensureUserTenant } from "./billingStore.js";
import { ensureMemoryIndex } from "./memoryReindex.js";
import { runWithRequestContext } from "./requestContext.js";
import { attachScoutCacheFilters } from "./scoutCache.js";
import { runScoutCollect } from "./scoutCollect.js";
import { endScout, tryBeginScout } from "./scoutGate.js";
import { markSortieDelivered, recordSortie, refundSortie } from "./scoutSorties.js";
import type { ScoutFilters } from "./scoutTypes.js";
import { xLinkRequiredResponse } from "./xLinkGate.js";

export type ScoutEmptyTankDeps = {
  runScoutCollect?: typeof runScoutCollect;
  ensureMemoryIndex?: typeof ensureMemoryIndex;
};

/** Own the background lifetime, including failures; callers must not await it. */
export async function startEmptyTankScout(
  userId: string,
  filters?: ScoutFilters,
  deps: ScoutEmptyTankDeps = {},
): Promise<void> {
  let began = false;
  let sortieId: string | undefined;
  let coolCount = 0;
  try {
    const user = getUserById(userId);
    const agenda = user?.agenda?.trim();
    if (!user || !agenda || xLinkRequiredResponse(user)) return;
    const tenantId = ensureUserTenant(userId);
    const quota = { userId, tenantId, email: user.email };
    if (creditsExhaustedResponse(quota) || sortiesExhaustedResponse(quota)) return;
    if (!tryBeginScout(userId).ok) return;
    began = true;

    // Keep all usage and memory work attached to this operator after GET ends.
    await runWithRequestContext({ userId, tenantId }, async () => {
      await (deps.ensureMemoryIndex ?? ensureMemoryIndex)();
      sortieId = recordSortie(tenantId);
      const result = await (deps.runScoutCollect ?? runScoutCollect)({
        userId,
        agenda,
        queries: [],
        filters,
        sortieId,
        onEvent: (event) => {
          if (typeof event.coolCount === "number") {
            coolCount = Math.max(coolCount, event.coolCount);
          } else if (event.stage === "done" && Array.isArray(event.threads)) {
            coolCount = Math.max(coolCount, event.threads.length);
          }
        },
        deps: { creditGate: async () => creditsExhaustedResponse(quota) === null },
      });
      if (result.ok) {
        coolCount = result.event.coolCount ?? result.event.threads?.length ?? coolCount;
        await attachScoutCacheFilters(filters, { userId });
      }
    });
  } catch {
    // A failed background flight must not reject the desk read or log credentials.
    console.error("empty-tank Scout failed");
  } finally {
    try {
      if (sortieId) {
        if (coolCount > 0) markSortieDelivered(sortieId);
        else refundSortie(sortieId);
      }
    } catch {
      console.error("empty-tank Scout accounting failed");
    } finally {
      if (began) endScout(userId);
    }
  }
}
