import { validateConduitInput } from "./stdio-mcp-conduit-input.mjs";
import { readLauncherConduitTerminationEvidence } from "./launch-isolation-spawn.mjs";
import { buildServerEnv, resolveLauncherHostSessionProfile, assertLauncherHostSessionProfile } from "./launcher-host-session-profile.mjs";

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fsyncSync,
  openSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeSync
} from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  MANAGED_ASSIGNMENT_READ_ARTIFACT_FILENAME_PREFIX,
  MANAGED_ASSIGNMENT_READ_ARTIFACT_MAX_BYTES,
  MANAGED_ASSIGNMENT_READ_REFUSAL_CODES,
  PRIVATE_IMMUTABLE_ARTIFACT_MAX_BYTES,
  PrivateImmutableArtifactPublicationError,
  publishPrivateImmutableArtifact
} from "./managed-assignment-read-artifact.mjs";
import {
  FROZEN_REVIEW_CONTRACT_ARTIFACT_FILENAME_PREFIX
} from "@agent-chassis/wiki-core/src/lib/frozen-review-contract-query.mjs";

import {
  STDIO_MCP_CONDUIT_ALLOWED_FAMILIES,
  STDIO_MCP_CONDUIT_ALLOWED_ROLES,
  STDIO_MCP_CONDUIT_ERROR_CODES,
  STDIO_MCP_LIFECYCLE_PHASES,
  STDIO_MCP_READY_FD,
  StdioMcpConduitError,
  failStdioMcpConduit as fail,
  normalizeStdioMcpConduitRole as normalizedRole,
  registerProcessLocalStdioMcpConduit
} from "./stdio-mcp-conduit-contract.mjs";

import {
  createStdioMcpConduitLocalChannel,
  deriveStdioMcpConduitLocalBacking,
  projectStdioMcpChannelLocalBacking
} from "./stdio-mcp-conduit-channel.mjs";
import {
  createStdioMcpConnectionAdmissionForResourceScope
} from "./stdio-mcp-connection-admission.mjs";
import {
  LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION,
  WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT_ENV_VAR,
  assertTrustedStdioMcpConduitAuthority,
  authenticateLauncherAgentSessionContract,
  canonicalSerializeLauncherAgentSessionContract,
  isTrustedStdioMcpConduitAuthority,
  mintLauncherAgentSessionContract,
  bindLauncherAgentSessionExecutionBackend,
  resolveLauncherAgentSessionContract,
  resolveLauncherAgentSessionContractFacts,
  resolveTrustedStdioMcpFrozenReviewContractSnapshot,
  resolveTrustedStdioMcpWorkerAssignmentSnapshot
} from "./stdio-mcp-conduit-authority.mjs";

import {
  compareToolSurfaces,
  createChildTerminationLatch,
  observeConduitLifecycle
} from "./stdio-mcp-conduit-lifecycle.mjs";
import {
  serializeLauncherNoCceAuthorityDeclaration
} from "../../../wiki-mcp/src/lib/launcher-no-cce-authority.mjs";

export const STDIO_MCP_COMPLETION_CREDENTIAL_SCHEMA_VERSION =
  LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION;

function spawnMeasuredServerGeneration(spawnServer, ...spawnArgs) {
  const readinessMeasurements = {
    spawnStartedAt: null,
    spawn_to_registration_elapsed_ms: null,
    authenticated_client_payload_bytes_before_close: 0
  };
  readinessMeasurements.spawnStartedAt = performance.now();
  const child = spawnServer(...spawnArgs);
  return { child, readinessMeasurements };
}

function openLauncherNoCceAuthorityDescriptor(directory, declaration) {
  if (declaration === null) return null;
  const declarationPath = path.join(
    directory,
    `.launcher-no-cce-authority-${randomBytes(16).toString("hex")}`
  );
  let writeFd = null;
  let readFd = null;
  try {
    writeFd = openSync(
      declarationPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY |
        fsConstants.O_NOFOLLOW,
      0o600
    );
    writeSync(writeFd, declaration);
    fsyncSync(writeFd);
    closeSync(writeFd);
    writeFd = null;
    readFd = openSync(declarationPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    unlinkSync(declarationPath);
    return readFd;
  } catch (error) {
    if (writeFd !== null) {
      try { closeSync(writeFd); } catch {   }
    }
    if (readFd !== null) {
      try { closeSync(readFd); } catch {   }
    }
    try { unlinkSync(declarationPath); } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") {

      }
    }
    throw error;
  }
}

