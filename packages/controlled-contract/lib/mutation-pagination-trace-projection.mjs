import {
  ExactBindingError,
  canonicalJsonBytes,
  compareCodeUnits,
  parseCanonicalDocument,
  sha256,
  sortedUnique
} from "./deterministic-projection-primitives.mjs";
import {
  COMPLETE_TRAVERSAL_RESOURCE_LIMITS,
  assertCompleteTraversalResourceUsage,
  completeTraversalProjection
} from "./mutation-pagination-complete-traversal.mjs";
import { completeTraversalOccurrenceId } from "./stable-occurrence-identity.mjs";

const TRANSFORMER_ID = "mutation-pagination-trace.v1";
const TRACE_VERSION = "controlled-contract.mutation-pagination-trace.v1";
const RESULT_VERSION = "controlled-contract.mutation-pagination-projection.v1";
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const COMPLETE_TRAVERSAL_POLICY = "complete_traversal";

function fail(code, message, details = {}) {
  throw new ExactBindingError(code, message, details);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) =>
      Object.hasOwn(value, key));
}

function assertId(value, field) {
  if (typeof value !== "string" || !ID.test(value) || value !== value.normalize("NFC")) {
    fail("projection_input_identifier_invalid",
      "pagination trace identifiers must be canonical kebab-case strings", { field });
  }
}

function assertDigest(value, field) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(
    "projection_input_digest_invalid",
    "pagination trace content digests must be lowercase SHA-256 values", { field }
  );
}

function assertSortedUniqueIds(values, field, { minimum = 0 } = {}) {
  if (!Array.isArray(values) || values.length < minimum) fail(
    "projection_input_population_invalid",
    "pagination trace populations must satisfy their declared minimum", { field }
  );
  values.forEach((value, index) => assertId(value, `${field}[${index}]`));
  if (!sortedUnique(values)) fail(
    "projection_input_population_noncanonical",
    "set-valued pagination trace populations must be sorted and unique", { field }
  );
}

function assertPosition(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail(
    "projection_input_position_invalid",
    "pagination trace positions must be nonnegative safe integers", { field }
  );
}

function occurrenceId(kind, value) {
  const payload = structuredClone(value);
  delete payload.occurrence_id;

  if (kind === "returned-page") delete payload.member_occurrences;
  return `occ-${sha256(canonicalJsonBytes({ kind, ...payload }))}`;
}

function assertOccurrence(kind, value, keys, field) {
  if (!exactKeys(value, ["occurrence_id", ...keys])) fail(
    "projection_input_occurrence_invalid",
    "pagination trace occurrences have a closed kind-specific shape", { field, kind }
  );
  assertId(value.occurrence_id, `${field}.occurrence_id`);
  if (value.occurrence_id !== occurrenceId(kind, value)) fail(
    "projection_occurrence_identity_mismatch",
    "pagination occurrence identities must be derived from complete occurrence content",
    { field, kind }
  );
  if (Object.hasOwn(value, "position")) assertPosition(value.position, `${field}.position`);
}

function ref(value) { return `ref-${value}`; }

function sortedReferences(values) {
  return [...values].map(ref).sort(compareCodeUnits);
}

function assertUniqueOccurrences(groups) {
  const ids = new Set();
  const positions = new Set();
  for (const group of groups) for (const value of group) {
    if (ids.has(value.occurrence_id)) fail(
      "projection_occurrence_identity_duplicate",
      "every pagination trace occurrence must have a globally distinct identity"
    );
    ids.add(value.occurrence_id);
    if (!Object.hasOwn(value, "position")) continue;
    if (positions.has(value.position)) fail(
      "projection_temporal_position_ambiguous",
      "every positioned pagination occurrence must have a distinct logical position"
    );
    positions.add(value.position);
  }
}

function assertOrderedByPosition(values, field) {
  if (!values.every((value, index) => index === 0 ||
      values[index - 1].position < value.position)) fail(
    "projection_temporal_order_noncanonical",
    "positioned pagination occurrences must be ordered by logical position", { field }
  );
}

function validateCaptures(captures, sourceDigests) {
  const keys = [
    "primary_before_sha256", "primary_after_sha256",
    "control_before_sha256", "control_after_sha256"
  ];
  if (!exactKeys(captures, keys)) fail(
    "projection_capture_index_invalid",
    "pagination trace capture bindings have a closed four-capture shape"
  );
  keys.forEach((key) => assertDigest(captures[key], `captures.${key}`));
  const observed = sourceDigests.slice(1);
  const declared = keys.map((key) => captures[key]);
  if (JSON.stringify(observed) !== JSON.stringify(declared)) fail(
    "projection_capture_digest_mismatch",
    "pagination trace capture digests must identify the exact captured sources"
  );
}

function validateMemberOccurrence(value, field, owner) {
  assertOccurrence("member", value, ["member_id", "owner_occurrence_id", "ordinal"], field);
  assertId(value.member_id, `${field}.member_id`);
  assertId(value.owner_occurrence_id, `${field}.owner_occurrence_id`);
  if (value.owner_occurrence_id !== owner) fail(
    "projection_member_owner_mismatch",
    "member occurrence owner must be the exact returned-page or stable-run occurrence",
    { field }
  );
  if (!Number.isSafeInteger(value.ordinal) || value.ordinal < 0) fail(
    "projection_member_ordinal_invalid",
    "member occurrence ordinals must be nonnegative safe integers", { field }
  );
}

