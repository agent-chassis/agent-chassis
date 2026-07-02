

import {
  classifyExistingCodeSurfaceCount,
  cloneJson,
  isNonEmptyString,
  isObject,
  normalizeStringEntry,
  sortStrings,
  toNonNegativeInteger
} from "./work-record-admission-shared.mjs";
import {
  WORK_RECORD_ADMISSION_DECISION_LOCAL_SCHEMA_VERSION,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR,
  WORK_RECORD_ADMISSION_LOCAL_AUTHORITY,
  WORK_RECORD_ADMISSION_LOCAL_POLICY_BACKEND,
  WORK_UNIT_ATOMICITY_DENY_DECISION_CODES,
  WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES,
  sortAdmissionCodes
} from "./work-record-admission-decision-codes.mjs";
import { WORK_RECORD_POLICY_PACK_REFERENCE_V1 } from "./work-record-policy-pack-v1.mjs";
import { normalizeWorkUnitAtomicityPolicyProfileFromPack } from "./work-record-policy-pack-override.mjs";
import { normalizeStructuralTargetMetrics } from "./work-record-target-metrics.mjs";

export const WORK_UNIT_ATOMICITY_REMEDIATION_CODES = Object.freeze({
  split_or_narrow_write_scope: "worker_admission.work_unit_atomicity.remediation.split_or_narrow_write_scope.v1",
  refine_expected_edit_targets_or_budget:
    "worker_admission.work_unit_atomicity.remediation.refine_expected_edit_targets_or_budget.v1",
  extract_smaller_seam: "worker_admission.work_unit_atomicity.remediation.extract_smaller_seam.v1",
  approved_large_file_review_path:
    "worker_admission.work_unit_atomicity.remediation.approved_large_file_review_path.v1",
  add_target_plan_evidence: "worker_admission.work_unit_atomicity.remediation.add_target_plan_evidence.v1",
  obtain_scoped_expiring_dec_authority:
    "worker_admission.work_unit_atomicity.remediation.obtain_scoped_expiring_dec_authority.v1"
});

export const WORK_RECORD_ADMISSION_LOCAL_POLICY_BACKEND_VERSION =
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR.version;

export function loadReferenceWorkerAdmissionPolicyPack() {
  return cloneJson(WORK_RECORD_POLICY_PACK_REFERENCE_V1);
}

export function normalizeStructuralTargetMetricsInput(value) {
  if (value === null || value === undefined) {
    return normalizeStructuralTargetMetrics({});
  }
  if (isObject(value) && Array.isArray(value.targets) && value.target_resolution_evidence_status) {
    return value;
  }
  return normalizeStructuralTargetMetrics(isObject(value) ? value : {});
}

export function detectMissingTargetPlanReviewSignal({ structuralTargetMetrics, fileStats }) {
  if (!isObject(structuralTargetMetrics)) {
    return null;
  }
  const status = normalizeStringEntry(structuralTargetMetrics.target_resolution_evidence_status);
  const targetCount = toNonNegativeInteger(structuralTargetMetrics.expected_edit_target_count);
  const unresolvedWriteScopeTargets = toNonNegativeInteger(
    structuralTargetMetrics.write_scope_without_resolved_targets
  );
  if (
    unresolvedWriteScopeTargets !== null &&
    unresolvedWriteScopeTargets > 0
  ) {
    return {
      reason_code: WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.target_plan_missing,
      reason:
        "write scope includes paths without resolved structural targets; supply target resolution evidence before launch",
      rule: "write_scope_without_resolved_targets"
    };
  }
  if (status !== "absent" || (targetCount !== null && targetCount > 0)) {
    return null;
  }
  if (classifyExistingCodeSurfaceCount(fileStats) === 0) {
    return null;
  }
  return {
    reason_code: WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.target_plan_missing,
    reason:
      "expected_edit_targets evidence is absent and the unit touches an existing code surface; supply a target plan before launch",
    rule: "target_plan_missing_for_code_surface"
  };
}

