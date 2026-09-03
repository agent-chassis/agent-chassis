import { createSidecarResultEnvelope } from "./sidecar-schema.mjs";
import {
  matchSidecarPathPattern,
  validateVirtualSidecarPath
} from "./sidecar-paths.mjs";

export const SIDECAR_CANONICAL_JOIN_MATCH_TYPES = Object.freeze([
  "exact_path",
  "directory_prefix",
  "explicit_pattern",
  "docs_backlink",
  "related_id",
  "inferred_test_adjacency"
]);

export const SIDECAR_CANONICAL_JOIN_RANKING = Object.freeze({
  match_weights: Object.freeze({
    exact_path: 600,
    directory_prefix: 500,
    explicit_pattern: 450,
    docs_backlink: 350,
    related_id: 250,
    inferred_test_adjacency: 150
  }),
  state_adjustments: Object.freeze({
    active_issue: 25,
    closed_issue: -225,
    suppressed_facet: -500
  }),
  tie_break: Object.freeze([
    "score_desc",
    "best_match_weight_desc",
    "active_issue_before_closed_issue",
    "source_kind_priority",
    "updated_desc",
    "id_asc",
    "path_asc"
  ])
});

const CLOSED_ISSUE_STATUSES = new Set(["done", "closed", "resolved", "archived"]);
const SOURCE_KIND_PRIORITY = Object.freeze({
  canonical_docs: 0,
  decision: 1,
  area: 2,
  issue: 3,
  canonical_wiki: 4
});

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function asStringList(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string" && entry.trim()).map(String);
  }
  if (typeof value === "string" && value.trim()) {
    return [value];
  }
  return [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
}

function increment(counts, field, amount = 1) {
  counts[field] = (counts[field] || 0) + amount;
}

function normalizeJoinPath(inputPath) {
  const directory = inputPath.endsWith("/");
  const pathValue = directory ? inputPath.slice(0, -1) : inputPath;
  const { relativePath } = validateVirtualSidecarPath(pathValue);
  return { relativePath, directory };
}

function pathHasGlobSyntax(pathValue) {
  return pathValue.includes("*");
}

function sourceKindForMatch(matchType) {
  return matchType === "inferred_test_adjacency" ? "test_adjacency" : "code_index";
}

function evidenceBasisForMatch(matchType) {
  if (matchType === "docs_backlink") {
    return "docs_backlink";
  }
  if (matchType === "related_id") {
    return "explicit_metadata";
  }
  if (matchType === "inferred_test_adjacency") {
    return "inferred_test_adjacency";
  }
  return "path_match";
}

function relatedIds(record) {
  return uniqueStrings([
    ...asStringList(record.frontmatter?.related),
    ...asStringList(record.frontmatter?.depends_on),
    ...asStringList(record.frontmatter?.blocks)
  ]);
}

function declaredPathEntries(record) {
  const entries = [];
  for (const field of ["repo_paths", "write_scope"]) {
    for (const value of asStringList(record.frontmatter?.[field])) {
      entries.push({ field, value });
    }
  }
  return entries;
}

function docsBacklinkEntries(record) {
  return asStringList(record.frontmatter?.docs).map((value) => ({
    field: "docs",
    value
  }));
}

function ancestorDirectories(relativePath) {
  const segments = relativePath.split("/");
  const ancestors = [];
  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
}

function normalizeKnownPathIndex(knownPaths, counts) {
  if (knownPaths == null) return null;
  const exact = new Set();
  const ancestors = new Set();
  for (const pathValue of asStringList(knownPaths)) {
    const normalized = normalizeJoinPath(pathValue).relativePath;
    increment(counts, "known_paths_normalized");
    exact.add(normalized);
    for (const ancestor of ancestorDirectories(normalized)) {
      increment(counts, "known_path_ancestors_indexed");
      ancestors.add(ancestor);
    }
  }
  return { exact, ancestors };
}

