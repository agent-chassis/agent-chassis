import { mkdir } from "node:fs/promises";

import {
  createSidecarBuildEnvelope,
  SidecarBuildRefusalError,
  updateSidecarIndex
} from "./sidecar-build.mjs";
import { classifySidecarPreparation } from "./sidecar-incremental.mjs";
import { sidecarProviderInputsChangedAtCommit } from "./sidecar-scip-projects.mjs";
import {
  resolveCommittedHead,
  resolveSidecarRepositoryIdentity
} from "./sidecar-repository-identity.mjs";
import { createSidecarDirtyDetails } from "./sidecar-schema.mjs";
import {
  collectSidecarDirtyState,
  createSidecarIndexStatusEnvelope,
  isSidecarCachePathIgnored,
  resolveSidecarArtifactPath,
  resolveSidecarBranchName,
  runSidecarGit
} from "./sidecar-status.mjs";
import {
  SIDECAR_UPDATER_LOCK_WAIT_MS,
  sidecarPreparationCancelledError,
  throwIfSidecarPreparationCancelled,
  withSidecarUpdaterLock
} from "./sidecar-store-lifecycle.mjs";
import { readSidecarStoreStatus, resolveSidecarStorePaths } from "./sidecar-store.mjs";

export const SIDECAR_INDEX_ENSURE_MAX_PASSES = 3;
export const SIDECAR_PREPARATION_MAX_ACTIVE = 8;

const activePreparations = new Map();
const capacityWaiters = new Set();

const OUTCOME_CHANGED = Object.freeze({
  prior_preserved: false,
  published_with_error: true
});

export class SidecarIndexEnsureError extends Error {
  constructor(message, { code = "sidecar_index_ensure_failed", cause = null,
    capturedHead = null } = {}) {
    super(message, cause == null ? undefined : { cause });
    this.name = "SidecarIndexEnsureError";
    this.code = code;
    const outcome = cause?.publication_outcome ?? null;
    this.envelope = Object.freeze({
      kind: "sidecar_index_ensure_failed",
      code,
      captured_head: capturedHead,
      cause_code: cause?.code ?? null,
      cause_message: cause instanceof Error ? cause.message : cause == null ? null : String(cause),
      publication_outcome: outcome,

      changed: OUTCOME_CHANGED[outcome] ?? null,
      recovery: Object.freeze({
        action: outcome === "unknown"
          ? "observe_the_published_code_index_before_retrying"
          : "correct_the_reported_repository_or_cache_failure_then_retry_the_requesting_operation",
        automatic_rebuild_on_retry: true
      })
    });
  }
}

function prepublicationFailure(error) {
  if (error && typeof error === "object" && error.publication_outcome === undefined) {
    error.publication_outcome = "prior_preserved";
  }
  return error;
}

function wakeCapacityWaiters() {
  for (const wake of [...capacityWaiters]) wake();
}