export function normalizeWorkUnitAtomicityProfile(value) {
  const profile = isObject(value) ? value : {};
  const selectedPolicyPack = isObject(profile.policy_pack)
    ? profile.policy_pack
    : isObject(profile.policyPack)
      ? profile.policyPack
      : profile.schema_version === "worker-admission-policy-pack.v1"
        ? profile
        : null;
  const packProfile = selectedPolicyPack
    ? normalizeWorkUnitAtomicityPolicyProfileFromPack(selectedPolicyPack, {
      source: normalizeStringEntry(profile.source) ?? "policy_pack"
    })
    : null;
  const source = isNonEmptyString(profile.source)
    ? String(profile.source).trim()
    : packProfile?.source
      ? packProfile.source
      : isObject(value)
      ? "caller_supplied"
      : "local_default";
  const thresholds = {};
  for (const [key, numericValue] of Object.entries(isObject(packProfile?.thresholds) ? packProfile.thresholds : {})) {
    const normalized = toNonNegativeInteger(numericValue);
    if (normalized !== null) {
      thresholds[key] = normalized;
    }
  }
  for (const [key, numericValue] of Object.entries(isObject(profile.thresholds) ? profile.thresholds : {})) {
    const normalized = toNonNegativeInteger(numericValue);
    if (normalized !== null) {
      thresholds[key] = normalized;
    }
  }
  return {
    profile_id: isNonEmptyString(profile.profile_id)
      ? String(profile.profile_id).trim()
      : packProfile?.profile_id ?? "worker-admission.work_unit_atomicity.default",
    profile_version: isNonEmptyString(profile.profile_version)
      ? String(profile.profile_version).trim()
      : packProfile?.profile_version ?? "v1",
    source,
    thresholds,
    rules: Array.isArray(profile.rules) ? cloneJson(profile.rules) : packProfile?.rules ?? [],
    disabled_rule_ids: sortStrings([
      ...(Array.isArray(profile.disabled_rule_ids) ? profile.disabled_rule_ids : []),
      ...(Array.isArray(profile.disabledRuleIds) ? profile.disabledRuleIds : []),
      ...(Array.isArray(packProfile?.disabled_rule_ids) ? packProfile.disabled_rule_ids : [])
    ])
  };
}

function toPublicWorkUnitAtomicityPolicyProfile(profile) {
  return {
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    source: profile.source,
    rules: cloneJson(profile.rules),
    disabled_rule_ids: cloneJson(profile.disabled_rule_ids)
  };
}

export function normalizeWorkerAdmissionPolicyPackReference(value = loadReferenceWorkerAdmissionPolicyPack()) {
  const referencePack = loadReferenceWorkerAdmissionPolicyPack();
  if (isNonEmptyString(value)) {
    return {
      schema_version: "worker-admission-policy-pack.v1",
      pack_id: referencePack.pack_id,
      pack_name: referencePack.pack_name,
      policy_backend: referencePack.policy_backend,
      policy_backend_version: referencePack.policy_backend_version,
      profile_id: String(value).trim(),
      profile_version: "v1",
      rules: Array.isArray(referencePack.rules?.work_unit_feature_vector)
        ? cloneJson(referencePack.rules.work_unit_feature_vector)
        : []
    };
  }

  const source = isObject(value) && Object.keys(value).length > 0 ? value : referencePack;
  const policyProfile = isObject(source.policy_profile)
    ? source.policy_profile
    : isObject(source.policyProfile)
      ? source.policyProfile
      : {};
  const backendIdentity = isObject(source.backend_identity) ? source.backend_identity : {};
  const packRules = Array.isArray(source.rules?.work_unit_feature_vector)
    ? source.rules.work_unit_feature_vector
    : Array.isArray(source.rules)
      ? source.rules
      : referencePack.rules.work_unit_feature_vector;
  const ruleIds = sortStrings(packRules.map((rule) => normalizeStringEntry(rule?.id)).filter(Boolean));

  return {
    schema_version: normalizeStringEntry(source.schema_version ?? referencePack.schema_version) ?? referencePack.schema_version,
    pack_id: normalizeStringEntry(source.pack_id ?? source.policy_pack_id ?? referencePack.pack_id) ?? referencePack.pack_id,
    pack_name: normalizeStringEntry(source.pack_name ?? source.policy_pack_name ?? referencePack.pack_name) ??
      referencePack.pack_name,
    policy_backend:
      normalizeStringEntry(source.policy_backend ?? backendIdentity.policy_backend ?? policyProfile.policy_backend) ??
      referencePack.policy_backend,
    policy_backend_version:
      normalizeStringEntry(
        source.policy_backend_version ?? backendIdentity.policy_backend_version ?? policyProfile.policy_backend_version
      ) ?? referencePack.policy_backend_version,
    profile_id:
      normalizeStringEntry(source.profile_id ?? policyProfile.profile_id) ??
      referencePack.profile_id,
    profile_version: normalizeStringEntry(source.profile_version ?? policyProfile.profile_version) ?? referencePack.profile_version,
    rules: cloneJson(packRules),
    rule_ids: ruleIds
  };
}

