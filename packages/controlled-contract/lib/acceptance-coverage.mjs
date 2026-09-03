import {
  compareCriterionIdentitySets,
  normalizeCriterionIdentityEntry
} from "./acceptance-coverage-identity.mjs";
import {
  deepFreeze,
  unsupportedObjectKeys
} from "./deterministic-projection-primitives.mjs";
import { validateObligationCoverageCarrier }
  from "./obligation-coverage-carrier.mjs";
import { resolveObligationGuaranteeSelector }
  from "./obligation-coverage-guarantee-selectors.mjs";

const ACCEPTANCE_COVERAGE_STATES = Object.freeze([
  "covered", "uncovered", "duplicate", "unknown", "stale", "outside_pack",
  "retained_residue", "infeasible"
]);

const GAP_WARNING = Object.freeze({
  code: "acceptance_coverage_incomplete",
  severity: "advisory",
  message: "Acceptance coverage has unresolved gaps.",
  payload: "acceptance-coverage-gap-warning.v1"
});
const RESULT_PRECEDENCE = Object.freeze(["stale", "duplicate", "infeasible", "retained_residue", "unknown", "outside_pack", "uncovered", "covered"]);
const OBLIGATION_COVERAGE_OUTCOMES = Object.freeze([
  "stale", "unmapped", "explicit_gap", "guarantee_incompatible",
  "mapped_input_missing", "mapped_pack_not_evaluated",
  "profile_proven_exact_binding_missing", "mechanically_proven"
]);

class AcceptanceCoverageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AcceptanceCoverageError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function requiredArray(value, name) {
  if (!Array.isArray(value)) throw new AcceptanceCoverageError(
    "acceptance_coverage_input_invalid", `${name} must be an array`, { name }
  );
  return value;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new AcceptanceCoverageError(
    "acceptance_coverage_input_invalid", `${name} must be a non-empty string`, { name }
  );
  return value;
}

function exactKeys(value, allowed, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AcceptanceCoverageError("acceptance_coverage_input_invalid", `${name} must be an object`);
  const unsupported = unsupportedObjectKeys(value, allowed);
  if (unsupported.length > 0) {
    const [key] = unsupported;
    throw new AcceptanceCoverageError("acceptance_coverage_input_invalid", `${name}.${key} is not supported`, { name, key });
  }
}

function criterionIdentity(entry, index) {
  const name = `criteria.identities[${index}]`;
  try {
    return normalizeCriterionIdentityEntry(entry, name).identity;
  } catch (error) {
    if (error instanceof AcceptanceCoverageError) throw error;
    const message = error.code === "criterion_identity_entry_invalid" &&
      (entry === null || typeof entry !== "object" || Array.isArray(entry))
      ? `${name} must be an identity object` : error.message;
    throw new AcceptanceCoverageError(
      "acceptance_coverage_input_invalid", message, { name, cause: error.code }
    );
  }
}

function nodeIdentity(entry, index) {
  exactKeys(entry, ["id", "mandatory"], `contractNodes[${index}]`);
  if (Object.hasOwn(entry, "mandatory") && typeof entry.mandatory !== "boolean") {
    throw new AcceptanceCoverageError(
      "acceptance_coverage_input_invalid",
      `contractNodes[${index}].mandatory must be a boolean`, { index }
    );
  }
  return requiredString(entry.id, `contractNodes[${index}].id`);
}

function mappingCriterion(mapping, index) {
  exactKeys(mapping, ["criterionIdentity", "nodeIds", "residue", "infeasible"], `mappings[${index}]`);
  return requiredString(
    mapping?.criterionIdentity,
    `mappings[${index}].criterionIdentity`
  );
}

function mappingFlag(mapping, name, index) {
  if (Object.hasOwn(mapping, name) && typeof mapping[name] !== "boolean") {
    throw new AcceptanceCoverageError(
      "acceptance_coverage_input_invalid",
      `mappings[${index}].${name} must be a boolean`, { index, name }
    );
  }
}