const TRUSTED_DEPENDENCY_FIELDS = Object.freeze(new Set([
  "serverPath", "spawnServer", "makePrivateDirectory",
  "resolveRoleToolNames", "bootstrapNodeEngineEnv", "execPath",
  "serverStartupTimeoutMs", "clientReadinessTimeoutMs"
]));

export async function createDormantStdioMcpLocalChannel({
  scope, directory, identifier, family, role, lifecycleCapability,
  createGeneration
}) {
  if (!scope || typeof scope.adopt !== "function" ||
      typeof directory !== "string" || typeof identifier !== "string" ||
      typeof family !== "string" || typeof role !== "string" ||
      typeof createGeneration !== "function") {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "dormant local stdio MCP channel requires launcher-owned construction inputs");
  }
  const backing = deriveStdioMcpConduitLocalBacking(directory);
  const { endpointSource } = projectStdioMcpChannelLocalBacking(backing);
  const siblingRoot = path.dirname(endpointSource);
  let ownsSiblingRoot = false;
  try {
    statSync(siblingRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    ownsSiblingRoot = true;
  }
  if (ownsSiblingRoot) {
    scope.adopt("local-sibling-directory", () => {
      try { rmdirSync(siblingRoot); } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    });
  }
  const channel = createStdioMcpConduitLocalChannel({
    identifier, family, role, backing, lifecycleCapability
  });
  const admission = createStdioMcpConnectionAdmissionForResourceScope({
    backing, createGeneration
  });
  scope.adopt("local-admission", async () => {
    const failure = await admission.settle();
    if (failure !== null) throw failure;
  });
  try {
    if (admission.open() !== true) {
      throw new Error("stdio MCP local admission refused to open");
    }
    if (!admission.server.listening) {
      await new Promise((resolve, reject) => {
        const onListening = () => { cleanup(); resolve(); };
        const onError = (error) => { cleanup(); reject(error); };
        const cleanup = () => {
          admission.server.off("listening", onListening);
          admission.server.off("error", onError);
        };
        admission.server.once("listening", onListening);
        admission.server.once("error", onError);
      });
    }
  } catch (error) {
    await admission.settle();
    throw error;
  }
  return Object.freeze({ channel, admission });
}

function safeClose(fd) {
  if (!Number.isInteger(fd) || fd < 0) return;
  try { closeSync(fd); } catch (error) {
    if (error?.code !== "EBADF") throw error;
  }
}

function lifecycleRelay() {
  const relay = {};
  let settled = false;
  relay.promise = new Promise((resolve, reject) => {
    relay.resolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    relay.reject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
  });
  Object.defineProperty(relay, "settled", { get: () => settled });
  return relay;
}

function describeFailure(error) {
  return {
    code: error?.code ?? null,
    message: error?.message ?? String(error)
  };
}

export const STDIO_MCP_LAUNCHER_CAUSE_SCHEMA_VERSION =
  "launcher-stdio-mcp-conduit-cause.v1";

export const STDIO_MCP_LAUNCHER_CAUSE_BOUNDARIES = Object.freeze({
  CONDUIT_LIFECYCLE: "conduit_lifecycle",
  PRE_AUTHENTICATION: "pre_authentication",
  NONE: "none"
});

function boundedCauseCode(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_.:#-]+$/u.test(value)
    ? value.slice(0, 64)
    : null;
}

class ConduitResourceScope {
  #entries = [];
  #disposed = false;
  #failures = [];
  #retained = [];

  adopt(label, dispose) {
    this.#entries.push({ label, dispose });
    return label;
  }

  acquire(label, acquireFn, disposeFn) {
    const value = acquireFn();
    this.adopt(label, () => disposeFn(value));
    return value;
  }

  openFd(label, acquireFn) {
    return this.acquire(label, acquireFn, (fd) => safeClose(fd));
  }