function validateMemberSequence(values, field, owner) {
  if (!Array.isArray(values)) fail(
    "projection_member_sequence_invalid", "member occurrences must be an ordered array",
    { field }
  );
  values.forEach((value, index) => {
    validateMemberOccurrence(value, `${field}[${index}]`, owner);
    if (value.ordinal !== index) fail(
      "projection_member_ordinal_noncanonical",
      "member occurrence ordinals must exactly encode array order", { field, index }
    );
  });
}

function validateMutation(value, field) {
  assertOccurrence("mutation", value, [
    "position", "target_source_id", "before_version_id", "after_version_id"
  ], field);
  for (const key of ["target_source_id", "before_version_id", "after_version_id"]) {
    assertId(value[key], `${field}.${key}`);
  }
}

function snapshotProjection(trace, sourceDigests) {
  const keys = [
    "schema_version", "policy", "traversal_id", "live_source_id", "snapshot_id",
    "snapshot_state_id", "initial_source_version_id", "later_source_version_id",
    "page_attempts", "returned_pages", "stable_member_occurrences", "mutations",
    "selected", "captures"
  ];
  if (!exactKeys(trace, keys)) fail(
    "projection_snapshot_trace_invalid", "snapshot pagination traces have a closed shape"
  );
  for (const key of [
    "traversal_id", "live_source_id", "snapshot_id", "snapshot_state_id",
    "initial_source_version_id", "later_source_version_id"
  ]) assertId(trace[key], key);
  if (trace.initial_source_version_id === trace.later_source_version_id) fail(
    "projection_source_version_not_changed",
    "the relevant live-source mutation must select distinct source versions"
  );
  validateCaptures(trace.captures, sourceDigests);
  if (trace.captures.primary_before_sha256 !== trace.captures.primary_after_sha256) fail(
    "projection_snapshot_state_changed",
    "the exact snapshot state must remain byte-identical across the selected page reads"
  );
  if (trace.captures.control_before_sha256 === trace.captures.control_after_sha256) fail(
    "projection_source_version_content_unchanged",
    "the selected live-source versions must have distinct captured content"
  );
  if (!Array.isArray(trace.page_attempts) || trace.page_attempts.length < 2 ||
      !Array.isArray(trace.returned_pages) || trace.returned_pages.length < 2 ||
      !Array.isArray(trace.mutations) || trace.mutations.length < 1) fail(
    "projection_snapshot_population_incomplete",
    "snapshot traces need at least two attempts, two returned pages, and one mutation"
  );
  trace.page_attempts.forEach((attempt, index) => {
    const field = `page_attempts[${index}]`;
    assertOccurrence("page-attempt", attempt, [
      "position", "source_version_id", "snapshot_id", "snapshot_state_id"
    ], field);
    for (const key of ["source_version_id", "snapshot_id", "snapshot_state_id"]) {
      assertId(attempt[key], `${field}.${key}`);
    }
    if (attempt.snapshot_id !== trace.snapshot_id ||
        attempt.snapshot_state_id !== trace.snapshot_state_id) fail(
      "projection_snapshot_binding_inconsistent",
      "every page attempt must resolve to the exact selected snapshot identity and state",
      { field }
    );
  });
  trace.returned_pages.forEach((page, index) => {
    const field = `returned_pages[${index}]`;
    assertOccurrence("returned-page", page, [
      "position", "attempt_occurrence_id", "source_version_id", "snapshot_id",
      "snapshot_state_id", "member_occurrences"
    ], field);
    for (const key of [
      "attempt_occurrence_id", "source_version_id", "snapshot_id", "snapshot_state_id"
    ]) assertId(page[key], `${field}.${key}`);
    if (page.snapshot_id !== trace.snapshot_id ||
        page.snapshot_state_id !== trace.snapshot_state_id) fail(
      "projection_snapshot_binding_inconsistent",
      "every returned page must resolve to the exact selected snapshot identity and state",
      { field }
    );
    validateMemberSequence(page.member_occurrences, `${field}.member_occurrences`,
      page.occurrence_id);
  });
  trace.mutations.forEach((mutation, index) => validateMutation(
    mutation, `mutations[${index}]`
  ));
  assertOrderedByPosition(trace.page_attempts, "page_attempts");
  assertOrderedByPosition(trace.returned_pages, "returned_pages");
  assertOrderedByPosition(trace.mutations, "mutations");
  const stableOwner = `stable-${trace.traversal_id}`;
  assertId(stableOwner, "stable_member_occurrences.owner_occurrence_id");
  validateMemberSequence(trace.stable_member_occurrences,
    "stable_member_occurrences", stableOwner);
  if (!exactKeys(trace.selected, [
    "first_page_attempt_id", "later_page_attempt_id", "relevant_mutation_id"
  ])) fail(
    "projection_selected_occurrences_invalid",
    "snapshot selected occurrences have a closed unambiguous shape"
  );
  Object.entries(trace.selected).forEach(([key, value]) => assertId(value, `selected.${key}`));
  const attempts = new Map(trace.page_attempts.map((value) => [value.occurrence_id, value]));
  const mutations = new Map(trace.mutations.map((value) => [value.occurrence_id, value]));
  const first = attempts.get(trace.selected.first_page_attempt_id);
  const later = attempts.get(trace.selected.later_page_attempt_id);
  const mutation = mutations.get(trace.selected.relevant_mutation_id);
  if (!first || !later || !mutation || first === later) fail(
    "projection_selected_occurrence_missing",
    "selected snapshot occurrences must resolve uniquely inside the complete trace"
  );
  if (mutation.target_source_id !== trace.live_source_id ||
      mutation.before_version_id !== trace.initial_source_version_id ||
      mutation.after_version_id !== trace.later_source_version_id) fail(
    "projection_relevant_mutation_mismatch",
    "the selected mutation must change the exact live source between selected versions"
  );
  if (!(first.position < mutation.position && mutation.position < later.position)) fail(
    "projection_relevant_mutation_order_invalid",
    "the relevant mutation must occur between the selected page attempts"
  );
  const returnsByAttempt = new Map();
  for (const page of trace.returned_pages) {
    const attempt = attempts.get(page.attempt_occurrence_id);
    if (!attempt || page.position <= attempt.position || returnsByAttempt.has(attempt.occurrence_id)) {
      fail("projection_returned_page_attempt_mismatch",
        "each returned page must follow exactly one complete page attempt");
    }
    returnsByAttempt.set(attempt.occurrence_id, page);
    if (page.source_version_id !== attempt.source_version_id) fail(
      "projection_returned_page_version_mismatch",
      "returned pages must bind the source version observed by their exact attempt"
    );
  }
  if (returnsByAttempt.size !== attempts.size) fail(
    "projection_page_attempt_return_incomplete",
    "every selected snapshot page attempt must have exactly one returned-page occurrence"
  );
  const firstReturn = returnsByAttempt.get(first.occurrence_id);
  if (firstReturn.position >= mutation.position) fail(
    "projection_relevant_mutation_order_invalid",
    "the relevant mutation must follow the selected earlier page read"
  );
  for (const attempt of trace.page_attempts) {
    const expected = attempt.position < mutation.position
      ? trace.initial_source_version_id : trace.later_source_version_id;
    if (attempt.source_version_id !== expected) fail(
      "projection_page_source_version_mismatch",
      "page attempts must record the exact live-source version at their occurrence"
    );
  }
  const interleavedMembers = trace.returned_pages.flatMap(
    ({ member_occurrences: members }) => members
  );
  const stableValues = trace.stable_member_occurrences.map(({ member_id: id }) => id);
  const interleavedValues = interleavedMembers.map(({ member_id: id }) => id);
  if (JSON.stringify(stableValues) !== JSON.stringify(interleavedValues)) fail(
    "projection_member_occurrence_sequence_mismatch",
    "stable and mutation-interleaved ordered member occurrences must match exactly"
  );
  assertUniqueOccurrences([
    trace.page_attempts, trace.returned_pages, trace.mutations,
    trace.stable_member_occurrences,
    ...trace.returned_pages.map(({ member_occurrences: members }) => members)
  ]);
  return {
    ordered_occurrences: {
      stable_member_occurrence_ids: trace.stable_member_occurrences.map(
        ({ occurrence_id: id }) => ref(id)
      ),
      interleaved_member_occurrence_ids: interleavedMembers.map(
        ({ occurrence_id: id }) => ref(id)
      ),
      temporal_occurrence_ids: [
        ...trace.page_attempts, ...trace.returned_pages, ...trace.mutations
      ].sort((left, right) => left.position - right.position).map(
        ({ occurrence_id: id }) => ref(id)
      )
    },
    projections: {
      traversal: [ref(trace.traversal_id)],
      live_source: [ref(trace.live_source_id)],
      snapshot: [ref(trace.snapshot_id)],
      snapshot_state: [ref(trace.snapshot_state_id)],
      page_attempts: sortedReferences(trace.page_attempts.map(({ occurrence_id: id }) => id)),
      returned_pages: sortedReferences(trace.returned_pages.map(({ occurrence_id: id }) => id)),
      member_occurrences: sortedReferences(interleavedMembers.map(({ occurrence_id: id }) => id)),
      stable_member_occurrences: sortedReferences(
        trace.stable_member_occurrences.map(({ occurrence_id: id }) => id)
      ),
      mutations: sortedReferences(trace.mutations.map(({ occurrence_id: id }) => id)),
      initial_source_version: [ref(trace.initial_source_version_id)],
      later_source_version: [ref(trace.later_source_version_id)],
      first_page_attempt: [ref(first.occurrence_id)],
      later_page_attempt: [ref(later.occurrence_id)],
      first_returned_page: [ref(firstReturn.occurrence_id)],
      later_returned_page: [ref(returnsByAttempt.get(later.occurrence_id).occurrence_id)],
      relevant_mutation: [ref(mutation.occurrence_id)]
    }
  };
}

