

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { defineTaskResultCollectionDescriptors } from
  "@agent-chassis/controlled-contract";

import {
  adaptErrorsLogTrace,
  adaptRetainedSmokeTrace,
  AUTHORING_ERGONOMICS_ADAPTERS,
  AuthoringErgonomicsAdapterError
} from "../lib/authoring-ergonomics-adapters.mjs";
import {
  AUTHORING_ERGONOMICS_AXES,
  AUTHORING_ERGONOMICS_DETECTORS,
  AUTHORING_ERGONOMICS_METRIC_NAMES,
  AUTHORING_ERGONOMICS_TRACE_OWNER,
  AuthoringErgonomicsTraceError,
  authoringErgonomicsClusterIdentityKey,
  detectAuthoringErgonomicsFindings,
  normalizeAuthoringErgonomicsTrace
} from "../lib/authoring-ergonomics-trace.mjs";
import {
  AUTHORING_ERGONOMICS_CONFORMANCE_IDENTITIES,
  AuthoringErgonomicsConformanceError,
  evaluateAuthoringErgonomicsConformance
} from "../lib/authoring-ergonomics-conformance.mjs";
import { loadToolDiscoveryDescriptor } from "../lib/tool-discovery.mjs";
import { getSidecarIndexStatus } from "../lib/sidecar-status.mjs";
import { WORK_RECORD_DIRECTORY_NAME } from "../lib/work-record-store.mjs";

export const AUTHORING_ERGONOMICS_REPORT_OPERATION_SCHEMA_VERSION =
  "authoring-ergonomics-report-operation.v1";

export const AUTHORING_ERGONOMICS_REPORT_OWNER = AUTHORING_ERGONOMICS_TRACE_OWNER;

export const AUTHORING_ERGONOMICS_REPORT_SOURCE_KINDS = Object.freeze([
  "workspace_errors_log",
  "retained_smoke_evidence"
]);

export const AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH = "errors.log";

export const AUTHORING_ERGONOMICS_REPORT_REFUSAL_CODES = Object.freeze([
  "request_invalid",
  "unknown_request_field",
  "caller_supplied_path_or_authority_rejected",
  "source_selection_missing",
  "source_selection_ambiguous",
  "unsupported_source_kind",
  "retained_evidence_missing",
  "retained_evidence_invalid_type",
  "workspace_root_unresolved",
  "errors_log_unavailable",
  "errors_log_unreadable",
  "errors_log_too_large",
  "adapter_refused",
  "trace_refused",
  "conformance_refused"
]);

const REJECTED_AUTHORITY_REQUEST_FIELDS = Object.freeze([
  "api_key",
  "authority",
  "cache_dir",
  "credential",
  "env",
  "environment",
  "errors_log",
  "errors_log_path",
  "file",
  "filename",
  "home",
  "installation_root",
  "path",
  "policy",
  "registered_tier",
  "repo_root",
  "root",
  "secret",
  "session_role",
  "source_locator",
  "source_path",
  "token",
  "workspace_dir",
  "xdg_config_home"
]);

export const AUTHORING_ERGONOMICS_ROUTING_STATES = Object.freeze([
  "owner_resolved",
  "owner_unresolved",
  "lookup_degraded"
]);

export const AUTHORING_ERGONOMICS_LOOKUP_ROUTES = Object.freeze([
  "tool_discovery",
  "canonical_work_record_search",
  "code_index"
]);

export const AUTHORING_ERGONOMICS_LOOKUP_ROUTE_STATES = Object.freeze([
  "complete",
  "incomplete",
  "stale",
  "unavailable"
]);

export const AUTHORING_ERGONOMICS_ROUTING_DEGRADATION_REASONS = Object.freeze([
  "cluster_subject_absent",
  "tool_discovery_unavailable",
  "canonical_work_record_search_unavailable",
  "canonical_work_record_search_incomplete",
  "code_index_unavailable",
  "code_index_stale"
]);

export const AUTHORING_ERGONOMICS_OWNER_EVIDENCE_BASES = Object.freeze([
  "write_scope_covers_every_advertised_source_file",
  "write_scope_covers_advertised_source_file",
  "acceptance_names_boundary"
]);

export const AUTHORING_ERGONOMICS_REPORT_AUTHORITY = Object.freeze({
  kind: "advisory_evidence",
  confers: Object.freeze([]),
  note:
    "The authoring-ergonomics report, its conformance evaluations, and its ownership routing are advisory evidence. They carry no admission, dispatch, closure, review, integration, or policy authority, authorize and refuse nothing, and change no record, status, or artifact."
});

const ERRORS_LOG_MAX_BYTES = 8_000_000;
const MAX_WORK_RECORD_FILES = 20_000;
const MAX_ROUTED_CLUSTERS = 1_000;
const MAX_CANDIDATE_OWNERS = 32;

export const AUTHORING_ERGONOMICS_REPORT_QUERY_COLLECTIONS =
  defineTaskResultCollectionDescriptors([
    {
      collection: "coverage_declarations",
      stable_id: "coverage_declaration_id",
      fields: ["coverage_declaration_id", "population_class", "declaration"],
      selectors: ["id", "population_class"]
    },
    {
      collection: "workflows",
      stable_id: "workflow_id",
      fields: ["workflow_id", "workflow"],
      selectors: ["id"]
    },
    {
      collection: "episodes",
      stable_id: "episode_id",
      fields: ["episode_id", "workflow_token", "episode"],
      selectors: ["id", "workflow_token"]
    },
    {
      collection: "metric_entries",
      stable_id: "metric_id",
      fields: ["metric_id", "evidence_state", "metric_entry"],
      selectors: ["id", "evidence_state"]
    },
    {
      collection: "finding_observations",
      stable_id: "finding_id",
      fields: [
        "finding_id", "severity", "category", "symptom", "deciding_facts",
        "owner_routing_performed", "owner_routing_state", "resolved_owner", "evidence_selectors",
        "supported_next_inspection", "observation"
      ],
      selectors: ["id", "severity", "category", "owner_routing_state"]
    },
    {
      collection: "clusters",
      stable_id: "cluster_id",
      fields: ["cluster_id", "axis", "cluster"],
      selectors: ["id", "axis"]
    },
    {
      collection: "axis_classifications",
      stable_id: "axis",
      fields: ["axis", "observed", "classification"],
      selectors: ["id", "axis", "observed"]
    },
    {
      collection: "conformance_evaluations",
      stable_id: "identity",
      fields: ["identity", "outcome", "evaluation"],
      selectors: ["id", "outcome"]
    },
    {
      collection: "owner_routing_results",
      stable_id: "cluster_id",
      fields: ["cluster_id", "routing_state", "routing_result"],
      selectors: ["id", "routing_state"]
    },
    {
      collection: "diagnostics",
      stable_id: "diagnostic_id",
      fields: ["diagnostic_id", "source", "kind", "diagnostic"],
      selectors: ["id", "source", "kind"]
    }
  ]);

