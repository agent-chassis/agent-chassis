import { cloneJson, isNonEmptyString, isObject, uniqueBy } from "./work-record-admission-shared.mjs";
import {
  WORK_RECORD_ADMISSION_SCHEMA_VERSION,
  sortAdmissionCodes
} from "./work-record-admission-decision-codes.mjs";
import {
  decisionFromCode,
  normalizeCredentialStatus
} from "./work-record-admission-policy.mjs";
import {
  loadWorkspaceWorkerAdmissionPolicyPackOverrideSync,
  normalizeWorkUnitAtomicityPolicyProfileFromPack
} from "./work-record-policy-pack-override.mjs";
import {
  collectDeclaredFiles,
  collectGraphEntries,
  evaluateAtomicity,
  normalizeDispatchReadiness
} from "./work-record-admission-downstream.mjs";
import { createWorkUnitAtomicityDecision } from "./work-record-admission-work-unit.mjs";

const CLEAN_CARRIER_FACTS_RULE = "carrier_facts_recorded_no_local_admissibility_judgment";
const CLEAN_CARRIER_FACTS_ALLOW_EFFECT =
  "allows_carrier_fact_forwarding_without_local_admissibility_judgment";

function neutralizeCleanCarrierFactWorkUnitAtomicity(workUnitAtomicity) {
  if (!isObject(workUnitAtomicity)) {
    return workUnitAtomicity;
  }

  const decisionCodes = Array.isArray(workUnitAtomicity.decision_codes)
    ? workUnitAtomicity.decision_codes
    : [];
  const matchedRules = Array.isArray(workUnitAtomicity.matched_rules)
    ? workUnitAtomicity.matched_rules
    : [];
  const isCleanCarrierFactAllow =
    workUnitAtomicity.decision === "allow" &&
    workUnitAtomicity.allowed === true &&
    workUnitAtomicity.effect === CLEAN_CARRIER_FACTS_ALLOW_EFFECT &&
    decisionCodes.length === 0 &&
    matchedRules.includes(CLEAN_CARRIER_FACTS_RULE);

  if (!isCleanCarrierFactAllow) {
    return workUnitAtomicity;
  }

  const neutralized = { ...workUnitAtomicity };
  delete neutralized.decision;
  delete neutralized.decision_code;
  delete neutralized.allowed;
  delete neutralized.effect;
  return neutralized;
}

function chooseAggregateDecisionWithBreadth({
  dispatchDecision,
  workUnitAtomicityDecision,
  nodeEngineDecision
}) {
  if (dispatchDecision === "deny") {
    return "deny";
  }
  if (workUnitAtomicityDecision === "deny") {
    return "deny";
  }
  if (nodeEngineDecision === "deny") {
    return "deny";
  }
  if (
    dispatchDecision === "review_required" ||
    workUnitAtomicityDecision === "review_required" ||
    nodeEngineDecision === "review_required"
  ) {
    return "review_required";
  }
  return "allow";
}

const NODE_ENGINE_UNRECOGNIZED_DECISION_CODE = "node_engine_unrecognized_decision_code";
const KNOWN_NODE_ENGINE_SERVICE_DECISION_CODES = new Set([
  "node_engine_allowed",
  "node_engine_denied",
  "node_engine_review_required"
]);

function normalizeNodeEngineServiceDecisionCode(decision) {
  if (!isNonEmptyString(decision)) {
    return NODE_ENGINE_UNRECOGNIZED_DECISION_CODE;
  }

  return (
    {
      allow: "node_engine_allowed",
      deny: "node_engine_denied",
      review_required: "node_engine_review_required"
    }[decision] ?? NODE_ENGINE_UNRECOGNIZED_DECISION_CODE
  );
}

