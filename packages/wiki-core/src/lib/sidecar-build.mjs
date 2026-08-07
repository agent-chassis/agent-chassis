import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

import {
  SIDECAR_ARTIFACT_SCHEMA_FIELD,
  SIDECAR_ARTIFACT_SCHEMA_VERSION,
  createSidecarDirtyDetails,
  createSidecarResultEnvelope
} from "./sidecar-schema.mjs";
import { extractSidecarGraph } from "./sidecar-graph-extractors.mjs";
import {
  buildScipOverlayFromCommittedSnapshot,
  SCIP_DEFAULT_CACHE_DIR,
  snapshotScipOptions
} from "./sidecar-scip-provision.mjs";
import { filterSidecarSourcePaths, normalizeSidecarRepoPath } from "./sidecar-paths.mjs";
import {
  SIDECAR_DEFAULT_ARTIFACT_FILE,
  SIDECAR_DEFAULT_CACHE_DIR,
  isSidecarCachePathIgnored,
  runSidecarGit
} from "./sidecar-status.mjs";
import { computeSidecarGeneratorIdentity } from "./sidecar-generator-identity.mjs";
import { SIDECAR_GRAPH_SCHEMA_VERSION, validateSidecarGraphSection } from "./sidecar-graph-schema.mjs";
import { readSidecarArtifactBytes } from "./sidecar-artifact-bytes.mjs";
import {
  SIDECAR_BUILD_LOCK_SUFFIX,
  acquireSidecarBuildLock,
  appendSidecarBuildLockDiagnostics,
  claimSidecarBuildLeadership,
  releaseSidecarBuildLeadership,
  releaseSidecarBuildLock,
  settleSidecarBuildLeadershipFailed,
  settleSidecarBuildLeadershipPublished,
  waitForCoalescedSidecarArtifact, acquireSidecarBuildLease, followSidecarBuildLease,
  publishSidecarBuildLease, releaseSidecarBuildLease, renewSidecarBuildLease
} from "./sidecar-build-lock.mjs";

export class SidecarBuildRefusalError extends Error {
  constructor(message, { code, envelope } = {}) {
    super(message);
    this.name = "SidecarBuildRefusalError";
    this.code = code;
    this.envelope = envelope;
  }
}

function resolveBuildArtifactPath({ repoRoot, cacheDir, artifactFile }) {
  const normalizedCacheDir = normalizeSidecarRepoPath(cacheDir || SIDECAR_DEFAULT_CACHE_DIR);
  const normalizedArtifactFile = normalizeSidecarRepoPath(
    artifactFile || SIDECAR_DEFAULT_ARTIFACT_FILE
  );
  if (normalizedArtifactFile.includes("/")) {
    throw new Error("sidecar build artifactFile must be a file name, not a path");
  }

  return {
    cacheDir: normalizedCacheDir,
    artifactFile: normalizedArtifactFile,
    artifactRelativePath: path.posix.join(normalizedCacheDir, normalizedArtifactFile),
    artifactDirPath: path.join(repoRoot, normalizedCacheDir),
    artifactPath: path.join(repoRoot, normalizedCacheDir, normalizedArtifactFile)
  };
}

async function assertCachePathIgnored({ repoRoot, cacheDir, artifactRelativePath }) {
  if (!(await isSidecarCachePathIgnored({ repoRoot, cacheDir, artifactRelativePath }))) {
    throw new SidecarBuildRefusalError(
      `sidecar build cache path '${cacheDir}' must be ignored by git before writing artifacts`,
      { code: "cache_path_not_ignored" }
    );
  }
}

