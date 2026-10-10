import {
  ATTEMPT_EVENT_KINDS,
  ATTEMPT_JOURNAL_REFUSALS,
  MANAGED_WORKER_ATTEMPT_JOURNAL_SCHEMA_VERSION,
  attemptJournalRefusal,
  attemptKey,
  canonicalJson,
  digestOf,
  sameAttempt,
  validateAttemptJournal
} from "./managed-worker-attempt-journal.mjs";

export const MANAGED_ATTEMPT_CURSOR_SCHEMA_VERSION = "managed-attempt-observation-cursor.v1";
export const MANAGED_ATTEMPT_DETAIL_KINDS = Object.freeze(["failure_history", "attempts", "proof_verification"]);
export const MANAGED_ATTEMPT_PROOF_VERIFICATION_SUMMARY_SCHEMA_VERSION =
  "managed-attempt-proof-verification-summary.v1";

function dispatchBinding(events, attempt) {
  return events.find((event) => event.kind === ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED &&
    sameAttempt(event.attempt, attempt))?.payload?.dispatch_tuple ?? null;
}

export function projectManagedAttemptObservations({ repository, subject, events }) {
  const validated = validateAttemptJournal({ repository, subject, events });
  if (!validated.valid) return { ok: false, refusal: validated.refusal };
  const byAttempt = new Map();
  for (const event of validated.events) {
    const key = attemptKey(event.attempt);
    let item = byAttempt.get(key);
    if (!item) {
      item = {
        attempt: event.attempt,
        dispatch_tuple: null,
        released: false,
        last_lifecycle_kind: null,
        result: null,
        result_digest: null,
        original_result: null,
        failures: [],
        proof_verifications: [],
        delivery_receipts: []
      };
      byAttempt.set(key, item);
    }
    if (event.kind === ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED) {
      item.dispatch_tuple = event.payload.dispatch_tuple ?? null;
    } else if (event.kind === ATTEMPT_EVENT_KINDS.RUN_RESULT_RECORDED) {
      item.result = event.payload.result;
      item.result_digest = event.payload.result_digest;
    } else if (event.kind === ATTEMPT_EVENT_KINDS.RUN_ORIGINAL_RECORDED) {
      item.original_result = event.payload.original_result;
    } else if (event.kind === ATTEMPT_EVENT_KINDS.PROOF_VERIFICATION_RECORDED) {
      item.proof_verifications.push(Object.freeze({
        invocation_id: event.payload.invocation_id,
        verification: event.payload.verification,
        sequence: event.sequence,
        digest: event.digest
      }));
    } else if (event.kind === ATTEMPT_EVENT_KINDS.DELIVERY_RECEIPT_RECORDED) {
      item.delivery_receipts.push(Object.freeze({ receipt: event.payload.receipt,
        sequence: event.sequence, digest: event.digest }));
    } else if (event.kind === ATTEMPT_EVENT_KINDS.LIFECYCLE_FAILURE_RECORDED) {
      item.failures.push(Object.freeze({
        invocation_id: event.payload.invocation_id,
        failure: event.payload.failure,
        sequence: event.sequence,
        digest: event.digest
      }));
    } else {
      item.last_lifecycle_kind = event.kind;
      if (event.kind === ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED) item.released = true;
    }
  }
  return {
    ok: true,
    attempts: Object.freeze([...byAttempt.values()].map((item) => Object.freeze({
      ...item,
      failures: Object.freeze(item.failures),
      proof_verifications: Object.freeze(item.proof_verifications),
      delivery_receipts: Object.freeze(item.delivery_receipts)
    }))),
    prefix: Object.freeze({
      sequence: validated.events.length - 1,
      digest: validated.terminal_digest,
      event_count: validated.events.length
    })
  };
}

const ATTEMPT_SELECTION_REFUSAL_CODES = Object.freeze(new Set([
  "attempt_selector_mismatch", "attempt_selection_ambiguous", "attempt_observation_unavailable"]));