function normalizeNodeEngineService({
  nodeEngineApiKey,
  nodeEngineDecisionCode,
  nodeEngineService
}) {
  const credential = normalizeCredentialStatus(nodeEngineApiKey);

  if (isObject(nodeEngineService)) {
    if (isNonEmptyString(nodeEngineService.decision_code)) {
      if (!credential.api_key_present) {
        return {
          decision: "allow",
          decision_code: "node_engine_autoapproved_missing_api_key",
          credential_status: "missing_api_key",
          mode: "fail_open",
          request_id: null
        };
      }
      if (!credential.api_key_valid) {
        return {
          decision: "allow",
          decision_code: "node_engine_autoapproved_invalid_api_key",
          credential_status: "invalid_api_key",
          mode: "fail_open",
          request_id: null
        };
      }

      const decisionCode = nodeEngineService.decision_code;
      if (!KNOWN_NODE_ENGINE_SERVICE_DECISION_CODES.has(decisionCode)) {
        return {
          decision: "deny",
          decision_code: NODE_ENGINE_UNRECOGNIZED_DECISION_CODE,
          reason_code: NODE_ENGINE_UNRECOGNIZED_DECISION_CODE,
          reasons: ["configured node_engine_service decision_code is not recognized"],
          credential_status: "configured",
          mode: isNonEmptyString(nodeEngineService.mode) ? nodeEngineService.mode : "consulted",
          request_id: isNonEmptyString(nodeEngineService.request_id) ? nodeEngineService.request_id : null
        };
      }
      return {
        decision: decisionFromCode(decisionCode),
        decision_code: decisionCode,
        credential_status: "configured",
        mode: isNonEmptyString(nodeEngineService.mode) ? nodeEngineService.mode : "consulted",
        request_id: isNonEmptyString(nodeEngineService.request_id) ? nodeEngineService.request_id : null
      };
    }

    if (isNonEmptyString(nodeEngineService.decision)) {
      const decisionCode = normalizeNodeEngineServiceDecisionCode(nodeEngineService.decision);
      if (!KNOWN_NODE_ENGINE_SERVICE_DECISION_CODES.has(decisionCode)) {
        return {
          decision: "deny",
          decision_code: NODE_ENGINE_UNRECOGNIZED_DECISION_CODE,
          reason_code: NODE_ENGINE_UNRECOGNIZED_DECISION_CODE,
          reasons: ["configured node_engine_service decision_code is not recognized"],
          credential_status: credential.credential_status,
          mode: isNonEmptyString(nodeEngineService.mode) ? nodeEngineService.mode : "configured",
          request_id: isNonEmptyString(nodeEngineService.request_id) ? nodeEngineService.request_id : null
        };
      }
      return {
        decision: decisionFromCode(decisionCode),
        decision_code: decisionCode,
        credential_status: credential.credential_status,
        mode: isNonEmptyString(nodeEngineService.mode) ? nodeEngineService.mode : "configured",
        request_id: isNonEmptyString(nodeEngineService.request_id) ? nodeEngineService.request_id : null
      };
    }
  }

  if (isNonEmptyString(nodeEngineDecisionCode)) {
    if (!KNOWN_NODE_ENGINE_SERVICE_DECISION_CODES.has(nodeEngineDecisionCode)) {
      return {
        decision: "deny",
        decision_code: NODE_ENGINE_UNRECOGNIZED_DECISION_CODE,
        reason_code: NODE_ENGINE_UNRECOGNIZED_DECISION_CODE,
        reasons: ["configured node_engine_service decision_code is not recognized"],
        credential_status: credential.credential_status,
        mode: "consulted",
        request_id: null
      };
    }
    return {
      decision: decisionFromCode(nodeEngineDecisionCode),
      decision_code: nodeEngineDecisionCode,
      credential_status: credential.credential_status,
      mode: "consulted",
      request_id: null
    };
  }

  if (!credential.api_key_present) {
    return {
      decision: "allow",
      decision_code: "node_engine_autoapproved_missing_api_key",
      credential_status: "missing_api_key",
      mode: "fail_open",
      request_id: null
    };
  }
  if (!credential.api_key_valid) {
    return {
      decision: "allow",
      decision_code: "node_engine_autoapproved_invalid_api_key",
      credential_status: "invalid_api_key",
      mode: "fail_open",
      request_id: null
    };
  }

  return {
    decision: "allow",
    decision_code: "node_engine_allowed",
    credential_status: "configured",
    mode: "consulted",
    request_id: null
  };
}