function segmentMatches(patternSegment, pathSegment) {
  if (!patternSegment.includes("*")) return patternSegment === pathSegment;
  const parts = patternSegment.split("*");
  if (!pathSegment.startsWith(parts[0])) return false;
  let offset = parts[0].length;
  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;
    const next = pathSegment.indexOf(part, offset);
    if (next === -1) return false;
    offset = next + part.length;
  }
  return parts.at(-1) === "" || pathSegment.endsWith(parts.at(-1));
}

function anchoredPatternMatches(pattern, relativePath) {
  if (pattern.endsWith("/**")) {
    const patternSegments = pattern.slice(0, -3).split("/");
    const pathSegments = relativePath.split("/");
    return pathSegments.length >= patternSegments.length &&
      patternSegments.every((segment, index) => segmentMatches(segment, pathSegments[index]));
  }
  const patternSegments = pattern.split("/");
  const pathSegments = relativePath.split("/");
  return patternSegments.length === pathSegments.length &&
    patternSegments.every((segment, index) => segmentMatches(segment, pathSegments[index]));
}

function validatedPatternMatches(pattern, relativePath) {
  if (!pattern.startsWith("**/")) return anchoredPatternMatches(pattern, relativePath);
  const remainder = pattern.slice(3);
  const segments = relativePath.split("/");
  return segments.some((_, index) =>
    validatedPatternMatches(remainder, segments.slice(index).join("/"))
  );
}

function defaultTestAdjacency(inputPath) {
  const parsed = inputPath.match(/^(?<dir>.*\/)?(?<base>[^/.]+)\.[^.]+$/);
  if (!parsed?.groups?.base) {
    return [];
  }
  const directory = parsed.groups.dir || "";
  const basename = parsed.groups.base;
  return uniqueStrings([
    `${directory}${basename}.test.mjs`,
    `${directory}${basename}.test.js`,
    `tests/${basename}.test.mjs`,
    `tests/${basename}.test.js`
  ]).filter((candidate) => candidate !== inputPath);
}

function normalizeAdjacency(adjacency, counts) {
  const entries = adjacency instanceof Map ? adjacency.entries() : Object.entries(adjacency || {});
  const normalized = new Map();
  for (const [inputPath, adjacentPaths] of entries) {
    increment(counts, "test_adjacency_entries_normalized");
    normalized.set(
      normalizeJoinPath(inputPath).relativePath,
      asStringList(adjacentPaths).map((entry) => normalizeJoinPath(entry).relativePath)
    );
  }
  return normalized;
}

function knownAdjacentTestPaths({ inputPath, adjacency, knownPathIndex, counts }) {
  if (!knownPathIndex) {
    return [];
  }
  increment(counts, "test_adjacency_lookups");
  return uniqueStrings([...(adjacency.get(inputPath) || []), ...defaultTestAdjacency(inputPath)])
    .map((candidate) => normalizeJoinPath(candidate).relativePath)
    .filter((candidate) => knownPathIndex.exact.has(candidate));
}

function addCandidateMatch(candidates, normalized, match) {
  const key = normalized.key;
  if (!key) {
    return;
  }
  const candidate = candidates.get(key) || {
    record: normalized.record,
    normalized,
    matches: []
  };
  const duplicate = candidate.matches.some(
    (existing) =>
      existing.match_type === match.match_type &&
      existing.input_path === match.input_path &&
      existing.declared_path === match.declared_path &&
      existing.related_id === match.related_id
  );
  if (!duplicate) {
    candidate.matches.push(match);
  }
  candidates.set(key, candidate);
}

function createMatchExplanation(match) {
  const { _order, ...publicMatch } = match;
  return {
    ...publicMatch,
    source_kind: sourceKindForMatch(match.match_type),
    canonicality: "derived",
    evidence_basis: evidenceBasisForMatch(match.match_type)
  };
}

