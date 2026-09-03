import {
  ExactBindingError,
  canonicalDigest,
  canonicalJsonBytes,
  compareCodeUnits,
  deepFreeze,
  parseCanonicalDocument,
  sha256,
  sortedUnique
} from "./deterministic-projection-primitives.mjs";
import { validateProjectedContractWithStableCore } from
  "./projected-contract-validation.mjs";
import { GRAPH_VERSION } from "./projected-contract-graph.mjs";

const TRANSFORMER_ID = "supplementary-isolation-attempt-record.v1";
const CONTRACT_VERSION = "controlled-acceptance-contract.experimental.v0.2";
const VOCABULARY_VERSION = "cv.experimental.0.34";
const INPUT_VERSIONS = Object.freeze({
  attempt: "controlled-contract.supplementary-isolation-attempt.v1",
  settlement: "controlled-contract.supplementary-isolation-core-settlement.v1",
  failure: "controlled-contract.supplementary-isolation-failure.v1",
  final: "controlled-contract.supplementary-isolation-final-result.v1"
});
const REFERENCE_ID = /^ref-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ROLE_TYPES = new Set([
  "cc:artifact", "cc:entity", "cc:event", "cc:evidence", "cc:operation",
  "cc:process", "cc:resource", "cc:state"
]);

const POPULATION_IDS = Object.freeze({
  "attempt-occurrences": "ref-sfi-attempt-occurrences-population",
  "core-members": "ref-sfi-core-members-population",
  "core-settlements": "ref-sfi-core-settlements-population",
  "core-valid-states": "ref-sfi-core-valid-states-population",
  "declared-supplementary-components": "ref-sfi-declared-components-population",
  "disclosed-omissions": "ref-sfi-disclosed-omissions-population",
  "disclosed-reasons": "ref-sfi-disclosed-reasons-population",
  "failure-reasons": "ref-sfi-failure-reasons-population",
  "final-core-members": "ref-sfi-final-core-members-population",
  "final-result-events": "ref-sfi-final-result-events-population",
  "final-result-members": "ref-sfi-final-result-members-population",
  "supplementary-failures": "ref-sfi-supplementary-failures-population",
  "supplementary-results": "ref-sfi-supplementary-results-population",
  "unavailable-states": "ref-sfi-unavailable-states-population"
});

function fail(code, message, details = {}) {
  throw new ExactBindingError(code, message, details);
}

function exactKeys(value, required) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key));
}

function text(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") ||
      value !== value.normalize("NFC")) fail(
    "supplementary_isolation_text_invalid",
    "captured text must be nonempty canonical NFC without NUL", { field }
  );
  return value;
}

function integer(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail(
    "supplementary_isolation_integer_invalid",
    "captured counts and sequence values must be nonnegative safe integers", { field }
  );
  return value;
}

function identity(value, field) {
  const shapes = {
    code_symbol: Object.hasOwn(value ?? {}, "scip_symbol")
      ? ["kind", "path", "repository", "scip_symbol", "symbol"]
      : ["kind", "path", "repository", "symbol"],
    durable_id: ["domain", "kind", "value"],
    profile_term: ["kind", "term"],
    repository_path: ["kind", "path", "repository"],
    runtime_parameter: ["kind", "name"]
  };
  const keys = shapes[value?.kind];
  if (!keys || !exactKeys(value, keys)) fail(
    "supplementary_isolation_identity_invalid",
    "captured grounded identity has an unknown or open shape", { field }
  );
  for (const key of keys.filter((key) => key !== "kind")) text(value[key], `${field}.${key}`);
  return structuredClone(value);
}

function role(value, field, allowedTypes = ROLE_TYPES) {
  if (!exactKeys(value, ["grounded_identity", "reference_id", "type_term"]) ||
      !REFERENCE_ID.test(value.reference_id ?? "") || !allowedTypes.has(value.type_term)) fail(
    "supplementary_isolation_role_invalid",
    "captured role has an invalid closed shape or type", { field }
  );
  return {
    grounded_identity: identity(value.grounded_identity, `${field}.grounded_identity`),
    reference_id: value.reference_id,
    type_term: value.type_term
  };
}

function roles(values, field, allowedTypes = ROLE_TYPES) {
  if (!Array.isArray(values)) fail(
    "supplementary_isolation_population_invalid", "captured population must be an array", { field }
  );
  const parsed = values.map((value, index) => role(value, `${field}[${index}]`, allowedTypes));
  const ids = parsed.map(({ reference_id: id }) => id).sort(compareCodeUnits);
  if (!sortedUnique(ids)) fail(
    "supplementary_isolation_population_invalid",
    "captured population identities must be unique", { field }
  );
  return parsed.sort((left, right) => compareCodeUnits(left.reference_id, right.reference_id));
}

function sameRole(left, right) {
  return left.reference_id === right.reference_id && left.type_term === right.type_term &&
    canonicalDigest(left.grounded_identity) === canonicalDigest(right.grounded_identity);
}

function requireSame(left, right, field) {
  if (!sameRole(left, right)) fail(
    "supplementary_isolation_capture_splice",
    "captured sources do not identify the same exact attempt or operation", { field }
  );
}

