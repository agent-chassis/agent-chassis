

import path from "node:path";

import {
  BACKEND_FINAL_RESULT_KINDS,
  BACKEND_MISSING_RESULT_CODES,
  WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION,
  normalizeFinalResult
} from "./workspace-agent-dispatch-backend.mjs";

import {
  deriveTerminalStatus,
  normalizeExitEnvelope,
  LAUNCHER_DEFAULT_TERMINATION_SIGNAL
} from "./workspace-agent-launch-adapter-contract.mjs";

export {
  WORKSPACE_AGENT_LAUNCH_SEAM_SCHEMA_VERSION,
  LAUNCHER_ROLES,
  LAUNCHER_DISPATCH_ROLES,
  LAUNCHER_ORCHESTRATOR_ROLE,
  LAUNCHER_ORCHESTRATOR_PLAN_ROLES,
  LAUNCHER_WRITE_POSTURES,
  LAUNCHER_ROLE_WRITE_POSTURE,
  validateLauncherRole,
  launcherRoleWritePosture,
  launcherRoleMayWrite,
  LAUNCHER_ADAPTER_FACT_HOOKS,
  LAUNCHER_FORBIDDEN_ADAPTER_HOOKS,
  LAUNCHER_OWNED_POLICY_SURFACES,
  sanitizeFamilyAdapter,
  validateFamilyAdapter,
  LAUNCHER_REFUSAL_REASONS,
  launcherRefusalBackendCode,
  buildLauncherRefusal,
  LAUNCHER_READINESS_HANDOFF_FIELDS,
  LAUNCHER_ADMISSION_HANDOFF_FIELDS,
  normalizeReadinessHandoff,
  normalizeAdmissionHandoff,
  LAUNCHER_IDENTITY_REFUSAL_HANDOFF_FIELDS,
  normalizeIdentityRefusalHandoff,
  LAUNCHER_PRE_SPAWN_GATE_PRIMITIVES,
  LAUNCHER_COORDINATION_WRITE_ROOTS,
  isCoordinationWritePath,
  gateRoleWriteScope,
  LAUNCHER_GRAPH_IMPACT_HANDOFF_FIELDS,
  normalizeGraphImpactHandoff,
  LAUNCHER_TRANSPORT_SECRET_DENY_NAMES,
  LAUNCHER_TRANSPORT_SECRET_DENY_NAME_PATTERNS,
  LAUNCHER_REDACTED_VALUE,
  isTransportSecretKey,
  redactTransportSecrets,
  LAUNCHER_RUNTIME_CONTEXT_FIELDS,
  buildLauncherRuntimeContext,
  LAUNCHER_BWRAP_INPUT_FIELDS,
  validateBwrapInputShape,
  LAUNCHER_RUNTIME_STATES,
  LAUNCHER_TERMINAL_STATES,
  isTerminalRuntimeState,
  LAUNCHER_DEFAULT_TERMINATION_SIGNAL,
  deriveTerminalStatus,
  normalizeExitEnvelope,
  isOrchestratorPlanRole
} from "./workspace-agent-launch-adapter-contract.mjs";

export const WORKSPACE_AGENT_LAUNCH_CORE_SCHEMA_VERSION =
  "workspace-agent-launch-core.v1";

export const WORKSPACE_AGENT_FROZEN_SCOPE_AUTHORITY_SCHEMA_VERSION =
  "workspace-agent-frozen-scope-authority.v1";

function scopeAuthorityError(message) {
  const error = new Error(message);
  error.code = "worker_scope_authority_invalid";
  return error;
}

function sameFrozenStringArray(value, expected = null) {
  if (!Array.isArray(value) || !Object.isFrozen(value) ||
      value.some((entry) => typeof entry !== "string" || entry.length === 0)) return false;
  return expected === null || (value.length === expected.length &&
    value.every((entry, index) => entry === expected[index]));
}

