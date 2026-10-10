import { buildPublicMechanicalRefusal, isPlatformErrorCode, isPreservableSemanticIdentity } from "@agent-chassis/wiki-core/src/lib/refusal-payload.mjs";
import { projectDiagnostic } from "@agent-chassis/wiki-core/src/lib/diagnostic-projection.mjs";
import { isRuntimeBlockerCode } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { classifyMechanicalRuntimeBlocker } from "./dispatch-tools/runtime-blocker-classifier.mjs";
import { RESPONSE_BOUNDARY_ROUTE, RESPONSE_REFUSAL_SCHEMA_VERSION, PROCESS_ERROR_GUARDS_INSTALLED } from "./mcp-response-shared.mjs";

const MAX_CAUSE_DEPTH = 4;

export function safeReadProperty(target, key) {
  if (target === null || target === undefined) return undefined;
  try {
    return target[key];
  } catch {
    return undefined;
  }
}

function preservedCauseIdentity(error) {
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current && typeof current === "object"; depth += 1) {

    const code = safeReadProperty(current, "code");
    if (typeof code === "string") {
      if (isPlatformErrorCode(code)) return { identity: null, platform: true };
      if (isPreservableSemanticIdentity(code)) return { identity: code, platform: false };
    }
    current = safeReadProperty(current, "cause");
  }
  return { identity: null, platform: false };
}

export function buildResponseMechanicalRefusal({ code, decidingFacts, observedFacts, carried = null }) {
  return buildPublicMechanicalRefusal({
    code,
    deciding_facts: decidingFacts,
    no_supported_route: true,
    recovery: { state: "no_supported_route" },
    route: RESPONSE_BOUNDARY_ROUTE,
    observed_facts: observedFacts,
    ...(carried === null ? {} : { carried })
  });
}

function authenticatedExternalCondition(value) {
  const condition = safeReadProperty(value, "external_condition");
  return safeReadProperty(value, "authenticated_external_condition") === true &&
    typeof condition === "string" && condition.length > 0 && condition.length <= 256
    ? condition
    : null;
}

export function untypedFailureEnvelope(error) {
  const { identity, platform } = preservedCauseIdentity(error);
  const preservableIdentity = identity === "operator_recovery_needed" ? null : identity;
  const diagnostic = projectDiagnostic(error);
  const decidingFacts = [
    { field: "mcp_response.handler_completed", value: false }
  ];
  const observedFacts = { "mcp_response.handler_completed": false };
  if (preservableIdentity !== null) {

    decidingFacts.push({ field: "mcp_response.cause_identity", value: preservableIdentity });
    observedFacts["mcp_response.cause_identity"] = preservableIdentity;
  }
  if (platform) {

    decidingFacts.push({ field: "mcp_response.platform_error", value: true });
    observedFacts["mcp_response.platform_error"] = true;
  }
  const externalCondition = authenticatedExternalCondition(error);
  const classification = externalCondition !== null
    ? classifyMechanicalRuntimeBlocker({
        producer: "unexpected_external",
        condition: "authenticated_condition",
        detail: { authenticated: true, external_condition: externalCondition }
      })
    : preservableIdentity !== null && isRuntimeBlockerCode(preservableIdentity)
      ? null
      : classifyMechanicalRuntimeBlocker({
          producer: "mcp_response",
          condition: platform ? "platform_failure" : "handler_exception"
        });
  const code = classification?.code ?? preservableIdentity;
  if (externalCondition !== null) {
    decidingFacts.push({
      field: "mcp_response.external_condition",
      value: externalCondition
    });
    observedFacts["mcp_response.external_condition"] = externalCondition;
  }
  return {
    schema_version: RESPONSE_REFUSAL_SCHEMA_VERSION,
    code,
    accepted: false,
    owning_boundary: classification?.owning_boundary ?? "wiki-mcp.mcp-response",
    next_calls: classification?.detail?.next_calls ?? [],
    diagnostic: diagnostic.value,
    diagnostic_redactions: diagnostic.redactions,
    refusal: buildResponseMechanicalRefusal({
      code,
      decidingFacts,
      observedFacts
    })
  };
}

