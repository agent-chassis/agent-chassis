import {
  ATTEMPT_EVENT_KINDS,
  MANAGED_WORKER_ATTEMPT_JOURNAL_SCHEMA_VERSION,
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
        failures: [],
        proof_verifications: []
      };
      byAttempt.set(key, item);
    }
    if (event.kind === ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED) {
      item.dispatch_tuple = event.payload.dispatch_tuple ?? null;
    } else if (event.kind === ATTEMPT_EVENT_KINDS.RUN_RESULT_RECORDED) {
      item.result = event.payload.result;
      item.result_digest = event.payload.result_digest;
    } else if (event.kind === ATTEMPT_EVENT_KINDS.PROOF_VERIFICATION_RECORDED) {
      item.proof_verifications.push(Object.freeze({
        invocation_id: event.payload.invocation_id,
        verification: event.payload.verification,
        sequence: event.sequence,
        digest: event.digest
      }));
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
      proof_verifications: Object.freeze(item.proof_verifications)
    }))),
    prefix: Object.freeze({
      sequence: validated.events.length - 1,
      digest: validated.terminal_digest,
      event_count: validated.events.length
    })
  };
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

function summarizeLastRecordedInvocation(item) {
  if (item === null) return null;
  const verification = item.verification ?? {};
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
    coverage_scope: "requested_selection_only",
    grants_authority: false
  });
}

function summarizeProofVerifications(population) {
  const outcomes = {};
  const statuses = {};
  for (const { verification } of population) {
    const outcome = typeof verification?.outcome === "string" ? verification.outcome : "unknown";
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    const status = typeof verification?.status === "string" ? verification.status : "none";
    statuses[status] = (statuses[status] ?? 0) + 1;
  }
  const lastRecordedInvocation = population.reduce((last, item) =>
    last === null || item.sequence > last.sequence ? item : last, null);
  return Object.freeze({
    schema_version: MANAGED_ATTEMPT_PROOF_VERIFICATION_SUMMARY_SCHEMA_VERSION,
    recorded_count: population.length,
    outcome_counts: Object.freeze(outcomes),
    status_counts: Object.freeze(statuses),
    last_recorded_invocation: summarizeLastRecordedInvocation(lastRecordedInvocation)
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
  invocationId = null
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
    return Object.freeze({
      ok: true,
      kind,
      attempt_id: selection.selected?.dispatch_tuple?.run_id ?? attemptId,
      invocation_id: invocationId,
      total_count: recorded.length,
      returned_count: 1,
      items: Object.freeze([item]),
      summary: summarizeProofVerifications(recorded),
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
  const items = Object.freeze(population.slice(offset, offset + limit));
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
    ...(kind === "proof_verification" ? { summary: summarizeProofVerifications(population) } : {}),
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
