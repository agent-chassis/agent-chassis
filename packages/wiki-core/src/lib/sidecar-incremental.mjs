import {
  collectSidecarGraphFileFacts,
  isSidecarGraphExtractionSourcePath,
  materializeSidecarGraphUnit
} from "./sidecar-graph-extractors.mjs";
import {
  filterSidecarSourcePaths,
  isSidecarScipProviderInputPath,
  normalizeSidecarRepoPath,
  SIDECAR_SCIP_PROVIDER_NAMES
} from "./sidecar-paths.mjs";
import { readSidecarIncrementalStateFromDatabase } from "./sidecar-store.mjs";
import { binaryCompare } from "./sidecar-store-queries.mjs";

export const SIDECAR_EXTRACTION_BASIS = Object.freeze({ extraction_basis: "committed_tree_diff.v1" });

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError(`${label} must be a non-empty NUL-free string`);
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function same(left, right) {
  return canonical(left) === canonical(right);
}

export function isSidecarBaseInputPath(relativePath) {
  return filterSidecarSourcePaths([relativePath]).included.length === 1;
}

function isProviderInputPath(relativePath) {
  return SIDECAR_SCIP_PROVIDER_NAMES.some((provider) =>
    isSidecarScipProviderInputPath(provider, relativePath));
}

function recordPaths(change) {
  return [change.oldPath, change.newPath].filter(Boolean);
}

function decision(action, reason, comparison = null) {
  return Object.freeze({ action, reason, comparison });
}

export async function classifySidecarPreparation({
  publication = null,
  requestedCommit,
  mode = "update",
  generatorIdentity = null,
  compare = null
} = {}) {
  text(requestedCommit, "requestedCommit");
  if (mode !== "update" && mode !== "rebuild") {
    throw new TypeError("sidecar preparation mode must be 'update' or 'rebuild'");
  }
  if (mode === "rebuild") return decision("clean", "rebuild_requested");
  if (!publication?.repository_commit || publication.sequence === "0") {
    return decision("clean", "predecessor_missing");
  }
  if (!same(publication.base_input_identity, SIDECAR_EXTRACTION_BASIS) ||
      publication.base_coverage?.state !== "complete") {
    return decision("clean", "extraction_basis_incompatible");
  }
  if (publication.repository_commit === requestedCommit) {
    return publication.provider_coverage?.state === "complete"
      ? decision("reuse", "source_commit_match")
      : decision("incremental", "provider_coverage_incomplete");
  }
  if (typeof generatorIdentity !== "function") {
    throw new TypeError("classifying a changed commit requires the generator identity reader");
  }
  if (publication.generator_identity !== await generatorIdentity()) {
    return decision("clean", "generator_identity_mismatch");
  }
  if (compare === null) return decision("incremental", "source_commit_changed");
  const comparison = await compare();
  if (comparison?.clean === true) {
    return decision("clean", comparison.reason ?? "predecessor_unavailable", comparison);
  }
  if (!Array.isArray(comparison?.records)) {
    throw new TypeError("committed comparison records must be an array");
  }
  const relevant = comparison.records.some((change) => recordPaths(change).some((value) =>
    isSidecarBaseInputPath(value) || isProviderInputPath(value)));
  return relevant
    ? decision("incremental", "relevant_inputs_changed", comparison)
    : decision("advance_tag", "no_relevant_inputs_changed", comparison);
}

function targetFiles(target) {
  if (!Array.isArray(target.files)) throw new TypeError("target.files must be an array");
  const files = new Map();
  for (const candidate of target.files) {
    const file = record(candidate, "target file");
    const relativePath = normalizeSidecarRepoPath(text(file.path, "target file path"));
    if (files.has(relativePath)) throw new Error(`duplicate target file: ${relativePath}`);
    files.set(relativePath, {
      path: relativePath,
      blob_oid: text(file.blob_oid, "target file blob_oid"),
      mode: text(file.mode, "target file mode"),
      input_identity: text(file.input_identity, "target file input_identity")
    });
  }
  return files;
}

function preparedSources(sources, files) {
  if (!Array.isArray(sources)) throw new TypeError("sources must be an array");
  const result = new Map();
  for (const candidate of sources) {
    const source = record(candidate, "prepared source");
    const relativePath = normalizeSidecarRepoPath(text(source.path, "prepared source path"));
    const file = files.get(relativePath);
    if (!file) throw new Error(`prepared source is absent from target tree: ${relativePath}`);
    if (source.input_identity !== file.input_identity) {
      throw new Error(`prepared source identity mismatch: ${relativePath}`);
    }
    if (typeof source.content !== "string") {
      throw new TypeError(`prepared source content must be text: ${relativePath}`);
    }
    if (result.has(relativePath)) throw new Error(`duplicate prepared source: ${relativePath}`);
    result.set(relativePath, { path: relativePath, content: source.content });
  }
  return result;
}

