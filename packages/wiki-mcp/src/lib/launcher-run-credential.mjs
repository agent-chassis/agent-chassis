import { statSync } from "node:fs";
import path from "node:path";

import {
  PRIVATE_IMMUTABLE_ARTIFACT_MAX_BYTES,
  readPrivateImmutableArtifact
} from "../../../agent-launch-cli/src/lib/managed-assignment-read-artifact.mjs";

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
  ADVISORY_REVIEW_SOURCE_BINDING_KIND,
  LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES,
  WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT_ENV_VAR,
  authenticateLauncherAgentSessionContract,
  digestAdvisoryReviewSourceFacts,
  normalizeAdvisoryReviewSourceFacts
} from "../../../agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";

export { WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT_ENV_VAR };

export const WIKI_MCP_ASSIGNED_UNIT_ENV_VAR = "WIKI_MCP_ASSIGNED_UNIT";
export const WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR = "WIKI_MCP_COMMIT_LAUNCH_REF";
export const WIKI_MCP_COMMIT_RUN_ID_ENV_VAR = "WIKI_MCP_COMMIT_RUN_ID";
export const WIKI_MCP_COMMIT_RETRY_ID_ENV_VAR = "WIKI_MCP_COMMIT_RETRY_ID";
export const WIKI_MCP_TOOL_PROFILE_ENV_VAR = "WIKI_MCP_TOOL_PROFILE";
export const WIKI_MCP_WORKSPACE_DIR_ENV_VAR = "WIKI_MCP_WORKSPACE_DIR";
export const WIKI_MCP_AGENT_SESSION_CONTRACT_ENV_VAR =
  "WIKI_MCP_AGENT_SESSION_CONTRACT";
export const WIKI_MCP_REVIEW_MATERIALIZATION_DIR_ENV_VAR =
  "WIKI_MCP_REVIEW_MATERIALIZATION_DIR";
export const FROZEN_REVIEW_CONTRACT_ARTIFACT_MAX_BYTES = PRIVATE_IMMUTABLE_ARTIFACT_MAX_BYTES;
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

export const FINDINGS_SOURCE_REFUSAL_CONDITIONS = Object.freeze({
  ROLE_UNSUPPORTED: "findings_source_role_unsupported",
  SESSION_UNAUTHENTICATED: "launcher_session_unauthenticated",
  BINDING_ABSENT: "advisory_review_source_binding_absent",
  BINDING_DUPLICATED: "advisory_review_source_binding_duplicated",
  BINDING_MISMATCH: "advisory_review_source_binding_mismatch",
  REPOSITORY_UNAVAILABLE: "advisory_review_repository_unavailable",
  MATERIALIZATION_UNAVAILABLE: "review_materialization_unavailable",
  MATERIALIZATION_UNREADABLE: "review_materialization_unreadable"
});

export class FindingsSourceRefusal extends Error {
  constructor(code, message, subject) {
    super(message);
    this.name = "FindingsSourceRefusal";
    this.code = code;
    this.subject = Object.freeze({ ...subject });
  }
}

function findingsSourceRefusal(code, message, subject) {
  throw new FindingsSourceRefusal(code, message, subject);
}

export function advisoryReviewSourceBindings(contract) {
  return (contract?.minting_provenance?.trusted_source_bindings ?? [])
    .filter((binding) => binding?.kind === ADVISORY_REVIEW_SOURCE_BINDING_KIND);
}

