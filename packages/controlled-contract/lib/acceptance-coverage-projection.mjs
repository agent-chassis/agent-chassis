import {
  canonicalDigest,
  deepFreeze,
  unsupportedObjectKeys
} from "./deterministic-projection-primitives.mjs";
import {
  ACCEPTANCE_COVERAGE_STATES,
  OBLIGATION_COVERAGE_OUTCOMES,
  RESULT_PRECEDENCE
} from "./acceptance-coverage.mjs";
import { normalizeCriterionIdentityEntry } from "./acceptance-coverage-identity.mjs";

const ACCEPTANCE_COVERAGE_AXES = Object.freeze([
  "authored_contract_coverage",
  "structural_verification",
  "selected_pack_guarantee_coverage",
  "implementation_ownership",
  "verification_ownership",
  "scope_feasibility"
]);
const DEFAULT_ACCEPTANCE_COVERAGE_PAGE_SIZE = 25;
const MAX_ACCEPTANCE_COVERAGE_PAGE_SIZE = 100;
const CURSOR_VERSION = "acceptance-coverage-projection-cursor.v1";
const STATE_SET = new Set(ACCEPTANCE_COVERAGE_STATES);

class AcceptanceCoverageProjectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AcceptanceCoverageProjectionError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details = {}) {
  throw new AcceptanceCoverageProjectionError(code, message, details);
}

function closedKeys(value, allowed, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("acceptance_coverage_projection_input_invalid", `${name} must be an object`);
  }
  const unsupported = unsupportedObjectKeys(value, allowed);
  if (unsupported.length > 0) {
    const [key] = unsupported;
    fail(
    "acceptance_coverage_projection_input_invalid",
    `${name}.${key} is not supported`, { name, key }
    );
  }
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) fail(
    "acceptance_coverage_projection_input_invalid",
    `${name} must be a non-empty string`, { name }
  );
  return value;
}

function requiredState(value, name) {
  if (!STATE_SET.has(value)) fail(
    "acceptance_coverage_projection_state_invalid",
    `${name} must use the canonical acceptance-coverage state vocabulary`,
    { name, value }
  );
  return value;
}

function normalizeIdentitySet(identitySet) {
  if (!identitySet || typeof identitySet !== "object" ||
      !Array.isArray(identitySet.identities)) fail(
    "acceptance_coverage_projection_input_invalid",
    "criterionIdentities must be an identity-set object"
  );
  const identities = identitySet.identities.map((entry, index) => {
    let normalized;
    try {
      normalized = normalizeCriterionIdentityEntry(entry,
        `criterionIdentities.identities[${index}]`);
    } catch (error) {
      fail("acceptance_coverage_projection_input_invalid", error.message,
        { index, cause: error.code });
    }
    if (normalized.position !== index) fail(
      "acceptance_coverage_projection_identity_order_invalid",
      "criterion identity positions must exactly match their ordered array positions",
      { index, position: normalized.position }
    );
    return normalized;
  });
  return { identities, digest: canonicalDigest(identities) };
}

