

import { createHash } from "node:crypto";
import path from "node:path";

export const MANAGED_WORKER_ATTEMPT_JOURNAL_SCHEMA_VERSION =
  "managed-worker-attempt-journal.v1";

export const MANAGED_WORKER_ATTEMPT_PARTITION_VERSION = "v1";

export const ATTEMPT_EVENT_KINDS = Object.freeze({

  RESERVATION_CLAIMED: "reservation_claimed",

  PENDING_PUBLISHED: "pending_published",

  SUPERVISOR_BOUND: "supervisor_bound",

  SPAWN_STARTED: "spawn_started",

  SANDBOX_BOUND: "sandbox_bound",

  EXECUTION_TERMINATED: "execution_terminated",

  DELIVERY_OBSERVED: "delivery_observed",

  INTEGRATION_INTENT: "integration_intent",
  INTEGRATION_GIT_EFFECT: "integration_git_effect",
  INTEGRATION_STATUS_EFFECT: "integration_status_effect",
  INTEGRATION_COMPLETED: "integration_completed",

  ATTEMPT_TERMINAL: "attempt_terminal",

  RESERVATION_RELEASED: "reservation_released"
});

const EVENT_KIND_VALUES = new Set(Object.values(ATTEMPT_EVENT_KINDS));

export const INTEGRATION_EVENT_KINDS = Object.freeze(new Set([
  ATTEMPT_EVENT_KINDS.INTEGRATION_INTENT,
  ATTEMPT_EVENT_KINDS.INTEGRATION_GIT_EFFECT,
  ATTEMPT_EVENT_KINDS.INTEGRATION_STATUS_EFFECT,
  ATTEMPT_EVENT_KINDS.INTEGRATION_COMPLETED
]));

export const ATTEMPT_EXECUTION_LIVENESS = Object.freeze({
  LIVE: "live",
  DEAD: "dead",
  INDETERMINATE: "indeterminate"
});

const LIVENESS_VALUES = new Set(Object.values(ATTEMPT_EXECUTION_LIVENESS));

export const ATTEMPT_RELEASE_PROOFS = Object.freeze({

  EXACT_TERMINAL: "exact_terminal",

  AUTHENTICATED_DEATH: "authenticated_death",

  COMPLETED_DELIVERY: "completed_delivery"
});

const RELEASE_PROOF_VALUES = new Set(Object.values(ATTEMPT_RELEASE_PROOFS));

export const ATTEMPT_NEXT_COMMANDS = Object.freeze({
  CLAIM_RESERVATION: "claim_reservation",
  PUBLISH_PENDING: "publish_pending",
  BIND_SUPERVISOR: "bind_supervisor",
  START_SPAWN: "start_spawn",
  BIND_SANDBOX: "bind_sandbox",
  AWAIT_EXECUTION: "await_execution",
  RECORD_EXECUTION_TERMINATION: "record_execution_termination",

  RUN_INTEGRATION_SETTLEMENT: "run_integration_settlement",
  RECORD_TERMINAL: "record_terminal",
  RELEASE_RESERVATION: "release_reservation",
  NONE: "none"
});

export const ATTEMPT_JOURNAL_REFUSALS = Object.freeze({
  UNKNOWN_SCHEMA_VERSION: "attempt_journal.unknown_schema_version.v1",
  UNKNOWN_EVENT_KIND: "attempt_journal.unknown_event_kind.v1",
  UNEXPECTED_KEYS: "attempt_journal.unexpected_keys.v1",
  SEQUENCE_GAP: "attempt_journal.sequence_gap.v1",
  CHAIN_BROKEN: "attempt_journal.chain_broken.v1",
  DIGEST_MISMATCH: "attempt_journal.digest_mismatch.v1",
  BINDING_MISMATCH: "attempt_journal.binding_mismatch.v1",
  GENERATION_NOT_FROZEN: "attempt_journal.generation_not_frozen.v1",
  WK_TIP_NOT_FROZEN: "attempt_journal.wk_tip_not_frozen.v1",
  ILLEGAL_TRANSITION: "attempt_journal.illegal_transition.v1",
  UNREADABLE: "attempt_journal.unreadable.v1",
  RELEASE_WITHOUT_PROOF: "attempt_journal.release_without_proof.v1",
  LIVENESS_UNAVAILABLE: "attempt_journal.liveness_unavailable.v1"
});

