

import { shapeWriteResponse } from "./write-response-boundary.mjs";
import { resolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";
import { jsonContent } from "./mcp-response.mjs";
import { REGISTERED_TIER_FREE_LOCAL } from "./tool-profile.mjs";
import {
  getRuntimeBlockerEntry,
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  refreshWorkRecordAdmissionDerivedEvidenceById,
  evaluateWorkRecordAdmissionDerivedEvidence
} from "@agent-chassis/wiki-core";
import {
  cleanupWorkRecordDerivedEvidenceOperation
} from "@agent-chassis/wiki-core/src/operations/work-record-derived-evidence-cleanup.mjs";
import { SLICE_ID_PATTERN } from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export { shapeWriteResponse };

const STALE_SOURCE_DIGEST_RETRY_NEXT_ACTION =
  "The on-disk record changed since it was read (stale_source_digest): re-read the record, then resubmit this write with expected_source_digest set to the current_source_digest returned here";

function hasStaleSourceDigestDiagnostic(result) {
  const diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics : [];
  return diagnostics.some((entry) => entry && entry.code === "stale_source_digest");
}

function attachStaleSourceDigestRetry(response, result) {
  if (!hasStaleSourceDigestDiagnostic(result)) {
    return response;
  }
  response.current_source_digest = result?.current_source_digest ?? null;
  if (!response.next_action) {
    response.next_action = STALE_SOURCE_DIGEST_RETRY_NEXT_ACTION;
  }
  return response;
}

export function createCompactWorkRecordEditResponse(workspaceRepo, result) {
  const response = {
    workspaceRepo,
    record_id: result?.record_id ?? null,
    selected_unit: result?.selected_unit ?? null,
    source_digest: result?.source_digest ?? null,
    valid: Boolean(result?.valid),
    written: Boolean(result?.written),
    no_op: Boolean(result?.no_op),
    changed_fields: Array.isArray(result?.changed_fields) ? result.changed_fields : [],
    status: result?.status ?? null,
    task: result?.task ?? null,
    diagnostics: Array.isArray(result?.diagnostics) ? result.diagnostics : []
  };

  if (Object.prototype.hasOwnProperty.call(result ?? {}, "expected_source_digest")) {
    response.expected_source_digest = result.expected_source_digest ?? null;
    response.current_source_digest = result.current_source_digest ?? null;
  }

  return attachStaleSourceDigestRetry(response, result);
}

const COMPACT_VALIDATE_DISPATCH_REASONS_LIMIT = 5;
const WRITE_ROUTE_VERBOSE_NEXT_ACTION = "Re-call this tool with verbose:true to inspect suppressed write detail";

const NODE_ENGINE_ADMISSIBILITY_NEXT_ACTIONS = Object.freeze({
  node_engine_pack_input_required:
    "Add the missing worker-admission pack/profile carrier to the request and retry validation",
  node_engine_pack_input_invalid:
    "Fix the present but malformed worker-admission carrier; verify digest-vector, schema, and profile conformance before retrying",
  node_engine_request_schema_digest_mismatch:
    "Rebind NODE_ENGINE_WORKER_ADMISSION_REQUEST_CONTRACT_DIGEST from current Chassis Control Engine authority and retry validation",
  node_engine_precondition_graph_too_large:
    "Reduce or split the dependency graph before retrying worker admission",
  node_engine_non_object_data:
    "Fix the malformed or non-object data envelope before retrying worker admission",
  node_engine_request_invalid:
    "Investigate the generic invalid worker-admission request; Chassis Control Engine did not return a recognized typed problem diagnostic",

  node_engine_admit_unratified:
    "Ratify/enable the Chassis Control Engine worker-admission authority binding, then retry (non-launchable until ratified)",
  node_engine_unavailable:
    "The paid Chassis Control Engine backend transport/auth/entitlement failed (degrades closed); check service reachability, API key/auth, and entitlement, then retry",
  node_engine_config_unavailable:
    "Configure the missing NODE_ENGINE_* (service url / key / route / request-contract digest), or confirm the intended free/local-only path",
  node_engine_route_unratified:
    "Configure the missing NODE_ENGINE_* (service url / key / route / request-contract digest), or confirm the intended free/local-only path",
  node_engine_request_contract_unbound:
    "Configure the missing NODE_ENGINE_* (service url / key / route / request-contract digest), or confirm the intended free/local-only path",

  node_engine_auth_rejected:
    "The Chassis Control Engine API key was rejected (authentication failed); rebind a valid NODE_ENGINE_API_KEY from current Chassis Control Engine authority, then retry",
  node_engine_entitlement_rejected:
    "The Chassis Control Engine API key lacks worker-admission entitlement; check the plan/entitlement, then retry once entitled",

  node_engine_needs_review:
    "This needs-review worker-admission result is non-launchable and remediation is coordinator-owned review evidence: prefer reducing, splitting, or narrowing the unit and its write_scope first, otherwise record accepted review-attestation evidence for the selected target, then refresh the admission evidence and re-validate (launch only on a ratified pack-backed admit). See the WK-1031#SLICE-087 review-required recovery and the dispatch-and-validation.md 'Review-required (needs_review) remediation contract'."
});

function nextActionForNodeEngineAdmissibility(admissibility) {
  if (!admissibility || typeof admissibility !== "object") {
    return null;
  }
  const diagnosticCode = typeof admissibility.diagnostic_code === "string"
    ? admissibility.diagnostic_code
    : null;
  if (!diagnosticCode) {
    return null;
  }
  return NODE_ENGINE_ADMISSIBILITY_NEXT_ACTIONS[diagnosticCode] ?? null;
}

export function nextActionForDecisionCode(decisionCode, dispatchRole, dispatchable, admissibility = null) {
  if (dispatchable) {
    return dispatchRole === "read_only"
      ? "Dispatch reviewer/redteam via workspace_agent_dispatch"
      : "Dispatch implementation worker via workspace_agent_dispatch";
  }
  const nodeEngineNextAction = nextActionForNodeEngineAdmissibility(admissibility);
  if (nodeEngineNextAction) {
    return nodeEngineNextAction;
  }
  switch (decisionCode) {
    case "dispatchable_with_accepted_escalation":
      return "Dispatch implementation worker via workspace_agent_dispatch (accepted escalation active)";
    case "tracker_not_dispatchable":
      return "Select a specific slice for dispatch (tracker records are not dispatched directly)";
    case "missing_target_resolution_evidence":
      return "Run workspace_work_record_refresh_target_resolution_evidence to generate required evidence";
    case "missing_graph_impact":
      return "Run workspace_code_index_graph_impact_paths to generate graph impact evidence";
    case "multi_cluster":
      return "Split write_scope into smaller single-cluster slices or select an existing single-cluster slice";
    case "critical_blast_radius_requires_escalation":
      return "Obtain accepted, unexpired scoped large-file authority that covers this work unit and file, or extract a smaller seam";
    case "critical_blast_radius_escalation_expired":
      return "Renew the accepted scoped large-file authority — the existing expiry has passed";
    case "critical_blast_radius_escalation_scope_mismatch":
      return "Create a new accepted scoped large-file authority that explicitly covers this work unit and file";
    case "missing_json_record":
      return "Create the canonical work record via workspace_create_record";
    case "record_validation_failure":
      return "Fix work-record validation errors reported in reasons and re-validate";
    case "missing_write_scope":
      return "Define write_scope on this work item before dispatch";
    case "work_record_readiness_failure":
      return "Resolve blocking readiness issues reported in reasons";
    default:
      return `Resolve blocking issue: ${decisionCode}`;
  }
}

export function nextActionForFreeLocalDecisionCode(decisionCode, dispatchRole, dispatchable) {
  if (dispatchable) {
    return nextActionForDecisionCode(decisionCode, dispatchRole, dispatchable, null);
  }
  switch (decisionCode) {
    case "dispatchable_with_accepted_escalation":
      return "Dispatch implementation worker via workspace_agent_dispatch";
    case "tracker_not_dispatchable":
      return "Select a specific slice for dispatch (tracker records are not dispatched directly)";
    case "missing_json_record":
      return "Create the canonical work record via workspace_create_record";
    case "record_validation_failure":
      return "Fix work-record validation errors reported in reasons and re-validate";
    case "missing_write_scope":
      return "Define write_scope on this work item before dispatch";
    case "work_record_readiness_failure":
      return "Resolve blocking readiness issues reported in reasons";

    case "missing_graph_impact":
      return "Re-run workspace_validate_dispatch — its default graph resolver rebuilds the live dependency graph on use for graph-bearing implementation units — or build the code-index graph locally with the free CLI (`npm run wiki -- code-index build`, then `npm run wiki -- code-index graph-impact-paths`), then re-validate";

    default:
      return "Resolve structural dispatch-readiness issues reported in reasons";
  }
}

export function createCompactValidateDispatchResponse(
  workspaceRepo,
  readiness,
  registeredTier = "paid_cce"
) {
  const isFreeLocal = registeredTier === REGISTERED_TIER_FREE_LOCAL;
  const reasons = Array.isArray(readiness?.reasons) ? readiness.reasons : [];
  const clusters = Array.isArray(readiness?.clusters) ? readiness.clusters : [];
  const response = {
    workspaceRepo,
    record_id: readiness?.record_id ?? null,
    unit: readiness?.unit ?? null,
    dispatch_role: readiness?.dispatch_role ?? null,
    dispatchable: readiness?.dispatchable ?? false,
    decision_code: readiness?.decision_code ?? null,
    reasons: reasons.slice(0, COMPACT_VALIDATE_DISPATCH_REASONS_LIMIT),
    ...(isFreeLocal
      ? {}
      : {
          blast_radius_level: readiness?.blast_radius?.level ?? null,
          cluster_count: clusters.length
        }),
    next_action: isFreeLocal
      ? nextActionForFreeLocalDecisionCode(
          readiness?.decision_code ?? null,
          readiness?.dispatch_role ?? null,
          readiness?.dispatchable === true
        )
      : nextActionForDecisionCode(
          readiness?.decision_code ?? null,
          readiness?.dispatch_role ?? null,
          readiness?.dispatchable === true,
          readiness?.admissibility ?? null
        )
  };

  if (isFreeLocal) {
    return response;
  }

  if (readiness?.dispatchable !== true && readiness?.state?.graph_auto_recoverable === true) {
    response.auto_recoverable = true;
    response.next_action =
      "Dispatch worker via workspace_agent_dispatch; admission auto-generates graph-impact evidence";
  }

  if (readiness && typeof readiness === "object" && readiness.admissibility) {
    response.admissibility = readiness.admissibility;
    if (readiness.structural_readiness) {
      response.structural_readiness = readiness.structural_readiness;
    }
  }

  return response;
}

export function createCompactContractEditResponse(workspaceRepo, result) {
  const response = {
    workspaceRepo,
    operation: result?.operation ?? null,
    record_id: result?.record_id ?? null,
    selected_unit: result?.selected_unit ?? null,
    source_path_relative: result?.source_path_relative ?? null,
    canonical_record_path: result?.canonical_record_path ?? null,
    source_digest: result?.source_digest ?? null,
    valid: Boolean(result?.valid),
    written: Boolean(result?.written),
    no_op: Boolean(result?.no_op),
    changed_fields: Array.isArray(result?.changed_fields) ? result.changed_fields : [],
    diagnostics: Array.isArray(result?.diagnostics) ? result.diagnostics : [],
    next_action: result?.next_action ?? null
  };

  if (Object.prototype.hasOwnProperty.call(result ?? {}, "expected_source_digest")) {
    response.expected_source_digest = result.expected_source_digest ?? null;
    response.current_source_digest = result.current_source_digest ?? null;
  }

  if (result && Object.prototype.hasOwnProperty.call(result, "record")) {
    response.record = result.record;
  }

  return attachStaleSourceDigestRetry(response, result);
}

function parseWorkRecordUnitAddress(unitAddress) {
  const normalizedAddress = typeof unitAddress === "string" ? unitAddress.trim() : "";
  if (!normalizedAddress) {
    return null;
  }

  const pieces = normalizedAddress.split("#");
  if (pieces.length > 2 || !/^WK-[0-9]{4}$/.test(pieces[0])) {
    return null;
  }

  if (pieces.length === 1) {
    return {
      kind: "work_item",
      address: pieces[0],
      record_id: pieces[0],
      slice_id: null
    };
  }

  const sliceId = pieces[1];

  if (!SLICE_ID_PATTERN.test(sliceId)) {
    return null;
  }

  return {
    kind: "slice",
    address: normalizedAddress,
    record_id: pieces[0],
    slice_id: sliceId
  };
}

function createWorkRecordAdmissionMetricCompleteness(metricSummary) {
  if (!metricSummary || typeof metricSummary !== "object" || Array.isArray(metricSummary)) {
    return {
      state: "unknown",
      complete: false,
      required_metric_gaps: {
        evidence: [],
        metric_keys: []
      },
      missing_supporting_evidence: null,
      missing_metrics: null,
      absent_optional_evidence: null,
      evidence_issues: null,
      unknown_metric_count: null
    };
  }

  const missingSupportingEvidence =
    metricSummary.missing_supporting_evidence && typeof metricSummary.missing_supporting_evidence === "object"
      ? metricSummary.missing_supporting_evidence
      : {};
  const missingMetrics =
    metricSummary.missing_metrics && typeof metricSummary.missing_metrics === "object"
      ? metricSummary.missing_metrics
      : {};
  const absentOptionalEvidence =
    metricSummary.absent_optional_evidence && typeof metricSummary.absent_optional_evidence === "object"
      ? metricSummary.absent_optional_evidence
      : {};

  const evidenceGaps = Object.keys(missingSupportingEvidence)
    .filter((key) => Boolean(missingSupportingEvidence[key]))
    .sort();
  const metricKeyGaps = Object.keys(missingMetrics)
    .filter((key) => Boolean(missingMetrics[key]))
    .sort();

  return {
    state: evidenceGaps.length === 0 && metricKeyGaps.length === 0 ? "complete" : "incomplete",
    complete: evidenceGaps.length === 0 && metricKeyGaps.length === 0,
    required_metric_gaps: {
      evidence: evidenceGaps,
      metric_keys: metricKeyGaps
    },
    missing_supporting_evidence: cloneJson(missingSupportingEvidence),
    missing_metrics: cloneJson(missingMetrics),
    absent_optional_evidence: cloneJson(absentOptionalEvidence),
    evidence_issues:
      metricSummary.evidence_issues && typeof metricSummary.evidence_issues === "object"
        ? cloneJson(metricSummary.evidence_issues)
        : null,
    unknown_metric_count:
      typeof metricSummary.unknown_metric_count === "number" ? metricSummary.unknown_metric_count : null
  };
}

const EXPECTED_SOURCE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function createDiagnostic(code, message, { path = null, severity = "error" } = {}) {
  return {
    code,
    severity,
    message,
    path
  };
}

export function validateOptionalExpectedSourceDigest(expectedSourceDigest, { path = "expected_source_digest" } = {}) {
  if (expectedSourceDigest === null || expectedSourceDigest === undefined) {
    return { ok: true, value: null };
  }

  if (typeof expectedSourceDigest !== "string" || !EXPECTED_SOURCE_DIGEST_PATTERN.test(expectedSourceDigest)) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "invalid_expected_source_digest",
        `expected_source_digest must be sha256:<64 lowercase hex>`,
        { path }
      )
    };
  }

  return { ok: true, value: expectedSourceDigest };
}

