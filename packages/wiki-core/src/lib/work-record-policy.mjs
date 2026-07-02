import { createHash } from "node:crypto";

import {
  validateVirtualSidecarPath,
  SidecarPathValidationError
} from "./sidecar-paths.mjs";
import { mergeReadScopeRefs } from "./work-record-schema.mjs";
import { classifyWorkRecordBlastRadius } from "./work-record-blast-radius.mjs";

export {
  classifyWorkRecordBlastRadius,
  collectBlastRadiusReasons,
  deriveMarkdownBlastRadiusEvidence,
  maxBlastRadiusLevel
} from "./work-record-blast-radius.mjs";

export const WORK_RECORD_POLICY_CONFIDENCE_VALUES = Object.freeze([
  "low",
  "medium",
  "high"
]);

export const WORK_RECORD_POLICY_BLAST_RADIUS_LEVEL_VALUES = Object.freeze([
  "low",
  "medium",
  "high",
  "critical"
]);

export const WORK_RECORD_POLICY_SURFACE_KIND_VALUES = Object.freeze([
  "implementation_path",
  "test_path",
  "docs_contract",
  "wiki_record",
  "canonical_ref"
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sortStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))]
    .sort((left, right) => left.localeCompare(right));
}

function stripTrailingSlashes(value) {
  let output = String(value);
  while (output.endsWith("/")) {
    output = output.slice(0, -1);
  }
  return output;
}

function fileStem(relativePath) {
  const name = String(relativePath).split("/").at(-1) || "";
  const dotIndex = name.lastIndexOf(".");
  return dotIndex === -1 ? name : name.slice(0, dotIndex);
}

function normalizePolicyPathEntry(inputPath) {
  if (typeof inputPath !== "string") {
    throw new TypeError("work record policy path must be a string");
  }

  const originalPath = inputPath;
  const strippedPath = stripTrailingSlashes(originalPath);
  if (!strippedPath) {
    throw new SidecarPathValidationError("work record policy path must not be empty", {
      code: "empty_path",
      inputPath: originalPath
    });
  }

  const { relativePath } = validateVirtualSidecarPath(strippedPath);
  return {
    input_path: originalPath,
    relative_path: relativePath,
    is_directory: originalPath.endsWith("/")
  };
}

function surfaceKindForEntry(entry) {
  if (entry.relative_path.startsWith("docs/")) {
    return "docs_contract";
  }
  if (entry.relative_path.startsWith("wiki/")) {
    return "wiki_record";
  }
  if (entry.relative_path.startsWith("tests/") || entry.relative_path.includes(".test.")) {
    return "test_path";
  }
  return "implementation_path";
}

function entryAliases(entry) {
  const aliases = new Set();
  const stem = fileStem(entry.relative_path);
  aliases.add(stem);
  aliases.add(stem.replace(/\.test$/, ""));
  aliases.add(stem.replace(/\.spec$/, ""));
  if (stem.endsWith(".test")) {
    aliases.add(stem.slice(0, -5));
  }

  const segments = entry.relative_path.split("/");
  if (segments[0] === "packages" && segments[1]) {
    aliases.add(segments[1]);
  }

  return [...aliases].filter(Boolean);
}

function familyKeyForEntry(entry) {
  const segments = entry.relative_path.split("/");
  if (entry.source_field === "docs") {
    return entry.relative_path;
  }
  if (entry.source_field === "wiki") {
    return "wiki";
  }
  if (segments[0] === "packages" && segments[1] && segments[2] === "src") {
    return `packages/${segments[1]}/src`;
  }
  if (segments[0] === "packages" && segments[1]) {
    return `packages/${segments[1]}/${segments[2] || ""}`.replace(/\/$/, "");
  }
  if (segments[0] === "tests") {
    return `tests/${fileStem(entry.relative_path).replace(/\.test$/, "")}`;
  }
  return entry.relative_path;
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function stableSortObject(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortObject(entry));
  }
  if (!isObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, stableSortObject(value[key])])
  );
}

