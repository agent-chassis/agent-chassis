import { resolveCommittedSidecarSnapshot, unavailableCommittedSnapshot } from "./sidecar-committed-preparation.mjs";

export async function prepareCommittedQuery({ dir, cacheDir }, context = null) {
  const prepared = typeof context?.prepare === "function"
    ? await context.prepare({ dir, cacheDir })
    : await resolveCommittedSidecarSnapshot({ dir, cacheDir, dirtyState: true });
  if (!prepared.available) throw unavailableCommittedSnapshot(prepared.outcome, prepared.status);
  return prepared;
}

const SNAPSHOT_QUERY_MAX_PASSES = 3;

export async function runSnapshotQuery(context, evaluate) {
  for (let pass = 1; ; pass += 1) {
    try {
      return await evaluate();
    } catch (error) {
      if (error?.code !== "repository_snapshot_changed" || context?.repeatOnPublication !== true ||
          pass >= SNAPSHOT_QUERY_MAX_PASSES) throw error;
    }
  }
}