function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
  return out;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function digestOf(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

const EVENT_ENVELOPE_KEYS = Object.freeze([
  "schema_version",
  "repository",
  "subject",
  "attempt",
  "sequence",
  "prior_digest",
  "generation_digest",
  "wk_tip",
  "kind",
  "payload",
  "digest"
]);

const ATTEMPT_TUPLE_KEYS = Object.freeze([
  "assigned_unit",
  "launch_ref",
  "run_id",
  "retry_id"
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== expected.length) return false;
  return expected.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

export function isValidAttemptTuple(tuple) {
  return hasExactKeys(tuple, ATTEMPT_TUPLE_KEYS) &&
    isNonEmptyString(tuple.assigned_unit) &&
    isNonEmptyString(tuple.launch_ref) &&
    isNonEmptyString(tuple.run_id) &&
    Number.isInteger(tuple.retry_id) && tuple.retry_id >= 0;
}

export function sameAttempt(left, right) {
  return left.assigned_unit === right.assigned_unit &&
    left.launch_ref === right.launch_ref &&
    left.run_id === right.run_id &&
    left.retry_id === right.retry_id;
}

export function attemptKey(tuple) {
  return canonicalJson({
    assigned_unit: tuple.assigned_unit,
    launch_ref: tuple.launch_ref,
    run_id: tuple.run_id,
    retry_id: tuple.retry_id
  });
}

export function attemptPartitionId(repository, subject) {
  if (!isNonEmptyString(repository)) throw new Error("repository must be a non-empty string");
  if (!isNonEmptyString(subject)) throw new Error("subject must be a non-empty string");
  const digest = createHash("sha256")
    .update(canonicalJson([
      MANAGED_WORKER_ATTEMPT_JOURNAL_SCHEMA_VERSION,
      MANAGED_WORKER_ATTEMPT_PARTITION_VERSION,
      repository,
      subject
    ]))
    .digest("hex");
  return `${MANAGED_WORKER_ATTEMPT_PARTITION_VERSION}-${digest}`;
}

export function attemptJournalRootDir(mainRepo) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) {
    throw new Error(`mainRepo must be an absolute path, got: ${JSON.stringify(mainRepo)}`);
  }
  return path.join(mainRepo, ".agent-launch", "managed-worker-attempts");
}

export function attemptPartitionDir(mainRepo, repository, subject) {
  return path.join(attemptJournalRootDir(mainRepo), attemptPartitionId(repository, subject));
}

export function attemptJournalFilePath(mainRepo, repository, subject) {
  return path.join(attemptPartitionDir(mainRepo, repository, subject), "journal.jsonl");
}

export function attemptPartitionLockPath(mainRepo, repository, subject) {
  return path.join(attemptPartitionDir(mainRepo, repository, subject), "lock");
}

export function mintAttemptEvent({
  repository,
  subject,
  attempt,
  sequence,
  priorDigest,
  generationDigest,
  wkTip,
  kind,
  payload
}) {
  if (!isNonEmptyString(repository)) throw new Error("repository must be a non-empty string");
  if (!isNonEmptyString(subject)) throw new Error("subject must be a non-empty string");
  if (!isValidAttemptTuple(attempt)) throw new Error("attempt must be a complete launcher-minted tuple");
  if (!Number.isInteger(sequence) || sequence < 0) throw new Error("sequence must be a non-negative integer");
  if (sequence === 0 ? priorDigest !== null : !isNonEmptyString(priorDigest)) {
    throw new Error("sequence 0 must carry a null prior_digest; every later event must carry its predecessor's digest");
  }
  if (!isNonEmptyString(generationDigest)) throw new Error("generationDigest must be a non-empty string");
  if (!isNonEmptyString(wkTip)) throw new Error("wkTip must be a non-empty string");
  if (!EVENT_KIND_VALUES.has(kind)) throw new Error(`unknown attempt event kind: ${JSON.stringify(kind)}`);
  if (!isPlainObject(payload)) throw new Error("payload must be an object");

  const unsigned = {
    schema_version: MANAGED_WORKER_ATTEMPT_JOURNAL_SCHEMA_VERSION,
    repository,
    subject,
    attempt: {
      assigned_unit: attempt.assigned_unit,
      launch_ref: attempt.launch_ref,
      run_id: attempt.run_id,
      retry_id: attempt.retry_id
    },
    sequence,
    prior_digest: priorDigest,
    generation_digest: generationDigest,
    wk_tip: wkTip,
    kind,
    payload
  };
  return Object.freeze({ ...unsigned, digest: digestOf(unsigned) });
}

function recomputeDigest(event) {
  const { digest: _ignored, ...unsigned } = event;
  return digestOf(unsigned);
}

export function serializeAttemptJournal(events) {
  return events.map((event) => JSON.stringify(event)).join("\n") + (events.length > 0 ? "\n" : "");
}