function createCompactWorkRecordAdmissionRemediation(remediation) {
  if (!remediation || typeof remediation !== "object" || Array.isArray(remediation)) {
    return null;
  }

  const compactItems = Array.isArray(remediation.items)
    ? remediation.items
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return null;
          }
          const compactItem = {
            code: item.code ?? null,
            message: item.message ?? null,
            next_step: item.next_step ?? null
          };
          if (Array.isArray(item.paths)) {
            compactItem.paths = item.paths.slice();
          }
          return compactItem;
        })
        .filter(Boolean)
    : [];

  const compactRemediation = {
    schema_version: remediation.schema_version ?? null,
    source_decision_code: remediation.source_decision_code ?? null,
    codes: Array.isArray(remediation.codes) ? remediation.codes.slice() : [],
    items: compactItems,
    summary: remediation.summary ?? null
  };

  if (Array.isArray(remediation.triggering_paths)) {
    compactRemediation.triggering_paths = remediation.triggering_paths.slice();
  }

  return compactRemediation;
}

function createWorkRecordAdmissionDecisionSummary(admission) {
  if (!admission || typeof admission !== "object" || Array.isArray(admission)) {
    return null;
  }
  return {
    decision: admission.decision ?? null,
    decision_code: admission.decision_code ?? null,
    decision_codes: Array.isArray(admission.decision_codes) ? admission.decision_codes.slice() : [],
    effect: admission.effect ?? null,
    reasons: Array.isArray(admission.reasons) ? admission.reasons.slice() : [],
    matched_rules: Array.isArray(admission.matched_rules) ? admission.matched_rules.slice() : [],
    remediation: createCompactWorkRecordAdmissionRemediation(admission.remediation)
  };
}

