import { createSidecarResultEnvelope } from "./sidecar-schema.mjs";
import {
  getForbiddenSidecarPathMatch,
  matchSidecarPathPattern,
  pathIsSameOrDescendant,
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

function normalizeJoinPath(inputPath) {
  const directory = inputPath.endsWith("/");
  const pathValue = directory ? inputPath.slice(0, -1) : inputPath;
  const { relativePath } = validateVirtualSidecarPath(pathValue);
  return { relativePath, directory };
}

function pathHasGlobSyntax(pathValue) {
  return pathValue.includes("*");
}

function recordPath(record) {
  return record.relativePath || record.path || record.frontmatter?.path || null;
}

function recordId(record) {
  return record.id || record.frontmatter?.id || null;
}

function recordKind(record) {
  const relativePath = recordPath(record) || "";
  const pageKind = record.pageKind || record.kind || "";
  if (relativePath.startsWith("docs/") || pageKind === "docs") {
    return "canonical_docs";
  }
  if (relativePath.startsWith("wiki/issues/") || pageKind === "issues") {
    return "issue";
  }
  if (relativePath.startsWith("wiki/decisions/") || pageKind === "decisions") {
    return "decision";
  }
  if (relativePath.startsWith("wiki/areas/") || pageKind === "areas") {
    return "area";
  }
  return "canonical_wiki";
}

function canonicalityForRecord(record) {
  const relativePath = recordPath(record);
  if (relativePath && getForbiddenSidecarPathMatch(relativePath)?.reason === "generated wiki view") {
    return "generated";
  }
  return "canonical";
}

function isGeneratedRecord(record) {
  return canonicalityForRecord(record) === "generated";
}

function issueState(record) {
  if (recordKind(record) !== "issue") {
    return "not_issue";
  }
  const status = String(record.frontmatter?.status ?? "").toLowerCase();
  return CLOSED_ISSUE_STATUSES.has(status) ? "closed" : "active";
}

function retrievalVisibility(record) {
  return String(record.frontmatter?.retrieval_visibility ?? "default").toLowerCase();
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

function recordReferenceFields(record) {
  return {
    id: recordId(record),
    title: record.title || record.frontmatter?.title || null,
    path: recordPath(record),
    source_kind: recordKind(record),
    status: record.frontmatter?.status ?? null,
    updated: record.frontmatter?.updated ?? null,
    retrieval_visibility: retrievalVisibility(record),
    issue_state: issueState(record)
  };
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

function normalizeKnownPaths(knownPaths) {
  return new Set(
    asStringList(knownPaths).map((pathValue) => normalizeJoinPath(pathValue).relativePath)
  );
}

function knownPathExistsForEntry(entry, knownPaths) {
  if (!knownPaths || entry.field !== "write_scope") {
    return true;
  }
  if (pathHasGlobSyntax(entry.value)) {
    return true;
  }
  const { relativePath, directory } = normalizeJoinPath(entry.value);
  if (knownPaths.has(relativePath)) {
    return true;
  }
  if (directory) {
    return [...knownPaths].some((knownPath) => pathIsSameOrDescendant(relativePath, knownPath));
  }
  return false;
}

function matchDeclaredPath({ inputPath, entry }) {
  if (pathHasGlobSyntax(entry.value)) {
    return matchSidecarPathPattern(entry.value, inputPath)
      ? {
          match_type: "explicit_pattern",
          declared_path: entry.value,
          record_field: entry.field
        }
      : null;
  }

  const { relativePath, directory } = normalizeJoinPath(entry.value);
  if (relativePath === inputPath) {
    return {
      match_type: "exact_path",
      declared_path: entry.value,
      record_field: entry.field
    };
  }
  if (directory && pathIsSameOrDescendant(relativePath, inputPath)) {
    return {
      match_type: "directory_prefix",
      declared_path: entry.value,
      record_field: entry.field
    };
  }
  return null;
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

function normalizeAdjacency(adjacency) {
  const entries = adjacency instanceof Map ? adjacency.entries() : Object.entries(adjacency || {});
  const normalized = new Map();
  for (const [inputPath, adjacentPaths] of entries) {
    normalized.set(
      normalizeJoinPath(inputPath).relativePath,
      asStringList(adjacentPaths).map((entry) => normalizeJoinPath(entry).relativePath)
    );
  }
  return normalized;
}

function knownAdjacentTestPaths({ inputPath, adjacency, knownPaths }) {
  if (!knownPaths) {
    return [];
  }
  return uniqueStrings([...(adjacency.get(inputPath) || []), ...defaultTestAdjacency(inputPath)])
    .map((candidate) => normalizeJoinPath(candidate).relativePath)
    .filter((candidate) => knownPaths.has(candidate));
}

function addCandidateMatch(candidates, record, match) {
  const key = recordPath(record) || recordId(record);
  if (!key) {
    return;
  }
  const candidate = candidates.get(key) || {
    record,
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
  return {
    ...match,
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

  if (issueState(candidate.record) === "active") {
    score += SIDECAR_CANONICAL_JOIN_RANKING.state_adjustments.active_issue;
  }
  if (issueState(candidate.record) === "closed") {
    score += SIDECAR_CANONICAL_JOIN_RANKING.state_adjustments.closed_issue;
  }
  if (retrievalVisibility(candidate.record) === "suppressed") {
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
  const referenceFields = recordReferenceFields(candidate.record);
  const firstMatch = candidate.matches
    .slice()
    .sort(
      (left, right) =>
        SIDECAR_CANONICAL_JOIN_MATCH_TYPES.indexOf(left.match_type) -
        SIDECAR_CANONICAL_JOIN_MATCH_TYPES.indexOf(right.match_type)
    )[0];
  return {
    ...referenceFields,
    rank,
    score: scoring.score,
    best_match_weight: scoring.bestMatchWeight,
    match_types: scoring.matchTypes,
    match_explanations: candidate.matches.map(createMatchExplanation),
    provenance: {
      source_kind: referenceFields.source_kind,
      canonicality: "canonical",
      evidence_basis: evidenceBasisForMatch(firstMatch.match_type)
    }
  };
}

function generatedSuppression(record) {
  return {
    kind: "sidecar_canonical_join_suppression",
    reason: "generated_view",
    record: recordReferenceFields(record),
    provenance: {
      source_kind: recordKind(record),
      canonicality: "generated",
      evidence_basis: "path_match"
    }
  };
}

function retrievalSuppression(record) {
  return {
    kind: "sidecar_canonical_join_suppression",
    reason: "retrieval_visibility_suppressed",
    record: recordReferenceFields(record),
    provenance: {
      source_kind: recordKind(record),
      canonicality: "canonical",
      evidence_basis: "explicit_metadata"
    }
  };
}

function staleWriteScopeEvidence({ record, inputPath, entry }) {
  return {
    kind: "sidecar_stale_write_scope",
    input_path: inputPath,
    record: recordReferenceFields(record),
    declared_path: entry.value,
    record_field: entry.field,
    reason: "write_scope_path_not_in_known_source_set",
    provenance: {
      source_kind: recordKind(record),
      canonicality: "canonical",
      evidence_basis: "path_match"
    }
  };
}

function invalidJoinPathEvidence({ record, inputPath, entry, error }) {
  return {
    kind: "sidecar_invalid_join_path",
    input_path: inputPath,
    record: recordReferenceFields(record),
    declared_path: entry.value,
    record_field: entry.field,
    reason: error instanceof Error ? error.message : String(error),
    provenance: {
      source_kind: recordKind(record),
      canonicality: "canonical",
      evidence_basis: "path_match"
    }
  };
}

export function joinSidecarPathsToCanonicalRecords({
  paths,
  canonicalRecords,
  knownExistingPaths = null,
  testAdjacency = {},
  includeSuppressed = false,
  envelope = {}
} = {}) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("sidecar canonical join requires at least one path");
  }
  if (!Array.isArray(canonicalRecords)) {
    throw new Error("sidecar canonical join requires canonicalRecords array input");
  }

  const inputPaths = uniqueStrings(paths.map((inputPath) => normalizeJoinPath(inputPath).relativePath));
  const knownPaths = knownExistingPaths == null ? null : normalizeKnownPaths(knownExistingPaths);
  const adjacency = normalizeAdjacency(testAdjacency);
  const candidates = new Map();
  const derivedEvidence = [];
  const recordsById = new Map();

  for (const record of canonicalRecords) {
    const id = recordId(record);
    if (id) {
      recordsById.set(id, record);
    }
    if (isGeneratedRecord(record)) {
      derivedEvidence.push(generatedSuppression(record));
    }
  }

  for (const inputPath of inputPaths) {
    const inferredTestPaths = knownAdjacentTestPaths({ inputPath, adjacency, knownPaths });

    for (const record of canonicalRecords) {
      if (isGeneratedRecord(record)) {
        continue;
      }
      if (retrievalVisibility(record) === "suppressed" && !includeSuppressed) {
        derivedEvidence.push(retrievalSuppression(record));
        continue;
      }

      if (recordPath(record) === inputPath) {
        addCandidateMatch(candidates, record, {
          match_type: "exact_path",
          input_path: inputPath,
          declared_path: recordPath(record),
          record_field: "relativePath"
        });
      }

      for (const entry of declaredPathEntries(record)) {
        let stale = false;
        try {
          stale = !knownPathExistsForEntry(entry, knownPaths);
        } catch (error) {
          derivedEvidence.push(invalidJoinPathEvidence({ record, inputPath, entry, error }));
          continue;
        }
        let matched = null;
        try {
          matched = matchDeclaredPath({ inputPath, entry });
        } catch (error) {
          derivedEvidence.push(invalidJoinPathEvidence({ record, inputPath, entry, error }));
          continue;
        }
        if (!matched) {
          continue;
        }
        if (stale) {
          derivedEvidence.push(staleWriteScopeEvidence({ record, inputPath, entry }));
          continue;
        }
        addCandidateMatch(candidates, record, { ...matched, input_path: inputPath });
      }

      for (const entry of docsBacklinkEntries(record)) {
        let relativePath = null;
        try {
          relativePath = normalizeJoinPath(entry.value).relativePath;
        } catch (error) {
          derivedEvidence.push(invalidJoinPathEvidence({ record, inputPath, entry, error }));
          continue;
        }
        if (relativePath === inputPath) {
          addCandidateMatch(candidates, record, {
            match_type: "docs_backlink",
            input_path: inputPath,
            declared_path: entry.value,
            record_field: entry.field
          });
        }
      }

      for (const inferredTestPath of inferredTestPaths) {
        for (const entry of declaredPathEntries(record)) {
          let matched = null;
          try {
            matched = matchDeclaredPath({ inputPath: inferredTestPath, entry });
          } catch (error) {
            derivedEvidence.push(invalidJoinPathEvidence({ record, inputPath, entry, error }));
            continue;
          }
          if (!matched) {
            continue;
          }
          addCandidateMatch(candidates, record, {
            match_type: "inferred_test_adjacency",
            input_path: inputPath,
            adjacent_test_path: inferredTestPath,
            declared_path: entry.value,
            record_field: entry.field
          });
        }
      }
    }
  }

  for (const candidate of [...candidates.values()]) {
    const candidateId = recordId(candidate.record);
    for (const relatedId of relatedIds(candidate.record)) {
      const relatedRecord = recordsById.get(relatedId);
      if (
        relatedRecord &&
        !isGeneratedRecord(relatedRecord) &&
        (includeSuppressed || retrievalVisibility(relatedRecord) !== "suppressed")
      ) {
        addCandidateMatch(candidates, relatedRecord, {
          match_type: "related_id",
          input_path: null,
          related_id: candidateId,
          record_field: "related"
        });
      }
    }
    for (const relatedRecord of canonicalRecords) {
      if (relatedRecord === candidate.record || isGeneratedRecord(relatedRecord)) {
        continue;
      }
      if (retrievalVisibility(relatedRecord) === "suppressed" && !includeSuppressed) {
        continue;
      }
      if (candidateId && relatedIds(relatedRecord).includes(candidateId)) {
        addCandidateMatch(candidates, relatedRecord, {
          match_type: "related_id",
          input_path: null,
          related_id: candidateId,
          record_field: "related"
        });
      }
    }
  }

  const rankedRefs = [...candidates.values()]
    .map((candidate) => createCanonicalRef(candidate, 0))
    .sort(compareCandidates)
    .map((reference, index) => ({ ...reference, rank: index + 1 }));

  return createSidecarResultEnvelope({
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
      ...derivedEvidence
    ],
    ...envelope
  });
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