function validateProviderData(providerData) {
  if (providerData === null || providerData === undefined) return null;
  const value = record(providerData, "provider data");
  for (const field of ["providers", "symbols", "occurrences"]) {
    if (!Array.isArray(value[field])) throw new TypeError(`provider data ${field} must be an array`);
  }
  for (const field of ["symbol_edges", "provider_keys"]) {
    if (value[field] !== undefined && !Array.isArray(value[field])) {
      throw new TypeError(`provider data ${field} must be an array`);
    }
  }
  return value;
}

function publicationTarget(target, current) {
  return {
    sequence: (BigInt(current.sequence) + 1n).toString(),
    repository_commit: text(target.repository_commit, "target repository_commit"),
    repository_tree: text(target.repository_tree, "target repository_tree"),
    generator_identity: text(target.generator_identity, "target generator_identity"),
    base_input_identity: record(target.base_input_identity, "target base_input_identity"),
    base_coverage: record(target.base_coverage, "target base_coverage"),
    provider_input_identity: record(target.provider_input_identity, "target provider_input_identity"),
    provider_coverage: record(target.provider_coverage, "target provider_coverage"),
    published_at: text(target.published_at, "target published_at")
  };
}

export async function prepareSidecarIncrementalDelta({
  graph,
  target,
  clean = false,
  sources = [],
  diffRecords = [],
  parserProvider = null,
  providerData = null
} = {}) {
  if (!graph || typeof graph.prepare !== "function") {
    throw new TypeError("incremental preparation requires the owned candidate connection");
  }
  const desired = record(target, "incremental target");
  const files = targetFiles(desired);
  const prepared = preparedSources(sources, files);
  const providers = validateProviderData(providerData);
  if (!Array.isArray(diffRecords)) throw new TypeError("diffRecords must be an array");
  const extractionPaths = clean
    ? [...files.keys()].filter(isSidecarGraphExtractionSourcePath)
    : [];
  if (clean) {
    const missing = extractionPaths.filter((relativePath) => !prepared.has(relativePath));
    if (missing.length > 0) {
      const error = new Error(`clean graph extraction requires prepared sources: ${missing.join(", ")}`);
      error.code = "sidecar_clean_sources_missing";
      throw error;
    }
  }
  const directPaths = clean
    ? new Set(extractionPaths)
    : new Set(diffRecords.flatMap(recordPaths).filter(isSidecarBaseInputPath));
  const state = readSidecarIncrementalStateFromDatabase(graph, {
    sourcePaths: [...directPaths],
    candidatePaths: [...directPaths],
    allUnits: clean,
    allFiles: clean
  });
  const publication = publicationTarget(desired, state.publication);

  const sourcePathSet = new Set(files.keys());
  const oldUnits = new Map(state.units.map((unit) => [unit.source_path, unit]));
  const affectedPaths = new Set(oldUnits.keys());
  for (const relativePath of directPaths) affectedPaths.add(relativePath);
  const units = [];
  let parsedFiles = 0;
  for (const relativePath of [...affectedPaths].sort(binaryCompare)) {
    if (!files.has(relativePath)) {
      if (oldUnits.has(relativePath)) units.push({ unit_id: `file:${relativePath}`, remove: true });
      continue;
    }
    const supplied = prepared.get(relativePath);
    let facts;
    if (supplied) {
      facts = await collectSidecarGraphFileFacts({ source: supplied, parserProvider });
      parsedFiles += facts.parse_count;
    } else {
      const stored = oldUnits.get(relativePath);
      if (!stored) continue;
      if (stored.input_identity !== files.get(relativePath).input_identity) {
        throw new Error(`changed graph source was not prepared: ${relativePath}`);
      }
      facts = stored.facts;
    }
    if (facts.source_path !== relativePath) {
      throw new Error(`stored graph facts source mismatch: ${relativePath}`);
    }
    const materialized = materializeSidecarGraphUnit({ facts, sourcePaths: sourcePathSet });
    units.push({
      unit_id: `file:${relativePath}`,
      source_path: relativePath,
      input_identity: files.get(relativePath).input_identity,
      provider_kind: facts.source_kind,
      facts,
      ...materialized
    });
  }

  const fileDeletes = clean
    ? state.files.filter((file) => !files.has(file.path)).map((file) => file.path)
    : [...directPaths].filter((relativePath) => !files.has(relativePath));
  const fileUpserts = clean
    ? [...files.values()]
    : [...directPaths].flatMap((relativePath) => files.has(relativePath) ? [files.get(relativePath)] : []);
  const delta = {
    expected_publication: {
      store_incarnation: state.publication.store_incarnation,
      sequence: state.publication.sequence
    },
    publication,
    files: { upsert: fileUpserts, delete: fileDeletes },
    units,
    replace_provider_data: providers !== null,
    ...(providers ? {
      ...(providers.provider_keys ? { provider_keys: providers.provider_keys } : {}),
      providers: providers.providers,
      symbols: providers.symbols,
      occurrences: providers.occurrences,
      symbol_edges: providers.symbol_edges ?? []
    } : {})
  };
  return {
    clean,
    delta,
    metrics: {
      parsed_files: parsedFiles,
      affected_units: units.length,
      file_upserts: fileUpserts.length,
      file_deletes: fileDeletes.length
    }
  };
}
