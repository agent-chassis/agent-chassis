

import {
  projectTerminalWkCandidateFailure,
  TERMINAL_WK_CANDIDATE_CODES,
  TERMINAL_WK_CANDIDATE_UNKNOWN_FAILURE_MESSAGE
} from "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";

export const CLOSED_LIFECYCLE_FAILURE_SCHEMA_VERSION =
  "agent_launch.closed_lifecycle_failure.v1";

export const CLOSED_LIFECYCLE_FAILURE_NAME = "ClosedLifecycleFailure";

export const CLOSED_LIFECYCLE_FAILURE_CODES = Object.freeze({
  TERMINAL_CANDIDATE_PREPARATION_FAILED:
    "agent_launch.slice_lifecycle.terminal_candidate_preparation_failed.v1"
});

export const CLOSED_LIFECYCLE_FAILURE_MESSAGES = Object.freeze({
  [CLOSED_LIFECYCLE_FAILURE_CODES.TERMINAL_CANDIDATE_PREPARATION_FAILED]:
    "post-worker terminal candidate preparation failed"
});

export const CLOSED_LIFECYCLE_FAILURE_KEYS = Object.freeze([
  "schema_version",
  "code",
  "candidate_failure"
]);

export const CLOSED_CANDIDATE_FAILURE_KINDS = Object.freeze({
  TYPED: "typed_candidate_error",
  UNKNOWN: "unknown_cause"
});

export const CLOSED_CANDIDATE_FAILURE_KEYS = Object.freeze([
  "kind",
  "code",
  "message",
  "detail"
]);

export const APPROVED_CANDIDATE_GIT_DETAIL_KEYS = Object.freeze([
  "git_args",
  "git_status",
  "git_stderr"
]);

const CLOSED_TYPED_CANDIDATE_FAILURE_MESSAGE =
  "terminal WK candidate: typed construction or recovery failure";

const CLOSED_UNKNOWN_CANDIDATE_FAILURE = Object.freeze({
  kind: CLOSED_CANDIDATE_FAILURE_KINDS.UNKNOWN,
  code: null,
  message: TERMINAL_WK_CANDIDATE_UNKNOWN_FAILURE_MESSAGE,
  detail: null
});

const APPROVED_TERMINAL_WK_CANDIDATE_CODES = Object.freeze(
  new Set(Object.values(TERMINAL_WK_CANDIDATE_CODES))
);

function closedCandidateGitDetail(detail) {
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) return null;
  const projected = {};
  if (Array.isArray(detail.git_args)) {
    projected.git_args = Object.freeze(
      detail.git_args
        .filter((arg) => typeof arg === "string")
        .slice(0, 32)
        .map((arg) => arg.slice(0, 256))
    );
  }
  if (typeof detail.git_status === "number" || detail.git_status === null) {
    projected.git_status = detail.git_status;
  }
  if (typeof detail.git_stderr === "string") {
    projected.git_stderr = detail.git_stderr.slice(0, 8192);
  }
  return Object.keys(projected).length === 0 ? null : Object.freeze(projected);
}

function closedCandidateFailure(error) {
  let projected;
  try {
    projected = projectTerminalWkCandidateFailure(error);
  } catch {

    return CLOSED_UNKNOWN_CANDIDATE_FAILURE;
  }
  if (typeof projected !== "object" || projected === null ||
      projected.kind !== CLOSED_CANDIDATE_FAILURE_KINDS.TYPED ||
      typeof projected.code !== "string" ||
      !APPROVED_TERMINAL_WK_CANDIDATE_CODES.has(projected.code)) {
    return CLOSED_UNKNOWN_CANDIDATE_FAILURE;
  }
  return Object.freeze({
    kind: CLOSED_CANDIDATE_FAILURE_KINDS.TYPED,
    code: projected.code,
    message: CLOSED_TYPED_CANDIDATE_FAILURE_MESSAGE,
    detail: closedCandidateGitDetail(projected.detail)
  });
}

const CARRIER_BRAND = new WeakSet();

const CARRIER_CONSTRUCTION_TOKEN = Symbol("closed-lifecycle-failure-construction");

class ClosedLifecycleFailure extends Error {
  constructor(token, code, candidateFailure) {
    if (token !== CARRIER_CONSTRUCTION_TOKEN) {
      throw new Error(
        "closed lifecycle failure carrier is constructible only by trusted lifecycle code"
      );
    }
    const message = CLOSED_LIFECYCLE_FAILURE_MESSAGES[code];
    if (typeof message !== "string") {
      throw new Error("closed lifecycle failure carrier requires a closed lifecycle failure code");
    }
    super(message);
    const pin = (key, value, enumerable) => {
      Object.defineProperty(this, key, {
        value,
        enumerable,
        writable: false,
        configurable: false
      });
    };

    pin("name", CLOSED_LIFECYCLE_FAILURE_NAME, false);
    pin("message", message, false);
    pin("stack", `${CLOSED_LIFECYCLE_FAILURE_NAME}: ${message}`, false);

    pin("schema_version", CLOSED_LIFECYCLE_FAILURE_SCHEMA_VERSION, true);
    pin("code", code, true);
    pin("candidate_failure", candidateFailure, true);
    Object.freeze(this);
  }
}

export function closeTerminalCandidatePreparationFailure(error) {
  const carrier = new ClosedLifecycleFailure(
    CARRIER_CONSTRUCTION_TOKEN,
    CLOSED_LIFECYCLE_FAILURE_CODES.TERMINAL_CANDIDATE_PREPARATION_FAILED,
    closedCandidateFailure(error)
  );
  CARRIER_BRAND.add(carrier);
  return carrier;
}

export function isClosedLifecycleFailure(value) {
  return CARRIER_BRAND.has(value);
}

export function projectClosedLifecycleFailure(value) {
  if (!isClosedLifecycleFailure(value)) return null;
  return Object.freeze({
    schema_version: CLOSED_LIFECYCLE_FAILURE_SCHEMA_VERSION,
    code: value.code,
    message: CLOSED_LIFECYCLE_FAILURE_MESSAGES[value.code] ?? null,
    candidate_failure: value.candidate_failure
  });
}
