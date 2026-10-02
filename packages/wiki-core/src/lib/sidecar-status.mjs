import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { computeSidecarGeneratorIdentity } from "./sidecar-generator-identity.mjs";
import { SIDECAR_GRAPH_SCHEMA_VERSION } from "./sidecar-graph-schema.mjs";
import { classifySidecarPreparation } from "./sidecar-incremental.mjs";
import { sidecarProviderInputsChangedAtCommit } from "./sidecar-scip-projects.mjs";
import { normalizeSidecarRepoPath } from "./sidecar-paths.mjs";
import { resolveSidecarRepositoryIdentity } from "./sidecar-repository-identity.mjs";
import { createSidecarDirtyDetails, createSidecarResultEnvelope } from "./sidecar-schema.mjs";
import { readSidecarStoreStatus } from "./sidecar-store.mjs";
import { SIDECAR_STORE_GRAPH_FILE, SIDECAR_STORE_SCHEMA_VERSION } from
  "./sidecar-store-schema.mjs";

const execFileAsync = promisify(execFile);
const generatorIdentityCache = new Map();
const generatorIdentityInFlight = new Map();
export const SIDECAR_DEFAULT_CACHE_DIR = ".cache/repo-code-index";
export const SIDECAR_DEFAULT_ARTIFACT_FILE = SIDECAR_STORE_GRAPH_FILE;

export function normalizeSidecarCacheDir(cacheDir) {
  return normalizeSidecarRepoPath(cacheDir || SIDECAR_DEFAULT_CACHE_DIR);
}

export function resolveSidecarArtifactPath({ repoRoot, cacheDir, artifactFile } = {}) {
  const normalizedCacheDir = normalizeSidecarCacheDir(cacheDir);
  const normalizedArtifactFile = normalizeSidecarRepoPath(
    artifactFile || SIDECAR_DEFAULT_ARTIFACT_FILE);
  if (normalizedArtifactFile !== SIDECAR_STORE_GRAPH_FILE) {
    throw new Error(`sidecar artifactFile is fixed as ${SIDECAR_STORE_GRAPH_FILE}`);
  }
  return {
    cacheDir: normalizedCacheDir,
    artifactFile: normalizedArtifactFile,
    artifactRelativePath: path.posix.join(normalizedCacheDir, normalizedArtifactFile),
    artifactPath: path.join(repoRoot, normalizedCacheDir, normalizedArtifactFile)
  };
}

export async function runSidecarGit(repoRoot, args, { maxBuffer = 1024 * 1024 } = {}) {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args], { maxBuffer });
  return stdout.endsWith("\n") ? stdout.slice(0, -1).replace(/\r$/, "") : stdout;
}

const SIDECAR_GIT_RECORD_LIMIT_BYTES = 64 * 1024;
const SIDECAR_GIT_STDERR_TAIL_BYTES = 64 * 1024;

function streamSidecarGitRecords(repoRoot, args, onRecord) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repoRoot, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let pending = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let failure = null;
    let settled = false;
    const settle = (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const stop = (error) => {
      if (failure) return;
      failure = error;
      child.kill("SIGKILL");
    };
    child.stdout.on("data", (chunk) => {
      if (failure) return;
      const buffer = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      let start = 0;
      for (let end = buffer.indexOf(0, start); end !== -1; end = buffer.indexOf(0, start)) {
        try {
          onRecord(buffer.toString("utf8", start, end));
        } catch (error) {
          stop(error);
          return;
        }
        start = end + 1;
      }
      pending = Buffer.from(buffer.subarray(start));
      if (pending.length > SIDECAR_GIT_RECORD_LIMIT_BYTES) {
        const error = new Error(`git ${args[0]} record exceeds ${SIDECAR_GIT_RECORD_LIMIT_BYTES} bytes`);
        error.code = "sidecar_git_record_too_large";
        stop(error);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > SIDECAR_GIT_STDERR_TAIL_BYTES) {
        stderr = Buffer.from(stderr.subarray(stderr.length - SIDECAR_GIT_STDERR_TAIL_BYTES));
      }
    });
    child.once("error", (error) => settle(failure ?? error));
    child.once("close", (code, signal) => {
      if (failure) return settle(failure);
      if (code !== 0) {
        const error = new Error(`git ${args.join(" ")} failed: ${stderr.toString("utf8").trim()}`);
        error.code = code;
        error.signal = signal;
        return settle(error);
      }
      if (pending.length > 0) {
        const error = new Error(`git ${args[0]} output ended inside a record`);
        error.code = "sidecar_git_record_truncated";
        return settle(error);
      }
      return settle(null);
    });
  });
}