function parseAttempt(value) {
  if (!exactKeys(value, [
    "attempt", "attempt_start_event", "core_computation", "core_valid_states",
    "declared_supplementary_components", "occurrences", "operation", "schema_version",
    "supplementary_computation", "unavailable_states"
  ]) || value.schema_version !== INPUT_VERSIONS.attempt || !Array.isArray(value.occurrences)) fail(
    "supplementary_isolation_attempt_invalid", "attempt capture has an invalid closed shape"
  );
  const occurrences = value.occurrences.map((entry, index) => {
    if (!exactKeys(entry, ["kind", "occurrence"]) ||
        !["core_settlement", "final_result", "supplementary_failure"].includes(entry.kind)) fail(
      "supplementary_isolation_occurrence_invalid",
      "attempt occurrence has an invalid closed kind", { index }
    );
    return { kind: entry.kind, occurrence: role(entry.occurrence, `occurrences[${index}]`) };
  });
  return {
    attempt: role(value.attempt, "attempt", new Set(["cc:process"])),
    attemptStart: role(value.attempt_start_event, "attempt_start_event", new Set(["cc:event"])),
    coreComputation: role(value.core_computation, "core_computation", new Set(["cc:process"])),
    validStates: roles(value.core_valid_states, "core_valid_states", new Set(["cc:state"])),
    declaredComponents: roles(value.declared_supplementary_components,
      "declared_supplementary_components", new Set(["cc:artifact", "cc:entity", "cc:resource"])),
    occurrences,
    operation: role(value.operation, "operation", new Set(["cc:operation"])),
    supplementaryComputation: role(value.supplementary_computation,
      "supplementary_computation", new Set(["cc:process"])),
    unavailableStates: roles(value.unavailable_states, "unavailable_states", new Set(["cc:state"]))
  };
}

function parseSettlement(value) {
  if (!exactKeys(value, ["attempt", "operation", "schema_version", "settlements"]) ||
      value.schema_version !== INPUT_VERSIONS.settlement || !Array.isArray(value.settlements)) fail(
    "supplementary_isolation_settlement_invalid", "settlement capture has an invalid closed shape"
  );
  return {
    attempt: role(value.attempt, "settlement.attempt", new Set(["cc:process"])),
    operation: role(value.operation, "settlement.operation", new Set(["cc:operation"])),
    settlements: value.settlements.map((entry, index) => {
      if (!exactKeys(entry, [
        "declared_member_count", "event", "members", "observation", "result", "sequence",
        "state", "value"
      ])) fail("supplementary_isolation_settlement_invalid",
        "settlement entry has an invalid closed shape", { index });
      return {
        declaredMemberCount: integer(entry.declared_member_count,
          `settlements[${index}].declared_member_count`),
        event: role(entry.event, `settlements[${index}].event`, new Set(["cc:event"])),
        members: roles(entry.members, `settlements[${index}].members`),
        observation: role(entry.observation, `settlements[${index}].observation`,
          new Set(["cc:evidence"])),
        result: role(entry.result, `settlements[${index}].result`, new Set(["cc:artifact"])),
        sequence: integer(entry.sequence, `settlements[${index}].sequence`),
        state: role(entry.state, `settlements[${index}].state`, new Set(["cc:state"])),
        value: role(entry.value, `settlements[${index}].value`, new Set(["cc:state"]))
      };
    })
  };
}

function parseFailure(value) {
  if (!exactKeys(value, ["attempt", "failures", "operation", "schema_version"]) ||
      value.schema_version !== INPUT_VERSIONS.failure || !Array.isArray(value.failures)) fail(
    "supplementary_isolation_failure_invalid", "failure capture has an invalid closed shape"
  );
  return {
    attempt: role(value.attempt, "failure.attempt", new Set(["cc:process"])),
    operation: role(value.operation, "failure.operation", new Set(["cc:operation"])),
    failures: value.failures.map((entry, index) => {
      if (!exactKeys(entry, [
        "component", "declared_reason_count", "declared_result_count", "event", "reason",
        "reasons", "sequence", "supplementary_results"
      ])) fail("supplementary_isolation_failure_invalid",
        "failure entry has an invalid closed shape", { index });
      return {
        component: role(entry.component, `failures[${index}].component`,
          new Set(["cc:artifact", "cc:entity", "cc:resource"])),
        declaredReasonCount: integer(entry.declared_reason_count,
          `failures[${index}].declared_reason_count`),
        declaredResultCount: integer(entry.declared_result_count,
          `failures[${index}].declared_result_count`),
        event: role(entry.event, `failures[${index}].event`, new Set(["cc:event"])),
        reason: role(entry.reason, `failures[${index}].reason`, new Set(["cc:state"])),
        reasons: roles(entry.reasons, `failures[${index}].reasons`, new Set(["cc:state"])),
        sequence: integer(entry.sequence, `failures[${index}].sequence`),
        supplementaryResults: roles(entry.supplementary_results,
          `failures[${index}].supplementary_results`, new Set(["cc:artifact"]))
      };
    })
  };
}