function mappingNodes(mapping, index) {
  const values = mapping?.nodeIds ?? [];
  return requiredArray(values, `mappings[${index}].nodeIds`).map((value, nodeIndex) =>
    requiredString(value, `mappings[${index}].nodeIds[${nodeIndex}]`)
  );
}

function mappingKind(mapping) {
  if (mapping?.infeasible === true) return "infeasible";
  if (mapping?.residue === true) {
    return "retained_residue";
  }
  return null;
}

function clone(value) {
  return structuredClone(value);
}

function exactStringPopulation(value, name) {
  const values = requiredArray(value, name).map((entry, index) =>
    requiredString(entry, `${name}[${index}]`)
  );
  if (new Set(values).size !== values.length) throw new AcceptanceCoverageError(
    "acceptance_coverage_input_invalid", `${name} must contain unique strings`,
    { name }
  );
  return values;
}

function obligationOutcome(row, position, selectedPackIds, staleObligationIds,
  guaranteeSelectorIndex) {
  let outcome;
  let resolution = null;
  if (staleObligationIds.has(row.obligation_id)) outcome = "stale";
  else if (row.proof.kind === "pack_mapping" &&
      !selectedPackIds.has(row.proof.pack_id)) outcome = "unmapped";
  else if (row.proof.kind === "explicit_gap") outcome = "explicit_gap";
  else {
    try {
      resolution = resolveObligationGuaranteeSelector({
        index: guaranteeSelectorIndex,
        mapping: row.proof,
        nodeIds: row.controlled_contract_node_ids
      });
    } catch (error) {
      throw new AcceptanceCoverageError(
        "acceptance_coverage_guarantee_selector_invalid",
        error.message,
        { obligation_id: row.obligation_id, cause: error.code }
      );
    }
    outcome = resolution.status === "compatible"
      ? "mechanically_proven"
      : resolution.status === "incompatible"
        ? "guarantee_incompatible"
        : resolution.status;
  }
  return Object.freeze({
    obligation_id: row.obligation_id,
    position,
    source_locator: row.source_locator,
    controlled_contract_node_ids: Object.freeze([
      ...row.controlled_contract_node_ids
    ]),
    mechanism: Object.freeze(clone(row.mechanism)),
    proof: deepFreeze(clone(row.proof)),
    outcome,
    reason: resolution?.reason ??
      (outcome === "explicit_gap" ? row.proof.gap_kind : null)
  });
}