const AUTHORING_ERGONOMICS_QUERY_DESCRIPTOR_BY_NAME = new Map(
  AUTHORING_ERGONOMICS_REPORT_QUERY_COLLECTIONS.map((descriptor) =>
    [descriptor.collection, descriptor])
);

export function authoringErgonomicsCollectionDescriptor(collection) {
  return AUTHORING_ERGONOMICS_QUERY_DESCRIPTOR_BY_NAME.get(collection) ?? null;
}

export class AuthoringErgonomicsReportError extends Error {
  constructor(code, detail, { sourceRefusal = null } = {}) {
    super(`${code}: ${detail}`);
    this.name = "AuthoringErgonomicsReportError";
    this.code = code;
    this.detail = detail;
    this.source_refusal = sourceRefusal;

    this.envelope = Object.freeze({
      schema_version: AUTHORING_ERGONOMICS_REPORT_OPERATION_SCHEMA_VERSION,
      ok: false,
      authority: AUTHORING_ERGONOMICS_REPORT_AUTHORITY,
      refusal: Object.freeze({
        code,
        detail,
        source_refusal: sourceRefusal === null ? null : Object.freeze({ ...sourceRefusal })
      })
    });
  }
}

function refuse(code, detail, options) {
  throw new AuthoringErgonomicsReportError(code, detail, options);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function freezeDeep(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value)) freezeDeep(value[key]);
    return Object.freeze(value);
  }
  return value;
}

