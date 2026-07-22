

export const COMMIT_TOOL_EXPOSURE_GUARD_SCHEMA_VERSION = "commit-tool-exposure-guard.v1";

export const WORKER_COMMIT_TOOL_NAME = "commit";
export const WORKER_TOOL_ALLOWLIST = Object.freeze([WORKER_COMMIT_TOOL_NAME]);

export const COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.commit_tool_exposure_guard.invalid_arg.v1",

  CLOSED_SCHEMA_VIOLATION: "agent_launch.commit_tool_exposure_guard.closed_schema_violation.v1",

  WORKER_ASSERTED_BINDING: "agent_launch.commit_tool_exposure_guard.worker_asserted_binding.v1",

  WORKER_SUPPLIED_MESSAGE: "agent_launch.commit_tool_exposure_guard.worker_supplied_message.v1",

  MISSING_RESOLVER: "agent_launch.commit_tool_exposure_guard.missing_resolver.v1",
  INVALID_CREDENTIAL: "agent_launch.commit_tool_exposure_guard.invalid_credential.v1",

  BINDING_INCOMPLETE: "agent_launch.commit_tool_exposure_guard.binding_incomplete.v1",

  TOOL_SURFACE_VIOLATION: "agent_launch.commit_tool_exposure_guard.tool_surface_violation.v1"
});

export class CommitToolExposureGuardError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "CommitToolExposureGuardError";
    this.code = code ?? "agent_launch.commit_tool_exposure_guard.error.v1";
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

function fail(code, message, detail = null, cause = null) {
  throw new CommitToolExposureGuardError(`agent-launch commit-tool-exposure-guard: ${message}`, {
    code,
    detail,
    cause
  });
}

export const WORKER_ASSERTED_BINDING_KEYS = Object.freeze([
  "launch_ref",
  "launchRef",
  "run_id",
  "runId",
  "retry_id",
  "retryId",
  "output_branch",
  "outputBranch",
  "branch",
  "worktree_path",
  "worktreePath",
  "path",
  "write_scope",
  "writeScope",
  "subject",
  "base_sha",
  "baseSha",
  "expected",
  "expected_envelope",
  "expectedEnvelope",
  "initiative"
]);

export const WORKER_SUPPLIED_MESSAGE_KEYS = Object.freeze([
  "message",
  "commit_message",
  "commitMessage",
  "msg",
  "body",
  "text",
  "summary",
  "description"
]);

const BINDING_KEY_SET = new Set(WORKER_ASSERTED_BINDING_KEYS.map((k) => k.toLowerCase()));
const MESSAGE_KEY_SET = new Set(WORKER_SUPPLIED_MESSAGE_KEYS.map((k) => k.toLowerCase()));

export function assertClosedInputSchema(workerArgs) {
  if (workerArgs === undefined || workerArgs === null) return;
  if (typeof workerArgs !== "object" || Array.isArray(workerArgs)) {
    fail(
      COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES.CLOSED_SCHEMA_VIOLATION,
      "the worker `commit` call accepts NO argument (the only input is the fact of the call); " +
        `got a non-object argument: ${JSON.stringify(workerArgs)}`
    );
  }
  const keys = Object.keys(workerArgs);
  if (keys.length === 0) return;

  const asserted = keys.filter((k) => BINDING_KEY_SET.has(k.toLowerCase()));
  const messages = keys.filter((k) => MESSAGE_KEY_SET.has(k.toLowerCase()));
  if (messages.length > 0) {
    fail(
      COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES.WORKER_SUPPLIED_MESSAGE,
      "the commit message is SERVER-GENERATED; a worker-supplied message is an injection/forgery " +
        `channel into the trusted commit object and is refused: ${JSON.stringify(messages)}`,
      { message_keys: messages, all_keys: keys }
    );
  }
  if (asserted.length > 0) {
    fail(
      COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES.WORKER_ASSERTED_BINDING,
      "the full binding tuple is resolved SERVER-SIDE from the launcher-minted credential; a " +
        `worker-asserted binding component is refused, never silently ignored: ${JSON.stringify(asserted)}`,
      { asserted_keys: asserted, all_keys: keys }
    );
  }

  fail(
    COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES.CLOSED_SCHEMA_VIOLATION,
    `the worker \`commit\` call accepts NO argument (closed input schema); got keys: ${JSON.stringify(keys)}`,
    { all_keys: keys }
  );
}

export const REQUIRED_BINDING_FIELDS = Object.freeze([
  "launch_ref",
  "run_id",
  "retry_id",
  "output_branch",
  "worktree_path",
  "write_scope",
  "subject",
  "base_sha"
]);

function assertServerCredential(credential) {

  const ok =
    (typeof credential === "string" && credential.length > 0) ||
    (typeof credential === "object" && credential !== null && !Array.isArray(credential));
  if (!ok) {
    fail(
      COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES.INVALID_CREDENTIAL,
      "a server-provided launcher-minted credential handle (DEC-0120 amendment-3) is required to resolve identity; " +
        "identity is never resolved from worker input or a host default"
    );
  }
  return credential;
}