  release(label) {
    const index = this.#entries.findIndex((entry) => entry.label === label);
    if (index < 0) return true;
    const entry = this.#entries[index];
    try {
      entry.dispose();
    } catch (error) {
      this.#retained.push({ resource: entry.label, ...describeFailure(error) });
      return false;
    }
    this.#entries.splice(index, 1);
    return true;
  }

  get disposed() {
    return this.#disposed;
  }

  get retainedReleaseFailures() {
    return [...this.#retained];
  }

  async dispose() {
    if (this.#disposed) return this.#failures;
    this.#disposed = true;
    while (this.#entries.length > 0) {
      const entry = this.#entries.pop();
      try {
        await entry.dispose();
      } catch (error) {
        this.#failures.push({ resource: entry.label, ...describeFailure(error) });
      }
    }
    return this.#failures;
  }
}

function assertPrivateDirectory(directory) {
  const stats = statSync(directory);
  const expectedUid = typeof process.getuid === "function" ? process.getuid() : stats.uid;
  if (!stats.isDirectory() || stats.uid !== expectedUid || (stats.mode & 0o777) !== 0o700) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.DIRECTORY_INVALID,
      "stdio MCP conduit directory must be launcher-owned mode 0700",
      { directory, uid: stats.uid, mode: stats.mode & 0o777 });
  }
}

function publishFrozenReviewContractArtifact({ scope, directory, snapshot }) {
  if (snapshot === null) return null;
  try {
    return publishPrivateImmutableArtifact({
      scope,
      directory,
      prefix: FROZEN_REVIEW_CONTRACT_ARTIFACT_FILENAME_PREFIX,
      resourceLabel: "frozen-review-contract-artifact",
      maxBytes: PRIVATE_IMMUTABLE_ARTIFACT_MAX_BYTES,
      snapshot
    });
  } catch (error) {
    if (!(error instanceof PrivateImmutableArtifactPublicationError)) throw error;
    if (error.cause === null) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
        "trusted frozen review contract snapshot failed publication or its immutable identity check",
        error.cleanupFailures.length > 0 ? { publication_cleanup_failures: error.cleanupFailures } : null);
    }
    if (error.cleanupFailures.length > 0) {
      Object.defineProperty(error.cause, "frozenReviewArtifactCleanupFailures", {
        value: error.cleanupFailures,
        enumerable: false
      });
    }
    throw error.cause;
  }
}

function publishManagedWorkerAssignmentArtifact({ scope, directory, snapshot }) {
  if (snapshot === null) return null;
  try {
    return publishPrivateImmutableArtifact({
      scope,
      directory,
      prefix: MANAGED_ASSIGNMENT_READ_ARTIFACT_FILENAME_PREFIX,
      resourceLabel: "managed-assignment-read-artifact",
      maxBytes: MANAGED_ASSIGNMENT_READ_ARTIFACT_MAX_BYTES,
      snapshot
    });
  } catch (error) {
    fail(MANAGED_ASSIGNMENT_READ_REFUSAL_CODES.PUBLICATION_FAILED,
      "managed worker assignment could not be published before MCP readiness", {
        assigned_unit: snapshot.assigned_unit,
        effects: "no client spawned; an artifact this publication created was removed unless publication_cleanup_failures reports otherwise",
        recovery_actor: "coordinator_or_operator",
        recovery_action: "correct the reported publication condition and dispatch a fresh attempt",
        ...(error?.cleanupFailures?.length > 0 ? { publication_cleanup_failures: error.cleanupFailures } : {})
      });
  }
}

export function mintStdioMcpCompletionCredential(input = {}) {
  if (!input.authority) return null;
  return mintLauncherAgentSessionContract(input);
}

export function authenticateStdioMcpCompletionCredential({
  credential,
  contract = credential,
  expectedFacts,
  consumerVersion
} = {}) {
  return authenticateLauncherAgentSessionContract({ contract, expectedFacts, consumerVersion, preparation: true });
}