function faultDetail(error) {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutRoots = raw.replace(/(?:file:\/\/)?(?:\/[^\s'"]+|[A-Za-z]:[\\/][^\s'"]+)/g, "<redacted-root>");
  return withoutRoots.length > 240 ? `${withoutRoots.slice(0, 240)}...` : withoutRoots;
}

const RECOGNIZED_REQUEST_FIELDS = Object.freeze(["dir", "source_kind", "retained_smoke_evidence"]);

export function parseAuthoringErgonomicsReportRequest(request) {
  if (!isPlainObject(request)) {
    refuse("request_invalid", "expected a request object");
  }

  for (const key of Object.keys(request)) {
    if (RECOGNIZED_REQUEST_FIELDS.includes(key)) continue;
    if (REJECTED_AUTHORITY_REQUEST_FIELDS.includes(key)) {
      refuse(
        "caller_supplied_path_or_authority_rejected",
        `${key} names a filesystem location, an alternate source, or a carried authority; this operation resolves only the configured repository's fixed ${AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH} and accepts no caller-supplied policy`
      );
    }
    refuse("unknown_request_field", `${key} is not a request field of this operation`);
  }

  if (typeof request.dir !== "string" || request.dir.trim() === "") {
    refuse(
      "workspace_root_unresolved",
      "the workspace root was not resolved; this operation is repo-scoped and its root is supplied by the resolved workspace alias, never by caller input"
    );
  }

  const sourceKind = request.source_kind;
  if (sourceKind === undefined || sourceKind === null) {
    refuse(
      "source_selection_missing",
      `source_kind is required and must be exactly one of ${AUTHORING_ERGONOMICS_REPORT_SOURCE_KINDS.join(", ")}`
    );
  }
  if (!AUTHORING_ERGONOMICS_REPORT_SOURCE_KINDS.includes(sourceKind)) {
    refuse(
      "unsupported_source_kind",
      `${String(sourceKind)} is not a supported source kind; expected one of ${AUTHORING_ERGONOMICS_REPORT_SOURCE_KINDS.join(", ")}`
    );
  }

  const hasRetained = Object.prototype.hasOwnProperty.call(request, "retained_smoke_evidence")
    && request.retained_smoke_evidence !== undefined
    && request.retained_smoke_evidence !== null;

  if (sourceKind === "workspace_errors_log") {
    if (hasRetained) {
      refuse(
        "source_selection_ambiguous",
        "workspace_errors_log carries no payload; retained_smoke_evidence selects the other source and the two are mutually exclusive"
      );
    }
    return Object.freeze({ dir: request.dir, source_kind: sourceKind, retained_smoke_evidence: null });
  }

  if (!hasRetained) {
    refuse(
      "retained_evidence_missing",
      "retained_smoke_evidence selects the retained source and must carry the structured envelope"
    );
  }
  if (!isPlainObject(request.retained_smoke_evidence)) {
    refuse("retained_evidence_invalid_type", "retained_smoke_evidence must be a structured envelope object");
  }

  return Object.freeze({
    dir: request.dir,
    source_kind: sourceKind,
    retained_smoke_evidence: request.retained_smoke_evidence
  });
}

async function readWorkspaceErrorsLog(dir) {
  const journalPath = path.join(path.resolve(String(dir)), AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH);

  let stats;
  try {
    stats = await stat(journalPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      refuse(
        "errors_log_unavailable",
        `the repository has no ${AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH}; an absent journal is unavailable evidence, not an absence of failures`
      );
    }
    refuse("errors_log_unreadable", `the fixed journal could not be inspected: ${faultDetail(error)}`);
  }

  if (!stats.isFile()) {
    refuse(
      "errors_log_unavailable",
      `${AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH} is not a regular file in this repository`
    );
  }
  if (stats.size > ERRORS_LOG_MAX_BYTES) {
    refuse(
      "errors_log_too_large",
      `the fixed journal is ${stats.size} bytes and exceeds the ${ERRORS_LOG_MAX_BYTES} byte read bound; it is refused rather than partially read`
    );
  }

  try {
    return await readFile(journalPath, "utf8");
  } catch (error) {
    refuse("errors_log_unreadable", `the fixed journal could not be read: ${faultDetail(error)}`);
  }
}

function adaptSource(sourceKind, payload) {
  try {
    return sourceKind === "workspace_errors_log"
      ? adaptErrorsLogTrace(payload, { source_locator: AUTHORING_ERGONOMICS_ERRORS_LOG_RELATIVE_PATH })
      : adaptRetainedSmokeTrace(payload);
  } catch (error) {
    if (error instanceof AuthoringErgonomicsAdapterError) {
      refuse("adapter_refused", `the ${sourceKind} adapter refused this evidence`, {
        sourceRefusal: {
          owner: "authoring-ergonomics-adapters",
          code: error.code,
          path: error.path,
          detail: error.detail
        }
      });
    }
    throw error;
  }
}

export async function loadAuthoringErgonomicsDiscoveryEvidence() {
  let descriptor;
  try {
    descriptor = await loadToolDiscoveryDescriptor();
  } catch (error) {
    return freezeDeep({
      route: "tool_discovery",
      state: "unavailable",
      required_for_authority: true,
      degradation_reason: "tool_discovery_unavailable",
      detail: `structured tool discovery could not be loaded: ${faultDetail(error)}`,
      descriptor_repository: null,
      tool_count: null,
      entries: {}
    });
  }

  const tools = Array.isArray(descriptor?.tools) ? descriptor.tools : null;
  if (tools === null) {
    return freezeDeep({
      route: "tool_discovery",
      state: "incomplete",
      required_for_authority: true,
      degradation_reason: "tool_discovery_unavailable",
      detail: "the assembled discovery descriptor declares no tool inventory",
      descriptor_repository: descriptor?.repository ?? null,
      tool_count: null,
      entries: {}
    });
  }

  const entries = {};
  for (const tool of tools) {
    const name = typeof tool?.tool_name === "string" ? tool.tool_name : null;
    if (name === null || name.trim() === "") continue;
    entries[name] = {
      tool_name: name,
      entrypoint: typeof tool.entrypoint === "string" ? tool.entrypoint : null,
      install_state: tool.install_state ?? null,
      runtime_posture: tool.runtime_posture ?? null,
      side_effects: Array.isArray(tool.side_effects) ? [...tool.side_effects] : [],
      source_files: Array.isArray(tool.source_files) ? [...tool.source_files] : [],
      docs_refs: Array.isArray(tool.docs_refs) ? [...tool.docs_refs] : []
    };
  }

  return freezeDeep({
    route: "tool_discovery",
    state: "complete",
    required_for_authority: true,
    degradation_reason: null,
    detail: null,
    descriptor_repository: descriptor?.repository ?? null,
    tool_count: tools.length,
    entries
  });
}

function collectUnitScopes(record) {
  const units = [];
  const push = (unitId, unit) => {
    units.push({
      unit: unitId,
      write_scope: Array.isArray(unit?.write_scope) ? unit.write_scope.filter((entry) => typeof entry === "string") : [],
      repo_paths: Array.isArray(unit?.repo_paths) ? unit.repo_paths.filter((entry) => typeof entry === "string") : [],
      acceptance_criteria: Array.isArray(unit?.acceptance?.criteria)
        ? unit.acceptance.criteria.filter((entry) => typeof entry === "string")
        : []
    });
  };

  push(record.id, record);
  if (Array.isArray(record.slices)) {
    for (const slice of record.slices) {
      if (!isPlainObject(slice) || typeof slice.id !== "string") continue;
      push(`${record.id}#${slice.id}`, slice);
    }
  }
  return units;
}

export async function loadAuthoringErgonomicsCanonicalEvidence({ dir }) {
  const recordsDir = path.join(path.resolve(String(dir)), WORK_RECORD_DIRECTORY_NAME);

  let dirEntries;
  try {
    dirEntries = await readdir(recordsDir, { withFileTypes: true });
  } catch (error) {
    return freezeDeep({
      route: "canonical_work_record_search",
      state: "unavailable",
      required_for_authority: true,
      degradation_reason: "canonical_work_record_search_unavailable",
      detail: `the canonical work-record corpus could not be listed: ${faultDetail(error)}`,
      scanned_record_count: null,
      unreadable_record_count: null,
      records: []
    });
  }

  const files = dirEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  const records = [];
  const unreadable = [];
  let bounded = false;

  for (const name of files) {
    if (records.length + unreadable.length >= MAX_WORK_RECORD_FILES) {
      bounded = true;
      break;
    }
    let parsed;
    try {
      parsed = JSON.parse(await readFile(path.join(recordsDir, name), "utf8"));
    } catch (error) {
      unreadable.push({ file: name, detail: faultDetail(error) });
      continue;
    }
    if (!isPlainObject(parsed) || typeof parsed.id !== "string") {
      unreadable.push({ file: name, detail: "the file carries no canonical record identity" });
      continue;
    }
    records.push({
      record_id: parsed.id,
      repo: typeof parsed.repo === "string" ? parsed.repo : null,
      status: typeof parsed.status === "string" ? parsed.status : null,
      units: collectUnitScopes(parsed)
    });
  }

  const incomplete = unreadable.length > 0 || bounded;
  return freezeDeep({
    route: "canonical_work_record_search",
    state: incomplete ? "incomplete" : "complete",
    required_for_authority: true,
    degradation_reason: incomplete ? "canonical_work_record_search_incomplete" : null,
    detail: bounded
      ? `the corpus exceeds the ${MAX_WORK_RECORD_FILES} record scan bound, so it was not surveyed completely`
      : unreadable.length > 0
        ? `${unreadable.length} canonical record file(s) could not be read as a work record`
        : null,
    scanned_record_count: records.length,
    unreadable_record_count: unreadable.length,
    unreadable_records: unreadable,
    records
  });
}

const CODE_INDEX_COMPLETE_STALENESS = "fresh";
const CODE_INDEX_STALE_STALENESS = Object.freeze(["stale", "rebuild_required"]);

export async function loadAuthoringErgonomicsCodeIndexEvidence({ dir }) {
  let status;
  try {
    status = await getSidecarIndexStatus({ dir });
  } catch (error) {
    return freezeDeep({
      route: "code_index",
      state: "unavailable",
      required_for_authority: false,
      degradation_reason: "code_index_unavailable",
      detail: `the code-index status could not be read: ${faultDetail(error)}`,
      freshness: "unknown",
      artifact_exists: null,
      dirty_state: null
    });
  }

  const freshness = typeof status?.staleness === "string" ? status.staleness : "unknown";
  const stale = CODE_INDEX_STALE_STALENESS.includes(freshness);

  if (freshness !== CODE_INDEX_COMPLETE_STALENESS) {
    return freezeDeep({
      route: "code_index",
      state: stale ? "stale" : "unavailable",
      required_for_authority: false,
      degradation_reason: stale ? "code_index_stale" : "code_index_unavailable",
      detail: `the code index reports staleness ${freshness}; it corroborates no survey of the current code surface`,
      freshness,
      artifact_exists: status?.artifact_exists ?? null,
      dirty_state: status?.dirty_state ?? null
    });
  }

  return freezeDeep({
    route: "code_index",
    state: "complete",
    required_for_authority: false,
    degradation_reason: null,
    detail: null,
    freshness,
    artifact_exists: status?.artifact_exists ?? null,
    dirty_state: status?.dirty_state ?? null
  });
}

function clusterSubject(cluster) {
  const boundary = cluster?.producer_boundary ?? null;
  if (!isPlainObject(boundary)) return null;
  const id = typeof boundary.boundary_id === "string" ? boundary.boundary_id.trim() : "";
  if (id === "") return null;
  return {
    boundary_kind: boundary.boundary_kind ?? null,
    boundary_id: id,
    producer_family: boundary.producer_family ?? null
  };
}

function addCandidate(candidates, recordId, unit, basis, matched) {
  const existing = candidates.get(recordId) ?? {
    record_id: recordId,
    units: [],
    bases: [],
    matched_paths: []
  };
  if (!existing.units.includes(unit)) existing.units.push(unit);
  if (!existing.bases.includes(basis)) existing.bases.push(basis);
  for (const entry of matched) {
    if (!existing.matched_paths.includes(entry)) existing.matched_paths.push(entry);
  }
  candidates.set(recordId, existing);
}

function routeCluster(cluster, { discovery, canonical, code_index: codeIndex }) {
  const degradations = [];
  const subject = clusterSubject(cluster);

  const routes = [
    {
      route: discovery.route,
      state: discovery.state,
      required_for_authority: discovery.required_for_authority,
      degradation_reason: discovery.degradation_reason,
      detail: discovery.detail
    },
    {
      route: canonical.route,
      state: canonical.state,
      required_for_authority: canonical.required_for_authority,
      degradation_reason: canonical.degradation_reason,
      detail: canonical.detail
    },
    {
      route: codeIndex.route,
      state: codeIndex.state,
      required_for_authority: codeIndex.required_for_authority,
      freshness: codeIndex.freshness,
      degradation_reason: codeIndex.degradation_reason,
      detail: codeIndex.detail
    }
  ];

  for (const route of routes) {
    if (route.degradation_reason !== null && route.degradation_reason !== undefined) {
      degradations.push(route.degradation_reason);
    }
  }
  if (subject === null) degradations.push("cluster_subject_absent");

  const entry = subject === null ? null : (discovery.entries?.[subject.boundary_id] ?? null);
  const advertised = entry === null
    ? { source_files: [], docs_refs: [] }
    : { source_files: entry.source_files, docs_refs: entry.docs_refs };

  const candidates = new Map();
  const exactOwners = [];

  if (subject !== null) {
    for (const record of canonical.records ?? []) {
      for (const unit of record.units) {
        const scope = new Set([...unit.write_scope]);
        const matchedScope = advertised.source_files.filter((file) => scope.has(file));
        if (advertised.source_files.length > 0 && matchedScope.length === advertised.source_files.length) {
          addCandidate(
            candidates,
            record.record_id,
            unit.unit,
            "write_scope_covers_every_advertised_source_file",
            matchedScope
          );
          exactOwners.push({ record_id: record.record_id, unit: unit.unit, matched_paths: matchedScope });
          continue;
        }
        if (matchedScope.length > 0) {
          addCandidate(
            candidates,
            record.record_id,
            unit.unit,
            "write_scope_covers_advertised_source_file",
            matchedScope
          );
        }
        if (unit.acceptance_criteria.some((criterion) => criterion.includes(subject.boundary_id))) {
          addCandidate(candidates, record.record_id, unit.unit, "acceptance_names_boundary", []);
        }
      }
    }
  }

  const exactRecordIds = Array.from(new Set(exactOwners.map((owner) => owner.record_id)));
  const owner = exactRecordIds.length === 1
    ? {
        record_id: exactRecordIds[0],
        units: Array.from(new Set(exactOwners.map((entry) => entry.unit))).sort(),
        matched_source_files: Array.from(new Set(exactOwners.flatMap((entry) => entry.matched_paths))).sort(),
        basis: "write_scope_covers_every_advertised_source_file"
      }
    : null;

  const candidateList = Array.from(candidates.values())
    .sort((left, right) => (left.record_id < right.record_id ? -1 : left.record_id > right.record_id ? 1 : 0));
  const candidatesBounded = candidateList.length > MAX_CANDIDATE_OWNERS;

  const authorityRoutesComplete = routes
    .filter((route) => route.required_for_authority)
    .every((route) => route.state === "complete");
  const allRoutesComplete = routes.every((route) => route.state === "complete");

  let state;
  let stateReason;
  if (owner !== null && authorityRoutesComplete && subject !== null) {
    state = "owner_resolved";
    stateReason = "one canonical record's declared write scope covers every source file this boundary advertises";
  } else if (allRoutesComplete && subject !== null) {
    state = "owner_unresolved";
    stateReason = exactRecordIds.length > 1
      ? `${exactRecordIds.length} canonical records cover this boundary's advertised surface, so no exact owner was selected`
      : "every required lookup completed and no canonical record covers this boundary's advertised surface exactly";
  } else {
    state = "lookup_degraded";
    stateReason = subject === null
      ? "the cluster carries no producer boundary identity, so no lookup could be bound to a subject"
      : "at least one required lookup was unavailable, incomplete, or stale; an ownership gap cannot be established from it";
  }

  return {
    cluster_id: cluster.cluster_id,
    axis: cluster.axis,
    detectors: cluster.detectors,
    subject,
    advertised_references: entry === null
      ? { source_files: [], docs_refs: [], descriptor_entry_present: false }
      : { source_files: advertised.source_files, docs_refs: advertised.docs_refs, descriptor_entry_present: true },
    routing_state: state,
    routing_state_reason: stateReason,
    owner,
    candidate_owners: candidateList.slice(0, MAX_CANDIDATE_OWNERS),
    candidate_owners_bounded: candidatesBounded,
    lookups: routes,
    degradation_reasons: Array.from(new Set(degradations)).sort()
  };
}

export function routeAuthoringErgonomicsClusters(clusters, evidence) {
  const list = Array.isArray(clusters) ? clusters : [];
  const routed = list.slice(0, MAX_ROUTED_CLUSTERS).map((cluster) => routeCluster(cluster, evidence));
  const counts = { owner_resolved: 0, owner_unresolved: 0, lookup_degraded: 0 };
  for (const result of routed) counts[result.routing_state] += 1;

  return freezeDeep({
    routing_states: AUTHORING_ERGONOMICS_ROUTING_STATES,
    lookup_routes: AUTHORING_ERGONOMICS_LOOKUP_ROUTES,

    resolution_mode: "dynamic_per_call_lookup",
    cluster_count: list.length,
    routed_cluster_count: routed.length,
    unrouted_cluster_count: Math.max(0, list.length - routed.length),
    state_counts: counts,
    lookup_route_states: {
      tool_discovery: { state: evidence.discovery.state, detail: evidence.discovery.detail },
      canonical_work_record_search: {
        state: evidence.canonical.state,
        scanned_record_count: evidence.canonical.scanned_record_count,
        unreadable_record_count: evidence.canonical.unreadable_record_count,
        detail: evidence.canonical.detail
      },

      code_index: {
        state: evidence.code_index.state,
        freshness: evidence.code_index.freshness,
        artifact_exists: evidence.code_index.artifact_exists,
        dirty_state: evidence.code_index.dirty_state,
        detail: evidence.code_index.detail
      }
    },
    results: routed
  });
}

function projectAxes(report) {
  const axes = {};
  for (const axis of AUTHORING_ERGONOMICS_AXES) {
    const findings = report.observations.filter((observation) => observation.axis === axis && observation.finding);
    const clusters = report.clusters.filter((cluster) => cluster.axis === axis);
    axes[axis] = {
      axis,

      observed: findings.length > 0,
      finding_count: findings.length,
      cluster_count: clusters.length,
      cluster_ids: clusters.map((cluster) => cluster.cluster_id),
      detectors: Array.from(new Set(findings.map((finding) => finding.observation_id))).sort()
    };
  }
  return axes;
}

function aggregateNormalSuccessCompleteness(declarations) {
  const values = declarations.map((declaration) => declaration.normal_success_population_complete);
  if (values.length === 0) return null;
  if (values.every((value) => value === true)) return true;
  if (values.some((value) => value === false)) return false;
  return null;
}

const AUTHORING_ERGONOMICS_REPORT_OBJECT_INVENTORY = Object.freeze({
  "": Object.freeze([
    "schema_version", "owner", "authority", "side_effects", "source", "coverage",
    "denominators", "metrics", "workflows", "episodes", "findings", "axes",
    "conformance", "routing", "unknown_evidence"
  ]),
  source: Object.freeze([
    "source_kind", "adapter", "adapters_supported", "trace_id", "locator",
    "source_digest", "source_ordinal", "observed_identities", "ordering_authority",
    "redactions"
  ]),
  coverage: Object.freeze([
    "declarations", "declared_event_families", "undeclared_event_families",
    "adapter_summary", "normal_success_population_complete"
  ]),
  denominators: Object.freeze([
    "raw_event_count", "tool_call_event_count", "workflow_count",
    "unknown_workflow_event_count", "episode_count", "finding_count", "cluster_count"
  ]),
  metrics: Object.freeze(["metric_names", "entries"]),
  findings: Object.freeze(["detectors", "observations", "clusters"]),
  axes: Object.freeze(["vocabulary", "present", "by_axis"]),
  conformance: Object.freeze(["identities", "evaluation"]),
  "conformance.evaluation": Object.freeze([
    "schema_version", "owner", "authority", "trace_id", "source", "observed_identities",
    "coverage", "report_schema_version", "identities", "gates", "outcome_counts",
    "evaluated_gate_count"
  ]),
  routing: Object.freeze([
    "routing_states", "lookup_routes", "resolution_mode", "cluster_count",
    "routed_cluster_count", "unrouted_cluster_count", "state_counts",
    "lookup_route_states", "results"
  ]),
  unknown_evidence: Object.freeze(["adapter", "report", "routing"])
});

const AUTHORING_ERGONOMICS_REPORT_ROW_INVENTORY = Object.freeze({
  "findings.observations": Object.freeze([
    "observation_id", "detector", "axis", "finding", "outcome", "evidence_state",
    "invariant_family", "producer_boundary", "target_identity",
    "authoritative_input_identity", "identity_state", "identity_scope_key", "episode_id",
    "event_orders", "evidence"
  ]),
  "findings.clusters": Object.freeze([
    "cluster_id", "axis", "producer_boundary", "invariant_family", "target_identity",
    "authoritative_input_identity", "identity_state", "identity_scope_key",
    "observation_ids", "detectors", "episode_ids", "raw_event_orders", "raw_counts",
    "denominators"
  ])
});

const AUTHORING_ERGONOMICS_OMITTED_PATHS = Object.freeze([
  ["coverage.declarations", "coverage_declarations"],
  ["workflows", "workflows"],
  ["episodes", "episodes"],
  ["metrics.entries", "metric_entries"],
  ["findings.observations[finding=true]", "finding_observations"],
  ["findings.observations[finding=false]", "diagnostics"],
  ["findings.clusters", "clusters"],
  ["axes.by_axis", "axis_classifications"],
  ["conformance.evaluation", "conformance_evaluations"],
  ["routing.results", "owner_routing_results"],
  ["unknown_evidence", "diagnostics"]
]);

const AUTHORING_ERGONOMICS_COMPLETE_IN_PLACE_PATHS = Object.freeze([
  "schema_version", "owner", "authority", "side_effects",
  ...AUTHORING_ERGONOMICS_REPORT_OBJECT_INVENTORY.source.map((field) => `source.${field}`),
  "coverage.coverage_class", "coverage.normal_success_population_complete",
  "coverage.declared_event_families", "coverage.undeclared_event_families",
  "coverage.adapter_summary", "coverage.limitations",
  "snapshot.identity", "snapshot.current", "snapshot.created_at", "snapshot.expires_at",
  ...AUTHORING_ERGONOMICS_REPORT_OBJECT_INVENTORY.denominators.map(
    (field) => `denominators.${field}`
  ),
  "conformance_summary.evaluated_check_count",
  "conformance_summary.unevaluable_check_count", "conformance_summary.outcome_counts",
  "finding_summary.total", "finding_summary.by_severity", "finding_summary.by_category",
  "cluster_summary.total", "cluster_summary.by_axis",
  "owner_routing_summary.resolution_mode", "owner_routing_summary.routing_states",
  "owner_routing_summary.lookup_routes", "owner_routing_summary.lookup_route_states",
  "owner_routing_summary.state_counts", "owner_routing_summary.routed_cluster_count",
  "owner_routing_summary.unrouted_cluster_count",
  "vocabulary.metrics", "vocabulary.detectors", "vocabulary.axes",
  "vocabulary.axes_present", "vocabulary.conformance_identities",
  "vocabulary.conformance_schema_version", "vocabulary.conformance_owner", "next_calls"
]);

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value ?? "unspecified"] = (counts[value ?? "unspecified"] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0));
}