export function isManagedAttemptSelectionRefusal(observation) {
  return observation?.ok === false && ATTEMPT_SELECTION_REFUSAL_CODES.has(observation.code);
}

export function managedObservationFailureFacts(observation) {
  if (observation === null || typeof observation !== "object" || observation.ok !== false) return observation;
  const { events: _events, attempts: _attempts, prefix: _prefix, repository: _repository, ...facts } = observation;
  return facts;
}

export function selectManagedAttempt({ repository, subject, events, attemptId = null }) {
  const projected = projectManagedAttemptObservations({ repository, subject, events });
  if (!projected.ok) return projected;
  const candidates = projected.attempts.filter((item) => item.dispatch_tuple !== null);
  if (attemptId !== null) {
    const selected = candidates.find((item) => item.dispatch_tuple.run_id === attemptId) ?? null;
    return selected === null
      ? { ok: false, code: "attempt_selector_mismatch", attempts: projected.attempts, prefix: projected.prefix }
      : { ok: true, selected, attempts: projected.attempts, prefix: projected.prefix };
  }
  const unreleased = candidates.filter((item) => !item.released);
  if (unreleased.length === 1) {
    return { ok: true, selected: unreleased[0], attempts: projected.attempts, prefix: projected.prefix };
  }
  if (unreleased.length > 1 || (unreleased.length === 0 && candidates.length > 1)) {
    return { ok: false, code: "attempt_selection_ambiguous", attempts: projected.attempts, prefix: projected.prefix };
  }
  if (candidates.length === 1) {
    return { ok: true, selected: candidates[0], attempts: projected.attempts, prefix: projected.prefix };
  }
  const pending = projected.attempts.filter((item) => !item.released && item.dispatch_tuple === null);
  if (pending.length === 1) {
    return { ok: true, selected: pending[0], attempts: projected.attempts, prefix: projected.prefix, indeterminate: true };
  }
  return { ok: false, code: "attempt_observation_unavailable", attempts: projected.attempts, prefix: projected.prefix };
}

export function selectManagedAdmissionAttempt({ repository, subject, events }) {
  const projected = projectManagedAttemptObservations({ repository, subject, events });
  if (!projected.ok) return projected;
  const unreleased = projected.attempts.filter((item) => !item.released);
  if (unreleased.length > 1) {
    return { ok: false, code: "attempt_selection_ambiguous", attempts: projected.attempts, prefix: projected.prefix };
  }
  return {
    ok: true,
    selected: unreleased[0] ?? null,
    attempts: projected.attempts,
    prefix: projected.prefix,
    indeterminate: unreleased[0]?.dispatch_tuple === null
  };
}

function encodeCursor(payload) {
  const unsigned = { schema_version: MANAGED_ATTEMPT_CURSOR_SCHEMA_VERSION, ...payload };
  return Buffer.from(canonicalJson({ ...unsigned, checksum: digestOf(unsigned) }), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const { checksum, ...unsigned } = value;
    if (unsigned.schema_version !== MANAGED_ATTEMPT_CURSOR_SCHEMA_VERSION || checksum !== digestOf(unsigned)) return null;
    return unsigned;
  } catch {
    return null;
  }
}

function compactTestedSource(testedSource) {
  if (testedSource === null || typeof testedSource !== "object") return null;
  return Object.freeze({
    wk_id: testedSource.wk_id ?? null,
    selected_unit: testedSource.selected_unit ?? null,
    focus: testedSource.focus ?? null,
    candidate: testedSource.candidate ?? null,
    source_snapshot_digest: testedSource.source_snapshot_digest ?? null,
    contract_generation: testedSource.contract_generation ?? null,
    canonical_contract_digest: testedSource.canonical_contract_digest ?? null,
    contract_digest: testedSource.contract_digest ?? null,
    binding_digest: testedSource.binding_digest ?? null
  });
}

export const PROOF_VERIFICATION_RECORD_INVALID = "proof_verification_record_invalid";

