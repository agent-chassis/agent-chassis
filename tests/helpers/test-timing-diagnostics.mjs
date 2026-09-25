

export const TEST_TIMING_CODES = Object.freeze({
  ARTIFACT_CREATE_FAILED: "test_runner.artifact_create_failed.v1",
  ARTIFACT_WRITE_FAILED: "test_runner.artifact_write_failed.v1",
  TIMING_RECORD_INVALID: "test_runner.timing_record_invalid.v1",
  TIMING_INCOMPLETE: "test_runner.timing_incomplete.v1"
});

const NEXT_ACTION = Object.freeze({
  [TEST_TIMING_CODES.ARTIFACT_CREATE_FAILED]:
    "Operator: select an authorized non-disposable --test-artifacts-dir, or have the runtime " +
    "operator supply retained writable storage; the suite did not start.",
  [TEST_TIMING_CODES.ARTIFACT_WRITE_FAILED]:
    "Operator: inspect the named storage error, capacity and permissions and the retained " +
    "prefix before rerunning; do not retry blindly.",
  [TEST_TIMING_CODES.TIMING_RECORD_INVALID]:
    "Runner maintainer: repair the named producer or schema at the retained sequence; no " +
    "row was skipped.",
  [TEST_TIMING_CODES.TIMING_INCOMPLETE]:
    "Operator: inspect the named unfinished work and the primary timeout or signal, then " +
    "rerun that single file or raise its timeout only when intentional."
});

export class TestTimingError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "TestTimingError";
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

export function timingFailure(code, message, detail) {
  if (!Object.hasOwn(NEXT_ACTION, code)) throw new TypeError(`unknown timing code ${code}`);
  return new TestTimingError(code, message, detail);
}

export function describeTimingFailure(failure) {
  const code = failure?.code;
  return Object.freeze({
    code: typeof code === "string" ? code : TEST_TIMING_CODES.ARTIFACT_WRITE_FAILED,
    message: String(failure?.message ?? failure).slice(0, 1024),
    detail: failure?.detail ?? {},
    next_action: NEXT_ACTION[code] ?? NEXT_ACTION[TEST_TIMING_CODES.ARTIFACT_WRITE_FAILED]
  });
}

export function timingNextAction(code) {
  return NEXT_ACTION[code] ?? null;
}