export function assertFrozenWorkerScopeAuthority(authority, {
  role = "worker",
  subject = null,
  worktreeProvisioning = null,
  provisionedWorktreeGitBinding = null,
  required = role === "worker"
} = {}) {
  if (authority === null || authority === undefined) {
    if (required) throw scopeAuthorityError("managed worker scope authority is missing");
    return null;
  }
  if (role !== "worker") {
    throw scopeAuthorityError("worker scope authority cannot bind a non-worker role");
  }
  if (typeof authority !== "object" || Array.isArray(authority) || !Object.isFrozen(authority) ||
      authority.schema_version !== WORKSPACE_AGENT_FROZEN_SCOPE_AUTHORITY_SCHEMA_VERSION) {
    throw scopeAuthorityError("worker scope authority is malformed or mutable");
  }
  const selected = authority.selected_unit;
  if (!selected || typeof selected !== "object" || Array.isArray(selected) || !Object.isFrozen(selected) ||
      selected.kind !== "slice" || typeof selected.address !== "string" ||
      typeof selected.record_id !== "string" || typeof selected.slice_id !== "string" ||
      (selected.repo !== null && typeof selected.repo !== "string")) {
    throw scopeAuthorityError("worker scope authority selected-unit binding is malformed or mutable");
  }
  if (subject !== null && selected.address !== subject) {
    throw scopeAuthorityError("worker scope authority selected-unit binding mismatches the launch subject");
  }
  if (authority.source !== `wiki/work-records/${selected.record_id}.json#${selected.slice_id}` ||
      typeof authority.unit_address !== "string" ||
      !authority.unit_address.endsWith(`/${selected.record_id}/${selected.slice_id}`) ||
      typeof authority.source_digest !== "string" || authority.source_digest.length === 0 ||
      (authority.source_version !== null &&
        (typeof authority.source_version !== "string" || authority.source_version.length === 0))) {
    throw scopeAuthorityError("worker scope authority source or selected-unit identity is mismatched");
  }
  if (!sameFrozenStringArray(authority.read_scope) ||
      !sameFrozenStringArray(authority.repo_paths) ||
      !sameFrozenStringArray(authority.write_scope)) {
    throw scopeAuthorityError("worker scope authority R/W sets are malformed or mutable");
  }
  const readable = [...new Set([...authority.read_scope, ...authority.repo_paths])].sort();
  if (!sameFrozenStringArray(authority.readable_scope, readable)) {
    throw scopeAuthorityError("worker scope authority readable_scope mismatches frozen R");
  }
  const sliceBinding = worktreeProvisioning?.slice_binding ?? null;
  if (sliceBinding !== null) {
    for (const [field, expected] of [
      ["unit_address", authority.unit_address],
      ["write_scope_source", authority.source],
      ["source_digest", authority.source_digest],
      ["source_version", authority.source_version]
    ]) {
      if (sliceBinding[field] !== expected) {
        throw scopeAuthorityError(`worker scope authority provisioning mismatch at ${field}`);
      }
    }
    for (const field of ["read_scope", "repo_paths", "write_scope"]) {
      if (!sameFrozenStringArray(authority[field], sliceBinding[field])) {
        throw scopeAuthorityError(`worker scope authority provisioning mismatch at ${field}`);
      }
    }
  }
  const bindingPath = provisionedWorktreeGitBinding?.worktreePath
    ?? provisionedWorktreeGitBinding?.worktree_path
    ?? null;
  if (bindingPath !== null && typeof worktreeProvisioning?.worktree_path === "string" &&
      bindingPath !== worktreeProvisioning.worktree_path) {
    throw scopeAuthorityError("worker scope authority provisioning worktree identity mismatches credential binding");
  }
  return authority;
}

export const DEFAULT_MAX_CAPTURE_BYTES = 1024 * 1024;

export const DEFAULT_MAX_STDERR_DETAIL_BYTES = 4096;

export const DEFAULT_STREAM_DRAIN_TIMEOUT_MS = 2000;

export {
  LAUNCHER_DEFAULT_TERMINATION_SIGNAL as DEFAULT_LAUNCH_KILL_SIGNAL
} from "./workspace-agent-launch-adapter-contract.mjs";

