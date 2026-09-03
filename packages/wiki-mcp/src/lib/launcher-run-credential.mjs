import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync
} from "node:fs";
import path from "node:path";

import {
  MANAGED_RUN_PROCESS_IDENTITY_STATES,
  normalizeManagedRunIdentityTuple,
  readManagedRunProcessIdentity
} from "../../../agent-launch-cli/src/lib/managed-run-process-identity.mjs";
import { sameTuple } from
  "../../../agent-launch-cli/src/lib/managed-run-process-identity-contract.mjs";
import {
  FROZEN_REVIEW_CONTRACT_ARTIFACT_FILENAME_PREFIX,
  FROZEN_REVIEW_CONTRACT_ARTIFACT_PATH_ENV_VAR
} from "../../../wiki-core/src/lib/frozen-review-contract-query.mjs";
import {
  FROZEN_STANDALONE_FINDINGS_ACCEPTANCE_CONTRACT_SCHEMA_VERSION
} from "../../../agent-launch-cli/src/lib/workspace-agent-findings-role-context.mjs";
import {
  LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES
} from "../../../agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";
import {
  WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT_ENV_VAR,
  authenticateLauncherAgentSessionContract
} from "../../../agent-launch-cli/src/lib/stdio-mcp-conduit-core.mjs";

export { WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT_ENV_VAR };

export const WIKI_MCP_ASSIGNED_UNIT_ENV_VAR = "WIKI_MCP_ASSIGNED_UNIT";
export const WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR = "WIKI_MCP_COMMIT_LAUNCH_REF";
export const WIKI_MCP_COMMIT_RUN_ID_ENV_VAR = "WIKI_MCP_COMMIT_RUN_ID";
export const WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR = "WIKI_MCP_COMMIT_RETRY_ID";
export const WIKI_MCP_TOOL_PROFILE_ENV_VAR = "WIKI_MCP_TOOL_PROFILE";
export const WIKI_MCP_WORKSPACE_DIR_ENV_VAR = "WIKI_MCP_WORKSPACE_DIR";
export const WIKI_MCP_AGENT_SESSION_CONTRACT_ENV_VAR =
  "WIKI_MCP_AGENT_SESSION_CONTRACT";
export const FROZEN_REVIEW_CONTRACT_ARTIFACT_MAX_BYTES = 16 * 1024 * 1024;
const AUTHENTICATED_MANAGED_FINDINGS_RUN_BINDINGS = new WeakMap();
const MANAGED_FINDINGS_ROLES = Object.freeze(new Set(["reviewer", "redteam"]));
const NON_STANDALONE_FROZEN_ARTIFACT_ROLES = Object.freeze(new Set(["reviewer"]));

function trimmed(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export class LauncherSessionContractRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LauncherSessionContractRefusal";
    this.code = code;
  }
}

function sessionRefusal(code, message) {
  throw new LauncherSessionContractRefusal(code, message);
}

export function resolveLauncherAgentSessionContract(env = process.env) {
  const raw = env?.[WIKI_MCP_AGENT_SESSION_CONTRACT_ENV_VAR];
  if (typeof raw !== "string" || raw.length === 0) {
    sessionRefusal(LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.MISSING,
      "launcher agent session contract is absent");
  }
  let contract;
  try {
    contract = JSON.parse(raw);
  } catch {
    sessionRefusal(LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.SHAPE_INVALID,
      "launcher agent session contract is not JSON");
  }
  const expectedRaw = env?.[WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT_ENV_VAR];
  if (typeof expectedRaw !== "string" || expectedRaw.length === 0) {
    sessionRefusal(LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.AUTHORITY_UNTRUSTED,
      "launcher agent session contract has no launcher-expected facts");
  }
  let expectedContract;
  try {
    expectedContract = JSON.parse(expectedRaw);
  } catch {
    sessionRefusal(LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.AUTHORITY_UNTRUSTED,
      "launcher-expected session contract is not JSON");
  }
  let authenticated;
  try {
    authenticated = authenticateLauncherAgentSessionContract({
      contract,
      expectedContract
    });
  } catch (error) {
    sessionRefusal(
      error?.detail?.refusal_code ??
        error?.detail?.detail?.refusal_code ??
        LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.AUTHORITY_UNTRUSTED,
      error?.message ?? "launcher agent session contract authentication failed"
    );
  }
  const assignedUnit = trimmed(env?.[WIKI_MCP_ASSIGNED_UNIT_ENV_VAR]);
  const role = trimmed(env?.[WIKI_MCP_TOOL_PROFILE_ENV_VAR]);
  if (authenticated.assigned_unit?.address !== assignedUnit || authenticated.role !== role) {
    sessionRefusal(LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.FACT_MISMATCH,
      "launcher agent session contract disagrees with launcher startup facts");
  }
  if (authenticated.minting_provenance?.authority_schema_version !==
      "launcher-stdio-mcp-conduit-authority.v1") {
    sessionRefusal(LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.AUTHORITY_UNTRUSTED,
      "launcher agent session contract provenance is untrusted");
  }
  return authenticated;
}