export function recordedProofVerificationOutcomeSummary(verification) {
  if (verification?.evidence?.kind !== "aggregate") return Object.freeze({ ok: true });
  const value = Object.hasOwn(verification, "outcome_summary") ? verification.outcome_summary : undefined;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.freeze({ ok: true, outcome_summary: value });
  }
  return Object.freeze({
    ok: false,
    code: PROOF_VERIFICATION_RECORD_INVALID,
    field: "verification.outcome_summary",
    reason: value === undefined ? "missing" : "invalid_type"
  });
}

function summarizeLastRecordedInvocation(item) {
  if (item === null) return null;
  const verification = item.verification ?? {};
  const recorded = recordedProofVerificationOutcomeSummary(verification);
  if (!recorded.ok) return recorded;
  return Object.freeze({
    invocation_id: item.invocation_id,
    sequence: item.sequence,
    event_digest: item.digest,
    record_identity: verification.record_identity ?? null,
    requested_unit: verification.request?.subject ?? null,
    assigned_unit: verification.caller?.assigned_unit ?? null,
    outcome: verification.outcome ?? null,
    status: verification.status ?? null,
    reason_code: verification.reason_code ?? null,
    selected_proof_count: Number.isInteger(verification.counts?.proofs)
      ? verification.counts.proofs : null,
    tested_source: compactTestedSource(verification.tested_source ?? null),
    result_digest: verification.result_digest ?? null,
    ...(Object.hasOwn(recorded, "outcome_summary") ? { outcome_summary: recorded.outcome_summary } : {}),
    coverage_scope: "requested_selection_only",
    grants_authority: false
  });
}

function summarizeProofVerifications(population) {
  const outcomes = {};
  const statuses = {};
  for (const { invocation_id, verification } of population) {
    const current = recordedProofVerificationOutcomeSummary(verification);
    if (!current.ok) return Object.freeze({ ok: false, code: current.code,
      refusal: Object.freeze({ code: current.code, field: current.field,
        reason: current.reason, invocation_id }) });
    const outcome = typeof verification?.outcome === "string" ? verification.outcome : "unknown";
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    const status = typeof verification?.status === "string" ? verification.status : "none";
    statuses[status] = (statuses[status] ?? 0) + 1;
  }
  const lastRecordedInvocation = population.reduce((last, item) =>
    last === null || item.sequence > last.sequence ? item : last, null);
  const last = summarizeLastRecordedInvocation(lastRecordedInvocation);
  if (last !== null && last.ok === false) {
    return Object.freeze({ ok: false, code: last.code, refusal: Object.freeze({
      code: last.code, field: last.field, reason: last.reason,
      invocation_id: lastRecordedInvocation.invocation_id }) });
  }
  return Object.freeze({
    schema_version: MANAGED_ATTEMPT_PROOF_VERIFICATION_SUMMARY_SCHEMA_VERSION,
    recorded_count: population.length,
    outcome_counts: Object.freeze(outcomes),
    status_counts: Object.freeze(statuses),
    last_recorded_invocation: last
  });
}

