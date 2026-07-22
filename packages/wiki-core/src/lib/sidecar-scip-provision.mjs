

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { SIDECAR_GRAPH_SCHEMA_VERSION } from "./sidecar-graph-schema.mjs";

import {
  decodeScipIndex,
  normalizeScipIndex,
  SCIP_INDEXER_SPECS,
  SCIP_CALL_GRAPH_UNAVAILABLE,
  SCIP_CALL_GRAPH_REASON_ENCLOSING_RANGE_UNPOPULATED
} from "./sidecar-scip-normalize.mjs";

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
  } catch {
    return false;
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

export async function buildScipOverlay({
  repoRoot,
  baseFileNodeIds = null,
  cacheDir = SCIP_DEFAULT_CACHE_DIR,
  tsconfigPath = "tsconfig.json",
  indexers = ["scip-typescript", "scip-python"],
  runIndexer = defaultRunIndexer
} = {}) {
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

    return emptyScipLayer({
      statusReason: SCIP_STATUS_INDEXER_UNAVAILABLE,
      errorReason: error?.message ? String(error.message).slice(0, 500) : "scip_overlay_failed",
      indexers
    });
  }
}

export async function clearScipCache({ repoRoot, cacheDir = SCIP_DEFAULT_CACHE_DIR } = {}) {
  await rm(path.join(repoRoot, cacheDir), { recursive: true, force: true });
}

export async function writeScipCacheMeta({ repoRoot, cacheDir = SCIP_DEFAULT_CACHE_DIR, meta }) {
  const metaPath = path.join(repoRoot, cacheDir, "scip-cache-meta.json");
  await mkdir(path.join(repoRoot, cacheDir), { recursive: true });
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}