const READ_ONLY_FILESYSTEM_ERROR_CODES = new Set(["EROFS", "EACCES", "EPERM"]);

function isReadOnlyFilesystemRefreshError(error) {
  let current = error;
  while (current && typeof current === "object") {
    const code = typeof current.code === "string" ? current.code : null;
    if (code === RUNTIME_BLOCKER_CODES.READ_ONLY_MOUNT || READ_ONLY_FILESYSTEM_ERROR_CODES.has(code)) {
      return true;
    }
    if (current.envelope && typeof current.envelope === "object" && !Array.isArray(current.envelope)) {
      const envelopeCode = typeof current.envelope.code === "string" ? current.envelope.code : null;
      if (envelopeCode === RUNTIME_BLOCKER_CODES.READ_ONLY_MOUNT) {
        return true;
      }
    }
    current = current.cause;
  }
  return false;
}

function createReadOnlyFilesystemRefreshDiagnostic({ toolName, selectedUnit, error }) {
  const blocker = getRuntimeBlockerEntry(RUNTIME_BLOCKER_CODES.READ_ONLY_MOUNT);
  const cause = error && typeof error === "object" ? error : null;
  const causeCode = cause && typeof cause.code === "string" ? cause.code : null;
  const causeMessage =
    cause && typeof cause.message === "string" && cause.message.trim()
      ? cause.message.trim()
      : "filesystem write failed";

  return {
    code: RUNTIME_BLOCKER_CODES.READ_ONLY_MOUNT,
    category: blocker?.category ?? "filesystem",
    blocking: true,
    severity: "error",
    message:
      blocker?.summary ?? "Mounted repository filesystem is read-only and required writes cannot be applied.",
    actor_recovery: blocker?.actor_recovery ?? "operator",
    responsible_actor: blocker?.actor_recovery ?? "operator",
    violated_contract: `${toolName} requires a writable workspace repository`,
    next_action: "Retry from a writable workspace repository or remount the repo writable",
    path: typeof cause?.path === "string" ? cause.path : null,
    detail: {
      operation: toolName,
      selected_unit: selectedUnit,
      cause_code: causeCode,
      cause_message: causeMessage,
      source_error_name: typeof cause?.name === "string" ? cause.name : null
    }
  };
}

