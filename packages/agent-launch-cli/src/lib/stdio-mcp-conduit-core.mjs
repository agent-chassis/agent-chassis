

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync
} from "node:fs";
import path from "node:path";

import {
  STDIO_MCP_CLIENT_TO_SERVER_PATH,
  STDIO_MCP_CONDUIT_ALLOWED_FAMILIES,
  STDIO_MCP_CONDUIT_ALLOWED_ROLES,
  STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION,
  STDIO_MCP_CONDUIT_ERROR_CODES,
  STDIO_MCP_CONDUIT_INPUT_FD,
  STDIO_MCP_CONDUIT_OUTPUT_FD,
  STDIO_MCP_READY_FD,
  STDIO_MCP_RELAY_ARGS,
  STDIO_MCP_RELAY_COMMAND,
  STDIO_MCP_SERVER_TO_CLIENT_PATH,
  StdioMcpConduitError,
  failStdioMcpConduit as fail,
  normalizeStdioMcpConduitRole as normalizedRole,
  registerProcessLocalStdioMcpConduit,
  registerTrustedStdioMcpConduitBinding
} from "./stdio-mcp-conduit-contract.mjs";
import {
  assertTrustedStdioMcpConduitAuthority
} from "./stdio-mcp-conduit-authority.mjs";

const LINUX_O_PATH = 0o10000000;

const INPUT_FIELDS = Object.freeze(new Set([
  "family", "role", "assignedUnit", "workspaceDir", "workspaceAlias",
  "dispatchWorktreeRoot", "responseStateDir", "commitTuple", "authority"
]));

const TRUSTED_DEPENDENCY_FIELDS = Object.freeze(new Set([
  "serverPath", "spawnServer", "createFifos", "makePrivateDirectory",
  "resolveRoleToolNames", "bootstrapNodeEngineEnv", "execPath",
  "serverStartupTimeoutMs", "clientReadinessTimeoutMs"
]));

function safeClose(fd) {
  if (!Number.isInteger(fd) || fd < 0) return;
  try { closeSync(fd); } catch (error) {
    if (error?.code !== "EBADF") throw error;
  }
}

function safeUnlink(file) {
  try { unlinkSync(file); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
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

function assertFifo(file, expected = null) {
  const stats = lstatSync(file);
  const expectedUid = typeof process.getuid === "function" ? process.getuid() : stats.uid;
  if (!stats.isFIFO() || stats.uid !== expectedUid || (stats.mode & 0o777) !== 0o600) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_INVALID,
      "stdio MCP conduit object must be a launcher-owned mode 0600 FIFO",
      { file, uid: stats.uid, mode: stats.mode & 0o777, fifo: stats.isFIFO() });
  }
  if (expected && (stats.dev !== expected.dev || stats.ino !== expected.ino)) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_IDENTITY_MISMATCH,
      "stdio MCP conduit FIFO identity changed during launch",
      { file, expected, actual: { dev: stats.dev, ino: stats.ino } });
  }
  return Object.freeze({ dev: stats.dev, ino: stats.ino, uid: stats.uid, mode: stats.mode & 0o777 });
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

function deferred() {
  const state = { settled: false };
  state.promise = new Promise((resolve, reject) => {
    state.resolve = (value) => { if (!state.settled) { state.settled = true; resolve(value); } };
    state.reject = (error) => { if (!state.settled) { state.settled = true; reject(error); } };
  });
  return state;
}

function createChildTerminationLatch() {
  const settled = deferred();
  let terminal = null;
  let cleanupInitiated = false;
  return {
    get terminal() { return terminal; },
    get settlement() { return settled.promise; },

    get cleanupInitiated() { return cleanupInitiated; },

    markCleanupInitiated() {
      if (terminal !== null) return false;
      cleanupInitiated = true;
      return true;
    },
    finalize(source, code = null, signal = null, spawnError = null) {
      if (terminal !== null) return false;
      terminal = Object.freeze({
        source,
        code: code ?? null,
        signal: signal ?? null,

        spawnFailed: source === "error",
        cleanupInitiated,
        error: spawnError ?? null
      });
      settled.resolve(terminal);
      return true;
    }
  };
}

function compareToolSurfaces(expected, actual) {
  if (!Array.isArray(expected)) return null;
  const actualNames = Array.isArray(actual) ? actual.map((name) => String(name)) : [];
  const duplicates = [...new Set(
    actualNames.filter((name, index) => actualNames.indexOf(name) !== index)
  )].sort();
  const expectedSorted = [...expected].map((name) => String(name)).sort();
  const actualSorted = [...actualNames].sort();
  const missing = expectedSorted.filter((name) => !actualNames.includes(name));
  const unexpected = actualSorted.filter((name) => !expected.includes(name));
  if (duplicates.length === 0 && missing.length === 0 && unexpected.length === 0 &&
      actualSorted.length === expectedSorted.length) {
    return null;
  }
  return {
    expected: expectedSorted,
    actual: actualSorted,
    missing,
    unexpected,
    duplicates
  };
}

