import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  SIDECAR_ARTIFACT_SCHEMA_FIELD,
  SIDECAR_ARTIFACT_SCHEMA_VERSION,
  classifySidecarArtifactSchema,
  createSidecarDirtyDetails,
  createSidecarResultEnvelope
} from "./sidecar-schema.mjs";
import {
  SIDECAR_GRAPH_SECTION_FIELD,
  classifySidecarGraphArtifactSchema,
  createSidecarGraphState
} from "./sidecar-graph-schema.mjs";
import { normalizeSidecarRepoPath } from "./sidecar-paths.mjs";
import { readSidecarArtifactBytes } from "./sidecar-artifact-bytes.mjs";

const execFileAsync = promisify(execFile);

export const SIDECAR_DEFAULT_CACHE_DIR = ".cache/repo-code-index";
export const SIDECAR_DEFAULT_ARTIFACT_FILE = "index.json";

export function normalizeSidecarCacheDir(cacheDir) {
  return normalizeSidecarRepoPath(cacheDir || SIDECAR_DEFAULT_CACHE_DIR);
}

export function resolveSidecarArtifactPath({ repoRoot, cacheDir, artifactFile }) {
  const normalizedCacheDir = normalizeSidecarCacheDir(cacheDir);
  const normalizedArtifactFile = normalizeSidecarRepoPath(
    artifactFile || SIDECAR_DEFAULT_ARTIFACT_FILE
  );
  if (normalizedArtifactFile.includes("/")) {
    throw new Error("sidecar status artifactFile must be a file name, not a path");
  }

  return {
    cacheDir: normalizedCacheDir,
    artifactFile: normalizedArtifactFile,
    artifactRelativePath: path.posix.join(normalizedCacheDir, normalizedArtifactFile),
    artifactPath: path.join(repoRoot, normalizedCacheDir, normalizedArtifactFile)
  };
}

export async function runSidecarGit(repoRoot, args, { maxBuffer = 1024 * 1024 } = {}) {
  const { stdout } = await execFileAsync("git", ["-C", repoRoot, ...args], {
    maxBuffer
  });
  return stdout.endsWith("\n") ? stdout.slice(0, -1).replace(/\r$/, "") : stdout;
}

async function gitCheckIgnore(repoRoot, relativePath) {
  try {
    await runSidecarGit(repoRoot, ["check-ignore", "--quiet", relativePath]);
    return true;
  } catch {
    return false;
  }
}

function createCachePathNotIgnoredError(cacheDir) {
  const error = new Error(
    `sidecar cache path '${cacheDir}' must be ignored by git before sidecar artifacts are used`
  );
  error.code = "cache_path_not_ignored";
  return error;
}

export async function isSidecarCachePathIgnored({ repoRoot, cacheDir, artifactRelativePath }) {
  const cacheProbeIgnored = await gitCheckIgnore(
    repoRoot,
    path.posix.join(cacheDir, ".gitignore-probe")
  );
  const artifactIgnored = await gitCheckIgnore(repoRoot, artifactRelativePath);
  return cacheProbeIgnored && artifactIgnored;
}

export async function assertSidecarCachePathIgnored({
  repoRoot,
  cacheDir,
  artifactRelativePath
}) {
  if (!(await isSidecarCachePathIgnored({ repoRoot, cacheDir, artifactRelativePath }))) {
    throw createCachePathNotIgnoredError(cacheDir);
  }
}

