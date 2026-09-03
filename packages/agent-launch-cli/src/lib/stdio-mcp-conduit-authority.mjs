

import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

import {
  STDIO_MCP_CONDUIT_ALLOWED_FAMILIES,
  STDIO_MCP_CONDUIT_ALLOWED_ROLES,
  STDIO_MCP_CONDUIT_ERROR_CODES,
  failStdioMcpConduit as fail,
  normalizeStdioMcpConduitRole
} from "./stdio-mcp-conduit-contract.mjs";
import {
  isTrustedFrozenReviewContract
} from "./backend-review-identity.mjs";
import {
  FROZEN_REVIEW_CONTRACT_SNAPSHOT_SCHEMA_VERSION,
  createFrozenReviewContractSnapshot,
  serializeTrustedFrozenReviewContract,
  digestFrozenReviewContractSnapshot
} from "./frozen-review-contract-snapshot.mjs";
import { consumeLauncherFindingsLifecycleContext } from
  "./workspace-agent-findings-lifecycle-context.mjs";

export const STDIO_MCP_CONDUIT_AUTHORITY_SCHEMA_VERSION =
  "launcher-stdio-mcp-conduit-authority.v1";

export const LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION =
  "launcher-agent-session-contract.v1";

export const LAUNCHER_AGENT_SESSION_CONTRACT_FIELDS = Object.freeze([
  "schema_version", "role", "assigned_unit", "repository", "read_scope",
  "repo_paths", "write_scope", "lifecycle", "capabilities",
  "completion_transport", "minting_provenance", "contract_digest"
]);

export const LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES = Object.freeze({
  MISSING: "session_contract_missing",
  SCHEMA_UNSUPPORTED: "session_contract_schema_unsupported",
  SHAPE_INVALID: "session_contract_shape_invalid",
  AUTHORITY_UNTRUSTED: "session_contract_authority_untrusted",
  FACT_MISMATCH: "session_contract_fact_mismatch",
  DIGEST_MISMATCH: "session_contract_digest_mismatch",
  CAPABILITY_UNKNOWN: "session_contract_capability_unknown",
  COMPLETION_TRANSPORT_MISMATCH: "session_contract_completion_transport_mismatch",
  OPERATOR_ACTION_BINDING_INVALID: "session_contract_operator_action_binding_invalid",
  CONSUMER_VERSION_MISMATCH: "session_contract_consumer_version_mismatch"
});

export const LAUNCHER_AGENT_SESSION_COMPLETION_TRANSPORTS = Object.freeze({
  COORDINATOR_CONTROL: "coordinator_control",
  MANAGED_SLICE_DELIVERY: "managed_slice_delivery",
  WORKSPACE_SUBMIT_FOR_REVIEW: "workspace_submit_for_review",
  STANDALONE_FINDINGS: "standalone_findings"
});

const SESSION_ROLES = Object.freeze(["orchestrator", "worker", "reviewer", "redteam"]);
const SESSION_ROLE_SET = new Set(SESSION_ROLES);
const SESSION_REVIEW_PURPOSES = new Set(["standalone", "terminal_whole_wk"]);
const SESSION_TRANSPORT_SET = new Set(Object.values(LAUNCHER_AGENT_SESSION_COMPLETION_TRANSPORTS));
const SESSION_CONTRACTS = new WeakSet();
const SESSION_CONTRACT_CAPTURE = new AsyncLocalStorage();
const SESSION_TOP_LEVEL_SET = new Set(LAUNCHER_AGENT_SESSION_CONTRACT_FIELDS);
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function bytewiseCompare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isPlainObject(value)) {
    const result = {};
    for (const key of Object.keys(value).sort(bytewiseCompare)) {
      result[key] = canonicalValue(value[key]);
    }
    return result;
  }
  return value;
}

export function canonicalSerializeLauncherAgentSessionContract(contract, {
  omitDigest = false
} = {}) {
  const source = omitDigest && isPlainObject(contract)
    ? Object.fromEntries(Object.entries(contract).filter(([key]) => key !== "contract_digest"))
    : contract;
  return Buffer.from(JSON.stringify(canonicalValue(source)), "utf8");
}

export function digestLauncherAgentSessionContract(contract) {
  return `sha256:${createHash("sha256")
    .update(canonicalSerializeLauncherAgentSessionContract(contract, { omitDigest: true }))
    .digest("hex")}`;
}