export function pageManagedAttemptDetail({
  repository,
  subject,
  events,
  attemptId,
  kind,
  cursor = null,
  limit = 20,
  invocationId = null,
  complete = false
}) {
  if (!MANAGED_ATTEMPT_DETAIL_KINDS.includes(kind) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, code: "attempt_detail_request_invalid" };
  }

  if (invocationId !== null && (kind !== "proof_verification" || cursor !== null ||
      typeof invocationId !== "string" || invocationId.length === 0)) {
    return { ok: false, code: "attempt_detail_request_invalid" };
  }
  const selection = selectManagedAttempt({ repository, subject, events, attemptId });
  if (!selection.ok && !(kind === "attempts" && selection.code === "attempt_selection_ambiguous")) return selection;
  if (invocationId !== null) {
    const recorded = selection.selected?.proof_verifications ?? [];
    const item = recorded.find((entry) => entry.invocation_id === invocationId) ?? null;
    if (item === null) return { ok: false, code: "proof_verification_invocation_unknown" };
    const summary = summarizeProofVerifications(recorded);
    if (summary.ok === false) return summary;
    return Object.freeze({
      ok: true,
      kind,
      attempt_id: selection.selected?.dispatch_tuple?.run_id ?? attemptId,
      invocation_id: invocationId,
      total_count: recorded.length,
      returned_count: 1,
      items: Object.freeze([item]),
      summary,
      snapshot: selection.prefix,
      cursor: null
    });
  }
  let offset = 0;
  let prefix = selection.prefix;
  if (cursor !== null) {
    const decoded = typeof cursor === "string" ? decodeCursor(cursor) : null;
    if (!decoded || decoded.repository !== repository || decoded.subject !== subject ||
        decoded.attempt_id !== attemptId || decoded.kind !== kind || !Number.isInteger(decoded.offset) || decoded.offset < 0) {
      return { ok: false, code: "attempt_detail_cursor_invalid" };
    }
    const observed = events[decoded.prefix_sequence];
    if (!observed || observed.digest !== decoded.prefix_digest) {
      return { ok: false, code: "attempt_detail_snapshot_unavailable" };
    }
    prefix = { sequence: decoded.prefix_sequence, digest: decoded.prefix_digest, event_count: decoded.prefix_sequence + 1 };
    offset = decoded.offset;
    const bounded = events.slice(0, prefix.event_count);
    const replayed = selectManagedAttempt({ repository, subject, events: bounded, attemptId });
    if (!replayed.ok && !(kind === "attempts" && replayed.code === "attempt_selection_ambiguous")) return replayed;
    selection.selected = replayed.selected;
    selection.attempts = replayed.attempts;
  }
  const population = kind === "attempts"
    ? selection.attempts.map((item) => Object.freeze({
        attempt_id: item.dispatch_tuple?.run_id ?? null,
        dispatch_tuple: item.dispatch_tuple,
        released: item.released,
        last_lifecycle_kind: item.last_lifecycle_kind,
        result_recorded: item.result !== null,
        failure_total: item.failures.length,
        proof_verification_total: item.proof_verifications.length
      }))
    : kind === "proof_verification"
      ? (selection.selected?.proof_verifications ?? [])
      : (selection.selected?.failures ?? []);
  const summary = kind === "proof_verification" ? summarizeProofVerifications(population) : null;
  if (summary?.ok === false) return summary;
  const items = Object.freeze(population.slice(offset, complete ? undefined : offset + limit));
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < population.length;
  return Object.freeze({
    ok: true,
    kind,
    attempt_id: kind === "attempts"
      ? attemptId
      : selection.selected?.dispatch_tuple?.run_id ?? attemptId,
    total_count: population.length,
    returned_count: items.length,
    items,
    ...(summary === null ? {} : { summary }),
    snapshot: prefix,
    cursor: hasMore ? encodeCursor({
      repository,
      subject,
      attempt_id: attemptId,
      kind,
      prefix_sequence: prefix.sequence,
      prefix_digest: prefix.digest,
      offset: nextOffset
    }) : null
  });
}

export function resultDigest(result) {
  return digestOf(result);
}

export const MANAGED_REVIEW_ORIGINAL_BINDING_SCHEMA_VERSION = "managed-review-original-binding.v1";
const REVIEW_ORIGINAL_ENVELOPE_KEYS = Object.freeze(["schema_version", "repository", "subject", "sequence",
  "prior_digest", "binding", "digest"]);
const REVIEW_ORIGINAL_ROLES = Object.freeze(new Set(["reviewer", "redteam"]));

export function reviewOriginalPartitionSubject(subject) {
  return `review-original:${subject}`;
}

const hasExactKeys = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

function isValidReviewOriginalBinding(binding) {
  return hasExactKeys(binding, ["run_id", "role", "original_result"]) &&
    typeof binding.run_id === "string" && binding.run_id.length > 0 && REVIEW_ORIGINAL_ROLES.has(binding.role) &&
    hasExactKeys(binding.original_result, ["ref_id", "sha256"]) &&
    typeof binding.original_result.ref_id === "string" &&
    /^[A-Za-z0-9._-]{1,200}$/u.test(binding.original_result.ref_id) &&
    typeof binding.original_result.sha256 === "string" && /^[a-f0-9]{64}$/u.test(binding.original_result.sha256);
}