async function captureBuildGitState(dir) {
  let repoRoot;
  try {
    repoRoot = await runSidecarGit(dir, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw new SidecarBuildRefusalError("sidecar build requires one committed repository HEAD", {
      code: "sidecar_head_unstable"
    });
  }
  const generatorIdentity = await computeSidecarGeneratorIdentity({ repoRoot });
  const indexHead = generatorIdentity.committed_head;
  const [indexTree, branchName, statusText, gitlinkText] = await Promise.all([
    runSidecarGit(repoRoot, ["--no-replace-objects", "rev-parse", `${indexHead}^{tree}`]),
    runSidecarGit(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => "HEAD"),
    runSidecarGit(repoRoot, [
      "status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"
    ]),
    runSidecarGit(repoRoot, ["ls-files", "-s"]).catch(() => "")
  ]);
  const gitlinks = new Set(gitlinkText.split("\n").filter((line) => line.startsWith("160000 "))
    .map((line) => line.slice(line.indexOf("\t") + 1)));
  const dirtyDetails = createSidecarDirtyDetails({ detached_head: branchName === "HEAD" });
  for (const line of statusText.split("\n").filter(Boolean)) {
    if (line.startsWith("?? ")) {
      dirtyDetails.untracked += 1;
      continue;
    }
    const [staged, unstaged] = line;
    if (staged !== " ") dirtyDetails.staged += 1;
    if (unstaged !== " ") dirtyDetails.unstaged += 1;
    if (staged === "D" || unstaged === "D") dirtyDetails.deleted_tracked += 1;
    if (/[m?]/.test(`${staged}${unstaged}`) || gitlinks.has(line.slice(3).split(" -> ").pop())) {
      dirtyDetails.submodule_changes += 1;
    }
  }
  const dirtyCount = dirtyDetails.staged + dirtyDetails.unstaged +
    dirtyDetails.deleted_tracked + dirtyDetails.untracked + dirtyDetails.submodule_changes;
  return {
    gitState: { repoRoot, index_head: indexHead, index_tree: indexTree,
      dirty_state: dirtyCount > 0 ? "dirty_worktree" : "clean", dirty_details: dirtyDetails },
    generatorIdentity
  };
}
function parseTreeRecord(record) {
  const tabIndex = record.indexOf("\t");
  if (tabIndex === -1) {
    throw new Error(`invalid git ls-tree record: ${record}`);
  }

  const metadata = record.slice(0, tabIndex).split(" ");
  if (metadata.length < 3) {
    throw new Error(`invalid git ls-tree metadata: ${record}`);
  }

  return {
    mode: metadata[0],
    type: metadata[1],
    object_id: metadata[2],
    path: record.slice(tabIndex + 1)
  };
}

async function getSymlinkTarget(repoRoot, objectId) {
  return runSidecarGit(repoRoot, ["cat-file", "-p", objectId]);
}

async function collectTrackedSources(repoRoot, treeIsh = "HEAD") {

  const raw = await runSidecarGit(repoRoot, ["--no-replace-objects", "ls-tree", "-r", "-z", treeIsh], {
    maxBuffer: 1024 * 1024 * 64
  });
  const trackedRecords = raw ? raw.split("\0").filter(Boolean).map(parseTreeRecord) : [];
  const sourceFilter = filterSidecarSourcePaths(trackedRecords.map((entry) => entry.path));
  const included = new Set(sourceFilter.included);
  const files = [];
  const symlinks = [];
  const gitlinks = [];

  for (const record of trackedRecords) {
    if (!included.has(record.path)) {
      continue;
    }

    if (record.mode === "120000") {
      symlinks.push({
        path: record.path,
        mode: record.mode,
        blob_oid: record.object_id,
        target: await getSymlinkTarget(repoRoot, record.object_id)
      });
      continue;
    }

    if (record.mode === "160000") {
      gitlinks.push({
        path: record.path,
        mode: record.mode,
        commit: record.object_id,
        state: "clean"
      });
      continue;
    }

    files.push({
      path: record.path,
      mode: record.mode,
      blob_oid: record.object_id
    });
  }

  return {
    tracked_count: trackedRecords.length,
    source_count: files.length + symlinks.length + gitlinks.length,
    files,
    symlinks,
    gitlinks,
    rejected: sourceFilter.rejected
  };
}

const GRAPH_TEXT_SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".mts",
  ".py",
  ".ts",
  ".tsx"
]);

function isGraphTextSource(relativePath) {
  return GRAPH_TEXT_SOURCE_EXTENSIONS.has(path.posix.extname(relativePath));
}

function runBatchCatFile(repoRoot, oids) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repoRoot, "--no-replace-objects", "cat-file", "--batch"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `git cat-file --batch exited with code ${code}: ${Buffer.concat(
              stderrChunks
            ).toString("utf8")}`
          )
        );
        return;
      }
      resolve(Buffer.concat(stdoutChunks));
    });

    child.stdin.on("error", () => {});
    child.stdin.end(`${oids.join("\n")}\n`);
  });
}