function assertCompleteBinding(binding) {
  if (typeof binding !== "object" || binding === null || Array.isArray(binding)) {
    fail(
      COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      `the injected resolver must return a binding object; got: ${JSON.stringify(binding)}`
    );
  }
  const missing = [];
  for (const field of REQUIRED_BINDING_FIELDS) {
    const v = binding[field];
    if (v === undefined || v === null || (typeof v === "string" && v.length === 0)) {
      missing.push(field);
    }
  }

  if (
    !missing.includes("write_scope") &&
    (!Array.isArray(binding.write_scope) ||
      binding.write_scope.length === 0 ||
      binding.write_scope.some((p) => typeof p !== "string" || p.length === 0))
  ) {
    missing.push("write_scope");
  }
  if (missing.length > 0) {
    fail(
      COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "the server-resolved binding is incomplete; refusing a partially-resolved identity rather than " +
        `exposing it: missing/invalid ${JSON.stringify(missing)}`,
      { missing }
    );
  }
  return binding;
}

function sanitizeBinding(binding) {
  return Object.freeze({
    launch_ref: binding.launch_ref,
    run_id: binding.run_id,
    retry_id: binding.retry_id,
    output_branch: binding.output_branch,
    worktree_path: binding.worktree_path,
    write_scope: Object.freeze([...binding.write_scope]),
    subject: binding.subject,
    base_sha: binding.base_sha,

    initiative: typeof binding.initiative === "string" ? binding.initiative : null
  });
}

export function resolveServerBinding({ credential, deps = {} } = {}) {
  const resolveBinding = deps.resolveBinding;
  if (typeof resolveBinding !== "function") {
    fail(
      COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES.MISSING_RESOLVER,
      "a deps.resolveBinding(credential) resolver is required (reuse the IN-0015 credential->scope " +
        "mechanism); refusing to resolve identity without it"
    );
  }
  assertServerCredential(credential);
  let binding;
  try {
    binding = resolveBinding(credential);
  } catch (err) {
    fail(
      COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "the injected credential->binding resolver threw; failing closed rather than exposing an unresolved identity",
      { message: err?.message ?? String(err), cause_code: err?.code ?? null },
      err
    );
  }
  assertCompleteBinding(binding);
  return sanitizeBinding(binding);
}

export const WK_SLICE_MARKER_TRAILER_KEY = "Wk-Slice";

const MANAGED_SLICE_SUBJECT_RE = /^WK-\d{4}#SLICE-\d{3}$/u;

export function buildWkSliceMarkerTrailer(subject) {
  if (typeof subject !== "string" || !MANAGED_SLICE_SUBJECT_RE.test(subject)) {
    return null;
  }
  return `${WK_SLICE_MARKER_TRAILER_KEY}: ${subject}`;
}

export function buildServerGeneratedCommitMessage(binding) {
  const subject = typeof binding?.subject === "string" ? binding.subject : "";
  const baseSha = typeof binding?.base_sha === "string" ? binding.base_sha : "";
  if (subject.length === 0 || baseSha.length === 0) {
    fail(
      COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "cannot generate a server commit message without a resolved subject and base_sha"
    );
  }
  const shortBase = baseSha.slice(0, 12);
  const subjectLine = `agent-launch worker delivery: ${subject} (base ${shortBase})`;
  const marker = buildWkSliceMarkerTrailer(subject);

  return marker === null ? subjectLine : `${subjectLine}\n\n${marker}`;
}

export function constructWorkerCommitToolSurface({
  commitToolFactory,
  requestedToolNames = [WORKER_COMMIT_TOOL_NAME]
} = {}) {
  if (typeof commitToolFactory !== "function") {
    fail(
      COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES.INVALID_ARG,
      "commitToolFactory must be a function that constructs the single `commit` tool"
    );
  }
  const requested = Array.isArray(requestedToolNames) ? requestedToolNames : [requestedToolNames];
  const disallowed = requested.filter((n) => n !== WORKER_COMMIT_TOOL_NAME);
  if (disallowed.length > 0) {
    fail(
      COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES.TOOL_SURFACE_VIOLATION,
      "the worker surface exposes EXACTLY one tool (`commit`); the IN-0015 filesystem read/write/list " +
        "and WK-1047 exec surfaces are never constructed here. Refusing to construct: " +
        JSON.stringify(disallowed),
      { disallowed, allowlist: WORKER_TOOL_ALLOWLIST }
    );
  }

  const commitTool = commitToolFactory();
  if (commitTool === undefined || commitTool === null) {
    fail(
      COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES.INVALID_ARG,
      "commitToolFactory must return the constructed `commit` tool"
    );
  }
  const surface = Object.freeze({ [WORKER_COMMIT_TOOL_NAME]: commitTool });

  const names = Object.keys(surface);
  if (names.length !== 1 || names[0] !== WORKER_COMMIT_TOOL_NAME) {
    fail(
      COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES.TOOL_SURFACE_VIOLATION,
      `the constructed worker tool surface must be exactly {${WORKER_COMMIT_TOOL_NAME}}; got ${JSON.stringify(names)}`
    );
  }
  return surface;
}

export function admitWorkerCommitCall({ credential, workerArgs = undefined, deps = {} } = {}) {

  assertClosedInputSchema(workerArgs);

  const binding = resolveServerBinding({ credential, deps });

  const serverGeneratedMessage = buildServerGeneratedCommitMessage(binding);

  return Object.freeze({
    schema_version: COMMIT_TOOL_EXPOSURE_GUARD_SCHEMA_VERSION,
    tool_name: WORKER_COMMIT_TOOL_NAME,
    binding,
    server_generated_message: serverGeneratedMessage
  });
}