export const SHARED_FAMILY_BWRAP_ENV_ALLOWLIST = Object.freeze([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TERM",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "XDG_RUNTIME_DIR",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME"
]);

export function assembleRoleIsolationInputs({
  role,
  repo,
  sourceHome = null,
  readOnlyRoots = [],
  extraRuntimeRoots = [],
  writableProjectRoots = [],
  writableFiles = [],
  runtimeDir = null,
  schemaVersion,
  failClosedMode,
  shareNet = true,
  workerScopeAuthority = null
} = {}) {
  const baseReadOnlyRoots = Array.isArray(readOnlyRoots) ? readOnlyRoots : [];
  const extras = Array.isArray(extraRuntimeRoots) ? extraRuntimeRoots : [];
  const hasSourceHome = typeof sourceHome === "string" && sourceHome.length > 0;
  if (role === "orch" || role === "orch-resume") {
    const writable = [
      path.join(repo, "docs"),
      path.join(repo, "wiki")
    ];

    const runtime = [];
    if (typeof runtimeDir === "string" && runtimeDir.length > 0) {
      runtime.push(runtimeDir);
    }
    if (hasSourceHome) {
      runtime.push(sourceHome);
    }
    for (const extra of extras) {
      if (!runtime.includes(extra)) runtime.push(extra);
    }
    return Object.freeze({
      schema_version: schemaVersion,
      fail_closed_mode: failClosedMode,
      share_net: shareNet,
      writable_roots: Object.freeze([...writable]),
      writable_files: Object.freeze([]),
      runtime_roots: Object.freeze(runtime),
      read_only_roots: Object.freeze([...baseReadOnlyRoots]),
      home_policy_reads: Object.freeze([])
    });
  }
  if (role === "worker") {
    const frozenWorkerScopeAuthority = assertFrozenWorkerScopeAuthority(workerScopeAuthority, {
      role,
      required: workerScopeAuthority !== null
    });
    const absWritable = [];
    const seen = new Set();
    for (const root of Array.isArray(writableProjectRoots) ? writableProjectRoots : []) {
      if (typeof root !== "string" || root.length === 0) continue;
      const abs = path.isAbsolute(root) ? root : path.resolve(repo, root);
      if (seen.has(abs)) continue;
      seen.add(abs);
      absWritable.push(abs);
    }

    const absWritableFiles = [];
    const seenFiles = new Set();
    for (const file of Array.isArray(writableFiles) ? writableFiles : []) {
      if (typeof file !== "string" || file.length === 0) continue;
      const abs = path.isAbsolute(file) ? file : path.resolve(repo, file);
      if (seenFiles.has(abs)) continue;
      seenFiles.add(abs);
      absWritableFiles.push(abs);
    }
    const workerRuntime = [];
    if (typeof runtimeDir === "string" && runtimeDir.length > 0) {
      workerRuntime.push(runtimeDir);
    }
    for (const extra of extras) {
      if (!workerRuntime.includes(extra)) workerRuntime.push(extra);
    }
    return Object.freeze({
      schema_version: schemaVersion,
      fail_closed_mode: failClosedMode,
      share_net: shareNet,
      writable_roots: Object.freeze(absWritable),
      writable_files: Object.freeze(absWritableFiles),
      runtime_roots: Object.freeze(workerRuntime),
      read_only_roots: Object.freeze([...baseReadOnlyRoots]),

      home_policy_reads: Object.freeze(hasSourceHome ? [sourceHome] : []),
      worker_scope_authority: frozenWorkerScopeAuthority
    });
  }
  if (role === "review" || role === "redteam") {
    const readOnlyRuntime = [];
    if (typeof runtimeDir === "string" && runtimeDir.length > 0) {
      readOnlyRuntime.push(runtimeDir);
    }
    for (const extra of extras) {
      if (!readOnlyRuntime.includes(extra)) readOnlyRuntime.push(extra);
    }
    return Object.freeze({
      schema_version: schemaVersion,
      fail_closed_mode: failClosedMode,
      share_net: shareNet,
      writable_roots: Object.freeze([]),
      writable_files: Object.freeze([]),
      runtime_roots: Object.freeze(readOnlyRuntime),
      read_only_roots: Object.freeze([...baseReadOnlyRoots]),
      home_policy_reads: Object.freeze(hasSourceHome ? [sourceHome] : [])
    });
  }
  return null;
}

