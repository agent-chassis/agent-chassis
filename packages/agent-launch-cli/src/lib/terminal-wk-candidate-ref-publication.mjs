import path from "node:path";
import { runGitAsync } from "../../../agent-launch-core/src/lib/git.mjs";

export const TERMINAL_WK_CANDIDATE_CODES = Object.freeze({
  INVALID_ARGUMENT: "agent_launch.terminal_wk_candidate.invalid_argument.v1",
  GIT_FAILED: "agent_launch.terminal_wk_candidate.git_failed.v1",

  BASE_INVALID: "agent_launch.terminal_wk_candidate.base_invalid.v1",
  INPUT_MOVED: "agent_launch.terminal_wk_candidate.input_moved.v1",

  CONFLICT: "agent_launch.terminal_wk_candidate.conflict.v1",
  CANDIDATE_INVALID: "agent_launch.terminal_wk_candidate.candidate_invalid.v1",
  CANDIDATE_REF_DISAGREES: "agent_launch.terminal_wk_candidate.candidate_ref_disagrees.v1",
  BINDING_MISMATCH: "agent_launch.terminal_wk_candidate.binding_mismatch.v1",

  CONTROLLED_GENERATION_STALE:
    "agent_launch.terminal_wk_candidate.controlled_generation_stale.v1"
});

export const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
export const WK_RE = /^WK-\d{4}$/u;

export class TerminalWkCandidateError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(`terminal WK candidate: ${message}`);
    this.name = "TerminalWkCandidateError";
    this.code = code;
    this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

export function fail(code, message, detail = null, cause = null) {
  throw new TerminalWkCandidateError(message, { code, detail, cause });
}

export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedFailureMessage(message) {
  return String(message ?? "").slice(0, 4096);
}

const NATIVE_ERROR_FACTS = Object.freeze([
  ["code", "string"], ["errno", "number"], ["syscall", "string"], ["path", "string"]
]);

function nativeErrorFacts(error) {
  if (error === null || typeof error !== "object") return null;
  const facts = {};
  for (const [field, type] of NATIVE_ERROR_FACTS) {
    let value;
    try { value = error[field]; } catch { value = undefined; }
    if (typeof value === type) facts[field] = type === "string" ? value.slice(0, 512) : value;
  }
  return Object.keys(facts).length === 0 ? null : Object.freeze(facts);
}

const PRODUCTION_RUNNER_RESULTS = new WeakSet();

const NATIVE_GIT_DIAGNOSES = new WeakMap();

function nativeGitDiagnosis(result) {
  if (!PRODUCTION_RUNNER_RESULTS.has(result)) return null;
  const trace2 = result.trace2;
  if (!isPlainObject(trace2) || typeof trace2.state !== "string") return null;
  return closedTerminalWkCandidateGitDiagnosis({
    capture: trace2.state,
    diagnostics: Array.isArray(trace2.diagnostics) ? trace2.diagnostics : []
  });
}

export const TERMINAL_WK_CANDIDATE_GIT_DIAGNOSIS_CAPTURES = Object.freeze([
  "captured",
  "none_emitted",
  "unavailable",
  "malformed",
  "incomplete",
  "capture_failed",
  "overflow",
  "not_started"
]);
const GIT_DIAGNOSIS_CAPTURE_SET = new Set(TERMINAL_WK_CANDIDATE_GIT_DIAGNOSIS_CAPTURES);

export function closedTerminalWkCandidateGitDiagnosis(value) {
  try {
    if (!isPlainObject(value) || !GIT_DIAGNOSIS_CAPTURE_SET.has(value.capture) ||
        !Array.isArray(value.diagnostics)) return null;
    const diagnostics = [];
    for (const entry of value.diagnostics) {
      if (!isPlainObject(entry) || typeof entry.msg !== "string" ||
          typeof entry.fmt !== "string") return null;
      diagnostics.push(Object.freeze({ msg: entry.msg, fmt: entry.fmt }));
    }
    return Object.freeze({ capture: value.capture, diagnostics: Object.freeze(diagnostics) });
  } catch {
    return null;
  }
}