export function parseAttemptJournal(text) {
  if (typeof text !== "string") return { ok: false, refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.UNREADABLE, "journal bytes are not a string") };
  const events = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {

      return {
        ok: false,
        refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.UNREADABLE, "journal line is not valid JSON", {
          line_index: index
        }),
        durable_prefix: Object.freeze(events.slice())
      };
    }
    events.push(parsed);
  }
  return { ok: true, events };
}

function refusal(code, reason, detail = null) {
  return Object.freeze({
    schema_version: MANAGED_WORKER_ATTEMPT_JOURNAL_SCHEMA_VERSION,
    code,
    reason,
    detail: detail === null ? null : Object.freeze({ ...detail })
  });
}

export { refusal as attemptJournalRefusal };

export function validateAttemptJournal({ repository, subject, events }) {
  if (!Array.isArray(events)) {
    return { valid: false, refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.UNREADABLE, "events must be an array") };
  }
  let priorDigest = null;

  const frozen = new Map();

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!hasExactKeys(event, EVENT_ENVELOPE_KEYS)) {
      return {
        valid: false,
        refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.UNEXPECTED_KEYS, "attempt event does not carry exactly the closed envelope keys", { sequence: index })
      };
    }
    if (event.schema_version !== MANAGED_WORKER_ATTEMPT_JOURNAL_SCHEMA_VERSION) {
      return {
        valid: false,
        refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.UNKNOWN_SCHEMA_VERSION, "attempt event carries an unknown schema version", { sequence: index, observed: event.schema_version })
      };
    }
    if (!EVENT_KIND_VALUES.has(event.kind)) {
      return {
        valid: false,
        refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.UNKNOWN_EVENT_KIND, "attempt event carries an unknown kind", { sequence: index, observed: event.kind })
      };
    }

    if (event.repository !== repository || event.subject !== subject) {
      return {
        valid: false,
        refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.BINDING_MISMATCH, "attempt event is not bound to this repository and subject", {
          sequence: index,
          observed_repository: event.repository,
          observed_subject: event.subject
        })
      };
    }
    if (!isValidAttemptTuple(event.attempt)) {
      return {
        valid: false,
        refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.BINDING_MISMATCH, "attempt event does not carry a complete launcher-minted tuple", { sequence: index })
      };
    }
    if (!isNonEmptyString(event.generation_digest) || !isNonEmptyString(event.wk_tip)) {
      return {
        valid: false,
        refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.BINDING_MISMATCH, "attempt event does not bind a generation digest and accumulated WK tip", { sequence: index })
      };
    }
    if (!isPlainObject(event.payload)) {
      return {
        valid: false,
        refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.UNEXPECTED_KEYS, "attempt event payload must be an object", { sequence: index })
      };
    }

    if (event.sequence !== index) {
      return {
        valid: false,
        refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.SEQUENCE_GAP, "attempt event sequence is not monotonically contiguous", { expected: index, observed: event.sequence })
      };
    }

    if (event.prior_digest !== priorDigest) {
      return {
        valid: false,
        refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.CHAIN_BROKEN, "attempt event does not chain to its predecessor", { sequence: index, expected: priorDigest, observed: event.prior_digest })
      };
    }
    if (recomputeDigest(event) !== event.digest) {
      return {
        valid: false,
        refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.DIGEST_MISMATCH, "attempt event digest does not match its content", { sequence: index })
      };
    }

    const key = attemptKey(event.attempt);
    if (event.kind === ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED) {
      if (frozen.has(key)) {
        return {
          valid: false,
          refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.ILLEGAL_TRANSITION, "an attempt may claim its reservation exactly once", { sequence: index })
        };
      }
      frozen.set(key, { generation_digest: event.generation_digest, wk_tip: event.wk_tip });
    } else {
      const pinned = frozen.get(key);
      if (pinned === undefined) {
        return {
          valid: false,
          refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.ILLEGAL_TRANSITION, "an attempt event precedes its reservation_claimed", { sequence: index, kind: event.kind })
        };
      }
      if (event.generation_digest !== pinned.generation_digest) {
        return {
          valid: false,
          refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.GENERATION_NOT_FROZEN, "attempt event does not repeat the generation digest frozen at reservation_claimed", {
            sequence: index,
            frozen: pinned.generation_digest,
            observed: event.generation_digest
          })
        };
      }
      if (event.wk_tip !== pinned.wk_tip) {
        return {
          valid: false,
          refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.WK_TIP_NOT_FROZEN, "attempt event does not repeat the accumulated WK tip frozen at reservation_claimed", {
            sequence: index,
            frozen: pinned.wk_tip,
            observed: event.wk_tip
          })
        };
      }
    }

    priorDigest = event.digest;
  }
  return { valid: true, events: Object.freeze(events.slice()), terminal_digest: priorDigest };
}