function normalizeEvaluation(evaluation, identities) {
  if (!evaluation || typeof evaluation !== "object" ||
      !Array.isArray(evaluation.states) ||
      !Array.isArray(evaluation.mapping_outcomes) ||
      !Array.isArray(evaluation.unmapped_mandatory_node_ids) ||
      !Array.isArray(evaluation.unknown_mappings) ||
      !Array.isArray(evaluation.warnings) ||
      typeof evaluation.complete !== "boolean") fail(
    "acceptance_coverage_projection_input_invalid",
    "evaluation must be an acceptance-coverage evaluator result"
  );
  if (evaluation.states.length !== identities.length) fail(
    "acceptance_coverage_projection_identity_mismatch",
    "evaluation states must cover every ordered criterion identity"
  );
  const stateEntries = evaluation.states.map((entry, index) => {
    const identity = identities[index];
    if (entry?.criterion_identity !== identity.identity ||
        entry?.position !== identity.position || !Array.isArray(entry.mapping_indexes)) fail(
      "acceptance_coverage_projection_identity_mismatch",
      "evaluation states must match the exact ordered criterion identities",
      { index }
    );
    return { entry, identity, index };
  });
  const mappingOutcomes = evaluation.mapping_outcomes.map((outcome, index) => {
    if (outcome?.index !== index || !Array.isArray(outcome.node_ids) ||
        typeof outcome.criterion_identity !== "string" ||
        typeof outcome.state !== "string") fail(
      "acceptance_coverage_projection_input_invalid",
      "evaluation mapping outcomes must retain their ordered indexes and node ids",
      { index }
    );
    return outcome;
  });
  const states = stateEntries.map(({ entry, identity, index }) => {
    if (!entry.mapping_indexes.every((mappingIndex) =>
      Number.isSafeInteger(mappingIndex) && mappingIndex >= 0 &&
      mappingIndex < mappingOutcomes.length &&
      mappingOutcomes[mappingIndex].criterion_identity === identity.identity)) fail(
      "acceptance_coverage_projection_mapping_reference_invalid",
      "criterion mapping indexes must reference ordered mapping outcomes for the criterion",
      { criterion_identity: identity.identity, index }
    );
    return { state: requiredState(entry.state, `evaluation.states[${index}].state`),
      mapping_indexes: [...entry.mapping_indexes] };
  });
  const unmappedMandatoryNodeIds = evaluation.unmapped_mandatory_node_ids.map(
    (nodeId, index) => requiredString(nodeId,
      `evaluation.unmapped_mandatory_node_ids[${index}]`)
  );
  const unknownMappings = evaluation.unknown_mappings.map((outcome, index) => {
    if (!outcome || !Number.isSafeInteger(outcome.index) ||
        !mappingOutcomes[outcome.index] ||
        mappingOutcomes[outcome.index].criterion_identity !== outcome.criterion_identity ||
        mappingOutcomes[outcome.index].state !== outcome.state) fail(
      "acceptance_coverage_projection_mapping_reference_invalid",
      "evaluation unknown mappings must reference evaluator mapping outcomes",
      { index }
    );
    return outcome;
  });
  return {
    states, mappingOutcomes, unknownMappings, unmappedMandatoryNodeIds,
    complete: evaluation.complete,
    warnings: evaluation.warnings
  };
}

function normalizeAxisFacts(axisFacts, identities) {
  if (!Array.isArray(axisFacts) || axisFacts.length !== identities.length) fail(
    "acceptance_coverage_projection_input_invalid",
    "criterionAxes must contain one ordered entry per criterion identity"
  );
  return axisFacts.map((facts, index) => {
    closedKeys(facts, [
      "criterionIdentity", "structuralVerification", "implementationOwnership",
      "verificationOwnership", "scopeFeasibility"
    ], `criterionAxes[${index}]`);
    if (facts.criterionIdentity !== identities[index].identity) fail(
      "acceptance_coverage_projection_identity_mismatch",
      "criterionAxes must match the exact ordered criterion identities", { index }
    );
    return {
      structural_verification: requiredState(facts.structuralVerification,
        `criterionAxes[${index}].structuralVerification`),
      implementation_ownership: requiredState(facts.implementationOwnership,
        `criterionAxes[${index}].implementationOwnership`),
      verification_ownership: requiredState(facts.verificationOwnership,
        `criterionAxes[${index}].verificationOwnership`),
      scope_feasibility: requiredState(facts.scopeFeasibility,
        `criterionAxes[${index}].scopeFeasibility`)
    };
  });
}

function authoredState(disposition) {
  return disposition.state === "outside_pack" ? "covered" : disposition.state;
}

function nodeIdsFor(state, mappingOutcomes) {
  const nodeIds = [];
  const seen = new Set();
  for (const index of state.mapping_indexes) {
    const outcome = mappingOutcomes[index];
    if (!outcome || outcome.criterion_identity !== state.criterion_identity) fail(
      "acceptance_coverage_projection_mapping_reference_invalid",
      "criterion mapping indexes must resolve to their exact mapping outcomes",
      { criterion_identity: state.criterion_identity, mapping_index: index }
    );
    for (const nodeId of outcome.node_ids) if (!seen.has(nodeId)) {
      seen.add(nodeId);
      nodeIds.push(nodeId);
    }
  }
  return nodeIds;
}