function scoreCandidate(candidate) {
  let score = 0;
  let bestMatchWeight = 0;
  const matchTypes = new Set();
  for (const match of candidate.matches) {
    const weight = SIDECAR_CANONICAL_JOIN_RANKING.match_weights[match.match_type] || 0;
    score += weight;
    bestMatchWeight = Math.max(bestMatchWeight, weight);
    matchTypes.add(match.match_type);
  }

  if (candidate.normalized.issueState === "active") {
    score += SIDECAR_CANONICAL_JOIN_RANKING.state_adjustments.active_issue;
  }
  if (candidate.normalized.issueState === "closed") {
    score += SIDECAR_CANONICAL_JOIN_RANKING.state_adjustments.closed_issue;
  }
  if (candidate.normalized.retrievalVisibility === "suppressed") {
    score += SIDECAR_CANONICAL_JOIN_RANKING.state_adjustments.suppressed_facet;
  }

  return {
    score,
    bestMatchWeight,
    matchTypes: [...matchTypes].sort(
      (left, right) =>
        SIDECAR_CANONICAL_JOIN_MATCH_TYPES.indexOf(left) -
        SIDECAR_CANONICAL_JOIN_MATCH_TYPES.indexOf(right)
    )
  };
}

function compareCandidates(left, right) {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  if (right.best_match_weight !== left.best_match_weight) {
    return right.best_match_weight - left.best_match_weight;
  }
  const leftClosed = left.issue_state === "closed" ? 1 : 0;
  const rightClosed = right.issue_state === "closed" ? 1 : 0;
  if (leftClosed !== rightClosed) {
    return leftClosed - rightClosed;
  }
  const sourceKindCompare =
    (SOURCE_KIND_PRIORITY[left.source_kind] ?? 99) -
    (SOURCE_KIND_PRIORITY[right.source_kind] ?? 99);
  if (sourceKindCompare !== 0) {
    return sourceKindCompare;
  }
  const updatedCompare = String(right.updated ?? "").localeCompare(String(left.updated ?? ""));
  if (updatedCompare !== 0) {
    return updatedCompare;
  }
  const idCompare = String(left.id ?? "").localeCompare(String(right.id ?? ""));
  if (idCompare !== 0) {
    return idCompare;
  }
  return String(left.path ?? "").localeCompare(String(right.path ?? ""));
}

function createCanonicalRef(candidate, rank) {
  const scoring = scoreCandidate(candidate);
  const referenceFields = candidate.normalized.reference;
  const firstMatch = candidate.matches
    .slice()
    .sort(
      (left, right) =>
        SIDECAR_CANONICAL_JOIN_MATCH_TYPES.indexOf(left.match_type) -
          SIDECAR_CANONICAL_JOIN_MATCH_TYPES.indexOf(right.match_type) ||
        left._order - right._order
    )[0];
  return {
    ...referenceFields,
    rank,
    score: scoring.score,
    best_match_weight: scoring.bestMatchWeight,
    match_types: scoring.matchTypes,
    match_explanations: candidate.matches
      .slice()
      .sort((left, right) => left._order - right._order)
      .map(createMatchExplanation),
    provenance: {
      source_kind: referenceFields.source_kind,
      canonicality: "canonical",
      evidence_basis: evidenceBasisForMatch(firstMatch.match_type)
    }
  };
}

function generatedSuppression(record) {
  const reference = record.reference;
  return {
    kind: "sidecar_canonical_join_suppression",
    reason: "generated_view",
    record: reference,
    provenance: {
      source_kind: reference.source_kind,
      canonicality: "generated",
      evidence_basis: "path_match"
    }
  };
}

function retrievalSuppression(record) {
  const reference = record.reference;
  return {
    kind: "sidecar_canonical_join_suppression",
    reason: "retrieval_visibility_suppressed",
    record: reference,
    provenance: {
      source_kind: reference.source_kind,
      canonicality: "canonical",
      evidence_basis: "explicit_metadata"
    }
  };
}

function staleWriteScopeEvidence({ record, inputPath, entry }) {
  const reference = record.reference;
  return {
    kind: "sidecar_stale_write_scope",
    input_path: inputPath,
    record: reference,
    declared_path: entry.value,
    record_field: entry.field,
    reason: "write_scope_path_not_in_known_source_set",
    provenance: {
      source_kind: reference.source_kind,
      canonicality: "canonical",
      evidence_basis: "path_match"
    }
  };
}