function validateReviewOriginalBindings({ repository, subject, events }) {
  const refuse = (code, reason, sequence) => ({ ok: false, refusal: attemptJournalRefusal(code, reason, { sequence }) });
  const bindings = [];
  let priorDigest = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!hasExactKeys(event, REVIEW_ORIGINAL_ENVELOPE_KEYS) ||
        event.schema_version !== MANAGED_REVIEW_ORIGINAL_BINDING_SCHEMA_VERSION) {
      return refuse(ATTEMPT_JOURNAL_REFUSALS.UNEXPECTED_KEYS, "review original binding does not carry the closed envelope", index);
    }
    if (event.repository !== repository || event.subject !== subject || !isValidReviewOriginalBinding(event.binding) ||
        bindings.some((binding) => binding.run_id === event.binding.run_id)) {
      return refuse(ATTEMPT_JOURNAL_REFUSALS.BINDING_MISMATCH, "review original binding is invalid for this repository, subject or attempt", index);
    }
    if (event.sequence !== index || event.prior_digest !== priorDigest) {
      return refuse(ATTEMPT_JOURNAL_REFUSALS.CHAIN_BROKEN, "review original binding does not chain to its predecessor", index);
    }
    const { digest, ...unsigned } = event;
    if (digestOf(unsigned) !== digest) {
      return refuse(ATTEMPT_JOURNAL_REFUSALS.DIGEST_MISMATCH, "review original binding digest does not match its content", index);
    }
    bindings.push(event.binding);
    priorDigest = digest;
  }
  return { ok: true, bindings, terminal_digest: priorDigest };
}

export function admitReviewOriginalBinding({ repository, subject, events, binding }) {
  const validated = validateReviewOriginalBindings({ repository, subject, events });
  if (!validated.ok) return { admitted: false, refusal: validated.refusal };
  if (!isValidReviewOriginalBinding(binding)) {
    return { admitted: false, refusal: attemptJournalRefusal(ATTEMPT_JOURNAL_REFUSALS.BINDING_MISMATCH,
      "review original binding attempt, role or locator is invalid") };
  }
  const existing = validated.bindings.find((recorded) => recorded.run_id === binding.run_id) ?? null;
  if (existing !== null) {
    return canonicalJson(existing) === canonicalJson(binding)
      ? { admitted: true, appended: false, events }
      : { admitted: false, refusal: attemptJournalRefusal(ATTEMPT_JOURNAL_REFUSALS.BINDING_MISMATCH,
        "review original binding conflicts with the binding already recorded for this attempt") };
  }
  const unsigned = { schema_version: MANAGED_REVIEW_ORIGINAL_BINDING_SCHEMA_VERSION, repository, subject,
    sequence: events.length, prior_digest: validated.terminal_digest,
    binding: { run_id: binding.run_id, role: binding.role,
      original_result: { ref_id: binding.original_result.ref_id, sha256: binding.original_result.sha256 } } };
  return { admitted: true, appended: true,
    events: [...events, Object.freeze({ ...unsigned, digest: digestOf(unsigned) })] };
}

export function selectReviewOriginalBinding({ repository, subject, events, attemptId = null }) {
  const validated = validateReviewOriginalBindings({ repository, subject, events });
  if (!validated.ok) return validated;
  if (attemptId !== null) {
    const review = validated.bindings.find((binding) => binding.run_id === attemptId) ?? null;
    return review === null ? { ok: false, code: "attempt_selector_mismatch" } : { ok: true, review };
  }
  if (validated.bindings.length === 1) return { ok: true, review: validated.bindings[0] };
  return { ok: false, code: validated.bindings.length > 1 ? "attempt_selection_ambiguous"
    : "attempt_observation_unavailable" };
}