function parseFinal(value) {
  if (!exactKeys(value, ["attempt", "operation", "results", "schema_version"]) ||
      value.schema_version !== INPUT_VERSIONS.final || !Array.isArray(value.results)) fail(
    "supplementary_isolation_final_invalid", "final-result capture has an invalid closed shape"
  );
  return {
    attempt: role(value.attempt, "final.attempt", new Set(["cc:process"])),
    operation: role(value.operation, "final.operation", new Set(["cc:operation"])),
    results: value.results.map((entry, index) => {
      if (!exactKeys(entry, [
        "core_members", "core_portion", "core_state", "core_value", "declared_core_member_count",
        "declared_disclosed_reason_count", "declared_final_member_count", "disclosed_omissions",
        "disclosed_reasons", "event", "final_members", "observation", "present_components",
        "result", "sequence", "unavailable_state"
      ])) fail("supplementary_isolation_final_invalid",
        "final-result entry has an invalid closed shape", { index });
      return {
        coreMembers: roles(entry.core_members, `results[${index}].core_members`),
        corePortion: role(entry.core_portion, `results[${index}].core_portion`,
          new Set(["cc:artifact"])),
        coreState: role(entry.core_state, `results[${index}].core_state`, new Set(["cc:state"])),
        coreValue: role(entry.core_value, `results[${index}].core_value`, new Set(["cc:state"])),
        declaredCoreMemberCount: integer(entry.declared_core_member_count,
          `results[${index}].declared_core_member_count`),
        declaredDisclosedReasonCount: integer(entry.declared_disclosed_reason_count,
          `results[${index}].declared_disclosed_reason_count`),
        declaredFinalMemberCount: integer(entry.declared_final_member_count,
          `results[${index}].declared_final_member_count`),
        disclosedOmissions: roles(entry.disclosed_omissions,
          `results[${index}].disclosed_omissions`, new Set(["cc:artifact", "cc:entity", "cc:resource"])),
        disclosedReasons: roles(entry.disclosed_reasons,
          `results[${index}].disclosed_reasons`, new Set(["cc:state"])),
        event: role(entry.event, `results[${index}].event`, new Set(["cc:event"])),
        finalMembers: roles(entry.final_members, `results[${index}].final_members`),
        observation: role(entry.observation, `results[${index}].observation`,
          new Set(["cc:evidence"])),
        presentComponents: roles(entry.present_components,
          `results[${index}].present_components`, new Set(["cc:artifact", "cc:entity", "cc:resource"])),
        result: role(entry.result, `results[${index}].result`, new Set(["cc:artifact"])),
        sequence: integer(entry.sequence, `results[${index}].sequence`),
        unavailableState: role(entry.unavailable_state, `results[${index}].unavailable_state`,
          new Set(["cc:state"]))
      };
    })
  };
}

function parseSources(sourceBytes) {
  const parsed = sourceBytes.map((bytes, index) =>
    parseCanonicalDocument(bytes, `supplementary-isolation source[${index}]`));
  const byVersion = new Map(parsed.map((value) => [value?.schema_version, value]));
  if (byVersion.size !== 4 || Object.values(INPUT_VERSIONS).some((version) => !byVersion.has(version))) {
    fail("projection_source_set_invalid",
      "supplementary isolation requires one source of each registered capture kind");
  }
  return [
    parseAttempt(byVersion.get(INPUT_VERSIONS.attempt)),
    parseSettlement(byVersion.get(INPUT_VERSIONS.settlement)),
    parseFailure(byVersion.get(INPUT_VERSIONS.failure)),
    parseFinal(byVersion.get(INPUT_VERSIONS.final))
  ];
}

function capturedReference(captured) {
  return {
    reference_id: captured.reference_id,
    type_term: captured.type_term,
    identity: structuredClone(captured.grounded_identity)
  };
}

function fixedReference(referenceId, typeTerm, term) {
  return { reference_id: referenceId, type_term: typeTerm,
    identity: { kind: "profile_term", term } };
}

function ref(referenceId) { return { kind: "reference", reference_id: referenceId }; }
function num(value) { return { kind: "number", value }; }
function bool(value) { return { kind: "boolean", value }; }
function scope(attemptId) { return { mode: "during", operand_reference_ids: [attemptId] }; }
function unconditional() { return { mode: "unconditional", operand_reference_ids: [] }; }

function stateFor(attempt) {
  return {
    attempt,
    claims: [], propositions: [], relations: [], collections: [],
    references: new Map()
  };
}

function addReference(state, reference) {
  const prior = state.references.get(reference.reference_id);
  if (prior && canonicalDigest(prior) !== canonicalDigest(reference)) fail(
    "supplementary_isolation_reference_collision",
    "captured reference id identifies different exact objects", { reference_id: reference.reference_id }
  );
  state.references.set(reference.reference_id, structuredClone(reference));
}

function addCaptured(state, captured) { addReference(state, capturedReference(captured)); }

function addClaim(state, id, subject, operator, applicability, operands, kind = "evidence") {
  const propositionId = `prop-sfi-${id}`;
  const claimId = `claim-sfi-${id}`;
  state.propositions.push({ proposition_id: propositionId, subject_reference_id: subject,
    operator, applicability_context: applicability, operands });
  state.claims.push({ claim_id: claimId, kind, modality: "MUST", proposition_id: propositionId });
  return claimId;
}

function addPopulation(state, name, memberIds, attemptScoped = true) {
  const populationId = POPULATION_IDS[name];
  addReference(state, fixedReference(populationId, "cc:population", `supplementary-isolation:${name}`));
  const ids = [...memberIds].sort(compareCodeUnits);
  if (ids.length > 0) addClaim(state, `${name}-members`, populationId, "reference:contains",
    attemptScoped ? scope(state.attempt.reference_id) : unconditional(), ids.map(ref));
  addClaim(state, `${name}-count`, populationId, "number:has_cardinality",
    attemptScoped ? scope(state.attempt.reference_id) : unconditional(), [num(ids.length)]);
  return populationId;
}