function parseBatchCatFileOutput(buffer, expectedCount) {
  const contents = new Map();
  let offset = 0;
  for (let index = 0; index < expectedCount; index += 1) {
    const headerEnd = buffer.indexOf(0x0a, offset);
    if (headerEnd === -1) {
      throw new Error("git cat-file --batch output ended before all objects were read");
    }
    const header = buffer.toString("utf8", offset, headerEnd);
    offset = headerEnd + 1;
    const parts = header.split(" ");
    if (parts.length < 3) {
      throw new Error(`git cat-file --batch could not resolve object: ${header}`);
    }
    const [oid, , sizeText] = parts;
    const size = Number.parseInt(sizeText, 10);
    if (!Number.isInteger(size) || size < 0) {
      throw new Error(`invalid git cat-file --batch object size: ${header}`);
    }
    const contentEnd = offset + size;
    if (contentEnd > buffer.length) {
      throw new Error("git cat-file --batch output truncated before object content end");
    }
    contents.set(oid, buffer.toString("utf8", offset, contentEnd));
    offset = contentEnd + 1;
  }
  return contents;
}

async function batchReadBlobs(repoRoot, oids) {
  if (oids.length === 0) {
    return new Map();
  }
  const stdout = await runBatchCatFile(repoRoot, oids);
  return parseBatchCatFileOutput(stdout, oids.length);
}

async function collectGraphSources({ repoRoot, sources }) {
  const graphFiles = sources.files.filter((source) => isGraphTextSource(source.path));
  const uniqueOids = [...new Set(graphFiles.map((source) => source.blob_oid))];
  const blobContents = await batchReadBlobs(repoRoot, uniqueOids);
  return graphFiles.map((source) => {
    const content = blobContents.get(source.blob_oid);
    if (content === undefined) {
      throw new Error(
        `sidecar build could not read committed blob ${source.blob_oid} for ${source.path}`
      );
    }
    return { path: source.path, content };
  });
}

function createBuildArtifact({ gitState, generatorIdentity, artifactPaths, sources, graph,
  scipOverlay = null, authoritative = true }) {
  const publishedGraph = {
    ...graph,
    ...(authoritative ? { generator_identity: generatorIdentity.generator_identity } : {})
  };
  return {
    schema_version: SIDECAR_ARTIFACT_SCHEMA_VERSION,
    index_head: gitState.index_head,
    index_tree: gitState.index_tree,
    cache_metadata: {
      [SIDECAR_ARTIFACT_SCHEMA_FIELD]: SIDECAR_ARTIFACT_SCHEMA_VERSION,
      index_head: gitState.index_head,
      index_tree: gitState.index_tree,
      cache_path: artifactPaths.cacheDir,
      artifact_path: artifactPaths.artifactRelativePath,
      tracked_count: sources.tracked_count,
      source_count: sources.source_count,
      regular_file_count: sources.files.length,
      symlink_count: sources.symlinks.length,
      gitlink_count: sources.gitlinks.length,
      rejected_source_count: sources.rejected.length,
      graph_schema_version: publishedGraph.graph_schema_version,
      graph_node_count: publishedGraph.graph_nodes.length,
      graph_edge_count: publishedGraph.graph_edges.length,

      ...(scipOverlay
        ? {
            scip_overlay: {
              scip_available: scipOverlay.scip_available,
              status_reason: scipOverlay.status_reason,
              symbol_node_count: scipOverlay.graph_nodes.length,
              symbol_edge_count: scipOverlay.graph_edges.length
            }
          }
        : {})
    },
    sources,
    graph: publishedGraph,

    ...(scipOverlay ? { scip_overlay: scipOverlay } : {})
  };
}

