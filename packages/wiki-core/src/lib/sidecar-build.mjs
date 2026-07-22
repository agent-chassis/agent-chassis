import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  SIDECAR_ARTIFACT_SCHEMA_FIELD,
  SIDECAR_ARTIFACT_SCHEMA_VERSION,
  createSidecarResultEnvelope
} from "./sidecar-schema.mjs";
import { extractSidecarGraph } from "./sidecar-graph-extractors.mjs";
import { buildScipOverlay, SCIP_DEFAULT_CACHE_DIR } from "./sidecar-scip-overlay.mjs";
import { filterSidecarSourcePaths, normalizeSidecarRepoPath } from "./sidecar-paths.mjs";
import {
  SIDECAR_DEFAULT_ARTIFACT_FILE,
  SIDECAR_DEFAULT_CACHE_DIR,
  isSidecarCachePathIgnored,
  discoverSidecarGitState,
  runSidecarGit
} from "./sidecar-status.mjs";
import {
  SIDECAR_BUILD_LOCK_SUFFIX,
  acquireSidecarBuildLock,
  appendSidecarBuildLockDiagnostics,
  claimSidecarBuildLeadership,
  releaseSidecarBuildLeadership,
  releaseSidecarBuildLock,
  settleSidecarBuildLeadershipFailed,
  settleSidecarBuildLeadershipPublished,
  waitForCoalescedSidecarArtifact
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

  const raw = await runSidecarGit(repoRoot, ["ls-tree", "-r", "-z", treeIsh], {
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
    const child = spawn("git", ["-C", repoRoot, "cat-file", "--batch"], {
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

function createBuildArtifact({ gitState, artifactPaths, sources, graph, scipOverlay = null }) {
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
      graph_schema_version: graph.graph_schema_version,
      graph_node_count: graph.graph_nodes.length,
      graph_edge_count: graph.graph_edges.length,

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
    graph,

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
  artifact,
  operations
}) {
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
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

export async function buildSidecarIndex({
  dir = ".",
  cacheDir = SIDECAR_DEFAULT_CACHE_DIR,
  artifactFile = SIDECAR_DEFAULT_ARTIFACT_FILE,
  rebuild = false,

  scip = false,
  scipOptions = {},
  buildHooks = null
} = {}) {

  assertSupportedBuildHooks(buildHooks);
  const gitState = await discoverSidecarGitState(path.resolve(dir));
  const artifactPaths = resolveBuildArtifactPath({
    repoRoot: gitState.repoRoot,
    cacheDir,
    artifactFile
  });

  await assertCachePathIgnored({
    repoRoot: gitState.repoRoot,
    cacheDir: artifactPaths.cacheDir,
    artifactRelativePath: artifactPaths.artifactRelativePath
  });

  await mkdir(artifactPaths.artifactDirPath, { recursive: true });

  const lockPath = `${artifactPaths.artifactPath}${SIDECAR_BUILD_LOCK_SUFFIX}`;
  const artifactOperations = resolveArtifactPublicationOperations(buildHooks);

  const coalescible = scip === false;

  const leadership = claimSidecarBuildLeadership(lockPath, gitState.index_head, { coalescible });

  let completedEnvelope = null;
  let lock = null;

  try {

    if (leadership.follow) {
      const coalesced = await waitForCoalescedSidecarArtifact({ follow: leadership.follow });
      if (coalesced) {
        return createBuildEnvelope({
          gitState,
          artifactPaths,
          artifact: coalesced,
          action: "coalesced"
        });
      }
    }

    lock = await acquireSidecarBuildLock(lockPath, gitState.index_head);

    const sources = await collectTrackedSources(gitState.repoRoot, gitState.index_head || "HEAD");
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
      ? await buildScipOverlay({
          repoRoot: gitState.repoRoot,
          baseFileNodeIds: new Set(
            graph.graph_nodes.filter((node) => node.kind === "file").map((node) => node.id)
          ),
          cacheDir: scipOptions.cacheDir || SCIP_DEFAULT_CACHE_DIR,
          ...(scipOptions.tsconfigPath ? { tsconfigPath: scipOptions.tsconfigPath } : {}),
          ...(scipOptions.indexers ? { indexers: scipOptions.indexers } : {}),
          ...(scipOptions.runIndexer ? { runIndexer: scipOptions.runIndexer } : {})
        })
      : null;

    const artifact = createBuildArtifact({ gitState, artifactPaths, sources, graph, scipOverlay });
    await publishArtifactAtomically({
      artifactDirPath: artifactPaths.artifactDirPath,
      artifactPath: artifactPaths.artifactPath,
      artifactFile: artifactPaths.artifactFile,
      artifact,
      operations: artifactOperations
    });

    settleSidecarBuildLeadershipPublished(leadership.entry, artifact);

    completedEnvelope = createBuildEnvelope({
      gitState,
      artifactPaths,
      artifact,
      action: rebuild ? "rebuild" : "build"
    });
    return completedEnvelope;
  } finally {

    settleSidecarBuildLeadershipFailed(leadership.entry);

    releaseSidecarBuildLeadership(leadership.entry);
    const releaseDiagnostics = await releaseSidecarBuildLock(lock);
    if (completedEnvelope) {
      appendSidecarBuildLockDiagnostics(completedEnvelope, [
        ...(lock?.diagnostics ?? []),
        ...releaseDiagnostics
      ]);
    }
  }
}