export function resolveAuthenticatedFindingsSource(env = process.env) {
  const role = trimmed(env?.[WIKI_MCP_TOOL_PROFILE_ENV_VAR]);
  if (!MANAGED_FINDINGS_ROLES.has(role)) {
    findingsSourceRefusal(FINDINGS_SOURCE_REFUSAL_CONDITIONS.ROLE_UNSUPPORTED,
      "only a reviewer or redteam session has a findings source", { tool_profile: role });
  }
  let contract;
  try {
    contract = resolveLauncherAgentSessionContract(env);
  } catch (error) {
    if (!(error instanceof LauncherSessionContractRefusal)) throw error;
    findingsSourceRefusal(FINDINGS_SOURCE_REFUSAL_CONDITIONS.SESSION_UNAUTHENTICATED,
      `launcher findings session is unauthenticated (${error.code})`,
      { tool_profile: role, launcher_refusal: error.code });
  }
  const assignedUnit = contract.assigned_unit.address;
  const bindings = advisoryReviewSourceBindings(contract);
  if (bindings.length === 0) {
    findingsSourceRefusal(FINDINGS_SOURCE_REFUSAL_CONDITIONS.BINDING_ABSENT,
      "launcher findings session has no bound review source", { assigned_unit: assignedUnit });
  }
  if (bindings.length > 1) {
    findingsSourceRefusal(FINDINGS_SOURCE_REFUSAL_CONDITIONS.BINDING_DUPLICATED,
      "launcher findings session carries more than one review source binding",
      { assigned_unit: assignedUnit, binding_count: bindings.length });
  }
  const [binding] = bindings;
  const runSubject = { assigned_unit: assignedUnit, run_id: binding.id };
  const repositoryRoot = trimmed(env?.[WIKI_MCP_WORKSPACE_DIR_ENV_VAR]);
  if (repositoryRoot === null || !path.isAbsolute(repositoryRoot)) {
    findingsSourceRefusal(FINDINGS_SOURCE_REFUSAL_CONDITIONS.REPOSITORY_UNAVAILABLE,
      "launcher findings session has no canonical repository root",
      { ...runSubject, environment: WIKI_MCP_WORKSPACE_DIR_ENV_VAR });
  }
  const materializationRoot = trimmed(env?.[WIKI_MCP_REVIEW_MATERIALIZATION_DIR_ENV_VAR]);
  const unavailable = (cause) => findingsSourceRefusal(
    FINDINGS_SOURCE_REFUSAL_CONDITIONS.MATERIALIZATION_UNAVAILABLE,
    `launcher findings review materialization is unavailable (${cause})`,
    { ...runSubject, environment: WIKI_MCP_REVIEW_MATERIALIZATION_DIR_ENV_VAR, cause });
  const unreadable = (error) => findingsSourceRefusal(
    FINDINGS_SOURCE_REFUSAL_CONDITIONS.MATERIALIZATION_UNREADABLE,
    `launcher findings review materialization could not be inspected (${error?.code ?? "unknown"})`,
    { ...runSubject, environment: WIKI_MCP_REVIEW_MATERIALIZATION_DIR_ENV_VAR,
      filesystem_error: typeof error?.code === "string" ? error.code : null });
  if (materializationRoot === null) unavailable("not_configured");
  if (!path.isAbsolute(materializationRoot)) unavailable("not_absolute");
  let isDirectory;
  try {
    isDirectory = statSync(materializationRoot).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") unavailable("missing");
    unreadable(error);
  }
  if (!isDirectory) unavailable("not_a_directory");
  let facts;
  let digest;
  try {
    facts = normalizeAdvisoryReviewSourceFacts({
      role,
      assigned_unit: assignedUnit,
      run_id: binding.id,
      repository_root: repositoryRoot,
      materialization_root: materializationRoot
    });
    digest = digestAdvisoryReviewSourceFacts(facts);
  } catch (error) {
    unreadable(error);
  }

  if (digest !== binding.digest) {
    findingsSourceRefusal(FINDINGS_SOURCE_REFUSAL_CONDITIONS.BINDING_MISMATCH,
      "launcher findings review source does not match its session binding",
      { ...runSubject, unverified_facts: ["repository_root", "materialization_root"] });
  }
  return Object.freeze({
    role,
    assignedUnit,
    runId: binding.id,
    repositoryRoot: facts.repository_root,
    sourceRoot: facts.materialization_root,
    binding: Object.freeze({ kind: binding.kind, id: binding.id, digest: binding.digest })
  });
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

export function resolveFrozenReviewContractArtifact({
  state = resolveLauncherRunState()
} = {}) {
  try {
    if (!MANAGED_FINDINGS_ROLES.has(state?.role) || typeof state.assignedUnit !== "string" ||
        state.assignedUnit.length === 0 || !validCredential(state.credential) ||
        !hasAuthenticatedManagedFindingsRunBinding(state)) {
      return refusedFrozenArtifact();
    }
    const artifact = readPrivateImmutableArtifact({
      artifactPath: state.frozenReviewContractPath,
      prefix: FROZEN_REVIEW_CONTRACT_ARTIFACT_FILENAME_PREFIX,
      maxBytes: FROZEN_REVIEW_CONTRACT_ARTIFACT_MAX_BYTES
    });
    if (artifact === null) return refusedFrozenArtifact();
    const { digest, bytes } = artifact;
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