function validateCursor(value, field) {
  if (!exactKeys(value, ["cursor_id", "traversal_id", "source_version_id"])) fail(
    "projection_cursor_invalid", "cursor bindings have a closed shape", { field }
  );
  for (const key of ["cursor_id", "traversal_id", "source_version_id"]) {
    assertId(value[key], `${field}.${key}`);
  }
}

function versionedProjection(trace, sourceDigests) {
  const keys = [
    "schema_version", "policy", "traversal_id", "control_traversal_id",
    "live_source_id", "control_source_id", "unrelated_source_id",
    "traversal_source_version_id", "current_source_version_id",
    "control_source_version_id", "cursors", "page_attempts", "returned_pages",
    "mutations", "refusals", "returns", "advancements", "protected_effects",
    "effect_occurrences", "selected", "captures"
  ];
  if (!exactKeys(trace, keys)) fail(
    "projection_versioned_trace_invalid",
    "versioned-cursor pagination traces have a closed shape"
  );
  for (const key of [
    "traversal_id", "control_traversal_id", "live_source_id", "control_source_id",
    "unrelated_source_id", "traversal_source_version_id", "current_source_version_id",
    "control_source_version_id"
  ]) assertId(trace[key], key);
  if (new Set([
    trace.traversal_id, trace.control_traversal_id,
    trace.live_source_id, trace.control_source_id, trace.unrelated_source_id
  ]).size !== 5) fail(
    "projection_control_identity_not_distinct",
    "stale and unrelated-mutation controls need distinct traversal/source identities"
  );
  if (trace.traversal_source_version_id === trace.current_source_version_id) fail(
    "projection_stale_version_not_distinct",
    "the stale cursor and current source versions must be distinct identities"
  );
  validateCaptures(trace.captures, sourceDigests);
  if (trace.captures.primary_before_sha256 === trace.captures.primary_after_sha256) fail(
    "projection_stale_version_content_equal",
    "stale and current source versions must have distinct captured content"
  );
  if (trace.captures.control_before_sha256 !== trace.captures.control_after_sha256) fail(
    "projection_unrelated_mutation_changed_source",
    "the selected source must stay byte-identical across the unrelated mutation"
  );
  if (!Array.isArray(trace.cursors) || trace.cursors.length < 2 ||
      !Array.isArray(trace.page_attempts) || trace.page_attempts.length < 3 ||
      !Array.isArray(trace.returned_pages) || trace.returned_pages.length < 2 ||
      !Array.isArray(trace.mutations) || trace.mutations.length < 2 ||
      !Array.isArray(trace.refusals) || trace.refusals.length < 1 ||
      !Array.isArray(trace.returns) || !Array.isArray(trace.advancements) ||
      !Array.isArray(trace.effect_occurrences)) fail(
    "projection_versioned_population_incomplete",
    "versioned traces need complete stale and unrelated-mutation control populations"
  );
  trace.cursors.forEach((cursor, index) => validateCursor(cursor, `cursors[${index}]`));
  const cursorIds = trace.cursors.map(({ cursor_id: id }) => id);
  if (!sortedUnique(cursorIds)) fail(
    "projection_cursor_population_noncanonical", "cursor identities must be sorted and unique"
  );
  trace.page_attempts.forEach((attempt, index) => {
    const field = `page_attempts[${index}]`;
    assertOccurrence("page-attempt", attempt,
      ["position", "traversal_id", "cursor_id", "kind"], field);
    assertId(attempt.traversal_id, `${field}.traversal_id`);
    assertId(attempt.cursor_id, `${field}.cursor_id`);
    if (!["prior", "stale", "control"].includes(attempt.kind)) fail(
      "projection_page_attempt_kind_invalid", "page attempt kinds are closed", { field }
    );
  });
  trace.returned_pages.forEach((page, index) => {
    const field = `returned_pages[${index}]`;
    assertOccurrence("returned-page", page,
      ["position", "attempt_occurrence_id", "source_version_id", "member_occurrences"],
      field);
    assertId(page.attempt_occurrence_id, `${field}.attempt_occurrence_id`);
    assertId(page.source_version_id, `${field}.source_version_id`);
    validateMemberSequence(page.member_occurrences, `${field}.member_occurrences`,
      page.occurrence_id);
  });
  trace.mutations.forEach((mutation, index) => validateMutation(
    mutation, `mutations[${index}]`
  ));
  trace.refusals.forEach((refusal, index) => {
    const field = `refusals[${index}]`;
    assertOccurrence("refusal", refusal,
      ["position", "attempt_occurrence_id", "cursor_id"], field);
    assertId(refusal.attempt_occurrence_id, `${field}.attempt_occurrence_id`);
    assertId(refusal.cursor_id, `${field}.cursor_id`);
  });
  trace.returns.forEach((returned, index) => {
    const field = `returns[${index}]`;
    assertOccurrence("return", returned,
      ["position", "attempt_occurrence_id", "returned_page_occurrence_id"], field);
    assertId(returned.attempt_occurrence_id, `${field}.attempt_occurrence_id`);
    assertId(returned.returned_page_occurrence_id,
      `${field}.returned_page_occurrence_id`);
  });
  trace.advancements.forEach((advance, index) => {
    const field = `advancements[${index}]`;
    assertOccurrence("advancement", advance,
      ["position", "attempt_occurrence_id", "cursor_id"], field);
    assertId(advance.attempt_occurrence_id, `${field}.attempt_occurrence_id`);
    assertId(advance.cursor_id, `${field}.cursor_id`);
  });
  trace.effect_occurrences.forEach((effect, index) => {
    const field = `effect_occurrences[${index}]`;
    assertOccurrence("effect", effect,
      ["position", "attempt_occurrence_id", "effect_id", "operation"], field);
    assertId(effect.attempt_occurrence_id, `${field}.attempt_occurrence_id`);
    assertId(effect.effect_id, `${field}.effect_id`);
    if (!["write", "mutate"].includes(effect.operation)) fail(
      "projection_effect_operation_invalid", "protected effects are writes or mutations",
      { field }
    );
  });
  assertSortedUniqueIds(trace.protected_effects, "protected_effects", { minimum: 3 });
  for (const [field, values] of [
    ["page_attempts", trace.page_attempts], ["returned_pages", trace.returned_pages],
    ["mutations", trace.mutations], ["refusals", trace.refusals],
    ["returns", trace.returns], ["advancements", trace.advancements],
    ["effect_occurrences", trace.effect_occurrences]
  ]) assertOrderedByPosition(values, field);
  const selectedKeys = [
    "prior_page_attempt_id", "relevant_mutation_id", "stale_attempt_id",
    "stale_cursor_id", "refusal_id", "page_result_artifact_id",
    "page_return_event_id", "cursor_advance_event_id", "cursor_state_id",
    "traversal_state_id", "unrelated_mutation_id", "control_attempt_id",
    "control_return_id", "control_advancement_id"
  ];
  if (!exactKeys(trace.selected, selectedKeys)) fail(
    "projection_selected_occurrences_invalid",
    "versioned-cursor selected identities have a closed unambiguous shape"
  );
  Object.entries(trace.selected).forEach(([key, value]) => assertId(value, `selected.${key}`));
  for (const requiredEffect of [
    trace.selected.page_result_artifact_id, trace.selected.cursor_state_id,
    trace.selected.traversal_state_id
  ]) if (!trace.protected_effects.includes(requiredEffect)) fail(
    "projection_protected_effect_population_incomplete",
    "the protected-effect population must contain result, cursor, and traversal state"
  );
  const attempts = new Map(trace.page_attempts.map((value) => [value.occurrence_id, value]));
  const cursors = new Map(trace.cursors.map((value) => [value.cursor_id, value]));
  const mutations = new Map(trace.mutations.map((value) => [value.occurrence_id, value]));
  const refusals = new Map(trace.refusals.map((value) => [value.occurrence_id, value]));
  const returns = new Map(trace.returns.map((value) => [value.occurrence_id, value]));
  const advances = new Map(trace.advancements.map((value) => [value.occurrence_id, value]));
  const prior = attempts.get(trace.selected.prior_page_attempt_id);
  const stale = attempts.get(trace.selected.stale_attempt_id);
  const control = attempts.get(trace.selected.control_attempt_id);
  const relevantMutation = mutations.get(trace.selected.relevant_mutation_id);
  const unrelatedMutation = mutations.get(trace.selected.unrelated_mutation_id);
  const refusal = refusals.get(trace.selected.refusal_id);
  const controlReturn = returns.get(trace.selected.control_return_id);
  const controlAdvance = advances.get(trace.selected.control_advancement_id);
  const staleCursor = cursors.get(trace.selected.stale_cursor_id);
  if (!prior || !stale || !control || !relevantMutation || !unrelatedMutation || !refusal ||
      !controlReturn || !controlAdvance || !staleCursor) fail(
    "projection_selected_occurrence_missing",
    "every selected versioned-cursor occurrence must resolve uniquely in the trace"
  );
  if (prior.kind !== "prior" || stale.kind !== "stale" || control.kind !== "control" ||
      prior.traversal_id !== trace.traversal_id || stale.traversal_id !== trace.traversal_id ||
      control.traversal_id !== trace.control_traversal_id) fail(
    "projection_attempt_traversal_mismatch",
    "selected attempts must belong to their exact stale or control traversal"
  );
  if (stale.cursor_id !== staleCursor.cursor_id ||
      staleCursor.traversal_id !== trace.traversal_id ||
      staleCursor.source_version_id !== trace.traversal_source_version_id) fail(
    "projection_stale_cursor_binding_mismatch",
    "the selected stale attempt must use the exact cursor and traversal version"
  );
  for (const cursor of trace.cursors) {
    const expected = cursor.traversal_id === trace.traversal_id
      ? trace.traversal_source_version_id
      : cursor.traversal_id === trace.control_traversal_id
        ? trace.control_source_version_id : null;
    if (cursor.source_version_id !== expected) fail(
      "projection_cursor_version_mismatch",
      "every cursor must bind the exact source version of its traversal"
    );
  }
  if (relevantMutation.target_source_id !== trace.live_source_id ||
      relevantMutation.before_version_id !== trace.traversal_source_version_id ||
      relevantMutation.after_version_id !== trace.current_source_version_id ||
      !(prior.position < relevantMutation.position &&
        relevantMutation.position < stale.position)) fail(
    "projection_relevant_mutation_mismatch",
    "the relevant mutation must change the exact selected source before the stale attempt"
  );
  if (unrelatedMutation.target_source_id !== trace.unrelated_source_id ||
      unrelatedMutation.target_source_id === trace.control_source_id ||
      unrelatedMutation.before_version_id === unrelatedMutation.after_version_id ||
      unrelatedMutation.position >= control.position) fail(
    "projection_unrelated_mutation_mismatch",
    "the control mutation must change only a distinct unrelated source before the control attempt"
  );
  if (refusal.attempt_occurrence_id !== stale.occurrence_id ||
      refusal.cursor_id !== staleCursor.cursor_id || refusal.position <= stale.position) fail(
    "projection_refusal_identity_mismatch",
    "the exact refusal must reject the exact stale attempt and cursor after the attempt"
  );
  const staleReturns = trace.returns.filter(
    ({ attempt_occurrence_id: id }) => id === stale.occurrence_id
  );
  const staleAdvances = trace.advancements.filter(
    ({ attempt_occurrence_id: id }) => id === stale.occurrence_id
  );
  const protectedEffectIds = new Set(trace.protected_effects);
  const staleProtectedEffects = trace.effect_occurrences.filter(
    ({ attempt_occurrence_id: id, effect_id: effectId }) =>
      id === stale.occurrence_id && protectedEffectIds.has(effectId)
  );
  if (staleReturns.length > 0 || staleAdvances.length > 0 ||
      staleProtectedEffects.length > 0) fail(
    "projection_stale_attempt_effect_observed",
    "a stale attempt must have no return, cursor advancement, write, or mutation effect"
  );
  if (trace.refusals.some(({ attempt_occurrence_id: id }) => id === control.occurrence_id)) fail(
    "projection_unrelated_mutation_false_refusal",
    "the non-stale control attempt must not be refused after an unrelated mutation"
  );
  if (controlReturn.attempt_occurrence_id !== control.occurrence_id ||
      controlAdvance.attempt_occurrence_id !== control.occurrence_id ||
      controlAdvance.cursor_id !== control.cursor_id ||
      controlReturn.position <= control.position || controlAdvance.position <= control.position) {
    fail("projection_control_success_incomplete",
      "the non-stale control attempt must return and advance after the unrelated mutation");
  }
  const pages = new Map(trace.returned_pages.map((value) => [value.occurrence_id, value]));
  const returnedByAttempt = new Map();
  for (const returned of trace.returns) {
    const page = pages.get(returned.returned_page_occurrence_id);
    const attempt = attempts.get(returned.attempt_occurrence_id);
    if (!page || !attempt || page.attempt_occurrence_id !== attempt.occurrence_id ||
        returned.position <= page.position || returnedByAttempt.has(attempt.occurrence_id)) fail(
      "projection_return_identity_mismatch",
      "each return must expose the exact returned page of its exact attempt"
    );
    returnedByAttempt.set(attempt.occurrence_id, page);
    const cursor = cursors.get(attempt.cursor_id);
    if (!cursor || page.source_version_id !== cursor.source_version_id) fail(
      "projection_returned_page_version_mismatch",
      "every successful returned page must bind its traversal cursor source version"
    );
  }
  if (!returnedByAttempt.has(prior.occurrence_id) ||
      !returnedByAttempt.has(control.occurrence_id)) fail(
    "projection_successful_page_population_incomplete",
    "prior and unrelated-mutation control attempts must both return pages"
  );
  const memberOccurrences = trace.returned_pages.flatMap(
    ({ member_occurrences: members }) => members
  );
  const primaryCursors = trace.cursors.filter(
    ({ traversal_id: id }) => id === trace.traversal_id
  );
  const controlCursors = trace.cursors.filter(
    ({ traversal_id: id }) => id === trace.control_traversal_id
  );
  const primaryReturnedPages = trace.returned_pages.filter((page) =>
    attempts.get(page.attempt_occurrence_id)?.traversal_id === trace.traversal_id
  );
  const controlReturnedPages = trace.returned_pages.filter((page) =>
    attempts.get(page.attempt_occurrence_id)?.traversal_id === trace.control_traversal_id
  );
  assertUniqueOccurrences([
    trace.page_attempts, trace.returned_pages, trace.mutations, trace.refusals,
    trace.returns, trace.advancements, trace.effect_occurrences,
    ...trace.returned_pages.map(({ member_occurrences: members }) => members)
  ]);
  return {
    ordered_occurrences: {
      returned_member_occurrence_ids: trace.returned_pages.flatMap(
        ({ member_occurrences: members }) => members.map(({ occurrence_id: id }) => ref(id))
      ),
      temporal_occurrence_ids: [
        ...trace.page_attempts, ...trace.returned_pages, ...trace.mutations,
        ...trace.refusals, ...trace.returns, ...trace.advancements,
        ...trace.effect_occurrences
      ].sort((left, right) => left.position - right.position).map(
        ({ occurrence_id: id }) => ref(id)
      )
    },
    projections: {
      traversal: [ref(trace.traversal_id)],
      control_traversal: [ref(trace.control_traversal_id)],
      live_source: [ref(trace.live_source_id)],
      control_source: [ref(trace.control_source_id)],
      unrelated_source: [ref(trace.unrelated_source_id)],
      traversal_source_version: [ref(trace.traversal_source_version_id)],
      current_source_version: [ref(trace.current_source_version_id)],
      control_source_version: [ref(trace.control_source_version_id)],
      cursors: sortedReferences(trace.cursors.map(({ cursor_id: id }) => id)),
      primary_cursors: sortedReferences(primaryCursors.map(({ cursor_id: id }) => id)),
      control_cursors: sortedReferences(controlCursors.map(({ cursor_id: id }) => id)),
      stale_cursor: [ref(staleCursor.cursor_id)],
      control_cursor: [ref(control.cursor_id)],
      page_attempts: sortedReferences(trace.page_attempts.map(({ occurrence_id: id }) => id)),
      returned_pages: sortedReferences(trace.returned_pages.map(({ occurrence_id: id }) => id)),
      primary_returned_pages: sortedReferences(
        primaryReturnedPages.map(({ occurrence_id: id }) => id)
      ),
      control_returned_pages: sortedReferences(
        controlReturnedPages.map(({ occurrence_id: id }) => id)
      ),
      member_occurrences: sortedReferences(memberOccurrences.map(({ occurrence_id: id }) => id)),
      mutations: sortedReferences(trace.mutations.map(({ occurrence_id: id }) => id)),
      relevant_mutation: [ref(relevantMutation.occurrence_id)],
      unrelated_mutation: [ref(unrelatedMutation.occurrence_id)],
      prior_page_attempt: [ref(prior.occurrence_id)],
      stale_attempt: [ref(stale.occurrence_id)],
      control_attempt: [ref(control.occurrence_id)],
      refusal: [ref(refusal.occurrence_id)],
      returns: sortedReferences(trace.returns.map(({ occurrence_id: id }) => id)),
      advancements: sortedReferences(trace.advancements.map(({ occurrence_id: id }) => id)),
      effect_occurrences: sortedReferences(
        trace.effect_occurrences.map(({ occurrence_id: id }) => id)
      ),
      protected_effects: sortedReferences(trace.protected_effects),
      page_result_artifact: [ref(trace.selected.page_result_artifact_id)],
      page_return_event: [ref(trace.selected.page_return_event_id)],
      cursor_advance_event: [ref(trace.selected.cursor_advance_event_id)],
      cursor_state: [ref(trace.selected.cursor_state_id)],
      traversal_state: [ref(trace.selected.traversal_state_id)],
      control_return: [ref(controlReturn.occurrence_id)],
      control_advancement: [ref(controlAdvance.occurrence_id)],
      prior_returned_page: [ref(returnedByAttempt.get(prior.occurrence_id).occurrence_id)],
      control_returned_page: [ref(returnedByAttempt.get(control.occurrence_id).occurrence_id)]
    }
  };
}