function findingSeverity(observation) {
  return observation.severity ?? observation.evidence?.severity ?? "unspecified";
}

function findingCategory(observation) {
  return observation.category ?? observation.axis ?? observation.detector ?? "unspecified";
}

function reportCollections(report) {
  const routingByCluster = new Map(report.routing.results.map((entry) => [entry.cluster_id, entry]));
  const clustersByIdentity = new Map(report.findings.clusters.map((cluster) => [
    authoringErgonomicsClusterIdentityKey(cluster), cluster
  ]));
  const clusterForObservation = (observation) =>
    clustersByIdentity.get(authoringErgonomicsClusterIdentityKey(observation)) ?? null;
  const diagnostics = [];
  for (const source of ["adapter", "report", "routing"]) {
    for (const [index, diagnostic] of (report.unknown_evidence[source] ?? []).entries()) {
      diagnostics.push({
        diagnostic_id: `${source}-${String(index + 1).padStart(4, "0")}`,
        source,
        kind: diagnostic.kind ?? null,
        diagnostic
      });
    }
  }
  for (const [index, observation] of report.findings.observations.entries()) {
    if (observation.finding === true) continue;
    diagnostics.push({
      diagnostic_id: `non-finding-observation-${String(index + 1).padStart(4, "0")}`,
      source: "report",
      kind: "non_finding_observation",
      diagnostic: observation
    });
  }
  return Object.freeze({
    coverage_declarations: report.coverage.declarations.map((declaration, index) => ({
      coverage_declaration_id: `coverage-${String(index + 1).padStart(4, "0")}`,
      population_class: declaration.population_class ?? null,
      declaration
    })),
    workflows: report.workflows.map((workflow, index) => ({
      workflow_id: workflow.workflow_token ?? `workflow-${String(index + 1).padStart(4, "0")}`,
      workflow
    })),
    episodes: report.episodes.map((episode) => ({
      episode_id: episode.episode_id,
      workflow_token: episode.workflow_token ?? null,
      episode
    })),
    metric_entries: report.metrics.entries.map((entry, index) => ({
      metric_id: entry.metric ?? `metric-${String(index + 1).padStart(4, "0")}`,
      evidence_state: entry.evidence_state ?? null,
      metric_entry: entry
    })),
    finding_observations: report.findings.observations
      .filter((observation) => observation.finding === true)
      .map((observation, index) => {
        const cluster = clusterForObservation(observation);
        const routing = cluster === null ? null : routingByCluster.get(cluster.cluster_id) ?? null;
        return {
          finding_id: `${observation.observation_id}:${String(index + 1).padStart(4, "0")}`,
          severity: findingSeverity(observation),
          category: findingCategory(observation),
          symptom: observation.outcome ?? observation.detector,
          deciding_facts: observation.evidence ?? null,
          owner_routing_performed: routing !== null,
          owner_routing_state: routing?.routing_state ?? null,
          resolved_owner: routing?.owner ?? null,
          evidence_selectors: {
            episode_id: observation.episode_id ?? null,
            event_orders: observation.event_orders ?? [],
            cluster_id: cluster?.cluster_id ?? null
          },
          supported_next_inspection: cluster === null
            ? null
            : { collection: "clusters", selector: { id: cluster.cluster_id } },
          observation
        };
      }),
    clusters: report.findings.clusters.map((cluster) => ({
      cluster_id: cluster.cluster_id,
      axis: cluster.axis ?? null,
      cluster
    })),
    axis_classifications: Object.entries(report.axes.by_axis).map(([axis, classification]) => ({
      axis,
      observed: classification.observed,
      classification
    })),
    conformance_evaluations: report.conformance.evaluation.gates.map((evaluation) => ({
      identity: evaluation.identity,
      outcome: evaluation.outcome,
      evaluation
    })),
    owner_routing_results: report.routing.results.map((routingResult) => ({
      cluster_id: routingResult.cluster_id,
      routing_state: routingResult.routing_state,
      routing_result: routingResult
    })),
    diagnostics
  });
}