export const NO_FINDINGS_LINE_PATTERNS = [
  /^\s*(?:no\s+(?:findings|issues|defects|problems|results))\b[.!]?\s*$/i,
  /^\s*##+\s*no\s+(?:findings|issues|defects|problems)\b[.!]?\s*$/i
];

export function detectNoFindingsLine(text) {
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    for (const pattern of NO_FINDINGS_LINE_PATTERNS) {
      if (pattern.test(trimmed)) return trimmed;
    }

    return null;
  }
  return null;
}

export function buildMissingResultPayload(code, reason = null, detail = null) {
  return {
    kind: "missing_result",
    missing_result: {
      code,
      reason: reason ?? null,
      detail: detail ?? null
    }
  };
}

function buildExitEnvelope(parts = {}) {
  return normalizeExitEnvelope(parts);
}

export function createBoundedCapture(maxBytes = DEFAULT_MAX_CAPTURE_BYTES) {
  const cap = typeof maxBytes === "number" && maxBytes > 0
    ? maxBytes
    : DEFAULT_MAX_CAPTURE_BYTES;
  const chunks = [];
  let retainedBytes = 0;
  let totalBytes = 0;
  let truncated = false;

  return {
    push(chunk) {
      if (chunk === null || chunk === undefined) return;
      const str = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (str.length === 0) return;
      const len = Buffer.byteLength(str, "utf8");
      totalBytes += len;
      if (retainedBytes >= cap) {
        truncated = true;
        return;
      }
      chunks.push(str);
      retainedBytes += len;
      if (retainedBytes >= cap) {
        truncated = true;
      }
    },
    text() {
      return chunks.join("");
    },
    tail(maxTailBytes) {
      const full = chunks.join("");
      if (typeof maxTailBytes !== "number" || maxTailBytes <= 0) return full;
      return full.length > maxTailBytes ? full.slice(full.length - maxTailBytes) : full;
    },
    get totalBytes() {
      return totalBytes;
    },
    get retainedBytes() {
      return retainedBytes;
    },
    get truncated() {
      return truncated;
    }
  };
}

export function buildBoundedStderrDetail({
  status = null,
  exit = null,
  stdoutBytes = 0,
  stderrText = "",
  stderrTotalBytes = null,
  stderrTruncated = false,
  maxStderrDetailBytes = DEFAULT_MAX_STDERR_DETAIL_BYTES
} = {}) {
  const text = typeof stderrText === "string" ? stderrText : "";
  const total = typeof stderrTotalBytes === "number"
    ? stderrTotalBytes
    : Buffer.byteLength(text, "utf8");
  const tail = total > 0
    ? (typeof maxStderrDetailBytes === "number" && maxStderrDetailBytes > 0 && text.length > maxStderrDetailBytes
        ? text.slice(text.length - maxStderrDetailBytes)
        : text)
    : null;
  return {
    status: status ?? null,
    exit_code: exit?.code ?? null,
    exit_signal: exit?.signal ?? null,
    exit_error: exit?.error ?? null,
    stdout_bytes: typeof stdoutBytes === "number" ? stdoutBytes : 0,
    stderr_bytes: total,
    stderr_truncated: Boolean(stderrTruncated),
    stderr_tail: tail
  };
}

function mergeMissingResultDetail(parserDetail, stderrDetail) {
  if (parserDetail === null || parserDetail === undefined) {
    return { ...stderrDetail };
  }
  if (typeof parserDetail !== "object" || Array.isArray(parserDetail)) {
    return { parser_detail: parserDetail, ...stderrDetail };
  }
  return { ...stderrDetail, ...parserDetail };
}