function criterionDetails(evaluation, normalized, facts) {
  return evaluation.states.map((state, index) => ({
    kind: "criterion",
    criterion_identity: state.criterion_identity,
    position: state.position,
    mapping_indexes: normalized.states[index].mapping_indexes,
    node_ids: nodeIdsFor(state, normalized.mappingOutcomes),
    axes: {
      authored_contract_coverage: authoredState(normalized.states[index]),
      structural_verification: facts[index].structural_verification,
      selected_pack_guarantee_coverage: normalized.states[index].state,
      implementation_ownership: facts[index].implementation_ownership,
      verification_ownership: facts[index].verification_ownership,
      scope_feasibility: facts[index].scope_feasibility
    }
  }));
}

function aggregateState(states) {
  return [...states].sort((left, right) =>
    RESULT_PRECEDENCE.indexOf(left) - RESULT_PRECEDENCE.indexOf(right))[0] ?? "unknown";
}

function axisSummary(details, mandatoryNodeCount, hasUnknownMappings) {
  return ACCEPTANCE_COVERAGE_AXES.map((axis) => {
    const states = details.map(({ axes }) => axes[axis]);
    if (axis === "authored_contract_coverage") {
      states.push(...Array.from({ length: mandatoryNodeCount }, () => "uncovered"));
      if (hasUnknownMappings) states.push("unknown");
    }
    const totals = Object.fromEntries(ACCEPTANCE_COVERAGE_STATES.map((state) =>
      [state, states.filter((candidate) => candidate === state).length]
    ));
    return { axis, state: aggregateState(states), totals_by_state: totals };
  });
}

function mappingCausation(detail, normalized, axis) {
  if (!["authored_contract_coverage", "selected_pack_guarantee_coverage"].includes(axis)) {
    return null;
  }
  const evaluatorState = normalized.states[detail.position].state;
  const indexes = detail.mapping_indexes;
  const causalIndexes = ["stale", "duplicate"].includes(evaluatorState)
    ? indexes
    : indexes.filter((index) => normalized.mappingOutcomes[index].state === evaluatorState);
  return {
    mapping_indexes: causalIndexes,
    mapping_outcome_paths: causalIndexes.map((index) =>
      ["evaluation", "mapping_outcomes", index])
  };
}

function gapItems(details, mandatoryNodeIds, normalized) {
  const groups = [
    details.filter(({ axes }) => axes.authored_contract_coverage !== "covered")
      .map((detail) => gapFromCriterion(detail, "authored_contract_coverage", normalized)),
    mandatoryNodeIds.map((nodeId) => ({
      kind: "mandatory_node", node_id: nodeId,
      axis: "authored_contract_coverage", state: "uncovered"
    })),
    details.filter(({ axes }) => axes.selected_pack_guarantee_coverage === "outside_pack")
      .map((detail) => gapFromCriterion(detail,
        "selected_pack_guarantee_coverage", normalized)),
    details.filter(({ axes }) => axes.verification_ownership !== "covered")
      .map((detail) => gapFromCriterion(detail, "verification_ownership", normalized)),
    details.filter(({ axes }) => axes.implementation_ownership !== "covered")
      .map((detail) => gapFromCriterion(detail, "implementation_ownership", normalized)),
    details.filter(({ axes }) => axes.scope_feasibility !== "covered")
      .map((detail) => gapFromCriterion(detail, "scope_feasibility", normalized)),
    details.filter(({ axes }) => axes.structural_verification !== "covered")
      .map((detail) => gapFromCriterion(detail, "structural_verification", normalized))
  ];
  return groups.flat();
}

function gapFromCriterion(detail, axis, normalized) {
  const causation = mappingCausation(detail, normalized, axis);
  const gap = {
    kind: "criterion", criterion_identity: detail.criterion_identity,
    mapping_identity: detail.criterion_identity,
    position: detail.position, node_ids: detail.node_ids,
    axis, state: detail.axes[axis]
  };
  if (causation) Object.assign(gap, causation);
  return gap;
}

