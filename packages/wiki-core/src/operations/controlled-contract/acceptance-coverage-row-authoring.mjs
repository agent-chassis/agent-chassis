

import {
  ACCEPTANCE_COVERAGE_AXES,
  ACCEPTANCE_COVERAGE_STATES
} from "../../lib/controlled-contract-tools.mjs";
import { projectControlledContractClaimSelectors } from
  "./contract-requirement-vocabulary.mjs";

export const CONTROLLED_CONTRACT_ACCEPTANCE_ROW_AUTHORING_SCHEMA =
  "controlled-contract-acceptance-row-authoring.v1";

export const CONTROLLED_CONTRACT_ACCEPTANCE_RESPONSE_KIND = "acceptance_coverage";

export const CONTROLLED_CONTRACT_ACCEPTANCE_ROW_AUTHORING_BYTES = 4096;

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function semanticHoles(currentAxes, currentNodeIds) {
  return Object.freeze([
    Object.freeze({
      pointer: "/node_ids",
      requirement:
        "the controlled-contract node identities this criterion is mapped to",
      cardinality: "one_or_more",
      current_values: Object.freeze([...currentNodeIds])
    }),
    ...ACCEPTANCE_COVERAGE_AXES.map((axis) => Object.freeze({
      pointer: `/axes/${axis}`,
      requirement: `the current disposition of the ${axis} axis`,
      cardinality: "exactly_one",
      admitted_values: ACCEPTANCE_COVERAGE_STATES,
      current_value: currentAxes[axis] ?? null
    }))
  ]);
}

export function projectControlledContractAcceptanceRowAuthoring({
  ownerResult, criterionIdentity
}) {
  if (!plainObject(ownerResult) || typeof criterionIdentity !== "string" ||
      criterionIdentity.length === 0) return null;
  const authored = (Array.isArray(ownerResult.rows) ? ownerResult.rows : [])
    .filter((row) => row?.criterion_identity === criterionIdentity);
  if (authored.length !== 1) return null;
  const [row] = authored;
  const currentAxes = plainObject(row.axes) ? row.axes : {};
  const currentNodeIds = Array.isArray(row.node_ids) ? row.node_ids : [];

  const evaluated = (Array.isArray(ownerResult.evaluation?.states)
    ? ownerResult.evaluation.states : [])
    .find((state) => state?.criterion_identity === criterionIdentity) ?? null;
  const criterionIndex = (ownerResult.criteria_with_locators ?? []).findIndex(
    ({ identity }) => identity === criterionIdentity);
  const criterion = criterionIndex < 0 ? null : ownerResult.criteria?.[criterionIndex] ?? null;
  const claimById = new Map(projectControlledContractClaimSelectors(
    ownerResult.contract?.content ?? null).map((claim) => [claim.selector, claim]));
  const mappedClaims = currentNodeIds.map((id) => claimById.get(id) ?? Object.freeze({
    selector: id, meaning_unavailable: true
  }));
  const guaranteeState = currentAxes.selected_pack_guarantee_coverage ?? null;
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_ACCEPTANCE_ROW_AUTHORING_SCHEMA,
    response_kind: CONTROLLED_CONTRACT_ACCEPTANCE_RESPONSE_KIND,
    criterion_identity: criterionIdentity,
    criterion_text: structuredClone(criterion),
    current_disposition: evaluated?.state ?? null,
    current_node_ids: Object.freeze([...currentNodeIds]),
    mapped_claim_meaning: Object.freeze(mappedClaims.map((claim) =>
      Object.freeze(structuredClone(claim)))),
    uncovered_guarantee: Object.freeze({
      axis: "selected_pack_guarantee_coverage",
      current_state: guaranteeState,
      meaning: guaranteeState === "covered" ? null
        : "The current criterion-to-claim mapping does not establish coverage by a selected proof-pack guarantee."
    }),
    current_axes: Object.freeze(Object.fromEntries(
      ACCEPTANCE_COVERAGE_AXES.map((axis) => [axis, currentAxes[axis] ?? null]))),
    required_axes: ACCEPTANCE_COVERAGE_AXES,

    admitted_dispositions: ACCEPTANCE_COVERAGE_STATES,
    semantic_holes: semanticHoles(currentAxes, currentNodeIds),

    source: Object.freeze({
      criterion_identity_set_digest:
        ownerResult.criterion_identities?.digest ?? null,
      carrier_content_digest: ownerResult.carrier?.content_digest ?? null,
      source_content_digest: ownerResult.source?.content_digest ?? null,
      unit_digest: ownerResult.unit_digest ?? null,
      authoring_identity: ownerResult.authoring_identity ?? null
    }),
    counts: Object.freeze({
      required_axes: ACCEPTANCE_COVERAGE_AXES.length,
      admitted_dispositions: ACCEPTANCE_COVERAGE_STATES.length,
      current_node_ids: currentNodeIds.length,
      semantic_holes: ACCEPTANCE_COVERAGE_AXES.length + 1,
      returned: 1,
      omitted: 0,
      total: 1
    })
  });
}

export function controlledContractAcceptanceRowAuthoringBytes(projection) {
  return Buffer.byteLength(JSON.stringify(projection ?? null), "utf8");
}

export { ACCEPTANCE_COVERAGE_AXES, ACCEPTANCE_COVERAGE_STATES };