const LEGAL_SUCCESSORS = Object.freeze({
  [ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED]: Object.freeze([
    ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED,
    ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL
  ]),
  [ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED]: Object.freeze([
    ATTEMPT_EVENT_KINDS.SUPERVISOR_BOUND,
    ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL
  ]),
  [ATTEMPT_EVENT_KINDS.SUPERVISOR_BOUND]: Object.freeze([
    ATTEMPT_EVENT_KINDS.SPAWN_STARTED,
    ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL
  ]),

  [ATTEMPT_EVENT_KINDS.SPAWN_STARTED]: Object.freeze([
    ATTEMPT_EVENT_KINDS.SANDBOX_BOUND,
    ATTEMPT_EVENT_KINDS.EXECUTION_TERMINATED
  ]),
  [ATTEMPT_EVENT_KINDS.SANDBOX_BOUND]: Object.freeze([
    ATTEMPT_EVENT_KINDS.EXECUTION_TERMINATED
  ]),
  [ATTEMPT_EVENT_KINDS.EXECUTION_TERMINATED]: Object.freeze([
    ATTEMPT_EVENT_KINDS.DELIVERY_OBSERVED,
    ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL
  ]),
  [ATTEMPT_EVENT_KINDS.DELIVERY_OBSERVED]: Object.freeze([
    ATTEMPT_EVENT_KINDS.INTEGRATION_INTENT,
    ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL
  ]),
  [ATTEMPT_EVENT_KINDS.INTEGRATION_INTENT]: Object.freeze([
    ATTEMPT_EVENT_KINDS.INTEGRATION_GIT_EFFECT
  ]),
  [ATTEMPT_EVENT_KINDS.INTEGRATION_GIT_EFFECT]: Object.freeze([
    ATTEMPT_EVENT_KINDS.INTEGRATION_STATUS_EFFECT
  ]),
  [ATTEMPT_EVENT_KINDS.INTEGRATION_STATUS_EFFECT]: Object.freeze([
    ATTEMPT_EVENT_KINDS.INTEGRATION_COMPLETED
  ]),
  [ATTEMPT_EVENT_KINDS.INTEGRATION_COMPLETED]: Object.freeze([

    ATTEMPT_EVENT_KINDS.INTEGRATION_INTENT,
    ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL
  ]),
  [ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL]: Object.freeze([
    ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED
  ]),
  [ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED]: Object.freeze([])
});

export function isLegalSuccessor(fromKind, toKind) {
  if (fromKind === null) return toKind === ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED;
  const successors = LEGAL_SUCCESSORS[fromKind];
  return successors !== undefined && successors.includes(toKind);
}

function projectAttempts(events) {
  const attempts = new Map();
  const order = [];
  for (const event of events) {
    const key = attemptKey(event.attempt);
    let state = attempts.get(key);
    if (state === undefined) {
      state = {
        key,
        attempt: event.attempt,
        generation_digest: event.generation_digest,
        wk_tip: event.wk_tip,
        last_kind: null,
        kinds: new Set(),
        events: [],
        integration_events: [],
        terminal: null,
        released: null
      };
      attempts.set(key, state);
      order.push(state);
    }
    state.events.push(event);
    if (INTEGRATION_EVENT_KINDS.has(event.kind)) state.integration_events.push(event);
    if (event.kind === ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL) state.terminal = event;
    if (event.kind === ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED) state.released = event;
    state.kinds.add(event.kind);
    state.last_kind = event.kind;
  }
  return order;
}

function isPossiblyLive(state) {
  return state.kinds.has(ATTEMPT_EVENT_KINDS.SPAWN_STARTED) &&
    !state.kinds.has(ATTEMPT_EVENT_KINDS.EXECUTION_TERMINATED);
}

function hasUnresolvedExecution(state) {

  return isPossiblyLive(state);
}

export function classifyReleaseProof(state, liveness) {

  if (liveness === ATTEMPT_EXECUTION_LIVENESS.DEAD &&
      state.kinds.has(ATTEMPT_EVENT_KINDS.SPAWN_STARTED)) {
    return ATTEMPT_RELEASE_PROOFS.AUTHENTICATED_DEATH;
  }

  if (state.kinds.has(ATTEMPT_EVENT_KINDS.INTEGRATION_COMPLETED) &&
      state.kinds.has(ATTEMPT_EVENT_KINDS.EXECUTION_TERMINATED) &&
      !hasUnresolvedExecution(state)) {
    return ATTEMPT_RELEASE_PROOFS.COMPLETED_DELIVERY;
  }

  if (state.terminal !== null && !hasUnresolvedExecution(state)) {
    return ATTEMPT_RELEASE_PROOFS.EXACT_TERMINAL;
  }
  return null;
}