export function readFeatureVectorMetricCount(metrics, key) {
  return toNonNegativeInteger(isObject(metrics) ? metrics[key]?.value ?? metrics[key] : null);
}

export function normalizeThresholds(thresholds = {}) {
  const defaultThresholds = {
    max_cluster_count: 1,
    review_downstream_surface_count: 5,
    deny_cluster_count_above: 1,
    review_max_fanout: 10,
    review_missing_update_hint_count: 5
  };

  const output = { ...defaultThresholds };
  if (!isObject(thresholds)) {
    return output;
  }

  for (const [key, value] of Object.entries(thresholds)) {
    if (!(key in output)) {
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) {
      output[key] = numeric;
    }
  }

  return output;
}

export function normalizeCredentialStatus(nodeEngineApiKey) {
  if (!isNonEmptyString(nodeEngineApiKey)) {
    return {
      credential_status: "missing_api_key",
      api_key_present: false,
      api_key_valid: false
    };
  }

  const value = nodeEngineApiKey.trim();
  const apiKeyValid = value.length >= 8 && !/\s/.test(value);
  return {
    credential_status: apiKeyValid ? "configured" : "invalid_api_key",
    api_key_present: true,
    api_key_valid: apiKeyValid
  };
}

export function decisionFromCode(code) {
  if (code === "node_engine_denied") {
    return "deny";
  }
  if (code === "node_engine_review_required") {
    return "review_required";
  }
  if (code === "node_engine_allowed") {
    return "allow";
  }
  return "deny";
}

const REVIEW_DECISION_CODE_PREFERENCE = [
  WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.required_metric_missing,
  WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.contradictory_metric_evidence,
  WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.target_plan_missing
];

function resolveAtomicityDecisionCode(decision, orderedDecisionCodes) {
  if (decision === "allow") {
    return null;
  }

  if (decision === "deny") {
    return (
      orderedDecisionCodes.find((code) => Object.values(WORK_UNIT_ATOMICITY_DENY_DECISION_CODES).includes(code)) ??
      orderedDecisionCodes[0] ??
      WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.required_metric_missing
    );
  }

  for (const preferredCode of REVIEW_DECISION_CODE_PREFERENCE) {
    if (orderedDecisionCodes.includes(preferredCode)) {
      return preferredCode;
    }
  }

  return orderedDecisionCodes[0] ?? WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.required_metric_missing;
}