function createBuildEnvelope({ gitState, artifactPaths, artifact, action }) {
  const metadata = artifact.cache_metadata;
  return createSidecarResultEnvelope({
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: "git_tree",
    index_head: gitState.index_head,
    index_tree: gitState.index_tree,
    dirty_state: gitState.dirty_state,
    dirty_details: gitState.dirty_details,
    staleness: "fresh",
    canonical_refs: [],
    derived_evidence: [
      {
        kind: "sidecar_index_build",
        action,
        cache_path: artifactPaths.cacheDir,
        artifact_path: artifactPaths.artifactRelativePath,
        artifact_schema_version: metadata[SIDECAR_ARTIFACT_SCHEMA_FIELD],
        source_count: metadata.source_count,
        regular_file_count: metadata.regular_file_count,
        symlink_count: metadata.symlink_count,
        gitlink_count: metadata.gitlink_count,
        rejected_source_count: metadata.rejected_source_count,
        provenance: {
          source_kind: "code_index",
          canonicality: "derived",
          evidence_basis: "git_tree"
        }
      }
    ],
    cache_path: artifactPaths.cacheDir,
    artifact_path: artifactPaths.artifactRelativePath,
    artifact_exists: true,
    artifact_schema_version: metadata[SIDECAR_ARTIFACT_SCHEMA_FIELD],
    expected_artifact_schema_version: SIDECAR_ARTIFACT_SCHEMA_VERSION,
    build_action: action,
    graph_state: artifact.graph.graph_state,
    source_count: metadata.source_count,
    regular_file_count: metadata.regular_file_count,
    symlink_count: metadata.symlink_count,
    gitlink_count: metadata.gitlink_count,
    rejected_source_count: metadata.rejected_source_count,
    status_reason: "build_complete"
  });
}

const ALLOWED_BUILD_HOOK_KEYS = new Set(["beforeGraphExtraction", "artifactOperations"]);

function assertSupportedBuildHooks(buildHooks) {
  if (buildHooks === null || buildHooks === undefined) {
    return;
  }
  if (typeof buildHooks !== "object" || Array.isArray(buildHooks)) {
    throw new TypeError("sidecar build buildHooks must be an object");
  }
  const unsupported = Reflect.ownKeys(buildHooks)
    .filter((key) => !ALLOWED_BUILD_HOOK_KEYS.has(key))
    .map((key) => String(key))
    .sort();
  if (unsupported.length > 0) {
    throw new TypeError(
      `sidecar build does not support buildHooks key(s): ${unsupported.join(", ")}`
    );
  }
}

function resolveArtifactPublicationOperations(buildHooks) {
  const injected = buildHooks?.artifactOperations ?? {};
  return {
    writeTemp: injected.writeTemp ?? writeFile,
    renameTemp: injected.renameTemp ?? rename,
    removeTemp: injected.removeTemp ?? ((tempPath) => rm(tempPath, { force: true }))
  };
}

function attachArtifactCleanupDiagnostic(error) {
  if ((typeof error !== "object" || error === null) && typeof error !== "function") {
    return;
  }
  error.artifactPublicationDiagnostics = [
    { code: "artifact_temp_cleanup_failed" }
  ];
}

