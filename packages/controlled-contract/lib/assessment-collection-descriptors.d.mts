export type ControlledContractAssessmentFamily = "proof" | "integration_test_design";
export interface ControlledContractAssessmentCollectionDescriptor {
  readonly collection: string;
  readonly stable_id: string;
  readonly fields: readonly string[];
  readonly selectors: readonly string[];
}
export interface ControlledContractAssessmentProjectionVocabulary {
  readonly semantic_scope: "task_relevant_public";
  readonly compact_omission: Readonly<{
    cause: "delivery_bound";
    complete_path: "typed_continuation";
  }>;
  readonly continuation: Readonly<{
    collection_rows: "typed_collection";
    structured_values: "typed_field_projection";
    scalar_values: "offset_length_total_range";
  }>;
  readonly exact_cardinality_fields: readonly [
    "counts", "matched_count", "returned_count", "omitted_count", "total"
  ];
  readonly authority: "non_authorizing";
}
export const CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY:
  Readonly<ControlledContractAssessmentProjectionVocabulary>;
export const CONTROLLED_CONTRACT_PROOF_ASSESSMENT_COLLECTIONS:
  readonly ControlledContractAssessmentCollectionDescriptor[];
export const CONTROLLED_CONTRACT_INTEGRATION_ASSESSMENT_COLLECTIONS:
  readonly ControlledContractAssessmentCollectionDescriptor[];
export const CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS: Readonly<Record<
  ControlledContractAssessmentFamily,
  readonly ControlledContractAssessmentCollectionDescriptor[]
>>;
export function assessmentCollectionDescriptor(
  family: ControlledContractAssessmentFamily,
  collection: string
): ControlledContractAssessmentCollectionDescriptor | null;