function hasAdmissionRefreshVerboseDetail(result, admission) {
  return Boolean(
    result?.derived_evidence ||
      admission ||
      result?.canonical_record_path ||
      result?.source_path ||
      result?.source_path_relative
  );
}

function attachWriteRouteVerboseHint(response) {
  response.detail_available = true;
  if (!response.next_action) {
    response.next_action = WRITE_ROUTE_VERBOSE_NEXT_ACTION;
  }
  return response;
}

function createVerboseAdmissionPayload(admission) {
  if (!admission || typeof admission !== "object" || Array.isArray(admission)) {
    return admission;
  }
  const { request: _request, ...rest } = admission;
  return rest;
}

function attachSelectedUnitToSpillDescriptor(response, selectedUnit) {
  if (response?.structuredContent?.schema_version === "wiki-mcp-spilled-response.v1") {
    response.structuredContent.selected_unit = selectedUnit;
  }
  return response;
}

export function createWorkspaceWorkRecordAdmissionMetricsToolResult({
  workspaceRepo,
  selectedUnit = null,
  result = null,
  selector = null,
  refusalMessage = null,
  verbose = false
} = {}) {
  const diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics : [];
  const validationDiagnostics = diagnostics.map((entry) => ({ ...entry }));
  const recordId = result?.record_id || selectedUnit?.record_id || null;
  const sourceDigest = result?.source_digest || result?.current_source_digest || null;
  const metricCompleteness = createWorkRecordAdmissionMetricCompleteness(
    result?.derived_evidence?.metric_summary || null
  );
  const firstErrorDiagnostic = validationDiagnostics.find((entry) => entry && entry.severity === "error") || null;
  const refusalEvidence = firstErrorDiagnostic?.evidence;
  const admission = result?.derived_evidence
    ? evaluateWorkRecordAdmissionDerivedEvidence(result.derived_evidence)
    : null;

  if (verbose) {
    return {
      workspaceRepo,
      status: result?.written ? "refreshed" : "refused",
      verbose: true,
      record_id: recordId,
      selected_unit: selectedUnit,
      source_digest: sourceDigest,
      expected_source_digest: result?.expected_source_digest ?? null,
      current_source_digest: result?.current_source_digest ?? null,
      canonical_record_path: result?.canonical_record_path ?? null,
      valid: Boolean(result?.valid),
      written: Boolean(result?.written),
      refusal: result?.written
        ? null
        : {
            code: firstErrorDiagnostic?.code || "refresh_refused",
            category: firstErrorDiagnostic?.category ?? null,
            blocking: firstErrorDiagnostic?.blocking ?? null,
            message:
              firstErrorDiagnostic?.message ||
              firstErrorDiagnostic?.summary ||
              refusalMessage ||
              "worker-admission metric refresh did not write",
            reason: firstErrorDiagnostic?.reason ?? firstErrorDiagnostic?.message ?? null,
            actor_recovery: firstErrorDiagnostic?.actor_recovery ?? null,
            responsible_actor: firstErrorDiagnostic?.responsible_actor ?? firstErrorDiagnostic?.actor_recovery ?? null,
            violated_contract:
              firstErrorDiagnostic?.violated_contract ??
              refusalEvidence?.violated_contract ??
              null,
            pending_contract:
              firstErrorDiagnostic?.pending_contract ??
              refusalEvidence?.pending_contract ??
              null,
            next_action: firstErrorDiagnostic?.next_action ?? null,
            detail: firstErrorDiagnostic?.detail ?? null,
            path: firstErrorDiagnostic?.path ?? null
          },
      metric_completeness: metricCompleteness,
      admission_summary: createWorkRecordAdmissionDecisionSummary(admission),
      validation_diagnostics: validationDiagnostics,
      source_path: result?.source_path ?? null,
      source_path_relative: result?.source_path_relative ?? null,
      selector,
      refreshed_evidence: result?.derived_evidence ?? null,
      admission: createVerboseAdmissionPayload(admission)
    };
  }

  const response = {
    workspaceRepo,
    status: result?.written ? "refreshed" : "refused",
    verbose: false,
    valid: Boolean(result?.valid),
    written: Boolean(result?.written),
    selected_unit: selectedUnit,
    metric_completeness: metricCompleteness,
    admission_summary: createWorkRecordAdmissionDecisionSummary(admission)
  };

  if (Object.prototype.hasOwnProperty.call(result ?? {}, "expected_source_digest")) {
    response.expected_source_digest = result?.expected_source_digest ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(result ?? {}, "current_source_digest")) {
    response.current_source_digest = result?.current_source_digest ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(result ?? {}, "use_as_expected_source_digest")) {
    response.use_as_expected_source_digest = result?.use_as_expected_source_digest ?? null;
  }

  if (result?.written) {
    response.source_digest = sourceDigest;
    response.refusal = null;
  } else {
    const refusalEvidence = firstErrorDiagnostic?.evidence;
    response.refusal = {
      code: firstErrorDiagnostic?.code || "refresh_refused",
      category: firstErrorDiagnostic?.category ?? null,
      blocking: firstErrorDiagnostic?.blocking ?? null,
      message:
        firstErrorDiagnostic?.message ||
        firstErrorDiagnostic?.summary ||
        refusalMessage ||
        "worker-admission metric refresh did not write",
      reason: firstErrorDiagnostic?.reason ?? firstErrorDiagnostic?.message ?? null,
      actor_recovery: firstErrorDiagnostic?.actor_recovery ?? null,
      responsible_actor: firstErrorDiagnostic?.responsible_actor ?? firstErrorDiagnostic?.actor_recovery ?? null,
      violated_contract:
        firstErrorDiagnostic?.violated_contract ??
        refusalEvidence?.violated_contract ??
        null,
      pending_contract:
        firstErrorDiagnostic?.pending_contract ??
        refusalEvidence?.pending_contract ??
        null,
      next_action: firstErrorDiagnostic?.next_action ?? null,
      detail: firstErrorDiagnostic?.detail ?? null,
      path: firstErrorDiagnostic?.path ?? null
    };
    if (!Object.prototype.hasOwnProperty.call(response, "current_source_digest")) {
      response.current_source_digest = result?.current_source_digest ?? null;
    }
    response.validation_diagnostics = validationDiagnostics;
  }

  if (hasAdmissionRefreshVerboseDetail(result, admission)) {
    attachWriteRouteVerboseHint(response);
  }

  return response;
}