function gitFailureDetail(result, facts) {
  const error = result?.spawn_error ?? result?.error ?? null;
  const stderr = typeof result?.stderr === "string" ? result.stderr : null;
  const production = PRODUCTION_RUNNER_RESULTS.has(result);
  const detail = {
    ...facts,
    status: result?.status ?? null,
    signal: result?.signal ?? null,
    ...(result?.overflow === true ? { output_overflow: true } : {}),
    ...(result?.timed_out === true ? { timed_out: true } : {}),
    ...(error === null ? {} : { native_error: nativeErrorFacts(error) }),
    stderr,
    stderr_bytes: production ? result.stderr_bytes
      : stderr === null ? null : Buffer.byteLength(stderr, "utf8")
  };
  if (production && isPlainObject(result.trace2)) {
    Object.defineProperty(detail, "git_trace2", {
      value: result.trace2, enumerable: false, writable: false, configurable: false
    });
  }
  return detail;
}

function gitFailureCause(result) {
  if (result?.spawn_error instanceof Error) return result.spawn_error;
  return result?.error instanceof Error ? result.error : null;
}

export function mintGitFailure(code, message, result, facts) {
  const error = new TerminalWkCandidateError(message, {
    code, detail: gitFailureDetail(result, facts), cause: gitFailureCause(result)
  });
  const diagnosis = nativeGitDiagnosis(result);
  if (diagnosis !== null) {
    const mechanical = boundedMechanicalDetail(error.detail);
    NATIVE_GIT_DIAGNOSES.set(error, Object.freeze({
      code,
      git_operation: mechanical?.git_operation ?? null,
      git_status: mechanical?.git_status ?? null,
      diagnosis
    }));
  }
  return error;
}

export function failGit(code, message, result, facts) {
  throw mintGitFailure(code, message, result, facts);
}

export async function observeAfterFailedWrite(observe, writeFailure) {
  try {
    return await observe();
  } catch (observationError) {
    if (!(observationError instanceof TerminalWkCandidateError)) {
      writeFailure.detail.reobservation_failure = observationError;
      throw writeFailure;
    }
    const error = new TerminalWkCandidateError(
      String(observationError.message).replace(/^terminal WK candidate: /u, ""), {
        code: observationError.code,
        detail: { ...(isPlainObject(observationError.detail) ? observationError.detail : {}),
          write_failure: writeFailure },
        cause: observationError
      });
    const registered = NATIVE_GIT_DIAGNOSES.get(observationError);
    if (registered !== undefined) NATIVE_GIT_DIAGNOSES.set(error, registered);
    throw error;
  }
}

export function classifyAncestryObservation(result) {
  if (result?.ok === true && (result.status === undefined || result.status === 0)) return "ancestor";
  const completed = result?.status === 1 && result?.signal == null && result?.error == null &&
    result?.spawn_error == null && result?.timed_out !== true && result?.overflow !== true;
  if (!completed) return "failed";
  const trace2 = result.trace2;
  if (trace2 === undefined) return "not_ancestor";
  return isPlainObject(trace2) && trace2.state === "none_emitted" ? "not_ancestor" : "failed";
}

export function projectTerminalWkCandidateGitDiagnosis(error) {
  if ((typeof error !== "object" || error === null) && typeof error !== "function") return null;
  return NATIVE_GIT_DIAGNOSES.get(error) ?? null;
}

export function projectTerminalWkCandidateRefDisagreements(value) {
  try {
    if (!Array.isArray(value) || value.length === 0 || value.length > 32) return null;
    const projected = [];
    for (const entry of value) {
      if (!isPlainObject(entry) || Object.getPrototypeOf(entry) !== Object.prototype) return null;
      const { ref, expected, actual } = entry;
      if (typeof ref !== "string" || ref.length === 0 || ref.length > 1024) return null;
      for (const oid of [expected, actual]) {
        if (oid !== null && (typeof oid !== "string" || !OID_RE.test(oid))) return null;
      }
      projected.push(Object.freeze({ ref, expected, actual }));
    }
    return Object.freeze(projected);
  } catch {
    return null;
  }
}