export async function collectSidecarDirtyState(repoRoot) {
  const details = createSidecarDirtyDetails();
  let originalPathFollows = false;
  await streamSidecarGitRecords(repoRoot, ["status", "--porcelain=v2", "-z",
    "--untracked-files=all", "--ignore-submodules=none"], (record) => {
    if (originalPathFollows) {
      originalPathFollows = false;
      return;
    }
    if (record.startsWith("? ")) {
      details.untracked += 1;
      return;
    }
    const [kind, changes, submodule] = record.split(" ", 3);
    if (!["1", "2", "u"].includes(kind) || !/^[^ ]{2}$/.test(changes ?? "")) {
      throw new Error(`unrecognized git status record: ${record.slice(0, 80)}`);
    }
    if (changes[0] !== ".") details.staged += 1;
    if (changes[1] !== ".") details.unstaged += 1;
    if (changes.includes("D")) details.deleted_tracked += 1;
    if (submodule?.startsWith("S")) details.submodule_changes += 1;
    originalPathFollows = kind === "2";
  });
  const count = details.staged + details.unstaged + details.untracked +
    details.deleted_tracked + details.submodule_changes;
  return { dirty_state: count === 0 ? "clean" : "dirty_worktree", dirty_details: details };
}

async function gitCheckIgnore(repoRoot, relativePath) {
  try {
    await runSidecarGit(repoRoot, ["check-ignore", "--quiet", relativePath]);
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
}

export async function resolveSidecarBranchName(repoRoot) {
  try {
    return await runSidecarGit(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  } catch (error) {
    if (error?.code === 1) return "HEAD";
    throw error;
  }
}

export async function isSidecarCachePathIgnored({ repoRoot, cacheDir, artifactRelativePath }) {
  return await gitCheckIgnore(repoRoot, path.posix.join(cacheDir, ".gitignore-probe")) &&
    await gitCheckIgnore(repoRoot, artifactRelativePath);
}

export async function assertSidecarCachePathIgnored({ repoRoot, cacheDir, artifactRelativePath }) {
  if (!(await isSidecarCachePathIgnored({ repoRoot, cacheDir, artifactRelativePath }))) {
    const error = new Error(
      `sidecar cache path '${cacheDir}' must be ignored by git before sidecar artifacts are used`);
    error.code = "cache_path_not_ignored";
    throw error;
  }
}

export async function discoverSidecarGitState(dir, { dirtyState = true } = {}) {
  let repoRoot;
  try {
    repoRoot = await resolveSidecarRepositoryIdentity({ dir });
  } catch (error) {
    if (error?.code !== 128) throw error;
    return { repoRoot: path.resolve(dir), index_head: null, index_tree: null,
      dirty_state: "non_git", dirty_details: createSidecarDirtyDetails() };
  }
  const [head, tree, branchName, dirty] = await Promise.all([
    runSidecarGit(repoRoot, ["rev-parse", "HEAD"]),
    runSidecarGit(repoRoot, ["rev-parse", "HEAD^{tree}"]),
    resolveSidecarBranchName(repoRoot),
    dirtyState ? collectSidecarDirtyState(repoRoot) : null
  ]);
  return { repoRoot, index_head: head, index_tree: tree,
    dirty_state: dirty?.dirty_state ?? "unknown",
    dirty_details: { ...(dirty?.dirty_details ?? createSidecarDirtyDetails()),
      detached_head: branchName === "HEAD" } };
}

function graphSnapshot(publication) {
  if (!publication?.repository_commit) return null;
  return {
    schema_version: "graph-snapshot.v1",
    store_incarnation: publication.store_incarnation,
    publication_sequence: publication.sequence,
    repository_commit: publication.repository_commit,
    repository_tree: publication.repository_tree,
    store_schema_version: SIDECAR_STORE_SCHEMA_VERSION,
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    generator_identity: publication.generator_identity,
    base_input_identity: publication.base_input_identity,
    base_coverage: publication.base_coverage,
    provider_input_identity: publication.provider_input_identity,
    provider_coverage: publication.provider_coverage
  };
}

function unavailableScipState(reason, staleness) {
  return { scip_available: false, graph_available: false, staleness,
    index_action: "rebuild", status_reason: reason, input_identity: null,
    call_graph_available: false };
}

function projectClassification(store, classification) {
  if (store.state !== "available" || !store.publication?.repository_commit) {
    const missing = store.state === "missing" || store.state === "available";
    return { staleness: missing ? "missing" : "rebuild_required", action: "rebuild",
      reason: missing ? "artifact_missing" : `artifact_${store.state}`,
      available: false, graphAvailable: false };
  }
  if (classification === null) {
    return { staleness: "unknown", action: "rebuild", reason: "generator_identity_unavailable",
      available: true, graphAvailable: false };
  }
  const { action, reason } = classification;

  if (action === "reuse" || (action === "incremental" &&
      (reason === "provider_coverage_incomplete" || reason === "provider_inputs_changed"))) {
    return { staleness: "fresh", action: "use", reason: "source_identity_match",
      available: true, graphAvailable: true };
  }
  if (action === "incremental" || action === "advance_tag") {
    return { staleness: "stale", action: "rebuild", reason: "source_identity_mismatch",
      available: true, graphAvailable: false };
  }
  return { staleness: "rebuild_required", action: "rebuild", reason,
    available: true, graphAvailable: false };
}

export async function resolveSidecarGeneratorIdentity(gitState) {
  const cacheKey = `${gitState.repoRoot}\0${gitState.index_head}`;
  const settled = generatorIdentityCache.get(cacheKey);
  if (settled) return settled;
  let pending = generatorIdentityInFlight.get(cacheKey);
  if (!pending) {
    pending = computeSidecarGeneratorIdentity({ repoRoot: gitState.repoRoot });
    generatorIdentityInFlight.set(cacheKey, pending);
  }
  try {
    const generator = await pending;
    generatorIdentityCache.set(cacheKey, generator);
    while (generatorIdentityCache.size > 8) {
      generatorIdentityCache.delete(generatorIdentityCache.keys().next().value);
    }
    return generator;
  } finally {
    if (generatorIdentityInFlight.get(cacheKey) === pending) {
      generatorIdentityInFlight.delete(cacheKey);
    }
  }
}

export function createSidecarIndexStatusEnvelope({ gitState, artifactPaths, store,
  classification = null, generatorIdentityError = null }) {
  const classified = projectClassification(store, classification);
  const publication = store.publication ?? null;
  const provider = publication?.provider_coverage ?? null;
  const baseUsable = classified.action === "use";
  const providerInputsChanged = classification?.reason === "provider_inputs_changed";
  const scipState = providerInputsChanged
    ? unavailableScipState("scip_provider_inputs_changed", "stale")
    : baseUsable && provider?.state === "complete"
    ? { scip_available: provider.scip_available === true,
        graph_available: provider.graph_available === true, staleness: "fresh",
        index_action: "use", status_reason: provider.status_reason ?? "scip_not_prepared",
        input_identity: publication.provider_input_identity,
        call_graph_available: provider.call_graph_available === true }
    : unavailableScipState(baseUsable ? "scip_not_prepared" : "scip_base_unusable",
        baseUsable ? "missing" : classified.staleness);
  const graphState = { graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    graph_available: classified.graphAvailable, edge_source: classified.graphAvailable
      ? "base_index" : "unavailable", dirty_graph_mode: classified.graphAvailable
      ? "base_index_only" : "unavailable", unavailable_paths: [],
    status_reason: classified.graphAvailable ? "graph_store_available" : classified.reason };
  const snapshot = graphSnapshot(publication);
  const evidence = { kind: "sidecar_index_status", cache_path: artifactPaths.cacheDir,
    artifact_path: artifactPaths.artifactRelativePath, artifact_exists: classified.available,
    artifact_schema_version: classified.available ? SIDECAR_STORE_SCHEMA_VERSION : null,
    expected_artifact_schema_version: SIDECAR_STORE_SCHEMA_VERSION,
    artifact_index_head: publication?.repository_commit ?? null,
    artifact_index_tree: publication?.repository_tree ?? null,
    status_reason: classified.reason, index_action: classified.action,
    graph_state: graphState, scip_state: scipState, graph_snapshot: snapshot,
    ...(store.error_message ? { read_error: store.error_message } : {}),
    ...(generatorIdentityError ? { generator_identity_error: generatorIdentityError } : {}),
    provenance: { source_kind: "code_index", canonicality: "derived",
      evidence_basis: gitState.index_tree ? "git_tree" : "unknown" } };
  return createSidecarResultEnvelope({ source_kind: "code_index", canonicality: "derived",
    evidence_basis: gitState.index_tree ? "git_tree" : "unknown",
    index_head: gitState.index_head, index_tree: gitState.index_tree,
    dirty_state: gitState.dirty_state, dirty_details: gitState.dirty_details,
    staleness: classified.staleness, canonical_refs: [], derived_evidence: [evidence],
    repo_root: gitState.repoRoot, cache_path: artifactPaths.cacheDir,
    artifact_path: artifactPaths.artifactRelativePath, artifact_exists: classified.available,
    artifact_schema_version: classified.available ? SIDECAR_STORE_SCHEMA_VERSION : null,
    expected_artifact_schema_version: SIDECAR_STORE_SCHEMA_VERSION,
    graph_state: graphState, scip_state: scipState, graph_snapshot: snapshot,
    status_reason: classified.reason, index_action: classified.action });
}

export async function getSidecarIndexStatus({
  dir = ".", cacheDir = SIDECAR_DEFAULT_CACHE_DIR,
  artifactFile = SIDECAR_DEFAULT_ARTIFACT_FILE, verifyCacheIgnored = true, dirtyState = true
} = {}) {
  const gitState = await discoverSidecarGitState(path.resolve(dir), { dirtyState });
  const artifactPaths = resolveSidecarArtifactPath({ repoRoot: gitState.repoRoot,
    cacheDir, artifactFile });
  if (verifyCacheIgnored && gitState.dirty_state !== "non_git") {
    await assertSidecarCachePathIgnored({ repoRoot: gitState.repoRoot,
      cacheDir: artifactPaths.cacheDir, artifactRelativePath: artifactPaths.artifactRelativePath });
  }
  const store = readSidecarStoreStatus({ repoRoot: gitState.repoRoot,
    cacheDir: artifactPaths.cacheDir });
  let classification = null;
  let generatorIdentityError = null;
  if (store.state === "available" && store.publication?.repository_commit && gitState.index_head) {
    try {
      classification = await classifySidecarPreparation({
        publication: store.publication,
        requestedCommit: gitState.index_head,
        generatorIdentity: async () =>
          (await resolveSidecarGeneratorIdentity(gitState)).generator_identity,
        providerInputsChanged: async () =>
          sidecarProviderInputsChangedAtCommit(store.publication, process.env)
      });
    } catch (error) {
      generatorIdentityError = error instanceof Error ? error.message : String(error);
    }
  }
  return createSidecarIndexStatusEnvelope({ gitState, artifactPaths, store,
    classification, generatorIdentityError });
}