export const WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME =
  "workspace_work_record_refresh_admission_metrics";
export const WORKSPACE_WORK_RECORD_REFRESH_TARGET_RESOLUTION_EVIDENCE_TOOL_NAME =
  "workspace_work_record_refresh_target_resolution_evidence";

export async function runWorkspaceWorkRecordAdmissionRefreshRoute({
  workspaceRepos,
  args,
  toolName,
  refusalMessage = null
}) {
  const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);

  const verbose = Boolean(args.verbose);
  const selectedInput = typeof args.unit === "string" && args.unit.trim().length > 0 ? args.unit.trim() : null;
  const selectedId = typeof args.id === "string" && args.id.trim().length > 0 ? args.id.trim() : null;

  if (!selectedInput && !selectedId) {
    return jsonContent(
      createWorkspaceWorkRecordAdmissionMetricsToolResult({
        workspaceRepo: workspace.repo,
        refusalMessage,
        verbose,
        result: {
          valid: false,
          written: false,
          diagnostics: [
            {
              code: "invalid_record",
              severity: "error",
              message: `${toolName} requires unit or id`,
              path: "unit"
            }
          ],
          source_digest: null,
          canonical_record_path: null
        },
        selector: null
      })
    );
  }

  if (selectedInput && selectedId && selectedInput !== selectedId) {
    return jsonContent(
      createWorkspaceWorkRecordAdmissionMetricsToolResult({
        workspaceRepo: workspace.repo,
        refusalMessage,
        verbose,
        selectedUnit: parseWorkRecordUnitAddress(selectedInput),
        result: {
          valid: false,
          written: false,
          diagnostics: [
            {
              code: "invalid_record",
              severity: "error",
              message: "unit and id must match when both are supplied",
              path: "unit"
            }
          ],
          source_digest: null,
          canonical_record_path: null
        },
        selector: selectedInput
      })
    );
  }

  const selector = selectedInput || selectedId;
  const selectedUnit = parseWorkRecordUnitAddress(selector);
  const expectedSourceDigest = validateOptionalExpectedSourceDigest(args.expected_source_digest ?? null, {
    path: "expected_source_digest"
  });
  if (!expectedSourceDigest.ok) {
    return jsonContent(
      createWorkspaceWorkRecordAdmissionMetricsToolResult({
        workspaceRepo: workspace.repo,
        refusalMessage,
        verbose,
        selectedUnit,
        result: {
          valid: false,
          written: false,
          diagnostics: [expectedSourceDigest.diagnostic],
          source_digest: null,
          current_source_digest: null,
          canonical_record_path: null,
          expected_source_digest: args.expected_source_digest ?? null
        },
        selector
      })
    );
  }

  let result;
  try {
    result = await refreshWorkRecordAdmissionDerivedEvidenceById({
      dir: workspace.dir,
      id: selectedUnit?.record_id ?? selector,
      unitAddress: selector,
      expected_source_digest: expectedSourceDigest.value
    });
  } catch (error) {
    if (!isReadOnlyFilesystemRefreshError(error)) {
      throw error;
    }
    result = {
      valid: false,
      written: false,
      diagnostics: [createReadOnlyFilesystemRefreshDiagnostic({ toolName, selectedUnit, error })],
      source_digest: null,
      current_source_digest: null,
      canonical_record_path: null
    };
  }

  const response = jsonContent(
    createWorkspaceWorkRecordAdmissionMetricsToolResult({
      workspaceRepo: workspace.repo,
      refusalMessage,
      verbose,
      selectedUnit,
      result,
      selector
    }),
    { forceSpill: verbose }
  );

  return attachSelectedUnitToSpillDescriptor(response, selectedUnit);
}