export function reduceAttemptJournal({
  repository,
  subject,
  events,
  liveness = ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE,
  integrationResult = null,
  currentGenerationDigest = null,
  currentWkTip = null
} = {}) {
  const validated = validateAttemptJournal({ repository, subject, events });
  if (!validated.valid) {
    return Object.freeze({
      schema_version: MANAGED_WORKER_ATTEMPT_JOURNAL_SCHEMA_VERSION,
      repository,
      subject,
      current_attempt: null,
      reservation: Object.freeze({ held: false, holder: null, release_proof: null }),
      execution_liveness: null,
      integration: null,
      history: Object.freeze([]),
      history_total: 0,
      terminal_digest: null,
      next_command: Object.freeze({ kind: ATTEMPT_NEXT_COMMANDS.NONE, attempt: null, detail: null }),
      refusal: validated.refusal
    });
  }
  if (!LIVENESS_VALUES.has(liveness)) {
    return Object.freeze({
      schema_version: MANAGED_WORKER_ATTEMPT_JOURNAL_SCHEMA_VERSION,
      repository,
      subject,
      current_attempt: null,
      reservation: Object.freeze({ held: false, holder: null, release_proof: null }),
      execution_liveness: null,
      integration: null,
      history: Object.freeze([]),
      history_total: validated.events.length,
      terminal_digest: validated.terminal_digest,
      next_command: Object.freeze({ kind: ATTEMPT_NEXT_COMMANDS.NONE, attempt: null, detail: null }),
      refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.LIVENESS_UNAVAILABLE, "an authenticated liveness verdict is required", { observed: liveness })
    });
  }

  const states = projectAttempts(validated.events);

  const unreleased = states.filter((state) => state.released === null);
  const current = unreleased.length === 0 ? null : unreleased[unreleased.length - 1];

  const history = Object.freeze(states.map((state) => Object.freeze({
    attempt: state.attempt,
    generation_digest: state.generation_digest,
    wk_tip: state.wk_tip,
    last_kind: state.last_kind,
    terminal_reason: state.terminal === null ? null : (state.terminal.payload.reason ?? null),
    release_proof: state.released === null ? null : (state.released.payload.release_proof ?? null),
    released: state.released !== null,
    event_count: state.events.length
  })));

  const base = {
    schema_version: MANAGED_WORKER_ATTEMPT_JOURNAL_SCHEMA_VERSION,
    repository,
    subject,
    history,
    history_total: validated.events.length,
    terminal_digest: validated.terminal_digest,

    integration: integrationResult
  };

  if (current === null) {

    return Object.freeze({
      ...base,
      current_attempt: null,
      reservation: Object.freeze({ held: false, holder: null, release_proof: null }),
      execution_liveness: null,
      next_command: Object.freeze({ kind: ATTEMPT_NEXT_COMMANDS.CLAIM_RESERVATION, attempt: null, detail: null }),
      refusal: null
    });
  }

  const stale =
    (currentGenerationDigest !== null && current.generation_digest !== currentGenerationDigest) ||
    (currentWkTip !== null && current.wk_tip !== currentWkTip);

  const possiblyLive = isPossiblyLive(current);
  const releaseProof = classifyReleaseProof(current, liveness);

  const reservation = Object.freeze({
    held: true,
    holder: current.attempt,
    stale,
    possibly_live: possiblyLive,
    release_proof: releaseProof
  });

  const withCurrent = {
    ...base,
    current_attempt: Object.freeze({
      attempt: current.attempt,
      generation_digest: current.generation_digest,
      wk_tip: current.wk_tip,
      last_kind: current.last_kind,
      stale,
      possibly_live: possiblyLive,
      terminal: current.terminal !== null
    }),
    reservation,
    execution_liveness: liveness,
    refusal: null
  };

  const command = (kind, detail = null) => Object.freeze({
    kind,
    attempt: current.attempt,
    detail: detail === null ? null : Object.freeze({ ...detail })
  });

  if (current.terminal !== null && releaseProof !== null) {
    return Object.freeze({ ...withCurrent, next_command: command(ATTEMPT_NEXT_COMMANDS.RELEASE_RESERVATION, { release_proof: releaseProof }) });
  }

  if (stale) {
    if (releaseProof !== null && current.terminal === null) {
      return Object.freeze({ ...withCurrent, next_command: command(ATTEMPT_NEXT_COMMANDS.RECORD_TERMINAL, { reason: "stale_generation_or_tip", release_proof: releaseProof }) });
    }
    return Object.freeze({ ...withCurrent, next_command: command(ATTEMPT_NEXT_COMMANDS.NONE, { retained: possiblyLive ? "possibly_live" : "stale" }) });
  }

  switch (current.last_kind) {
    case ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED:
      return Object.freeze({ ...withCurrent, next_command: command(ATTEMPT_NEXT_COMMANDS.PUBLISH_PENDING) });
    case ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED:
      return Object.freeze({ ...withCurrent, next_command: command(ATTEMPT_NEXT_COMMANDS.BIND_SUPERVISOR) });
    case ATTEMPT_EVENT_KINDS.SUPERVISOR_BOUND:
      return Object.freeze({ ...withCurrent, next_command: command(ATTEMPT_NEXT_COMMANDS.START_SPAWN) });
    case ATTEMPT_EVENT_KINDS.SPAWN_STARTED:

      if (liveness === ATTEMPT_EXECUTION_LIVENESS.DEAD) {
        return Object.freeze({ ...withCurrent, next_command: command(ATTEMPT_NEXT_COMMANDS.RECORD_EXECUTION_TERMINATION, { evidence: "authenticated_death" }) });
      }
      return Object.freeze({ ...withCurrent, next_command: command(ATTEMPT_NEXT_COMMANDS.BIND_SANDBOX, { retained: "possibly_live" }) });
    case ATTEMPT_EVENT_KINDS.SANDBOX_BOUND:
      if (liveness === ATTEMPT_EXECUTION_LIVENESS.DEAD) {
        return Object.freeze({ ...withCurrent, next_command: command(ATTEMPT_NEXT_COMMANDS.RECORD_EXECUTION_TERMINATION, { evidence: "authenticated_death" }) });
      }
      return Object.freeze({ ...withCurrent, next_command: command(ATTEMPT_NEXT_COMMANDS.AWAIT_EXECUTION, { retained: "live_or_indeterminate" }) });
    case ATTEMPT_EVENT_KINDS.EXECUTION_TERMINATED:
      return Object.freeze({ ...withCurrent, next_command: command(ATTEMPT_NEXT_COMMANDS.RECORD_TERMINAL, { reason: "execution_terminated" }) });
    case ATTEMPT_EVENT_KINDS.DELIVERY_OBSERVED:
    case ATTEMPT_EVENT_KINDS.INTEGRATION_INTENT:
    case ATTEMPT_EVENT_KINDS.INTEGRATION_GIT_EFFECT:
    case ATTEMPT_EVENT_KINDS.INTEGRATION_STATUS_EFFECT:
    case ATTEMPT_EVENT_KINDS.INTEGRATION_COMPLETED:

      return Object.freeze({ ...withCurrent, next_command: command(ATTEMPT_NEXT_COMMANDS.RUN_INTEGRATION_SETTLEMENT) });
    case ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL:

      return Object.freeze({
        ...withCurrent,
        next_command: command(ATTEMPT_NEXT_COMMANDS.NONE, { retained: possiblyLive ? "possibly_live" : "awaiting_release_proof" })
      });
    default:
      return Object.freeze({
        ...withCurrent,
        next_command: Object.freeze({ kind: ATTEMPT_NEXT_COMMANDS.NONE, attempt: current.attempt, detail: null }),
        refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.ILLEGAL_TRANSITION, "no legal successor for the current attempt state", { last_kind: current.last_kind })
      });
  }
}