async function reapChild(child, signal = "SIGTERM", timeoutMs = 2_000, termination = null) {
  if (!child) return;
  if (termination?.terminal !== null && termination?.terminal !== undefined) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = termination === null
    ? new Promise((resolve) => child.once("exit", resolve))
    : termination.settlement;

  termination?.markCleanupInitiated();

  try { child.kill(signal); } catch {   }
  let killTimer = null;
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise((resolve) => { killTimer = setTimeout(() => resolve(true), timeoutMs); })
  ]);
  if (killTimer !== null) clearTimeout(killTimer);
  if (!timedOut) return;
  try { child.kill("SIGKILL"); } catch {   }
  let hardTimer = null;
  try {
    await Promise.race([
      exited,
      new Promise((_, reject) => {
        hardTimer = setTimeout(() => reject(new StdioMcpConduitError(
          STDIO_MCP_CONDUIT_ERROR_CODES.REAP_FAILED,
          "host wiki-MCP server could not be reaped"
        )), timeoutMs);
      })
    ]);
  } finally {
    if (hardTimer !== null) clearTimeout(hardTimer);
  }
}

function validateTrustedDependencies(trusted) {
  if (!trusted || typeof trusted !== "object" || Array.isArray(trusted)) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "stdio MCP conduit requires a launcher-resolved trusted dependency set");
  }
  const extra = Object.keys(trusted).filter((key) => !TRUSTED_DEPENDENCY_FIELDS.has(key));
  if (extra.length > 0) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "stdio MCP conduit trusted dependencies contain an unknown field", { extra });
  }
  for (const name of ["spawnServer", "makePrivateDirectory",
    "resolveRoleToolNames", "bootstrapNodeEngineEnv"]) {
    if (typeof trusted[name] !== "function") {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
        "stdio MCP conduit trusted dependency is missing", { dependency: name });
    }
  }
  for (const name of ["serverStartupTimeoutMs", "clientReadinessTimeoutMs"]) {
    if (!Number.isInteger(trusted[name]) || trusted[name] <= 0) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
        "stdio MCP conduit trusted timeout is invalid", { dependency: name });
    }
  }
  return Object.freeze({ ...trusted });
}