function parseNonNegativeIntegerString(value, label) {
  const text = trimmed(value);
  if (!text) return null;
  if (!/^(0|[1-9]\d*)$/u.test(text)) {
    throw new Error(`${label} must be a non-negative integer string`);
  }
  return Number.parseInt(text, 10);
}

export function resolveLauncherRunCredential(env = process.env) {
  const launchRef = trimmed(env?.[WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR]);
  const runId = trimmed(env?.[WIKI_MCP_COMMIT_RUN_ID_ENV_VAR]);
  if (!launchRef || !runId) return null;
  return Object.freeze({
    kind: "identity_store_tuple",
    launchRef,
    runId,
    retryId:
      parseNonNegativeIntegerString(
        env?.[WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR],
        WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR
      ) ?? 0
  });
}

export function resolveAssignedUnit(env = process.env) {
  return trimmed(env?.[WIKI_MCP_ASSIGNED_UNIT_ENV_VAR]);
}

function resolveAuthenticatedManagedFindingsRunBinding({
  env,
  assignedUnit,
  credential,
  role,
  readManagedRunIdentity
}) {
  const mainRepo = trimmed(env?.[WIKI_MCP_WORKSPACE_DIR_ENV_VAR]);
  if (!MANAGED_FINDINGS_ROLES.has(role) || typeof assignedUnit !== "string" ||
      !validCredential(credential) || typeof mainRepo !== "string" ||
      !path.isAbsolute(mainRepo)) {
    return null;
  }
  try {
    const tuple = normalizeManagedRunIdentityTuple({
      assigned_unit: assignedUnit,
      launch_ref: credential.launchRef,
      run_id: credential.runId,
      retry_id: credential.retryId
    });
    const record = readManagedRunIdentity({ mainRepo: path.resolve(mainRepo), tuple });
    if (record?.state !== MANAGED_RUN_PROCESS_IDENTITY_STATES.BOUND ||
        record.role !== role ||
        !sameTuple(normalizeManagedRunIdentityTuple(record.tuple), tuple)) {
      return null;
    }
    const binding = Object.freeze({});
    AUTHENTICATED_MANAGED_FINDINGS_RUN_BINDINGS.set(binding, Object.freeze({
      assignedUnit,
      role,
      launchRef: credential.launchRef,
      runId: credential.runId,
      retryId: credential.retryId
    }));
    return binding;
  } catch {
    return null;
  }
}

export function resolveLauncherRunState(env = process.env, {
  readManagedRunIdentity = readManagedRunProcessIdentity
} = {}) {
  const sessionContract = resolveLauncherAgentSessionContract(env);
  const credential = resolveLauncherRunCredential(env);
  const assignedUnit = resolveAssignedUnit(env);
  const role = trimmed(env?.[WIKI_MCP_TOOL_PROFILE_ENV_VAR]);
  const frozenReviewContractPath =
    trimmed(env?.[FROZEN_REVIEW_CONTRACT_ARTIFACT_PATH_ENV_VAR]);
  const base = { credential, assignedUnit, role, frozenReviewContractPath, sessionContract };
  if (frozenReviewContractPath === null) return Object.freeze(base);
  return Object.freeze({
    ...base,
    managedRunBinding: resolveAuthenticatedManagedFindingsRunBinding({
      env,
      assignedUnit,
      credential,
      role,
      readManagedRunIdentity
    })
  });
}

function refusedFrozenArtifact() {
  return Object.freeze({
    status: "refused",
    readable: false,
    artifact_digest: "unavailable"
  });
}

function validCredential(credential) {
  return credential?.kind === "identity_store_tuple" &&
    typeof credential.launchRef === "string" && credential.launchRef.length > 0 &&
    typeof credential.runId === "string" && credential.runId.length > 0 &&
    Number.isSafeInteger(credential.retryId) && credential.retryId >= 0;
}

function hasAuthenticatedManagedFindingsRunBinding(state) {
  const binding = state?.managedRunBinding;
  const identity = binding && AUTHENTICATED_MANAGED_FINDINGS_RUN_BINDINGS.get(binding);
  return identity?.assignedUnit === state.assignedUnit &&
    identity?.role === state.role &&
    identity?.launchRef === state.credential?.launchRef &&
    identity?.runId === state.credential?.runId &&
    identity?.retryId === state.credential?.retryId;
}