export function normalizeDeclaredOperatorRecoveryEnvelope(envelope) {
  const declaredRefusal = safeReadProperty(envelope, "refusal");
  const topLevelClaim = safeReadProperty(envelope, "code") === "operator_recovery_needed";
  const nestedClaim = declaredRefusal !== null && typeof declaredRefusal === "object" &&
    !Array.isArray(declaredRefusal) &&
    safeReadProperty(declaredRefusal, "code") === "operator_recovery_needed";
  if (!topLevelClaim && !nestedClaim) return envelope;

  const externalCondition = authenticatedExternalCondition(envelope);
  const classification = externalCondition === null
    ? classifyMechanicalRuntimeBlocker({
        producer: "mcp_response",
        condition: "handler_exception"
      })
    : classifyMechanicalRuntimeBlocker({
        producer: "unexpected_external",
        condition: "authenticated_condition",
        detail: { authenticated: true, external_condition: externalCondition }
      });
  const decidingFacts = externalCondition === null
    ? [
        { field: "mcp_response.handler_completed", value: false },
        { field: "mcp_response.declared_operator_recovery_authenticated", value: false }
      ]
    : [
        { field: "mcp_response.handler_completed", value: false },
        { field: "mcp_response.external_condition", value: externalCondition }
      ];
  const observedFacts = Object.fromEntries(
    decidingFacts.map(({ field, value }) => [field, value])
  );
  return {
    schema_version: RESPONSE_REFUSAL_SCHEMA_VERSION,
    code: classification.code,
    accepted: false,
    authority_limb: classification.authority_limb,
    cause: classification.cause,
    actor_recovery: classification.actor_recovery,
    owning_boundary: classification.owning_boundary,
    no_supported_route: true,
    next_calls: classification.detail.next_calls,
    ...(externalCondition === null ? {} : {
      authenticated_external_condition: true,
      external_condition: externalCondition
    }),
    refusal: buildResponseMechanicalRefusal({
      code: classification.code,
      decidingFacts,
      observedFacts,
      carried: { mechanical_classification: classification }
    })
  };
}

export function installProcessErrorGuards({
  processLike = process,
  log = null,
  diagnostics = null,
  requestShutdown = null
} = {}) {
  if (!processLike || typeof processLike.on !== "function") {
    throw new Error("installProcessErrorGuards requires a process-like object with .on()");
  }
  if (processLike[PROCESS_ERROR_GUARDS_INSTALLED]) {
    return { installed: false };
  }

  let lastTerminalDiagnostic = null;

  const failStop = ({ event, error, origin = null }) => {
    const entry = {
      level: "error",
      message:
        "wiki-mcp process-level invariant escaped its registered owner; failing stop",
      event,
      origin,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null
    };

    let published = false;
    if (diagnostics && typeof diagnostics.emit === "function") {
      try {
        published = diagnostics.emit(entry) === true;
      } catch {

        published = false;
      }
    }
    lastTerminalDiagnostic = Object.freeze({ event, origin, published });

    if (typeof log === "function") {
      try {
        log({ ...entry, diagnostic_published: published });
      } catch {

      }
    }

    if (diagnostics && typeof diagnostics.disable === "function") {
      try {
        diagnostics.disable();
      } catch {

      }
    }

    if (typeof requestShutdown === "function") requestShutdown(1);
  };

  processLike.on("unhandledRejection", (reason) => {
    failStop({ event: "unhandledRejection", error: reason });
  });
  processLike.on("uncaughtException", (error, origin) => {
    failStop({ event: "uncaughtException", error, origin });
  });

  Object.defineProperty(processLike, PROCESS_ERROR_GUARDS_INSTALLED, {
    value: true,
    enumerable: false,
    configurable: false
  });
  return {
    installed: true,
    get lastTerminalDiagnostic() { return lastTerminalDiagnostic; }
  };
}