const SINGLETON_PROJECTIONS = new Set([
  "traversal", "control_traversal", "live_source", "control_source",
  "unrelated_source", "snapshot", "snapshot_state", "initial_source_version",
  "later_source_version", "traversal_source_version", "current_source_version",
  "control_source_version", "first_page_attempt", "later_page_attempt",
  "first_returned_page", "later_returned_page", "relevant_mutation",
  "unrelated_mutation", "stale_cursor", "prior_page_attempt",
  "control_cursor",
  "stale_attempt", "control_attempt", "refusal", "page_result_artifact",
  "page_return_event", "cursor_advance_event", "cursor_state", "traversal_state",
  "control_return", "control_advancement", "prior_returned_page",
  "control_returned_page", "page_attempt_population", "returned_page_population",
  "member_occurrence_population", "stable_member_occurrence_population",
  "cursor_population", "primary_cursor_population", "control_cursor_population",
  "primary_returned_page_population", "control_returned_page_population",
  "mutation_population", "return_population", "advancement_population",
  "effect_occurrence_population", "protected_effect_population",
  "authentication_evidence_occurrence", "authentication_observation_attempt",
  "authenticated_source", "authoritative_population", "terminal_page",
  "aggregate_input_accounting", "canonical_result_accounting", "work_accounting",
  "authoritative_occurrence_population", "returned_occurrence_population",
  "equality_normalized_member_population", "cursor_transition_population"
]);