function normalizeSelector(selector) {
  if (selector === undefined || selector === null) return null;
  closedKeys(selector, ["criterionIdentity", "nodeId"], "selector");
  const supplied = ["criterionIdentity", "nodeId"].filter((key) =>
    Object.hasOwn(selector, key));
  if (supplied.length !== 1) fail(
    "acceptance_coverage_projection_selector_invalid",
    "selector must contain exactly one of criterionIdentity or nodeId"
  );
  return supplied[0] === "criterionIdentity"
    ? { criterion_identity: requiredString(selector.criterionIdentity,
      "selector.criterionIdentity") }
    : { node_id: requiredString(selector.nodeId, "selector.nodeId") };
}

function selectedDetails(details, mandatoryNodeIds, selector) {
  if (selector === null) return null;
  if (Object.hasOwn(selector, "criterion_identity")) return details.filter(
    ({ criterion_identity: identity }) => identity === selector.criterion_identity
  );
  const selected = details.filter(({ node_ids: nodeIds }) =>
    nodeIds.includes(selector.node_id));
  if (mandatoryNodeIds.includes(selector.node_id)) selected.push({
    kind: "mandatory_node", node_id: selector.node_id,
    axes: Object.fromEntries(ACCEPTANCE_COVERAGE_AXES.map((axis) => [
      axis, axis === "authored_contract_coverage" ? "uncovered" : "unknown"
    ]))
  });
  return selected;
}

function parseCursor(cursor) {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const keys = [
      "version", "criterion_identity_digest", "projection_digest", "selector",
      "offset"
    ];
    closedKeys(value, keys, "cursor");
    if (!keys.every((key) => Object.hasOwn(value, key))) {
      throw new Error("cursor fields are incomplete");
    }
    if (value.version !== CURSOR_VERSION || !Number.isSafeInteger(value.offset) ||
        value.offset < 0) throw new Error("invalid cursor payload");
    if (value.selector !== null) {
      closedKeys(value.selector, ["criterion_identity", "node_id"],
        "cursor.selector");
      const selectorKeys = ["criterion_identity", "node_id"].filter((key) =>
        Object.hasOwn(value.selector, key));
      if (selectorKeys.length !== 1) throw new Error("cursor selector is invalid");
      requiredString(value.selector[selectorKeys[0]],
        `cursor.selector.${selectorKeys[0]}`);
    }
    return value;
  } catch (error) {
    fail("acceptance_coverage_projection_cursor_invalid",
      "cursor must be a valid acceptance-coverage continuation", {
        cause: error.message
      });
  }
}

function continuationCursor({ criterionDigest, projectionDigest, selector, offset }) {
  return Buffer.from(JSON.stringify({
    version: CURSOR_VERSION,
    criterion_identity_digest: criterionDigest,
    projection_digest: projectionDigest,
    selector,
    offset
  }), "utf8").toString("base64url");
}

function pageSizeOf(value) {
  const pageSize = value ?? DEFAULT_ACCEPTANCE_COVERAGE_PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 ||
      pageSize > MAX_ACCEPTANCE_COVERAGE_PAGE_SIZE) fail(
    "acceptance_coverage_projection_page_size_invalid",
    `pageSize must be an integer from 1 to ${MAX_ACCEPTANCE_COVERAGE_PAGE_SIZE}`
  );
  return pageSize;
}

function obligationSelector(value) {
  if (value === undefined || value === null) return null;
  const keys = ["obligationId", "sourceLocator", "controlledContractNodeId",
    "mechanism", "packId", "guaranteeSelector", "outcome"];
  closedKeys(value, keys, "selector");
  const supplied = keys.filter((key) => Object.hasOwn(value, key));
  if (supplied.length !== 1) fail("acceptance_coverage_projection_selector_invalid",
    "obligation selector must contain exactly one targeted field");
  const key = supplied[0];
  if (key === "mechanism") {
    closedKeys(value[key], ["owner", "kind", "selector"], "selector.mechanism");
    return { mechanism: Object.fromEntries(["owner", "kind", "selector"].map(
      (field) => [field, requiredString(value[key][field], `selector.mechanism.${field}`)]
    )) };
  }
  if (key === "guaranteeSelector") {
    closedKeys(value[key], ["kind", "componentId"], "selector.guaranteeSelector");
    return { guarantee_selector: {
      kind: requiredString(value[key].kind, "selector.guaranteeSelector.kind"),
      component_id: requiredString(value[key].componentId,
        "selector.guaranteeSelector.componentId")
    } };
  }
  const names = { obligationId: "obligation_id", sourceLocator: "source_locator",
    controlledContractNodeId: "controlled_contract_node_id", packId: "pack_id",
    outcome: "outcome" };
  return { [names[key]]: requiredString(value[key], `selector.${key}`) };
}

