

import { isRepositoryRelativePath } from
  "@agent-chassis/wiki-core/src/lib/work-record-repository-path.mjs";
import {
  SLICE_ID_PATTERN,
  WORK_RECORD_STATUS_VALUES,
  WORK_RECORD_TARGET_UNIT_VALUES,
  WORK_RECORD_WORK_KIND_VALUES,
  WORK_UNIT_FACET_PROVENANCE_VALUES,
  WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES,
  WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES
} from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import { workRecordProseRegistryEntries } from
  "@agent-chassis/wiki-core/src/lib/work-record-contract-edit.mjs";
import { RECORD_ID_PATTERN } from
  "@agent-chassis/wiki-core/src/lib/work-record-contract-edit-shared.mjs";
import {
  WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES,
  WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES
} from "@agent-chassis/wiki-core/src/lib/work-record-target-metrics.mjs";
import {
  WORK_RECORD_CONTENT_MAX_PARTS,
  isUnicodeScalarString
} from "@agent-chassis/wiki-core/src/lib/work-record-entry-schema.mjs";
import { declareRequestConstraints } from "./zod-request-constraint-declarations.mjs";

import { READY_TARGET_COARSE_FACET_VALUES } from
  "@agent-chassis/wiki-core/src/lib/work-record-ready-slice-contract.mjs";

const READY_SLICE_WORK_KINDS = new Set(["implementation", "review", "redteam"]);
export const READY_SLICE_WORK_KIND_VALUES = Object.freeze(
  WORK_RECORD_WORK_KIND_VALUES.filter((value) => READY_SLICE_WORK_KINDS.has(value))
);

export const CANONICAL_SLICE_WORK_KIND_VALUES = Object.freeze(
  WORK_RECORD_WORK_KIND_VALUES.filter((value) => value !== "tracker")
);

function withoutAnchors(pattern) {
  return pattern.source.replace(/^\^/u, "").replace(/\$$/u, "");
}

const WORK_RECORD_UNIT_ADDRESS_PATTERN = new RegExp(
  `^(?:${withoutAnchors(RECORD_ID_PATTERN)})(?:#(?:${withoutAnchors(SLICE_ID_PATTERN)}))?$`,
  "u"
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

export function workRecordEntryContent(z) {
  const scalarText = () => declareRequestConstraints(
    z.string().refine(isUnicodeScalarString, {
      message: "must contain only Unicode scalar values"
    }),
    [{
      constraint: "unicode_scalar_string",
      statement: "Text must contain only Unicode scalar values."
    }]
  );
  const textLeaf = () => z.object({ text: scalarText() }).strict();
  const refLeaf = () => z.object({ ref: declareRequestConstraints(
    scalarText().refine(value => value.length > 0, {
      message: "must be one nonempty opaque returned reference"
    }),
    [{
      constraint: "nonempty_opaque_reference",
      statement: "ref must be one nonempty opaque reference returned by the ordinary reader."
    }]
  ) }).strict();
  return z.union([
    textLeaf(),
    refLeaf(),
    z.object({
      parts: z.array(z.union([textLeaf(), refLeaf()])).min(1).max(WORK_RECORD_CONTENT_MAX_PARTS)
    }).strict()
  ], {
    errorMap: () => ({
      message:
        "must be exactly {text:string}, {ref:nonempty-string}, or " +
        "{parts:[nonempty flat text/ref leaves]}; minimally use {text:\"replacement\"}"
    })
  });
}

export function workRecordProseContent(z, { field, scope }) {
  const entry = workRecordProseRegistryEntries(scope)
    .find((candidate) => candidate.field === field);
  if (!entry) throw new TypeError(`${field} is not a registry-owned ${scope} prose field`);
  return workRecordEntryContent(z);
}

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

export function readyStructuredValidationNote(z) {
  return z.object({
    note: readyNonemptyString(z),
    verification_ids: z.array(readyNonemptyString(z))
  }).strict();
}

export function readyValidationEntry(z) {
  return z.union([
    readyNonemptyString(z),
    readyStructuredValidationNote(z)
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

export function readyAcceptanceCriterion(z) {
  return z.union([readyNonemptyString(z), readyStructuredAcceptanceCriterion(z)]);
}

export function readyAcceptance(z, { structuredCriteria = false } = {}) {
  const criterion = structuredCriteria
    ? readyAcceptanceCriterion(z)
    : readyNonemptyString(z);
  return z
    .object({
      criteria: z.array(criterion).min(1),
      validation: z.array(readyValidationEntry(z)).min(1)
    })
    .strict();
}

export function canonicalSliceAcceptance(z) {
  const provenance = z
    .object({
      text: readyFacetProvenanceValue(z).optional(),
      verification_method: readyFacetProvenanceValue(z).optional(),
      evidence_target: readyFacetProvenanceValue(z).optional()
    })
    .passthrough();
  const structuredCriterion = z
    .object({
      text: readyNonemptyString(z),
      verification_method: z
        .enum(WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES)
        .nullable()
        .optional(),
      evidence_target: z.string().nullable().optional(),
      facet_provenance: provenance.optional()
    })
    .passthrough();
  return z
    .object({
      criteria: z.array(z.union([z.string(), structuredCriterion])),
      validation: z.array(readyValidationEntry(z))
    })
    .passthrough();
}

export function canonicalWorkRecordUnitAddress(z) {
  return z.string().trim().regex(WORK_RECORD_UNIT_ADDRESS_PATTERN);
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

export function readyCarrierBody(z) {
  return z.object({}).passthrough();
}

export function upsertSliceBodyContractDeclaration(z) {
  return z
    .object({

      id: z.string().regex(SLICE_ID_PATTERN).optional(),
      title: z.string().optional(),

      status: z.enum(WORK_RECORD_STATUS_VALUES).optional(),
      work_kind: z.enum(CANONICAL_SLICE_WORK_KIND_VALUES).optional(),
      depends_on: z.array(z.string()).optional(),
      read_scope: z.array(z.string()).optional(),
      repo_paths: z.array(z.string()).optional(),
      write_scope: z.array(z.string()).optional(),
      acceptance: canonicalSliceAcceptance(z).optional(),
      expected_changed_line_budget: z.number().int().nonnegative().nullable().optional(),
      sections: z
        .object({

          agent_notes: workRecordProseContent(z, {
            field: "sections.agent_notes", scope: "slice"
          }).optional(),
          summary: workRecordProseContent(z, {
            field: "sections.summary", scope: "slice"
          }).optional(),
          why_it_matters: workRecordProseContent(z, {
            field: "sections.why_it_matters", scope: "slice"
          }).optional(),
          material_refs: z.array(z.object({ ref: z.string().min(1) }).strict()).optional(),
          tasks: z.array(z.unknown()).optional()
        })
        .passthrough()
        .optional()
    })
    .passthrough();
}