const PROJECTION_NAMES = [
  ...SINGLETON_PROJECTIONS,
  "page_attempts", "returned_pages", "member_occurrences",
  "primary_returned_pages", "control_returned_pages", "stable_member_occurrences",
  "mutations", "cursors", "primary_cursors", "control_cursors", "returns",
  "advancements", "effect_occurrences", "protected_effects",
  "authoritative_occurrences", "returned_occurrences", "equality_normalized_members",
  "cursor_transitions"
].sort(compareCodeUnits);

function transform(sourceValues, sourceDigests) {
  const trace = sourceValues[0];
  if (trace?.schema_version !== TRACE_VERSION ||
      !["snapshot", "versioned_cursor_refusal", COMPLETE_TRAVERSAL_POLICY].includes(
        trace?.policy
      )) fail(
    "projection_trace_shape_invalid",
    "mutation pagination traces must identify one supported closed policy"
  );
  const projected = trace.policy === "snapshot"
    ? snapshotProjection(trace, sourceDigests)
    : trace.policy === "versioned_cursor_refusal"
      ? versionedProjection(trace, sourceDigests)
      : completeTraversalProjection(trace, sourceValues, sourceDigests);
  const sourceSetSha256 = sha256(canonicalJsonBytes({
    transformer_id: TRANSFORMER_ID,
    source_content_sha256: sourceDigests
  }));
  const populationSources = trace.policy === "snapshot" ? {
    page_attempt_population: "page_attempts",
    returned_page_population: "returned_pages",
    member_occurrence_population: "member_occurrences",
    stable_member_occurrence_population: "stable_member_occurrences",
    mutation_population: "mutations"
  } : trace.policy === "versioned_cursor_refusal" ? {
    cursor_population: "cursors",
    primary_cursor_population: "primary_cursors",
    control_cursor_population: "control_cursors",
    page_attempt_population: "page_attempts",
    returned_page_population: "returned_pages",
    primary_returned_page_population: "primary_returned_pages",
    control_returned_page_population: "control_returned_pages",
    member_occurrence_population: "member_occurrences",
    mutation_population: "mutations",
    return_population: "returns",
    advancement_population: "advancements",
    effect_occurrence_population: "effect_occurrences",
    protected_effect_population: "protected_effects"
  } : {
    authoritative_occurrence_population: "authoritative_occurrences",
    returned_page_population: "returned_pages",
    returned_occurrence_population: "returned_occurrences",
    equality_normalized_member_population: "equality_normalized_members",
    cursor_transition_population: "cursor_transitions"
  };
  for (const [populationName, memberName] of Object.entries(populationSources)) {
    if (!Array.isArray(projected.projections[memberName])) fail(
      "projection_population_source_missing",
      "a named pagination population must derive from a registered member projection",
      { population_id: populationName, member_population_id: memberName }
    );
    projected.projections[populationName] = [
      `ref-pop-${populationName.replaceAll("_", "-")}-${sourceSetSha256}`
    ];
  }
  const result = {
    schema_version: RESULT_VERSION,
    transformer_id: TRANSFORMER_ID,
    policy: trace.policy,
    source_set_sha256: sourceSetSha256,
    ordered_occurrences: projected.ordered_occurrences,
    projections: projected.projections
  };
  if (trace.policy === COMPLETE_TRAVERSAL_POLICY) assertCompleteTraversalResourceUsage({
    aggregate_input_bytes: sourceValues.reduce((total, value) =>
      total + canonicalJsonBytes(value, { file: true }).byteLength, 0),
    canonical_result_bytes: canonicalJsonBytes(result, { file: true }).byteLength,
    work_units: projected.work_units
  });
  return result;
}