export function superviseChildLaunch({
  child,
  parseFinalResult,
  role = null,
  subject = null,
  family = null,
  passthrough = {},
  maxCaptureBytes = DEFAULT_MAX_CAPTURE_BYTES,
  maxStderrDetailBytes = DEFAULT_MAX_STDERR_DETAIL_BYTES,
  killTimeoutMs = null,
  killSignal = LAUNCHER_DEFAULT_TERMINATION_SIGNAL,
  streamDrainTimeoutMs = DEFAULT_STREAM_DRAIN_TIMEOUT_MS,
  logger = console
} = {}) {
  if (!child || typeof child !== "object") {
    throw new TypeError(
      "superviseChildLaunch requires a spawned child process object"
    );
  }
  if (typeof parseFinalResult !== "function") {
    throw new TypeError(
      "superviseChildLaunch requires a parseFinalResult adapter function"
    );
  }

  const stdoutCapture = createBoundedCapture(maxCaptureBytes);
  const stderrCapture = createBoundedCapture(maxCaptureBytes);

  const runtime = {
    status: "launching",
    exit: null,

    exited: false,
    terminal: false,

    timedOut: false,
    pid: typeof child.pid === "number" ? child.pid : null,
    finalResult: null,
    finalResultPromise: null
  };

  let killTimer = null;
  function clearKillTimer() {
    if (killTimer !== null) {
      clearTimeout(killTimer);
      killTimer = null;
    }
  }

  let pendingStreamCloses = 0;
  let streamDrainForced = false;
  let streamDrainTimer = null;
  let flushGateResolved = false;
  let resolveFlushGate = null;
  const flushGate = new Promise((resolve) => {
    resolveFlushGate = resolve;
  });

  function clearDrainTimer() {
    if (streamDrainTimer !== null) {
      clearTimeout(streamDrainTimer);
      streamDrainTimer = null;
    }
  }

  function emitStreamDrainWarning() {
    const message =
      "[agent-launch] WARNING: child exited while stdout/stderr remained open; " +
      "finalizing on bounded post-exit stream drain and tearing down the child process";
    try {
      if (typeof logger === "function") {
        logger(message);
      } else if (logger && typeof logger.warn === "function") {
        logger.warn(message);
      } else {
        console.warn(message);
      }
    } catch (_) {

    }
  }

  function teardownDrainHeldChild() {
    try {
      child.stdout?.destroy?.();
    } catch (_) {

    }
    try {
      child.stderr?.destroy?.();
    } catch (_) {

    }
    if (typeof child.kill === "function") {
      try {
        child.kill();
      } catch (_) {

      }
    }
  }

  function armStreamDrainTimer() {
    if (
      flushGateResolved ||
      pendingStreamCloses <= 0 ||
      streamDrainTimer !== null ||
      typeof streamDrainTimeoutMs !== "number" ||
      streamDrainTimeoutMs <= 0
    ) {
      return;
    }
    streamDrainTimer = setTimeout(() => {
      if (flushGateResolved) return;
      streamDrainTimer = null;
      streamDrainForced = true;
      emitStreamDrainWarning();
      maybeResolveFlushGate();
      queueMicrotask(teardownDrainHeldChild);
    }, streamDrainTimeoutMs);
    if (typeof streamDrainTimer.unref === "function") streamDrainTimer.unref();
  }

  function maybeResolveFlushGate() {
    if (!runtime.exited || (pendingStreamCloses > 0 && !streamDrainForced)) return;
    runtime.terminal = true;
    if (!flushGateResolved) {
      flushGateResolved = true;
      clearDrainTimer();
      resolveFlushGate();
    }
  }

  function recordExit(status, exitEnvelope) {
    if (runtime.exited) return;
    runtime.exited = true;
    runtime.status = status;
    runtime.exit = exitEnvelope;

    clearKillTimer();
    maybeResolveFlushGate();
    armStreamDrainTimer();
  }

  function observeAlreadyExitedChild() {
    const code = typeof child.exitCode === "number" ? child.exitCode : null;
    const signal = typeof child.signalCode === "string" ? child.signalCode : null;
    if (code === null && signal === null) return;
    if (runtime.exited) {
      maybeResolveFlushGate();
      return;
    }

    clearDrainTimer();
    pendingStreamCloses = 0;
    const finalStatus = deriveTerminalStatus({ code, signal });
    recordExit(finalStatus, buildExitEnvelope({ code, signal }));

    maybeResolveFlushGate();
  }

  function watchStreamClose(stream) {
    if (!stream || typeof stream.on !== "function") return;
    if (
      stream.readableEnded === true ||
      stream.closed === true ||
      stream.destroyed === true
    ) {
      return;
    }
    pendingStreamCloses += 1;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      pendingStreamCloses -= 1;
      if (pendingStreamCloses === 0) clearDrainTimer();
      maybeResolveFlushGate();
    };
    stream.on("end", settle);
    stream.on("close", settle);
    stream.on("error", settle);
  }

  if (child.stdout && typeof child.stdout.on === "function") {
    child.stdout.on("data", (chunk) => stdoutCapture.push(chunk));
  }
  if (child.stderr && typeof child.stderr.on === "function") {
    child.stderr.on("data", (chunk) => stderrCapture.push(chunk));
  }
  watchStreamClose(child.stdout);
  watchStreamClose(child.stderr);

  if (typeof child.on === "function") {
    child.on("exit", (code, signal) => {
      const finalStatus = deriveTerminalStatus({ code, signal });
      recordExit(finalStatus, buildExitEnvelope({ code, signal }));
    });
    child.on("error", (err) => {

      clearDrainTimer();
      pendingStreamCloses = 0;
      recordExit("failed", buildExitEnvelope({ error: err?.message ?? String(err) }));
      maybeResolveFlushGate();
    });
    child.on("close", (code, signal) => {

      if (!runtime.exited) {
        const finalStatus = deriveTerminalStatus({ code, signal });
        recordExit(finalStatus, buildExitEnvelope({ code, signal }));
      }
      clearDrainTimer();
      pendingStreamCloses = 0;
      maybeResolveFlushGate();
    });
  }
  observeAlreadyExitedChild();

  if (
    typeof child.kill === "function" &&
    typeof killTimeoutMs === "number" &&
    killTimeoutMs > 0 &&
    !runtime.exited
  ) {
    killTimer = setTimeout(() => {
      killTimer = null;
      runtime.timedOut = true;
      try {
        child.kill(killSignal);
      } catch (_) {

      }
      clearDrainTimer();
      pendingStreamCloses = 0;
      recordExit("failed", buildExitEnvelope({ signal: killSignal }));
      maybeResolveFlushGate();
    }, killTimeoutMs);
    if (typeof killTimer.unref === "function") killTimer.unref();
  }

  function boundedStderrDetail() {
    return buildBoundedStderrDetail({
      status: runtime.status,
      exit: runtime.exit,
      stdoutBytes: stdoutCapture.totalBytes,
      stderrText: stderrCapture.text(),
      stderrTotalBytes: stderrCapture.totalBytes,
      stderrTruncated: stderrCapture.truncated,
      maxStderrDetailBytes
    });
  }

  function familyReason(suffix) {
    return family ? `${family}_${suffix}` : suffix;
  }

  function finalizeMissingResult(code, reason, baseDetail) {
    return normalizeFinalResult({
      kind: "missing_result",
      missing_result: {
        code,
        reason,
        detail: mergeMissingResultDetail(baseDetail, boundedStderrDetail())
      }
    });
  }

  async function computeFinalResult() {

    await flushGate;

    if (runtime.timedOut) {
      return finalizeMissingResult(
        BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
        familyReason("runtime_timeout"),
        { timed_out: true, kill_timeout_ms: killTimeoutMs, kill_signal: killSignal }
      );
    }
    let captured;
    try {
      captured = await parseFinalResult({
        status: runtime.status,
        exit: runtime.exit,
        role,
        subject,
        pid: runtime.pid,
        stdout: stdoutCapture.text(),
        stderr: stderrCapture.text(),
        ...passthrough
      });
    } catch (err) {
      return finalizeMissingResult(
        BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_CAPTURE_THREW,
        familyReason("capture_final_result_threw"),
        { message: err?.message ?? String(err) }
      );
    }
    if (
      !captured ||
      typeof captured !== "object" ||
      !BACKEND_FINAL_RESULT_KINDS.includes(captured.kind)
    ) {
      return finalizeMissingResult(
        BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_INVALID_KIND,
        familyReason("capture_final_result_invalid_kind"),
        { received_kind: typeof captured?.kind === "string" ? captured.kind : null }
      );
    }
    if (captured.kind === "missing_result") {

      const mr = captured.missing_result && typeof captured.missing_result === "object"
        ? captured.missing_result
        : {};
      const code = typeof mr.code === "string" && mr.code.length > 0
        ? mr.code
        : BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED;
      return normalizeFinalResult({
        kind: "missing_result",
        missing_result: {
          code,
          reason: mr.reason ?? null,
          detail: mergeMissingResultDetail(mr.detail, boundedStderrDetail())
        },
        writeback: captured.writeback ?? null
      });
    }

    return normalizeFinalResult(captured);
  }

  async function ensureFinalResultCaptured() {
    if (runtime.finalResult) return runtime.finalResult;
    if (!runtime.finalResultPromise) {
      runtime.finalResultPromise = computeFinalResult();
    }
    runtime.finalResult = await runtime.finalResultPromise;
    return runtime.finalResult;
  }

  return {
    accepted: true,
    status: "launching",
    pid: runtime.pid,
    probe: async () => {
      observeAlreadyExitedChild();
      if (runtime.exited) {

        const finalResult = await ensureFinalResultCaptured();
        return {
          status: runtime.status,
          exit: runtime.exit,
          final_result: finalResult
        };
      }

      if (runtime.status === "launching") {
        runtime.status = "running";
      }
      return { status: runtime.status, exit: null, final_result: null };
    }
  };
}

