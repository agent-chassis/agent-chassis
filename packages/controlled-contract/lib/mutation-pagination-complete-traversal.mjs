import {
  ExactBindingError,
  canonicalJsonBytes,
  compareCodeUnits,
  sha256
} from "./deterministic-projection-primitives.mjs";
import { POLICY_RESOURCE_LIMITS } from "./resource-policy.mjs";
import { completeTraversalOccurrenceId } from "./stable-occurrence-identity.mjs";

const TRANSFORMER_ID = "mutation-pagination-trace.v1";
const COMPLETE_POPULATION_VERSION =
  "controlled-contract.authoritative-ordered-occurrence-population.v1";
const COMPLETE_EQUALITY_VERSION = "controlled-contract.pagination-equality-policy.v1";
const COMPLETE_RESOURCE_VERSION = "controlled-contract.pagination-resource-policy.v1";
const COMPLETE_TRAVERSAL_RESOURCE_LIMITS = Object.freeze({
  aggregate_input_bytes: POLICY_RESOURCE_LIMITS.verified_input_bytes.limit,
  canonical_result_bytes: POLICY_RESOURCE_LIMITS.successful_output_bytes.limit,
  work_units: POLICY_RESOURCE_LIMITS.universal_occurrences.limit
});
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;

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

function ref(value) { return `ref-${value}`; }

function assertCompleteTraversalResourceUsage({
  aggregate_input_bytes: aggregateInputBytes,
  canonical_result_bytes: canonicalResultBytes,
  work_units: workUnits
}) {
  for (const [name, value] of Object.entries({
    aggregate_input_bytes: aggregateInputBytes,
    canonical_result_bytes: canonicalResultBytes,
    work_units: workUnits
  })) if (!Number.isSafeInteger(value) || value < 0) fail(
    "complete_traversal_resource_measure_invalid",
    "complete-traversal resource measures must be nonnegative safe integers",
    { resource: name }
  );
  if (workUnits > COMPLETE_TRAVERSAL_RESOURCE_LIMITS.work_units) fail(
    "complete_traversal_work_limit_exceeded",
    "complete-traversal monotone work exceeds 1,000,000 units",
    { resource: "work_units", observed: workUnits,
      limit: COMPLETE_TRAVERSAL_RESOURCE_LIMITS.work_units }
  );
  if (canonicalResultBytes > COMPLETE_TRAVERSAL_RESOURCE_LIMITS.canonical_result_bytes) fail(
    "complete_traversal_canonical_result_limit_exceeded",
    "complete-traversal canonical result exceeds 64 MiB",
    { resource: "canonical_result_bytes", observed: canonicalResultBytes,
      limit: COMPLETE_TRAVERSAL_RESOURCE_LIMITS.canonical_result_bytes }
  );
  if (aggregateInputBytes > COMPLETE_TRAVERSAL_RESOURCE_LIMITS.aggregate_input_bytes) fail(
    "complete_traversal_aggregate_input_limit_exceeded",
    "complete-traversal aggregate canonical input exceeds 64 MiB",
    { resource: "aggregate_input_bytes", observed: aggregateInputBytes,
      limit: COMPLETE_TRAVERSAL_RESOURCE_LIMITS.aggregate_input_bytes }
  );
  return true;
}

function assertOpaqueCursor(value, digestValue, field) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") ||
      value !== value.normalize("NFC")) fail(
    "complete_traversal_cursor_unknown",
    "complete-traversal cursors must be nonempty opaque NFC strings", { field }
  );
  assertDigest(digestValue, `${field}_sha256`);
  if (sha256(Buffer.from(value, "utf8")) !== digestValue) fail(
    "complete_traversal_cursor_substitution",
    "the presented opaque cursor does not match its captured digest", { field }
  );
}