function authenticateArtifactFindingsIdentity({ contract, parent, reviewUnit, state }) {
  const [recordId, sliceId, ...rest] = state.assignedUnit.split("#");
  if (rest.length > 0 || !/^WK-\d{4}$/u.test(recordId) ||
      !/^SLICE-\d{3}$/u.test(sliceId) || parent?.id !== recordId ||
      reviewUnit?.id !== sliceId) {
    return null;
  }
  const standaloneAdmissionArtifact = contract.schema_version ===
    FROZEN_STANDALONE_FINDINGS_ACCEPTANCE_CONTRACT_SCHEMA_VERSION;
  if (!standaloneAdmissionArtifact && !NON_STANDALONE_FROZEN_ARTIFACT_ROLES.has(state.role)) {
    return null;
  }
  const artifactRole = standaloneAdmissionArtifact
    ? reviewUnit?.dispatch_intent?.intended_agent_role
    : "reviewer";
  const artifactPurpose = standaloneAdmissionArtifact
    ? (reviewUnit?.review_purpose ?? "standalone")
    : (reviewUnit?.review_purpose ?? null);
  if (artifactRole !== state.role || contract.review_subject !== state.assignedUnit ||
      (standaloneAdmissionArtifact && artifactPurpose !== "standalone")) {
    return null;
  }
  return Object.freeze({ role: artifactRole, purpose: artifactPurpose });
}

function launcherOwnedArtifactPath(artifactPath) {
  if (typeof artifactPath !== "string" || !path.isAbsolute(artifactPath)) return null;
  const basename = path.basename(artifactPath);
  const digestHex = basename.match(new RegExp(
    `^${FROZEN_REVIEW_CONTRACT_ARTIFACT_FILENAME_PREFIX}([0-9a-f]{64})\\.json$`,
    "u"
  ))?.[1] ?? null;
  if (digestHex === null) return null;
  const directory = path.dirname(artifactPath);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === null || realpathSync(directory) !== directory) return null;
  const directoryStats = lstatSync(directory);
  const fileStats = lstatSync(artifactPath);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink() ||
      directoryStats.uid !== uid || (directoryStats.mode & 0o777) !== 0o700 ||
      !fileStats.isFile() || fileStats.isSymbolicLink() || fileStats.uid !== uid ||
      (fileStats.mode & 0o777) !== 0o400 || fileStats.size <= 0 ||
      fileStats.size > FROZEN_REVIEW_CONTRACT_ARTIFACT_MAX_BYTES) {
    return null;
  }
  return { digest: `sha256:${digestHex}`, fileStats };
}

export function resolveFrozenReviewContractArtifact({
  state = resolveLauncherRunState()
} = {}) {
  try {
    if (!MANAGED_FINDINGS_ROLES.has(state?.role) || typeof state.assignedUnit !== "string" ||
        state.assignedUnit.length === 0 || !validCredential(state.credential) ||
        !hasAuthenticatedManagedFindingsRunBinding(state)) {
      return refusedFrozenArtifact();
    }
    const resolvedPath = launcherOwnedArtifactPath(state.frozenReviewContractPath);
    if (resolvedPath === null) return refusedFrozenArtifact();
    const fd = openSync(
      state.frozenReviewContractPath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    );
    let bytes;
    try {
      const opened = fstatSync(fd);
      if (opened.dev !== resolvedPath.fileStats.dev || opened.ino !== resolvedPath.fileStats.ino ||
          opened.size !== resolvedPath.fileStats.size || (opened.mode & 0o777) !== 0o400) {
        return refusedFrozenArtifact();
      }
      bytes = readFileSync(fd);
      const after = fstatSync(fd);
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
          (after.mode & 0o777) !== 0o400 || bytes.byteLength !== opened.size) {
        return refusedFrozenArtifact();
      }
    } finally {
      closeSync(fd);
    }
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== resolvedPath.digest) return refusedFrozenArtifact();
    const contract = JSON.parse(bytes.toString("utf8"));
    const fields = [
      "canonical_parent_wk_contract",
      "review_subject",
      "review_unit_contract",
      "schema_version"
    ];
    if (contract === null || typeof contract !== "object" || Array.isArray(contract) ||
        Object.keys(contract).sort().join("\0") !== fields.slice().sort().join("\0") ||
        contract.review_subject !== state.assignedUnit ||
        fields.some((field) => typeof contract[field] !== "string" || contract[field].length === 0)) {
      return refusedFrozenArtifact();
    }
    const parent = JSON.parse(contract.canonical_parent_wk_contract);
    const reviewUnit = JSON.parse(contract.review_unit_contract);
    if (parent === null || typeof parent !== "object" || Array.isArray(parent) ||
        reviewUnit === null || typeof reviewUnit !== "object" || Array.isArray(reviewUnit)) {
      return refusedFrozenArtifact();
    }
    const findingsIdentity = authenticateArtifactFindingsIdentity({
      contract,
      parent,
      reviewUnit,
      state
    });
    if (findingsIdentity === null) return refusedFrozenArtifact();
    return Object.freeze({
      artifact_digest: digest,
      schema_version: contract.schema_version,
      review_subject: contract.review_subject,
      technical_role: findingsIdentity.role,
      review_purpose: findingsIdentity.purpose,
      canonical_parent_wk_contract: parent,
      review_unit_contract: reviewUnit
    });
  } catch {
    return refusedFrozenArtifact();
  }
}
