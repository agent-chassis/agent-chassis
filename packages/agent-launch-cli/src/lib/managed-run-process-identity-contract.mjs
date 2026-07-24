

export const MANAGED_RUN_PROCESS_IDENTITY_SCHEMA_VERSION = "managed-run-process-identity.v1";

export const MANAGED_RUN_PROCESS_IDENTITY_STATES = Object.freeze({
  PENDING: "pending",
  BOUND: "bound",
  RETIRED: "retired"
});

export const MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS = Object.freeze({

  FINALIZED_INTEGRATION: "finalized_integration",

  CORRECTIVE_SUPERSESSION: "corrective_supersession",

  NO_COMMIT_BASE_EQUAL: "no_commit_base_equal"
});

export const RETIREMENT_REASON_VALUES = new Set(Object.values(MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS));

export const MANAGED_RUN_WK_BINDING_RUN_ID_SUFFIX = ".wk";
export const MANAGED_RUN_SLICE_BINDING_RUN_ID_SUFFIX = ".slice";

export const MANAGED_RUN_PROCESS_IDENTITY_VERDICTS = Object.freeze({
  ABSENT: "absent",
  LIVE: "live",
  PARTIAL: "partial",
  AMBIGUOUS: "ambiguous",
  UNREADABLE: "unreadable",
  MISMATCHED: "mismatched",
  UNRESOLVED: "unresolved",
  PROVEN_DEAD: "proven_dead",

  RETIRED: "retired",

  RESERVED: "reserved"
});

export const SPAWN_PERMISSIVE_VERDICTS = new Set([MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT]);

export const MANAGED_RUN_PROCESS_IDENTITY_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.managed_run_process_identity.invalid_arg.v1",
  STORE_COLLISION: "agent_launch.managed_run_process_identity.store_collision.v1",
  STORE_WRITE_FAILED: "agent_launch.managed_run_process_identity.store_write_failed.v1",
  PUBLICATION_INCOMPLETE: "agent_launch.managed_run_process_identity.publication_incomplete.v1",
  IDENTITY_CAPTURE_FAILED: "agent_launch.managed_run_process_identity.identity_capture_failed.v1",
  TOKEN_ORDER_VIOLATION: "agent_launch.managed_run_process_identity.token_order_violation.v1",
  BINDING_MISMATCH: "agent_launch.managed_run_process_identity.binding_mismatch.v1",
  RETIREMENT_REFUSED: "agent_launch.managed_run_process_identity.retirement_refused.v1",
  RESERVATION_UNREADABLE: "agent_launch.managed_run_process_identity.reservation_unreadable.v1"
});

export class ManagedRunProcessIdentityError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "ManagedRunProcessIdentityError";
    this.code = code ?? "agent_launch.managed_run_process_identity.error.v1";
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

export function fail(code, message, detail = null, cause = null) {
  throw new ManagedRunProcessIdentityError(
    `agent-launch managed-run-process-identity: ${message}`,
    { code, detail, cause }
  );
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length) return false;
  return expected.every((key) => Object.hasOwn(value, key));
}

export function normalizeManagedRunIdentityTuple(tuple) {
  if (!isPlainObject(tuple)) {
    fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG, "tuple must be an object");
  }
  const { assigned_unit: assignedUnit, launch_ref: launchRef, run_id: runId, retry_id: retryId = 0 } = tuple;
  for (const [label, value] of [["assigned_unit", assignedUnit], ["launch_ref", launchRef], ["run_id", runId]]) {
    if (typeof value !== "string" || value.length === 0) {
      fail(
        MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
        `tuple.${label} must be a non-empty string, got: ${JSON.stringify(value)}`
      );
    }
  }
  if (!Number.isInteger(retryId) || retryId < 0) {
    fail(
      MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG,
      `tuple.retry_id must be a non-negative integer, got: ${JSON.stringify(retryId)}`
    );
  }
  return Object.freeze({
    assigned_unit: assignedUnit,
    launch_ref: launchRef,
    run_id: runId,
    retry_id: retryId
  });
}