function invalidJoinPathEvidence({ record, inputPath, entry, error }) {
  const reference = record.reference;
  return {
    kind: "sidecar_invalid_join_path",
    input_path: inputPath,
    record: reference,
    declared_path: entry.value,
    record_field: entry.field,
    reason: error instanceof Error ? error.message : String(error),
    provenance: {
      source_kind: reference.source_kind,
      canonicality: "canonical",
      evidence_basis: "path_match"
    }
  };
}

function addIndexEntry(index, key, value) {
  const entries = index.get(key) || [];
  entries.push(value);
  index.set(key, entries);
}

function evidenceSemanticKey(evidence) {
  return JSON.stringify([
    evidence.kind,
    evidence.reason,
    evidence.record?.id ?? null,
    evidence.record?.path ?? null,
    evidence.record_field ?? null,
    evidence.declared_path ?? null
  ]);
}

function addDerivedEvidence(evidenceByFact, evidence) {
  const key = evidenceSemanticKey(evidence);
  if (!evidenceByFact.has(key)) evidenceByFact.set(key, evidence);
}

function normalizeCanonicalRecords({
  canonicalRecords,
  inputPaths,
  knownPathIndex,
  counts,
  includeSuppressed,
  evidenceByFact
}) {
  return canonicalRecords.map((record, recordIndex) => {
    increment(counts, "canonical_records_normalized");
    const pathValue = record.relativePath || record.path || record.frontmatter?.path || null;
    const id = record.id || record.frontmatter?.id || null;
    const pageKind = record.pageKind || record.kind || "";
    let sourceKind = "canonical_wiki";
    if (pathValue?.startsWith("docs/") || pageKind === "docs") sourceKind = "canonical_docs";
    else if (pathValue?.startsWith("wiki/issues/") || pageKind === "issues") sourceKind = "issue";
    else if (pathValue?.startsWith("wiki/decisions/") || pageKind === "decisions") {
      sourceKind = "decision";
    } else if (pathValue?.startsWith("wiki/areas/") || pageKind === "areas") sourceKind = "area";
    let normalizedPath = null;
    let generated = false;
    if (pathValue) {
      try {
        normalizedPath = normalizeJoinPath(pathValue).relativePath;
      } catch (error) {
        if (error?.reason !== "generated wiki view") throw error;
        normalizedPath = error.relativePath ?? pathValue;
        generated = true;
      }
    }
    const visibility = String(record.frontmatter?.retrieval_visibility ?? "default").toLowerCase();
    const normalizedIssueState = sourceKind !== "issue"
      ? "not_issue"
      : CLOSED_ISSUE_STATUSES.has(String(record.frontmatter?.status ?? "").toLowerCase())
        ? "closed"
        : "active";
    const reference = {
      id,
      title: record.title || record.frontmatter?.title || null,
      path: pathValue,
      source_kind: sourceKind,
      status: record.frontmatter?.status ?? null,
      updated: record.frontmatter?.updated ?? null,
      retrieval_visibility: visibility,
      issue_state: normalizedIssueState
    };
    const normalized = {
      record,
      recordIndex,
      key: reference.path || reference.id,
      id: reference.id,
      path: reference.path,
      normalizedPath,
      generated,
      retrievalVisibility: visibility,
      issueState: normalizedIssueState,
      reference,
      relationships: relatedIds(record),
      declarations: [],
      docs: []
    };
    increment(counts, "relationship_values_normalized", normalized.relationships.length);

    if (generated) {
      addDerivedEvidence(evidenceByFact, generatedSuppression(normalized));
      return normalized;
    }
    if (visibility === "suppressed" && !includeSuppressed) {
      addDerivedEvidence(evidenceByFact, retrievalSuppression(normalized));
    }

    for (const [declarationIndex, entry] of declaredPathEntries(record).entries()) {
      increment(counts, "declared_paths_normalized");
      try {
        if (pathHasGlobSyntax(entry.value)) {

          matchSidecarPathPattern(entry.value, inputPaths[0]);
          normalized.declarations.push({
            ...entry,
            declarationIndex,
            kind: "glob",
            pattern: entry.value,
            stale: false
          });
          continue;
        }
        const parsed = normalizeJoinPath(entry.value);
        const stale = Boolean(
          knownPathIndex &&
            entry.field === "write_scope" &&
            !knownPathIndex.exact.has(parsed.relativePath) &&
            !(parsed.directory && knownPathIndex.ancestors.has(parsed.relativePath))
        );
        normalized.declarations.push({
          ...entry,
          declarationIndex,
          kind: parsed.directory ? "directory" : "exact",
          relativePath: parsed.relativePath,
          stale
        });
      } catch (error) {
        addDerivedEvidence(
          evidenceByFact,
          invalidJoinPathEvidence({ record: normalized, inputPath: inputPaths[0], entry, error })
        );
      }
    }

    for (const [docsIndex, entry] of docsBacklinkEntries(record).entries()) {
      increment(counts, "docs_backlinks_normalized");
      try {
        normalized.docs.push({
          ...entry,
          docsIndex,
          relativePath: normalizeJoinPath(entry.value).relativePath
        });
      } catch (error) {
        addDerivedEvidence(
          evidenceByFact,
          invalidJoinPathEvidence({ record: normalized, inputPath: inputPaths[0], entry, error })
        );
      }
    }
    return normalized;
  });
}