export function admitAttemptCommand({
  repository,
  subject,
  events,
  attempt,
  kind,
  payload = {},
  generationDigest = null,
  wkTip = null,
  liveness = ATTEMPT_EXECUTION_LIVENESS.INDETERMINATE
}) {
  const validated = validateAttemptJournal({ repository, subject, events });
  if (!validated.valid) return { admitted: false, refusal: validated.refusal };
  if (!EVENT_KIND_VALUES.has(kind)) {
    return { admitted: false, refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.UNKNOWN_EVENT_KIND, "unknown command kind", { observed: kind }) };
  }
  if (!isValidAttemptTuple(attempt)) {
    return { admitted: false, refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.BINDING_MISMATCH, "command does not carry a complete launcher-minted tuple") };
  }

  const states = projectAttempts(validated.events);
  const key = attemptKey(attempt);
  const state = states.find((candidate) => candidate.key === key) ?? null;
  const lastKind = state === null ? null : state.last_kind;

  if (!isLegalSuccessor(lastKind, kind)) {
    return {
      admitted: false,
      refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.ILLEGAL_TRANSITION, "the command is not a legal successor of the attempt's current state", {
        from: lastKind,
        to: kind
      })
    };
  }

  let boundGeneration;
  let boundTip;
  if (kind === ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED) {
    if (!isNonEmptyString(generationDigest) || !isNonEmptyString(wkTip)) {
      return { admitted: false, refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.BINDING_MISMATCH, "reservation_claimed must freeze an exact generation digest and accumulated WK tip") };
    }

    const blocking = states.find((candidate) => candidate.released === null);
    if (blocking !== undefined) {
      return {
        admitted: false,
        refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.ILLEGAL_TRANSITION, "the subject already holds an unreleased attempt reservation", {
          holder: blocking.attempt
        })
      };
    }
    boundGeneration = generationDigest;
    boundTip = wkTip;
  } else {
    boundGeneration = state.generation_digest;
    boundTip = state.wk_tip;

    if (generationDigest !== null && generationDigest !== boundGeneration) {
      return { admitted: false, refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.GENERATION_NOT_FROZEN, "the command's generation digest differs from the value frozen at reservation_claimed", { frozen: boundGeneration, observed: generationDigest }) };
    }
    if (wkTip !== null && wkTip !== boundTip) {
      return { admitted: false, refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.WK_TIP_NOT_FROZEN, "the command's WK tip differs from the value frozen at reservation_claimed", { frozen: boundTip, observed: wkTip }) };
    }
  }

  if (kind === ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED) {
    const proof = classifyReleaseProof(state, liveness);
    if (proof === null) {
      return {
        admitted: false,
        refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.RELEASE_WITHOUT_PROOF, "release requires exact terminality with no unresolved execution, authenticated death, or authenticated completed delivery with authenticated termination", {
          possibly_live: isPossiblyLive(state),
          liveness
        })
      };
    }
    if (payload.release_proof !== undefined && payload.release_proof !== proof) {
      return {
        admitted: false,
        refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.RELEASE_WITHOUT_PROOF, "the claimed release proof is not the proof the reducer derives", {
          claimed: payload.release_proof,
          derived: proof
        })
      };
    }
    if (!RELEASE_PROOF_VALUES.has(proof)) {
      return { admitted: false, refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.RELEASE_WITHOUT_PROOF, "unknown release proof family", { derived: proof }) };
    }
    payload = { ...payload, release_proof: proof };
  }

  const event = mintAttemptEvent({
    repository,
    subject,
    attempt,
    sequence: validated.events.length,
    priorDigest: validated.terminal_digest,
    generationDigest: boundGeneration,
    wkTip: boundTip,
    kind,
    payload
  });
  return { admitted: true, event, events: Object.freeze([...validated.events, event]), refusal: null };
}