function evaluateObligationCoverage(input) {
  exactKeys(input, [
    "obligationCoverage", "guaranteeSelectorIndex", "selectedPackIds",
    "staleObligationIds"
  ], "input");
  const validation = validateObligationCoverageCarrier(input.obligationCoverage);
  if (!validation.valid) throw new AcceptanceCoverageError(
    "acceptance_coverage_obligation_carrier_invalid",
    "obligationCoverage must be a valid canonical obligation carrier",
    { schema_errors: validation.schema_errors, diagnostics: validation.diagnostics }
  );
  const selectedPackIds = new Set(exactStringPopulation(
    input.selectedPackIds, "selectedPackIds"
  ));
  const staleObligationIds = new Set(exactStringPopulation(
    input.staleObligationIds ?? [], "staleObligationIds"
  ));
  const knownObligationIds = new Set(validation.carrier.obligations.map(
    ({ obligation_id: id }) => id
  ));
  const unknownStale = [...staleObligationIds].filter(
    (id) => !knownObligationIds.has(id)
  );
  if (unknownStale.length > 0) throw new AcceptanceCoverageError(
    "acceptance_coverage_stale_obligation_unknown",
    "staleObligationIds must identify admitted obligations",
    { obligation_ids: unknownStale }
  );
  const mappedPackIds = new Set(validation.carrier.obligations
    .filter(({ proof }) => proof.kind === "pack_mapping")
    .map(({ proof }) => proof.pack_id));
  const orphanSelectedPackIds = [...selectedPackIds]
    .filter((id) => !mappedPackIds.has(id)).sort();
  const diagnostics = orphanSelectedPackIds.map((packId) => Object.freeze({
    code: "acceptance_coverage_orphan_selected_pack",
    severity: "blocking",
    pack_id: packId,
    message: "Selected proof pack is not mapped by any admitted obligation."
  }));
  const obligationOutcomes = validation.carrier.obligations
    .map((row, position) => obligationOutcome(
      row, position, selectedPackIds, staleObligationIds,
      input.guaranteeSelectorIndex
    ))
    .sort((left, right) => left.obligation_id < right.obligation_id ? -1
      : left.obligation_id > right.obligation_id ? 1 : left.position - right.position);
  const complete = diagnostics.length === 0 && obligationOutcomes.every(
    ({ outcome }) => outcome === "mechanically_proven"
  );
  return Object.freeze({
    mode: "obligation_coverage",
    schema_version: validation.carrier.schema_version,
    wk_id: validation.carrier.wk_id,
    focus: validation.carrier.focus ?? null,
    obligation_outcomes: Object.freeze(obligationOutcomes),
    outcome_precedence: Object.freeze([...OBLIGATION_COVERAGE_OUTCOMES]),
    diagnostics: Object.freeze(diagnostics),
    orphan_selected_pack_ids: Object.freeze(orphanSelectedPackIds),
    warnings: Object.freeze(complete ? [] : [clone(GAP_WARNING)]),
    complete
  });
}