function roleSetEqual(left, right) {
  return left.length === right.length && left.every((entry, index) => sameRole(entry, right[index]));
}

function containsRole(values, selected) { return values.some((candidate) => sameRole(candidate, selected)); }

function reconcileOccurrences(attempt, kind, entries, field) {
  const declared = attempt.occurrences.filter((entry) => entry.kind === kind)
    .map(({ occurrence }) => occurrence);
  const captured = entries.map(({ event }) => event);
  const unique = (values) => new Set(values.map(({ reference_id: id }) => id)).size === values.length;
  if (!unique(declared) || !unique(captured) || declared.length !== captured.length ||
      declared.some((occurrence) => !captured.some((event) => sameRole(occurrence, event))) ||
      captured.some((event) => !declared.some((occurrence) => sameRole(occurrence, event)))) fail(
    "supplementary_isolation_occurrence_capture_mismatch",
    "attempt occurrence census and event-specific capture must identify the same exact occurrences",
    { field }
  );
}

function deriveContract([attempt, settlementCapture, failureCapture, finalCapture], sourceDigests) {
  for (const [label, capture] of [
    ["settlement", settlementCapture], ["failure", failureCapture], ["final", finalCapture]
  ]) {
    requireSame(attempt.attempt, capture.attempt, `${label}.attempt`);
    requireSame(attempt.operation, capture.operation, `${label}.operation`);
  }
  reconcileOccurrences(attempt, "core_settlement", settlementCapture.settlements, "settlements");
  reconcileOccurrences(attempt, "supplementary_failure", failureCapture.failures, "failures");
  reconcileOccurrences(attempt, "final_result", finalCapture.results, "results");
  const state = stateFor(attempt.attempt);
  const allCaptured = [
    attempt.operation, attempt.attempt, attempt.attemptStart, attempt.coreComputation,
    attempt.supplementaryComputation, ...attempt.validStates, ...attempt.declaredComponents,
    ...attempt.unavailableStates, ...attempt.occurrences.map(({ occurrence }) => occurrence),
    ...settlementCapture.settlements.flatMap((entry) => [
      entry.event, entry.observation, entry.result, entry.state, entry.value, ...entry.members
    ]),
    ...failureCapture.failures.flatMap((entry) => [
      entry.component, entry.event, entry.reason, ...entry.reasons, ...entry.supplementaryResults
    ]),
    ...finalCapture.results.flatMap((entry) => [
      entry.corePortion, entry.coreState, entry.coreValue, entry.event, entry.observation,
      entry.result, entry.unavailableState, ...entry.coreMembers, ...entry.disclosedOmissions,
      ...entry.disclosedReasons, ...entry.finalMembers, ...entry.presentComponents
    ])
  ];
  for (const captured of allCaptured) addCaptured(state, captured);
  const projection = fixedReference("ref-sfi-projection-result", "cc:artifact",
    `supplementary-isolation-projection:${sha256(canonicalJsonBytes(
      [...sourceDigests].sort(compareCodeUnits)
    ))}`);
  addReference(state, projection);
  for (const name of ["attempt-record", "core-settlement-record", "final-result-record",
    "supplementary-failure-record"]) addReference(state, fixedReference(
    `ref-sfi-${name}-capture`, "cc:artifact", `supplementary-isolation:${name}:capture`
  ));
  const verification = fixedReference("ref-sfi-verification", "cc:test",
    "supplementary-isolation-projection-verification");
  addReference(state, verification);
  const countSignals = Object.fromEntries(Object.keys({
    core_member_count: true,
    disclosed_reason_count: true,
    failure_reason_count: true,
    final_core_member_count: true,
    final_result_member_count: true,
    supplementary_result_count: true
  }).map((name) => {
    const reference = fixedReference(`ref-sfi-${name.replaceAll("_", "-")}-signal`,
      "cc:evidence", `supplementary-isolation:${name}:signal`);
    addReference(state, reference);
    return [name, reference];
  }));

  const settlementEvents = attempt.occurrences.filter(({ kind }) => kind === "core_settlement")
    .map(({ occurrence }) => occurrence.reference_id);
  const failureEvents = attempt.occurrences.filter(({ kind }) => kind === "supplementary_failure")
    .map(({ occurrence }) => occurrence.reference_id);
  const finalEvents = attempt.occurrences.filter(({ kind }) => kind === "final_result")
    .map(({ occurrence }) => occurrence.reference_id);
  const selectedSettlement = settlementCapture.settlements[0] ?? null;
  const selectedFailure = failureCapture.failures[0] ?? null;
  const selectedFinal = finalCapture.results[0] ?? null;
  const occurrenceIds = allCaptured.filter(({ reference_id: id }) => id !== attempt.operation.reference_id &&
    id !== attempt.attempt.reference_id && id !== attempt.coreComputation.reference_id &&
    id !== attempt.supplementaryComputation.reference_id).map(({ reference_id: id }) => id);
  const uniqueOccurrenceIds = [...new Set(occurrenceIds)].sort(compareCodeUnits);
  const populations = {
    "attempt-occurrences": uniqueOccurrenceIds,
    "core-members": selectedSettlement?.members.map(({ reference_id: id }) => id) ?? [],
    "core-settlements": settlementEvents,
    "core-valid-states": attempt.validStates.map(({ reference_id: id }) => id),
    "declared-supplementary-components": attempt.declaredComponents.map(({ reference_id: id }) => id),
    "disclosed-omissions": selectedFinal?.disclosedOmissions.map(({ reference_id: id }) => id) ?? [],
    "disclosed-reasons": selectedFinal?.disclosedReasons.map(({ reference_id: id }) => id) ?? [],
    "failure-reasons": selectedFailure?.reasons.map(({ reference_id: id }) => id) ?? [],
    "final-core-members": selectedFinal?.coreMembers.map(({ reference_id: id }) => id) ?? [],
    "final-result-events": finalEvents,
    "final-result-members": selectedFinal?.finalMembers.map(({ reference_id: id }) => id) ?? [],
    "supplementary-failures": failureEvents,
    "supplementary-results": selectedFailure?.supplementaryResults.map(({ reference_id: id }) => id) ?? [],
    "unavailable-states": attempt.unavailableStates.map(({ reference_id: id }) => id)
  };
  for (const [name, members] of Object.entries(populations)) addPopulation(
    state, name, members,
    !["core-valid-states", "declared-supplementary-components", "unavailable-states"].includes(name)
  );

  addClaim(state, "attempt-performs-operation", attempt.attempt.reference_id,
    "reference:performs", scope(attempt.attempt.reference_id), [ref(attempt.operation.reference_id)]);
  addClaim(state, "attempt-starts", attempt.attemptStart.reference_id,
    "reference:starts", scope(attempt.attempt.reference_id), [ref(attempt.attempt.reference_id)]);
  addClaim(state, "attempt-performs-computations", attempt.attempt.reference_id,
    "reference:performs", scope(attempt.attempt.reference_id), [
      ref(attempt.coreComputation.reference_id), ref(attempt.supplementaryComputation.reference_id)
    ].sort((left, right) => compareCodeUnits(left.reference_id, right.reference_id)));
  for (const occurrenceId of uniqueOccurrenceIds) addClaim(state,
    `occurrence-${occurrenceId.slice(4)}-inside-attempt`, occurrenceId, "reference:contained_in",
    scope(attempt.attempt.reference_id), [ref(attempt.attempt.reference_id)]);
  addClaim(state, "projection-exists", projection.reference_id, "boolean:exists", unconditional(), [bool(true)]);
  for (const name of ["attempt-record", "core-settlement-record", "final-result-record",
    "supplementary-failure-record"]) addClaim(state, `${name}-exists`,
    `ref-sfi-${name}-capture`, "boolean:exists", scope(attempt.attempt.reference_id), [bool(true)]);

  const capturedCounts = {
    core_member_count: selectedSettlement?.declaredMemberCount ?? 0,
    disclosed_reason_count: selectedFinal?.declaredDisclosedReasonCount ?? 0,
    failure_reason_count: selectedFailure?.declaredReasonCount ?? 0,
    final_core_member_count: selectedFinal?.declaredCoreMemberCount ?? 0,
    final_result_member_count: selectedFinal?.declaredFinalMemberCount ?? 0,
    supplementary_result_count: selectedFailure?.declaredResultCount ?? 0
  };
  for (const [name, value] of Object.entries(capturedCounts)) addClaim(state,
    `${name.replaceAll("_", "-")}-captured`, countSignals[name].reference_id,
    "number:equals", scope(attempt.attempt.reference_id), [num(value)]);

  if (selectedSettlement) {
    addClaim(state, "start-precedes-settlement", attempt.attemptStart.reference_id,
      "reference:precedes", scope(attempt.attempt.reference_id), [ref(selectedSettlement.event.reference_id)]);
    addClaim(state, "core-returns-result", attempt.coreComputation.reference_id,
      "reference:returns", scope(attempt.attempt.reference_id), [ref(selectedSettlement.result.reference_id)]);
    addClaim(state, "core-emits-settlement", attempt.coreComputation.reference_id,
      "reference:emits", scope(attempt.attempt.reference_id), [ref(selectedSettlement.event.reference_id)]);
    addClaim(state, "core-result-state", selectedSettlement.result.reference_id,
      "reference:has_state", scope(attempt.attempt.reference_id), [ref(selectedSettlement.state.reference_id)]);
    addClaim(state, "core-state-value", selectedSettlement.state.reference_id,
      "reference:resolves_to", scope(attempt.attempt.reference_id), [ref(selectedSettlement.value.reference_id)]);
    addClaim(state, "settlement-observation-records", selectedSettlement.observation.reference_id,
      "reference:records", scope(attempt.attempt.reference_id), [
        ref(selectedSettlement.result.reference_id), ref(selectedSettlement.state.reference_id),
        ref(POPULATION_IDS["core-members"])
      ].sort((left, right) => compareCodeUnits(left.reference_id, right.reference_id)));
    if (containsRole(attempt.validStates, selectedSettlement.value)) addClaim(state,
      "core-value-valid", selectedSettlement.value.reference_id, "reference:member_of",
      scope(attempt.attempt.reference_id), [ref(POPULATION_IDS["core-valid-states"])]);
  }

  if (selectedFailure) {
    addClaim(state, "supplementary-targets-component", attempt.supplementaryComputation.reference_id,
      "reference:targets", scope(attempt.attempt.reference_id), [ref(selectedFailure.component.reference_id)]);
    addClaim(state, "supplementary-emits-failure", attempt.supplementaryComputation.reference_id,
      "reference:emits", scope(attempt.attempt.reference_id), [ref(selectedFailure.event.reference_id)]);
    addClaim(state, "failure-has-reason", selectedFailure.event.reference_id,
      "reference:has_status", scope(attempt.attempt.reference_id), [ref(selectedFailure.reason.reference_id)]);
    if (containsRole(attempt.declaredComponents, selectedFailure.component)) addClaim(state,
      "component-declared", selectedFailure.component.reference_id, "reference:member_of",
      scope(attempt.attempt.reference_id), [ref(POPULATION_IDS["declared-supplementary-components"])]);
    if (containsRole(selectedFailure.reasons, selectedFailure.reason)) addClaim(state,
      "reason-closed", selectedFailure.reason.reference_id, "reference:member_of",
      scope(attempt.attempt.reference_id), [ref(POPULATION_IDS["failure-reasons"])]);
  }

  if (selectedFinal) {
    addClaim(state, "attempt-returns-final", attempt.attempt.reference_id,
      "reference:returns", scope(attempt.attempt.reference_id), [ref(selectedFinal.result.reference_id)]);
    addClaim(state, "final-event-emits", selectedFinal.event.reference_id,
      "reference:emits", scope(attempt.attempt.reference_id), [ref(selectedFinal.result.reference_id)]);
    addClaim(state, "final-contains-core", selectedFinal.result.reference_id,
      "reference:contains", scope(attempt.attempt.reference_id), [ref(selectedFinal.corePortion.reference_id)]);
    addClaim(state, "final-core-state", selectedFinal.corePortion.reference_id,
      "reference:has_state", scope(attempt.attempt.reference_id), [ref(selectedFinal.coreState.reference_id)]);
    if (selectedSettlement && sameRole(selectedSettlement.value, selectedFinal.coreValue)) addClaim(
      state, "final-core-value", selectedFinal.coreState.reference_id,
      "reference:resolves_to", scope(attempt.attempt.reference_id), [ref(selectedFinal.coreValue.reference_id)]
    );
    addClaim(state, "final-observation-records", selectedFinal.observation.reference_id,
      "reference:records", scope(attempt.attempt.reference_id), [
        ref(selectedFinal.corePortion.reference_id), ref(selectedFinal.coreState.reference_id),
        ref(POPULATION_IDS["final-core-members"])
      ].sort((left, right) => compareCodeUnits(left.reference_id, right.reference_id)));
    if (selectedFailure && selectedFinal.disclosedReasons.length === 1 &&
        sameRole(selectedFinal.disclosedReasons[0], selectedFailure.reason)) {
      addClaim(state, "final-discloses-reason", selectedFinal.result.reference_id,
        "reference:has_status", scope(attempt.attempt.reference_id), [ref(selectedFailure.reason.reference_id)]);
      addClaim(state, "failure-reason-disclosed", selectedFailure.reason.reference_id,
        "reference:member_of", scope(attempt.attempt.reference_id),
        [ref(POPULATION_IDS["disclosed-reasons"])]);
    }
    if (selectedFailure && containsRole(selectedFinal.presentComponents, selectedFailure.component)) {
      addClaim(state, "component-present", selectedFailure.component.reference_id,
        "reference:member_of", scope(attempt.attempt.reference_id), [ref(POPULATION_IDS["final-result-members"])]);
      if (containsRole(attempt.unavailableStates, selectedFinal.unavailableState)) addClaim(state,
        "component-unavailable", selectedFailure.component.reference_id, "reference:has_state",
        scope(attempt.attempt.reference_id), [ref(selectedFinal.unavailableState.reference_id)]);
    }
    if (selectedFailure && containsRole(selectedFinal.disclosedOmissions, selectedFailure.component)) {
      addClaim(state, "component-omitted", selectedFailure.component.reference_id,
        "reference:not_member_of", scope(attempt.attempt.reference_id),
        [ref(POPULATION_IDS["final-result-members"])]);
      addClaim(state, "component-omission-disclosed", selectedFailure.component.reference_id,
        "reference:member_of", scope(attempt.attempt.reference_id),
        [ref(POPULATION_IDS["disclosed-omissions"])]);
    }
  }

  if (selectedSettlement && selectedFailure && selectedSettlement.sequence < selectedFailure.sequence) {
    addClaim(state, "settlement-precedes-failure", selectedSettlement.event.reference_id,
      "reference:precedes", scope(attempt.attempt.reference_id), [ref(selectedFailure.event.reference_id)]);
  }
  if (selectedFailure && selectedFinal && selectedFailure.sequence < selectedFinal.sequence) {
    addClaim(state, "failure-precedes-final", selectedFailure.event.reference_id,
      "reference:precedes", scope(attempt.attempt.reference_id), [ref(selectedFinal.event.reference_id)]);
  }
  if (selectedSettlement && selectedFinal) {
    if (roleSetEqual(selectedSettlement.members, selectedFinal.coreMembers)) {
      const targetClaim = addClaim(state, "core-members-forward", POPULATION_IDS["core-members"],
        "reference:subset_of", scope(attempt.attempt.reference_id),
        [ref(POPULATION_IDS["final-core-members"])], "behavior");
      const verificationPropositionId = "prop-sfi-core-members-forward-verification";
      const falsifierPropositionId = "prop-sfi-core-members-forward-falsifier";
      const pair = [ref(POPULATION_IDS["core-members"]), ref(POPULATION_IDS["final-core-members"])]
        .sort((left, right) => compareCodeUnits(left.reference_id, right.reference_id));
      state.propositions.push({
        proposition_id: verificationPropositionId,
        subject_reference_id: verification.reference_id,
        operator: "reference:covers",
        applicability_context: scope(attempt.attempt.reference_id),
        operands: pair
      }, {
        proposition_id: falsifierPropositionId,
        subject_reference_id: POPULATION_IDS["core-members"],
        operator: "reference:not_subset_of",
        applicability_context: scope(attempt.attempt.reference_id),
        operands: [ref(POPULATION_IDS["final-core-members"])]
      });
      const verificationClaim = "claim-sfi-core-members-forward-verification";
      state.claims.push({
        claim_id: verificationClaim,
        kind: "verification",
        modality: "MUST",
        proposition_id: verificationPropositionId,
        verification_method: "test_execution",
        falsifying_proposition_id: falsifierPropositionId
      });
      state.relations.push({ relation_id: "rel-sfi-core-members-forward-verifies", role: "verifies",
        source_claim_id: verificationClaim, target_claim_id: targetClaim });
      addClaim(state, "core-members-reverse", POPULATION_IDS["final-core-members"], "reference:subset_of",
        scope(attempt.attempt.reference_id), [ref(POPULATION_IDS["core-members"])]);
    }
    if (selectedSettlement.members.every((member) => containsRole(selectedFinal.finalMembers, member))) {
      addClaim(state, "core-members-in-final", POPULATION_IDS["core-members"], "reference:subset_of",
        scope(attempt.attempt.reference_id), [ref(POPULATION_IDS["final-result-members"])]);
    }
  }

  const contract = {
    schema_version: CONTRACT_VERSION,
    vocabulary_version: VOCABULARY_VERSION,
    profile_id: "acceptance-contract.standard.experimental.v0.2",
    references: [...state.references.values()].sort((a, b) =>
      compareCodeUnits(a.reference_id, b.reference_id)),
    propositions: state.propositions.sort((a, b) =>
      compareCodeUnits(a.proposition_id, b.proposition_id)),
    claims: state.claims.sort((a, b) => compareCodeUnits(a.claim_id, b.claim_id)),
    relations: state.relations.sort((a, b) => compareCodeUnits(a.relation_id, b.relation_id)),
    collections: [], residue: [], annotations: []
  };
  return contract;
}