export {
  LAUNCHER_TERMINAL_STATES as __LAUNCH_CORE_TERMINAL_STATUSES_FOR_TESTS
} from "./workspace-agent-launch-adapter-contract.mjs";
export const __LAUNCH_CORE_FINAL_RESULT_SCHEMA_VERSION_FOR_TESTS =
  WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION;
export * from './workspace-agent-launch-adapter-contract.mjs';
export function buildLauncherPolicySeam({
  lifecycle = {},
  refusal = {},
  terminal = {}
} = {}) {
  return {
    lifecycle: { ...lifecycle },
    refusal: { ...refusal },
    terminal: { ...terminal }
  };
}

export function buildLauncherRefusalPolicySeam({
  code = null,
  reason = null,
  details = null,
  terminal = null
} = {}) {
  return {
    code,
    reason,
    details,
    terminal
  };
}

export function buildLauncherTerminalPolicySeam({
  state = null,
  terminalStateSet = null,
  exitCode = null,
  signal = null,
  result = null,
} = {}) {
  return {
    state,
    terminalStateSet,
    exitCode,
    signal,
    result,
  };
}

const LAUNCH_CORE_SECRET_KEY_PATTERN =
  /(?:^|[_-])(?:token|secret|password|passwd|passphrase|api[_-]?key|auth|authorization|cookie|session|bearer|private[_-]?key|ssh[_-]?key)(?:$|[_-])/i;