export async function discoverSidecarGitState(dir) {
  try {
    const repoRoot = await runSidecarGit(dir, ["rev-parse", "--show-toplevel"]);
    const [head, tree, branchName, statusText, gitlinkText] = await Promise.all([
      runSidecarGit(repoRoot, ["rev-parse", "HEAD"]),
      runSidecarGit(repoRoot, ["rev-parse", "HEAD^{tree}"]),
      runSidecarGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD"),
      runSidecarGit(repoRoot, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=none"
      ]),
      runSidecarGit(repoRoot, ["ls-files", "-s"]).catch(() => "")
    ]);
    const gitlinkPaths = new Set(
      gitlinkText
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const tabIndex = line.indexOf("\t");
          const metadata = tabIndex === -1 ? "" : line.slice(0, tabIndex);
          return metadata.startsWith("160000 ") ? line.slice(tabIndex + 1) : null;
        })
        .filter(Boolean)
    );

    const dirtyDetails = createSidecarDirtyDetails({
      detached_head: branchName === "HEAD"
    });

    for (const line of statusText.split("\n").filter(Boolean)) {
      if (line.startsWith("?? ")) {
        dirtyDetails.untracked += 1;
        continue;
      }

      const stagedCode = line[0];
      const unstagedCode = line[1];
      if (stagedCode && stagedCode !== " ") {
        dirtyDetails.staged += 1;
      }
      if (unstagedCode && unstagedCode !== " ") {
        dirtyDetails.unstaged += 1;
      }
      if (stagedCode === "D" || unstagedCode === "D") {
        dirtyDetails.deleted_tracked += 1;
      }
      const statusPath = line.slice(3).split(" -> ").pop();
      if (
        /[m?]/.test(`${stagedCode}${unstagedCode}`) ||
        line.includes("160000") ||
        gitlinkPaths.has(statusPath)
      ) {
        dirtyDetails.submodule_changes += 1;
      }
    }

    const dirtyCount =
      dirtyDetails.staged +
      dirtyDetails.unstaged +
      dirtyDetails.deleted_tracked +
      dirtyDetails.untracked +
      dirtyDetails.submodule_changes;

    return {
      repoRoot,
      index_head: head,
      index_tree: tree,
      dirty_state: dirtyCount > 0 ? "dirty_worktree" : "clean",
      dirty_details: dirtyDetails
    };
  } catch {
    return {
      repoRoot: path.resolve(dir),
      index_head: null,
      index_tree: null,
      dirty_state: "non_git",
      dirty_details: createSidecarDirtyDetails()
    };
  }
}

async function readArtifact(artifactPath) {
  try {
    await access(artifactPath);
  } catch {
    return {
      exists: false,
      data: null,
      read_error: null
    };
  }

  try {
    const { artifact } = await readSidecarArtifactBytes(artifactPath);
    return {
      exists: true,
      data: artifact,
      read_error: null
    };
  } catch (error) {
    return {
      exists: true,
      data: null,
      read_error: error instanceof Error ? error.message : String(error)
    };
  }
}

function artifactMetadataCandidates(artifact) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    return [];
  }

  return [
    artifact.cache_metadata,
    artifact.index_metadata,
    artifact.metadata,
    artifact
  ].filter((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate));
}

function getArtifactMetadata(artifact) {
  const candidates = artifactMetadataCandidates(artifact);
  return (
    candidates.find((candidate) =>
      Object.prototype.hasOwnProperty.call(candidate, SIDECAR_ARTIFACT_SCHEMA_FIELD)
    ) ||
    candidates[0] ||
    null
  );
}

function getArtifactIdentity(artifact, metadata) {
  return {
    index_head: artifact?.index_head ?? metadata?.index_head ?? null,
    index_tree: artifact?.index_tree ?? metadata?.index_tree ?? null
  };
}

function classifyArtifactState({ artifact, currentHead }) {
  const unavailableGraphState = createSidecarGraphState({
    status_reason: artifact.exists ? "graph_unavailable" : "artifact_missing"
  });

  if (!artifact.exists) {
    return {
      staleness: "missing",
      index_action: "rebuild",
      artifact_schema_version: null,
      graph_state: unavailableGraphState,
      reason: "artifact_missing",
      artifact_index_head: null,
      artifact_index_tree: null
    };
  }

  if (artifact.read_error) {
    return {
      staleness: "unknown",
      index_action: "rebuild",
      artifact_schema_version: null,
      graph_state: createSidecarGraphState({ status_reason: "artifact_unreadable" }),
      reason: "artifact_unreadable",
      read_error: artifact.read_error,
      artifact_index_head: null,
      artifact_index_tree: null
    };
  }

  const metadata = getArtifactMetadata(artifact.data);
  const schema = classifySidecarArtifactSchema(metadata ?? {});
  const identity = getArtifactIdentity(artifact.data, metadata);
  const artifactSchemaVersion = metadata?.[SIDECAR_ARTIFACT_SCHEMA_FIELD] ?? null;
  const graphSchema = schema.compatible
    ? classifySidecarGraphArtifactSchema(artifact.data)
    : {
        graph_state: unavailableGraphState,
        errors: []
      };
  const graphState = {
    ...graphSchema.graph_state,
    ...(graphSchema.errors.length > 0 ? { errors: graphSchema.errors } : {})
  };

  if (!schema.compatible) {
    return {
      staleness: schema.staleness,
      index_action: "rebuild",
      artifact_schema_version: artifactSchemaVersion,
      graph_state: graphState,
      reason: schema.reason,
      artifact_index_head: identity.index_head,
      artifact_index_tree: identity.index_tree
    };
  }

  if (!identity.index_head || !currentHead) {
    return {
      staleness: "unknown",
      index_action: "rebuild",
      artifact_schema_version: artifactSchemaVersion,
      graph_state: graphState,
      reason: "source_identity_unknown",
      artifact_index_head: identity.index_head,
      artifact_index_tree: identity.index_tree
    };
  }

  const fresh = identity.index_head === currentHead;

  const usable = fresh && graphState.graph_available === true;
  return {
    staleness: fresh ? "fresh" : "stale",
    index_action: usable ? "use" : "rebuild",
    artifact_schema_version: artifactSchemaVersion,
    graph_state: graphState,
    reason: fresh ? "source_identity_match" : "source_identity_mismatch",
    artifact_index_head: identity.index_head,
    artifact_index_tree: identity.index_tree
  };
}

