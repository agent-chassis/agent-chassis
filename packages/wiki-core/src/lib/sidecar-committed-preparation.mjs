import { ensureSidecarIndex } from "./sidecar-ensure.mjs";
import { SidecarGraphIndexUnbuildableError } from "./sidecar-graph-impact-artifact.mjs";
import { resolveSidecarRepositoryIdentity } from "./sidecar-repository-identity.mjs";

export function unavailableCommittedSnapshot(outcome, status) {
  return new SidecarGraphIndexUnbuildableError(
    `repo code index snapshot is unavailable: ${outcome}`,
    { code: outcome, status }
  );
}

export function sameGraphSnapshot(publication, snapshot) {
  return publication?.store_incarnation === snapshot?.store_incarnation &&
    publication?.sequence === snapshot?.publication_sequence &&
    publication?.repository_commit === snapshot?.repository_commit &&
    publication?.repository_tree === snapshot?.repository_tree &&
    publication?.generator_identity === snapshot?.generator_identity;
}

export async function resolveCommittedSidecarSnapshot({
  dir = ".",
  cacheDir = undefined,
  signal = null,
  dirtyState = false,
  ensureIndex = ensureSidecarIndex
} = {}) {
  const ensured = await ensureIndex({ dir, cacheDir, signal, dirtyState });
  const status = ensured.status;
  const repoRoot = await resolveSidecarRepositoryIdentity({ dir: status.repo_root ?? dir });
  const snapshot = status.graph_snapshot;
  if (!snapshot || snapshot.repository_commit !== ensured.captured_head ||
      snapshot.repository_tree !== status.index_tree ||
      status.graph_state?.graph_available !== true) {
    return { available: false, outcome: "base_store_incompatible", status };
  }
  return {
    available: true,
    outcome: "available",
    repoRoot,
    status,
    graph_snapshot: structuredClone(snapshot),
    build: ensured.build
  };
}