function buildWorkUnitAtomicityRemediation({ decisionCodes }) {
  const targetPlanMissingTriggered = decisionCodes.includes(
    WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.target_plan_missing
  );

  if (!targetPlanMissingTriggered) {
    return null;
  }

  const remediationItems = [];

  remediationItems.push({
    code: WORK_UNIT_ATOMICITY_REMEDIATION_CODES.add_target_plan_evidence,
    message:
      "Add expected_edit_targets evidence so the local carrier facts can be derived before launch.",
    next_step: "add_target_plan_evidence"
  });

  return {
    schema_version: "worker-admission-remediation.v1",
    source_decision_code: WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.target_plan_missing,
    triggering_paths: [],
    codes: remediationItems.map((item) => item.code),
    items: remediationItems,
    summary: "The worker-admission decision needs target-plan evidence before local carrier facts are complete."
  };
}

export function evaluateWorkUnitAtomicityDecisionCore(options = {}) {
  const requestSource = isObject(options.request)
    ? options.request
    : isObject(options.normalized_request)
      ? options.normalized_request
      : isObject(options.normalizedRequest)
        ? options.normalizedRequest
        : null;
  const normalizedProfile = normalizeWorkUnitAtomicityProfile(
    options.policy_profile ??
      options.policyProfile ??
      options.profile ??
      requestSource?.policy_profile ??
      requestSource?.evidence?.policy_profile ??
      {}
  );
  const metrics = isObject(options.metrics)
    ? options.metrics
    : isObject(options.metric_summary)
      ? options.metric_summary
      : isObject(options.metricSummary)
        ? options.metricSummary
        : isObject(requestSource?.work_unit_metrics)
          ? requestSource.work_unit_metrics
          : isObject(requestSource?.evidence?.materialized_work_unit_metrics)
            ? requestSource.evidence.materialized_work_unit_metrics
            : {};
  const contradictions = Array.isArray(options.contradictions) ? options.contradictions : [];
  const missingSupportingEvidence = isObject(options.missing_supporting_evidence)
    ? options.missing_supporting_evidence
    : isObject(options.missingSupportingEvidence)
      ? options.missingSupportingEvidence
      : {};
  const targetPlanSignal = isObject(options.target_plan_signal)
    ? options.target_plan_signal
    : isObject(options.targetPlanSignal)
      ? options.targetPlanSignal
      : null;
  const provenance = isObject(options.provenance)
    ? options.provenance
    : isObject(options.metric_source_provenance)
      ? options.metric_source_provenance
      : isObject(options.metricSourceProvenance)
        ? options.metricSourceProvenance
        : isObject(requestSource?.evidence?.metric_source_provenance)
          ? requestSource.evidence.metric_source_provenance
          : {};
  const request = requestSource ? cloneJson(requestSource) : null;
  const inputDigest = normalizeStringEntry(options.input_digest ?? options.inputDigest) ?? null;
  const schemaVersion = WORK_RECORD_ADMISSION_DECISION_LOCAL_SCHEMA_VERSION;
  const callerSchemaVersion = normalizeStringEntry(options.schema_version ?? options.schemaVersion);
  const decisionKind = normalizeStringEntry(options.decision_kind ?? options.decisionKind) ?? "work_unit_atomicity";
  const mode = normalizeStringEntry(options.mode ?? options.request_mode ?? options.requestMode) ?? "local";

  const callerPolicyBackend = normalizeStringEntry(options.policy_backend ?? options.policyBackend);
  const provenancePolicyBackend = normalizeStringEntry(provenance.policy_backend);
  const localPolicyBackend = WORK_RECORD_ADMISSION_LOCAL_POLICY_BACKEND;
  const callerPolicyBackendVersion = normalizeStringEntry(
    options.policy_backend_version ?? options.policyBackendVersion
  );
  const provenancePolicyBackendVersion = normalizeStringEntry(provenance.policy_backend_version);
  const resolvedPolicyBackendVersion =
    callerPolicyBackendVersion ?? provenancePolicyBackendVersion ?? WORK_RECORD_ADMISSION_LOCAL_POLICY_BACKEND_VERSION;
  const resolvedTargetPlanSignal =
    targetPlanSignal ??
    (isObject(request?.evidence?.source_inputs?.structural_target_metrics) ||
    Array.isArray(request?.evidence?.source_inputs?.file_stats) ||
    isObject(request?.structural_target_metrics) ||
    Array.isArray(request?.file_stats)
      ? detectMissingTargetPlanReviewSignal({
          structuralTargetMetrics:
            request?.evidence?.source_inputs?.structural_target_metrics ??
            request?.structural_target_metrics ??
            metrics.structural_target_metrics ??
            null,
          fileStats: request?.evidence?.source_inputs?.file_stats ?? request?.file_stats ?? []
        })
      : null);

  const reasons = [];
  const matchedRules = [];
  const decisionCodes = [];
  let decision = "allow";

  const integrityContradictions = [];
  if (callerSchemaVersion && callerSchemaVersion !== schemaVersion) {
    integrityContradictions.push({
      metric: "schema_version",
      source: "caller_supplied",
      reason:
        `unsupported schema_version "${callerSchemaVersion}" for local worker-admission evaluator; ` +
        `local emissions use ${schemaVersion}`,
      reason_code: WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.schema_version_unsupported
    });
  }
  if (callerPolicyBackend && callerPolicyBackend !== localPolicyBackend) {
    integrityContradictions.push({
      metric: "policy_backend",
      source: "caller_supplied_options",
      reason:
        `caller-supplied options.policy_backend "${callerPolicyBackend}" does not match the ` +
        `local backend "${localPolicyBackend}"`,
      reason_code: WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.backend_identity_contradiction
    });
  }
  if (provenancePolicyBackend && provenancePolicyBackend !== localPolicyBackend) {
    integrityContradictions.push({
      metric: "policy_backend",
      source: "metric_source_provenance",
      reason:
        `metric_source_provenance.policy_backend "${provenancePolicyBackend}" does not match ` +
        `the local backend "${localPolicyBackend}"`,
      reason_code: WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.backend_identity_contradiction
    });
  }

  if (callerPolicyBackendVersion && callerPolicyBackendVersion !== WORK_RECORD_ADMISSION_LOCAL_POLICY_BACKEND_VERSION) {
    integrityContradictions.push({
      metric: "policy_backend_version",
      source: "caller_supplied_options",
      reason:
        `caller-supplied options.policy_backend_version "${callerPolicyBackendVersion}" does not match the ` +
        `local backend version "${WORK_RECORD_ADMISSION_LOCAL_POLICY_BACKEND_VERSION}"`,
      reason_code: WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.backend_identity_contradiction
    });
  }
  if (
    provenancePolicyBackendVersion &&
    provenancePolicyBackendVersion !== WORK_RECORD_ADMISSION_LOCAL_POLICY_BACKEND_VERSION
  ) {
    integrityContradictions.push({
      metric: "policy_backend_version",
      source: "metric_source_provenance",
      reason:
        `metric_source_provenance.policy_backend_version "${provenancePolicyBackendVersion}" does not match ` +
        `the local backend version "${WORK_RECORD_ADMISSION_LOCAL_POLICY_BACKEND_VERSION}"`,
      reason_code: WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.backend_identity_contradiction
    });
  }
  if (
    callerPolicyBackendVersion &&
    provenancePolicyBackendVersion &&
    callerPolicyBackendVersion !== provenancePolicyBackendVersion
  ) {
    integrityContradictions.push({
      metric: "policy_backend_version",
      source: "caller_provenance_disagreement",
      reason:
        `options.policy_backend_version "${callerPolicyBackendVersion}" disagrees with ` +
        `metric_source_provenance.policy_backend_version "${provenancePolicyBackendVersion}"`,
      reason_code: WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.backend_identity_contradiction
    });
  }

  const missingSupportingEvidenceKeys = Object.entries(missingSupportingEvidence)
    .filter(([, issue]) => Boolean(issue))
    .map(([key]) => key);

  if (metrics.unknown_metric_count > 0 || missingSupportingEvidenceKeys.length > 0) {
    decision = "review_required";
    reasons.push("required breadth evidence is missing");
    matchedRules.push("required_metric_missing");
    decisionCodes.push(WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.required_metric_missing);
    for (const key of missingSupportingEvidenceKeys) {
      const missingIssue = missingSupportingEvidence[key];
      if (!missingIssue) {
        continue;
      }
      reasons.push(missingIssue.reason);
      matchedRules.push(`missing_${key}`);
      decisionCodes.push(missingIssue.reason_code);
    }
  }

  if (resolvedTargetPlanSignal) {
    decision = decision === "deny" ? "deny" : "review_required";
    reasons.push(resolvedTargetPlanSignal.reason);
    matchedRules.push(resolvedTargetPlanSignal.rule);
    decisionCodes.push(resolvedTargetPlanSignal.reason_code);
  }

  if (contradictions.length > 0) {
    decision = "review_required";
    for (const contradiction of contradictions) {
      reasons.push(contradiction.reason);
      matchedRules.push(`${contradiction.metric}_contradicts_${contradiction.source}`);
    }
    decisionCodes.push(WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.contradictory_metric_evidence);
  }

  if (integrityContradictions.length > 0) {
    decision = decision === "deny" ? "deny" : "review_required";
    for (const contradiction of integrityContradictions) {
      reasons.push(contradiction.reason);
      matchedRules.push(`${contradiction.metric}_contradicts_${contradiction.source}`);
      decisionCodes.push(contradiction.reason_code);
    }
  }

  const orderedDecisionCodes = sortAdmissionCodes(decisionCodes);
  const decisionCode = resolveAtomicityDecisionCode(decision, orderedDecisionCodes);
  const hasEvidenceIntegrityVerdict = decision !== "allow" || orderedDecisionCodes.length > 0;
  const remediation = buildWorkUnitAtomicityRemediation({
    decisionCodes: orderedDecisionCodes
  });
  const publicPolicyProfile = toPublicWorkUnitAtomicityPolicyProfile(normalizedProfile);

  const normalizedProvenance = cloneJson(provenance);
  normalizedProvenance.policy_backend = localPolicyBackend;
  normalizedProvenance.policy_backend_version = resolvedPolicyBackendVersion;
  const combinedContradictions = cloneJson(contradictions);
  for (const entry of integrityContradictions) {
    combinedContradictions.push({
      metric: entry.metric,
      source: entry.source,
      reason: entry.reason,
      reason_code: entry.reason_code
    });
  }

  const result = {
    schema_version: schemaVersion,
    authority: WORK_RECORD_ADMISSION_LOCAL_AUTHORITY,
    decision_kind: decisionKind,
    decision_codes: orderedDecisionCodes,
    backend_identity: {
      policy_backend: localPolicyBackend,
      policy_backend_version: resolvedPolicyBackendVersion
    },
    profile_id: normalizedProfile.profile_id,
    profile_version: normalizedProfile.profile_version,
    mode,
    reasons: sortStrings(
      reasons.length > 0 ? reasons : ["carrier facts are structurally complete for Node Engine evaluation"]
    ),
    matched_rules: sortStrings(
      matchedRules.length > 0 ? matchedRules : ["carrier_facts_recorded_no_local_admissibility_judgment"]
    ),
    remediation,
    input_digest: inputDigest,
    evidence: {
      metric_source_provenance: normalizedProvenance,
      contradictions: combinedContradictions,
      policy_profile: publicPolicyProfile
    },
    request,
    metrics: cloneJson(metrics),
    provenance: cloneJson(normalizedProvenance)
  };

  if (!hasEvidenceIntegrityVerdict) {
    if (request?.schema_version === "worker-admission-request.v1") {
      return result;
    }
    return {
      ...result,
      decision: "allow",
      allowed: true,
      effect: "allows_carrier_fact_forwarding_without_local_admissibility_judgment"
    };
  }

  return {
    ...result,
    decision,
    decision_code: decisionCode,
    effect: decision === "deny" ? "blocks_launch" : "requires_review"
  };
}