function isPlainObjectLike(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSecretKey(key) {
  return typeof key === 'string' && LAUNCH_CORE_SECRET_KEY_PATTERN.test(key);
}

function redactLauncherTransportSecretValue(value, key = null) {
  if (Array.isArray(value)) {
    return value.map((entry) => redactLauncherTransportSecretValue(entry));
  }

  if (!isPlainObjectLike(value)) {
    return value;
  }

  const redacted = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (isSecretKey(entryKey)) {
      redacted[entryKey] = '[redacted]';
      continue;
    }

    if (
      entryKey === 'env' &&
      isPlainObjectLike(entryValue) &&
      Object.keys(entryValue).some((envKey) => isSecretKey(envKey))
    ) {
      redacted[entryKey] = redactLauncherTransportSecretValue(entryValue);
      continue;
    }

    if (typeof entryValue === 'string' && key !== 'env' && /^(?:bearer\s+|basic\s+|token\s+|secret\s+)/i.test(entryValue)) {
      redacted[entryKey] = '[redacted]';
      continue;
    }

    redacted[entryKey] = redactLauncherTransportSecretValue(entryValue, entryKey);
  }

  return redacted;
}

export function evaluateLauncherModelHintDisposition({
  adapterModelFlagName = null,
  adapterSupportsModelFlag = true,
  allowedModelHints = null,
  modelHint = null,
} = {}) {
  if (modelHint === null || modelHint === undefined || modelHint === '') {
    return {
      disposition: 'absent',
      modelHint: null,
      reason: null,
      adapterModelFlagName,
    };
  }

  if (typeof modelHint !== 'string') {
    return {
      disposition: 'refuse',
      modelHint,
      reason: 'invalid_model_hint_type',
      adapterModelFlagName,
      backendCode: 'LAUNCH_REFUSED',
    };
  }

  const normalizedModelHint = modelHint.trim();
  if (normalizedModelHint.length === 0) {
    return {
      disposition: 'refuse',
      modelHint,
      reason: 'empty_model_hint',
      adapterModelFlagName,
      backendCode: 'LAUNCH_REFUSED',
    };
  }

  if (!adapterSupportsModelFlag) {
    return {
      disposition: 'refuse',
      modelHint: normalizedModelHint,
      reason: 'model_hint_unsupported_for_executor',
      adapterModelFlagName,
      backendCode: 'LAUNCH_REFUSED',
    };
  }

  if (Array.isArray(allowedModelHints) && allowedModelHints.length > 0) {
    const allowed = new Set(allowedModelHints.map((entry) => String(entry).trim()).filter(Boolean));
    if (!allowed.has(normalizedModelHint)) {
      return {
        disposition: 'refuse',
        modelHint: normalizedModelHint,
        reason: 'unsupported_model_hint',
        adapterModelFlagName,
        backendCode: 'LAUNCH_REFUSED',
      };
    }
  }

  return {
    disposition: 'honor',
    modelHint: normalizedModelHint,
    reason: null,
    adapterModelFlagName,
  };
}