function boundedMechanicalDetail(detail) {
  if (!isPlainObject(detail)) return null;
  const projected = {};
  if (Array.isArray(detail.args)) {
    projected.git_args = detail.args.slice(0, 32).map((arg) => String(arg).slice(0, 256));
    const operation = detail.args.find((arg) => typeof arg === "string" && !arg.startsWith("-"));
    if (operation !== undefined) projected.git_operation = operation.slice(0, 256);
  }
  for (const field of ["ref", "path", "oid"]) {
    if (typeof detail[field] === "string") projected[`git_${field}`] = detail[field].slice(0, 1024);
  }
  const disagreements = projectTerminalWkCandidateRefDisagreements(detail.ref_disagreements);
  if (disagreements !== null) projected.ref_disagreements = disagreements;
  if (detail.status !== undefined) {
    projected.git_status = detail.status === null ? null : Number(detail.status);
  }
  if (detail.signal !== undefined) {
    projected.git_signal = typeof detail.signal === "string" ? detail.signal : null;
  }
  if (detail.output_overflow === true) projected.git_output_overflow = true;
  if (isPlainObject(detail.native_error)) projected.git_native_error = { ...detail.native_error };
  if (Object.hasOwn(detail, "stderr_bytes")) {
    if (Number.isSafeInteger(detail.stderr_bytes)) projected.git_stderr_bytes = detail.stderr_bytes;
  } else if (typeof detail.stderr === "string") {
    projected.git_stderr_bytes = Buffer.byteLength(detail.stderr, "utf8");
  }
  return Object.keys(projected).length === 0 ? null : Object.freeze(projected);
}

export const TERMINAL_WK_CANDIDATE_UNKNOWN_FAILURE_MESSAGE =
  "terminal WK candidate: unknown construction or recovery failure";

const TERMINAL_WK_CANDIDATE_UNKNOWN_FAILURE = Object.freeze({
  kind: "unknown_cause",
  code: null,
  name: null,
  message: TERMINAL_WK_CANDIDATE_UNKNOWN_FAILURE_MESSAGE,
  detail: null
});

export function projectTerminalWkCandidateFailure(error) {
  if (error instanceof TerminalWkCandidateError) {
    const code = typeof error.code === "string" ? error.code : null;
    const detail = boundedMechanicalDetail(error.detail);
    const registered = projectTerminalWkCandidateGitDiagnosis(error);
    return Object.freeze({
      kind: "typed_candidate_error",
      code,
      message: boundedFailureMessage(error.message),
      detail: registered === null || registered.code !== code ? detail
        : Object.freeze({ ...(detail ?? {}), git_diagnosis: registered.diagnosis })
    });
  }
  return TERMINAL_WK_CANDIDATE_UNKNOWN_FAILURE;
}

export async function defaultTerminalCandidateRunGit({ repo, args, env = null, input = undefined }) {
  const result = await runGitAsync({
    repo,
    args,
    quotePath: true,
    input,
    env: env === null ? process.env : { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
    trace2Diagnostics: true
  });
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const facts = {
    status: typeof result.status === "number" ? result.status : null,
    signal: result.signal ?? null,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr,
    stderr_bytes: result.overflow === true ? null : Buffer.byteLength(stderr, "utf8"),
    ...(result.trace2 === undefined ? {} : { trace2: result.trace2 })
  };
  const adapted = result.error
    ? {
        ok: false,
        error: result.error,
        ...(result.overflow === true ? { overflow: true } : {}),
        ...(result.timed_out === true ? { timed_out: true } : {}),
        ...(result.spawn_error === undefined ? {} : { spawn_error: result.spawn_error }),
        ...facts
      }
    : { ok: result.status === 0, ...facts };
  PRODUCTION_RUNNER_RESULTS.add(adapted);
  return adapted;
}

export function authorityGitArgs(args) {
  return ["--no-replace-objects", ...args];
}

export function canonicalOid(value, field) {
  const oid = String(value ?? "").trim();
  if (!OID_RE.test(oid) || /^0+$/u.test(oid)) {
    fail(TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH, `${field} is not a canonical object id`, { field, value: oid });
  }
  return oid;
}

export function assertRefTransactionFences(verifyRefs, writtenRefs) {
  const named = new Set(writtenRefs);
  for (const { ref, oid } of verifyRefs) {
    if (typeof ref !== "string" || ref.length === 0 || named.has(ref)) {
      fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "verified ref is invalid");
    }
    named.add(ref);
    canonicalOid(oid, `verified ${ref}`);
  }
}