function buildCanonicalJoinIndexes(normalizedRecords, counts, includeSuppressed) {
  const indexes = {
    recordPaths: new Map(),
    exactDeclarations: new Map(),
    directoryDeclarations: new Map(),
    docsBacklinks: new Map(),
    globDeclarations: [],
    recordsById: new Map(),
    inboundRelationships: new Map()
  };
  for (const normalized of normalizedRecords) {
    if (normalized.id) indexes.recordsById.set(normalized.id, normalized);
    if (
      normalized.generated ||
      (normalized.retrievalVisibility === "suppressed" && !includeSuppressed)
    ) continue;
    if (normalized.normalizedPath) {
      addIndexEntry(indexes.recordPaths, normalized.normalizedPath, normalized);
      increment(counts, "exact_path_index_entries");
    }
    for (const declaration of normalized.declarations) {
      if (declaration.kind === "glob") {
        indexes.globDeclarations.push({ normalized, declaration });
        increment(counts, "glob_index_entries");
      } else {
        addIndexEntry(indexes.exactDeclarations, declaration.relativePath, {
          normalized,
          declaration
        });
        increment(counts, "exact_path_index_entries");
        if (declaration.kind === "directory") {
          addIndexEntry(indexes.directoryDeclarations, declaration.relativePath, {
            normalized,
            declaration
          });
          increment(counts, "directory_prefix_index_entries");
        }
      }
    }
    for (const docs of normalized.docs) {
      addIndexEntry(indexes.docsBacklinks, docs.relativePath, { normalized, docs });
      increment(counts, "docs_backlink_index_entries");
    }
    for (const relatedId of normalized.relationships) {
      addIndexEntry(indexes.inboundRelationships, relatedId, normalized);
      increment(counts, "relationship_index_entries");
    }
  }
  return indexes;
}

function declarationMatch(declaration, matchType) {
  return {
    match_type: matchType,
    declared_path: declaration.value,
    record_field: declaration.field
  };
}