export function createDiagnosticSink({
  stderr = process.stderr,
  serialize = JSON.stringify,
  write = (stream, text) => stream.write(text),
  log = null
} = {}) {
  let state = "active";
  const disable = () => { state = "disabled"; };
  if (stderr && typeof stderr.on === "function") {
    stderr.on("error", disable);
    stderr.on("close", disable);
  }
  const emit = (entry) => {
    if (state !== "active") return false;
    state = "emitting";
    try {
      write(stderr, `${serialize(entry)}\n`);
      if (typeof log === "function") log(entry);

      if (state === "emitting") state = "active";
      return true;
    } catch {
      disable();
      return false;
    }
  };
  return {
    emit,
    disable,
    get state() { return state; },
    get disabled() { return state === "disabled"; }
  };
}

export function createStdioShutdownController({
  processLike = process,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  readPpid = () => processLike.ppid,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  terminate = (code) => processLike.exit(code),
  disableDiagnostics = () => {},
  closeTimeoutMs = 2000
} = {}) {
  if (!processLike || typeof processLike.on !== "function") {
    throw new Error("createStdioShutdownController requires a process-like object");
  }
  const on = (stream, event, handler) => {
    if (!stream || typeof stream.on !== "function") {
      throw new Error(`shutdown controller requires a ${event} stream listener`);
    }
    stream.on(event, handler);
  };
  let phase = "running";
  let outcome = 0;
  let eofObserved = false;
  let serverCloseHook = null;
  let cleanupPromise = null;
  let cleanupCompletionPromise = null;
  let cleanupHook = null;
  let parentInterval = null;
  let cleanupTimer = null;
  let terminalActionTaken = false;
  const initialPpid = readPpid();

  const terminateOnce = (code) => {
    if (terminalActionTaken) return;
    terminalActionTaken = true;
    if (cleanupTimer !== null) clearTimeoutFn(cleanupTimer);
    if (parentInterval !== null) {
      clearIntervalFn(parentInterval);
      parentInterval = null;
    }
    phase = "terminated";
    terminate(code);
  };
  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;

    cleanupHook = serverCloseHook;
    cleanupPromise = Promise.resolve().then(() => (
      typeof cleanupHook === "function" ? cleanupHook() : undefined
    ));
    return cleanupPromise;
  };
  const requestShutdown = (requestedOutcome = 1) => {
    if (phase === "terminated") return cleanupPromise || Promise.resolve();
    if (requestedOutcome === 1) outcome = 1;
    if (phase === "running") phase = "closing";
    const currentCleanup = cleanup();
    if (cleanupTimer === null) cleanupTimer = setTimeoutFn(() => terminateOnce(1), closeTimeoutMs);
    if (cleanupCompletionPromise === null) {
      cleanupCompletionPromise = currentCleanup.then(
        () => terminateOnce(outcome),
        () => terminateOnce(1)
      );
    }
    return currentCleanup;
  };
  on(stdin, "end", () => { eofObserved = true; requestShutdown(0); });
  on(stdin, "close", () => requestShutdown(eofObserved ? 0 : 1));
  on(stdin, "error", () => requestShutdown(1));
  on(stdout, "close", () => requestShutdown(1));
  on(stdout, "error", () => requestShutdown(1));
  on(stderr, "close", disableDiagnostics);
  on(stderr, "error", disableDiagnostics);

  const initialPpidValid = Number.isInteger(initialPpid) && initialPpid > 1;
  if (!initialPpidValid) {
    requestShutdown(1);
  } else {
    parentInterval = setIntervalFn(() => {
      if (readPpid() !== initialPpid) requestShutdown(1);
    }, 250);
    if (parentInterval && typeof parentInterval.unref === "function") parentInterval.unref();
  }
  return {
    requestShutdown,
    setServerCloseHook(hook) {
      if (typeof hook !== "function") throw new TypeError("server close hook must be a function");
      serverCloseHook = hook;
    },
    cleanup,
    get phase() { return phase; },
    get outcome() { return outcome; },
    get parentInterval() { return parentInterval; }
  };
}