async function publishArtifactAtomically({
  artifactDirPath,
  artifactPath,
  artifactFile,
  serialized,
  operations
}) {
  const tempPath = path.join(
    artifactDirPath,
    `.${artifactFile}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await operations.writeTemp(tempPath, serialized, "utf8");
    await operations.renameTemp(tempPath, artifactPath);
  } catch (publicationError) {
    try {
      await operations.removeTemp(tempPath);
    } catch {
      try {
        attachArtifactCleanupDiagnostic(publicationError);
      } finally {

        throw publicationError;
      }
    }
    throw publicationError;
  }
}

const CROSS_PROCESS_LEASE_MS = 60_000, CROSS_PROCESS_POLL_MS = 50,
  CROSS_PROCESS_MAX_ATTEMPTS = 100;
const EMPTY_ARTIFACT_DIGEST = createHash("sha256").update("").digest("hex");
const digestBytes = (value) => createHash("sha256").update(value).digest("hex");

function createCrossProcessIdentity({ gitState, generatorIdentity, scip }) {
  const scipInput = scip ? { index_head: gitState.index_head,
    generator_identity: generatorIdentity.generator_identity } : null;
  const identity = {
    repository_identity: gitState.repoRoot,
    head_commit: gitState.index_head,
    schema_identity: `${SIDECAR_ARTIFACT_SCHEMA_VERSION}:${SIDECAR_GRAPH_SCHEMA_VERSION}`,
    generator_identity: generatorIdentity.generator_identity,
    scip_input_identity: JSON.stringify(scipInput ?? { kind: "no-scip" })
  };
  return { identity, identityDigest: digestBytes(JSON.stringify(identity)), scipInput };
}

function followerArtifactMatches(artifact, { identity, scipInput }) {
  const overlayIdentity = artifact?.scip_overlay?.input_identity;
  return Boolean(artifact && artifact.schema_version === SIDECAR_ARTIFACT_SCHEMA_VERSION &&
    artifact.index_head === identity.head_commit &&
    artifact.cache_metadata?.[SIDECAR_ARTIFACT_SCHEMA_FIELD] === SIDECAR_ARTIFACT_SCHEMA_VERSION &&
    artifact.cache_metadata?.graph_schema_version === SIDECAR_GRAPH_SCHEMA_VERSION &&
    validateSidecarGraphSection(artifact.graph,
      { expectedGeneratorIdentity: identity.generator_identity }).length === 0 &&
    (scipInput ? JSON.stringify(overlayIdentity) === JSON.stringify(scipInput)
      : !Object.prototype.hasOwnProperty.call(artifact, "scip_overlay")));
}

async function followCrossProcessBuild({ follow, artifactPath, crossProcess }) {
  for (let attempt = 0; attempt < CROSS_PROCESS_MAX_ATTEMPTS; attempt += 1) {
    let observed = null;
    try { observed = await readSidecarArtifactBytes(artifactPath); } catch {}
    const publicationDigest = observed ? digestBytes(observed.rawBytes) : EMPTY_ARTIFACT_DIGEST;
    const result = await followSidecarBuildLease({ ...follow, publicationDigest,
      publicationIdentity: crossProcess.identityDigest, timeoutMs: CROSS_PROCESS_POLL_MS,
      pollMs: CROSS_PROCESS_POLL_MS, leaseMs: CROSS_PROCESS_LEASE_MS });
    if (result.outcome === "following") {
      return observed && followerArtifactMatches(observed.artifact, crossProcess)
        ? { outcome: "published", artifact: observed.artifact }
        : { outcome: "corrupt_publication" };
    }
    if (result.outcome === "acquired" || result.outcome === "takeover") return result;
    if (result.reason === "publication_mismatch") {
      if (observed) try { if (digestBytes((await readSidecarArtifactBytes(artifactPath)).rawBytes) === publicationDigest)
        return { outcome: "corrupt_publication" }; } catch {}
    } else if (result.outcome !== "timeout") return result;
  }
  return { outcome: "timeout" };
}

function startLeaseRenewal(lease) {
  let tail = Promise.resolve(), failure = null;
  const timer = setInterval(() => {
    tail = tail.then(async () => {
      const result = await renewSidecarBuildLease(lease, { leaseMs: CROSS_PROCESS_LEASE_MS });
      if (result.outcome !== "renewed") failure = result;
    });
  }, CROSS_PROCESS_LEASE_MS / 2);
  timer.unref();
  return { async stop() { clearInterval(timer); await tail; return failure; } };
}

function crossProcessFailure(result) {
  return new SidecarBuildRefusalError(`cross-process sidecar build ${result.outcome}: ${result.reason ?? "unspecified"}`,
    { code: `sidecar_cross_process_${result.outcome}` });
}

function failAndReleaseSidecarBuildLeadership(entry) {
  settleSidecarBuildLeadershipFailed(entry);
  releaseSidecarBuildLeadership(entry);
}

const NO_SCIP_OPTIONS = Symbol("no-scip-options");

export async function buildSidecarIndex(rawOptions) {
  const options = snapshotScipOptions(rawOptions, [["dir", "."],
    ["cacheDir", SIDECAR_DEFAULT_CACHE_DIR], ["artifactFile", SIDECAR_DEFAULT_ARTIFACT_FILE],
    ["rebuild", false], ["scip", false], ["scipOptions", NO_SCIP_OPTIONS],
    ["buildHooks", null]], "sidecar build");
  const hasScipOptions = rawOptions !== undefined &&
    Object.getOwnPropertyDescriptor(rawOptions, "scipOptions") !== undefined;
  const { dir, cacheDir, artifactFile, rebuild, scip,
    scipOptions: suppliedScipOptions, buildHooks } = options;
  const authoritative = suppliedScipOptions === NO_SCIP_OPTIONS && !hasScipOptions;
  const scipOptions = snapshotScipOptions(authoritative ? undefined : suppliedScipOptions ?? undefined,
    [["cacheDir", SCIP_DEFAULT_CACHE_DIR], ["tsconfigPath", "tsconfig.json"],
      ["indexers", ["scip-typescript", "scip-python"]], ["runIndexer", undefined]], "SCIP");

  assertSupportedBuildHooks(buildHooks);
  const requestedLockPath = `${resolveBuildArtifactPath({ repoRoot: path.resolve(dir),
    cacheDir, artifactFile }).artifactPath}${SIDECAR_BUILD_LOCK_SUFFIX}`;
  const coalescible = scip === false && authoritative;
  const provisionalLeadership = claimSidecarBuildLeadership(requestedLockPath, "pending-head",
    { coalescible });
  let canonicalLeadership = { entry: null, follow: null }, provisionalWaitExhausted = false;

  let gitState;
  let generatorIdentity;
  let artifactPaths;
  let lockPath;
  let artifactOperations;
  let crossProcess, crossProcessLockPath;
  try {
    if (provisionalLeadership.follow) {
      const coalesced = await waitForCoalescedSidecarArtifact({
        follow: provisionalLeadership.follow
      });
      if (coalesced) {
        const currentHead = await runSidecarGit(path.resolve(dir),
          ["--no-replace-objects", "rev-parse", "HEAD"]);
        if (currentHead === coalesced.artifact.index_head) {
          return createBuildEnvelope({ ...coalesced, action: "coalesced" });
        }
      }
      provisionalWaitExhausted = !coalesced;
    }

    ({ gitState, generatorIdentity } = await captureBuildGitState(path.resolve(dir)));
    artifactPaths = resolveBuildArtifactPath({ repoRoot: gitState.repoRoot, cacheDir,
      artifactFile });
    lockPath = `${artifactPaths.artifactPath}${SIDECAR_BUILD_LOCK_SUFFIX}`;
    canonicalLeadership = claimSidecarBuildLeadership(lockPath, gitState.index_head,
      { coalescible });
    if (canonicalLeadership.follow && !provisionalWaitExhausted) {
      const coalesced = await waitForCoalescedSidecarArtifact({ follow: canonicalLeadership.follow });
      if (coalesced) {
        const currentHead = await runSidecarGit(gitState.repoRoot,
          ["--no-replace-objects", "rev-parse", "HEAD"]);
        if (currentHead === gitState.index_head && currentHead === coalesced.artifact.index_head) {
          settleSidecarBuildLeadershipPublished(provisionalLeadership.entry, coalesced);
          releaseSidecarBuildLeadership(provisionalLeadership.entry);
          return createBuildEnvelope({ ...coalesced, action: "coalesced" });
        }
      }
    }

    await assertCachePathIgnored({
      repoRoot: gitState.repoRoot,
      cacheDir: artifactPaths.cacheDir,
      artifactRelativePath: artifactPaths.artifactRelativePath
    });

    if (authoritative) {
      await mkdir(artifactPaths.artifactDirPath, { recursive: true });
    }
    artifactOperations = authoritative ? resolveArtifactPublicationOperations(buildHooks) : null;
    if (authoritative && buildHooks === null) {
      crossProcess = createCrossProcessIdentity({ gitState, generatorIdentity, scip });
      const targetKey = digestBytes(artifactPaths.artifactRelativePath);
      crossProcessLockPath = path.join(gitState.repoRoot, ".cache", "repo-code-index-leases",
        `${targetKey}${SIDECAR_BUILD_LOCK_SUFFIX}`);
      await mkdir(path.dirname(crossProcessLockPath), { recursive: true });
    }
  } catch (error) {
    failAndReleaseSidecarBuildLeadership(provisionalLeadership.entry);
    failAndReleaseSidecarBuildLeadership(canonicalLeadership.entry);
    throw error;
  }

  let completedEnvelope = null;
  let lock = null;
  let lease = null, leaseRenewal = null, leasePublished = false;
  try {

    if (authoritative) {
      lock = await acquireSidecarBuildLock(lockPath, gitState.index_head);
    }
    if (crossProcess) {
      let leaseResult = await acquireSidecarBuildLease({ lockPath: crossProcessLockPath,
        ...crossProcess, leaseMs: CROSS_PROCESS_LEASE_MS });
      if (leaseResult.outcome === "following") {
        leaseResult = await followCrossProcessBuild({ follow: leaseResult.follow,
          artifactPath: artifactPaths.artifactPath, crossProcess });
      }
      if (leaseResult.outcome === "published") {
        const artifact = leaseResult.artifact;
        settleSidecarBuildLeadershipPublished(provisionalLeadership.entry, { gitState, artifactPaths, artifact });
        settleSidecarBuildLeadershipPublished(canonicalLeadership.entry, { gitState, artifactPaths, artifact });
        completedEnvelope = createBuildEnvelope({ gitState, artifactPaths, artifact,
          action: rebuild ? "rebuild" : "coalesced" });
        return completedEnvelope;
      }
      if (leaseResult.outcome !== "acquired" && leaseResult.outcome !== "takeover") {
        throw crossProcessFailure(leaseResult);
      }
      lease = leaseResult.lease;
      leaseRenewal = startLeaseRenewal(lease);
    }

    const sources = await collectTrackedSources(gitState.repoRoot, gitState.index_head);
    const graphSources = await collectGraphSources({ repoRoot: gitState.repoRoot, sources });
    if (typeof buildHooks?.beforeGraphExtraction === "function") {
      await buildHooks.beforeGraphExtraction();
    }
    const graph = await extractSidecarGraph({
      sources: graphSources,
      edgeSource: "base_index",
      dirtyGraphMode: "base_index_only"
    });

    const scipOverlay = scip
      ? await buildScipOverlayFromCommittedSnapshot({
          sourceRepoRoot: gitState.repoRoot,
          committedHead: gitState.index_head,
          generatorIdentity: generatorIdentity.generator_identity,
          baseFileNodeIds: new Set(
            graph.graph_nodes.filter((node) => node.kind === "file").map((node) => node.id)
          ),
          cacheDir: scipOptions.cacheDir,
          tsconfigPath: scipOptions.tsconfigPath,
          indexers: scipOptions.indexers,
          runIndexer: scipOptions.runIndexer
        })
      : null;

    const artifact = createBuildArtifact({ gitState, generatorIdentity, artifactPaths, sources,
      graph, scipOverlay, authoritative });
    if (!authoritative) {
      return Object.assign(createBuildEnvelope({ gitState, artifactPaths, artifact, action: "test" }),
        { staleness: "unknown", artifact_exists: false, authoritative: false,
          status_reason: "non_authoritative_test_build_complete" });
    }

    const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
    if (lease) {
      const renewalFailure = await leaseRenewal.stop();
      const renewal = renewalFailure ?? await renewSidecarBuildLease(lease,
        { leaseMs: CROSS_PROCESS_LEASE_MS });
      if (renewal.outcome !== "renewed") throw crossProcessFailure(renewal);
    }
    await publishArtifactAtomically({
      artifactDirPath: artifactPaths.artifactDirPath,
      artifactPath: artifactPaths.artifactPath,
      artifactFile: artifactPaths.artifactFile,
      serialized,
      operations: artifactOperations
    });

    if (lease) {
      const publication = await publishSidecarBuildLease({ lease,
        publicationIdentity: crossProcess.identityDigest,
        publicationDigest: digestBytes(serialized) });
      if (publication.outcome !== "published") throw crossProcessFailure(publication);
      leasePublished = true;
    }

    settleSidecarBuildLeadershipPublished(provisionalLeadership.entry,
      { gitState, artifactPaths, artifact });
    settleSidecarBuildLeadershipPublished(canonicalLeadership.entry,
      { gitState, artifactPaths, artifact });

    completedEnvelope = createBuildEnvelope({
      gitState,
      artifactPaths,
      artifact,
      action: rebuild ? "rebuild" : "build"
    });
    return completedEnvelope;
  } finally {

    failAndReleaseSidecarBuildLeadership(provisionalLeadership.entry);
    failAndReleaseSidecarBuildLeadership(canonicalLeadership.entry);
    if (leaseRenewal) await leaseRenewal.stop();
    if (lease && !leasePublished) await releaseSidecarBuildLease(lease);
    const releaseDiagnostics = await releaseSidecarBuildLock(lock);
    if (completedEnvelope) {
      appendSidecarBuildLockDiagnostics(completedEnvelope, [
        ...(lock?.diagnostics ?? []),
        ...releaseDiagnostics
      ]);
    }
  }
}