function collectDeclaredEvents({
  queryPath,
  inputPath,
  inputIndex,
  inferredIndex,
  indexes,
  counts,
  events,
  evidenceByFact
}) {
  const inferred = inferredIndex !== null;
  increment(counts, "exact_index_lookups");
  for (const { normalized, declaration } of indexes.exactDeclarations.get(queryPath) || []) {
    increment(counts, "indexed_candidate_visits");
    if (!inferred && declaration.stale) {
      addDerivedEvidence(
        evidenceByFact,
        staleWriteScopeEvidence({
          record: normalized,
          inputPath,
          entry: declaration
        })
      );
      continue;
    }
    events.push({
      normalized,
      order: [inputIndex, normalized.recordIndex, inferred ? 3 : 1, inferredIndex ?? 0,
        declaration.declarationIndex],
      match: {
        ...declarationMatch(declaration, inferred ? "inferred_test_adjacency" : "exact_path"),
        input_path: inputPath,
        ...(inferred ? { adjacent_test_path: queryPath } : {})
      }
    });
  }

  for (const ancestor of ancestorDirectories(queryPath)) {
    increment(counts, "directory_prefix_index_lookups");
    for (const { normalized, declaration } of indexes.directoryDeclarations.get(ancestor) || []) {
      increment(counts, "indexed_candidate_visits");
      if (!inferred && declaration.stale) {
        addDerivedEvidence(
          evidenceByFact,
          staleWriteScopeEvidence({
            record: normalized,
            inputPath,
            entry: declaration
          })
        );
        continue;
      }
      events.push({
        normalized,
        order: [inputIndex, normalized.recordIndex, inferred ? 3 : 1, inferredIndex ?? 0,
          declaration.declarationIndex],
        match: {
          ...declarationMatch(
            declaration,
            inferred ? "inferred_test_adjacency" : "directory_prefix"
          ),
          input_path: inputPath,
          ...(inferred ? { adjacent_test_path: queryPath } : {})
        }
      });
    }
  }

  for (const { normalized, declaration } of indexes.globDeclarations) {
    increment(counts, "glob_candidate_checks");
    if (!validatedPatternMatches(declaration.pattern, queryPath)) continue;
    events.push({
      normalized,
      order: [inputIndex, normalized.recordIndex, inferred ? 3 : 1, inferredIndex ?? 0,
        declaration.declarationIndex],
      match: {
        ...declarationMatch(
          declaration,
          inferred ? "inferred_test_adjacency" : "explicit_pattern"
        ),
        input_path: inputPath,
        ...(inferred ? { adjacent_test_path: queryPath } : {})
      }
    });
  }
}

function compareEventOrder(left, right) {
  for (let index = 0; index < left.order.length; index += 1) {
    if (left.order[index] !== right.order[index]) return left.order[index] - right.order[index];
  }
  return 0;
}