async function waitForCapacity(signal) {
  while (activePreparations.size >= SIDECAR_PREPARATION_MAX_ACTIVE) {
    throwIfSidecarPreparationCancelled(signal);
    await new Promise((resolve, reject) => {
      const onAbort = () => {
        capacityWaiters.delete(wake);
        reject(sidecarPreparationCancelledError(signal));
      };
      const wake = () => {
        capacityWaiters.delete(wake);
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      capacityWaiters.add(wake);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

function startPreparation(key, work) {
  const controller = new AbortController();
  const entry = { waiters: 0, settled: false, controller, promise: null };
  entry.promise = (async () => work(controller.signal))().finally(() => {
    entry.settled = true;
    if (activePreparations.get(key) === entry) activePreparations.delete(key);
    wakeCapacityWaiters();
  });
  entry.promise.catch(() => {});
  activePreparations.set(key, entry);
  return entry;
}

function joinPreparation(entry, signal) {
  entry.waiters += 1;
  return new Promise((resolve, reject) => {
    let attached = true;
    const detach = () => {
      if (!attached) return false;
      attached = false;
      entry.waiters -= 1;
      signal?.removeEventListener("abort", onAbort);
      return true;
    };
    function onAbort() {
      if (!detach()) return;
      if (entry.waiters === 0 && !entry.settled) entry.controller.abort(signal.reason);
      reject(sidecarPreparationCancelledError(signal));
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    entry.promise.then((value) => {
      if (detach()) resolve(value);
    }, (error) => {
      if (detach()) reject(error);
    });
  });
}

async function reusablePublication(repoRoot, paths, head) {
  const observed = readSidecarStoreStatus({ repoRoot, cacheDir: paths.cache_dir });
  if (observed.state !== "available" || observed.publication?.repository_commit !== head) return null;
  const decision = await classifySidecarPreparation({
    publication: observed.publication, requestedCommit: head,
    providerInputsChanged: async () => sidecarProviderInputsChangedAtCommit(observed.publication, process.env)
  });
  return decision.action === "reuse" ? { action: "reused", publication: observed.publication } : null;
}

async function prepareCommitted({ repoRoot, paths, artifactPaths, head, mode, buildHooks,
  providerDeadlineMs, lockTimeoutMs, signal }) {

  if (await resolveCommittedHead(repoRoot) !== head) return { head_moved: true };
  if (mode === "update") {
    const reused = await reusablePublication(repoRoot, paths, head);
    if (reused) return reused;
  }
  if (!(await isSidecarCachePathIgnored({ repoRoot, cacheDir: artifactPaths.cacheDir,
    artifactRelativePath: artifactPaths.artifactRelativePath }))) {
    throw new SidecarBuildRefusalError(
      `sidecar cache path '${artifactPaths.cacheDir}' must be ignored by git before writing artifacts`,
      { code: "cache_path_not_ignored" });
  }
  await mkdir(paths.store_dir, { recursive: true });
  return withSidecarUpdaterLock(paths.lifecycle_path, async (lock) => {

    if (await resolveCommittedHead(repoRoot) !== head) return { head_moved: true };
    const observed = readSidecarStoreStatus({ repoRoot, cacheDir: paths.cache_dir });
    const tree = observed.publication?.repository_commit === head
      ? observed.publication.repository_tree
      : await runSidecarGit(repoRoot, ["--no-replace-objects", "rev-parse", `${head}^{tree}`]);
    const update = await updateSidecarIndex({ repoRoot, paths, head, tree, mode, observed, lock,
      signal, buildHooks, providerDeadlineMs });
    return { action: update.action, publication: update.publication, metrics: update.metrics,
      updated: update.action !== "coalesced" };
  }, { signal, timeoutMs: lockTimeoutMs });
}

async function finishEnsure({ repoRoot, artifactPaths, head, result, joined, dirtyState }) {
  const [dirty, branch] = await Promise.all([
    dirtyState ? collectSidecarDirtyState(repoRoot) : null,
    resolveSidecarBranchName(repoRoot)
  ]);
  const publication = result.publication;
  const gitState = {
    repoRoot, index_head: head, index_tree: publication.repository_tree,
    dirty_state: dirty?.dirty_state ?? "unknown",
    dirty_details: { ...(dirty?.dirty_details ?? createSidecarDirtyDetails()),
      detached_head: branch === "HEAD" }
  };
  const status = createSidecarIndexStatusEnvelope({ gitState, artifactPaths,
    store: { state: "available", publication },
    classification: { action: "reuse", reason: "source_commit_match" } });
  const action = joined && result.action !== "reused" ? "coalesced" : result.action;
  const build = result.updated && !joined
    ? createSidecarBuildEnvelope({ cacheDir: artifactPaths.cacheDir, git: gitState, publication,
        action, metrics: result.metrics })
    : null;
  return Object.freeze({
    action,
    captured_head: head,
    status: Object.freeze(structuredClone(status)),
    build: build === null ? null : Object.freeze(structuredClone(build)),
    publication: Object.freeze(structuredClone(publication))
  });
}

export async function ensureSidecarIndex({
  dir = ".",
  cacheDir = undefined,
  mode = "update",
  signal = null,
  dirtyState = false,
  buildHooks = null,
  providerDeadlineMs = undefined,
  lockTimeoutMs = SIDECAR_UPDATER_LOCK_WAIT_MS
} = {}) {
  if (mode !== "update" && mode !== "rebuild") {
    throw new TypeError("sidecar ensure mode must be 'update' or 'rebuild'");
  }
  throwIfSidecarPreparationCancelled(signal);
  let repoRoot;
  try {
    repoRoot = await resolveSidecarRepositoryIdentity({ dir });
  } catch (cause) {
    throw new SidecarIndexEnsureError(
      `repo code-index preparation requires one git repository: ${cause?.message ?? cause}`,
      { code: "sidecar_repository_unavailable", cause });
  }
  const artifactPaths = resolveSidecarArtifactPath({ repoRoot, cacheDir });
  const paths = resolveSidecarStorePaths({ repoRoot, cacheDir: artifactPaths.cacheDir });
  let head = null;
  for (let pass = 0; pass < SIDECAR_INDEX_ENSURE_MAX_PASSES; pass += 1) {
    try {
      head = await resolveCommittedHead(repoRoot);
    } catch (cause) {
      throw new SidecarIndexEnsureError(
        `repo code-index preparation requires one committed HEAD: ${cause?.message ?? cause}`,
        { code: "sidecar_head_unstable", cause });
    }

    if (mode === "update") {
      const reused = await reusablePublication(repoRoot, paths, head);
      if (reused) {
        return finishEnsure({ repoRoot, artifactPaths, head, result: reused, joined: false, dirtyState });
      }
    }
    const key = JSON.stringify([repoRoot, paths.cache_dir, head, mode]);
    const usable = (candidate) => candidate && !candidate.controller.signal.aborted ? candidate : undefined;
    let entry = usable(activePreparations.get(key));
    let joined = entry !== undefined;
    if (!entry) {
      await waitForCapacity(signal);
      entry = usable(activePreparations.get(key));
      joined = entry !== undefined;
      entry ??= startPreparation(key, (ownedSignal) => prepareCommitted({ repoRoot, paths,
        artifactPaths, head, mode, buildHooks, providerDeadlineMs, lockTimeoutMs,
        signal: ownedSignal }).catch((error) => {
        throw prepublicationFailure(error);
      }));
    }
    let result;
    try {
      result = await joinPreparation(entry, signal);
    } catch (cause) {
      if (cause?.code === "sidecar_preparation_cancelled" && signal?.aborted) throw cause;
      throw new SidecarIndexEnsureError(
        `repo code-index preparation failed for committed HEAD ${head}: ${cause?.message ?? cause}`,
        { code: "sidecar_index_preparation_failed", cause, capturedHead: head });
    }
    if (result.head_moved) continue;
    return finishEnsure({ repoRoot, artifactPaths, head, result, joined, dirtyState });
  }
  throw new SidecarIndexEnsureError(
    "repository HEAD did not stabilize while preparing the committed code index",
    { code: "sidecar_index_head_unstable", capturedHead: head });
}