function populationMembers(contract, name) {
  const id = POPULATION_IDS[name];
  const membership = contract.propositions.find(({ subject_reference_id: subject, operator }) =>
    subject === id && operator === "reference:contains");
  const cardinality = contract.propositions.find(({ subject_reference_id: subject, operator }) =>
    subject === id && operator === "number:has_cardinality");
  const members = membership?.operands.map(({ reference_id: referenceId }) => referenceId) ?? [];
  if (!cardinality || cardinality.operands?.[0]?.value !== members.length || !sortedUnique(members)) fail(
    "supplementary_isolation_projection_population_invalid",
    "projected population is not complete and canonical", { population: name }
  );
  return members;
}

function projectedReference(contract, referenceId) {
  const reference = contract.references.find(({ reference_id: id }) => id === referenceId);
  if (!reference) fail("supplementary_isolation_projection_reference_missing",
    "projected reference is missing", { reference_id: referenceId });
  return { grounded_identity_sha256: canonicalDigest(reference.identity),
    reference_id: reference.reference_id, type_term: reference.type_term };
}

function singleton(contract, populationName) {
  const members = populationMembers(contract, populationName);
  if (members.length !== 1) fail("supplementary_isolation_projection_singleton_invalid",
    "projected singleton population does not contain exactly one member", { populationName });
  return projectedReference(contract, members[0]);
}