export const ATTEMPT_IMPORT_CLASSES = Object.freeze({
  RELEASABLE_EXACT_TERMINAL: "releasable_exact_terminal",
  RELEASABLE_PROVEN_DEAD: "releasable_proven_dead_no_delivery",
  RELEASABLE_COMPLETED_DELIVERY: "releasable_completed_delivery",
  RETAINED_LIVE: "retained_live",
  RETAINED_POSSIBLY_LIVE: "retained_possibly_live",
  RETAINED_INDETERMINATE: "retained_indeterminate",
  OPERATOR_ONLY_RESIDUE: "operator_only_residue"
});

const LEGACY_EVIDENCE_KEYS = Object.freeze([
  "evidence_digest",
  "repository",
  "subject",
  "attempt",
  "generation_digest",
  "wk_tip",
  "reached_spawn",
  "execution_terminated",
  "delivery_completed",
  "slice_ref_equals_base",
  "liveness"
]);

export function isValidLegacyEvidence(evidence) {
  if (!hasExactKeys(evidence, LEGACY_EVIDENCE_KEYS)) return false;
  if (!isNonEmptyString(evidence.evidence_digest)) return false;
  if (!isNonEmptyString(evidence.repository) || !isNonEmptyString(evidence.subject)) return false;
  if (!isValidAttemptTuple(evidence.attempt)) return false;
  if (!isNonEmptyString(evidence.generation_digest) || !isNonEmptyString(evidence.wk_tip)) return false;
  for (const key of ["reached_spawn", "execution_terminated", "delivery_completed", "slice_ref_equals_base"]) {
    if (typeof evidence[key] !== "boolean") return false;
  }
  return LIVENESS_VALUES.has(evidence.liveness);
}

export function legacyEvidenceAlreadyImported(events, evidenceDigest) {
  return events.some((event) =>
    event.kind === ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED &&
    event.payload?.legacy_evidence_digest === evidenceDigest);
}