export function projectAuthoringErgonomicsReportPageContext({ report, collection }) {
  if (collection !== "conformance_evaluations") return null;
  return freezeDeep({
    evaluation_context: Object.fromEntries(Object.entries(report.conformance.evaluation)
      .filter(([field]) => field !== "gates"))
  });
}

function selectorValue(row, key, descriptor) {
  if (key === "id") return row[descriptor.stable_id];
  if (Object.hasOwn(row, key)) return row[key];
  return row[descriptor.fields.find((field) => field === key)] ?? null;
}

export function projectAuthoringErgonomicsReportPage({
  report,
  collection,
  selector = null,
  ordinal = 0,
  maximumItems = 64,
  sourceCurrent = true
}) {
  const descriptor = authoringErgonomicsCollectionDescriptor(collection);
  if (descriptor === null) throw new TypeError(`unknown authoring-ergonomics collection ${collection}`);
  const rows = reportCollections(report)[collection];
  const filtered = selector === null ? rows : rows.filter((row) =>
    Object.entries(selector).every(([key, value]) =>
      JSON.stringify(selectorValue(row, key, descriptor)) === JSON.stringify(value)));
  const ordered = [...filtered].sort((left, right) => {
    const a = String(left[descriptor.stable_id]);
    const b = String(right[descriptor.stable_id]);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return freezeDeep({
    schema_version: "authoring-ergonomics-report-query-page.v1",
    domain: "authoring_ergonomics",
    collection,
    selector,
    offset: ordinal,
    matched_count: ordered.length,
    items: ordered.slice(ordinal, ordinal + maximumItems),
    source_current: sourceCurrent,
    authority: AUTHORING_ERGONOMICS_REPORT_AUTHORITY
  });
}

export function assertAuthoringErgonomicsProjectionInventory(report) {
  for (const [path_, expectedFields] of Object.entries(
    AUTHORING_ERGONOMICS_REPORT_OBJECT_INVENTORY
  )) {
    const value = path_ === "" ? report : path_.split(".").reduce(
      (parent, field) => parent?.[field], report
    );
    const actual = value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value).sort() : [];
    const expected = [...expectedFields].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new TypeError(
        `authoring-ergonomics projection inventory is incomplete at ${path_ || "<report>"}: expected ${expected.join(",")}; received ${actual.join(",")}`
      );
    }
  }
  for (const [path_, expectedFields] of Object.entries(
    AUTHORING_ERGONOMICS_REPORT_ROW_INVENTORY
  )) {
    const rows = path_.split(".").reduce((parent, field) => parent?.[field], report);
    if (!Array.isArray(rows)) {
      throw new TypeError(`authoring-ergonomics row inventory is missing at ${path_}`);
    }
    for (const [index, row] of rows.entries()) {
      const actual = row && typeof row === "object" && !Array.isArray(row)
        ? Object.keys(row).sort() : [];
      const expected = [...expectedFields].sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new TypeError(
          `authoring-ergonomics row inventory is invalid at ${path_}[${index}]: expected ${expected.join(",")}; received ${actual.join(",")}`
        );
      }
    }
  }
  const collections = reportCollections(report);
  for (const descriptor of AUTHORING_ERGONOMICS_REPORT_QUERY_COLLECTIONS) {
    if (!Array.isArray(collections[descriptor.collection])) {
      throw new TypeError(`authoring-ergonomics collection ${descriptor.collection} is unassigned`);
    }
  }
  return true;
}

