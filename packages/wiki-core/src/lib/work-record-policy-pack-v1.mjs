const WORK_RECORD_POLICY_PACK_V1_SCHEMA_VERSION = "worker-admission-policy-pack.v1";
const WORK_RECORD_POLICY_PACK_V1_PROFILE_ID = "worker-admission.work_unit_atomicity.default";
const WORK_RECORD_POLICY_PACK_V1_PROFILE_VERSION = "v1";

const WORK_UNIT_ATOMICITY_RULES_V1 = Object.freeze([]);

const WORK_UNIT_FEATURE_VECTOR_RULES_V1 = Object.freeze([]);

const WORK_UNIT_ATOMICITY_THRESHOLDS_V1 = Object.freeze({});

const WORK_UNIT_FEATURE_VECTOR_THRESHOLDS_V1 = Object.freeze({});

export const WORK_RECORD_POLICY_PACK_V1 = Object.freeze({
  schema_version: WORK_RECORD_POLICY_PACK_V1_SCHEMA_VERSION,
  pack_id: "worker-admission.work_unit_atomicity.reference.v1",
  pack_name: "reference worker-admission policy pack",
  policy_backend: "portfolio-local",
  policy_backend_version: "0.2.0",
  profile_id: WORK_RECORD_POLICY_PACK_V1_PROFILE_ID,
  profile_version: WORK_RECORD_POLICY_PACK_V1_PROFILE_VERSION,
  thresholds: Object.freeze({
    work_unit_atomicity: WORK_UNIT_ATOMICITY_THRESHOLDS_V1,
    work_unit_feature_vector: WORK_UNIT_FEATURE_VECTOR_THRESHOLDS_V1
  }),
  rules: Object.freeze({
    work_unit_atomicity: WORK_UNIT_ATOMICITY_RULES_V1,
    work_unit_feature_vector: WORK_UNIT_FEATURE_VECTOR_RULES_V1
  })
});

export const WORK_RECORD_POLICY_PACK_REFERENCE_V1 = WORK_RECORD_POLICY_PACK_V1;
export default WORK_RECORD_POLICY_PACK_V1;