export const WORKSPACE_WORK_RECORD_CLEANUP_DERIVED_EVIDENCE_TOOL_NAME =
  "workspace_work_record_cleanup_derived_evidence";

function cleanupReportHasSuppressedDetail(report) {
  return Boolean(
    report &&
      typeof report === "object" &&
      !Array.isArray(report) &&
      ((Array.isArray(report.removed_entries) && report.removed_entries.length > 0) ||
        Object.prototype.hasOwnProperty.call(report, "verbose"))
  );
}

function hasCleanupVerboseDetail(result, report) {
  return Boolean(
    cleanupReportHasSuppressedDetail(report) ||
      result?.canonical_record_path ||
      (Array.isArray(result?.diagnostics) && result.diagnostics.length > 0)
  );
}

export function createWorkspaceWorkRecordCleanupToolResult({
  workspaceRepo,
  selectedUnit = null,
  result = null,
  selector = null,
  verbose = false
} = {}) {
  const diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics.map((entry) => ({ ...entry })) : [];
  const firstErrorDiagnostic = diagnostics.find((entry) => entry && entry.severity === "error") || null;
  const report = result?.report ?? null;
  const mode = report?.mode ?? result?.mode ?? (result?.written ? "apply" : "plan");
  const changed = Boolean(report?.changed);
  const written = Boolean(result?.written);

  const noOp = !changed && !firstErrorDiagnostic;
  let status;
  if (firstErrorDiagnostic) {
    status = "refused";
  } else if (written) {
    status = "pruned";
  } else if (noOp) {
    status = "no_op";
  } else {
    status = mode === "apply" ? "not_written" : "planned";
  }

  if (verbose) {
    return {
      workspaceRepo,
      status,
      mode,
      verbose: true,
      record_id: result?.record_id ?? selectedUnit?.record_id ?? null,
      selected_unit: selectedUnit,
      changed,
      written,
      valid: Boolean(result?.valid),
      no_op: noOp,
      report,
      source_digest: result?.source_digest ?? null,

      use_as_expected_source_digest: result?.use_as_expected_source_digest ?? null,
      expected_source_digest: result?.expected_source_digest ?? null,
      current_source_digest: result?.current_source_digest ?? null,
      canonical_record_path: result?.canonical_record_path ?? null,
      diagnostics,
      refusal: firstErrorDiagnostic
        ? {
            code: firstErrorDiagnostic.code,
            message: firstErrorDiagnostic.message,
            path: firstErrorDiagnostic.path ?? null
          }
        : null,
      selector
    };
  }

  const compactReport = report ? { ...report } : null;
  if (compactReport) {
    delete compactReport.removed_entries;
    delete compactReport.verbose;
  }

  const response = {
    workspaceRepo,
    status,
    mode,
    verbose: false,
    record_id: result?.record_id ?? selectedUnit?.record_id ?? null,
    selected_unit: selectedUnit,
    changed,
    written,
    valid: Boolean(result?.valid),
    no_op: noOp,
    report: compactReport,
    source_digest: result?.source_digest ?? null,
    use_as_expected_source_digest: result?.use_as_expected_source_digest ?? null,
    expected_source_digest: result?.expected_source_digest ?? null,
    current_source_digest: result?.current_source_digest ?? null,
    refusal: firstErrorDiagnostic
      ? {
          code: firstErrorDiagnostic.code,
          message: firstErrorDiagnostic.message,
          path: firstErrorDiagnostic.path ?? null
        }
      : null
  };

  if (hasCleanupVerboseDetail(result, report)) {
    attachWriteRouteVerboseHint(response);
  }

  return response;
}