function canonicalStringArray(label, value, { scope = false } = {}) {
  if (!Array.isArray(value)) refuse(`${label} must be an array`);
  const result = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.includes("\0")) {
      refuse(`${label} contains an invalid identifier`);
    }
    if (scope && (path.isAbsolute(entry) || entry.split("/").includes(".."))) {
      refuse(`${label} contains a non-repository-relative selector`, { entry });
    }
    result.push(entry);
  }
  const sorted = [...new Set(result)].sort(bytewiseCompare);
  if (sorted.length !== result.length || sorted.some((entry, index) => entry !== result[index])) {
    refuse(`${label} must be duplicate-free and bytewise sorted`);
  }
  return Object.freeze(sorted);
}

function exactKeys(value, keys) {
  return isPlainObject(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function parseAssignedUnit(value, role) {
  if (typeof value !== "string") refuse("session contract assigned unit must be a canonical address");
  if (role === "orchestrator") {
    if (!/^IN-\d{4}$/u.test(value)) {
      refuse("orchestrator session contract assigned unit must be a canonical initiative address");
    }
    return Object.freeze({ record_id: value, slice_id: null, address: value });
  }
  const match = /^(WK-\d{4})(?:#(SLICE-\d{3}))?$/u.exec(value);
  if (!match) refuse("session contract assigned unit must be a canonical address");
  return Object.freeze({ record_id: match[1], slice_id: match[2] ?? null, address: value });
}

function expectedTransport(role, reviewPurpose) {
  if (role === "orchestrator") return LAUNCHER_AGENT_SESSION_COMPLETION_TRANSPORTS.COORDINATOR_CONTROL;
  if (role === "worker") return LAUNCHER_AGENT_SESSION_COMPLETION_TRANSPORTS.MANAGED_SLICE_DELIVERY;
  return reviewPurpose === "terminal_whole_wk"
    ? LAUNCHER_AGENT_SESSION_COMPLETION_TRANSPORTS.WORKSPACE_SUBMIT_FOR_REVIEW
    : LAUNCHER_AGENT_SESSION_COMPLETION_TRANSPORTS.STANDALONE_FINDINGS;
}

function digestPlainObject(value) {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(JSON.stringify(canonicalValue(value)), "utf8"))
    .digest("hex")}`;
}

function normalizeOperatorActionBinding(binding) {
  if (binding === null) return null;
  const fields = ["decision_id", "action_id", "authenticated_actor_binding_digest",
    "selected_findings_source_digest", "action_binding_digest"];
  if (!exactKeys(binding, fields) || binding.decision_id !== "DEC-0182" ||
      typeof binding.action_id !== "string" || binding.action_id.length === 0 ||
      !SHA256_PATTERN.test(binding.authenticated_actor_binding_digest ?? "") ||
      !SHA256_PATTERN.test(binding.selected_findings_source_digest ?? "") ||
      !SHA256_PATTERN.test(binding.action_binding_digest ?? "")) {
    refuse("session contract operator action binding is invalid", {
      refusal_code: LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.OPERATOR_ACTION_BINDING_INVALID
    });
  }
  const body = {
    decision_id: binding.decision_id,
    action_id: binding.action_id,
    authenticated_actor_binding_digest: binding.authenticated_actor_binding_digest,
    selected_findings_source_digest: binding.selected_findings_source_digest
  };
  if (digestPlainObject(body) !== binding.action_binding_digest) {
    refuse("session contract operator action binding digest is invalid", {
      refusal_code: LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.OPERATOR_ACTION_BINDING_INVALID
    });
  }
  return Object.freeze({ ...body, action_binding_digest: binding.action_binding_digest });
}

function normalizeTrustedSourceBindings(bindings) {
  if (!Array.isArray(bindings) || bindings.length === 0) {
    refuse("session contract requires trusted source bindings");
  }
  const normalized = bindings.map((binding) => {
    if (!exactKeys(binding, ["kind", "id", "digest"]) ||
        ![binding.kind, binding.id].every((value) => typeof value === "string" && value.length > 0) ||
        !SHA256_PATTERN.test(binding.digest ?? "")) {
      refuse("session contract trusted source binding is invalid");
    }
    return Object.freeze({ kind: binding.kind, id: binding.id, digest: binding.digest });
  });
  normalized.sort((left, right) => bytewiseCompare(
    `${left.kind}\0${left.id}\0${left.digest}`,
    `${right.kind}\0${right.id}\0${right.digest}`
  ));
  const identities = normalized.map((entry) => `${entry.kind}\0${entry.id}\0${entry.digest}`);
  if (new Set(identities).size !== identities.length) refuse("session contract source bindings are duplicated");
  return Object.freeze(normalized);
}

function authorityDigestProjection(authority) {
  return {
    schema_version: authority.schemaVersion,
    family: authority.family,
    role: authority.role,
    assigned_unit: authority.assignedUnit,
    mode: authority.mode,
    source: authority.source,
    read_scope: authority.readScope,
    repo_paths: authority.repoPaths ?? [],
    write_scope: authority.writeScope,
    source_digest: authority.sourceDigest
  };
}

export function mintLauncherAgentSessionContract({
  authority,
  repositoryId,
  lifecyclePosition,
  reviewPurpose = null,
  capabilities,
  capabilityRegistryDigest,
  completionTransport,
  trustedSourceBindings = null,
  operatorActionBinding = null,
  issuer = "agent-chassis-launcher"
} = {}) {
  assertTrustedStdioMcpConduitAuthority(authority);
  const role = authority.role;
  if (!SESSION_ROLE_SET.has(role)) refuse("session contract role is unsupported");
  if (typeof repositoryId !== "string" || !/^[^/\s]+\/[^/\s]+$/u.test(repositoryId)) {
    refuse("session contract repository identity must be repo-qualified");
  }
  if (typeof lifecyclePosition !== "string" || lifecyclePosition.length === 0) {
    refuse("session contract lifecycle position is missing");
  }
  const findingsRole = role === "reviewer" || role === "redteam";
  if ((findingsRole && !SESSION_REVIEW_PURPOSES.has(reviewPurpose)) ||
      (!findingsRole && reviewPurpose !== null)) {
    refuse("session contract review purpose violates role nullability");
  }
  if (!SESSION_TRANSPORT_SET.has(completionTransport) ||
      completionTransport !== expectedTransport(role, reviewPurpose)) {
    refuse("session contract completion transport contradicts role and lifecycle", {
      refusal_code: LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.COMPLETION_TRANSPORT_MISMATCH
    });
  }
  if (!SHA256_PATTERN.test(capabilityRegistryDigest ?? "")) {
    refuse("session contract capability registry digest is invalid");
  }
  const normalizedCapabilities = canonicalStringArray("session contract capabilities", capabilities);
  const authorityDigest = digestPlainObject(authorityDigestProjection(authority));
  const sources = normalizeTrustedSourceBindings(trustedSourceBindings ?? [{
    kind: "stdio_mcp_conduit_authority",
    id: authority.schemaVersion,
    digest: authorityDigest
  }]);
  const carrier = {
    schema_version: LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION,
    role,
    assigned_unit: parseAssignedUnit(authority.assignedUnit, role),
    repository: Object.freeze({ repository_id: repositoryId }),
    read_scope: canonicalStringArray("session contract read scope", authority.readScope, { scope: true }),
    repo_paths: canonicalStringArray("session contract repo paths", authority.repoPaths ?? [], { scope: true }),
    write_scope: canonicalStringArray("session contract write scope", authority.writeScope, { scope: true }),
    lifecycle: Object.freeze({ position: lifecyclePosition, review_purpose: reviewPurpose }),
    capabilities: normalizedCapabilities,
    completion_transport: Object.freeze({ transport_id: completionTransport }),
    minting_provenance: Object.freeze({
      issuer,
      authority_schema_version: authority.schemaVersion,
      authority_digest: authorityDigest,
      capability_registry_digest: capabilityRegistryDigest,
      trusted_source_bindings: sources,
      operator_action_binding: normalizeOperatorActionBinding(operatorActionBinding)
    })
  };
  const contract = Object.freeze({
    ...carrier,
    contract_digest: digestLauncherAgentSessionContract(carrier)
  });
  SESSION_CONTRACTS.add(contract);
  const capture = SESSION_CONTRACT_CAPTURE.getStore();
  if (capture !== undefined) {
    if (capture.contract === null) {
      capture.contract = contract;
    } else if (!canonicalSerializeLauncherAgentSessionContract(capture.contract)
      .equals(canonicalSerializeLauncherAgentSessionContract(contract))) {
      refuse("one launcher execution minted contradictory session contracts", {
        refusal_code: LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.FACT_MISMATCH
      });
    }
  }
  return contract;
}

export async function captureLauncherAgentSessionContract(operation) {
  if (typeof operation !== "function") {
    throw new TypeError("session contract capture requires an operation");
  }
  const capture = { contract: null };
  const result = await SESSION_CONTRACT_CAPTURE.run(capture, operation);
  return Object.freeze({ result, sessionContract: capture.contract });
}

export function isLauncherMintedAgentSessionContract(value) {
  return isPlainObject(value) && SESSION_CONTRACTS.has(value);
}

export const STDIO_MCP_FROZEN_REVIEW_CONTRACT_PATH_CLASS =
  "launcher-private-frozen-review-contract";

export const STDIO_MCP_CONDUIT_AUTHORITY_MODES = Object.freeze({
  ASSIGNED: "assigned",
  READ_ONLY: "read_only",
  COORDINATION: "coordination"
});

const ORCHESTRATOR_PROFILE = Object.freeze({
  source: "launcher-orchestrator-profile",
  readScope: Object.freeze(["."]),
  writeScope: Object.freeze(["docs", "wiki"])
});

const TRUSTED_AUTHORITIES = new WeakSet();
const TRUSTED_FROZEN_REVIEW_SNAPSHOTS = new WeakMap();
const TRUSTED_SESSION_CONTRACTS = new WeakMap();
const TRUSTED_SESSION_CONTRACT_FACTS = new WeakMap();

function refuse(message, detail = null) {
  fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID, message, detail);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null);
}

function normalizeScopeArray(label, value) {
  if (value === null || value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    refuse(`${label} must be an array of repository-relative scope entries`);
  }
  const entries = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) {
      refuse(`${label} contains a non-string or empty scope entry`);
    }
    if (entry.includes("\0")) {
      refuse(`${label} contains a scope entry with an embedded NUL`);
    }
    if (path.isAbsolute(entry)) {
      refuse(`${label} contains an absolute scope entry`, { entry });
    }
    const segments = entry.split("/");
    if (segments.includes("..")) {
      refuse(`${label} contains a scope entry that escapes the repository`, { entry });
    }
    entries.push(entry);
  }
  return Object.freeze([...new Set(entries)].sort());
}

function sameScope(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

export function mintTrustedManagedFindingsFrozenReviewBinding({
  role,
  assignedUnit,
  findingsLifecycleContext,
  launchRef,
  runId,
  retryId = 0
} = {}) {
  const conduitRole = normalizeStdioMcpConduitRole(role);
  const lifecycle = consumeLauncherFindingsLifecycleContext(findingsLifecycleContext, {
    required: true,
    selectedUnit: assignedUnit,
    subject: assignedUnit
  });
  if (!lifecycle.ok) {
    refuse("managed findings lifecycle context is missing or subject-mismatched", {
      reason: lifecycle.reason ?? null,
      detail: lifecycle.detail ?? null
    });
  }
  const trustedFrozenReviewContract = lifecycle.context.trusted_frozen_review_contract;
  if (!isTrustedFrozenReviewContract(trustedFrozenReviewContract) ||
      trustedFrozenReviewContract.review_subject !== assignedUnit) {
    refuse("managed findings frozen contract authority is missing or subject-mismatched", {
      reason: "trusted_advisory_review_presentation_unavailable"
    });
  }
  const retry = String(retryId);
  if (typeof launchRef !== "string" || launchRef.length === 0 ||
      typeof runId !== "string" || runId.length === 0 ||
      !/^(0|[1-9]\d*)$/u.test(retry) || !Number.isSafeInteger(Number(retry))) {
    refuse("managed findings requires its exact launcher run credential tuple");
  }
  const snapshot = createFrozenReviewContractSnapshot(trustedFrozenReviewContract);
  const credential = Object.freeze({
    launch_ref: launchRef,
    run_id: runId,
    retry_id: retry
  });
  return Object.freeze({
    binding: Object.freeze({
      snapshot,
      subject: assignedUnit,
      role: conduitRole,
      schema_version: snapshot.schema_version,
      digest: snapshot.digest,
      path_class: STDIO_MCP_FROZEN_REVIEW_CONTRACT_PATH_CLASS,
      materialization_root: lifecycle.context.review_materialization_root,
      credential
    }),
    commitTuple: Object.freeze({ launchRef, runId, retryId: Number(retry) })
  });
}

function requireFrozenReviewBinding(binding, { assignedUnit, conduitRole, crossRunIdentity }) {
  if (binding === null || binding === undefined) {
    return null;
  }
  if (!isPlainObject(binding)) {
    refuse("a managed reviewer conduit requires its launcher-minted frozen review contract binding");
  }

  const snapshot = binding.snapshot ?? null;
  if (!isPlainObject(snapshot) || !Object.isFrozen(snapshot)) {
    refuse("frozen review contract binding requires the integrated launcher snapshot");
  }
  if (snapshot.schema_version !== FROZEN_REVIEW_CONTRACT_SNAPSHOT_SCHEMA_VERSION) {
    refuse("frozen review contract binding has an unsupported snapshot schema");
  }
  if (!(snapshot.bytes instanceof Uint8Array) || snapshot.bytes.byteLength !== snapshot.byte_length ||
      typeof snapshot.digest !== "string") {
    refuse("frozen review contract binding has malformed snapshot bytes or digest");
  }
  const calculatedDigest = digestFrozenReviewContractSnapshot(snapshot.bytes);
  if (snapshot.digest !== calculatedDigest) {
    refuse("frozen review contract snapshot digest does not match its bytes");
  }

  const contract = snapshot.trusted_frozen_review_contract;
  if (!isTrustedFrozenReviewContract(contract)) {
    refuse("frozen review contract binding requires the trusted snapshot contract");
  }
  const expectedBytes = serializeTrustedFrozenReviewContract(contract);
  if (snapshot.byte_length !== expectedBytes.byteLength ||
      snapshot.bytes.length !== expectedBytes.length ||
      !snapshot.bytes.every((byte, index) => byte === expectedBytes[index])) {
    refuse("frozen review contract snapshot bytes do not serialize its trusted contract");
  }
  const subject = contract.review_subject;
  const reviewRole = contract.role ?? contract.intended_agent_role ?? "reviewer";
  if (subject !== assignedUnit) {
    refuse("frozen review contract subject does not match the assigned unit", {
      canonical: subject, requested: assignedUnit
    });
  }
  if (reviewRole !== conduitRole) {
    refuse("frozen review contract is not bound to the conduit role", {
      canonical: reviewRole,
      requested: conduitRole
    });
  }
  if (binding.subject !== subject) {
    refuse("frozen review contract binding subject does not match its snapshot");
  }
  if (binding.role !== reviewRole) {
    refuse("frozen review contract binding role does not match the findings role");
  }
  if (binding.schema_version !== snapshot.schema_version) {
    refuse("frozen review contract binding schema does not match its snapshot");
  }
  if (binding.digest !== snapshot.digest) {
    refuse("frozen review contract binding digest does not match its snapshot");
  }
  if (binding.path_class !== STDIO_MCP_FROZEN_REVIEW_CONTRACT_PATH_CLASS) {
    refuse("frozen review contract binding has an invalid private path class");
  }
  if (typeof binding.materialization_root !== "string" ||
      !path.isAbsolute(binding.materialization_root)) {
    refuse("frozen review contract binding has no action-private materialization root");
  }
  if (!isPlainObject(binding.credential) || !Object.isFrozen(binding.credential) ||
      Object.keys(binding.credential).sort().join("\0") !== "launch_ref\0retry_id\0run_id") {
    refuse("frozen review contract binding requires its exact launcher credential tuple");
  }
  if (crossRunIdentity === null ||
      Object.keys(crossRunIdentity).sort().join("\0") !== "launch_ref\0retry_id\0run_id" ||
      !Object.isFrozen(crossRunIdentity) ||
      !["launch_ref", "run_id", "retry_id"].every((field) =>
        typeof crossRunIdentity[field] === "string" && crossRunIdentity[field].length > 0) ||
      !["launch_ref", "run_id", "retry_id"].every((field) =>
        binding.credential[field] === crossRunIdentity[field])) {
    refuse("frozen review contract binding credential does not match the launcher identity");
  }
  return Object.freeze({
    subject,
    role: reviewRole,
    schemaVersion: snapshot.schema_version,
    digest: snapshot.digest,
    pathClass: STDIO_MCP_FROZEN_REVIEW_CONTRACT_PATH_CLASS,
    materializationRoot: path.resolve(binding.materialization_root),
    credential: Object.freeze({ ...binding.credential })
  });
}

function freezeIdentityValue(value, label, depth = 0) {
  if (depth > 12) refuse(`${label} is too deeply nested`);
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => freezeIdentityValue(entry, label, depth + 1)));
  }
  if (!isPlainObject(value)) {
    refuse(`${label} must be launcher-resolved plain data`);
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (!/^[A-Za-z0-9_]+$/u.test(key)) {
      refuse(`${label} contains an invalid field`, { field: key });
    }
    result[key] = freezeIdentityValue(value[key], label, depth + 1);
  }
  return Object.freeze(result);
}

function provisionedUnitMatches(provisionedUnit, assignedUnit) {
  return provisionedUnit.endsWith(`/${assignedUnit.replace("#", "/")}`);
}

function allNull(identity) {
  return identity !== null &&
    Object.values(identity).every((value) => value === null);
}

function resolveCrossRunIdentity({ sliceBinding, commitTuple }) {
  const fromBinding = sliceBinding === null
    ? null
    : {
        launch_ref: typeof sliceBinding.launch_ref === "string" ? sliceBinding.launch_ref : null,
        run_id: typeof sliceBinding.run_id === "string" ? sliceBinding.run_id : null,
        retry_id: sliceBinding.retry_id === undefined || sliceBinding.retry_id === null
          ? null
          : String(sliceBinding.retry_id)
      };
  const fromCommit = commitTuple === null || commitTuple === undefined
    ? null
    : {
        launch_ref: typeof commitTuple.launchRef === "string" ? commitTuple.launchRef : null,
        run_id: typeof commitTuple.runId === "string" ? commitTuple.runId : null,
        retry_id: commitTuple.retryId === undefined || commitTuple.retryId === null
          ? null
          : String(commitTuple.retryId)
      };
  if (fromBinding === null || allNull(fromBinding)) {
    return fromCommit === null || allNull(fromCommit) ? null : Object.freeze(fromCommit);
  }
  if (fromCommit === null || allNull(fromCommit)) return Object.freeze(fromBinding);

  for (const field of ["launch_ref", "run_id", "retry_id"]) {
    if (fromBinding[field] !== null && fromCommit[field] !== null &&
        fromBinding[field] !== fromCommit[field]) {
      refuse("worktree identity and commit tuple disagree on the run identity", {
        field,
        worktree_identity: fromBinding[field],
        commit_tuple: fromCommit[field]
      });
    }
  }
  return Object.freeze({
    launch_ref: fromBinding.launch_ref ?? fromCommit.launch_ref,
    run_id: fromBinding.run_id ?? fromCommit.run_id,
    retry_id: fromBinding.retry_id ?? fromCommit.retry_id
  });
}

export function mintTrustedStdioMcpConduitAuthority({
  family,
  role,
  assignedUnit,
  workspaceDir,
  workerScopeAuthority = null,
  canonicalWriteScope = null,
  provisioning = null,
  commitTuple = null,
  frozenReviewContractBinding = null
} = {}) {
  const conduitRole = normalizeStdioMcpConduitRole(role);
  if (!STDIO_MCP_CONDUIT_ALLOWED_FAMILIES.has(family)) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.FAMILY_UNSUPPORTED,
      "conduit authority supports only the Claude and Codex families", { family });
  }
  if (!STDIO_MCP_CONDUIT_ALLOWED_ROLES.has(conduitRole)) {
    refuse("conduit authority requires a launcher-derived role", { role: String(role) });
  }
  if (typeof assignedUnit !== "string" || assignedUnit.length === 0) {
    refuse("conduit authority requires a launcher-resolved assigned unit");
  }
  if (typeof workspaceDir !== "string" || !path.isAbsolute(workspaceDir)) {
    refuse("conduit authority requires an absolute launcher-resolved workspace");
  }
  const workspace = path.resolve(workspaceDir);

  if (provisioning !== null && provisioning !== undefined && !isPlainObject(provisioning)) {
    refuse("managed worktree provisioning carrier is malformed");
  }
  const carrier = provisioning ?? null;
  const provisionedUnit = typeof carrier?.unit_address === "string" ? carrier.unit_address : null;
  if (provisionedUnit !== null && !provisionedUnitMatches(provisionedUnit, assignedUnit)) {
    refuse("assigned unit does not match the managed provisioning unit binding", {
      canonical: provisionedUnit,
      requested: assignedUnit
    });
  }
  if (carrier !== null && typeof carrier.main_repo === "string" &&
      path.resolve(carrier.main_repo) !== workspace) {
    refuse("conduit workspace does not match the managed provisioning main repo", {
      canonical: carrier.main_repo,
      requested: workspace
    });
  }

  const sliceBinding = carrier?.slice_binding ?? null;
  if (sliceBinding !== null && !isPlainObject(sliceBinding)) {
    refuse("managed provisioning carries a malformed worktree identity");
  }
  const worktreeIdentity = sliceBinding === null
    ? Object.freeze({ kind: "launcher-workspace", workspace_dir: workspace })
    : freezeIdentityValue(sliceBinding, "worktree identity");
  if (sliceBinding !== null) {
    const boundUnit = typeof worktreeIdentity.unit_address === "string"
      ? worktreeIdentity.unit_address
      : null;
    if (boundUnit !== null && !provisionedUnitMatches(boundUnit, assignedUnit)) {
      refuse("worktree identity is bound to a different unit than the assigned unit", {
        canonical: boundUnit,
        requested: assignedUnit
      });
    }
  }

  let mode;
  let source;
  let readScope;
  let repoPaths;
  let writeScope;
  let unitAddress = null;
  let sourceDigest = null;

  if (conduitRole === "worker" && !isPlainObject(workerScopeAuthority)) {

    if (carrier !== null) {
      refuse("a managed worker conduit requires its launcher-minted frozen scope authority");
    }

    if (canonicalWriteScope === null || canonicalWriteScope === undefined) {
      refuse("a confined worker conduit requires a launcher-resolved write-scope carrier");
    }
    mode = STDIO_MCP_CONDUIT_AUTHORITY_MODES.ASSIGNED;
    source = "launcher-canonical-write-scope";
    readScope = Object.freeze([]);
    repoPaths = Object.freeze([]);
    writeScope = normalizeScopeArray("write scope", canonicalWriteScope);
  } else if (conduitRole === "worker") {
    const selectedAddress = typeof workerScopeAuthority.selected_unit?.address === "string"
      ? workerScopeAuthority.selected_unit.address
      : null;
    if (selectedAddress !== null && selectedAddress !== assignedUnit) {
      refuse("assigned unit does not match the frozen scope-authority selected unit", {
        canonical: selectedAddress,
        requested: assignedUnit
      });
    }
    readScope = normalizeScopeArray("read scope", workerScopeAuthority.read_scope ?? []);
    repoPaths = normalizeScopeArray("repo paths", workerScopeAuthority.repo_paths ?? []);
    writeScope = normalizeScopeArray("write scope", workerScopeAuthority.write_scope);

    if (carrier !== null && carrier.write_scope !== undefined && carrier.write_scope !== null) {
      const provisionedWriteScope = normalizeScopeArray(
        "provisioned write scope", carrier.write_scope);
      if (!sameScope(writeScope, provisionedWriteScope)) {
        refuse("frozen scope authority and managed provisioning disagree on the write scope", {
          scope_authority_write_scope: [...writeScope],
          provisioning_write_scope: [...provisionedWriteScope]
        });
      }
    }
    mode = STDIO_MCP_CONDUIT_AUTHORITY_MODES.ASSIGNED;
    source = "launcher-frozen-scope-authority";
    unitAddress = typeof workerScopeAuthority.unit_address === "string"
      ? workerScopeAuthority.unit_address
      : null;
    sourceDigest = typeof workerScopeAuthority.source_digest === "string"
      ? workerScopeAuthority.source_digest
      : null;
  } else if (conduitRole === "orchestrator") {
    mode = STDIO_MCP_CONDUIT_AUTHORITY_MODES.COORDINATION;
    source = ORCHESTRATOR_PROFILE.source;
    readScope = ORCHESTRATOR_PROFILE.readScope;
    repoPaths = Object.freeze([]);
    writeScope = ORCHESTRATOR_PROFILE.writeScope;
  } else {

    if (workerScopeAuthority !== null && workerScopeAuthority !== undefined) {
      refuse("a findings-only conduit role must not carry a worker scope authority",
        { role: conduitRole });
    }
    if (canonicalWriteScope !== null && canonicalWriteScope !== undefined) {
      refuse("a findings-only conduit role must not carry a write-scope carrier",
        { role: conduitRole });
    }
    mode = STDIO_MCP_CONDUIT_AUTHORITY_MODES.READ_ONLY;
    source = "launcher-role-policy";
    readScope = Object.freeze([]);
    repoPaths = Object.freeze([]);
    writeScope = Object.freeze([]);
  }
  if (mode !== STDIO_MCP_CONDUIT_AUTHORITY_MODES.ASSIGNED && writeScope.length > 0 &&
      conduitRole !== "orchestrator") {
    refuse("only an assigned-mode conduit authority may carry a write scope");
  }

  const crossRunIdentity = resolveCrossRunIdentity({ sliceBinding: worktreeIdentity, commitTuple });
  const frozenReviewContract = requireFrozenReviewBinding(
    frozenReviewContractBinding, { assignedUnit, conduitRole, crossRunIdentity });
  const authority = Object.freeze({
    schemaVersion: STDIO_MCP_CONDUIT_AUTHORITY_SCHEMA_VERSION,
    family,
    role: conduitRole,
    assignedUnit,
    workspaceDir: workspace,
    mode,
    source,
    unitAddress,
    sourceDigest,
    readScope,
    repoPaths,
    writeScope,
    worktreeIdentity,
    crossRunIdentity,
    frozenReviewContract,
    reviewMaterializationDir: frozenReviewContract?.materializationRoot ?? null
  });
  TRUSTED_AUTHORITIES.add(authority);
  if (frozenReviewContract !== null) {
    TRUSTED_FROZEN_REVIEW_SNAPSHOTS.set(authority, frozenReviewContractBinding.snapshot);
  }
  return authority;
}

export function assertTrustedStdioMcpConduitAuthority(authority, expected = {}) {
  if (!authority || typeof authority !== "object" || !Object.isFrozen(authority) ||
      !TRUSTED_AUTHORITIES.has(authority) ||
      authority.schemaVersion !== STDIO_MCP_CONDUIT_AUTHORITY_SCHEMA_VERSION) {
    refuse("stdio MCP conduit requires one launcher-minted trusted authority object");
  }
  const checks = [
    ["family", expected.family],
    ["role", expected.role],
    ["assignedUnit", expected.assignedUnit]
  ];
  for (const [field, value] of checks) {
    if (value !== undefined && value !== null && authority[field] !== value) {
      refuse("stdio MCP conduit authority was minted for a different launch", {
        field, authority: authority[field], launch: value
      });
    }
  }
  if (typeof expected.workspaceDir === "string" && expected.workspaceDir.length > 0 &&
      authority.workspaceDir !== path.resolve(expected.workspaceDir)) {
    refuse("stdio MCP conduit authority was minted for a different workspace", {
      field: "workspaceDir",
      authority: authority.workspaceDir,
      launch: path.resolve(expected.workspaceDir)
    });
  }
  if (expected.frozenReviewContractBinding !== undefined) {
    const expectedBinding = requireFrozenReviewBinding(expected.frozenReviewContractBinding, {
      assignedUnit: authority.assignedUnit,
      conduitRole: authority.role,
      crossRunIdentity: authority.crossRunIdentity
    });
    if (JSON.stringify(expectedBinding) !== JSON.stringify(authority.frozenReviewContract)) {
      refuse("stdio MCP conduit frozen review contract authority was minted for a different launch");
    }
  }
  return authority;
}

export function isTrustedStdioMcpConduitAuthority(value) {
  return typeof value === "object" && value !== null && TRUSTED_AUTHORITIES.has(value);
}

const ROLE_CAPABILITIES = Object.freeze({
  orchestrator: Object.freeze(["workspace_agent_dispatch", "workspace_agent_status",
    "workspace_tools_describe", "workspace_tools_list", "workspace_tools_query"]),
  worker: Object.freeze(["workspace_commit_slice"]),
  reviewer: Object.freeze(["workspace_submit_for_review"]),
  redteam: Object.freeze(["workspace_submit_for_review"])
});

function defaultSessionContractFacts(authority) {
  const reviewPurpose = authority.role === "reviewer" || authority.role === "redteam"
    ? (authority.assignedUnit.includes("#") ? "standalone" : "terminal_whole_wk")
    : null;
  const capabilities = ROLE_CAPABILITIES[authority.role];
  return Object.freeze({
    authority,
    repositoryId: "agent-chassis/agent-chassis",
    lifecyclePosition: authority.role === "orchestrator"
      ? "coordination"
      : authority.role === "worker" ? "implementation" : "findings_only",
    reviewPurpose,
    capabilities,
    capabilityRegistryDigest: digestPlainObject({ capabilities }),
    completionTransport: expectedTransport(authority.role, reviewPurpose),
    trustedSourceBindings: null,
    operatorActionBinding: null
  });
}

export function resolveLauncherAgentSessionContract(authority) {
  assertTrustedStdioMcpConduitAuthority(authority);
  let contract = TRUSTED_SESSION_CONTRACTS.get(authority);
  if (contract) return contract;
  const facts = defaultSessionContractFacts(authority);
  contract = mintLauncherAgentSessionContract(facts);
  TRUSTED_SESSION_CONTRACT_FACTS.set(authority, facts);
  TRUSTED_SESSION_CONTRACTS.set(authority, contract);
  return contract;
}

export function resolveLauncherAgentSessionContractFacts(authority) {
  resolveLauncherAgentSessionContract(authority);
  return TRUSTED_SESSION_CONTRACT_FACTS.get(authority);
}

export function resolveTrustedStdioMcpFrozenReviewContractSnapshot(authority) {
  assertTrustedStdioMcpConduitAuthority(authority);
  return TRUSTED_FROZEN_REVIEW_SNAPSHOTS.get(authority) ?? null;
}