export function buildLauncherRefusalEnvelope({
  app = null,
  backendCode = 'LAUNCH_REFUSED',
  code = backendCode,
  detail = null,
  message = null,
  metadata = null,
  reason = null,
  retryable = false,
  role = null,
  subject = null,
} = {}) {
  const envelope = {
    kind: 'refusal',
    status: 'refused',
    code,
    backendCode,
    retryable: Boolean(retryable),
  };

  if (message !== null && message !== undefined && message !== '') {
    envelope.message = message;
  }

  if (reason !== null && reason !== undefined && reason !== '') {
    envelope.reason = reason;
  }

  if (role !== null && role !== undefined && role !== '') {
    envelope.role = role;
  }

  if (subject !== null && subject !== undefined && subject !== '') {
    envelope.subject = subject;
  }

  if (app !== null && app !== undefined && app !== '') {
    envelope.app = app;
  }

  if (detail !== null && detail !== undefined) {
    envelope.detail = redactLauncherTransportSecretValue(detail);
  }

  if (metadata !== null && metadata !== undefined) {
    envelope.metadata = redactLauncherTransportSecretValue(metadata);
  }

  if (!envelope.message) {
    envelope.message = reason ?? code;
  }

  return envelope;
}

export function redactLauncherTransportSecrets(payload) {
  return redactLauncherTransportSecretValue(payload);
}

export const LAUNCH_CORE_EXECUTOR_POLICY_HELPERS = Object.freeze({
  buildLauncherRefusalEnvelope,
  evaluateLauncherModelHintDisposition,
  redactLauncherTransportSecrets,
});
