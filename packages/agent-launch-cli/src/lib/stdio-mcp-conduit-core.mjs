

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fchmodSync,
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
  FROZEN_REVIEW_CONTRACT_ARTIFACT_FILENAME_PREFIX,
  FROZEN_REVIEW_CONTRACT_ARTIFACT_PATH_ENV_VAR
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
  STDIO_MCP_TRANSCRIPT_ROOT_ENV_VAR,
  resolveStdioMcpTranscriptCaptureRoot
} from "./stdio-mcp-transcript-capture.mjs";
import {
  LAUNCHER_AGENT_SESSION_CONTRACT_FIELDS,
  LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES,
  LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION,
  assertTrustedStdioMcpConduitAuthority,
  canonicalSerializeLauncherAgentSessionContract,
  digestLauncherAgentSessionContract,
  mintLauncherAgentSessionContract,
  resolveLauncherAgentSessionContractFacts,
  resolveTrustedStdioMcpFrozenReviewContractSnapshot
} from "./stdio-mcp-conduit-authority.mjs";

export const WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT_ENV_VAR =
  "WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT";
import {
  compareToolSurfaces,
  createChildTerminationLatch,
  observeConduitLifecycle
} from "./stdio-mcp-conduit-lifecycle.mjs";
import {
  serializeLauncherNoCceAuthorityDeclaration
} from "../../../wiki-mcp/src/lib/launcher-no-cce-authority.mjs";
import {
  openWikiMcpCommonProofResolverCapabilityDescriptor
} from "./wiki-mcp-common-proof-resolver-capability.mjs";

export const STDIO_MCP_COMPLETION_CREDENTIAL_SCHEMA_VERSION =
  LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION;

function sessionContractRefusal(refusalCode, message, detail = null) {
  fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID, message, {
    session_contract_refusal: Object.freeze({
      schema_version: "launcher-agent-session-contract-refusal.v1",
      code: refusalCode
    }),
    refusal_code: refusalCode,
    ...(detail === null ? {} : { detail })
  });
}

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