function coverageClass(report) {
  const classes = Array.from(new Set(report.coverage.declarations
    .map((declaration) => declaration.population_class)
    .filter((value) => typeof value === "string"))).sort();
  if (classes.length === 0) return "unknown";
  return classes.length === 1 ? classes[0] : "mixed";
}

function reportLimitations(report) {
  const limitations = [];
  if (report.coverage.normal_success_population_complete !== true) {
    limitations.push("normal_success_population_not_established");
  }
  if (report.coverage.undeclared_event_families.length > 0) {
    limitations.push("undeclared_event_families_present");
  }
  if ((report.routing.state_counts.lookup_degraded ?? 0) > 0) {
    limitations.push("owner_lookup_degraded");
  }
  return limitations;
}

export function projectAuthoringErgonomicsCompactReport(report, {
  snapshot,
  nextCalls
}) {
  assertAuthoringErgonomicsProjectionInventory(report);
  if (!snapshot || typeof snapshot.identity !== "string" ||
      !Array.isArray(nextCalls) || nextCalls.length !== 1) {
    throw new TypeError("compact authoring-ergonomics projection requires snapshot metadata and one next call");
  }
  const findings = reportCollections(report).finding_observations;
  return freezeDeep({
    schema_version: "authoring-ergonomics-report-summary.v1",
    owner: report.owner,
    authority: report.authority,
    side_effects: report.side_effects,
    source: report.source,
    coverage: {
      coverage_class: coverageClass(report),
      normal_success_population_complete: report.coverage.normal_success_population_complete,
      declared_event_families: report.coverage.declared_event_families,
      undeclared_event_families: report.coverage.undeclared_event_families,
      adapter_summary: report.coverage.adapter_summary,
      limitations: reportLimitations(report)
    },
    snapshot,
    denominators: report.denominators,
    conformance_summary: {
      evaluated_check_count: report.conformance.evaluation.evaluated_gate_count,
      unevaluable_check_count: report.conformance.evaluation.gates.filter(
        (gate) => String(gate.outcome).startsWith("unevaluable")
      ).length,
      outcome_counts: report.conformance.evaluation.outcome_counts
    },
    finding_summary: {
      total: findings.length,
      by_severity: countBy(findings.map((finding) => finding.severity)),
      by_category: countBy(findings.map((finding) => finding.category))
    },
    cluster_summary: {
      total: report.findings.clusters.length,
      by_axis: countBy(report.findings.clusters.map((cluster) => cluster.axis))
    },
    owner_routing_summary: {
      resolution_mode: report.routing.resolution_mode,
      routing_states: report.routing.routing_states,
      lookup_routes: report.routing.lookup_routes,
      lookup_route_states: report.routing.lookup_route_states,
      state_counts: report.routing.state_counts,
      routed_cluster_count: report.routing.routed_cluster_count,
      unrouted_cluster_count: report.routing.unrouted_cluster_count
    },
    vocabulary: {
      metrics: report.metrics.metric_names,
      detectors: report.findings.detectors,
      axes: report.axes.vocabulary,
      axes_present: report.axes.present,
      conformance_identities: report.conformance.identities,
      conformance_schema_version: report.conformance.evaluation.schema_version,
      conformance_owner: report.conformance.evaluation.owner
    },
    completeness: {
      complete_in_place: AUTHORING_ERGONOMICS_COMPLETE_IN_PLACE_PATHS,
      omitted: AUTHORING_ERGONOMICS_OMITTED_PATHS.map(([path, queryCollection]) => ({
        path,
        query_collection: queryCollection
      })),
      query_collections: AUTHORING_ERGONOMICS_REPORT_QUERY_COLLECTIONS.map(
        (descriptor) => descriptor.collection
      )
    },
    next_calls: nextCalls
  });
}