export async function runWorkspaceWorkRecordCleanupDerivedEvidenceRoute({ workspaceRepos, args }) {
  const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
  const verbose = Boolean(args.verbose);
  const write = Boolean(args.write);
  const mode = write ? "apply" : "plan";
  const selectedInput = typeof args.unit === "string" && args.unit.trim().length > 0 ? args.unit.trim() : null;
  const selectedId = typeof args.id === "string" && args.id.trim().length > 0 ? args.id.trim() : null;

  if (!selectedInput && !selectedId) {
    return jsonContent(
      createWorkspaceWorkRecordCleanupToolResult({
        workspaceRepo: workspace.repo,
        verbose,
        result: {
          mode,
          valid: false,
          written: false,
          diagnostics: [
            {
              code: "invalid_record",
              severity: "error",
              message: `${WORKSPACE_WORK_RECORD_CLEANUP_DERIVED_EVIDENCE_TOOL_NAME} requires unit or id`,
              path: "unit"
            }
          ]
        },
        selector: null
      })
    );
  }

  if (selectedInput && selectedId && selectedInput !== selectedId) {
    return jsonContent(
      createWorkspaceWorkRecordCleanupToolResult({
        workspaceRepo: workspace.repo,
        verbose,
        selectedUnit: parseWorkRecordUnitAddress(selectedInput),
        result: {
          mode,
          valid: false,
          written: false,
          diagnostics: [
            {
              code: "invalid_record",
              severity: "error",
              message: "unit and id must match when both are supplied",
              path: "unit"
            }
          ]
        },
        selector: selectedInput
      })
    );
  }

  const selector = selectedInput || selectedId;
  const selectedUnit = parseWorkRecordUnitAddress(selector);
  const expectedSourceDigest = validateOptionalExpectedSourceDigest(args.expected_source_digest ?? null, {
    path: "expected_source_digest"
  });
  if (!expectedSourceDigest.ok) {
    return jsonContent(
      createWorkspaceWorkRecordCleanupToolResult({
        workspaceRepo: workspace.repo,
        verbose,
        selectedUnit,
        result: {
          mode,
          valid: false,
          written: false,
          diagnostics: [expectedSourceDigest.diagnostic],
          expected_source_digest: args.expected_source_digest ?? null
        },
        selector
      })
    );
  }

  const result = await cleanupWorkRecordDerivedEvidenceOperation({
    dir: workspace.dir,
    id: selectedUnit?.record_id ?? selector,
    write,
    verbose,
    expected_source_digest: expectedSourceDigest.value
  });

  return jsonContent(
    createWorkspaceWorkRecordCleanupToolResult({
      workspaceRepo: workspace.repo,
      verbose,
      selectedUnit,
      result,
      selector
    })
  );
}