export function classifyLegacyImport(evidence) {
  if (!isValidLegacyEvidence(evidence)) return ATTEMPT_IMPORT_CLASSES.OPERATOR_ONLY_RESIDUE;

  if (evidence.reached_spawn && !evidence.execution_terminated) {
    if (evidence.liveness === ATTEMPT_EXECUTION_LIVENESS.LIVE) return ATTEMPT_IMPORT_CLASSES.RETAINED_LIVE;
    if (evidence.liveness === ATTEMPT_EXECUTION_LIVENESS.DEAD) {

      return evidence.slice_ref_equals_base
        ? ATTEMPT_IMPORT_CLASSES.RELEASABLE_PROVEN_DEAD
        : ATTEMPT_IMPORT_CLASSES.RETAINED_INDETERMINATE;
    }
    return ATTEMPT_IMPORT_CLASSES.RETAINED_POSSIBLY_LIVE;
  }
  if (evidence.liveness === ATTEMPT_EXECUTION_LIVENESS.LIVE) return ATTEMPT_IMPORT_CLASSES.RETAINED_LIVE;
  if (evidence.delivery_completed) {
    return evidence.execution_terminated
      ? ATTEMPT_IMPORT_CLASSES.RELEASABLE_COMPLETED_DELIVERY
      : ATTEMPT_IMPORT_CLASSES.RETAINED_INDETERMINATE;
  }

  if (evidence.reached_spawn && evidence.execution_terminated &&
      evidence.liveness === ATTEMPT_EXECUTION_LIVENESS.DEAD && evidence.slice_ref_equals_base) {
    return ATTEMPT_IMPORT_CLASSES.RELEASABLE_PROVEN_DEAD;
  }
  if (evidence.execution_terminated) return ATTEMPT_IMPORT_CLASSES.RELEASABLE_EXACT_TERMINAL;
  if (!evidence.reached_spawn) {

    return evidence.liveness === ATTEMPT_EXECUTION_LIVENESS.DEAD
      ? ATTEMPT_IMPORT_CLASSES.RELEASABLE_EXACT_TERMINAL
      : ATTEMPT_IMPORT_CLASSES.RETAINED_INDETERMINATE;
  }
  return ATTEMPT_IMPORT_CLASSES.RETAINED_INDETERMINATE;
}

const RELEASABLE_CLASSES = new Set([
  ATTEMPT_IMPORT_CLASSES.RELEASABLE_EXACT_TERMINAL,
  ATTEMPT_IMPORT_CLASSES.RELEASABLE_PROVEN_DEAD,
  ATTEMPT_IMPORT_CLASSES.RELEASABLE_COMPLETED_DELIVERY
]);

export function admitLegacyImport({ repository, subject, events, evidence }) {
  const validated = validateAttemptJournal({ repository, subject, events });
  if (!validated.valid) {
    return { admitted: false, class: ATTEMPT_IMPORT_CLASSES.OPERATOR_ONLY_RESIDUE, refusal: validated.refusal, events };
  }
  if (!isValidLegacyEvidence(evidence) || evidence.repository !== repository || evidence.subject !== subject) {
    return {
      admitted: false,
      class: ATTEMPT_IMPORT_CLASSES.OPERATOR_ONLY_RESIDUE,
      refusal: refusal(ATTEMPT_JOURNAL_REFUSALS.BINDING_MISMATCH, "legacy evidence is unauthenticated or names another subject"),
      events
    };
  }

  if (legacyEvidenceAlreadyImported(validated.events, evidence.evidence_digest)) {
    return { admitted: true, imported: false, class: classifyLegacyImport(evidence), refusal: null, events: validated.events };
  }
  const importClass = classifyLegacyImport(evidence);
  if (!RELEASABLE_CLASSES.has(importClass)) {

    return { admitted: true, imported: false, class: importClass, refusal: null, events: validated.events };
  }
  let working = validated.events;
  const step = (kind, payload) => {
    const admitted = admitAttemptCommand({
      repository, subject, events: working, attempt: evidence.attempt, kind, payload,
      generationDigest: kind === ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED ? evidence.generation_digest : null,
      wkTip: kind === ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED ? evidence.wk_tip : null,
      liveness: evidence.liveness
    });
    if (admitted.admitted !== true) return admitted.refusal;
    working = admitted.events;
    return null;
  };
  const sequence = [
    [ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED, { legacy_evidence_digest: evidence.evidence_digest, imported: true }],
    [ATTEMPT_EVENT_KINDS.ATTEMPT_TERMINAL, { reason: importClass, legacy_evidence_digest: evidence.evidence_digest }],
    [ATTEMPT_EVENT_KINDS.RESERVATION_RELEASED, { legacy_evidence_digest: evidence.evidence_digest }]
  ];
  for (const [kind, payload] of sequence) {
    const denied = step(kind, payload);
    if (denied !== null) {
      return { admitted: false, class: ATTEMPT_IMPORT_CLASSES.OPERATOR_ONLY_RESIDUE, refusal: denied, events: validated.events };
    }
  }
  return { admitted: true, imported: true, class: importClass, refusal: null, events: working };
}