function matchesObligation(row, selector) {
  if (selector === null) return row.outcome !== "mechanically_proven";
  if (selector.obligation_id) return row.obligation_id === selector.obligation_id;
  if (selector.source_locator) return row.source_locator === selector.source_locator;
  if (selector.controlled_contract_node_id) return row.controlled_contract_node_ids
    .includes(selector.controlled_contract_node_id);
  if (selector.pack_id) return row.proof.kind === "pack_mapping" &&
    row.proof.pack_id === selector.pack_id;
  if (selector.outcome) return row.outcome === selector.outcome;
  if (selector.mechanism) return ["owner", "kind", "selector"].every(
    (key) => row.mechanism[key] === selector.mechanism[key]
  );
  return row.proof.kind === "pack_mapping" &&
    row.proof.selector.kind === selector.guarantee_selector.kind &&
    row.proof.selector.component_id === selector.guarantee_selector.component_id;
}

function projectObligationCoverage(input) {
  closedKeys(input, ["evaluation", "selector"], "input");
  const evaluation = input.evaluation;
  if (!evaluation || !Array.isArray(evaluation.obligation_outcomes) ||
      !Array.isArray(evaluation.diagnostics) || typeof evaluation.complete !== "boolean") {
    fail("acceptance_coverage_projection_input_invalid",
      "evaluation must be an obligation-aware acceptance result");
  }
  const ids = new Set();
  const rows = evaluation.obligation_outcomes.map((row, index) => {
    if (!row || typeof row.obligation_id !== "string" || ids.has(row.obligation_id) ||
        !OBLIGATION_COVERAGE_OUTCOMES.includes(row.outcome) ||
        !Array.isArray(row.controlled_contract_node_ids) || !row.mechanism || !row.proof) {
      fail("acceptance_coverage_projection_input_invalid",
        "obligation outcomes must be an exact unique admitted-row population", { index });
    }
    ids.add(row.obligation_id);
    return row;
  }).sort((left, right) => left.obligation_id < right.obligation_id ? -1
    : left.obligation_id > right.obligation_id ? 1 : 0);
  const selector = obligationSelector(input.selector);
  if (selector?.outcome && !OBLIGATION_COVERAGE_OUTCOMES.includes(selector.outcome)) {
    fail("acceptance_coverage_projection_selector_invalid",
      "selector.outcome must use the closed obligation outcome vocabulary");
  }
  const items = rows.filter((row) => matchesObligation(row, selector));
  const outcomeCounts = Object.fromEntries(OBLIGATION_COVERAGE_OUTCOMES.map(
    (outcome) => [outcome, rows.filter((row) => row.outcome === outcome).length]
  ));
  return deepFreeze({
    version: "acceptance-obligation-coverage-projection.v1",
    mode: "obligation_coverage",
    wk_id: evaluation.wk_id,
    focus: evaluation.focus,
    complete: evaluation.complete,
    diagnostics: evaluation.diagnostics,
    selector,
    totals: {
      total: rows.length,
      outcomes: outcomeCounts,
      invalid_mapping: outcomeCounts.guarantee_incompatible
    },
    items
  });
}

