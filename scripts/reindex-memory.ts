/**
 * Rebuild the local knowledge memory embedding index.
 * Usage: npx tsx scripts/reindex-memory.ts
 */
import { reindexMemory, resolveIndexPaths } from "../server/src/memoryIndex.ts";

async function main(): Promise<void> {
  const paths = resolveIndexPaths();
  console.log(`knowledge: ${paths.knowledgeRoot}`);
  console.log(`index:     ${paths.indexDir}`);
  const result = await reindexMemory();
  if (!result.ok) {
    console.error(`reindex failed: ${result.error ?? "unknown error"}`);
    process.exitCode = 1;
    return;
  }
  console.log(`indexed=${result.indexed} skipped=${result.skipped}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