function digestJson(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(stableSortObject(value))).digest("hex")}`;
}

function clonePathEntry(entry) {
  return {
    input_path: entry.input_path,
    relative_path: entry.relative_path,
    source_field: entry.source_field,
    kind: entry.kind,
    family_key: entry.family_key
  };
}

function createDefaultGraphState(graphState = null) {
  if (isObject(graphState)) {
    return {
      graph_available: Boolean(graphState.graph_available),
      edge_source: graphState.edge_source ?? "unavailable",
      dirty_graph_mode: graphState.dirty_graph_mode ?? "unavailable",
      status_reason: graphState.status_reason ?? (graphState.graph_available ? "available" : "graph_absent"),
      graph_schema_version: graphState.graph_schema_version ?? null
    };
  }

  return {
    graph_available: false,
    edge_source: "unavailable",
    dirty_graph_mode: "unavailable",
    status_reason: "graph_absent",
    graph_schema_version: null
  };
}

function collectPathEntries(record, selectedUnit) {
  const pathEntries = [];
  const source = isObject(selectedUnit) ? selectedUnit : record;
  for (const field of ["write_scope", "repo_paths"]) {
    const values = Array.isArray(source?.[field]) && source[field].length > 0 ? source[field] : record?.[field];
    if (!Array.isArray(values)) {
      continue;
    }
    for (const inputPath of values) {
      if (typeof inputPath !== "string") {
        continue;
      }
      try {
        const normalized = normalizePolicyPathEntry(inputPath);
        pathEntries.push({
          ...normalized,
          source_field: field,
          kind: surfaceKindForEntry({
            relative_path: normalized.relative_path,
            source_field: field
          })
        });
      } catch {
        continue;
      }
    }
  }

  return pathEntries;
}

function collectCanonicalRefs(record) {
  const refs = [];

  for (const docPath of mergeReadScopeRefs(record)) {
    if (typeof docPath !== "string") {
      continue;
    }
    refs.push({
      id: null,
      path: docPath,
      source_kind: "canonical_docs"
    });
  }

  for (const relatedId of Array.isArray(record?.related) ? record.related : []) {
    if (typeof relatedId !== "string") {
      continue;
    }
    let pathValue = null;
    if (relatedId.startsWith("WK-")) {
      pathValue = `wiki/issues/${relatedId}.md`;
    } else if (relatedId.startsWith("IN-")) {
      pathValue = `wiki/initiatives/${relatedId}.md`;
    } else if (relatedId.startsWith("DEC-")) {
      pathValue = `wiki/decisions/${relatedId}.md`;
    } else if (relatedId.startsWith("SRC-")) {
      pathValue = `wiki/sources/${relatedId}.md`;
    }
    refs.push({
      id: relatedId,
      path: pathValue,
      source_kind: relatedId.startsWith("DEC-") ? "decision" : relatedId.startsWith("IN-") ? "canonical_wiki" : "issue"
    });
  }

  return uniqueBy(refs, (entry) => `${entry.id ?? ""}|${entry.path ?? ""}`)
    .sort((left, right) =>
      `${left.path ?? ""}|${left.id ?? ""}`.localeCompare(`${right.path ?? ""}|${right.id ?? ""}`)
    );
}

function selectUnitArray(record, selectedUnit, field) {
  const unitValues = (selectedUnit ?? record)?.[field];
  if (Array.isArray(unitValues) && unitValues.length > 0) {
    return unitValues;
  }
  return record?.[field];
}

function collectPolicyCanonicalRefs(record, selectedUnit) {

  const unitRefs = mergeReadScopeRefs(selectedUnit ?? record);
  const recordRefs = mergeReadScopeRefs(record);
  return collectCanonicalRefs({
    docs: unitRefs.length > 0 ? unitRefs : recordRefs,
    related: selectUnitArray(record, selectedUnit, "related")
  });
}

function buildFamilyAliases(buckets) {
  const familyAliases = new Map();
  for (const [familyKey, entries] of buckets.entries()) {
    const aliases = new Set([familyKey, fileStem(familyKey)]);
    for (const entry of entries) {
      for (const alias of entryAliases(entry)) {
        aliases.add(alias);
      }
    }
    familyAliases.set(familyKey, aliases);
  }
  return familyAliases;
}

function addBucketMetadata(metadata, bucketKey, fields = {}) {
  metadata.set(bucketKey, {
    cluster_basis: fields.cluster_basis ?? "path_family",
    implementation_cluster: Boolean(fields.implementation_cluster),
    graph_bearing_paths: sortStrings(fields.graph_bearing_paths ?? [])
  });
}

function attachTestsToBuckets(testEntries, buckets, metadata, familyAliases) {
  for (const entry of testEntries) {
    const entryAliasesList = entryAliases(entry);
    let bestFamily = null;
    let bestScore = 0;
    for (const [familyKey, aliases] of familyAliases.entries()) {
      const score = entryAliasesList.reduce(
        (acc, alias) => acc + (aliases.has(alias) ? 1 : 0),
        0
      );
      if (
        score > bestScore ||
        (score > 0 && score === bestScore && bestFamily && familyKey.length > bestFamily.length)
      ) {
        bestFamily = familyKey;
        bestScore = score;
      }
    }
    const familyKey = bestFamily || familyKeyForEntry(entry);
    if (!buckets.has(familyKey)) {
      buckets.set(familyKey, []);
      addBucketMetadata(metadata, familyKey, { implementation_cluster: true });
      familyAliases.set(familyKey, new Set([familyKey, fileStem(familyKey), ...entryAliases(entry)]));
    }
    buckets.get(familyKey).push(entry);
  }
}

function createFilenameFamilyBuckets(pathEntries) {
  const sourceEntries = pathEntries.filter((entry) => entry.kind === "implementation_path");
  const testEntries = pathEntries.filter((entry) => entry.kind === "test_path");
  const coordinationEntries = pathEntries.filter(
    (entry) => entry.kind === "docs_contract" || entry.kind === "wiki_record"
  );
  const buckets = new Map();
  const metadata = new Map();

  for (const entry of sourceEntries) {
    const familyKey = familyKeyForEntry(entry);
    if (!buckets.has(familyKey)) {
      buckets.set(familyKey, []);
      addBucketMetadata(metadata, familyKey, { implementation_cluster: true });
    }
    buckets.get(familyKey).push(entry);
  }

  const familyAliases = buildFamilyAliases(buckets);
  const implementationFamilyCount = buckets.size;

  attachTestsToBuckets(testEntries, buckets, metadata, familyAliases);

  if (coordinationEntries.length > 0) {
    let targetKey;
    if (implementationFamilyCount === 1) {
      targetKey = [...familyAliases.keys()][0];
    } else if (implementationFamilyCount === 0) {
      targetKey = familyKeyForEntry(coordinationEntries[0]);
    } else {
      targetKey = "coordination";
    }
    for (const entry of coordinationEntries) {
      if (!buckets.has(targetKey)) {
        buckets.set(targetKey, []);
        addBucketMetadata(metadata, targetKey, { implementation_cluster: false });
      }
      buckets.get(targetKey).push(entry);
    }
  }

  return { buckets, metadata };
}

function createComponentFamilyBuckets(pathEntries, { graphImportAdjacency, graphBearingPaths }) {
  const graphBearingPathSet = new Set(graphBearingPaths.filter((entry) => typeof entry === "string" && entry));
  const sourceEntries = pathEntries.filter((entry) => entry.kind === "implementation_path");
  const graphSourceEntries = sourceEntries.filter((entry) => graphBearingPathSet.has(entry.relative_path));
  const graphSourcePaths = sortStrings(graphSourceEntries.map((entry) => entry.relative_path));
  const graphSourceEntriesByPath = new Map();
  for (const entry of graphSourceEntries) {
    if (!graphSourceEntriesByPath.has(entry.relative_path)) {
      graphSourceEntriesByPath.set(entry.relative_path, entry);
    }
  }
  const uniqueGraphSourceEntries = graphSourcePaths.map((relativePath) => graphSourceEntriesByPath.get(relativePath));

  if (graphSourcePaths.length <= 1) {
    if (sourceEntries.length === 0) {
      return createFilenameFamilyBuckets(pathEntries);
    }
    return createTrivialImplementationBuckets(pathEntries, uniqueGraphSourceEntries);
  }

  const testEntries = pathEntries.filter((entry) => entry.kind === "test_path");
  const coordinationEntries = [
    ...pathEntries.filter((entry) => entry.kind === "docs_contract" || entry.kind === "wiki_record"),
    ...sourceEntries.filter((entry) => !graphBearingPathSet.has(entry.relative_path))
  ];
  const entriesByPath = new Map();
  const parentByPath = new Map();

  for (const entry of graphSourceEntries) {
    if (!entriesByPath.has(entry.relative_path)) {
      entriesByPath.set(entry.relative_path, []);
      parentByPath.set(entry.relative_path, entry.relative_path);
    }
    entriesByPath.get(entry.relative_path).push(entry);
  }

  function find(pathValue) {
    const parent = parentByPath.get(pathValue);
    if (parent === pathValue) {
      return pathValue;
    }
    const root = find(parent);
    parentByPath.set(pathValue, root);
    return root;
  }

  function union(left, right) {
    if (!parentByPath.has(left) || !parentByPath.has(right)) {
      return;
    }
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) {
      return;
    }
    const [winner, loser] = [leftRoot, rightRoot].sort((a, b) => a.localeCompare(b));
    parentByPath.set(loser, winner);
  }

  for (const pair of graphImportAdjacency) {
    if (!Array.isArray(pair) || pair.length < 2) {
      continue;
    }
    const [fromPath, toPath] = pair;
    if (typeof fromPath === "string" && typeof toPath === "string") {
      union(fromPath, toPath);
    }
  }

  const pathsByRoot = new Map();
  for (const relativePath of entriesByPath.keys()) {
    const root = find(relativePath);
    if (!pathsByRoot.has(root)) {
      pathsByRoot.set(root, []);
    }
    pathsByRoot.get(root).push(relativePath);
  }

  const buckets = new Map();
  const metadata = new Map();
  const components = [...pathsByRoot.values()]
    .map((paths) => sortStrings(paths))
    .sort((left, right) => left[0].localeCompare(right[0]));

  for (const paths of components) {
    const componentKey = `component:${paths[0]}`;
    buckets.set(componentKey, paths.flatMap((relativePath) => entriesByPath.get(relativePath) ?? []));
    addBucketMetadata(metadata, componentKey, {
      cluster_basis: "graph_component",
      implementation_cluster: true,
      graph_bearing_paths: paths
    });
  }

  const familyAliases = buildFamilyAliases(buckets);
  attachTestsToBuckets(testEntries, buckets, metadata, familyAliases);

  if (coordinationEntries.length > 0) {
    const componentKeys = [...metadata.entries()]
      .filter(([, bucketMetadata]) => bucketMetadata.cluster_basis === "graph_component")
      .map(([bucketKey]) => bucketKey);
    const targetKey = componentKeys.length === 1 ? componentKeys[0] : "coordination";
    if (!buckets.has(targetKey)) {
      buckets.set(targetKey, []);
      addBucketMetadata(metadata, targetKey, {
        cluster_basis: "coordination",
        implementation_cluster: false
      });
    }
    for (const entry of coordinationEntries) {
      buckets.get(targetKey).push(entry);
    }
  }

  return { buckets, metadata };
}

function createTrivialImplementationBuckets(pathEntries, graphSourceEntries) {
  const sourceEntries = pathEntries.filter((entry) => entry.kind === "implementation_path");
  const testEntries = pathEntries.filter((entry) => entry.kind === "test_path");
  const coordinationEntries = pathEntries.filter(
    (entry) => entry.kind === "docs_contract" || entry.kind === "wiki_record"
  );
  const buckets = new Map();
  const metadata = new Map();

  if (sourceEntries.length > 0) {
    const primarySource = graphSourceEntries[0] ?? sourceEntries[0];
    const bucketKey = `single-implementation:${primarySource.relative_path}`;
    buckets.set(bucketKey, [...sourceEntries, ...testEntries, ...coordinationEntries]);
    addBucketMetadata(metadata, bucketKey, {
      cluster_basis: "single_implementation",
      implementation_cluster: true,
      graph_bearing_paths: graphSourceEntries.map((entry) => entry.relative_path)
    });
    return { buckets, metadata };
  }

  if (testEntries.length > 0) {
    const bucketKey = familyKeyForEntry(testEntries[0]);
    buckets.set(bucketKey, [...testEntries, ...coordinationEntries]);
    addBucketMetadata(metadata, bucketKey, {
      cluster_basis: "single_implementation",
      implementation_cluster: true,
      graph_bearing_paths: []
    });
    return { buckets, metadata };
  }

  if (coordinationEntries.length > 0) {
    const bucketKey = familyKeyForEntry(coordinationEntries[0]);
    buckets.set(bucketKey, coordinationEntries);
    addBucketMetadata(metadata, bucketKey, {
      cluster_basis: "coordination",
      implementation_cluster: false,
      graph_bearing_paths: []
    });
  }

  return { buckets, metadata };
}

function createFamilyBuckets(pathEntries, { graphImportAdjacency = null, graphBearingPaths = null } = {}) {
  if (Array.isArray(graphImportAdjacency) && Array.isArray(graphBearingPaths)) {
    return createComponentFamilyBuckets(pathEntries, { graphImportAdjacency, graphBearingPaths });
  }
  return createFilenameFamilyBuckets(pathEntries);
}

function classifyClusterConfidence(cluster, { graphAvailable }) {
  const implementationCount = cluster.affected_surfaces.filter((entry) => entry.kind === "implementation_path").length;
  const testCount = cluster.likely_tests.length;
  const docsCount = cluster.docs_contracts.length;

  if (implementationCount === 0 && docsCount > 0 && testCount === 0) {
    return graphAvailable ? "medium" : "low";
  }

  if (!graphAvailable) {
    if (implementationCount <= 1 && docsCount === 0 && testCount <= 1) {
      return "high";
    }
    if (implementationCount <= 2 && testCount <= 2) {
      return "medium";
    }
    return "low";
  }

  if (implementationCount <= 1 && testCount <= 1) {
    return "high";
  }
  if (implementationCount <= 2 && testCount <= 2) {
    return "medium";
  }
  return "low";
}

function sortClusterEntries(clusterEntries) {
  return [...clusterEntries].sort((left, right) => {
    const leftInputs = left.input_paths.join("|");
    const rightInputs = right.input_paths.join("|");
    const inputComparison = leftInputs.localeCompare(rightInputs);
    if (inputComparison !== 0) {
      return inputComparison;
    }

    const leftSurfaces = left.affected_surfaces.map((entry) => `${entry.kind}:${entry.path}`).join("|");
    const rightSurfaces = right.affected_surfaces.map((entry) => `${entry.kind}:${entry.path}`).join("|");
    const surfaceComparison = leftSurfaces.localeCompare(rightSurfaces);
    if (surfaceComparison !== 0) {
      return surfaceComparison;
    }

    return left.cluster_digest.localeCompare(right.cluster_digest);
  });
}

function finalizeClusters(clusterMap, { graphAvailable, canonicalRefs = [], bucketMetadata = new Map() }) {
  const clusters = [];
  for (const [familyKey, entries] of clusterMap.entries()) {
    const metadata = bucketMetadata.get(familyKey) ?? {
      cluster_basis: "path_family",
      implementation_cluster: entries.some((entry) => entry.kind === "implementation_path" || entry.kind === "test_path"),
      graph_bearing_paths: []
    };
    const inputPaths = sortStrings(entries.map((entry) => entry.relative_path));
    const affectedSurfaces = uniqueBy(
      entries.map((entry) => ({
        kind: entry.kind,
        path: entry.relative_path,
        reason:
          entry.kind === "docs_contract"
            ? "docs contract"
            : entry.kind === "wiki_record"
              ? "coordination surface"
              : entry.kind === "test_path"
                ? "validation surface"
                : "declared implementation surface"
      })),
      (entry) => `${entry.kind}:${entry.path}`
    ).sort((left, right) => `${left.kind}:${left.path}`.localeCompare(`${right.kind}:${right.path}`));

    const likelyTests = uniqueBy(
      entries.filter((entry) => entry.kind === "test_path").map((entry) => ({
        path: entry.relative_path,
        reason: "declared validation target"
      })),
      (entry) => entry.path
    ).sort((left, right) => left.path.localeCompare(right.path));

    const docsContracts = sortStrings(entries.filter((entry) => entry.kind === "docs_contract").map((entry) => entry.relative_path));
    const clusterCanonicalRefs = collectPolicyCanonicalRefs(
      {
        docs: entries.filter((entry) => entry.kind === "docs_contract").map((entry) => entry.relative_path),
        related: []
      },
      {
        docs: [],
        related: canonicalRefs.filter((entry) => entry.id).map((entry) => entry.id)
      }
    );
    const derivedEvidence = [
      {
        kind: "work_record_policy_path_family",
        family_key: familyKey,
        path_count: entries.length,
        source_fields: sortStrings(entries.map((entry) => entry.source_field)),
        graph_available: graphAvailable,
        cluster_basis: metadata.cluster_basis,
        implementation_cluster: Boolean(metadata.implementation_cluster),
        graph_bearing_paths: sortStrings(metadata.graph_bearing_paths)
      }
    ];

    const cluster = {
      cluster_id: null,
      input_paths: inputPaths,
      affected_surfaces: affectedSurfaces,
      likely_tests: likelyTests,
      docs_contracts: docsContracts,
      canonical_refs: clusterCanonicalRefs,
      derived_evidence: derivedEvidence,
      confidence: classifyClusterConfidence(
        {
          affected_surfaces: affectedSurfaces,
          likely_tests: likelyTests,
          docs_contracts: docsContracts
        },
        { graphAvailable }
      ),
      split_recommendation: null
    };
    cluster.cluster_digest = digestJson({
      input_paths: cluster.input_paths,
      affected_surfaces: cluster.affected_surfaces,
      likely_tests: cluster.likely_tests,
      docs_contracts: cluster.docs_contracts,
      canonical_refs: cluster.canonical_refs,
      derived_evidence: cluster.derived_evidence,
      confidence: cluster.confidence,
      split_recommendation: { required: false, reason: "" }
    });
    clusters.push(cluster);
  }

  const sortedClusters = sortClusterEntries(clusters);
  return sortedClusters.map((cluster, index) => ({
    cluster_id: `cluster-${index + 1}`,
    input_paths: cluster.input_paths,
    affected_surfaces: cluster.affected_surfaces,
    likely_tests: cluster.likely_tests,
    docs_contracts: cluster.docs_contracts,
    canonical_refs: cluster.canonical_refs,
    derived_evidence: cluster.derived_evidence,
    confidence: cluster.confidence,
    split_recommendation: cluster.split_recommendation ?? {
      required: false,
      reason: "single cluster"
    }
  }));
}

function countImplementationClusters(clusters) {
  return clusters.filter((cluster) => {
    const policyEvidence = Array.isArray(cluster?.derived_evidence)
      ? cluster.derived_evidence.find((entry) => entry?.kind === "work_record_policy_path_family")
      : null;
    if (policyEvidence && typeof policyEvidence.implementation_cluster === "boolean") {
      return policyEvidence.implementation_cluster;
    }
    return Array.isArray(cluster?.affected_surfaces) &&
      cluster.affected_surfaces.some(
        (entry) => entry.kind === "implementation_path" || entry.kind === "test_path"
      );
  }).length;
}

function summarizeSplitRecommendation(clusters) {
  if (clusters.length === 0) {
    return {
      required: true,
      reason: "no valid cluster inputs"
    };
  }

  const implementationCount = countImplementationClusters(clusters);

  if (clusters.length === 1) {
    return {
      required: false,
      reason: "single implementation cluster"
    };
  }

  if (implementationCount <= 1) {
    return {
      required: false,
      reason: "single implementation cluster with coordination surfaces"
    };
  }

  return {
    required: true,
    reason:
      implementationCount === clusters.length
        ? `split into ${implementationCount} implementation clusters`
        : `split into ${implementationCount} implementation clusters (of ${clusters.length} total clusters)`
  };
}

export function buildPolicyContext(record, options = {}) {
  if (!isObject(record)) {
    throw new TypeError("work record policy requires a record object");
  }

  const selectedUnit = isObject(options.selected_unit) ? options.selected_unit : null;
  const graphState = createDefaultGraphState(options.graph_state);
  const state = {
    dirty_state:
      options.dirty_state ??
      options.graph_state?.dirty_state ??
      "unknown",
    staleness:
      options.staleness ??
      options.graph_state?.staleness ??
      "unknown",
    graph_available: graphState.graph_available,
    graph_state: graphState
  };

  const pathEntries = collectPathEntries(record, selectedUnit);
  const invalid_paths = [];
  for (const field of ["write_scope", "repo_paths"]) {
    const values = Array.isArray((selectedUnit ?? record)?.[field]) && (selectedUnit ?? record)[field].length > 0
      ? (selectedUnit ?? record)[field]
      : record?.[field];
    if (!Array.isArray(values)) {
      continue;
    }
    for (const inputPath of values) {
      if (typeof inputPath !== "string") {
        invalid_paths.push({
          input_path: inputPath,
          code: "invalid_type",
          relative_path: null,
          pattern: null,
          reason: "work record policy path must be a string",
          message: "work record policy path must be a string"
        });
        continue;
      }
      try {
        normalizePolicyPathEntry(inputPath);
      } catch (error) {
        if (error instanceof SidecarPathValidationError) {
          invalid_paths.push({
            input_path: inputPath,
            code: error.code,
            relative_path: error.relativePath ?? null,
            pattern: error.pattern ?? null,
            reason: error.reason ?? error.message,
            message: error.message
          });
          continue;
        }
        throw error;
      }
    }
  }

  const graphImportAdjacency = Array.isArray(options.graph_import_adjacency)
    ? options.graph_import_adjacency
    : null;
  const graphBearingPaths = Array.isArray(options.graph_bearing_paths)
    ? options.graph_bearing_paths
    : null;

  return {
    record_id: record.id ?? null,
    unit_kind: selectedUnit?.kind ?? record?.record_kind ?? "work_item",
    slice_id: selectedUnit?.slice_id ?? null,
    path_entries: pathEntries,
    invalid_paths,
    canonical_refs: collectPolicyCanonicalRefs(record, selectedUnit),
    graph_import_adjacency: graphImportAdjacency,
    graph_bearing_paths: graphBearingPaths,
    state
  };
}

export function computeWorkRecordClusters(record, options = {}) {
  const context = buildPolicyContext(record, options);
  if (context.invalid_paths.length > 0) {
    return [];
  }

  const { buckets: familyBuckets, metadata: bucketMetadata } = createFamilyBuckets(context.path_entries, {
    graphImportAdjacency: context.graph_import_adjacency,
    graphBearingPaths: context.graph_bearing_paths
  });
  const clusters = finalizeClusters(familyBuckets, {
    graphAvailable: context.state.graph_available,
    canonicalRefs: context.canonical_refs,
    bucketMetadata
  });
  const splitRecommendation = summarizeSplitRecommendation(clusters);
  return clusters.map((cluster) => ({
    ...cluster,
    split_recommendation: splitRecommendation
  }));
}

export function createWorkRecordSplitRecommendation(clusters) {
  return summarizeSplitRecommendation(Array.isArray(clusters) ? clusters : []);
}

export function normalizeWorkRecordPolicyPath(inputPath) {
  return normalizePolicyPathEntry(inputPath);
}

export function evaluateWorkRecordPolicy(record, options = {}) {
  const context = buildPolicyContext(record, options);
  const clusters = context.invalid_paths.length > 0 ? [] : computeWorkRecordClusters(record, options);
  const splitRecommendation = createWorkRecordSplitRecommendation(clusters);
  const blastRadius = classifyWorkRecordBlastRadius(record, clusters, options);
  if (blastRadius.level === "low" && splitRecommendation.required && clusters.length === 0) {
    blastRadius.reasons = [...blastRadius.reasons, splitRecommendation.reason];
  }

  return {
    record_id: context.record_id,
    unit_kind: context.unit_kind,
    slice_id: context.slice_id,
    invalid_paths: context.invalid_paths,
    cluster_count: clusters.length,
    clusters,
    split_recommendation: splitRecommendation,
    blast_radius: {
      level: blastRadius.level,
      reasons: blastRadius.reasons,
      accepted_escalation_id: blastRadius.accepted_escalation_id
    },
    canonical_refs: context.canonical_refs,
    derived_evidence: [
      {
        kind: "work_record_policy_inputs",
        path_entries: context.path_entries.map(clonePathEntry),
        invalid_paths: cloneJson(context.invalid_paths)
      }
    ],
    state: context.state
  };
}