function findClaimOperand(contract, propositionId, position = 0) {
  const proposition = contract.propositions.find(({ proposition_id: id }) => id === propositionId);
  const referenceId = proposition?.operands?.[position]?.reference_id;
  if (!referenceId) fail("supplementary_isolation_projection_reference_missing",
    "projected singleton claim operand is missing", { proposition_id: propositionId });
  return projectedReference(contract, referenceId);
}

function assertResult(value) {
  if (!exactKeys(value, [
    "annotations", "claims", "collections", "profile_id", "propositions", "references",
    "relations", "residue", "schema_version", "vocabulary_version"
  ]) || value.schema_version !== CONTRACT_VERSION || value.vocabulary_version !== VOCABULARY_VERSION ||
      value.profile_id !== "acceptance-contract.standard.experimental.v0.2" ||
      !Array.isArray(value.references) || !Array.isArray(value.propositions) ||
      !Array.isArray(value.claims) || !Array.isArray(value.relations) ||
      !Array.isArray(value.collections) || value.collections.length !== 0 ||
      !Array.isArray(value.residue) || value.residue.length !== 0 ||
      !Array.isArray(value.annotations) || value.annotations.length !== 0) fail(
    "supplementary_isolation_projection_result_invalid",
    "projection is not a closed v0.2 controlled contract"
  );
  const graph = validateProjectedContractWithStableCore(value);
  if (!graph.schema_valid || graph.diagnostics.length !== 0) fail(
    "supplementary_isolation_projection_result_invalid",
    "projection fails contract graph invariants",
    { diagnostics: graph.diagnostics, schema_errors: graph.schema_errors }
  );
  if (!sortedUnique(value.references.map(({ reference_id: id }) => id))) fail(
    "supplementary_isolation_projection_result_noncanonical",
    "projection references are not sorted and unique"
  );
  for (const name of Object.keys(POPULATION_IDS)) populationMembers(value, name);
  return deepFreeze(value);
}