export function sameTuple(left, right) {
  return left.assigned_unit === right.assigned_unit &&
    left.launch_ref === right.launch_ref &&
    left.run_id === right.run_id &&
    left.retry_id === right.retry_id;
}

function bindingMismatch(message, detail) {
  fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.BINDING_MISMATCH, message, detail);
}

export function deriveManagedRunIdentityTupleFromBindingPair({
  assignedUnit,
  launchRef,
  wkBinding,
  sliceBinding,
  expectedRunId = null
} = {}) {
  if (typeof assignedUnit !== "string" || assignedUnit.length === 0) {
    fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG, "assignedUnit must be a non-empty string");
  }
  if (typeof launchRef !== "string" || launchRef.length === 0) {
    fail(MANAGED_RUN_PROCESS_IDENTITY_CODES.INVALID_ARG, "launchRef must be a non-empty string");
  }
  if (!isPlainObject(wkBinding) || !isPlainObject(sliceBinding)) {
    bindingMismatch("the managed-run tuple requires both the retained WK and slice bindings", {
      wk_binding_present: isPlainObject(wkBinding),
      slice_binding_present: isPlainObject(sliceBinding)
    });
  }
  const wkRunId = wkBinding.run_id;
  const sliceRunId = sliceBinding.run_id;

  let workerRunId;
  if (typeof wkRunId === "string" && wkRunId.length > MANAGED_RUN_WK_BINDING_RUN_ID_SUFFIX.length &&
      wkRunId.endsWith(MANAGED_RUN_WK_BINDING_RUN_ID_SUFFIX)) {
    workerRunId = wkRunId.slice(0, -MANAGED_RUN_WK_BINDING_RUN_ID_SUFFIX.length);
  } else if (wkRunId === undefined && typeof expectedRunId === "string" && expectedRunId.length > 0) {
    workerRunId = expectedRunId;
  } else {
    bindingMismatch("the retained WK binding does not carry a launcher-minted worker run id", {
      wk_run_id: typeof wkRunId === "string" ? wkRunId : null,
      expected_run_id: expectedRunId
    });
  }

  if (sliceRunId !== `${workerRunId}${MANAGED_RUN_SLICE_BINDING_RUN_ID_SUFFIX}`) {
    bindingMismatch("the retained slice binding does not pair with the retained WK binding run id", {
      wk_run_id: typeof wkRunId === "string" ? wkRunId : null,
      worker_run_id: workerRunId,
      slice_run_id: typeof sliceRunId === "string" ? sliceRunId : null
    });
  }
  if (expectedRunId !== null && expectedRunId !== workerRunId) {
    bindingMismatch("the retained binding pair does not carry the expected worker run id", {
      expected_run_id: expectedRunId,
      binding_run_id: workerRunId
    });
  }
  if (sliceBinding.launch_ref !== launchRef ||
      (wkBinding.launch_ref !== undefined && wkBinding.launch_ref !== launchRef)) {
    bindingMismatch("the retained binding pair does not carry the expected launch ref", {
      expected_launch_ref: launchRef,
      wk_launch_ref: wkBinding.launch_ref ?? null,
      slice_launch_ref: sliceBinding.launch_ref ?? null
    });
  }
  if (!Number.isInteger(sliceBinding.retry_id) ||
      (wkBinding.retry_id !== undefined && sliceBinding.retry_id !== wkBinding.retry_id)) {
    bindingMismatch("the retained binding pair does not carry one exact retry id", {
      wk_retry_id: wkBinding.retry_id ?? null,
      slice_retry_id: sliceBinding.retry_id ?? null
    });
  }

  const address = String(sliceBinding.unit_address ?? "").split("/");
  if (address.length !== 3 || `${address[1]}#${address[2]}` !== assignedUnit) {
    bindingMismatch("the retained slice binding does not address the assigned unit", {
      assigned_unit: assignedUnit,
      slice_unit_address: sliceBinding.unit_address ?? null
    });
  }
  return normalizeManagedRunIdentityTuple({
    assigned_unit: assignedUnit,
    launch_ref: launchRef,
    run_id: workerRunId,
    retry_id: sliceBinding.retry_id
  });
}