function projectAcceptanceCoverage(input) {
  if (input?.evaluation?.mode === "obligation_coverage") {
    return projectObligationCoverage(input);
  }
  closedKeys(input, [
    "evaluation", "criterionIdentities", "criterionAxes", "selector", "cursor",
    "pageSize"
  ], "input");
  const identitySet = normalizeIdentitySet(input.criterionIdentities);
  const normalized = normalizeEvaluation(input.evaluation, identitySet.identities);
  const facts = normalizeAxisFacts(input.criterionAxes, identitySet.identities);
  const details = criterionDetails(input.evaluation, normalized, facts);
  const hasUnknownMappings = normalized.unknownMappings.length > 0;
  const gaps = gapItems(details, normalized.unmappedMandatoryNodeIds, normalized).concat(
    normalized.unknownMappings.map((outcome) => ({
      kind: "mapping", mapping_identity: outcome.criterion_identity,
      mapping_index: outcome.index, axis: "authored_contract_coverage",
      state: outcome.state,
      mapping_outcome_path: ["evaluation", "mapping_outcomes", outcome.index]
    }))
  );
  const requestedSelector = normalizeSelector(input.selector);
  const projectionDigest = canonicalDigest({
    criterion_identity_digest: identitySet.digest,
    details,
    complete: normalized.complete,
    warnings: normalized.warnings,
    unknown_mappings: normalized.unknownMappings,
    unmapped_mandatory_node_ids: normalized.unmappedMandatoryNodeIds
  });
  let selector = requestedSelector;
  let offset = 0;
  if (input.cursor !== undefined) {
    const cursor = parseCursor(requiredString(input.cursor, "cursor"));
    if (cursor.criterion_identity_digest !== identitySet.digest) fail(
      "acceptance_coverage_projection_cursor_stale",
      "cursor criterion identities no longer match the current ordered identities"
    );
    if (cursor.projection_digest !== projectionDigest) fail(
      "acceptance_coverage_projection_cursor_stale",
      "cursor projection facts no longer match the current projection"
    );
    if (requestedSelector !== null &&
        canonicalDigest(requestedSelector) !== canonicalDigest(cursor.selector)) fail(
      "acceptance_coverage_projection_cursor_selector_mismatch",
      "cursor is bound to a different criterion or node selector"
    );
    selector = cursor.selector;
    offset = cursor.offset;
  }
  const population = selectedDetails(
    details, normalized.unmappedMandatoryNodeIds, selector
  ) ?? gaps;
  if (offset > population.length) fail(
    "acceptance_coverage_projection_cursor_invalid",
    "cursor offset is outside the selected population"
  );
  const pageSize = pageSizeOf(input.pageSize);
  const items = population.slice(offset, offset + pageSize);
  const nextOffset = offset + items.length;
  const continuation = nextOffset < population.length
    ? continuationCursor({
      criterionDigest: identitySet.digest, projectionDigest, selector,
      offset: nextOffset
    })
    : null;
  const nodeIds = new Set(details.flatMap(({ node_ids: ids }) => ids));
  normalized.unmappedMandatoryNodeIds.forEach((id) => nodeIds.add(id));
  const fullyCovered = hasUnknownMappings ? 0 : details.filter(({ axes }) =>
    Object.values(axes).every((state) => state === "covered")).length;
  return deepFreeze({
    version: "acceptance-coverage-projection.v1",
    criterion_identity_digest: identitySet.digest,
    projection_digest: projectionDigest,
    claim: details.length === 0 ? "absent" : "present",
    complete: normalized.complete,
    warnings: normalized.warnings,
    unknown_mappings: normalized.unknownMappings,
    unmapped_mandatory_node_ids: normalized.unmappedMandatoryNodeIds,
    axes: axisSummary(details, normalized.unmappedMandatoryNodeIds.length,
      hasUnknownMappings),
    selector,
    totals: {
      criteria: details.length,
      nodes: nodeIds.size,
      gaps: gaps.length,
      fully_covered_criteria: fullyCovered,
      selected_items: population.length
    },
    page: {
      offset,
      returned: items.length,
      total: population.length,
      items,
      continuation
    },
    covered_detail: {
      total: fullyCovered,
      retrieval: {
        function: "projectAcceptanceCoverage",
        selectors: ["criterionIdentity", "nodeId"],
        continuation: "cursor"
      }
    }
  });
}

export {
  ACCEPTANCE_COVERAGE_AXES,
  AcceptanceCoverageProjectionError,
  DEFAULT_ACCEPTANCE_COVERAGE_PAGE_SIZE,
  MAX_ACCEPTANCE_COVERAGE_PAGE_SIZE,
  projectAcceptanceCoverage
};