const singletonClaimOperands = Object.freeze({
  attempt: ["prop-sfi-attempt-performs-operation", "subject"],
  operation: ["prop-sfi-attempt-performs-operation", 0],
  "attempt-start-event": ["prop-sfi-attempt-starts", "subject"],
  "core-computation": ["prop-sfi-core-returns-result", "subject"],
  "supplementary-computation": ["prop-sfi-supplementary-targets-component", "subject"],
  "core-result": ["prop-sfi-core-returns-result", 0],
  "core-settled-state": ["prop-sfi-core-result-state", 0],
  "core-settled-value": ["prop-sfi-core-state-value", 0],
  "settlement-observation": ["prop-sfi-settlement-observation-records", "subject"],
  "supplementary-component": ["prop-sfi-supplementary-targets-component", 0],
  "supplementary-failure-reason": ["prop-sfi-failure-has-reason", 0],
  "final-result": ["prop-sfi-attempt-returns-final", 0],
  "final-core-portion": ["prop-sfi-final-contains-core", 0],
  "final-core-state": ["prop-sfi-final-core-state", 0],
  "final-core-value": ["prop-sfi-final-core-value", 0],
  "final-observation": ["prop-sfi-final-observation-records", "subject"]
});

const projections = {};
for (const [name, populationId] of Object.entries(POPULATION_IDS)) {
  projections[name] = Object.freeze({ cardinality: "set", project: (contract) =>
    populationMembers(contract, name) });
  projections[`${name}-population`] = Object.freeze({ cardinality: "singleton_reference",
    project: (contract) => projectedReference(contract, populationId) });
}
for (const [name, [propositionId, position]] of Object.entries(singletonClaimOperands)) {
  projections[name] = Object.freeze({ cardinality: "singleton_reference", project: (contract) => {
    if (position === "subject") {
      const proposition = contract.propositions.find(({ proposition_id: id }) => id === propositionId);
      if (!proposition) fail("supplementary_isolation_projection_reference_missing",
        "projected singleton claim is missing", { proposition_id: propositionId });
      return projectedReference(contract, proposition.subject_reference_id);
    }
    return findClaimOperand(contract, propositionId, position);
  } });
}
for (const [name, populationName] of Object.entries({
  "core-settlement-event": "core-settlements",
  "supplementary-failure-event": "supplementary-failures",
  "final-result-event": "final-result-events",
  "disclosed-reason": "disclosed-reasons",
  "unavailable-state": "unavailable-states"
})) projections[name] = Object.freeze({ cardinality: "singleton_reference",
  project: (contract) => singleton(contract, populationName) });
