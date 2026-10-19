import path from "node:path";

import { classifySidecarPreparation } from "./sidecar-incremental.mjs";
import { sidecarRefreshCoordinator } from "./sidecar-refresh.mjs";
import {
  assertSidecarCachePathIgnored,
  createSidecarIndexStatusEnvelope,
  discoverSidecarGitState,
  qualifyPublishedSidecarFreshness,
  resolveSidecarArtifactPath
} from "./sidecar-status.mjs";
import { readSidecarStoreStatus } from "./sidecar-store.mjs";

export const SIDECAR_PUBLISHED_INDEX_UNAVAILABLE_CODE = "sidecar_published_index_unavailable";

export class SidecarPublishedIndexUnavailableError extends Error {
  constructor(indexState) {
    super(`no usable published code index: ${indexState.reason}`);
    this.name = "SidecarPublishedIndexUnavailableError";
    this.code = SIDECAR_PUBLISHED_INDEX_UNAVAILABLE_CODE;
    this.index_state = indexState;
  }
}

function publicationIdentity(publication) {
  return { store_incarnation: publication.store_incarnation, sequence: publication.sequence,
    repository_commit: publication.repository_commit };
}

async function publishedUsability(store) {
  if (store.state !== "available") {
    return { usable: false, reason: store.state === "missing" ? "index_missing" : `index_${store.state}` };
  }
  if (!store.publication?.repository_commit) return { usable: false, reason: "index_unpublished" };
  const classification = await classifySidecarPreparation({ publication: store.publication,
    requestedCommit: store.publication.repository_commit,
    requestedInputIdentity: store.publication.base_coverage?.checkout_identity, providerInputsChanged: async () => false });
  return classification.action === "clean"
    ? { usable: false, reason: classification.reason }
    : { usable: true, classification };
}

export async function resolvePublishedSidecarSnapshot({
  dir = ".",
  cacheDir = undefined,
  dirtyState = true,
  refresh = sidecarRefreshCoordinator()
} = {}) {
  const gitState = await discoverSidecarGitState(path.resolve(String(dir || ".")), { dirtyState });
  if (gitState.dirty_state === "non_git" || !gitState.index_head) {
    throw new SidecarPublishedIndexUnavailableError({ state: "unavailable", reason: "repository_unavailable",
      indexed_commit: null, current_head: null, freshness: "unknown", refresh: null });
  }
  const artifactPaths = resolveSidecarArtifactPath({ repoRoot: gitState.repoRoot, cacheDir });

  await assertSidecarCachePathIgnored({ repoRoot: gitState.repoRoot, cacheDir: artifactPaths.cacheDir,
    artifactRelativePath: artifactPaths.artifactRelativePath });
  const store = readSidecarStoreStatus({ repoRoot: gitState.repoRoot, cacheDir: artifactPaths.cacheDir });
  const usability = await publishedUsability(store);
  const refreshState = refresh === false ? null : refresh.request({ repoRoot: gitState.repoRoot, cacheDir: artifactPaths.cacheDir,
    currentHead: gitState.index_head,
    publication: usability.usable ? publicationIdentity(store.publication) : null });
  if (!usability.usable) {
    throw new SidecarPublishedIndexUnavailableError({ state: "unavailable", reason: usability.reason,
      artifact_exists: store.artifact_exists,
      artifact_schema_version: store.observed_store_schema_version ?? null,
      expected_artifact_schema_version: store.required_store_schema_version,
      cause: store.error_message ? { code: store.error_code, message: store.error_message } : null,
      recovery: refreshState ?? { state: "unavailable", reason: "refresh_not_requested" },
      indexed_commit: null, current_head: gitState.index_head,
      freshness: store.state === "missing" ? "missing" : "rebuild_required", refresh: refreshState });
  }
  const described = createSidecarIndexStatusEnvelope({ gitState, artifactPaths, store,
    classification: usability.classification });
  const status = qualifyPublishedSidecarFreshness(described, store.publication, gitState.index_head);
  return {
    available: true,
    outcome: "available",
    repoRoot: gitState.repoRoot,
    status,
    graph_snapshot: structuredClone(status.graph_snapshot),
    build: null,
    action: "published_snapshot",
    refresh: refreshState
  };
}

export function publishedQueryContext({ refresh = undefined } = {}) {
  return Object.freeze({
    prepare: ({ dir, cacheDir }) => resolvePublishedSidecarSnapshot({ dir, cacheDir, dirtyState: true,
      ...(refresh === undefined ? {} : { refresh }) }),
    repeatOnPublication: true
  });
}

export function pinnedQueryContext(prepared) {
  return Object.freeze({ prepare: async () => prepared, repeatOnPublication: false });
}