function parseSources(sourceBytes) {
  return sourceBytes.map((bytes, index) => parseCanonicalDocument(
    bytes, index === 0 ? "mutation pagination trace" : `capture[${index - 1}]`
  ));
}

function validateResult(value) {
  if (!exactKeys(value, [
    "schema_version", "transformer_id", "policy", "source_set_sha256",
    "ordered_occurrences", "projections"
  ]) || value.schema_version !== RESULT_VERSION ||
      value.transformer_id !== TRANSFORMER_ID ||
      !["snapshot", "versioned_cursor_refusal", COMPLETE_TRAVERSAL_POLICY].includes(
        value.policy
      ) ||
      !SHA256.test(value.source_set_sha256 ?? "") ||
      value.ordered_occurrences === null || typeof value.ordered_occurrences !== "object" ||
      Array.isArray(value.ordered_occurrences) ||
      value.projections === null || typeof value.projections !== "object" ||
      Array.isArray(value.projections)) fail(
    "projection_result_shape_invalid",
    "captured mutation pagination projection does not match its registered result schema"
  );
  for (const [name, references] of Object.entries(value.projections)) {
    if (!PROJECTION_NAMES.includes(name) || !Array.isArray(references) ||
        !sortedUnique(references) || references.some((reference) =>
          typeof reference !== "string" || !reference.startsWith("ref-"))) fail(
      "projection_result_shape_invalid",
      "mutation pagination projected populations must be registered sorted reference sets",
      { population_id: name }
    );
    if (SINGLETON_PROJECTIONS.has(name) && references.length !== 1) fail(
      "projection_singleton_cardinality_invalid",
      "registered singleton pagination projections must contain exactly one reference",
      { population_id: name }
    );
  }
  for (const [name, values] of Object.entries(value.ordered_occurrences)) {
    if (!Array.isArray(values) || new Set(values).size !== values.length ||
        values.some((reference) => typeof reference !== "string" ||
          !reference.startsWith("ref-"))) fail(
      "projection_ordered_occurrences_invalid",
      "ordered occurrence sequences must preserve distinct occurrence references",
      { sequence: name }
    );
  }
  return value;
}