projections.verification = Object.freeze({ cardinality: "singleton_reference",
  project: (contract) => projectedReference(contract, "ref-sfi-verification") });
projections["projection-result"] = Object.freeze({ cardinality: "singleton_reference",
  project: (contract) => projectedReference(contract, "ref-sfi-projection-result") });
for (const name of ["attempt-record", "core-settlement-record", "final-result-record",
  "supplementary-failure-record"]) projections[`${name}-capture`] = Object.freeze({
  cardinality: "singleton_reference",
  project: (contract) => projectedReference(contract, `ref-sfi-${name}-capture`)
});
for (const name of [
  "core-member-count", "disclosed-reason-count", "failure-reason-count",
  "final-core-member-count", "final-result-member-count", "supplementary-result-count"
]) projections[`${name}-signal`] = Object.freeze({ cardinality: "singleton_reference",
  project: (contract) => projectedReference(contract, `ref-sfi-${name}-signal`) });

function projectGraph(contract) {
  return { schema_version: GRAPH_VERSION, references: structuredClone(contract.references),
    propositions: structuredClone(contract.propositions), claims: structuredClone(contract.claims),
    relations: structuredClone(contract.relations), collections: [] };
}

const SUPPLEMENTARY_ISOLATION_ATTEMPT_TRANSFORMER = Object.freeze({
  transformer_id: TRANSFORMER_ID,
  source_count: 4,
  parse_sources: parseSources,
  transform: deriveContract,
  validate_result: assertResult,
  projections: Object.freeze(projections),
  graph_projections: Object.freeze({
    "supplementary-isolation-contract": Object.freeze({ project: projectGraph })
  })
});

function deriveSupplementaryIsolationAttemptRecord(sourceBytes) {
  if (!Array.isArray(sourceBytes) || sourceBytes.length !== 4 ||
      sourceBytes.some((bytes) => !Buffer.isBuffer(bytes))) fail(
    "projection_source_set_incomplete",
    "supplementary isolation requires four exact Buffer sources"
  );
  const values = parseSources(sourceBytes);
  const digests = sourceBytes.map(sha256);
  const first = canonicalJsonBytes(assertResult(deriveContract(structuredClone(values), digests)),
    { file: true });
  const second = canonicalJsonBytes(assertResult(deriveContract(structuredClone(values), digests)),
    { file: true });
  if (!first.equals(second)) fail("projection_transformer_nondeterministic",
    "supplementary-isolation projection is nondeterministic");
  return Buffer.from(first);
}

export {
  INPUT_VERSIONS,
  POPULATION_IDS,
  SUPPLEMENTARY_ISOLATION_ATTEMPT_TRANSFORMER,
  TRANSFORMER_ID,
  assertResult as assertSupplementaryIsolationAttemptRecord,
  deriveSupplementaryIsolationAttemptRecord,
  populationMembers
};