function completeTraversalProjection(trace, sourceValues, sourceDigests) {
  const [population, authentication, equalityPolicy, resourcePolicy] =
    sourceValues.slice(1);
  if (!exactKeys(population, [
    "schema_version", "source_grounded_identity_sha256", "occurrences"
  ]) || population.schema_version !== COMPLETE_POPULATION_VERSION ||
      !Array.isArray(population.occurrences)) fail(
    "complete_traversal_authoritative_population_invalid",
    "the authenticated authoritative ordered-occurrence population has a closed shape"
  );
  assertDigest(population.source_grounded_identity_sha256,
    "authoritative_population.source_grounded_identity_sha256");
  if (authentication?.schema_version !==
      "controlled-contract.authentication-provenance-occurrence-capture.v1" ||
      authentication?.transformer_id !==
      "authentication-provenance-occurrence-capture.v1" ||
      !exactKeys(authentication.roles ?? {}, [
        "evidence_occurrence", "observation_attempt", "source", "target"
      ])) fail(
    "complete_traversal_authentication_binding_invalid",
    "the authoritative population requires one package-authenticated occurrence capture"
  );
  if (authentication.evidence_content_sha256 !== sourceDigests[1] ||
      authentication.roles.source.grounded_identity_sha256 !==
        population.source_grounded_identity_sha256) fail(
    "complete_traversal_source_authentication_mismatch",
    "the authentication occurrence must bind the exact population bytes and source identity"
  );
  if (!exactKeys(equalityPolicy, [
    "schema_version", "normalization_owner", "equivalence"
  ]) || equalityPolicy.schema_version !== COMPLETE_EQUALITY_VERSION ||
      equalityPolicy.normalization_owner !== "equality-normalization-v034.mjs" ||
      equalityPolicy.equivalence !== "exact-equality-key") fail(
    "complete_traversal_equality_policy_invalid",
    "complete traversal must bind the package-owned exact equality normalization policy"
  );
  if (!exactKeys(resourcePolicy, [
    "schema_version", "accounting_owner", "aggregate_input_bytes_limit",
    "canonical_result_bytes_limit", "work_formula", "work_units_limit"
  ]) || resourcePolicy.schema_version !== COMPLETE_RESOURCE_VERSION ||
      resourcePolicy.accounting_owner !== "mutation-pagination-trace-projection.mjs" ||
      resourcePolicy.aggregate_input_bytes_limit !==
        COMPLETE_TRAVERSAL_RESOURCE_LIMITS.aggregate_input_bytes ||
      resourcePolicy.canonical_result_bytes_limit !==
        COMPLETE_TRAVERSAL_RESOURCE_LIMITS.canonical_result_bytes ||
      resourcePolicy.work_units_limit !== COMPLETE_TRAVERSAL_RESOURCE_LIMITS.work_units ||
      resourcePolicy.work_formula !==
        "authoritative_occurrences+returned_occurrences+pages+transitions") fail(
    "complete_traversal_resource_policy_invalid",
    "complete traversal must bind the fixed package-owned resource accounting policy"
  );

  const traceKeys = [
    "schema_version", "policy", "traversal_id", "canonical_initial_state",
    "snapshot_id", "version_id", "pages", "transitions", "terminal_page_id",
    "authentication_target_grounded_identity_sha256", "source_bindings"
  ];
  if (!exactKeys(trace, traceKeys)) fail(
    "complete_traversal_trace_invalid",
    "complete-traversal traces have one closed pages-and-transitions shape"
  );
  for (const key of ["traversal_id", "snapshot_id", "version_id", "terminal_page_id"]) {
    assertId(trace[key], key);
  }
  assertDigest(trace.authentication_target_grounded_identity_sha256,
    "authentication_target_grounded_identity_sha256");
  if (trace.canonical_initial_state !== true) fail(
    "complete_traversal_initial_state_noncanonical",
    "complete traversal must begin at the canonical initial state"
  );
  if (!exactKeys(trace.source_bindings, [
    "authoritative_population_sha256", "authentication_capture_sha256",
    "equality_policy_sha256", "resource_policy_sha256"
  ]) || JSON.stringify([
    trace.source_bindings.authoritative_population_sha256,
    trace.source_bindings.authentication_capture_sha256,
    trace.source_bindings.equality_policy_sha256,
    trace.source_bindings.resource_policy_sha256
  ]) !==
      JSON.stringify(sourceDigests.slice(1))) fail(
    "complete_traversal_source_binding_mismatch",
    "the trace must bind every exact package-authenticated source in canonical order"
  );
  if (authentication.roles.target.grounded_identity_sha256 !==
      trace.authentication_target_grounded_identity_sha256) fail(
    "complete_traversal_authentication_target_mismatch",
    "the authenticated occurrence target must be the exact authoritative population target"
  );

  const authoritative = [];
  const authoritativeBySourceId = new Map();
  const equalityKeys = new Set();
  for (const [index, member] of population.occurrences.entries()) {
    const field = `authoritative_population.occurrences[${index}]`;
    if (!exactKeys(member, [
      "source_occurrence_id", "equality_key", "content_sha256"
    ])) fail(
      "complete_traversal_authoritative_occurrence_invalid",
      "authoritative occurrences have a closed stable-identity shape", { field }
    );
    assertId(member.source_occurrence_id, `${field}.source_occurrence_id`);
    assertId(member.equality_key, `${field}.equality_key`);
    assertDigest(member.content_sha256, `${field}.content_sha256`);
    if (authoritativeBySourceId.has(member.source_occurrence_id)) fail(
      "complete_traversal_authoritative_identity_duplicate",
      "authoritative source occurrence identities must be unique", { field }
    );
    if (equalityKeys.has(member.equality_key)) fail(
      "complete_traversal_equality_ambiguity",
      "equality-normalized authoritative occurrences must remain unambiguous", { field }
    );
    equalityKeys.add(member.equality_key);
    const occurrenceId = completeTraversalOccurrenceId(
      population.source_grounded_identity_sha256, member.source_occurrence_id
    );
    const normalized = { ...member, occurrence_id: occurrenceId };
    authoritative.push(normalized);
    authoritativeBySourceId.set(member.source_occurrence_id, normalized);
  }

  if (!Array.isArray(trace.pages) || trace.pages.length === 0 ||
      !Array.isArray(trace.transitions)) fail(
    "complete_traversal_page_population_incomplete",
    "complete traversal requires the complete nonempty page and transition populations"
  );
  const pageIds = new Set();
  const returned = [];
  for (const [index, page] of trace.pages.entries()) {
    const field = `pages[${index}]`;
    if (!exactKeys(page, [
      "page_id", "request_cursor", "request_cursor_sha256", "next_cursor",
      "next_cursor_sha256", "snapshot_id", "version_id", "terminal",
      "member_occurrences"
    ]) || typeof page.terminal !== "boolean" || !Array.isArray(page.member_occurrences)) fail(
      "complete_traversal_page_invalid", "complete-traversal pages have a closed shape",
      { field }
    );
    assertId(page.page_id, `${field}.page_id`);
    if (pageIds.has(page.page_id)) fail(
      "complete_traversal_page_identity_duplicate", "page identities must be unique", { field }
    );
    pageIds.add(page.page_id);
    if (page.request_cursor === null) {
      if (page.request_cursor_sha256 !== null) fail(
        "complete_traversal_cursor_substitution",
        "a null initial cursor must have a null digest", { field }
      );
    } else assertOpaqueCursor(page.request_cursor, page.request_cursor_sha256,
      `${field}.request_cursor`);
    if (page.next_cursor === null) {
      if (page.next_cursor_sha256 !== null) fail(
        "complete_traversal_cursor_substitution",
        "a null terminal cursor must have a null digest", { field }
      );
    } else assertOpaqueCursor(page.next_cursor, page.next_cursor_sha256,
      `${field}.next_cursor`);
    if (page.snapshot_id !== trace.snapshot_id) fail(
      "complete_traversal_snapshot_drift",
      "every traversal page must preserve one snapshot identity", { field }
    );
    if (page.version_id !== trace.version_id) fail(
      "complete_traversal_version_drift",
      "every traversal page must preserve one source version identity", { field }
    );
    for (const [memberIndex, member] of page.member_occurrences.entries()) {
      const memberField = `${field}.member_occurrences[${memberIndex}]`;
      if (!exactKeys(member, [
        "occurrence_id", "source_occurrence_id", "reference_id", "equality_key",
        "content_sha256"
      ]) || typeof member.reference_id !== "string" ||
          !member.reference_id.startsWith("ref-") ||
          member.reference_id !== member.reference_id.normalize("NFC")) fail(
        "complete_traversal_returned_occurrence_invalid",
        "returned occurrences have one closed reference-renaming-invariant shape",
        { field: memberField }
      );
      assertId(member.source_occurrence_id, `${memberField}.source_occurrence_id`);
      assertId(member.equality_key, `${memberField}.equality_key`);
      assertDigest(member.content_sha256, `${memberField}.content_sha256`);
      const expected = authoritativeBySourceId.get(member.source_occurrence_id);
      if (!expected) fail(
        "complete_traversal_occurrence_extra",
        "returned occurrences outside the authenticated authoritative population are extras",
        { field: memberField }
      );
      if (member.occurrence_id !== expected.occurrence_id) fail(
        "complete_traversal_occurrence_identity_mismatch",
        "occurrence identity must derive from authenticated source identity and stable source occurrence identity",
        { field: memberField }
      );
      if (member.equality_key !== expected.equality_key ||
          member.content_sha256 !== expected.content_sha256) fail(
        "complete_traversal_occurrence_substitution",
        "returned occurrence content and equality identity must match the authoritative member",
        { field: memberField }
      );
      returned.push(member);
    }
  }

  if (trace.pages[0].request_cursor !== null) fail(
    "complete_traversal_initial_state_noncanonical",
    "the first page request must use the canonical null cursor"
  );
  const terminalIndexes = trace.pages.flatMap((page, index) => page.terminal ? [index] : []);
  if (terminalIndexes.length !== 1) fail(
    "complete_traversal_terminal_not_unique",
    "complete traversal must contain exactly one terminal page"
  );
  const terminalIndex = terminalIndexes[0];
  if (terminalIndex < trace.pages.length - 1) fail(
    "complete_traversal_post_terminal_request",
    "no page request may occur after the terminal observation"
  );
  const terminal = trace.pages[terminalIndex];
  if (terminal.page_id !== trace.terminal_page_id || terminal.next_cursor !== null) fail(
    "complete_traversal_early_terminal",
    "the unique declared terminal page must close the exact traversal"
  );

  const producedCursorCounts = new Map();
  for (const page of trace.pages.slice(0, -1)) producedCursorCounts.set(
    page.next_cursor, (producedCursorCounts.get(page.next_cursor) ?? 0) + 1
  );
  if ([...producedCursorCounts.values()].some((count) => count > 1)) fail(
    "complete_traversal_cursor_fork",
    "one opaque cursor identity may be produced by exactly one page"
  );
  const consumed = new Set();
  for (let index = 1; index < trace.pages.length; index += 1) {
    const page = trace.pages[index];
    const expected = trace.pages[index - 1].next_cursor;
    if (page.request_cursor === expected) {
      consumed.add(page.request_cursor);
      continue;
    }
    if (consumed.has(page.request_cursor)) fail(
      "complete_traversal_cursor_replay", "a consumed cursor cannot be replayed"
    );
    if (trace.pages.slice(index).some(
      ({ next_cursor: nextCursor }) => nextCursor === page.request_cursor
    )) fail("complete_traversal_cursor_skip", "a cursor cannot skip a page transition");
    if (trace.pages.some(({ next_cursor: nextCursor }) =>
      nextCursor === page.request_cursor)) fail(
      "complete_traversal_cursor_replay", "a non-adjacent prior cursor cannot be replayed"
    );
    fail("complete_traversal_cursor_unknown",
      "a page request must present the exact immediately preceding opaque cursor");
  }
  if (trace.pages.at(-1).terminal === false ||
      trace.pages.at(-1).next_cursor !== null) fail(
    "complete_traversal_cursor_dangling",
    "a nonterminal final cursor must not be left without its next request"
  );

  const transitionKeys = new Set();
  for (const [index, transition] of trace.transitions.entries()) {
    const field = `transitions[${index}]`;
    if (!exactKeys(transition, [
      "transition_id", "from_page_id", "to_page_id", "cursor_sha256"
    ])) fail(
      "complete_traversal_transition_invalid", "cursor transitions have a closed shape",
      { field }
    );
    for (const key of ["transition_id", "from_page_id", "to_page_id"]) {
      assertId(transition[key], `${field}.${key}`);
    }
    assertDigest(transition.cursor_sha256, `${field}.cursor_sha256`);
    const expectedFrom = trace.pages[index];
    const expectedTo = trace.pages[index + 1];
    if (!expectedFrom || !expectedTo ||
        transition.from_page_id !== expectedFrom.page_id ||
        transition.to_page_id !== expectedTo.page_id ||
        transition.cursor_sha256 !== expectedFrom.next_cursor_sha256 ||
        transition.cursor_sha256 !== expectedTo.request_cursor_sha256) fail(
      "complete_traversal_cursor_dangling",
      "every and only adjacent pages must be joined by their exact cursor transition",
      { field }
    );
    if (transitionKeys.has(transition.transition_id)) fail(
      "complete_traversal_cursor_fork", "transition identities must be unique", { field }
    );
    transitionKeys.add(transition.transition_id);
  }
  if (trace.transitions.length !== trace.pages.length - 1) fail(
    "complete_traversal_cursor_dangling",
    "the complete linear page chain requires exactly one transition per boundary"
  );

  const returnedIds = returned.map(({ occurrence_id: occurrenceId }) => occurrenceId);
  if (new Set(returnedIds).size !== returnedIds.length) fail(
    "complete_traversal_returned_occurrence_duplicate",
    "the traversal must return every occurrence at most once"
  );
  const authoritativeIds = authoritative.map(({ occurrence_id: occurrenceId }) => occurrenceId);
  const returnedSet = new Set(returnedIds);
  if (authoritativeIds.some((occurrenceId) => !returnedSet.has(occurrenceId))) fail(
    returnedIds.every((occurrenceId, index) => occurrenceId === authoritativeIds[index])
      ? "complete_traversal_early_terminal"
      : "complete_traversal_occurrence_missing",
    "the traversal terminated before returning the complete authoritative population"
  );
  if (returnedIds.length > authoritativeIds.length) fail(
    "complete_traversal_occurrence_extra",
    "the traversal returned an occurrence outside the authoritative population"
  );
  if (JSON.stringify(returnedIds) !== JSON.stringify(authoritativeIds)) fail(
    "complete_traversal_order_mismatch",
    "concatenated page occurrences must equal the authoritative ordered sequence exactly"
  );

  const workUnits = authoritative.length + returned.length + trace.pages.length +
    trace.transitions.length;

  assertCompleteTraversalResourceUsage({
    aggregate_input_bytes: 0,
    canonical_result_bytes: 0,
    work_units: workUnits
  });
  const sourceSetSha256 = sha256(canonicalJsonBytes({
    transformer_id: TRANSFORMER_ID, source_content_sha256: sourceDigests
  }));
  const occurrenceReferences = authoritativeIds.map(ref);
  const equalityReferences = authoritative.map(({ equality_key: equalityKey }) =>
    `ref-equality-${sha256(Buffer.from(equalityKey, "utf8"))}`).sort(compareCodeUnits);
  return {
    ordered_occurrences: {
      authoritative_occurrence_ids: occurrenceReferences,
      returned_occurrence_ids: [...occurrenceReferences]
    },
    projections: {
      traversal: [ref(trace.traversal_id)],
      snapshot: [ref(trace.snapshot_id)],
      traversal_source_version: [ref(trace.version_id)],
      authentication_evidence_occurrence: [
        authentication.roles.evidence_occurrence.raw_reference_id
      ],
      authentication_observation_attempt: [
        authentication.roles.observation_attempt.raw_reference_id
      ],
      authenticated_source: [authentication.roles.source.raw_reference_id],
      authoritative_population: [
        `ref-pop-authoritative-population-${sourceSetSha256}`
      ],
      authoritative_occurrences: [...occurrenceReferences].sort(compareCodeUnits),
      returned_pages: [...pageIds].map(ref).sort(compareCodeUnits),
      returned_occurrences: [...occurrenceReferences].sort(compareCodeUnits),
      equality_normalized_members: equalityReferences,
      terminal_page: [ref(terminal.page_id)],
      cursor_transitions: [...transitionKeys].map(ref).sort(compareCodeUnits),
      aggregate_input_accounting: [
        `ref-resource-aggregate-input-${sourceSetSha256}`
      ],
      canonical_result_accounting: [
        `ref-resource-canonical-result-${sourceSetSha256}`
      ],
      work_accounting: [`ref-resource-work-${sourceSetSha256}`]
    },
    work_units: workUnits
  };
}
export {
  COMPLETE_TRAVERSAL_RESOURCE_LIMITS,
  assertCompleteTraversalResourceUsage,
  completeTraversalProjection
};