export function joinSidecarPathsToCanonicalRecords({
  paths,
  canonicalRecords,
  knownExistingPaths = null,
  testAdjacency = {},
  includeSuppressed = false,
  envelope = {},
  operationObserver = null
} = {}) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("sidecar canonical join requires at least one path");
  }
  if (!Array.isArray(canonicalRecords)) {
    throw new Error("sidecar canonical join requires canonicalRecords array input");
  }

  const counts = {
    impacted_paths: 0,
    canonical_record_path_pair_scans: 0,
    directory_scope_source_path_scans: 0
  };
  const inputPaths = uniqueStrings(paths.map((inputPath) => {
    increment(counts, "impacted_paths_normalized");
    return normalizeJoinPath(inputPath).relativePath;
  }));
  counts.impacted_paths = inputPaths.length;
  const knownPathIndex = normalizeKnownPathIndex(knownExistingPaths, counts);
  const adjacency = normalizeAdjacency(testAdjacency, counts);
  const candidates = new Map();
  const evidenceByFact = new Map();
  const normalizedRecords = normalizeCanonicalRecords({
    canonicalRecords,
    inputPaths,
    knownPathIndex,
    counts,
    includeSuppressed,
    evidenceByFact
  });
  const indexes = buildCanonicalJoinIndexes(normalizedRecords, counts, includeSuppressed);
  let matchOrder = 0;

  for (const [inputIndex, inputPath] of inputPaths.entries()) {
    const events = [];
    increment(counts, "exact_index_lookups");
    for (const normalized of indexes.recordPaths.get(inputPath) || []) {
      increment(counts, "indexed_candidate_visits");
      events.push({
        normalized,
        order: [inputIndex, normalized.recordIndex, 0, 0, 0],
        match: {
          match_type: "exact_path",
          input_path: inputPath,
          declared_path: normalized.path,
          record_field: "relativePath"
        }
      });
    }
    collectDeclaredEvents({
      queryPath: inputPath,
      inputPath,
      inputIndex,
      inferredIndex: null,
      indexes,
      counts,
      events,
      evidenceByFact
    });
    increment(counts, "docs_backlink_index_lookups");
    for (const { normalized, docs } of indexes.docsBacklinks.get(inputPath) || []) {
      increment(counts, "indexed_candidate_visits");
      events.push({
        normalized,
        order: [inputIndex, normalized.recordIndex, 2, 0, docs.docsIndex],
        match: {
          match_type: "docs_backlink",
          input_path: inputPath,
          declared_path: docs.value,
          record_field: docs.field
        }
      });
    }

    const inferredTestPaths = knownAdjacentTestPaths({
      inputPath,
      adjacency,
      knownPathIndex,
      counts
    });
    for (const [inferredIndex, inferredTestPath] of inferredTestPaths.entries()) {
      collectDeclaredEvents({
        queryPath: inferredTestPath,
        inputPath,
        inputIndex,
        inferredIndex,
        indexes,
        counts,
        events,
        evidenceByFact
      });
    }
    events.sort(compareEventOrder);
    for (const event of events) {
      addCandidateMatch(candidates, event.normalized, {
        ...event.match,
        _order: matchOrder++
      });
    }
  }

  const directCandidates = [...candidates.values()];
  for (const candidate of directCandidates) {
    increment(counts, "relationship_seed_records");
    const candidateId = candidate.normalized.id;
    for (const relatedId of candidate.normalized.relationships) {
      increment(counts, "relationship_index_lookups");
      const relatedRecord = indexes.recordsById.get(relatedId);
      if (
        relatedRecord &&
        !relatedRecord.generated &&
        (includeSuppressed || relatedRecord.retrievalVisibility !== "suppressed")
      ) {
        addCandidateMatch(candidates, relatedRecord, {
          match_type: "related_id",
          input_path: null,
          related_id: candidateId,
          record_field: "related",
          _order: matchOrder++
        });
      }
    }
    increment(counts, "relationship_index_lookups");
    for (const relatedRecord of candidateId
      ? indexes.inboundRelationships.get(candidateId) || []
      : []) {
      if (relatedRecord === candidate.normalized) continue;
      addCandidateMatch(candidates, relatedRecord, {
          match_type: "related_id",
          input_path: null,
          related_id: candidateId,
          record_field: "related",
          _order: matchOrder++
      });
    }
  }

  const rankedRefs = [...candidates.values()]
    .map((candidate) => createCanonicalRef(candidate, 0))
    .sort(compareCandidates)
    .map((reference, index) => ({ ...reference, rank: index + 1 }));

  const result = createSidecarResultEnvelope({
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: "path_match",
    staleness: "unknown",
    canonical_refs: rankedRefs,
    derived_evidence: [
      {
        kind: "sidecar_canonical_join",
        input_paths: inputPaths,
        match_types: SIDECAR_CANONICAL_JOIN_MATCH_TYPES,
        ranking: SIDECAR_CANONICAL_JOIN_RANKING,
        provenance: {
          source_kind: "code_index",
          canonicality: "derived",
          evidence_basis: "path_match"
        }
      },
      ...evidenceByFact.values()
    ],
    ...envelope
  });

  if (typeof operationObserver === "function") {
    operationObserver(Object.freeze({ ...counts }));
  }
  return result;
}