const projections = Object.freeze(Object.fromEntries(PROJECTION_NAMES.map((name) => [
  name,
  Object.freeze({
    cardinality: SINGLETON_PROJECTIONS.has(name) ? "singleton" : "set",
    project(value) {
      const references = value.projections[name];
      if (!Array.isArray(references)) fail(
        "projection_population_unavailable_for_policy",
        "the selected pagination policy does not expose the requested projection",
        { population_id: name, policy: value.policy }
      );
      return references;
    }
  })
])));

const MUTATION_PAGINATION_TRACE_TRANSFORMER = Object.freeze({
  transformer_id: TRANSFORMER_ID,
  source_count: 5,
  parse_sources: parseSources,
  transform,
  validate_result: validateResult,
  projections
});

export {
  MUTATION_PAGINATION_TRACE_TRANSFORMER,
  RESULT_VERSION as MUTATION_PAGINATION_PROJECTION_VERSION,
  TRACE_VERSION as MUTATION_PAGINATION_TRACE_VERSION,
  TRANSFORMER_ID as MUTATION_PAGINATION_TRACE_TRANSFORMER_ID,
  COMPLETE_TRAVERSAL_RESOURCE_LIMITS,
  assertCompleteTraversalResourceUsage,
  completeTraversalOccurrenceId,
  occurrenceId as mutationPaginationOccurrenceId
};
