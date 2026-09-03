

import { isRepositoryRelativePath } from
  "@agent-chassis/wiki-core/src/lib/work-record-repository-path.mjs";
import {
  WORK_RECORD_TARGET_UNIT_VALUES,
  WORK_RECORD_WORK_KIND_VALUES,
  WORK_UNIT_FACET_PROVENANCE_VALUES,
  WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES,
  WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES
} from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import {
  WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES,
  WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES
} from "@agent-chassis/wiki-core/src/lib/work-record-target-metrics.mjs";

import { READY_TARGET_COARSE_FACET_VALUES } from
  "@agent-chassis/wiki-core/src/lib/work-record-ready-slice-contract.mjs";

const READY_SLICE_WORK_KINDS = new Set(["implementation", "review", "redteam"]);
export const READY_SLICE_WORK_KIND_VALUES = Object.freeze(
  WORK_RECORD_WORK_KIND_VALUES.filter((value) => READY_SLICE_WORK_KINDS.has(value))
);

export const READY_PRIORITY_VALUES = Object.freeze(["low", "medium", "high", "critical"]);
export const READY_SHAPING_MODE_VALUES = Object.freeze([
  "implementation",
  "reviewer",
  "redteam"
]);
export const READY_SLICE_AGENT_ROLE_VALUES = Object.freeze([
  "worker",
  "reviewer",
  "redteam"
]);

export const READY_AGENT_NOTES_MAX_BYTES = 8192;

export function readyNonemptyString(z) {
  return z.string().trim().min(1);
}

export function readyRepositoryPath(z) {
  return readyNonemptyString(z).refine(isRepositoryRelativePath, {
    message: "must be a canonical repository-relative POSIX path"
  });
}

export function readyFacetProvenanceValue(z) {
  return z.enum(WORK_UNIT_FACET_PROVENANCE_VALUES).nullable();
}

export function readyStructuredValidationEntry(z) {
  return z
    .object({
      operation: z.literal("node_test"),
      target: readyRepositoryPath(z).refine((value) => value.endsWith(".mjs"), {
        message: "must be a canonical repository-relative .mjs test-module path"
      }),
      verification_ids: z.array(readyNonemptyString(z))
    })
    .strict();
}

export function readyStructuredValidationNote(z) {
  return z.object({
    note: readyNonemptyString(z),
    verification_ids: z.array(readyNonemptyString(z))
  }).strict();
}

export function readyValidationEntry(z) {
  return z.union([
    readyNonemptyString(z),
    readyStructuredValidationNote(z),
    readyStructuredValidationEntry(z)
  ]);
}

export function readyStructuredAcceptanceCriterion(z) {
  return z
    .object({
      text: readyNonemptyString(z),
      verification_method: z
        .enum(WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES)
        .nullable()
        .optional(),
      evidence_target: z.string().nullable().optional(),
      facet_provenance: z
        .object({
          text: readyFacetProvenanceValue(z).optional(),
          verification_method: readyFacetProvenanceValue(z).optional(),
          evidence_target: readyFacetProvenanceValue(z).optional()
        })
        .strict()
        .optional()
    })
    .strict();
}

export function readyAcceptance(z, { structuredCriteria = false } = {}) {
  const criterion = structuredCriteria
    ? z.union([readyNonemptyString(z), readyStructuredAcceptanceCriterion(z)])
    : readyNonemptyString(z);
  return z
    .object({
      criteria: z.array(criterion).min(1),
      validation: z.array(readyValidationEntry(z)).min(1)
    })
    .strict();
}

export function readyExpectedEditTarget(
  z,
  { coarseFacets = false, facetProvenance = false } = {}
) {
  const activityKindValues = coarseFacets
    ? [
      ...WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES,
      READY_TARGET_COARSE_FACET_VALUES.activity_kind
    ]
    : [...WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES];
  const artifactKindValues = coarseFacets
    ? [
      ...WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES,
      READY_TARGET_COARSE_FACET_VALUES.artifact_kind
    ]
    : [...WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES];
  const shape = {
    path: readyRepositoryPath(z),
    name: readyNonemptyString(z),
    kind: z.enum(WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES),
    operation: z.enum(WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES),
    activity_kind: z.enum(activityKindValues).nullable().optional(),
    artifact_kind: z.enum(artifactKindValues).nullable().optional(),
    granularity: z.enum(WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES).nullable().optional(),
    optional: z.boolean().optional()
  };
  if (facetProvenance) {
    shape.facet_provenance = z
      .object({
        path: readyFacetProvenanceValue(z).optional(),
        name: readyFacetProvenanceValue(z).optional(),
        kind: readyFacetProvenanceValue(z).optional(),
        operation: readyFacetProvenanceValue(z).optional(),
        activity_kind: readyFacetProvenanceValue(z).optional(),
        artifact_kind: readyFacetProvenanceValue(z).optional(),
        granularity: readyFacetProvenanceValue(z).optional(),
        optional: readyFacetProvenanceValue(z).optional()
      })
      .strict()
      .optional();
  }
  return z.object(shape).strict();
}

export function readyRootDispatchIntent(z) {
  return z
    .object({
      intended_agent_role: z.enum(READY_SLICE_AGENT_ROLE_VALUES).nullable(),
      target_unit: z.enum(WORK_RECORD_TARGET_UNIT_VALUES),
      requires_graph_impact: z.boolean(),
      requires_escalation: z.boolean()
    })
    .strict();
}

export function readySliceDispatchIntent(z) {
  return z
    .object({
      intended_agent_role: z.enum(READY_SLICE_AGENT_ROLE_VALUES),
      target_unit: z.literal("slice"),
      requires_graph_impact: z.boolean(),
      requires_escalation: z.boolean()
    })
    .strict();
}

export function readySliceAgentNotes(z) {
  return z
    .union([z.string(), z.array(z.string())])
    .refine(
      (value) =>
        Buffer.byteLength(Array.isArray(value) ? value.join("\n") : value, "utf8") <=
        READY_AGENT_NOTES_MAX_BYTES,
      {
        message:
          `agent_notes must be at most ${READY_AGENT_NOTES_MAX_BYTES} UTF-8 bytes after LF joining`
      }
    );
}

export function readyCarrierBody(z) {
  return z.object({}).passthrough();
}