function createComponentDecision({ decision, decisionCode, sourceSchemaVersion, extra = {} }) {
  return {
    decision,
    decision_code: decisionCode,
    ...(sourceSchemaVersion ? { source_schema_version: sourceSchemaVersion } : {}),
    ...extra
  };
}

function normalizeAdmissionFeatureVector(value) {
  return isObject(value) ? cloneJson(value) : null;
}

function hasExplicitWorkUnitPolicyProfile(options) {
  return isObject(options.policy_profile) || isObject(options.policyProfile);
}

function summarizePolicyPackOverrideResult(result) {
  if (!isObject(result) || !result.override_present) {
    return null;
  }
  return {
    ok: result.ok === true,
    source: isNonEmptyString(result.source) ? result.source : null,
    override_present: result.override_present === true,
    override_source: isNonEmptyString(result.override_source) ? result.override_source : null,
    diagnostics: Array.isArray(result.diagnostics) ? cloneJson(result.diagnostics) : []
  };
}

function resolveWorkUnitPolicyProfile(options) {
  if (hasExplicitWorkUnitPolicyProfile(options)) {
    return {
      policyProfile: options.policy_profile ?? options.policyProfile,
      policyPackOverride: null
    };
  }

  const policyPackOverride = loadWorkspaceWorkerAdmissionPolicyPackOverrideSync({
    workspaceRoot: options.workspace_root ?? options.workspaceRoot ?? process.cwd(),
    relativePath:
      options.policy_pack_override_relative_path ??
      options.policyPackOverrideRelativePath ??
      undefined
  });
  if (!policyPackOverride.override_present) {
    return {
      policyProfile: undefined,
      policyPackOverride: null
    };
  }
  if (policyPackOverride.ok && isObject(policyPackOverride.policy_pack)) {
    return {
      policyProfile: normalizeWorkUnitAtomicityPolicyProfileFromPack(policyPackOverride.policy_pack, {
        source: policyPackOverride.source
      }),
      policyPackOverride
    };
  }

  return {
    policyProfile: normalizeWorkUnitAtomicityPolicyProfileFromPack(undefined, {
      source: "local_override_invalid"
    }),
    policyPackOverride
  };
}

function applyInvalidPolicyPackOverrideDecision(workUnitAtomicity, policyPackOverride) {
  if (!isObject(policyPackOverride) || policyPackOverride.ok === true) {
    return workUnitAtomicity;
  }

  const diagnostics = Array.isArray(policyPackOverride.diagnostics)
    ? cloneJson(policyPackOverride.diagnostics)
    : [];
  const diagnosticCodes = diagnostics.map((entry) => entry?.code).filter(isNonEmptyString);
  const reasons = diagnostics
    .map((entry) => entry?.message)
    .filter(isNonEmptyString);
  const overrideSummary = summarizePolicyPackOverrideResult(policyPackOverride);
  const decisionCodes = sortAdmissionCodes([
    ...(Array.isArray(workUnitAtomicity.decision_codes) ? workUnitAtomicity.decision_codes : []),
    ...diagnosticCodes
  ]);

  return {
    ...workUnitAtomicity,
    decision: "deny",
    decision_code: decisionCodes[0] ?? "worker_admission.policy_pack_override.malformed_override.v1",
    decision_codes: decisionCodes,
    effect: "blocks_launch",
    reasons: [
      ...(Array.isArray(workUnitAtomicity.reasons) ? workUnitAtomicity.reasons : []),
      ...(reasons.length > 0 ? reasons : ["worker-admission policy override is invalid"])
    ],
    matched_rules: sortAdmissionCodes([
      ...(Array.isArray(workUnitAtomicity.matched_rules) ? workUnitAtomicity.matched_rules : []),
      "policy_pack_override_invalid"
    ]),
    request: {
      ...(isObject(workUnitAtomicity.request) ? workUnitAtomicity.request : {}),
      evidence: {
        ...(isObject(workUnitAtomicity.request?.evidence) ? workUnitAtomicity.request.evidence : {}),
        policy_pack_override: overrideSummary
      }
    },
    evidence: {
      ...(isObject(workUnitAtomicity.evidence) ? workUnitAtomicity.evidence : {}),
      policy_pack_override: overrideSummary
    },
    metrics: {
      ...(isObject(workUnitAtomicity.metrics) ? workUnitAtomicity.metrics : {}),
      policy_pack_override: overrideSummary
    },
    provenance: {
      ...(isObject(workUnitAtomicity.provenance) ? workUnitAtomicity.provenance : {}),
      policy_pack_override: overrideSummary
    }
  };
}

