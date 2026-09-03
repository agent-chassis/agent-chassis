

import {
  TASK_RESULT_PROJECTION_VOCABULARY,
  defineTaskResultCollectionDescriptors
} from "./task-result-projection-vocabulary.mjs";

export const CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY = Object.freeze({
  semantic_scope: TASK_RESULT_PROJECTION_VOCABULARY.semantic_scope,
  compact_omission: Object.freeze({
    cause: "delivery_bound",
    complete_path: "typed_continuation"
  }),
  continuation: TASK_RESULT_PROJECTION_VOCABULARY.continuation,
  accounting: TASK_RESULT_PROJECTION_VOCABULARY.accounting,
  exact_cardinality_fields: Object.freeze([
    "counts",
    "matched_count",
    "returned_count",
    "omitted_count",
    "total"
  ]),
  authority: TASK_RESULT_PROJECTION_VOCABULARY.authority
});

export const CONTROLLED_CONTRACT_PROOF_ASSESSMENT_COLLECTIONS =
  defineTaskResultCollectionDescriptors([
  {
    collection: "per_pack_outcomes",
    stable_id: "pack_id",
    fields: [
      "pack_id", "profile_id", "profile_version", "state",
      "profile_discrimination", "exact_binding"
    ],
    selectors: ["id", "state"]
  },
  {
    collection: "diagnostics",
    stable_id: "diagnostic_id",
    fields: ["diagnostic_id", "code", "state", "axis", "subject_id"],
    selectors: ["id", "code", "state"]
  },
  {
    collection: "proof_exclusions",
    stable_id: "exclusion_id",
    fields: ["exclusion_id"],
    selectors: ["id"]
  },
  {
    collection: "missing_inputs",
    stable_id: "missing_input_id",
    fields: ["missing_input_id", "code"],
    selectors: ["id", "code"]
  },
  {
    collection: "cross_carrier_integrity",
    stable_id: "integrity_finding_id",
    fields: [
      "integrity_finding_id", "kind", "identity", "carrier_kind", "pointer",
      "field", "content_digest", "generation_id", "expected_generation"
    ],
    selectors: ["id", "kind", "identity", "carrier_kind", "generation_id"]
  }
]);

export const CONTROLLED_CONTRACT_INTEGRATION_ASSESSMENT_COLLECTIONS =
  defineTaskResultCollectionDescriptors([
  {
    collection: "axes",
    stable_id: "axis",
    fields: ["axis", "state", "applicability", "counts"],
    selectors: ["id", "axis", "state"]
  },
  {
    collection: "gaps",
    stable_id: "diagnostic_id",
    fields: ["diagnostic_id", "code", "state", "axis", "subject_id"],
    selectors: ["id", "axis", "state", "code"]
  },
  {
    collection: "requirement_coverage",
    stable_id: "requirement_id",
    fields: ["requirement_id", "state", "obligation_count"],
    selectors: ["id", "state"]
  },
  {
    collection: "scenario_coverage",
    stable_id: "scenario_id",
    fields: ["scenario_id", "state"],
    selectors: ["id", "state"]
  },
  {
    collection: "interaction_coverage",
    stable_id: "interaction_id",
    fields: ["interaction_id", "state", "scenario_count"],
    selectors: ["id", "state"]
  },
  {
    collection: "review_question_results",
    stable_id: "question_id",
    fields: ["question_id", "state", "axis"],
    selectors: ["id", "axis", "state"]
  },
  {
    collection: "unsupported_axes",
    stable_id: "axis",
    fields: ["axis", "state"],
    selectors: ["id", "axis"]
  },
  {
    collection: "diagnostic_code_summaries",
    stable_id: "code",
    fields: ["code", "state", "count"],
    selectors: ["id", "code", "state"]
  }
]);

export const CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS = Object.freeze({
  proof: CONTROLLED_CONTRACT_PROOF_ASSESSMENT_COLLECTIONS,
  integration_test_design: CONTROLLED_CONTRACT_INTEGRATION_ASSESSMENT_COLLECTIONS
});

export function assessmentCollectionDescriptor(family, collection) {
  const rows = CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS[family];
  return rows?.find((row) => row.collection === collection) ?? null;
}