export async function createStdioMcpConduitWithTrustedDependencies(input, trustedDependencies) {
  const { family, role, authority, sessionContract } = validateConduitInput(input);
  const trusted = validateTrustedDependencies(trustedDependencies);
  const runId = `stdio-mcp-${randomBytes(12).toString("hex")}`;
  const scope = new ConduitResourceScope();
  let conduitBinding = null;
  let namespaceReady = false;
  let readinessFailure = null;
  let cleanupFailure = null;

  let lifecycle = null;
  let generationServer = null;
  let generationStderr = () => "";
  let readinessEvent = null;

  let unboundLifecycleFailure = null;

  let generationStartFailure = null;
  let clientReadinessRequested = false;
  let clientReadinessStartedAt = null;
  let initialClientReadinessSucceeded = false;
  const generationRecords = [];
  let clientReadinessTimer = null;
  const delegatedLifecycles = new WeakSet();
  const generationCandidates = new Set();
  const clientReadyRelay = lifecycleRelay();
  const failureSettlementRelay = lifecycleRelay();
  const serverExitRelay = lifecycleRelay();

  clientReadyRelay.promise.catch(() => {});

  const clearClientReadinessTimer = () => {
    if (clientReadinessTimer !== null) {
      clearTimeout(clientReadinessTimer);
      clientReadinessTimer = null;
    }
  };

  const recordFacadeFailure = (error) => {
    failureSettlementRelay.resolve(error);
    if (clientReadyRelay.settled) return;
    readinessFailure ??= error;
    clearClientReadinessTimer();
    clientReadyRelay.reject(error);
  };

  const settleUnboundLifecycleProjections = () => {
    if (lifecycle !== null || generationStartFailure !== null) return;
    const unbound = new StdioMcpConduitError(
      STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_FAILED,
      "stdio MCP conduit was torn down before a confined client authenticated");

    unboundLifecycleFailure = unbound;
    readinessFailure ??= unbound;
    failureSettlementRelay.resolve(unbound);
    serverExitRelay.resolve(Object.freeze({
      code: null, signal: null, expected: false, spawnFailed: false
    }));
    clientReadyRelay.reject(unbound);
  };

  const settleUnfinishedBoundReadiness = () => {
    if (lifecycle === null || clientReadyRelay.settled || lifecycle.isClientReady()) return;
    const phase = lifecycle.currentPhase?.() ?? null;
    recordFacadeFailure(lifecycle.currentFailure() ?? new StdioMcpConduitError(
      STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_FAILED,
      "stdio MCP conduit was torn down before the confined client completed readiness",
      { reason: "cleanup_before_client_readiness", lifecycle_phase: phase, phase }));
  };

  let cleanupSettlement = null;
  let deregisterProcessLocal = () => {};
  const settleCleanup = () => {
    if (cleanupSettlement === null) {
      cleanupSettlement = (async () => {
        try {
          const failures = await scope.dispose();
          if (failures.length > 0 && cleanupFailure === null) {
            cleanupFailure = new StdioMcpConduitError(
              STDIO_MCP_CONDUIT_ERROR_CODES.CLEANUP_FAILED,
              "stdio MCP conduit cleanup failed", { failures });
          }
          return cleanupFailure;
        } finally {
          clearClientReadinessTimer();
          settleUnboundLifecycleProjections();
          settleUnfinishedBoundReadiness();

          deregisterProcessLocal();
        }
      })();
    }
    return cleanupSettlement;
  };

  const cleanup = async () => {
    const failure = await settleCleanup();
    if (failure !== null) throw failure;
  };
  const cancel = async (reason = "launcher cancellation") => {

    const failure = await settleCleanup();

    throw new StdioMcpConduitError(
      STDIO_MCP_CONDUIT_ERROR_CODES.CANCELLED,
      "stdio MCP conduit lifecycle was cancelled",
      {
        reason: String(reason).slice(0, 256),
        ...(failure === null ? {} : {
          cleanup_failure: {
            code: failure.code ?? null,
            message: failure.message ?? String(failure),
            detail: failure.detail ?? null
          }
        })
      }
    );
  };

  let markClientProcessTerminal = () => {};
  const applyClientReadiness = (candidate) => {
    if (!clientReadinessRequested || candidate === null ||
        delegatedLifecycles.has(candidate.lifecycle)) return;
    delegatedLifecycles.add(candidate.lifecycle);
    candidate.lifecycle.beginClientReadiness();
  };
  const beginClientReadiness = () => {
    if (clientReadinessRequested) return;
    clientReadinessRequested = true;
    clientReadinessStartedAt = Date.now();
    clientReadinessTimer = setTimeout(() => recordFacadeFailure(
      new StdioMcpConduitError(
        STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_TIMEOUT,
        "confined client did not complete MCP initialize and tools/list within the launcher budget",
        {
          timeout_ms: trusted.clientReadinessTimeoutMs,
          lifecycle_phase: lifecycle?.currentPhase?.() ??
            STDIO_MCP_LIFECYCLE_PHASES.AWAITING_CLIENT_AUTHENTICATION,
          phase: lifecycle?.currentPhase?.() ??
            STDIO_MCP_LIFECYCLE_PHASES.AWAITING_CLIENT_AUTHENTICATION
        }
      )), trusted.clientReadinessTimeoutMs);
    for (const candidate of generationCandidates) applyClientReadiness(candidate);
  };
  const activateCandidate = (candidate) => {
    if (candidate === null || clientReadyRelay.settled) return;
    lifecycle = candidate.lifecycle;
    generationServer = candidate.child;
    generationStderr = candidate.getStderr;
    readinessEvent = candidate.readinessEvent;
    markClientProcessTerminal = candidate.lifecycle.markClientProcessTerminal;
    applyClientReadiness(candidate);
  };
  const promoteCandidate = () => {
    const next = generationCandidates.values().next().value ?? null;
    if (next !== null) activateCandidate(next);
  };

  const assignmentChangeRelay = lifecycleRelay();
  const bindLifecycleGeneration = (generationLifecycle, child, getStderr) => {
    const candidate = {
      lifecycle: generationLifecycle,
      child,
      getStderr,
      readinessEvent: null
    };
    generationCandidates.add(candidate);

    generationLifecycle.assignmentChangeRequested.then(event => assignmentChangeRelay.resolve(event));
    if (lifecycle === null) activateCandidate(candidate);
    generationLifecycle.serverReady.then((event) => {
      candidate.readinessEvent = event;
      if (lifecycle === generationLifecycle) readinessEvent = event;
    }, () => {});
    generationLifecycle.clientReady.then((ready) => {
      if (clientReadyRelay.settled) return;
      if (lifecycle !== generationLifecycle) activateCandidate(candidate);
      initialClientReadinessSucceeded = true;
      clearClientReadinessTimer();
      clientReadyRelay.resolve(ready);
    }, (error) => {
      if (lifecycle === generationLifecycle) recordFacadeFailure(error);
    });
    generationLifecycle.failureSettlement.then((error) => {
      generationCandidates.delete(candidate);
      if (lifecycle === generationLifecycle) recordFacadeFailure(error);
    }, () => {});
    generationLifecycle.serverExit.then((exit) => {
      if (lifecycle === generationLifecycle) serverExitRelay.resolve(exit);
    }, () => {});
    generationLifecycle.discoveryProbeClosed.then(() => {
      generationCandidates.delete(candidate);
      if (lifecycle !== generationLifecycle || clientReadyRelay.settled) return;
      lifecycle = null;
      generationServer = null;
      generationStderr = () => "";
      readinessEvent = null;
      markClientProcessTerminal = () => {};
      promoteCandidate();
    }, () => {});
    applyClientReadiness(candidate);
  };

  deregisterProcessLocal = registerProcessLocalStdioMcpConduit(settleCleanup);

  try {

    const directory = scope.acquire("conduit-directory",
      () => trusted.makePrivateDirectory(),
      (dir) => { try { rmdirSync(dir); } catch (error) { if (error?.code !== "ENOENT") throw error; } });
    chmodSync(directory, 0o700);
    assertPrivateDirectory(directory);

    const frozenSnapshot =
      resolveTrustedStdioMcpFrozenReviewContractSnapshot(authority);
    if (authority.frozenReviewContract !== null && frozenSnapshot === null) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
        "managed reviewer conduit authority has no trusted frozen snapshot");
    }
    const frozenReviewContractArtifactPath = publishFrozenReviewContractArtifact({
      scope,
      directory,
      snapshot: frozenSnapshot
    });

    const managedAssignmentArtifactPath = publishManagedWorkerAssignmentArtifact({
      scope,
      directory,
      snapshot: resolveTrustedStdioMcpWorkerAssignmentSnapshot(authority)
    });

    const serverPath = trusted.serverPath;
    if (typeof serverPath !== "string" || !path.isAbsolute(serverPath)) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_UNAVAILABLE,
        "launcher could not resolve the host wiki-MCP server entrypoint");
    }
    const reviewerCredential = authority.frozenReviewContract === null
      ? null
      : {
          launchRef: authority.crossRunIdentity.launch_ref,
          runId: authority.crossRunIdentity.run_id,
          retryId: authority.crossRunIdentity.retry_id
        };
    const serverEnv = buildServerEnv(input, role, {
      frozenReviewContractArtifactPath,
      managedAssignmentArtifactPath,
      reviewerCredential
    });

    serverEnv.WIKI_MCP_AGENT_SESSION_CONTRACT =
      canonicalSerializeLauncherAgentSessionContract(sessionContract).toString("utf8");

    serverEnv[WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT_ENV_VAR] =
      canonicalSerializeLauncherAgentSessionContract(sessionContract).toString("utf8");

    const hostProfile = input.hostSessionProfile === undefined
      ? resolveLauncherHostSessionProfile({ workspaceDir: input.workspaceDir, role })
      : assertLauncherHostSessionProfile(input.hostSessionProfile);
    Object.assign(serverEnv, hostProfile.configurationEnv);
    trusted.bootstrapNodeEngineEnv(serverEnv, input.workspaceDir);
    const expectedRegisteredTier = hostProfile.registeredTier;
    const expectedToolNames = await trusted.resolveRoleToolNames(role, serverEnv);

    const lifecycleBindingState = Object.freeze({
      app: family,
      assignedUnit: input.assignedUnit,
      workspaceDir: path.resolve(input.workspaceDir),
      get sessionContract() { return resolveLauncherAgentSessionContract(authority); },
      bindExecutionBackend: observation => bindLauncherAgentSessionExecutionBackend(authority, observation),
      directory,
      authority,
      toolNames: expectedToolNames,
      assignmentChangeRequested: assignmentChangeRelay.promise,
      get launcherTermination() { return readLauncherConduitTerminationEvidence(conduitBinding); },
      clientReady: clientReadyRelay.promise,
      failureSettlement: failureSettlementRelay.promise,
      serverExit: serverExitRelay.promise,
      beginClientReadiness,
      lifecycleOwner: Object.freeze({ kind: "launcher", run_id: runId }),
      markNamespaceReady: () => { namespaceReady = true; },
      cleanup, cancel, settleCleanup,
      get server() { return generationServer; },
      get generationFailures() {
        return generationRecords.filter((record) =>
          record.lifecycle?.currentFailure() || record.startFailure).map((record) => Object.freeze({
          generation: record.generation,
          failure: record.lifecycle?.currentFailure() ?? record.startFailure,
          streamFailure: record.lifecycle?.firstStreamFailure() ?? null,
          activeAtFailure: record.activeAtFailure
        }));
      },
      get readiness() { return readinessEvent; },
      get serverStderr() { return generationStderr(); },
      get namespaceReady() { return namespaceReady; },
      get cleaned() { return scope.disposed; },

      get launcherCause() {
        const retained = lifecycle?.currentFailure() ?? readinessFailure ?? null;
        const originating = retained !== null && retained !== unboundLifecycleFailure;
        return Object.freeze({
          schema_version: STDIO_MCP_LAUNCHER_CAUSE_SCHEMA_VERSION,
          cause_available: originating,
          cause_code: originating ? boundedCauseCode(retained.code) : null,
          boundary: originating
            ? STDIO_MCP_LAUNCHER_CAUSE_BOUNDARIES.CONDUIT_LIFECYCLE
            : unboundLifecycleFailure !== null
              ? STDIO_MCP_LAUNCHER_CAUSE_BOUNDARIES.PRE_AUTHENTICATION
              : STDIO_MCP_LAUNCHER_CAUSE_BOUNDARIES.NONE
        });
      },
      get readinessFailure() { return readinessFailure ?? lifecycle?.currentFailure() ?? null; },
      get failure() { return lifecycle?.currentFailure() ?? readinessFailure ?? null; },
      get clientReadyCompleted() { return lifecycle?.isClientReady() === true; },
      get cleanupFailure() { return cleanupFailure; },
      get retainedReleaseFailures() { return scope.retainedReleaseFailures; }
    });
    const lifecycleCapability = Object.freeze({
      get bindingState() { return lifecycleBindingState; },
      markClientProcessTerminal(...args) {
        return markClientProcessTerminal(...args);
      }
    });

    const recordGenerationStartFailure = (record, phase, thrown) => {
      const error = new StdioMcpConduitError(
        STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_START_FAILED,
        "host wiki-MCP server generation failed to start",
        { phase, code: boundedCauseCode(thrown?.code) });
      Object.defineProperty(error, "cause",
        { value: thrown, writable: true, enumerable: false, configurable: true });
      record.startFailure = error;
      record.activeAtFailure = lifecycle === null && !clientReadyRelay.settled;
      if (lifecycle === null && generationStartFailure === null && !clientReadyRelay.settled) {
        generationStartFailure = error;
        recordFacadeFailure(error);
        serverExitRelay.resolve(Object.freeze({
          code: null, signal: null, expected: false, spawnFailed: true
        }));
      }
      return error;
    };
    let generationSequence = 0;
    const createGeneration = ({ initialBytes }) => {
      generationSequence += 1;
      const record = { generation: generationSequence, lifecycle: null,
        startFailure: null, activeAtFailure: null };
      generationRecords.push(record);
      const generationEnv = { ...serverEnv };
      let phase = "generation_bootstrap";
      let termination;
      let spawned;
      try {
        const finalContract = authenticateLauncherAgentSessionContract({
          contract: resolveLauncherAgentSessionContract(authority),
          expectedFacts: resolveLauncherAgentSessionContractFacts(authority)
        });
        const contractBytes = canonicalSerializeLauncherAgentSessionContract(finalContract).toString("utf8");
        generationEnv.WIKI_MCP_AGENT_SESSION_CONTRACT = contractBytes;
        generationEnv[WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT_ENV_VAR] = contractBytes;

        const launcherNoCceAuthorityDeclaration =
          serializeLauncherNoCceAuthorityDeclaration(
            trusted.bootstrapNodeEngineEnv(generationEnv, input.workspaceDir)
          );
        termination = createChildTerminationLatch();
        phase = "generation_authority_descriptor";

        const authorityLabel = `generation-authority-descriptor-${generationSequence}`;
        const authorityFd = scope.acquire(authorityLabel,
          () => openLauncherNoCceAuthorityDescriptor(directory, launcherNoCceAuthorityDeclaration),
          (fd) => { if (fd !== null) closeSync(fd); });
        phase = "generation_spawn";
        try {
          spawned = spawnMeasuredServerGeneration(
            trusted.spawnServer, trusted.execPath, [serverPath], {
            cwd: input.workspaceDir, env: generationEnv,
            stdio: ["pipe", "pipe", "pipe", "pipe",
              authorityFd === null ? "ignore" : authorityFd],
            detached: false
            });
        } finally {
          scope.release(authorityLabel);
        }
      } catch (thrown) {
        throw recordGenerationStartFailure(record, phase, thrown);
      }
      const { child, readinessMeasurements } = spawned;
      let stderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => { stderr += chunk; });
      const generationLifecycle = observeConduitLifecycle({
        child, generation: generationSequence, serverStartupTimeoutMs: trusted.serverStartupTimeoutMs,
        clientReadinessTimeoutMs: initialClientReadinessSucceeded || clientReadinessStartedAt === null
          ? trusted.clientReadinessTimeoutMs
          : Math.max(1, trusted.clientReadinessTimeoutMs -
            (Date.now() - clientReadinessStartedAt)),
        expectedToolNames, expectedRegisteredTier, connectionIdentity: `${runId}:${generationSequence}`, role, getStderr: () => stderr, termination,
        readinessMeasurements,
        assignmentChangeBinding: role === "worker" && authority.crossRunIdentity !== null
          ? { assigned_unit: input.assignedUnit, ...authority.crossRunIdentity } : null
      });
      record.lifecycle = generationLifecycle;
      generationLifecycle.failureSettlement.then(() => {
        record.activeAtFailure = lifecycle === generationLifecycle;
      });
      bindLifecycleGeneration(generationLifecycle, child, () => stderr);
      return {
        input: child.stdin, output: child.stdout, ready: generationLifecycle.serverReady,
        close: () => reapChild(child, "SIGTERM", 2_000, termination),
        lifecycle: generationLifecycle, initialBytes, readinessMeasurements
      };
    };
    const { channel } = await createDormantStdioMcpLocalChannel({
      scope, directory, identifier: runId, family, role,
      lifecycleCapability, createGeneration
    });
    conduitBinding = channel;
    return channel;
  } catch (error) {

    const failure = await settleCleanup();
    const failures = failure?.detail?.failures ?? [];
    if (failures.length > 0) {
      if (error instanceof StdioMcpConduitError) {
        error.detail = { ...(error.detail ?? {}), cleanup_failures: failures };
      } else if (error !== null && typeof error === "object") {
        try {
          Object.defineProperty(error, "stdioMcpConduitCleanupFailures", {
            value: Object.freeze([...failures]),
            enumerable: false,
            writable: false,
            configurable: true
          });
        } catch {

        }
      }
    }
    throw error;
  }
}

export const __testing = Object.freeze({
  ConduitResourceScope,
  buildServerEnv,
  compareToolSurfaces,
  createChildTerminationLatch,
  observeConduitLifecycle,
  publishFrozenReviewContractArtifact,
  publishManagedWorkerAssignmentArtifact,
  reapChild,
  spawnMeasuredServerGeneration
});