export const SIDECAR_CANONICAL_JOIN_FIXTURES = deepFreeze({
  paths: Object.freeze(["packages/app/src/service.mjs", "docs/architecture/service.md"]),
  knownExistingPaths: Object.freeze([
    "packages/app/src/service.mjs",
    "packages/app/src/service.test.mjs",
    "docs/architecture/service.md"
  ]),
  testAdjacency: Object.freeze({
    "packages/app/src/service.mjs": Object.freeze(["packages/app/src/service.test.mjs"])
  }),
  canonicalRecords: Object.freeze([
    Object.freeze({
      id: "WK-ACTIVE",
      title: "Active service implementation",
      relativePath: "wiki/issues/WK-ACTIVE.md",
      pageKind: "issues",
      frontmatter: Object.freeze({
        id: "WK-ACTIVE",
        title: "Active service implementation",
        status: "todo",
        updated: "2026-04-28",
        write_scope: Object.freeze(["packages/app/src/"]),
        docs: Object.freeze(["docs/architecture/service.md"]),
        related: Object.freeze(["DEC-SERVICE"])
      })
    }),
    Object.freeze({
      id: "WK-CLOSED",
      title: "Closed service cleanup",
      relativePath: "wiki/issues/WK-CLOSED.md",
      pageKind: "issues",
      frontmatter: Object.freeze({
        id: "WK-CLOSED",
        title: "Closed service cleanup",
        status: "done",
        updated: "2026-04-20",
        write_scope: Object.freeze(["packages/app/src/service.mjs"])
      })
    }),
    Object.freeze({
      id: "WK-STALE",
      title: "Stale path owner",
      relativePath: "wiki/issues/WK-STALE.md",
      pageKind: "issues",
      frontmatter: Object.freeze({
        id: "WK-STALE",
        title: "Stale path owner",
        status: "todo",
        updated: "2026-04-28",
        write_scope: Object.freeze(["packages/app/src/moved-service.mjs"])
      })
    }),
    Object.freeze({
      id: "WK-PATTERN",
      title: "Pattern owned service work",
      relativePath: "wiki/issues/WK-PATTERN.md",
      pageKind: "issues",
      frontmatter: Object.freeze({
        id: "WK-PATTERN",
        title: "Pattern owned service work",
        status: "todo",
        updated: "2026-04-27",
        repo_paths: Object.freeze(["packages/app/src/*.mjs"])
      })
    }),
    Object.freeze({
      id: "WK-TEST",
      title: "Service test coverage",
      relativePath: "wiki/issues/WK-TEST.md",
      pageKind: "issues",
      frontmatter: Object.freeze({
        id: "WK-TEST",
        title: "Service test coverage",
        status: "todo",
        updated: "2026-04-26",
        write_scope: Object.freeze(["packages/app/src/service.test.mjs"])
      })
    }),
    Object.freeze({
      id: "DEC-SERVICE",
      title: "Service contract decision",
      relativePath: "wiki/decisions/DEC-SERVICE.md",
      pageKind: "decisions",
      frontmatter: Object.freeze({
        id: "DEC-SERVICE",
        title: "Service contract decision",
        status: "accepted",
        updated: "2026-04-25",
        related: Object.freeze(["WK-ACTIVE"])
      })
    }),
    Object.freeze({
      id: "DOC-SERVICE",
      title: "Service architecture",
      relativePath: "docs/architecture/service.md",
      pageKind: "docs",
      frontmatter: Object.freeze({
        title: "Service architecture",
        updated: "2026-04-24"
      })
    }),
    Object.freeze({
      id: "WK-SUPPRESSED",
      title: "Suppressed legacy service work",
      relativePath: "wiki/issues/WK-SUPPRESSED.md",
      pageKind: "issues",
      frontmatter: Object.freeze({
        id: "WK-SUPPRESSED",
        title: "Suppressed legacy service work",
        status: "todo",
        updated: "2026-04-23",
        retrieval_visibility: "suppressed",
        write_scope: Object.freeze(["packages/app/src/service.mjs"])
      })
    }),
    Object.freeze({
      id: null,
      title: "Generated catalog",
      relativePath: "wiki/catalog.md",
      pageKind: "wiki",
      frontmatter: Object.freeze({})
    }),
    Object.freeze({
      id: "WK-SIBLING",
      title: "Sibling prefix work",
      relativePath: "wiki/issues/WK-SIBLING.md",
      pageKind: "issues",
      frontmatter: Object.freeze({
        id: "WK-SIBLING",
        title: "Sibling prefix work",
        status: "todo",
        updated: "2026-04-28",
        write_scope: Object.freeze(["packages/app/src/service-old/"])
      })
    })
  ])
});

export function cloneSidecarCanonicalJoinFixture() {
  return cloneJson(SIDECAR_CANONICAL_JOIN_FIXTURES);
}