export function createSidecarStatusArtifact({
  index_head,
  index_tree,
  cache_metadata = {},
  graph
} = {}) {
  const artifact = {
    schema_version: SIDECAR_ARTIFACT_SCHEMA_VERSION,
    index_head: index_head ?? null,
    index_tree: index_tree ?? null,
    cache_metadata: {
      [SIDECAR_ARTIFACT_SCHEMA_FIELD]: SIDECAR_ARTIFACT_SCHEMA_VERSION,
      index_head: index_head ?? null,
      index_tree: index_tree ?? null,
      ...cache_metadata
    }
  };
  if (graph !== undefined) {
    artifact[SIDECAR_GRAPH_SECTION_FIELD] = graph;
  }
  return artifact;
}

export async function getSidecarIndexStatus({
  dir = ".",
  cacheDir = SIDECAR_DEFAULT_CACHE_DIR,
  artifactFile = SIDECAR_DEFAULT_ARTIFACT_FILE
} = {}) {
  const gitState = await discoverSidecarGitState(path.resolve(dir));
  const artifactPaths = resolveSidecarArtifactPath({
    repoRoot: gitState.repoRoot,
    cacheDir,
    artifactFile
  });
  if (gitState.dirty_state !== "non_git") {
    await assertSidecarCachePathIgnored({
      repoRoot: gitState.repoRoot,
      cacheDir: artifactPaths.cacheDir,
      artifactRelativePath: artifactPaths.artifactRelativePath
    });
  }
  const artifact = await readArtifact(artifactPaths.artifactPath);
  const artifactState = classifyArtifactState({
    artifact,
    currentHead: gitState.index_head
  });

  return createSidecarResultEnvelope({
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: gitState.index_tree ? "git_tree" : "unknown",
    index_head: gitState.index_head,
    index_tree: gitState.index_tree,
    dirty_state: gitState.dirty_state,
    dirty_details: gitState.dirty_details,
    staleness: artifactState.staleness,
    canonical_refs: [],
    derived_evidence: [
      {
        kind: "sidecar_index_status",
        cache_path: artifactPaths.cacheDir,
        artifact_path: artifactPaths.artifactRelativePath,
        artifact_exists: artifact.exists,
        artifact_schema_version: artifactState.artifact_schema_version,
        expected_artifact_schema_version: SIDECAR_ARTIFACT_SCHEMA_VERSION,
        artifact_index_head: artifactState.artifact_index_head,
        artifact_index_tree: artifactState.artifact_index_tree,
        status_reason: artifactState.reason,
        index_action: artifactState.index_action,
        graph_state: artifactState.graph_state,
        ...(artifactState.read_error ? { read_error: artifactState.read_error } : {}),
        provenance: {
          source_kind: "code_index",
          canonicality: "derived",
          evidence_basis: gitState.index_tree ? "git_tree" : "unknown"
        }
      }
    ],
    cache_path: artifactPaths.cacheDir,
    artifact_path: artifactPaths.artifactRelativePath,
    artifact_exists: artifact.exists,
    artifact_schema_version: artifactState.artifact_schema_version,
    expected_artifact_schema_version: SIDECAR_ARTIFACT_SCHEMA_VERSION,
    graph_state: artifactState.graph_state,
    status_reason: artifactState.reason,
    index_action: artifactState.index_action
  });
}