function observeConduitLifecycle({
  child,
  serverStartupTimeoutMs,
  clientReadinessTimeoutMs,
  expectedToolNames,
  getStderr = () => "",

  termination = createChildTerminationLatch()
}) {
  const serverReady = deferred();
  const clientReady = deferred();

  const serverExit = deferred();
  let buffer = "";
  let initialized = false;
  let clientReadyResolved = false;
  let readinessEvent = null;
  let failure = null;
  let serverTimer = null;
  let clientTimer = null;

  const clearServerTimer = () => {
    if (serverTimer !== null) { clearTimeout(serverTimer); serverTimer = null; }
  };
  const clearClientTimer = () => {
    if (clientTimer !== null) { clearTimeout(clientTimer); clientTimer = null; }
  };
  const recordFailure = (error) => {
    if (failure === null) failure = error;
    clearServerTimer();
    clearClientTimer();
    serverReady.reject(error);
    clientReady.reject(error);
  };

  serverTimer = setTimeout(() => recordFailure(new StdioMcpConduitError(
    STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_STARTUP_TIMEOUT,
    "host wiki-MCP server did not report readiness within the launcher startup budget",
    { timeout_ms: serverStartupTimeoutMs }
  )), serverStartupTimeoutMs);

  const finalizeChild = (source, code, signal, spawnError) => {

    const cleanupOwned = termination.cleanupInitiated;
    if (!termination.finalize(source, code, signal, spawnError)) return;
    clearServerTimer();
    clearClientTimer();
    if (source === "error") {

      serverExit.resolve(Object.freeze({
        code: null, signal: null, expected: false, spawnFailed: true
      }));
      recordFailure(new StdioMcpConduitError(
        STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_START_FAILED,
        "host wiki-MCP server failed to spawn",
        { message: spawnError?.message ?? String(spawnError), code: spawnError?.code ?? null }
      ));
      return;
    }

    const expected = clientReadyResolved && code === 0 && signal === null;
    serverExit.resolve(Object.freeze({
      code, signal, expected, cleanupInitiated: cleanupOwned
    }));
    if (expected) return;

    if (cleanupOwned) return;
    recordFailure(new StdioMcpConduitError(
      STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_EXIT,
      clientReadyResolved
        ? "host wiki-MCP server exited abnormally while the confined client was running"
        : serverReady.settled
          ? "host wiki-MCP server exited before the confined client became ready"
          : "host wiki-MCP server exited before reporting readiness",
      { code, signal, stderr: getStderr() }
    ));
  };
  child.once?.("error", (error) => finalizeChild("error", null, null, error));
  child.once?.("exit", (code, signal) => finalizeChild("exit", code, signal, null));
  child.once?.("close", (code, signal) => finalizeChild("close", code, signal, null));

  const readyStream = child.stdio?.[STDIO_MCP_READY_FD];
  if (!readyStream) {
    recordFailure(new StdioMcpConduitError(
      STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_READINESS_FAILED,
      "host wiki-MCP server readiness pipe is unavailable"
    ));
    return {
      serverReady: serverReady.promise,
      clientReady: clientReady.promise,
      serverExit: serverExit.promise,
      beginClientReadiness: () => {},
      currentFailure: () => failure,
      termination
    };
  }

  const handleEvent = (event) => {
    if (event?.schema_version === "wiki-mcp-launcher-readiness.v1" && event?.ready === true) {
      const mismatch = compareToolSurfaces(expectedToolNames, event.tools);
      if (mismatch) {
        recordFailure(new StdioMcpConduitError(
          STDIO_MCP_CONDUIT_ERROR_CODES.TOOL_SURFACE_MISMATCH,
          "host wiki-MCP registered tool surface does not match the launcher-derived role profile",
          mismatch));
        return;
      }
      readinessEvent = Object.freeze({
        ...event,
        tools: Object.freeze([...(event.tools ?? [])].sort())
      });

      clearServerTimer();
      serverReady.resolve(readinessEvent);
      return;
    }
    if (event?.schema_version === "wiki-mcp-launcher-client-initialized.v1" &&
        event?.initialized === true) {
      if (!serverReady.settled) {
        recordFailure(new StdioMcpConduitError(
          STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_FAILED,
          "confined client initialized before the host wiki-MCP server reported readiness"));
        return;
      }
      initialized = true;
      return;
    }
    if (event?.schema_version === "wiki-mcp-launcher-tools-listed.v1" &&
        event?.tools_listed === true) {
      if (!initialized) {
        recordFailure(new StdioMcpConduitError(
          STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_FAILED,
          "confined client requested tools/list before completing MCP initialize"));
        return;
      }

      const mismatch = compareToolSurfaces(expectedToolNames, event.tools);
      if (mismatch) {
        recordFailure(new StdioMcpConduitError(
          STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_TOOL_SURFACE_MISMATCH,
          "tool surface returned to the confined client does not match the launcher-derived role profile",
          mismatch));
        return;
      }
      clearClientTimer();
      clientReadyResolved = true;
      clientReady.resolve(Object.freeze({
        initialized: true,
        toolsListed: true,
        tools: Object.freeze([...(event.tools ?? [])].map(String).sort())
      }));
      return;
    }
    if (event?.schema_version === "wiki-mcp-launcher-client-restarted.v1" &&
        event?.restarted === true) {

      recordFailure(new StdioMcpConduitError(
        STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_RELAY_RESTARTED,
        "confined client restarted its MCP relay; the per-dispatch conduit cannot be resumed",
        { restart_count: Number.isInteger(event.restart_count) ? event.restart_count : null }));
      return;
    }
    recordFailure(new StdioMcpConduitError(
      STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_READINESS_FAILED,
      "host wiki-MCP server emitted an invalid lifecycle event", { event }));
  };

  readyStream.setEncoding("utf8");
  readyStream.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let event;
      try {
        event = JSON.parse(line);
      } catch (error) {
        recordFailure(new StdioMcpConduitError(
          STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_READINESS_FAILED,
          "host wiki-MCP server emitted malformed readiness",
          { message: error?.message ?? String(error) }));
        return;
      }
      handleEvent(event);
      if (failure !== null) return;
    }
  });

  return {
    serverReady: serverReady.promise,
    clientReady: clientReady.promise,
    serverExit: serverExit.promise,
    beginClientReadiness: () => {
      if (clientReady.settled || clientTimer !== null) return;
      clientTimer = setTimeout(() => recordFailure(new StdioMcpConduitError(
        STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_TIMEOUT,
        "confined client did not complete MCP initialize and tools/list within the launcher budget",
        { timeout_ms: clientReadinessTimeoutMs, initialized }
      )), clientReadinessTimeoutMs);
    },
    currentFailure: () => failure,
    termination
  };
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
  for (const name of ["spawnServer", "createFifos", "makePrivateDirectory",
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
  let server = null;
  let namespaceReady = false;
  let readinessFailure = null;
  let cleanupFailure = null;

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

  deregisterProcessLocal = registerProcessLocalStdioMcpConduit(settleCleanup);

  try {

    const directory = scope.acquire("conduit-directory",
      () => trusted.makePrivateDirectory(),
      (dir) => { try { rmdirSync(dir); } catch (error) { if (error?.code !== "ENOENT") throw error; } });
    chmodSync(directory, 0o700);
    assertPrivateDirectory(directory);

    const clientToServer = path.join(directory, "client-to-server.fifo");
    const serverToClient = path.join(directory, "server-to-client.fifo");

    scope.adopt("fifo-client-to-server", () => safeUnlink(clientToServer));
    scope.adopt("fifo-server-to-client", () => safeUnlink(serverToClient));
    const made = trusted.createFifos({ clientToServer, serverToClient });
    if (made?.error || made?.status !== 0) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_CREATE_FAILED,
        "launcher could not create the stdio MCP FIFO pair",
        { code: made?.error?.code ?? made?.status ?? null,
          stderr: made?.stderr?.slice(0, 512) ?? "" });
    }
    if (readdirSync(directory).sort().join("\0") !==
        ["client-to-server.fifo", "server-to-client.fifo"].sort().join("\0")) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_INVALID,
        "stdio MCP conduit directory must contain exactly the two launcher-created FIFOs");
    }
    const identities = Object.freeze({
      clientToServer: assertFifo(clientToServer),
      serverToClient: assertFifo(serverToClient)
    });

    const c2sPathFd = scope.openFd("c2s-o-path",
      () => openSync(clientToServer, LINUX_O_PATH | fsConstants.O_NOFOLLOW));
    const s2cPathFd = scope.openFd("s2c-o-path",
      () => openSync(serverToClient, LINUX_O_PATH | fsConstants.O_NOFOLLOW));
    const c2sPathStats = fstatSync(c2sPathFd);
    const s2cPathStats = fstatSync(s2cPathFd);
    if (!c2sPathStats.isFIFO() || !s2cPathStats.isFIFO() ||
        c2sPathStats.ino !== identities.clientToServer.ino ||
        s2cPathStats.ino !== identities.serverToClient.ino) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.FIFO_IDENTITY_MISMATCH,
        "O_PATH conduit references do not identify the created FIFO pair");
    }

    const c2sAnchor = scope.openFd("c2s-anchor",
      () => openSync(clientToServer, fsConstants.O_RDWR | fsConstants.O_NONBLOCK));
    const s2cAnchor = scope.openFd("s2c-anchor",
      () => openSync(serverToClient, fsConstants.O_RDWR | fsConstants.O_NONBLOCK));

    const c2sRead = scope.openFd("server-stdin",
      () => openSync(clientToServer, fsConstants.O_RDONLY));
    const s2cWrite = scope.openFd("server-stdout",
      () => openSync(serverToClient, fsConstants.O_WRONLY));

    const serverPath = trusted.serverPath;
    if (typeof serverPath !== "string" || !path.isAbsolute(serverPath)) {
      fail(STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_UNAVAILABLE,
        "launcher could not resolve the host wiki-MCP server entrypoint");
    }
    const serverEnv = buildServerEnv(input, role);
    trusted.bootstrapNodeEngineEnv(serverEnv, input.workspaceDir);
    const expectedToolNames = await trusted.resolveRoleToolNames(role, serverEnv);

    const serverTermination = createChildTerminationLatch();
    server = scope.acquire("host-server",
      () => trusted.spawnServer(trusted.execPath, [serverPath], {
        cwd: input.workspaceDir,
        env: serverEnv,
        stdio: [c2sRead, s2cWrite, "pipe", "pipe"],
        detached: false
      }),
      (child) => reapChild(child, "SIGTERM", 2_000, serverTermination));

    let serverStderr = "";
    server.stderr?.setEncoding("utf8");
    server.stderr?.on("data", (chunk) => {
      serverStderr = `${serverStderr}${chunk}`.slice(-4096);
    });

    scope.release("server-stdin");
    scope.release("server-stdout");

    const lifecycle = observeConduitLifecycle({
      child: server,
      serverStartupTimeoutMs: trusted.serverStartupTimeoutMs,
      clientReadinessTimeoutMs: trusted.clientReadinessTimeoutMs,
      expectedToolNames,
      getStderr: () => serverStderr,
      termination: serverTermination
    });

    lifecycle.clientReady.catch((error) => { readinessFailure = error; });
    const readiness = await lifecycle.serverReady;

    const markNamespaceReady = () => {
      if (namespaceReady || scope.disposed) return;
      assertFifo(clientToServer, identities.clientToServer);
      assertFifo(serverToClient, identities.serverToClient);
      namespaceReady = true;

      scope.release("c2s-o-path");
      scope.release("s2c-o-path");
      scope.release("fifo-client-to-server");
      scope.release("fifo-server-to-client");

      scope.release("c2s-anchor");
      scope.release("s2c-anchor");
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

    const clientReady = lifecycle.clientReady;

    const binding = Object.freeze({
      schemaVersion: STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION,
      runId, app: family, family, role, assignedUnit: input.assignedUnit,
      workspaceDir: path.resolve(input.workspaceDir), directory, fifoCount: 2,

      authority,
      fifoIdentities: identities,
      pathFds: Object.freeze([c2sPathFd, s2cPathFd]),
      anchorFds: Object.freeze([c2sAnchor, s2cAnchor]),
      childFds: Object.freeze([STDIO_MCP_CONDUIT_INPUT_FD, STDIO_MCP_CONDUIT_OUTPUT_FD]),
      bindTargets: Object.freeze([STDIO_MCP_CLIENT_TO_SERVER_PATH, STDIO_MCP_SERVER_TO_CLIENT_PATH]),
      relay: Object.freeze({
        command: STDIO_MCP_RELAY_COMMAND,
        args: STDIO_MCP_RELAY_ARGS,
        env: Object.freeze({})
      }),
      readiness,
      toolNames: expectedToolNames,
      clientReady,
      beginClientReadiness: lifecycle.beginClientReadiness,

      serverExit: lifecycle.serverExit,
      server,
      lifecycleOwner: Object.freeze({ kind: "launcher", run_id: runId }),
      markNamespaceReady, cleanup, cancel,

      settleCleanup,
      get serverStderr() { return serverStderr; },
      get namespaceReady() { return namespaceReady; },
      get cleaned() { return scope.disposed; },

      get readinessFailure() { return readinessFailure ?? lifecycle.currentFailure(); },

      get cleanupFailure() { return cleanupFailure; },

      get retainedReleaseFailures() { return scope.retainedReleaseFailures; }
    });
    return registerTrustedStdioMcpConduitBinding(binding);
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