export function oidReForObjectFormat(objectFormat) {
  if (objectFormat === "sha1") return /^[0-9a-f]{40}$/u;
  if (objectFormat === "sha256") return /^[0-9a-f]{64}$/u;
  return OID_RE;
}

export async function assertBaseAncestor(runGit, repo, base, wkTip) {
  const args = authorityGitArgs(["merge-base", "--is-ancestor", base, wkTip]);
  const result = await runGit({ repo, args, env: null });
  const observed = classifyAncestryObservation(result);
  if (observed === "ancestor") return;
  const facts = { args, base, wk_tip: wkTip };
  if (observed === "not_ancestor") {
    failGit(TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID,
      "base is not an ancestor of the accumulated WK tip", result, facts);
  }
  failGit(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED,
    "could not complete the ancestry comparison of base and the accumulated WK tip", result, facts);
}

export async function readExactWkRecordBlobObservation({
  mainRepo,
  wkTip,
  canonicalWkId,
  runGit = defaultTerminalCandidateRunGit,
  objectFormat
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) || path.normalize(mainRepo) !== mainRepo ||
      !["sha1", "sha256"].includes(objectFormat) ||
      !oidReForObjectFormat(objectFormat).test(wkTip ?? "") ||
      !WK_RE.test(canonicalWkId ?? "") || typeof runGit !== "function") {
    fail(TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, "WK record observation inputs are invalid");
  }
  const recordPath = `wiki/work-records/${canonicalWkId}.json`;
  const result = await runGit({
    repo: mainRepo,
    args: authorityGitArgs(["ls-tree", "-z", "--full-tree", wkTip, "--", recordPath]),
    env: null
  });
  if (!result || result.ok !== true || result.error != null || result.signal != null ||
      (result.status !== undefined && result.status !== 0)) {
    failGit(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, "could not observe exact WK record path", result,
      { args: authorityGitArgs(["ls-tree"]), path: recordPath });
  }
  const stdout = typeof result.stdout === "string" ? result.stdout : null;
  if (stdout === null) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID, "WK record path observation is malformed", { path: recordPath });
  }
  if (stdout === "") return Object.freeze({ state: "absent", path: recordPath, wk_tip: wkTip });
  if (!stdout.endsWith("\0")) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID, "WK record path observation is malformed", { path: recordPath });
  }
  const entries = stdout.slice(0, -1).split("\0");
  if (entries.length !== 1) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID, "WK record path observation is ambiguous", { path: recordPath });
  }
  const match = /^(\d{6}) (blob|tree) ([0-9a-f]{40}|[0-9a-f]{64})\t([^\0]+)$/u.exec(entries[0]);
  if (match === null || match[1] !== "100644" || match[2] !== "blob" || match[4] !== recordPath ||
      /^0+$/u.test(match[3]) || !oidReForObjectFormat(objectFormat).test(match[3])) {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID, "WK record path observation is not one canonical blob", {
      path: recordPath
    });
  }
  const oid = match[3];
  const blobResult = await runGit({ repo: mainRepo, args: authorityGitArgs(["cat-file", "blob", oid]), env: null });
  if (!blobResult || blobResult.ok !== true || blobResult.error != null || blobResult.signal != null ||
      (blobResult.status !== undefined && blobResult.status !== 0)) {
    failGit(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, "could not read exact WK record blob", blobResult,
      { args: authorityGitArgs(["cat-file", "blob", oid]), path: recordPath, oid });
  }
  if (typeof blobResult.stdout !== "string") {
    fail(TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID, "WK record blob is unreadable", { path: recordPath, oid });
  }
  return Object.freeze({ state: "present", path: recordPath, wk_tip: wkTip, oid, content: blobResult.stdout });
}