export function createWorkRecordAdmissionEnvelope(options = {}) {
  const dispatchReadiness = normalizeDispatchReadiness(
    options.dispatch_readiness ?? options.dispatchReadiness
  );
  const graphImpact = isObject(options.graph_impact)
    ? options.graph_impact
    : isObject(options.graphImpact)
      ? options.graphImpact
      : null;
  const nodeEngineService = normalizeNodeEngineService({
    nodeEngineApiKey: options.node_engine_api_key ?? options.nodeEngineApiKey,
    nodeEngineDecisionCode: options.decision_code ?? options.decisionCode,
    nodeEngineService: options.node_engine_service ?? options.nodeEngineService
  });
  const declaredFiles = collectDeclaredFiles(dispatchReadiness);
  const graphFiles = collectGraphEntries(graphImpact);
  const files = uniqueBy([...declaredFiles, ...graphFiles], (entry) =>
    [entry.path, entry.role, entry.source, entry.input_path ?? "", entry.kind ?? "", entry.reason].join("|")
  ).sort((left, right) =>
    String(left.path).localeCompare(String(right.path)) ||
    String(left.role).localeCompare(String(right.role)) ||
    String(left.source).localeCompare(String(right.source)) ||
      String(left.input_path ?? "").localeCompare(String(right.input_path ?? "")) ||
      String(left.reason).localeCompare(String(right.reason))
  );
  const workUnitPolicy = resolveWorkUnitPolicyProfile(options);
  let workUnitAtomicity = createWorkUnitAtomicityDecision({
    dispatchReadiness,
    workUnitMetrics: options.work_unit_metrics ?? options.workUnitMetrics,
    fileStats: options.file_stats ?? options.fileStats,
    validationCommandMetadata: options.validation_command_metadata ?? options.validationCommandMetadata,
    runtimeModeMetadata: options.runtime_mode_metadata ?? options.runtimeModeMetadata,
    artifactKindMetadata: options.artifact_kind_metadata ?? options.artifactKindMetadata,
    metricSourceProvenance: options.metric_source_provenance ?? options.metricSourceProvenance,
    structuralTargetMetrics:
      options.structural_target_metrics ?? options.structuralTargetMetrics ?? null,
    policyProfile: workUnitPolicy.policyProfile,
    options
  });
  workUnitAtomicity = applyInvalidPolicyPackOverrideDecision(
    workUnitAtomicity,
    workUnitPolicy.policyPackOverride
  );
  const policyPackOverrideSummary = summarizePolicyPackOverrideResult(workUnitPolicy.policyPackOverride);
  const normalizedFeatureVector = normalizeAdmissionFeatureVector(options.feature_vector ?? options.featureVector);
  if (normalizedFeatureVector) {
    workUnitAtomicity.request.feature_vector = normalizedFeatureVector;
    workUnitAtomicity.request.evidence.feature_vector = cloneJson(normalizedFeatureVector);
    workUnitAtomicity.evidence.feature_vector = cloneJson(normalizedFeatureVector);
    workUnitAtomicity.metrics.feature_vector = cloneJson(normalizedFeatureVector);
  }

  workUnitAtomicity = neutralizeCleanCarrierFactWorkUnitAtomicity(workUnitAtomicity);

  const atomicity = evaluateAtomicity({
    dispatchReadiness,
    graphImpact,
    fileEntries: files
  });
  const dispatchDecision =
    dispatchReadiness.dispatchable || dispatchReadiness.decision_code === "dispatchable_with_accepted_escalation"
      ? "allow"
      : "deny";
  const aggregateDecision = chooseAggregateDecisionWithBreadth({
    dispatchDecision,
    workUnitAtomicityDecision: workUnitAtomicity.decision,
    nodeEngineDecision: nodeEngineService.decision
  });
  const decisionCodes = [];
  if (dispatchDecision === "deny") {
    decisionCodes.push("dispatch_readiness_denied");
  }
  decisionCodes.push(...workUnitAtomicity.decision_codes);
  decisionCodes.push(nodeEngineService.decision_code);

  return {
    schema_version: WORK_RECORD_ADMISSION_SCHEMA_VERSION,
    unit: {
      kind: dispatchReadiness.unit?.kind || "work_item",
      address:
        dispatchReadiness.unit?.address ||
        dispatchReadiness.record_id ||
        dispatchReadiness.unit?.record_id ||
        "unknown",
      record_id: dispatchReadiness.record_id || dispatchReadiness.unit?.record_id || null,
      slice_id: dispatchReadiness.unit?.slice_id ?? null
    },
    components: {
      node_engine_service: createComponentDecision({
        decision: nodeEngineService.decision,
        decisionCode: nodeEngineService.decision_code,
        extra: {
          credential_status: nodeEngineService.credential_status,
          mode: nodeEngineService.mode,
          ...(isNonEmptyString(nodeEngineService.reason_code) ? { reason_code: nodeEngineService.reason_code } : {}),
          ...(Array.isArray(nodeEngineService.reasons) ? { reasons: nodeEngineService.reasons } : {})
        }
      }),
      dispatch_readiness: createComponentDecision({
        decision: dispatchDecision,
        decisionCode: dispatchReadiness.decision_code,
        sourceSchemaVersion: dispatchReadiness.schema_version
      }),
      atomicity: createComponentDecision({
        decision: "allow",
        decisionCode: "telemetry_only",
        extra: {
          effect: "telemetry_only"
        }
      }),
      work_unit_atomicity: workUnitAtomicity
    },
    aggregate_decision: aggregateDecision,
    decision_codes: sortAdmissionCodes(decisionCodes),
    metrics: {
      ...atomicity.metrics,
      work_unit_atomicity: workUnitAtomicity.metrics
    },
    files,
    policy_profile: workUnitAtomicity.request.policy_profile,
    ...(policyPackOverrideSummary ? { policy_pack_override: policyPackOverrideSummary } : {}),
    provenance: {
      source_kind: "code_index",
      canonicality: "derived",
      evidence_basis: graphImpact ? "parser_extract" : "explicit_metadata",
      normalized_input_digest: workUnitAtomicity.input_digest,
      policy_backend: workUnitAtomicity.backend_identity.policy_backend,
      policy_backend_version: workUnitAtomicity.backend_identity.policy_backend_version,
      policy_profile_id: workUnitAtomicity.profile_id,
      policy_profile_version: workUnitAtomicity.profile_version,
      node_engine_api_key_present: normalizeCredentialStatus(
        options.node_engine_api_key ?? options.nodeEngineApiKey
      ).api_key_present,
      node_engine_request_id: nodeEngineService.request_id
    }
  };
}