function evaluateAcceptanceCoverage(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AcceptanceCoverageError("acceptance_coverage_input_invalid", "input must be an object");
  if (Object.hasOwn(input, "obligationCoverage")) {
    return evaluateObligationCoverage(input);
  }
  exactKeys(input, ["criteria", "mappings", "contractNodes", "selectedPackNodeIds", "priorCriterionIdentities"], "input");
  const identitySet = input.criteria;
  if (!identitySet || typeof identitySet !== "object" || !Array.isArray(identitySet.identities)) throw new AcceptanceCoverageError("acceptance_coverage_input_invalid", "criteria must be an identity-set object");
  const identities = identitySet.identities.map(criterionIdentity);
  const identityOrder = new Set(identities);
  const currentDuplicates = new Set(identities.filter((id, i) => identities.indexOf(id) !== i));
  const mappings = requiredArray(input.mappings, "mappings");
  const contractNodeEntries = requiredArray(input.contractNodes, "contractNodes").map((node, index) => [nodeIdentity(node, index), node]);
  const contractNodeIds = new Set();
  for (const [id] of contractNodeEntries) {
    if (contractNodeIds.has(id)) {
      throw new AcceptanceCoverageError(
        "acceptance_coverage_duplicate_contract_node_identity",
        `contractNodes contains duplicate id: ${id}`, { id }
      );
    }
    contractNodeIds.add(id);
  }
  const contractNodes = new Map(contractNodeEntries);
  const selectedPackNodeIds = new Set(requiredArray(input.selectedPackNodeIds, "selectedPackNodeIds").map((id, index) => requiredString(id, `selectedPackNodeIds[${index}]`)));
  const staleComparison = input.priorCriterionIdentities === undefined ? null : compareCriterionIdentitySets(input.priorCriterionIdentities, identitySet);
  const stale = staleComparison?.stale === true;
  const mappingOutcomes = mappings.map((mapping, index) => {
    const criterion = mappingCriterion(mapping, index);
    mappingFlag(mapping, "residue", index);
    mappingFlag(mapping, "infeasible", index);
    const nodeIds = mappingNodes(mapping, index);
    let state;
    if (!identityOrder.has(criterion)) state = "unknown";
    else if (mappingKind(mapping) === "infeasible") state = "infeasible";
    else if (mappingKind(mapping) === "retained_residue") state = "retained_residue";
    else if (nodeIds.length === 0) state = "uncovered";
    else if (new Set(nodeIds).size !== nodeIds.length) state = "duplicate";
    else if (nodeIds.some((id) => !contractNodes.has(id))) state = "unknown";
    else if (nodeIds.some((id) => !selectedPackNodeIds.has(id))) state = "outside_pack";
    else state = "covered";
    return Object.freeze({ index, criterion_identity: criterion, node_ids: Object.freeze([...nodeIds]), state });
  });
  const byCriterion = new Map();
  for (const outcome of mappingOutcomes) {
    if (!byCriterion.has(outcome.criterion_identity)) byCriterion.set(outcome.criterion_identity, []);
    byCriterion.get(outcome.criterion_identity).push(outcome);
  }
  const results = identities.map((criterion, position) => {
    const outcomes = byCriterion.get(criterion) ?? [];
    const state = stale ? "stale" : currentDuplicates.has(criterion) ? "duplicate" : outcomes.length === 0 ? "uncovered" : outcomes
      .map(({ state: outcomeState }) => outcomeState)
      .sort((left, right) => RESULT_PRECEDENCE.indexOf(left) - RESULT_PRECEDENCE.indexOf(right))[0];
    return Object.freeze({ criterion_identity: criterion, position, state,
      mapping_indexes: Object.freeze(outcomes.map(({ index }) => index)) });
  });
  const criterionDispositions = new Map(results.map(
    ({ criterion_identity: identity, state }) => [identity, state]
  ));
  const mappedNodeIds = new Set(mappingOutcomes.filter((outcome) =>
    outcome.state === "covered" &&
    !["stale", "duplicate"].includes(
      criterionDispositions.get(outcome.criterion_identity)
    )
  ).flatMap(({ node_ids: nodeIds }) => nodeIds));
  const unmappedMandatoryNodeIds = [...contractNodes.entries()]
    .filter(([id, node]) => node.mandatory === true && !mappedNodeIds.has(id)).map(([id]) => id);
  const unknownMappings = mappingOutcomes.filter(({ criterion_identity }) => !identityOrder.has(criterion_identity));
  const hasGap = results.some(({ state }) => state !== "covered") ||
    unknownMappings.length > 0 || unmappedMandatoryNodeIds.length > 0;
  return Object.freeze({
    states: Object.freeze(results), mapping_outcomes: Object.freeze(mappingOutcomes),
    unknown_mappings: Object.freeze(unknownMappings), unmapped_mandatory_node_ids: Object.freeze(unmappedMandatoryNodeIds),
    stale, identity_comparison: staleComparison ? clone(staleComparison) : null,
    merge_precedence: Object.freeze([...RESULT_PRECEDENCE]), warnings: Object.freeze(hasGap ? [clone(GAP_WARNING)] : []), complete: !hasGap
  });
}
function isAcceptanceCoverageComplete(result) {
  if (result?.mode === "obligation_coverage") return result.complete === true &&
    Array.isArray(result.diagnostics) && result.diagnostics.length === 0 &&
    Array.isArray(result.obligation_outcomes) &&
    result.obligation_outcomes.every(
      ({ outcome }) => outcome === "mechanically_proven"
    );
  return result?.complete === true && Array.isArray(result.warnings) &&
    result.warnings.length === 0 &&
    Array.isArray(result.unmapped_mandatory_node_ids) &&
    result.unmapped_mandatory_node_ids.length === 0;
}

export {
  ACCEPTANCE_COVERAGE_STATES,
  AcceptanceCoverageError,
  GAP_WARNING,
  OBLIGATION_COVERAGE_OUTCOMES,
  RESULT_PRECEDENCE,
  evaluateAcceptanceCoverage,
  isAcceptanceCoverageComplete
};