export async function buildAuthoringErgonomicsReport(request) {
  const parsed = parseAuthoringErgonomicsReportRequest(request);

  const payload = parsed.source_kind === "workspace_errors_log"
    ? await readWorkspaceErrorsLog(parsed.dir)
    : parsed.retained_smoke_evidence;

  const adapted = adaptSource(parsed.source_kind, payload);

  let normalized;
  let findings;
  try {
    normalized = normalizeAuthoringErgonomicsTrace(adapted.trace);
    findings = detectAuthoringErgonomicsFindings(normalized);
  } catch (error) {
    if (error instanceof AuthoringErgonomicsTraceError) {
      refuse("trace_refused", "the trace substrate refused this evidence", {
        sourceRefusal: {
          owner: "authoring-ergonomics-trace",
          code: error.code ?? null,
          path: error.path ?? null,
          detail: error.detail ?? faultDetail(error)
        }
      });
    }
    throw error;
  }

  let conformance;
  try {
    conformance = evaluateAuthoringErgonomicsConformance(normalized);
  } catch (error) {
    if (error instanceof AuthoringErgonomicsConformanceError) {
      refuse("conformance_refused", "the conformance evaluator refused this evidence", {
        sourceRefusal: {
          owner: "authoring-ergonomics-conformance",
          code: error.code ?? null,
          path: null,
          detail: error.detail ?? faultDetail(error)
        }
      });
    }
    throw error;
  }

  const discovery = await loadAuthoringErgonomicsDiscoveryEvidence();
  const canonical = await loadAuthoringErgonomicsCanonicalEvidence({ dir: parsed.dir });
  const codeIndex = await loadAuthoringErgonomicsCodeIndexEvidence({ dir: parsed.dir });

  const routing = routeAuthoringErgonomicsClusters(findings.clusters, {
    discovery,
    canonical,
    code_index: codeIndex
  });

  const toolCallCount = normalized.events.filter((event) => event.event_kind === "tool_call").length;

  return freezeDeep({
    schema_version: AUTHORING_ERGONOMICS_REPORT_OPERATION_SCHEMA_VERSION,
    owner: AUTHORING_ERGONOMICS_REPORT_OWNER,

    authority: AUTHORING_ERGONOMICS_REPORT_AUTHORITY,
    side_effects: ["read_only"],

    source: {
      source_kind: parsed.source_kind,
      adapter: adapted.adapter,
      adapters_supported: AUTHORING_ERGONOMICS_ADAPTERS,
      trace_id: normalized.trace_id,
      locator: normalized.source.source_locator,
      source_digest: normalized.source.source_digest,
      source_ordinal: normalized.source.source_ordinal,
      observed_identities: normalized.observed_identities,
      ordering_authority: normalized.ordering_authority,
      redactions: adapted.redactions
    },

    coverage: {
      declarations: normalized.coverage.declarations,
      declared_event_families: normalized.coverage.declared_event_families,
      undeclared_event_families: normalized.coverage.undeclared_event_families,
      adapter_summary: adapted.coverage_summary,

      normal_success_population_complete: aggregateNormalSuccessCompleteness(
        normalized.coverage.declarations
      )
    },

    denominators: {
      raw_event_count: normalized.events.length,
      tool_call_event_count: toolCallCount,
      workflow_count: normalized.workflow_partitions.length,
      unknown_workflow_event_count: normalized.unknown_workflow_event_orders.length,
      episode_count: findings.episodes.length,
      finding_count: findings.observations.filter((observation) => observation.finding).length,
      cluster_count: findings.clusters.length
    },

    metrics: {
      metric_names: AUTHORING_ERGONOMICS_METRIC_NAMES,
      entries: findings.metrics
    },

    workflows: normalized.workflow_partitions,
    episodes: findings.episodes,

    findings: {
      detectors: AUTHORING_ERGONOMICS_DETECTORS,
      observations: findings.observations,
      clusters: findings.clusters
    },

    axes: {
      vocabulary: AUTHORING_ERGONOMICS_AXES,
      present: findings.axes_present,
      by_axis: projectAxes(findings)
    },

    conformance: {
      identities: AUTHORING_ERGONOMICS_CONFORMANCE_IDENTITIES,
      evaluation: conformance
    },

    routing,

    unknown_evidence: {
      adapter: adapted.unknown_evidence,
      report: findings.unknown_evidence,
      routing: routing.results
        .filter((result) => result.degradation_reasons.length > 0)
        .map((result) => ({
          kind: "ownership_lookup_degraded",
          subject: result.cluster_id,
          detail: result.routing_state_reason,
          reasons: result.degradation_reasons
        }))
    }
  });
}
