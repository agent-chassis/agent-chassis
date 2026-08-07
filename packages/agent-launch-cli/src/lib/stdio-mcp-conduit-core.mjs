

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  rmdirSync,
  statSync
} from "node:fs";
import path from "node:path";

import {
  STDIO_MCP_CONDUIT_ALLOWED_FAMILIES,
  STDIO_MCP_CONDUIT_ALLOWED_ROLES,
  STDIO_MCP_CONDUIT_ERROR_CODES,
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
  assertTrustedStdioMcpConduitAuthority
} from "./stdio-mcp-conduit-authority.mjs";
import {
  compareToolSurfaces,
  createChildTerminationLatch,
  observeConduitLifecycle
} from "./stdio-mcp-conduit-lifecycle.mjs";

const INPUT_FIELDS = Object.freeze(new Set([
  "family", "role", "assignedUnit", "workspaceDir", "workspaceAlias",
  "dispatchWorktreeRoot", "responseStateDir", "commitTuple", "authority"
]));

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
  scope.adopt("local-admission", () => admission.settle());
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
  relay.promise = new Promise((resolve, reject) => {
    relay.resolve = resolve;
    relay.reject = reject;
  });
  return relay;
}

function describeFailure(error) {
  return {
    code: error?.code ?? null,
    message: error?.message ?? String(error)
  };
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

function buildServerEnv(input, role) {
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "",
    ...(process.env.USER ? { USER: process.env.USER } : {}),
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
    ...(process.env.LC_ALL ? { LC_ALL: process.env.LC_ALL } : {}),
    ...(process.env.TZ ? { TZ: process.env.TZ } : {}),
    WIKI_MCP_TOOL_PROFILE: role,
    WIKI_MCP_ASSIGNED_UNIT: input.assignedUnit,
    WIKI_MCP_WORKSPACE_DIR: input.workspaceDir,
    WIKI_MCP_LAUNCHER_READY_FD: String(STDIO_MCP_READY_FD)
  };
  if (typeof input.workspaceAlias === "string" && input.workspaceAlias.length > 0) {
    env.WIKI_MCP_WORKSPACE_ALIAS = input.workspaceAlias;
  }
  if (typeof input.dispatchWorktreeRoot === "string" && input.dispatchWorktreeRoot.length > 0) {
    env.WIKI_MCP_DISPATCH_WORKTREE_ROOT = input.dispatchWorktreeRoot;
  }
  if (typeof input.responseStateDir === "string" && input.responseStateDir.length > 0) {
    env.WIKI_MCP_RESPONSE_STATE_DIR = input.responseStateDir;
  }
  if (input.commitTuple) {
    env.WIKI_MCP_COMMIT_LAUNCH_REF = input.commitTuple.launchRef;
    env.WIKI_MCP_COMMIT_RUN_ID = input.commitTuple.runId;
    env.WIKI_MCP_COMMIT_RETRY_ID = String(input.commitTuple.retryId);
  }
  return env;
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

function validateConduitInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID, "stdio MCP conduit input must be an object");
  }
  const extra = Object.keys(input).filter((key) => !INPUT_FIELDS.has(key));
  if (extra.length > 0) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "stdio MCP conduit input contains caller-controlled authority carriers", { extra });
  }
  const family = String(input.family ?? "");
  const role = normalizedRole(input.role);
  if (!STDIO_MCP_CONDUIT_ALLOWED_FAMILIES.has(family)) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.FAMILY_UNSUPPORTED,
      "confined wiki-MCP conduit supports only Claude and Codex", { family });
  }
  if (!STDIO_MCP_CONDUIT_ALLOWED_ROLES.has(role) || typeof input.assignedUnit !== "string" ||
      input.assignedUnit.length === 0 || typeof input.workspaceDir !== "string" ||
      !path.isAbsolute(input.workspaceDir)) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "stdio MCP conduit requires a launcher-derived role, assigned unit, and absolute workspace");
  }

  const authority = assertTrustedStdioMcpConduitAuthority(input.authority, {
    family,
    role,
    assignedUnit: input.assignedUnit,
    workspaceDir: input.workspaceDir
  });
  return { family, role, authority };
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
  const { family, role, authority } = validateConduitInput(input);
  const trusted = validateTrustedDependencies(trustedDependencies);
  const runId = `stdio-mcp-${randomBytes(12).toString("hex")}`;
  const scope = new ConduitResourceScope();
  let namespaceReady = false;
  let readinessFailure = null;
  let cleanupFailure = null;

  let lifecycle = null;
  let generationServer = null;
  let generationStderr = () => "";
  let readinessEvent = null;
  let clientReadinessRequested = false;
  let clientReadinessDelegated = false;
  const clientReadyRelay = lifecycleRelay();
  const failureSettlementRelay = lifecycleRelay();
  const serverExitRelay = lifecycleRelay();

  clientReadyRelay.promise.catch(() => {});

  const settleUnboundLifecycleProjections = () => {
    if (lifecycle !== null) return;
    const unbound = new StdioMcpConduitError(
      STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_FAILED,
      "stdio MCP conduit was torn down before a confined client authenticated");
    readinessFailure ??= unbound;
    failureSettlementRelay.resolve(unbound);
    serverExitRelay.resolve(Object.freeze({
      code: null, signal: null, expected: false, spawnFailed: false
    }));
    clientReadyRelay.reject(unbound);
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
          settleUnboundLifecycleProjections();

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
  const applyClientReadiness = () => {
    if (!clientReadinessRequested || clientReadinessDelegated || lifecycle === null) return;
    clientReadinessDelegated = true;
    lifecycle.beginClientReadiness();
  };
  const beginClientReadiness = () => {
    clientReadinessRequested = true;
    applyClientReadiness();
  };

  const bindLifecycleGeneration = (generationLifecycle, child, getStderr) => {
    lifecycle = generationLifecycle;
    generationServer = child;
    generationStderr = getStderr;
    markClientProcessTerminal = generationLifecycle.markClientProcessTerminal;
    generationLifecycle.serverReady.then(
      (event) => { readinessEvent = event; }, () => {});
    generationLifecycle.clientReady.then(
      (ready) => clientReadyRelay.resolve(ready),
      (error) => {

        readinessFailure ??= error;
        clientReadyRelay.reject(error);
      });
    generationLifecycle.failureSettlement.then(failureSettlementRelay.resolve, () => {});
    generationLifecycle.serverExit.then(serverExitRelay.resolve, () => {});
    applyClientReadiness();
  };

  deregisterProcessLocal = registerProcessLocalStdioMcpConduit(settleCleanup);

  try {

    const directory = scope.acquire("conduit-directory",
      () => trusted.makePrivateDirectory(),
      (dir) => { try { rmdirSync(dir); } catch (error) { if (error?.code !== "ENOENT") throw error; } });
    chmodSync(directory, 0o700);
    assertPrivateDirectory(directory);

    const serverPath = trusted.serverPath;
    if (typeof serverPath !== "string" || !path.isAbsolute(serverPath)) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_UNAVAILABLE,
        "launcher could not resolve the host wiki-MCP server entrypoint");
    }
    const serverEnv = buildServerEnv(input, role);
    trusted.bootstrapNodeEngineEnv(serverEnv, input.workspaceDir);
    const expectedToolNames = await trusted.resolveRoleToolNames(role, serverEnv);

    const lifecycleBindingState = Object.freeze({
      app: family,
      assignedUnit: input.assignedUnit,
      workspaceDir: path.resolve(input.workspaceDir),
      directory,
      authority,
      toolNames: expectedToolNames,
      clientReady: clientReadyRelay.promise,
      failureSettlement: failureSettlementRelay.promise,
      serverExit: serverExitRelay.promise,
      beginClientReadiness,
      lifecycleOwner: Object.freeze({ kind: "launcher", run_id: runId }),
      markNamespaceReady: () => { namespaceReady = true; },
      cleanup, cancel, settleCleanup,
      get server() { return generationServer; },
      get readiness() { return readinessEvent; },
      get serverStderr() { return generationStderr(); },
      get namespaceReady() { return namespaceReady; },
      get cleaned() { return scope.disposed; },
      get readinessFailure() { return readinessFailure ?? lifecycle?.currentFailure() ?? null; },
      get failure() { return lifecycle?.currentFailure() ?? null; },
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

    const createGeneration = ({ initialBytes }) => {
      const generationEnv = { ...serverEnv };
      const termination = createChildTerminationLatch();
      const child = trusted.spawnServer(trusted.execPath, [serverPath], {
        cwd: input.workspaceDir, env: generationEnv,
        stdio: ["pipe", "pipe", "pipe", "pipe"], detached: false
      });
      let stderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4096); });
      const generationLifecycle = observeConduitLifecycle({
        child, serverStartupTimeoutMs: trusted.serverStartupTimeoutMs,
        clientReadinessTimeoutMs: trusted.clientReadinessTimeoutMs,
        expectedToolNames, role, getStderr: () => stderr, termination
      });
      if (lifecycle === null) {
        bindLifecycleGeneration(generationLifecycle, child, () => stderr);
      } else {

        generationLifecycle.clientReady.catch(() => {});
      }
      return {
        input: child.stdin, output: child.stdout, ready: generationLifecycle.serverReady,
        close: () => reapChild(child, "SIGTERM", 2_000, termination),
        lifecycle: generationLifecycle, initialBytes
      };
    };
    const { channel } = await createDormantStdioMcpLocalChannel({
      scope, directory, identifier: runId, family, role,
      lifecycleCapability, createGeneration
    });
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
  compareToolSurfaces,
  createChildTerminationLatch,
  observeConduitLifecycle,
  reapChild
});