const INPUT_FIELDS = Object.freeze(new Set([
  "family", "role", "assignedUnit", "workspaceDir", "workspaceAlias",
  "dispatchWorktreeRoot", "responseStateDir", "commitTuple", "authority",
  "sessionContract"
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

function transcriptCaptureServerEnv() {
  const resolved = resolveStdioMcpTranscriptCaptureRoot();
  return resolved.root === null
    ? {}
    : { [STDIO_MCP_TRANSCRIPT_ROOT_ENV_VAR]: resolved.root };
}

function buildServerEnv(input, role, {
  frozenReviewContractArtifactPath = null,
  reviewerCredential = null,
  reviewMaterializationDir = null
} = {}) {
  const env = {
    ...transcriptCaptureServerEnv(),
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

  const commitTuple = reviewerCredential ?? input.commitTuple;
  if (commitTuple) {
    env.WIKI_MCP_COMMIT_LAUNCH_REF = commitTuple.launchRef;
    env.WIKI_MCP_COMMIT_RUN_ID = commitTuple.runId;
    env.WIKI_MCP_COMMIT_RETRY_ID = String(commitTuple.retryId);
  }
  if (frozenReviewContractArtifactPath !== null) {
    env[FROZEN_REVIEW_CONTRACT_ARTIFACT_PATH_ENV_VAR] =
      frozenReviewContractArtifactPath;
  }
  if (reviewMaterializationDir !== null) {
    env.WIKI_MCP_REVIEW_MATERIALIZATION_DIR = reviewMaterializationDir;
  }
  return env;
}

function publishFrozenReviewContractArtifact({ scope, directory, snapshot }) {
  if (snapshot === null) return null;
  const digestHex = typeof snapshot.digest === "string"
    ? snapshot.digest.match(/^sha256:([0-9a-f]{64})$/u)?.[1] ?? null
    : null;
  if (digestHex === null || !(snapshot.bytes instanceof Uint8Array) ||
      snapshot.bytes.byteLength !== snapshot.byte_length) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "trusted frozen review contract snapshot is incomplete before publication");
  }
  const artifactPath = path.join(
    directory,
    `${FROZEN_REVIEW_CONTRACT_ARTIFACT_FILENAME_PREFIX}${digestHex}.json`
  );
  const bytes = snapshot.bytes;
  let fd = null;
  try {
    fd = openSync(
      artifactPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY |
        fsConstants.O_NOFOLLOW,
      0o600
    );
    let offset = 0;
    while (offset < bytes.byteLength) {
      const written = writeSync(fd, bytes, offset, bytes.byteLength - offset);
      if (written <= 0) throw new Error("frozen review contract artifact write made no progress");
      offset += written;
    }
    fsyncSync(fd);
    fchmodSync(fd, 0o400);
    fsyncSync(fd);
  } catch (error) {
    if (fd !== null) {
      try { closeSync(fd); } catch {   }
      fd = null;
    }
    try { unlinkSync(artifactPath); } catch (unlinkError) {
      if (unlinkError?.code !== "ENOENT") {
        Object.defineProperty(error, "frozenReviewArtifactCleanupFailure", {
          value: Object.freeze({
            code: unlinkError?.code ?? null,
            message: unlinkError?.message ?? String(unlinkError)
          }),
          enumerable: false
        });
      }
    }
    throw error;
  } finally {
    if (fd !== null) closeSync(fd);
  }
  const stats = statSync(artifactPath);
  const expectedUid = typeof process.getuid === "function" ? process.getuid() : stats.uid;
  if (!stats.isFile() || stats.uid !== expectedUid ||
      (stats.mode & 0o777) !== 0o400 || stats.size !== snapshot.byte_length) {
    try { unlinkSync(artifactPath); } catch {   }
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "published frozen review contract artifact failed its immutable identity check");
  }
  scope.adopt("frozen-review-contract-artifact", () => {
    try { unlinkSync(artifactPath); } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  });
  return artifactPath;
}

export function mintStdioMcpCompletionCredential(input = {}) {
  if (!input.authority) return null;
  return mintLauncherAgentSessionContract(input);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function sameCanonicalBytes(left, right) {
  return canonicalSerializeLauncherAgentSessionContract(left).equals(
    canonicalSerializeLauncherAgentSessionContract(right)
  );
}

export function authenticateLauncherAgentSessionContract({
  contract,
  expectedFacts = null,
  expectedContract = null,
  consumerVersion = LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION
} = {}) {
  if (consumerVersion !== LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION) {
    sessionContractRefusal(
      LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.CONSUMER_VERSION_MISMATCH,
      "session contract consumer version is incompatible"
    );
  }
  if (contract === null || contract === undefined) {
    sessionContractRefusal(
      LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.MISSING,
      "launcher agent session contract is absent"
    );
  }
  if (!plainObject(contract)) {
    sessionContractRefusal(
      LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.SHAPE_INVALID,
      "launcher agent session contract is not a closed object"
    );
  }
  if (typeof contract.schema_version !== "string" ||
      contract.schema_version !== LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION) {
    sessionContractRefusal(
      LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.SCHEMA_UNSUPPORTED,
      "launcher agent session contract schema is unsupported"
    );
  }
  const fields = Object.keys(contract).sort();
  const expectedFields = [...LAUNCHER_AGENT_SESSION_CONTRACT_FIELDS].sort();
  if (fields.length !== expectedFields.length ||
      fields.some((field, index) => field !== expectedFields[index])) {
    sessionContractRefusal(
      LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.SHAPE_INVALID,
      "launcher agent session contract field closure is invalid"
    );
  }
  if (typeof contract.contract_digest !== "string" ||
      digestLauncherAgentSessionContract(contract) !== contract.contract_digest) {
    sessionContractRefusal(
      LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.DIGEST_MISMATCH,
      "launcher agent session contract digest does not match canonical bytes"
    );
  }
  if ((expectedFacts === null || expectedFacts === undefined) && expectedContract !== null) {
    if (!plainObject(expectedContract) ||
        expectedContract.schema_version !== LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION ||
        Object.keys(expectedContract).sort().join("\0") !== expectedFields.join("\0") ||
        typeof expectedContract.contract_digest !== "string" ||
        digestLauncherAgentSessionContract(expectedContract) !== expectedContract.contract_digest) {
      sessionContractRefusal(
        LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.AUTHORITY_UNTRUSTED,
        "launcher-expected session contract is invalid"
      );
    }
    if (!sameCanonicalBytes(contract, expectedContract)) {
      const operatorMismatch = JSON.stringify(contract.minting_provenance?.operator_action_binding) !==
        JSON.stringify(expectedContract.minting_provenance?.operator_action_binding);
      const authorityMismatch = contract.minting_provenance?.authority_schema_version !==
          expectedContract.minting_provenance?.authority_schema_version ||
        contract.minting_provenance?.authority_digest !==
          expectedContract.minting_provenance?.authority_digest;
      const capabilityMismatch = JSON.stringify(contract.capabilities) !==
        JSON.stringify(expectedContract.capabilities);
      const transportMismatch = contract.completion_transport?.transport_id !==
        expectedContract.completion_transport?.transport_id;
      sessionContractRefusal(
        operatorMismatch
          ? LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.OPERATOR_ACTION_BINDING_INVALID
          : authorityMismatch
            ? LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.AUTHORITY_UNTRUSTED
            : capabilityMismatch
              ? LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.CAPABILITY_UNKNOWN
              : transportMismatch
                ? LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.COMPLETION_TRANSPORT_MISMATCH
                : LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.FACT_MISMATCH,
        "session contract facts do not match launcher-expected facts"
      );
    }
    return Object.freeze(structuredClone(contract));
  }
  if (!plainObject(expectedFacts) || !expectedFacts.authority) {
    sessionContractRefusal(
      LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.AUTHORITY_UNTRUSTED,
      "session contract consumer has no launcher-minted authority"
    );
  }
  const availableCapabilities = new Set(expectedFacts.capabilities ?? []);
  if (!Array.isArray(contract.capabilities) ||
      contract.capabilities.some((capability) => !availableCapabilities.has(capability))) {
    sessionContractRefusal(
      LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.CAPABILITY_UNKNOWN,
      "session contract names a capability absent from the registry snapshot"
    );
  }
  if (contract.completion_transport?.transport_id !== expectedFacts.completionTransport) {
    sessionContractRefusal(
      LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.COMPLETION_TRANSPORT_MISMATCH,
      "session contract completion transport contradicts launcher facts"
    );
  }
  let expected;
  try {
    expected = mintLauncherAgentSessionContract(expectedFacts);
  } catch (error) {
    const code = error?.detail?.refusal_code ===
      LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.OPERATOR_ACTION_BINDING_INVALID
      ? LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.OPERATOR_ACTION_BINDING_INVALID
      : LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.AUTHORITY_UNTRUSTED;
    sessionContractRefusal(code, "session contract expected authority facts are invalid");
  }
  if (contract.minting_provenance?.authority_schema_version !==
      expected.minting_provenance.authority_schema_version ||
      contract.minting_provenance?.authority_digest !==
      expected.minting_provenance.authority_digest) {
    sessionContractRefusal(
      LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.AUTHORITY_UNTRUSTED,
      "session contract authority provenance is untrusted"
    );
  }
  if (!sameCanonicalBytes(contract, expected)) {
    const operatorMismatch = JSON.stringify(contract.minting_provenance?.operator_action_binding) !==
      JSON.stringify(expected.minting_provenance.operator_action_binding);
    sessionContractRefusal(
      operatorMismatch
        ? LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.OPERATOR_ACTION_BINDING_INVALID
        : LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.FACT_MISMATCH,
      "session contract facts do not match launcher-resolved facts"
    );
  }
  return Object.freeze(structuredClone(contract));
}

export function authenticateStdioMcpCompletionCredential({
  credential,
  contract = credential,
  expectedFacts,
  consumerVersion
} = {}) {
  return authenticateLauncherAgentSessionContract({ contract, expectedFacts, consumerVersion });
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
  const sessionContract = authenticateLauncherAgentSessionContract({
    contract: input.sessionContract,
    expectedFacts: resolveLauncherAgentSessionContractFacts(authority)
  });
  return { family, role, authority, sessionContract };
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
  let namespaceReady = false;
  let readinessFailure = null;
  let cleanupFailure = null;

  let lifecycle = null;
  let generationServer = null;
  let generationStderr = () => "";
  let readinessEvent = null;

  let unboundLifecycleFailure = null;
  let clientReadinessRequested = false;
  let clientReadinessStartedAt = null;
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
    if (lifecycle !== null) return;
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

  const bindLifecycleGeneration = (generationLifecycle, child, getStderr) => {
    const candidate = {
      lifecycle: generationLifecycle,
      child,
      getStderr,
      readinessEvent: null
    };
    generationCandidates.add(candidate);
    if (lifecycle === null) activateCandidate(candidate);
    generationLifecycle.serverReady.then((event) => {
      candidate.readinessEvent = event;
      if (lifecycle === generationLifecycle) readinessEvent = event;
    }, () => {});
    generationLifecycle.clientReady.then((ready) => {
      if (clientReadyRelay.settled) return;
      if (lifecycle !== generationLifecycle) activateCandidate(candidate);
      clearClientReadinessTimer();
      clientReadyRelay.resolve(ready);
    }, (error) => {
      if (lifecycle === generationLifecycle) recordFacadeFailure(error);
    });
    generationLifecycle.failureSettlement.then((error) => {
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
      reviewerCredential,
      reviewMaterializationDir: authority.reviewMaterializationDir
    });

    serverEnv.WIKI_MCP_AGENT_SESSION_CONTRACT =
      canonicalSerializeLauncherAgentSessionContract(sessionContract).toString("utf8");

    serverEnv[WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT_ENV_VAR] =
      canonicalSerializeLauncherAgentSessionContract(sessionContract).toString("utf8");

    trusted.bootstrapNodeEngineEnv(serverEnv, input.workspaceDir);
    const expectedToolNames = await trusted.resolveRoleToolNames(role, serverEnv);

    const lifecycleBindingState = Object.freeze({
      app: family,
      assignedUnit: input.assignedUnit,
      workspaceDir: path.resolve(input.workspaceDir),
      sessionContract,
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

    const createGeneration = ({ initialBytes }) => {
      const generationEnv = { ...serverEnv };

      const launcherNoCceAuthorityDeclaration =
        serializeLauncherNoCceAuthorityDeclaration(
          trusted.bootstrapNodeEngineEnv(generationEnv, input.workspaceDir)
        );
      const termination = createChildTerminationLatch();
      const authorityFd = openLauncherNoCceAuthorityDescriptor(
        directory,
        launcherNoCceAuthorityDeclaration
      );
      let commonProofResolverFd = null;
      let spawned;
      try {
        commonProofResolverFd = openWikiMcpCommonProofResolverCapabilityDescriptor({
          directory,
          workspaceDir: input.workspaceDir,
          repositoryAlias: input.workspaceAlias ?? path.basename(input.workspaceDir)
        });
        spawned = spawnMeasuredServerGeneration(
          trusted.spawnServer, trusted.execPath, [serverPath], {
          cwd: input.workspaceDir, env: generationEnv,
          stdio: ["pipe", "pipe", "pipe", "pipe",
            authorityFd === null ? "ignore" : authorityFd,
            commonProofResolverFd],
          detached: false
          });
      } finally {
        if (authorityFd !== null) closeSync(authorityFd);
        if (commonProofResolverFd !== null) closeSync(commonProofResolverFd);
      }
      const { child, readinessMeasurements } = spawned;
      let stderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => { stderr += chunk; });
      const generationLifecycle = observeConduitLifecycle({
        child, serverStartupTimeoutMs: trusted.serverStartupTimeoutMs,
        clientReadinessTimeoutMs: clientReadinessStartedAt === null
          ? trusted.clientReadinessTimeoutMs
          : Math.max(1, trusted.clientReadinessTimeoutMs -
            (Date.now() - clientReadinessStartedAt)),
        expectedToolNames, role, getStderr: () => stderr, termination,
        readinessMeasurements
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
  reapChild,
  spawnMeasuredServerGeneration
});
