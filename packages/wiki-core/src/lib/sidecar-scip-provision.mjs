

import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify, types as utilTypes } from "node:util";

import { SIDECAR_GRAPH_SCHEMA_VERSION } from "./sidecar-graph-schema.mjs";

import {
  decodeScipIndex,
  normalizeScipIndex,
  SCIP_INDEXER_SPECS,
  SCIP_CALL_GRAPH_UNAVAILABLE,
  SCIP_CALL_GRAPH_REASON_ENCLOSING_RANGE_UNPOPULATED
} from "./sidecar-scip-normalize.mjs";

export class SidecarScipProvisionError extends Error {
  constructor(message, { code, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "SidecarScipProvisionError";
    this.code = code;
  }
}

export const SCIP_DEFAULT_CACHE_DIR = ".cache/repo-scip-index";

export const SCIP_STATUS_EXTRACTED = "scip_extracted";
export const SCIP_STATUS_NOT_CONFIGURED = "scip_not_configured";
export const SCIP_STATUS_INDEXER_UNAVAILABLE = "scip_indexer_unavailable";

function emptyScipLayer({ statusReason, errorReason = null, indexers = [] }) {
  return {
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    scip_available: false,
    graph_available: false,
    status_reason: statusReason,
    ...(errorReason ? { error_reason: errorReason } : {}),
    graph_nodes: [],
    graph_edges: [],
    coverage: {
      indexers,
      document_count: 0,
      covered_document_count: 0,
      symbol_count: 0,
      uncovered_documents: []
    }
  };
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function defaultRunIndexer({ repoRoot, indexer, spec, cacheDir, tsconfigPath }) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(repoRoot, cacheDir, spec.output);

    const projectDir = path.dirname(tsconfigPath) || ".";
    const args =
      indexer === "scip-typescript"
        ? ["-y", spec.package, "index", "--cwd", repoRoot, "--output", outputPath, projectDir]
        : ["-y", spec.package, "index", "--cwd", repoRoot, "--output", outputPath, "--quiet"];
    const child = spawn("npx", args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    const stderrChunks = [];
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", async (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${indexer} exited with code ${code}: ${Buffer.concat(stderrChunks).toString("utf8").slice(0, 2000)}`
          )
        );
        return;
      }
      try {
        resolve(await readFile(outputPath));
      } catch (error) {
        reject(new Error(`${indexer} produced no .scip output at ${outputPath}: ${error.message}`));
      }
    });
  });
}
export function snapshotScipOptions(rawOptions, entries, label) {
  if (rawOptions !== undefined && utilTypes.isProxy(rawOptions)) throw new TypeError(`${label} options must not be a Proxy`);
  if (rawOptions !== undefined &&
      ((typeof rawOptions !== "object" && typeof rawOptions !== "function") || rawOptions === null)) throw new TypeError(`${label} options must be an object`);
  const options = Object.create(null);
  for (const [key, fallback] of entries) {
    const descriptor = rawOptions === undefined ? undefined : Object.getOwnPropertyDescriptor(rawOptions, key);
    if (descriptor && !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} option '${key}' must be an own data property`);
    options[key] = descriptor?.value === undefined ? fallback : descriptor.value;
  }
  return options;
}

export async function buildScipOverlay(rawOptions) {
  const { repoRoot, baseFileNodeIds, cacheDir, tsconfigPath, indexers, runIndexer, failOnIndexerError } = snapshotScipOptions(rawOptions, [
    ["repoRoot", undefined], ["baseFileNodeIds", null], ["cacheDir", SCIP_DEFAULT_CACHE_DIR],
    ["tsconfigPath", "tsconfig.json"], ["indexers", ["scip-typescript", "scip-python"]],
    ["runIndexer", defaultRunIndexer], ["failOnIndexerError", false]
  ], "SCIP overlay");
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    throw new TypeError("buildScipOverlay requires repoRoot");
  }

  const absoluteTsconfig = path.isAbsolute(tsconfigPath)
    ? tsconfigPath
    : path.join(repoRoot, tsconfigPath);
  if (!(await pathExists(absoluteTsconfig))) {
    return emptyScipLayer({ statusReason: SCIP_STATUS_NOT_CONFIGURED, indexers });
  }

  try {
    await mkdir(path.join(repoRoot, cacheDir), { recursive: true });
    const nodes = new Map();
    const edges = new Map();
    const providerDescriptors = [];
    const perIndexerCoverage = [];

    for (const indexer of indexers) {
      const spec = SCIP_INDEXER_SPECS[indexer];
      if (!spec) {
        throw new Error(`unknown SCIP indexer: ${indexer}`);
      }
      const buffer = await runIndexer({ repoRoot, indexer, spec, cacheDir, tsconfigPath });
      const decoded = await decodeScipIndex(buffer);
      const layer = normalizeScipIndex(decoded, { indexer, baseFileNodeIds });
      for (const node of layer.graph_nodes) {
        nodes.set(node.id, node);
      }
      for (const edge of layer.graph_edges) {
        edges.set(edge.id, edge);
      }
      providerDescriptors.push(layer.provider_descriptor);
      perIndexerCoverage.push(layer.coverage);
    }

    const graphNodes = [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
    const graphEdges = [...edges.values()].sort((left, right) => left.id.localeCompare(right.id));
    const callGraphAvailable = perIndexerCoverage.some((c) => c.call_graph_available === true);
    const callGraphUnavailableReason =
      perIndexerCoverage.find(
        (c) =>
          c.call_graph_available === false &&
          typeof c.call_graph_unavailable_reason === "string" &&
          c.call_graph_unavailable_reason.length > 0
      )?.call_graph_unavailable_reason || SCIP_CALL_GRAPH_REASON_ENCLOSING_RANGE_UNPOPULATED;

    return {
      graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
      scip_available: true,
      status_reason: SCIP_STATUS_EXTRACTED,
      graph_nodes: graphNodes,
      graph_edges: graphEdges,
      provider_descriptors: providerDescriptors,
      coverage: {
        indexers: [...indexers],
        cache_dir: cacheDir,
        document_count: perIndexerCoverage.reduce((sum, c) => sum + (c.document_count || 0), 0),
        covered_document_count: perIndexerCoverage.reduce(
          (sum, c) => sum + (c.covered_document_count || 0),
          0
        ),
        symbol_count: graphNodes.length,
        edge_count: graphEdges.length,
        resolved_symbol_count: perIndexerCoverage.reduce(
          (sum, c) => sum + (c.resolved_symbol_count || 0),
          0
        ),
        unresolved_symbol_count: perIndexerCoverage.reduce(
          (sum, c) => sum + (c.unresolved_symbol_count || 0),
          0
        ),

        caller_edge_count: perIndexerCoverage.reduce((sum, c) => sum + (c.caller_edge_count || 0), 0),
        unattributed_reference_count: perIndexerCoverage.reduce(
          (sum, c) => sum + (c.unattributed_reference_count || 0),
          0
        ),
        call_graph_available: callGraphAvailable,
        ...(callGraphAvailable
          ? {}
          : {
              call_graph_status_reason: SCIP_CALL_GRAPH_UNAVAILABLE,
              call_graph_unavailable_reason: callGraphUnavailableReason
            }),
        uncovered_documents: perIndexerCoverage
          .flatMap((c) => c.uncovered_documents || [])
          .sort((left, right) => left.localeCompare(right)),
        per_indexer: perIndexerCoverage
      }
    };
  } catch (error) {
    if (failOnIndexerError) {
      throw new SidecarScipProvisionError(
        `authoritative SCIP indexing failed: ${String(error?.message ?? "unknown").slice(0, 500)}`,
        { code: "scip_indexer_failed", cause: error }
      );
    }

    return emptyScipLayer({
      statusReason: SCIP_STATUS_INDEXER_UNAVAILABLE,
      errorReason: error?.message ? String(error.message).slice(0, 500) : "scip_overlay_failed",
      indexers
    });
  }
}

async function removeSnapshotSymlinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) await rm(target, { force: true });
    else if (entry.isDirectory()) await removeSnapshotSymlinks(target);
  }
}
export async function buildScipOverlayFromCommittedSnapshot(rawOptions) {
  const options = snapshotScipOptions(rawOptions, [["sourceRepoRoot", undefined],
    ["committedHead", undefined], ["generatorIdentity", undefined],
    ["baseFileNodeIds", null], ["cacheDir", SCIP_DEFAULT_CACHE_DIR],
    ["tsconfigPath", "tsconfig.json"], ["indexers", ["scip-typescript", "scip-python"]],
    ["runIndexer", defaultRunIndexer]
  ], "committed-snapshot SCIP");
  const { sourceRepoRoot, committedHead, generatorIdentity } = options;
  if (typeof sourceRepoRoot !== "string" || sourceRepoRoot.length === 0)
    throw new TypeError("committed-snapshot SCIP requires sourceRepoRoot");
  if (typeof committedHead !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(committedHead)) {
    throw new SidecarScipProvisionError(
      "committed-snapshot SCIP requires one captured commit",
      { code: "scip_snapshot_head_unstable" }
    );
  }
  let snapshotContainer, result, failure;
  try {
    snapshotContainer = await mkdtemp(path.join(os.tmpdir(), "sidecar-scip-snapshot-"));
    const snapshotRoot = path.join(snapshotContainer, "repo"), archivePath = path.join(snapshotContainer, "snapshot.tar");
    await mkdir(snapshotRoot);
    await promisify(execFile)("git", ["--no-replace-objects", "-C", sourceRepoRoot, "archive",
      "--format=tar", `--output=${archivePath}`, committedHead], { maxBuffer: 1024 * 1024 });
    await promisify(execFile)("tar", ["-xf", archivePath, "-C", snapshotRoot],
      { maxBuffer: 1024 * 1024 });
    await removeSnapshotSymlinks(snapshotRoot);
    const overlayOptions = Object.assign(Object.create(null), options,
      { repoRoot: snapshotRoot, failOnIndexerError: true });
    const layer = await buildScipOverlay(overlayOptions);
    result = {
      ...layer,
      input_identity: { index_head: committedHead.toLowerCase(), generator_identity: generatorIdentity }
    };
  } catch (error) {
    failure =
      error instanceof SidecarScipProvisionError
        ? error
        : new SidecarScipProvisionError(
            `committed SCIP snapshot provisioning failed: ${String(error?.message ?? "unknown").slice(0, 500)}`,
            { code: "scip_snapshot_provision_failed", cause: error }
          );
  }
  if (snapshotContainer) {
    try {
      await rm(snapshotContainer, { recursive: true, force: true });
    } catch (error) {
      throw new SidecarScipProvisionError(
        `committed SCIP snapshot cleanup failed: ${String(error?.message ?? "unknown").slice(0, 500)}`,
        { code: "scip_snapshot_cleanup_failed", cause: failure ?? error }
      );
    }
  }
  if (failure) throw failure;
  return result;
}

export async function clearScipCache(rawOptions) {
  const { repoRoot, cacheDir } = snapshotScipOptions(rawOptions,
    [["repoRoot", undefined], ["cacheDir", SCIP_DEFAULT_CACHE_DIR]], "SCIP cache cleanup");
  await rm(path.join(repoRoot, cacheDir), { recursive: true, force: true });
}

export async function writeScipCacheMeta(rawOptions) {
  const { repoRoot, cacheDir, meta } = snapshotScipOptions(rawOptions,
    [["repoRoot", undefined], ["cacheDir", SCIP_DEFAULT_CACHE_DIR], ["meta", undefined]],
    "SCIP cache metadata");
  const metaPath = path.join(repoRoot, cacheDir, "scip-cache-meta.json");
  await mkdir(path.join(repoRoot, cacheDir), { recursive: true });
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}
