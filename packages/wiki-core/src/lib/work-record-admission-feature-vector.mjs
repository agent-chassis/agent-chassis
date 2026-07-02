import {
  cloneJson,
  computeNormalizedInputDigest,
  isObject,
  normalizeStringEntry,
  sortStrings
} from "./work-record-admission-shared.mjs";
import {
  WORK_RECORD_ADMISSION_DECISION_LOCAL_SCHEMA_VERSION,
  WORK_RECORD_ADMISSION_LOCAL_AUTHORITY,
  WORK_RECORD_ADMISSION_LOCAL_POLICY_BACKEND,
  WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES,
  sortAdmissionCodes
} from "./work-record-admission-decision-codes.mjs";
import {
  loadReferenceWorkerAdmissionPolicyPack,
  normalizeWorkerAdmissionPolicyPackReference
} from "./work-record-admission-policy.mjs";
import { normalizeWorkUnitFeatureVector } from "./work-record-feature-vector.mjs";

export function createWorkerAdmissionDecisionFromFeatureVector(
  featureVector = {},
  policyPackReference = loadReferenceWorkerAdmissionPolicyPack(),
  options = {}
) {

  const callerSchemaVersion = normalizeStringEntry(
    isObject(options) ? options.schema_version ?? options.schemaVersion : null
  );
  if (callerSchemaVersion && callerSchemaVersion !== WORK_RECORD_ADMISSION_DECISION_LOCAL_SCHEMA_VERSION) {
    throw new Error(
      `createWorkerAdmissionDecisionFromFeatureVector: unsupported schema_version ` +
        `"${callerSchemaVersion}"; local feature-vector emissions use ` +
        WORK_RECORD_ADMISSION_DECISION_LOCAL_SCHEMA_VERSION
    );
  }
  const rawFeatureVector = isObject(featureVector) ? featureVector : null;
  const normalizedFeatureVector = normalizeWorkUnitFeatureVector(rawFeatureVector ?? {});
  const normalizedPolicyPack = normalizeWorkerAdmissionPolicyPackReference(policyPackReference);

  const normalizedInputDigest = computeNormalizedInputDigest({
    schema_version: WORK_RECORD_ADMISSION_DECISION_LOCAL_SCHEMA_VERSION,
    authority: WORK_RECORD_ADMISSION_LOCAL_AUTHORITY,
    decision_kind: "work_unit_atomicity",
    feature_vector: normalizedFeatureVector,
    policy_pack_reference: normalizedPolicyPack
  });

  const reasons = [];
  const matchedRules = [];
  const decisionCodes = [];
  let decision = "allow";

  const schemaVersion = normalizeStringEntry(rawFeatureVector?.schema_version);
  const vocabularyVersion = normalizeStringEntry(rawFeatureVector?.vocabulary_version);
  if (!rawFeatureVector) {
    decision = "review_required";
    reasons.push("feature vector input must be an object");
    matchedRules.push("feature_vector_input_shape");
    decisionCodes.push(WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.required_metric_missing);
  }
  if (schemaVersion !== "work-unit-feature-vector.v1") {
    decision = "review_required";
    reasons.push("feature vector schema version must be work-unit-feature-vector.v1");
    matchedRules.push("feature_vector_schema_version");
    decisionCodes.push(WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.required_metric_missing);
  }
  if (vocabularyVersion !== "wk-ontology.v1") {
    decision = "review_required";
    reasons.push("feature vector vocabulary version must be wk-ontology.v1");
    matchedRules.push("feature_vector_vocabulary_version");
    decisionCodes.push(WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.required_metric_missing);
  }

  const degradationEntries = Array.isArray(normalizedFeatureVector.degradations)
    ? normalizedFeatureVector.degradations
    : [];
  for (const degradation of degradationEntries) {
    const effect = normalizeStringEntry(degradation.effect) ?? "requires_review";
    if (effect === "annotates_only") {
      continue;
    }
    const reason = normalizeStringEntry(degradation.reason) ?? "normalized degradation evidence";
    reasons.push(reason);
    matchedRules.push(`degradation:${normalizeStringEntry(degradation.facet) ?? "unknown"}:${effect}`);
    if (normalizeStringEntry(degradation.reason_code)) {
      decisionCodes.push(String(degradation.reason_code).trim());
    }
    if (effect === "blocks_vector_construction" || effect === "denies") {
      decision = "deny";
    } else if (decision !== "deny") {
      decision = "review_required";
    }
  }

  const orderedDecisionCodes = sortAdmissionCodes(decisionCodes);
  const hasEvidenceIntegrityVerdict = decision !== "allow" || orderedDecisionCodes.length > 0;
  const result = {
    schema_version: WORK_RECORD_ADMISSION_DECISION_LOCAL_SCHEMA_VERSION,
    authority: WORK_RECORD_ADMISSION_LOCAL_AUTHORITY,
    decision_kind: "work_unit_atomicity",
    decision_codes: orderedDecisionCodes,
    policy_pack_reference: cloneJson(normalizedPolicyPack),
    policy_rule_ids: cloneJson(normalizedPolicyPack.rule_ids),
    backend_identity: {
      policy_backend: WORK_RECORD_ADMISSION_LOCAL_POLICY_BACKEND,
      policy_backend_version: normalizedPolicyPack.policy_backend_version
    },
    profile_id: normalizedPolicyPack.profile_id,
    profile_version: normalizedPolicyPack.profile_version,
    mode: "local",
    reasons: sortStrings(
      reasons.length > 0 ? reasons : ["feature vector facts are available for Node Engine evaluation"]
    ),
    matched_rules: sortStrings(matchedRules.length > 0 ? matchedRules : ["feature_vector_facts_forwarded"]),
    input_digest: normalizedInputDigest
  };

  if (!hasEvidenceIntegrityVerdict) {
    return result;
  }

  const decisionCode =
    decision === "deny"
      ? orderedDecisionCodes.at(0) ?? WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.required_metric_missing
      : orderedDecisionCodes[0] ?? WORK_UNIT_ATOMICITY_REVIEW_DECISION_CODES.required_metric_missing;

  return {
    ...result,
    decision,
    decision_code: decisionCode,
    effect: decision === "deny" ? "blocks_launch" : "requires_review"
  };
}
