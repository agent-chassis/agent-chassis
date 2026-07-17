

import {
  WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_WAIT_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION,
  BACKEND_ACCEPTED_ROLES,
  validateLauncherFamilyRole,
  normalizeDispatchModelHint,
  BACKEND_SUPPORTED_APPS,
  BACKEND_FAMILY_UNAVAILABLE_REASONS,
  BACKEND_RUN_STATUSES,
  BACKEND_REFUSAL_CODES,
  BACKEND_MISSING_RESULT_CODES,
  BACKEND_FINAL_RESULT_KINDS,
  BACKEND_WRITEBACK_KINDS,
  normalizeFinalResult
} from "@agent-chassis/agent-launch-core";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export {
  WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_WAIT_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION,
  BACKEND_ACCEPTED_ROLES,
  validateLauncherFamilyRole,
  normalizeDispatchModelHint,
  BACKEND_SUPPORTED_APPS,
  BACKEND_FAMILY_UNAVAILABLE_REASONS,
  BACKEND_RUN_STATUSES,
  BACKEND_REFUSAL_CODES,
  BACKEND_MISSING_RESULT_CODES,
  BACKEND_FINAL_RESULT_KINDS,
  BACKEND_WRITEBACK_KINDS,
  normalizeFinalResult
};

export {
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_UNAVAILABLE_REASON
} from "./host-write-authority-substrate.mjs";

import { HOST_WRITE_AUTHORITY_FORBIDDEN_TOKENS } from "./host-write-authority-substrate.mjs";
import {
  computeWorkRecordSourceDigest
} from "@agent-chassis/wiki-core";
import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import {
  defaultRunIdFactory,
  defaultMonitorHandleFactory
} from "./workspace-agent-dispatch-refusal.mjs";

import { createDispatchRunLifecycle } from "./workspace-agent-dispatch-run-lifecycle.mjs";
import { AGENT_LAUNCH_ROLE_CONFIG_FILENAME } from "./agent-launch-role-config.mjs";
import {
  assertCompleteManagedProvisioningResult,
  assertStructuralManagedProvisioningResult,
  MANAGED_WORKTREE_BINDING_SCHEMA_VERSION,
  provisionManagedWorktreesAtDispatch,
  WORKTREE_PROVISIONING_DISPATCH_SCHEMA_VERSION
} from "./worktree-provisioning-dispatch.mjs";
import {
  AGENT_CHILD_TOOL_SURFACE_SCHEMA_VERSION
} from "./agent-child-tool-surface.mjs";
import {
  allocateSparseExactUnitWorktree,
  defaultRunGit,
  perWkBranchRef,
  resolveVerifiedSparseExactUnitBinding,
  sliceBranchRef
} from "./worktree-substrate.mjs";
import {
  resolveUniqueManagedLifecycleBindingPairForRecovery
} from "./worktree-substrate-identity.mjs";
import {
  FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION
} from "./workspace-agent-findings-role-context.mjs";

export const BACKEND_FORBIDDEN_ENVELOPE_TOKENS = HOST_WRITE_AUTHORITY_FORBIDDEN_TOKENS;

const WK_SUBJECT_RE = /^(WK-\d{4})(?:#[A-Za-z0-9._-]+)?$/;
const EXACT_IMPLEMENTATION_SLICE_RE = /^(WK-\d{4})#(SLICE-\d{3})$/;

export const WORKSPACE_AGENT_FROZEN_SCOPE_AUTHORITY_SCHEMA_VERSION =
  "workspace-agent-frozen-scope-authority.v1";
const WORKSPACE_AGENT_LAUNCH_CORE_SCHEMA_VERSION = "workspace-agent-launch-core.v1";
export const MANAGED_WORKER_CONFINEMENT_ACTIVATION_SCHEMA_VERSION =
  "managed-worker-confinement-activation.v1";
export const MANAGED_WORKER_ATTEMPT_STATE_SCHEMA_VERSION =
  "managed-worker-attempt-state.v1";
export const WORKER_READ_BOUNDARY_UNSUPPORTED_BLOCKER =
  "worker_read_boundary_unsupported";
const WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER = "worker_scope_authority_invalid";
const SUPPORTED_WORKER_READ_BOUNDARY_FAMILIES = Object.freeze(["codex"]);
const SUPPORTED_WORKER_READ_BOUNDARY_BACKENDS = Object.freeze(["bwrap"]);
const CALLER_SCOPE_CARRIERS = Object.freeze([
  "readScope", "read_scope", "repoPaths", "repo_paths", "writeScope", "write_scope",
  "readableScope", "readable_scope", "selectedUnit", "selected_unit", "sourceDigest",
  "source_digest", "sourceVersion", "source_version", "workerScopeAuthority",
  "worker_scope_authority"
]);
const CALLER_MANAGED_LIFECYCLE_CARRIERS = Object.freeze([
  "retryId", "retry_id", "priorIdentity", "prior_identity", "livenessDeps",
  "liveness_deps", "attemptState", "attempt_state", "resolveAttemptState",
  "resolve_attempt_state", "mainRepo", "main_repo", "worktreeRoot",
  "worktree_root", "sharedDependencyRoot", "shared_dependency_root",
  "cacheRoot", "cache_root", "confinementAvailable", "confinement_available",
  "managedConfinementActivation", "managed_confinement_activation", "env", "argv",
  "claimedIdentity", "claimed_identity"
]);
const CALLER_REVIEW_CONTEXT_CARRIERS = Object.freeze([
  "ref", "sha", "wkRef", "wk_ref", "wkSha", "wk_sha", "worktreePath",
  "worktree_path", "diffRange", "diff_range", "diffBaseSha", "diff_base_sha",
  "diffHeadSha", "diff_head_sha", "reviewContext", "review_context",
  "frozenReviewContext", "frozen_review_context", "prompt", "request", "env",
  "argv", "claimedIdentity", "claimed_identity", "trustedFrozenReviewContract",
  "trusted_frozen_review_contract", "canonicalParentWkContract",
  "canonical_parent_wk_contract", "reviewUnitContract", "review_unit_contract",
  "reviewerLaunchIdentity", "reviewer_launch_identity",
  "acceptanceCriteria", "acceptance_criteria", "acceptanceValidation", "acceptance_validation"
]);
const CONFIG_ATTEMPT_STATE_CARRIERS = Object.freeze([
  "resolveAttemptState", "resolveProvisioningAttemptState", "getAttemptState",
  "getProvisioningAttemptState", "attemptState", "attempt_state", "retryId",
  "retry_id", "priorIdentity", "prior_identity", "livenessDeps", "liveness_deps"
]);
const REMOVED_MANAGED_PROVISIONING_ROOT_FIELDS = Object.freeze([
  "sharedDependencyRoot", "shared_dependency_root", "cacheRoot", "cache_root"
]);

const EXPECTED_MANAGED_CONFINEMENT_ACTIVATION = Object.freeze({
  schema_version: MANAGED_WORKER_CONFINEMENT_ACTIVATION_SCHEMA_VERSION,
  available: true,
  family: "codex",
  backend: "bwrap",
  frozen_scope_authority_schema_version: WORKSPACE_AGENT_FROZEN_SCOPE_AUTHORITY_SCHEMA_VERSION,
  launch_core_schema_version: WORKSPACE_AGENT_LAUNCH_CORE_SCHEMA_VERSION,
  child_tool_surface_schema_version: AGENT_CHILD_TOOL_SURFACE_SCHEMA_VERSION,
  provisioning_dispatch_schema_version: WORKTREE_PROVISIONING_DISPATCH_SCHEMA_VERSION,
  managed_worktree_binding_schema_version: MANAGED_WORKTREE_BINDING_SCHEMA_VERSION,
  exact_unit_binding: "WK-1518",
  managed_provisioning_binding: "WK-1469"
});

const EXPECTED_CLOSED_INPUT_COMMIT_COMPOSITION = Object.freeze({
  schema_version: "workspace-closed-input-commit-composition.v1",
  installed: true,
  tool_name: "commit",
  input_contract: "closed",
  binding_authority: "server_resolved"
});

const FROZEN_REVIEW_CONTEXT_STATES = Object.freeze({
  AVAILABLE: "available",
  RESERVED: "reserved",
  CONSUMED: "consumed"
});
const RETAINED_REVIEWER_LAUNCH_IDENTITY_FIELDS = Object.freeze([
  "diff_head_sha",
  "initiative",
  "main_repo",
  "record_id",
  "review_slice_id",
  "review_subject",
  "trusted_frozen_review_contract",
  "wk_ref",
  "wk_sha",
  "worktree_path"
]);
const FROZEN_REVIEW_CONTRACT_IDENTITY_FIELDS = Object.freeze([
  "canonical_parent_wk_contract",
  "review_subject",
  "review_unit_contract",
  "schema_version"
]);

export function createManagedWorkerConfinementActivationBinding() {
  return Object.freeze({ ...EXPECTED_MANAGED_CONFINEMENT_ACTIVATION });
}

function hasExactManagedConfinementActivation(binding) {
  if (!isPlainObject(binding)) return false;
  const actualKeys = Object.keys(binding).sort();
  const expectedKeys = Object.keys(EXPECTED_MANAGED_CONFINEMENT_ACTIVATION).sort();
  return sameStringArray(actualKeys, expectedKeys) && expectedKeys.every(
    (field) => binding[field] === EXPECTED_MANAGED_CONFINEMENT_ACTIVATION[field]
  );
}

function hasExactClosedInputCommitComposition(binding) {
  if (!isPlainObject(binding) || !Object.isFrozen(binding)) return false;
  const actualKeys = Object.keys(binding).sort();
  const expectedKeys = Object.keys(EXPECTED_CLOSED_INPUT_COMMIT_COMPOSITION).sort();
  return sameStringArray(actualKeys, expectedKeys) && expectedKeys.every(
    (field) => binding[field] === EXPECTED_CLOSED_INPUT_COMMIT_COMPOSITION[field]
  );
}

function hasManagedConfinementActivation(config) {
  if (!isPlainObject(config)) return false;
  const explicit = config.managedConfinementActivation
    ?? config.managed_confinement_activation
    ?? null;
  if (explicit !== null) return hasExactManagedConfinementActivation(explicit);

  return config.confinementAvailable === true;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createRetainedReviewerLaunchIdentity(context) {
  return Object.freeze({
    main_repo: context.main_repo,
    review_subject: context.review_subject,
    record_id: context.record_id,
    review_slice_id: context.review_slice_id,
    initiative: context.initiative,
    wk_ref: context.wk_ref,
    worktree_path: context.worktree_path,
    wk_sha: context.wk_sha,
    diff_head_sha: context.diff_head_sha,
    trusted_frozen_review_contract: context.trusted_frozen_review_contract
  });
}

function createTrustedFrozenReviewContract(reviewUnit) {
  return Object.freeze({
    schema_version: FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
    review_subject: reviewUnit.subject,
    canonical_parent_wk_contract: reviewUnit.canonical_parent_wk_contract,
    review_unit_contract: reviewUnit.review_unit_contract
  });
}

function isStructurallyCompleteRetainedReviewerLaunchIdentity(identity) {
  if (!isPlainObject(identity) || !Object.isFrozen(identity) ||
      !sameStringArray(Object.keys(identity).sort(), RETAINED_REVIEWER_LAUNCH_IDENTITY_FIELDS)) {
    return false;
  }
  const contract = identity.trusted_frozen_review_contract;
  return typeof identity.main_repo === "string" && path.isAbsolute(identity.main_repo) &&
    typeof identity.review_subject === "string" && /^WK-\d{4}#SLICE-\d{3}$/u.test(identity.review_subject) &&
    typeof identity.record_id === "string" && /^WK-\d{4}$/u.test(identity.record_id) &&
    typeof identity.review_slice_id === "string" && /^SLICE-\d{3}$/u.test(identity.review_slice_id) &&
    typeof identity.initiative === "string" && /^IN-\d{4}$/u.test(identity.initiative) &&
    typeof identity.wk_ref === "string" && /^refs\/heads\/wk\/IN-\d{4}\/WK-\d{4}$/u.test(identity.wk_ref) &&
    typeof identity.worktree_path === "string" && path.isAbsolute(identity.worktree_path) &&
    typeof identity.wk_sha === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(identity.wk_sha) &&
    typeof identity.diff_head_sha === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(identity.diff_head_sha) &&
    isPlainObject(contract) && Object.isFrozen(contract) &&
    sameStringArray(Object.keys(contract).sort(), FROZEN_REVIEW_CONTRACT_IDENTITY_FIELDS) &&
    contract.schema_version === FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION &&
    typeof contract.review_subject === "string" &&
    typeof contract.canonical_parent_wk_contract === "string" &&
    typeof contract.review_unit_contract === "string";
}

function assertRetainedReviewerLaunchIdentityMatchesContext(identity, context) {
  if (!isStructurallyCompleteRetainedReviewerLaunchIdentity(identity)) {
    throw new Error("consumed frozen whole-WK review context has no structurally complete retained reviewer launch identity");
  }
  const expected = createRetainedReviewerLaunchIdentity(context);
  const flatFields = RETAINED_REVIEWER_LAUNCH_IDENTITY_FIELDS.filter(
    (field) => field !== "trusted_frozen_review_contract"
  );
  if (flatFields.some((field) => identity[field] !== expected[field]) ||
      FROZEN_REVIEW_CONTRACT_IDENTITY_FIELDS.some(
        (field) => identity.trusted_frozen_review_contract[field] !==
          expected.trusted_frozen_review_contract[field]
      )) {
    throw new Error("retained reviewer launch identity does not match the consumed frozen whole-WK review context");
  }
}

function scopeAuthorityRefusal(blocker, detail = null) {
  return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, { blocker, ...detail });
}

function firstOwnField(source, fields) {
  if (!isPlainObject(source)) return null;
  return fields.find((field) => Object.prototype.hasOwnProperty.call(source, field)) ?? null;
}

function normalizeCanonicalScope(entries, label, recordPath, { required = true } = {}) {
  if (!Array.isArray(entries)) {
    if (!required && entries === undefined) return Object.freeze([]);
    throw new Error(`${label} for the exact selected unit must be an array in ${recordPath}`);
  }
  const normalized = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.length === 0 || entry !== entry.trim() ||
        path.posix.isAbsolute(entry) || entry.startsWith("-") || entry.includes("\\") ||
        /[\x00-\x1f\x7f]/.test(entry) || path.posix.normalize(entry) !== entry ||
        entry === "." || entry.split("/").some((part) => part === "" || part === "." || part === "..")) {
      throw new Error(`${label} contains a non-canonical repository-relative path in ${recordPath}: ${JSON.stringify(entry)}`);
    }
    if (entry.split("/").includes(".git")) {
      throw new Error(`${label} contains a forbidden Git metadata path in ${recordPath}: ${JSON.stringify(entry)}`);
    }
    normalized.push(entry);
  }
  return Object.freeze([...new Set(normalized)].sort());
}

function assertPathWithin(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes or aliases the canonical repository root`);
  }
}

function validateScopePathType(mainRepo, scopePath, label, { writable = false } = {}) {
  const wildcardIndex = scopePath.split("/").findIndex((part) => /[*?[]/.test(part));
  if (wildcardIndex === 0) {
    throw new Error(`${label} root-wide wildcard scope is unsupported: ${JSON.stringify(scopePath)}`);
  }
  if (writable && wildcardIndex !== -1) {
    throw new Error(`${label} wildcard write targets are unsupported: ${JSON.stringify(scopePath)}`);
  }
  const parts = wildcardIndex === -1 ? scopePath.split("/") : scopePath.split("/").slice(0, wildcardIndex);
  let current = mainRepo;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const final = index === parts.length - 1;
    if (!existsSync(current)) {
      if (writable && final && wildcardIndex === -1) return;
      throw new Error(`${label} is incomplete at ${JSON.stringify(scopePath)}; missing ${JSON.stringify(current)}`);
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} crosses a symlink at ${JSON.stringify(current)}`);
    }
    if (!final && !stat.isDirectory()) {
      throw new Error(`${label} has a path-type conflict at non-directory ${JSON.stringify(current)}`);
    }
  }
  if (parts.length > 0) {
    assertPathWithin(mainRepo, realpathSync(current), label);
  }
}

function resolveFrozenWorkerScopeAuthority({ mainRepo, subject, record, slice }) {
  const match = typeof subject === "string" ? subject.match(EXACT_IMPLEMENTATION_SLICE_RE) : null;
  if (!match || record?.id !== match[1] || slice?.id !== match[2] || slice.work_kind !== "implementation") {
    throw new Error("exact canonical implementation slice identity is unresolved or mismatched");
  }
  const requestedRepo = path.resolve(mainRepo);
  const repo = realpathSync(requestedRepo);
  if (requestedRepo !== repo) {
    throw new Error("launcher-provisioned mainRepo must not contain a symlink or path alias");
  }
  const recordPath = path.join(repo, "wiki", "work-records", `${match[1]}.json`);
  validateScopePathType(repo, `wiki/work-records/${match[1]}.json`, "canonical work-record source");
  const recordRealPath = realpathSync(recordPath);
  assertPathWithin(repo, recordRealPath, "canonical work-record source");
  const readScope = normalizeCanonicalScope(slice.read_scope, "read_scope", recordPath, { required: false });
  const repoPaths = normalizeCanonicalScope(slice.repo_paths, "repo_paths", recordPath, { required: false });
  const writeScope = normalizeCanonicalScope(slice.write_scope, "write_scope", recordPath);
  for (const entry of readScope) validateScopePathType(repo, entry, "read_scope");
  for (const entry of repoPaths) validateScopePathType(repo, entry, "repo_paths");
  for (const entry of writeScope) validateScopePathType(repo, entry, "write_scope", { writable: true });
  if (record.schema_version !== undefined &&
      (typeof record.schema_version !== "string" || record.schema_version.length === 0)) {
    throw new Error("canonical work-record schema_version is incompatible");
  }
  const selectedUnit = Object.freeze({
    kind: "slice",
    address: subject,
    record_id: match[1],
    slice_id: match[2],
    repo: record.repo ?? null
  });
  return Object.freeze({
    schema_version: WORKSPACE_AGENT_FROZEN_SCOPE_AUTHORITY_SCHEMA_VERSION,
    unit_address: `${record.initiative}/${match[1]}/${match[2]}`,
    selected_unit: selectedUnit,
    source: `wiki/work-records/${match[1]}.json#${match[2]}`,
    source_digest: computeWorkRecordSourceDigest(record),
    source_version: record.schema_version ?? null,
    read_scope: readScope,
    repo_paths: repoPaths,
    readable_scope: Object.freeze([...new Set([...readScope, ...repoPaths])].sort()),
    write_scope: writeScope
  });
}

function deepFreezeCanonicalSnapshot(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) return value;
  for (const child of Object.values(value)) deepFreezeCanonicalSnapshot(child);
  return Object.freeze(value);
}

function sameStringArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((entry, index) => entry === expected[index]);
}

function assertProvisionedScopeAuthority(binding, authority) {
  if (!isPlainObject(binding)) throw new Error("launcher-provisioned sparse exact-unit binding is absent");
  const selected = binding.selected_unit;
  const expectedSelected = authority.selected_unit;
  const scalarMismatch = [
    ["unit_address", binding.unit_address, authority.unit_address],
    ["write_scope_source", binding.write_scope_source, authority.source],
    ["source_digest", binding.source_digest, authority.source_digest],
    ["source_version", binding.source_version, authority.source_version]
  ].find(([, actual, expected]) => actual !== expected);
  if (scalarMismatch) {
    throw new Error(`launcher-provisioned sparse authority mismatch at ${scalarMismatch[0]}`);
  }
  for (const [field, expected] of [
    ["read_scope", authority.read_scope],
    ["repo_paths", authority.repo_paths],
    ["write_scope", authority.write_scope]
  ]) {
    if (!sameStringArray(binding[field], expected)) {
      throw new Error(`launcher-provisioned sparse authority mismatch at ${field}`);
    }
  }
  if (!isPlainObject(selected) || ["kind", "address", "record_id", "slice_id", "repo"]
    .some((field) => selected[field] !== expectedSelected[field])) {
    throw new Error("launcher-provisioned sparse authority selected-unit identity mismatch");
  }
  if (binding.index_sparse !== false || !Array.isArray(binding.cone_dirs) || binding.cone_dirs.length === 0) {
    throw new Error("launcher-provisioned sparse authority binding is incomplete");
  }
  return binding;
}

function readCanonicalWorkRecord(mainRepo, subject) {
  const match = typeof subject === "string" ? subject.match(WK_SUBJECT_RE) : null;
  if (!match) return null;
  try {
    const requestedRepo = path.resolve(mainRepo);
    const repo = realpathSync(requestedRepo);
    if (requestedRepo !== repo) return null;
    const relativeRecordPath = `wiki/work-records/${match[1]}.json`;
    validateScopePathType(repo, relativeRecordPath, "canonical work-record source");
    return JSON.parse(readFileSync(path.join(repo, relativeRecordPath), "utf8"));
  } catch {
    return null;
  }
}

function isCanonicalFindingsOnlyReviewSlice(slice) {
  if (!isPlainObject(slice) || slice.work_kind !== "review" ||
      !Array.isArray(slice.write_scope) || slice.write_scope.length !== 0 ||
      slice.dispatch_intent?.intended_agent_role !== "reviewer" ||
      slice.dispatch_intent?.target_unit !== "slice" ||
      slice.status === "done" || slice.status === "cancelled") {
    return false;
  }
  const reviewContract = [
    slice.title,
    slice.summary,
    slice.sections?.summary,
    ...(Array.isArray(slice.acceptance?.criteria) ? slice.acceptance.criteria : [])
  ].filter((value) => typeof value === "string").join("\n");
  return /findings-only/iu.test(reviewContract);
}

function resolveCanonicalFindingsOnlyReviewUnit(mainRepo, wkId) {
  const record = readCanonicalWorkRecord(mainRepo, wkId);
  if (!record || record.id !== wkId || !/^IN-\d{4}$/u.test(record.initiative ?? "") ||
      !Array.isArray(record.slices)) {
    throw new Error(`canonical ${wkId} record is unavailable for whole-WK review`);
  }
  const eligible = record.slices.filter(isCanonicalFindingsOnlyReviewSlice);
  if (eligible.length !== 1) {
    throw new Error(`canonical ${wkId} record must contain exactly one eligible findings-only review slice; found ${eligible.length}`);
  }
  const slice = eligible[0];
  return Object.freeze({
    record_id: wkId,
    slice_id: slice.id,
    subject: `${wkId}#${slice.id}`,
    initiative: record.initiative,
    parent_status: record.status ?? null,
    canonical_parent_wk_contract: JSON.stringify(record),
    review_unit_contract: JSON.stringify(slice)
  });
}

function assertFrozenReviewTarget(target) {
  if (!isPlainObject(target) ||
      typeof target.ref !== "string" || !/^refs\/heads\/wk\/IN-\d{4}\/WK-\d{4}$/u.test(target.ref) ||
      typeof target.sha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(target.sha) ||
      target.diff_head_sha !== target.sha ||
      typeof target.diff_base_sha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(target.diff_base_sha) ||
      target.diff_range !== `${target.diff_base_sha}..${target.sha}` ||
      target.complete_parent_wk_contract !== true || target.accumulated_wk_diff !== true) {
    throw new Error("frozen whole-WK review target is incomplete or incompatible");
  }
  return target;
}

function verifyFrozenWkReviewTargetAgainstObjectStore({ mainRepo, context, runGit = defaultRunGit }) {
  const probes = [
    { name: "wk_ref_resolves_to_frozen_sha", rev: `${context.wk_ref}^{commit}`, expect: context.wk_sha },
    { name: "frozen_commit_object_present", rev: `${context.wk_sha}^{commit}`, expect: context.wk_sha },
    { name: "frozen_diff_base_object_present", rev: `${context.diff_base_sha}^{commit}`, expect: context.diff_base_sha }
  ];
  for (const probe of probes) {
    const result = runGit({ repo: mainRepo, args: ["rev-parse", "--verify", probe.rev] });
    if (!result || result.ok !== true) {

      if (result && result.error != null && result.status == null) {
        return {
          ok: false,
          kind: "transport",
          detail: { probe: probe.name, rev: probe.rev, error: String(result.error) }
        };
      }
      return {
        ok: false,
        kind: "disagreement",
        detail: {
          probe: probe.name,
          rev: probe.rev,
          status: result?.status ?? null,
          stderr: result?.stderr ?? null
        }
      };
    }
    const actual = String(result.stdout ?? "").trim();
    if (actual !== probe.expect) {
      return {
        ok: false,
        kind: "disagreement",
        detail: { probe: probe.name, rev: probe.rev, expected: probe.expect, actual }
      };
    }
  }
  return { ok: true };
}

function resolveProvisioningInitiative({ readiness, mainRepo, subject }) {
  const readinessCandidates = [
    readiness?.initiative,
    readiness?.unit?.initiative,
    readiness?.record?.initiative,
    readiness?.work_record?.initiative
  ];
  for (const candidate of readinessCandidates) {
    if (typeof candidate === "string" && /^IN-\d{4}$/.test(candidate)) {
      return candidate;
    }
  }
  const record = readCanonicalWorkRecord(mainRepo, subject);
  return typeof record?.initiative === "string" && /^IN-\d{4}$/.test(record.initiative)
    ? record.initiative
    : null;
}

function normalizeProvisioningConfig(config) {
  if (!config || config.enabled === false) return null;
  if (!isPlainObject(config)) return null;
  if (REMOVED_MANAGED_PROVISIONING_ROOT_FIELDS.some(
    (field) => Object.prototype.hasOwnProperty.call(config, field)
  )) return null;
  if (typeof config.mainRepo !== "string" || config.mainRepo.length === 0) return null;
  if (typeof config.worktreeRoot !== "string" || config.worktreeRoot.length === 0) return null;
  return config;
}

const MANAGED_LIFECYCLE_REQUIRED = RUNTIME_BLOCKER_CODES.MANAGED_LIFECYCLE_REQUIRED;
const MANAGED_PROVISIONING_UNAVAILABLE = RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE;
if (typeof MANAGED_LIFECYCLE_REQUIRED !== "string" || typeof MANAGED_PROVISIONING_UNAVAILABLE !== "string") {
  throw new Error("WK-1471 managed-lifecycle blocker interface is absent or incompatible");
}

function managedRefusal(reason, detail = null) {
  return {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason,
      detail
    }
  };
}

function resolveRefCommit(runGit, mainRepo, ref) {
  const result = runGit({ repo: mainRepo, args: ["rev-parse", "--verify", `${ref}^{commit}`] });
  const sha = result?.ok === true ? String(result.stdout ?? "").trim() : "";
  return sha || null;
}

function dependencyDescriptor(mainRepo, record, dependency) {
  const localSlice = typeof dependency === "string" ? dependency.match(/^SLICE-(\d{3})$/) : null;
  const qualified = typeof dependency === "string"
    ? dependency.match(/^(WK-\d{4})(?:#(SLICE-\d{3}))?$/)
    : null;
  const dependencyWkId = localSlice ? record.id : qualified?.[1] ?? null;
  const dependencySliceId = localSlice ? `SLICE-${localSlice[1]}` : qualified?.[2] ?? null;
  if (dependencyWkId === null) return null;
  const dependencyRecord = dependencyWkId === record.id
    ? record
    : readCanonicalWorkRecord(mainRepo, dependencyWkId);
  if (!dependencyRecord || !/^IN-\d{4}$/.test(dependencyRecord.initiative ?? "")) return null;
  const dependencySlice = dependencySliceId === null
    ? null
    : dependencyRecord.slices?.find((candidate) => candidate?.id === dependencySliceId) ?? null;
  return { dependencyRecord, dependencySlice, dependencyWkId, dependencySliceId };
}

function resolveExactSliceDependencies(mainRepo, subject, deps = {}) {
  const match = typeof subject === "string" ? subject.match(/^(WK-\d{4})#(SLICE-\d{3})$/) : null;
  if (!match) return { ok: false, reason: "exact_slice_required" };
  const record = readCanonicalWorkRecord(mainRepo, subject);
  const slice = Array.isArray(record?.slices) ? record.slices.find((candidate) => candidate?.id === match[2]) : null;
  if (!record || !/^IN-\d{4}$/.test(record.initiative ?? "") || !slice || slice.work_kind !== "implementation") {
    return { ok: false, reason: "exact_implementation_slice_unresolved" };
  }
  const dependencies = Array.isArray(slice.depends_on) ? slice.depends_on : [];
  if (dependencies.length === 0) return { ok: true, record, slice };
  const runGit = deps.runGit ?? defaultRunGit;
  const wkRef = perWkBranchRef(record.initiative, record.id);
  const wkTip = resolveRefCommit(runGit, mainRepo, wkRef);
  const unmet = [];
  for (const dependency of dependencies) {
    const descriptor = dependencyDescriptor(mainRepo, record, dependency);
    if (!descriptor) {
      unmet.push({ dependency, reason: "dependency_identity_unresolved" });
      continue;
    }
    const { dependencyRecord, dependencySlice, dependencyWkId, dependencySliceId } = descriptor;
    const accepted = dependencySliceId === null
      ? dependencyRecord.status === "done"
      : dependencySlice?.status === "done";
    if (!accepted) {
      unmet.push({ dependency, reason: "wk_context_review_not_accepted" });
      continue;
    }
    const dependencyRef = dependencySliceId === null
      ? perWkBranchRef(dependencyRecord.initiative, dependencyWkId)
      : sliceBranchRef(dependencyRecord.initiative, dependencyWkId, dependencySliceId);
    const dependencyTip = resolveRefCommit(runGit, mainRepo, dependencyRef);
    if (wkTip === null || dependencyTip === null) {
      unmet.push({ dependency, reason: "dependency_not_present_on_wk_branch", wk_ref: wkRef, dependency_ref: dependencyRef });
      continue;
    }
    const present = runGit({ repo: mainRepo, args: ["merge-base", "--is-ancestor", dependencyTip, wkTip] });
    if (present?.ok !== true) {
      unmet.push({ dependency, reason: "dependency_not_present_on_wk_branch", wk_ref: wkRef, dependency_ref: dependencyRef });
    }
  }
  return unmet.length === 0 ? { ok: true, record, slice } : {
    ok: false,
    reason: "unit_dependencies_unmet",
    unmet: unmet.map((entry) => entry.dependency),
    dependency_diagnostics: unmet
  };
}

function provisioningRefusal(error) {
  return {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason: MANAGED_PROVISIONING_UNAVAILABLE,
      detail: {
        source_code: error?.code ?? null,
        message: error?.message ?? String(error),
        detail: error?.detail ?? null
      }
    }
  };
}

function invalidProvisioningStateRefusal(reason, detail = null) {
  return {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason,
      detail
    }
  };
}

function normalizeProvisioningRetryId(value) {
  if (!Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

async function resolveProvisioningAttemptState({ attemptStateAuthority, input, initiative }) {
  let resolved;
  try {
    resolved = await attemptStateAuthority.resolve({
      role: input.role,
      subject: input.subject,
      initiative,
      launchRef: input.monitor_handle,
      runId: input.run_id
    });
  } catch (error) {
    return {
      ok: false,
      refusal: invalidProvisioningStateRefusal(
        "worktree_provisioning_attempt_state_threw",
        { message: error?.message ?? String(error) }
      )
    };
  }

  if (resolved === null || resolved === undefined) {
    return {
      ok: false,
      refusal: invalidProvisioningStateRefusal(
        "worktree_provisioning_attempt_state_invalid",
        { reason: "launcher_owned_attempt_state_required" }
      )
    };
  }
  if (!isPlainObject(resolved)) {
    return {
      ok: false,
      refusal: invalidProvisioningStateRefusal(
        "worktree_provisioning_attempt_state_invalid",
        { reason: "resolver_must_return_plain_object" }
      )
    };
  }
  const retryId = normalizeProvisioningRetryId(resolved.retryId ?? resolved.retry_id);
  if (retryId === null) {
    return {
      ok: false,
      refusal: invalidProvisioningStateRefusal(
        "worktree_provisioning_attempt_state_invalid",
        { reason: "retry_id_must_be_non_negative_integer" }
      )
    };
  }
  const disposition = resolved.disposition;
  const priorIdentity = resolved.priorIdentity ?? resolved.prior_identity ?? null;
  const livenessDeps = resolved.livenessDeps ?? resolved.liveness_deps ?? null;
  if (resolved.schema_version !== MANAGED_WORKER_ATTEMPT_STATE_SCHEMA_VERSION ||
      resolved.unit_address !== `${initiative}/${input.subject.replace("#", "/")}` ||
      (disposition !== "initial" && disposition !== "reissue") ||
      (disposition === "initial" && (retryId !== 0 || priorIdentity !== null)) ||
      (disposition === "reissue" && (retryId === 0 || !isPlainObject(priorIdentity) ||
        typeof livenessDeps?.confirmPriorWorkerTerminated !== "function"))) {
    return {
      ok: false,
      refusal: invalidProvisioningStateRefusal(
        "worktree_provisioning_attempt_state_invalid",
        { reason: "launcher_owned_attempt_state_identity_mismatch" }
      )
    };
  }
  return {
    ok: true,
    state: {
      schemaVersion: resolved.schema_version,
      disposition,
      retryId,
      priorIdentity,
      livenessDeps
    }
  };
}

function isTerminalRunStatus(status) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function createLauncherOwnedManagedAttemptStateAuthority() {
  const attempts = new Map();

  async function refreshPriorLiveness(prior) {
    if (prior.terminated === true) return true;
    if (typeof prior.probe !== "function") return false;
    try {
      const outcome = await prior.probe();
      if (isTerminalRunStatus(outcome?.status)) {
        prior.terminated = true;
      }
    } catch {
      return false;
    }
    return prior.terminated === true;
  }

  return Object.freeze({
    async resolve({ role, subject, initiative, launchRef, runId }) {
      if (role !== "worker" || !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "") ||
          typeof launchRef !== "string" || launchRef.length === 0 ||
          typeof runId !== "string" || runId.length === 0) {
        return null;
      }
      const unitAddress = `${initiative}/${subject.replace("#", "/")}`;
      const prior = attempts.get(unitAddress) ?? null;
      if (prior === null) {
        return Object.freeze({
          schema_version: MANAGED_WORKER_ATTEMPT_STATE_SCHEMA_VERSION,
          disposition: "initial",
          unit_address: unitAddress,
          retryId: 0,
          priorIdentity: null,
          livenessDeps: null
        });
      }
      const terminated = await refreshPriorLiveness(prior);
      const priorIdentity = Object.freeze({
        launchRef: prior.launchRef,
        runId: prior.runId,
        retryId: prior.retryId
      });
      const livenessDeps = Object.freeze({
        confirmPriorWorkerTerminated(candidate) {
          const identity = candidate?.priorIdentity;
          return terminated === true && candidate?.unitAddress === unitAddress &&
            candidate?.launchRef === launchRef && candidate?.runId === runId &&
            candidate?.retryId === prior.retryId + 1 &&
            identity?.launchRef === prior.launchRef && identity?.runId === prior.runId &&
            identity?.retryId === prior.retryId;
        }
      });
      return Object.freeze({
        schema_version: MANAGED_WORKER_ATTEMPT_STATE_SCHEMA_VERSION,
        disposition: "reissue",
        unit_address: unitAddress,
        retryId: prior.retryId + 1,
        priorIdentity,
        livenessDeps
      });
    },
    recordProvisioned({ unitAddress, launchRef, runId, retryId }) {
      attempts.set(unitAddress, {
        unitAddress,
        launchRef,
        runId,
        retryId,
        provisioning: null,
        terminated: false,
        probe: null
      });
    },
    recordProvisioningBinding({ unitAddress, launchRef, runId, retryId, provisioning }) {
      const current = attempts.get(unitAddress);
      if (!current || current.launchRef !== launchRef || current.runId !== runId ||
          current.retryId !== retryId || !isPlainObject(provisioning)) {
        throw new Error("launcher-owned managed attempt identity changed before provisioning binding recording");
      }
      current.provisioning = provisioning;
    },
    resolveProvisioningBinding(status) {
      for (const current of attempts.values()) {
        if (current.runId === status?.run_id && current.launchRef === status?.monitor_handle &&
            current.provisioning && current.provisioning.record_id &&
            status?.subject === `${current.provisioning.record_id}#${current.provisioning.slice_id}`) {
          return current.provisioning;
        }
      }
      throw new Error("terminal worker run has no exact launcher-owned provisioning binding");
    },
    recordExecutorResult({ unitAddress, launchRef, runId, retryId, result, threw = false }) {
      const current = attempts.get(unitAddress);
      if (!current || current.launchRef !== launchRef || current.runId !== runId || current.retryId !== retryId) {
        throw new Error("launcher-owned managed attempt identity changed before executor result recording");
      }
      current.probe = typeof result?.probe === "function" ? result.probe : null;
      current.terminated = threw === true || result?.accepted === false || isTerminalRunStatus(result?.status);
    }
  });
}

function firstStringField(source, names) {
  for (const name of names) {
    const value = source?.[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function deriveProvisionedWorktreeGitBinding(provisioning) {
  if (!isPlainObject(provisioning)) return null;
  const direct = provisioning.provisionedWorktreeGitBinding
    ?? provisioning.provisioned_worktree_git_binding
    ?? provisioning.provisionedWorktreeGitIdentity
    ?? provisioning.provisioned_worktree_git_identity
    ?? provisioning.git_binding
    ?? provisioning.git_identity
    ?? null;
  if (isPlainObject(direct)) {
    return Object.freeze({ ...direct });
  }

  const worktreePath = firstStringField(provisioning, ["worktree_path", "worktreePath"]);
  const gitDir = firstStringField(provisioning, [
    "git_dir",
    "gitDir",
    "worktree_git_dir",
    "worktreeGitDir"
  ]);
  const mainGitDir = firstStringField(provisioning, [
    "main_git_dir",
    "mainGitDir",
    "shared_git_dir",
    "sharedGitDir"
  ]);
  if (worktreePath === null || gitDir === null || mainGitDir === null) {
    return null;
  }

  const gitPointerFile = firstStringField(provisioning, [
    "git_pointer_file",
    "gitPointerFile",
    "worktree_git_pointer_file",
    "worktreeGitPointerFile"
  ]) ?? path.join(worktreePath, ".git");

  return Object.freeze({
    worktreePath,
    gitDir,
    mainGitDir,
    gitPointerFile
  });
}

function maybeWrapExecutorWithWorktreeProvisioning(
  executor,
  app,
  provisioningConfig,
  requireManagedProvisioning,
  attemptStateAuthority,
  validateWorkerScopeSnapshot
) {
  if (typeof executor !== "function") return executor;
  if (provisioningConfig === null && requireManagedProvisioning !== true) return executor;
  return async function provisionedWorkspaceAgentExecutor(input = {}) {
    if (input.role !== "worker") {
      return executor(input);
    }

    if (provisioningConfig === null) {
      return managedRefusal(MANAGED_PROVISIONING_UNAVAILABLE, { capability: "managed_worktree_provisioning" });
    }
    const callerCarrier = firstOwnField(input, CALLER_SCOPE_CARRIERS);
    const lifecycleCarrier = firstOwnField(input, CALLER_MANAGED_LIFECYCLE_CARRIERS);
    const configCarrier = firstOwnField(provisioningConfig, CALLER_SCOPE_CARRIERS);
    const configAttemptCarrier = firstOwnField(provisioningConfig, CONFIG_ATTEMPT_STATE_CARRIERS);
    if (callerCarrier !== null || lifecycleCarrier !== null || configCarrier !== null || configAttemptCarrier !== null) {
      return scopeAuthorityRefusal(WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER, {
        reason: lifecycleCarrier !== null || configAttemptCarrier !== null
          ? "caller_carried_managed_lifecycle_forbidden"
          : "caller_carried_scope_forbidden",
        field: callerCarrier ?? lifecycleCarrier ?? configCarrier ?? configAttemptCarrier,
        carrier: callerCarrier !== null || lifecycleCarrier !== null ? "dispatch_input" : "provisioning_config"
      });
    }
    if (!SUPPORTED_WORKER_READ_BOUNDARY_FAMILIES.includes(app)) {
      return scopeAuthorityRefusal(WORKER_READ_BOUNDARY_UNSUPPORTED_BLOCKER, {
        reason: "unsupported_family",
        family: app,
        supported_families: SUPPORTED_WORKER_READ_BOUNDARY_FAMILIES
      });
    }
    const boundaryBackend = provisioningConfig.readBoundaryBackend
      ?? provisioningConfig.read_boundary_backend
      ?? provisioningConfig.isolationBackend
      ?? provisioningConfig.isolation_backend
      ?? "bwrap";
    if (!SUPPORTED_WORKER_READ_BOUNDARY_BACKENDS.includes(boundaryBackend)) {
      return scopeAuthorityRefusal(WORKER_READ_BOUNDARY_UNSUPPORTED_BLOCKER, {
        reason: "unsupported_backend",
        backend: boundaryBackend,
        supported_backends: SUPPORTED_WORKER_READ_BOUNDARY_BACKENDS
      });
    }
    const frozenScopeSnapshot = input.frozen_worker_scope_snapshot ?? null;
    const snapshotValidation = typeof validateWorkerScopeSnapshot === "function"
      ? await validateWorkerScopeSnapshot({
          snapshot: frozenScopeSnapshot,
          consumer: "provisioning",
          result: null
        })
      : null;
    if (!snapshotValidation?.ok) {
      return {
        accepted: false,
        refusal: snapshotValidation?.refusal ?? scopeAuthorityRefusal(
          WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER,
          { reason: "frozen_scope_snapshot_unavailable" }
        ).refusal
      };
    }
    const frozenScopeAuthority = frozenScopeSnapshot.authority;
    if (!hasManagedConfinementActivation(provisioningConfig)) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "repository_read_boundary",
        dependency: "WK-1455",
        message: "managed worker spawn remains disabled until the exact confinement/provisioning capability binding is available"
      });
    }

    let provisioning;
    let initiative;
    let provisioningRetryId;

    let provisionedViaBroker = false;
    try {
      initiative = resolveProvisioningInitiative({
        readiness: input.readiness ?? null,
        mainRepo: provisioningConfig.mainRepo,
        subject: input.subject
      });
      if (initiative === null) {
        return {
          accepted: false,
          refusal: {
            code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
            reason: "worktree_provisioning_initiative_unresolved",
            detail: { subject: input.subject ?? null }
          }
        };
      }
      const attempt = await resolveProvisioningAttemptState({
        attemptStateAuthority,
        input,
        initiative
      });
      if (!attempt.ok) {
        return attempt.refusal;
      }
      provisioningRetryId = attempt.state.retryId;
      const hostProvisioningAdapter = provisioningConfig.hostProvisioningAdapter ?? null;
      if (hostProvisioningAdapter !== null && provisioningRetryId === 0) {

        const brokered = await hostProvisioningAdapter({
          role: input.role,
          subject: input.subject,
          initiative,
          launch_ref: input.monitor_handle,
          run_id: input.run_id,
          retry_id: provisioningRetryId
        });
        if (!isPlainObject(brokered) || brokered.accepted !== true ||
            !isPlainObject(brokered.provisioning)) {
          return isPlainObject(brokered) && isPlainObject(brokered.refusal)
            ? { accepted: false, refusal: brokered.refusal }
            : provisioningRefusal(new Error("host managed worktree provisioning is unavailable"));
        }
        provisioning = brokered.provisioning;
        provisionedViaBroker = true;
      } else {
        const configuredAllocateSparse = provisioningConfig.deps?.allocateSparseExactUnitWorktree
          ?? allocateSparseExactUnitWorktree;
        provisioning = provisionManagedWorktreesAtDispatch({
          mainRepo: provisioningConfig.mainRepo,
          initiative,
          subject: input.subject,
          launchRef: input.monitor_handle,
          runId: input.run_id,
          retryId: provisioningRetryId,
          worktreeRoot: provisioningConfig.worktreeRoot,
          priorIdentity: attempt.state.priorIdentity,
          deps: {
            ...(provisioningConfig.deps ?? {}),
            ...(attempt.state.livenessDeps ?? {}),
            allocateSparseExactUnitWorktree: (args) => {
              const configuredVerifyBinding = args.deps?.verifyBinding
                ?? resolveVerifiedSparseExactUnitBinding;
              const binding = configuredAllocateSparse({
                ...args,
                deps: {
                  ...(args.deps ?? {}),
                  verifyBinding: (verifyArgs) => {
                    const verified = configuredVerifyBinding(verifyArgs);
                    assertProvisionedScopeAuthority(verified, frozenScopeAuthority);
                    return verified;
                  }
                }
              });
              assertProvisionedScopeAuthority(binding, frozenScopeAuthority);
              return binding;
            }
          }
        });
      }
    } catch (error) {
      return provisioningRefusal(error);
    }

    try {

      const assertProvisioningResult = provisionedViaBroker
        ? assertStructuralManagedProvisioningResult
        : assertCompleteManagedProvisioningResult;
      assertProvisioningResult({
        provisioning,
        mainRepo: provisioningConfig.mainRepo,
        initiative,
        subject: input.subject,
        launchRef: input.monitor_handle,
        runId: input.run_id,
        retryId: provisioningRetryId,
        worktreeRoot: provisioningConfig.worktreeRoot
      });
    } catch (error) {
      return provisioningRefusal(error);
    }
    try {
      assertProvisionedScopeAuthority(provisioning.slice_binding, frozenScopeAuthority);
      if (provisioning.unit_address !== frozenScopeAuthority.unit_address ||
          provisioning.record_id !== frozenScopeAuthority.selected_unit.record_id ||
          provisioning.slice_id !== frozenScopeAuthority.selected_unit.slice_id) {
        throw new Error("managed provisioning identity does not match the frozen exact selected unit");
      }
    } catch (error) {
      return scopeAuthorityRefusal(WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER, {
        reason: "provisioning_authority_mismatch",
        message: error?.message ?? String(error)
      });
    }

    attemptStateAuthority.recordProvisioned({
      unitAddress: frozenScopeAuthority.unit_address,
      launchRef: input.monitor_handle,
      runId: input.run_id,
      retryId: provisioningRetryId
    });
    attemptStateAuthority.recordProvisioningBinding({
      unitAddress: frozenScopeAuthority.unit_address,
      launchRef: input.monitor_handle,
      runId: input.run_id,
      retryId: provisioningRetryId,
      provisioning
    });
    const provisionedWorktreeGitBinding = deriveProvisionedWorktreeGitBinding(provisioning);
    let executorResult;
    try {
      const {
        frozen_worker_scope_snapshot: _frozenWorkerScopeSnapshot,
        ...executorInput
      } = input;
      executorResult = await executor({
        ...executorInput,
        workspace_dir: provisioning.worktree_path,
        worktree_provisioning: provisioning,
        worker_scope_authority: frozenScopeAuthority,
        ...(provisionedWorktreeGitBinding
          ? {
              provisionedWorktreeGitBinding,
              provisioned_worktree_git_binding: provisionedWorktreeGitBinding
            }
          : {})
      });
      attemptStateAuthority.recordExecutorResult({
        unitAddress: frozenScopeAuthority.unit_address,
        launchRef: input.monitor_handle,
        runId: input.run_id,
        retryId: provisioningRetryId,
        result: executorResult
      });
      return executorResult;
    } catch (error) {
      attemptStateAuthority.recordExecutorResult({
        unitAddress: frozenScopeAuthority.unit_address,
        launchRef: input.monitor_handle,
        runId: input.run_id,
        retryId: provisioningRetryId,
        result: null,
        threw: true
      });
      throw error;
    }
  };
}

function maybeWrapRegistryEntryWithWorktreeProvisioning(
  entry,
  app,
  provisioningConfig,
  requireManagedProvisioning,
  attemptStateAuthority,
  validateWorkerScopeSnapshot
) {
  if (!entry || typeof entry !== "object" || typeof entry.executor !== "function") {
    return entry;
  }
  return {
    ...entry,
    executor: maybeWrapExecutorWithWorktreeProvisioning(
      entry.executor,
      app,
      provisioningConfig,
      requireManagedProvisioning,
      attemptStateAuthority,
      validateWorkerScopeSnapshot
    )
  };
}

function managedLifecycleCapabilityFact(available, source) {
  return Object.freeze({
    available: available === true,
    source,
    freshness: Object.freeze({ state: "fresh", basis: "current_backend_instance" })
  });
}

export function createWorkspaceAgentDispatchBackend(options = {}) {
  const {
    launchExecutor = null,
    launchExecutors = null,
    clock = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

    monotonicNow = () => performance.now(),
    runIdFactory = defaultRunIdFactory,
    monitorHandleFactory = defaultMonitorHandleFactory,

    evaluateWorkerAdmission = null,
    prepareSourceToolSurface = null,

    proveAssignedSourceReadable = null
  } = options;
  const worktreeProvisioningConfig = normalizeProvisioningConfig(options.worktreeProvisioning);

  const requireManagedProvisioning = options.requireManagedProvisioning === true;
  const attemptStateAuthority = createLauncherOwnedManagedAttemptStateAuthority();
  const registeredWorkerScopeSnapshots = new WeakSet();
  const frozenReviewContexts = new Map();
  const recoveredIntegratedRuns = new Map();
  const postWorkerSliceLifecycle = typeof options.postWorkerSliceLifecycle === "function"
    ? options.postWorkerSliceLifecycle
    : null;
  const reviewContextRunGit = options.reviewContextRunGit ?? defaultRunGit;
  const closedInputCommitCompositionInstalled = hasExactClosedInputCommitComposition(
    options.closedInputCommitComposition
  );

  function workerScopeSnapshotRefusal(reason, detail = null) {
    return {
      ok: false,
      refusal: scopeAuthorityRefusal(WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER, {
        reason,
        ...detail
      }).refusal
    };
  }

  function freezeWorkerScopeSnapshot({ input, role, subject }) {
    if (role !== "worker" || (worktreeProvisioningConfig === null && requireManagedProvisioning !== true)) {
      return { ok: true, snapshot: null };
    }
    const callerCarrier = firstOwnField(input, CALLER_SCOPE_CARRIERS);
    const lifecycleCarrier = firstOwnField(input, CALLER_MANAGED_LIFECYCLE_CARRIERS);
    if (callerCarrier !== null || lifecycleCarrier !== null) {
      return workerScopeSnapshotRefusal(
        lifecycleCarrier !== null
          ? "caller_carried_managed_lifecycle_forbidden"
          : "caller_carried_scope_forbidden",
        {
          field: callerCarrier ?? lifecycleCarrier,
          carrier: "dispatch_input"
        }
      );
    }
    if (worktreeProvisioningConfig === null) {
      return {
        ok: false,
        refusal: managedRefusal(MANAGED_PROVISIONING_UNAVAILABLE, {
          capability: "managed_worktree_provisioning"
        }).refusal
      };
    }
    const dependencies = resolveExactSliceDependencies(
      worktreeProvisioningConfig.mainRepo,
      subject,
      worktreeProvisioningConfig.deps ?? {}
    );
    if (!dependencies.ok) {
      return { ok: false, refusal: managedRefusal(MANAGED_LIFECYCLE_REQUIRED, dependencies).refusal };
    }
    try {
      const record = deepFreezeCanonicalSnapshot(dependencies.record);
      const selectedUnitContract = record.slices.find(
        (candidate) => candidate?.id === dependencies.slice.id
      );
      const authority = resolveFrozenWorkerScopeAuthority({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        subject,
        record,
        slice: selectedUnitContract
      });
      const snapshot = Object.freeze({
        authority,
        record,
        selected_unit_contract: selectedUnitContract
      });
      registeredWorkerScopeSnapshots.add(snapshot);
      return { ok: true, snapshot };
    } catch (error) {
      return workerScopeSnapshotRefusal("canonical_scope_resolution_failed", {
        message: error?.message ?? String(error)
      });
    }
  }

  function validateWorkerScopeSnapshot({ snapshot, consumer, result = null }) {
    if (!isPlainObject(snapshot) || !registeredWorkerScopeSnapshots.has(snapshot) ||
        !Object.isFrozen(snapshot) || !Object.isFrozen(snapshot.record) ||
        !Object.isFrozen(snapshot.selected_unit_contract)) {
      return workerScopeSnapshotRefusal("frozen_scope_snapshot_unavailable", { consumer });
    }
    const expected = snapshot.authority;
    const current = readCanonicalWorkRecord(worktreeProvisioningConfig.mainRepo, expected.selected_unit.address);
    const currentDigest = current === null ? null : computeWorkRecordSourceDigest(current);
    if (currentDigest !== expected.source_digest) {
      return workerScopeSnapshotRefusal("canonical_source_digest_changed", {
        consumer,
        expected_source_digest: expected.source_digest,
        actual_source_digest: currentDigest
      });
    }

    const bindings = [
      result,
      result?.binding,
      result?.worker_scope_authority,
      result?.source_tool_surface,
      result?.sourceToolSurface
    ].filter(isPlainObject);
    for (const binding of bindings) {
      const digest = binding.source_record_digest ?? binding.source_digest;
      if (digest !== undefined && digest !== expected.source_digest) {
        return workerScopeSnapshotRefusal("downstream_source_digest_mismatch", {
          consumer,
          expected_source_digest: expected.source_digest,
          actual_source_digest: digest ?? null
        });
      }
      if (binding.selected_unit !== undefined &&
          (!isPlainObject(binding.selected_unit) ||
            ["kind", "address", "record_id", "slice_id", "repo"].some(
              (field) => binding.selected_unit[field] !== expected.selected_unit[field]
            ))) {
        return workerScopeSnapshotRefusal("downstream_selected_unit_mismatch", { consumer });
      }
    }
    return { ok: true };
  }

  const executors = {};
  const executorRegistryEntries = {};

  const familyAwareWiring = !!(launchExecutors && typeof launchExecutors === "object");
  if (familyAwareWiring) {
    for (const app of BACKEND_SUPPORTED_APPS) {
      const candidate = launchExecutors[app];
      if (typeof candidate === "function") {
        executors[app] = maybeWrapExecutorWithWorktreeProvisioning(
          candidate,
          app,
          worktreeProvisioningConfig,
          requireManagedProvisioning,
          attemptStateAuthority,
          validateWorkerScopeSnapshot
        );
        executorRegistryEntries[app] = executors[app];
      } else if (candidate && typeof candidate === "object" && typeof candidate.executor === "function") {
        const wrapped = maybeWrapRegistryEntryWithWorktreeProvisioning(
          candidate,
          app,
          worktreeProvisioningConfig,
          requireManagedProvisioning,
          attemptStateAuthority,
          validateWorkerScopeSnapshot
        );
        executors[app] = wrapped.executor;
        executorRegistryEntries[app] = wrapped;
      }
    }
  } else if (typeof launchExecutor === "function") {
    executors.codex = maybeWrapExecutorWithWorktreeProvisioning(
      launchExecutor,
      "codex",
      worktreeProvisioningConfig,
      requireManagedProvisioning,
      attemptStateAuthority,
      validateWorkerScopeSnapshot
    );
    executorRegistryEntries.codex = executors.codex;
  }

  const runs = new Map();

  function deriveReviewerLaunchIdentity({ role, subject, workspace_dir: workspaceDir }) {
    if (role !== "reviewer") return null;
    const context = frozenReviewContexts.get(subject) ?? null;
    if (context === null) return null;
    if (context.reservation_state !== FROZEN_REVIEW_CONTEXT_STATES.RESERVED ||
        workspaceDir !== context.worktree_path) {
      throw new Error("backend-owned frozen reviewer launch identity is not reserved for this exact worktree");
    }
    return createRetainedReviewerLaunchIdentity(context);
  }

  const lifecycle = createDispatchRunLifecycle({
    executors,
    executorRegistryEntries,
    familyAwareWiring,
    runs,
    clock,
    sleep,
    monotonicNow,
    runIdFactory,
    monitorHandleFactory,
    evaluateWorkerAdmission,
    prepareSourceToolSurface,
    freezeWorkerScopeSnapshot,
    validateWorkerScopeSnapshot,
    deriveReviewerLaunchIdentity,
    proveAssignedSourceReadable
  });

  function resolveManagedRunBinding(status) {
    return attemptStateAuthority.resolveProvisioningBinding(status);
  }

  function assertConsumedReviewContextMayRotate({ existing, reviewUnit, target, worktreePath }) {
    if (existing.reservation_state !== FROZEN_REVIEW_CONTEXT_STATES.CONSUMED) {
      throw new Error("an available or reserved frozen whole-WK review context cannot be replaced");
    }
    const priorReviewerRun = typeof existing.consumed_by_run_id === "string"
      ? runs.get(existing.consumed_by_run_id)
      : null;
    if (!priorReviewerRun || priorReviewerRun.run_id !== existing.consumed_by_run_id) {
      throw new Error("consumed frozen whole-WK review context has no exact backend-owned reviewer run");
    }
    if (priorReviewerRun.role !== "reviewer" ||
        priorReviewerRun.subject !== existing.review_subject) {
      throw new Error("consumed frozen whole-WK review context does not match its backend-owned reviewer run");
    }
    if (priorReviewerRun.terminal !== true) {
      throw new Error("consumed frozen whole-WK review context reviewer run is not terminal");
    }
    assertRetainedReviewerLaunchIdentityMatchesContext(
      priorReviewerRun.reviewer_launch_identity,
      existing
    );
    if (existing.main_repo !== worktreeProvisioningConfig?.mainRepo ||
        existing.review_subject !== reviewUnit.subject ||
        existing.record_id !== reviewUnit.record_id ||
        existing.review_slice_id !== reviewUnit.slice_id ||
        existing.initiative !== reviewUnit.initiative ||
        existing.wk_ref !== target.ref ||
        existing.worktree_path !== worktreePath ||
        existing.canonical_parent_wk_contract !== reviewUnit.canonical_parent_wk_contract ||
        existing.review_unit_contract !== reviewUnit.review_unit_contract) {
      throw new Error("corrective frozen whole-WK review context changed canonical repository, subject, unit, initiative, ref, worktree, or contract identity");
    }
    if (target.sha === existing.wk_sha) {
      throw new Error("corrective frozen whole-WK review context replays the consumed WK target");
    }
  }

  function bindFrozenReviewContext({ status, provisioning, integration, reviewUnit }) {
    const target = assertFrozenReviewTarget(integration?.review_target);
    const wkBinding = provisioning?.wk_binding;
    const worktreePath = provisioning?.validation_worktree_path;
    const expectedWkRef = wkBinding?.output_branch?.startsWith("refs/heads/")
      ? wkBinding.output_branch
      : `refs/heads/${wkBinding?.output_branch ?? ""}`;
    if (!isPlainObject(reviewUnit) || typeof reviewUnit.subject !== "string" ||
        typeof reviewUnit.canonical_parent_wk_contract !== "string" ||
        typeof reviewUnit.review_unit_contract !== "string" || reviewUnit.parent_status !== "review" ||
        typeof reviewUnit.initiative !== "string" || !/^IN-\d{4}$/u.test(reviewUnit.initiative) ||
        target.ref !== `refs/heads/wk/${reviewUnit.initiative}/${reviewUnit.record_id}` ||
        !path.isAbsolute(worktreePath ?? "") ||
        worktreePath !== wkBinding?.worktree_path || expectedWkRef !== target.ref ||
        provisioning?.record_id !== reviewUnit.record_id ||
        status?.subject !== `${reviewUnit.record_id}#${provisioning?.slice_id}`) {
      throw new Error("backend-owned frozen review context does not match managed provisioning and canonical review identity");
    }
    const existing = frozenReviewContexts.get(reviewUnit.subject) ?? null;
    if (existing !== null) {
      assertConsumedReviewContextMayRotate({
        existing,
        reviewUnit,
        target,
        worktreePath
      });
    }
    const trustedFrozenReviewContract = createTrustedFrozenReviewContract(reviewUnit);
    const context = Object.freeze({
      schema_version: "workspace-agent-frozen-wk-review-context.v1",
      review_subject: reviewUnit.subject,
      record_id: reviewUnit.record_id,
      review_slice_id: reviewUnit.slice_id,
      initiative: reviewUnit.initiative,
      canonical_parent_wk_contract: reviewUnit.canonical_parent_wk_contract,
      review_unit_contract: reviewUnit.review_unit_contract,
      trusted_frozen_review_contract: trustedFrozenReviewContract,
      main_repo: worktreeProvisioningConfig.mainRepo,
      worktree_path: worktreePath,
      wk_ref: target.ref,
      wk_sha: target.sha,
      diff_base_sha: target.diff_base_sha,
      diff_head_sha: target.diff_head_sha,
      diff_range: target.diff_range,
      complete_parent_wk_contract: true,
      accumulated_wk_diff: true,
      source_worker_run_id: status.run_id,
      source_worker_subject: status.subject,
      reservation_state: FROZEN_REVIEW_CONTEXT_STATES.AVAILABLE,

      consumed: false,
      consumed_by_run_id: null
    });
    frozenReviewContexts.set(reviewUnit.subject, context);
    return context;
  }

  const runPostWorkerSliceLifecycle = postWorkerSliceLifecycle === null
    ? null
    : async ({ workspace, status }) => postWorkerSliceLifecycle({
        workspace,
        status,
        deps: {
          resolveManagedRunBinding,
          resolveCanonicalReviewUnit: ({ mainRepo, wkId }) =>
            resolveCanonicalFindingsOnlyReviewUnit(mainRepo, wkId),
          bindFrozenReviewContext
        }
      });

  const startLaunch = async (input = {}) => {
    if (input?.role === "worker") {
      const callerCarrier = firstOwnField(input, CALLER_SCOPE_CARRIERS);
      const lifecycleCarrier = firstOwnField(input, CALLER_MANAGED_LIFECYCLE_CARRIERS);
      const configCarrier = firstOwnField(worktreeProvisioningConfig, CALLER_SCOPE_CARRIERS);
      const configAttemptCarrier = firstOwnField(worktreeProvisioningConfig, CONFIG_ATTEMPT_STATE_CARRIERS);
      if (callerCarrier !== null || lifecycleCarrier !== null || configCarrier !== null || configAttemptCarrier !== null) {
        return {
          schema_version: WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
          ...scopeAuthorityRefusal(WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER, {
            reason: lifecycleCarrier !== null || configAttemptCarrier !== null
              ? "caller_carried_managed_lifecycle_forbidden"
              : "caller_carried_scope_forbidden",
            field: callerCarrier ?? lifecycleCarrier ?? configCarrier ?? configAttemptCarrier,
            carrier: callerCarrier !== null || lifecycleCarrier !== null ? "dispatch_input" : "provisioning_config"
          })
        };
      }
    }
    if (input?.role !== "reviewer") {
      return lifecycle.startLaunch(input);
    }

    const contextCarrier = firstOwnField(input, CALLER_REVIEW_CONTEXT_CARRIERS);
    if (contextCarrier !== null) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "wk_context_review",
        reason: "caller_carried_review_context_forbidden",
        field: contextCarrier
      });
    }
    const context = frozenReviewContexts.get(input.subject);
    if (!context) {
      const subjectMatch = typeof input.subject === "string"
        ? input.subject.match(/^(WK-\d{4})#SLICE-\d{3}$/u)
        : null;
      if (subjectMatch) {
        const canonicalMainRepo = worktreeProvisioningConfig?.mainRepo ?? input.workspace_dir;
        const record = readCanonicalWorkRecord(canonicalMainRepo, subjectMatch[1]);
        if (!record) {
          return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
            capability: "wk_context_review",
            reason: "canonical_review_authority_unresolved",
            subject: input.subject
          });
        }
        if (record.status !== "review") {
          return lifecycle.startLaunch(input);
        }
        try {
          const canonicalUnit = resolveCanonicalFindingsOnlyReviewUnit(canonicalMainRepo, subjectMatch[1]);
          if (canonicalUnit.subject !== input.subject) {
            return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
              capability: "wk_context_review",
              reason: "canonical_review_subject_mismatch",
              subject: input.subject,
              canonical_subject: canonicalUnit.subject
            });
          }
        } catch (error) {
          return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
            capability: "wk_context_review",
            reason: "canonical_review_authority_unresolved",
            subject: input.subject,
            message: error?.message ?? String(error)
          });
        }
        return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
          capability: "wk_context_review",
          reason: "frozen_review_context_missing",
          subject: input.subject
        });
      }
      return lifecycle.startLaunch(input);
    }
    if (context.reservation_state === FROZEN_REVIEW_CONTEXT_STATES.CONSUMED) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "wk_context_review",
        reason: "frozen_review_context_already_consumed",
        subject: input.subject
      });
    }
    if (context.reservation_state === FROZEN_REVIEW_CONTEXT_STATES.RESERVED) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "wk_context_review",
        reason: "frozen_review_context_reserved",
        subject: input.subject
      });
    }
    if (path.resolve(input.workspace_dir ?? "") !== context.main_repo) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "wk_context_review",
        reason: "frozen_review_context_workspace_mismatch"
      });
    }
    try {
      const currentUnit = resolveCanonicalFindingsOnlyReviewUnit(context.main_repo, context.record_id);
      if (currentUnit.subject !== context.review_subject ||
          currentUnit.record_id !== context.record_id ||
          currentUnit.slice_id !== context.review_slice_id ||
          currentUnit.initiative !== context.initiative ||
          currentUnit.parent_status !== "review" ||
          currentUnit.canonical_parent_wk_contract !== context.canonical_parent_wk_contract ||
          currentUnit.review_unit_contract !== context.review_unit_contract) {
        throw new Error("canonical parent WK or findings-only review unit changed after the WK target was frozen");
      }
    } catch (error) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "wk_context_review",
        reason: "frozen_review_context_stale_or_mismatched",
        message: error?.message ?? String(error)
      });
    }
    const targetVerification = verifyFrozenWkReviewTargetAgainstObjectStore({
      mainRepo: context.main_repo,
      context,
      runGit: reviewContextRunGit
    });
    if (targetVerification.ok !== true) {
      if (targetVerification.kind === "transport") {

        return managedRefusal(RUNTIME_BLOCKER_CODES.REVIEW_TRANSPORT_RUNTIME_FAILURE, {
          capability: "wk_context_review",
          reason: "frozen_review_context_probe_transport_failure",
          detail: targetVerification.detail
        });
      }
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "wk_context_review",
        reason: "frozen_review_context_stale_or_mismatched",
        detail: targetVerification.detail
      });
    }

    frozenReviewContexts.set(input.subject, Object.freeze({
      ...context,
      reservation_state: FROZEN_REVIEW_CONTEXT_STATES.RESERVED
    }));
    let launch;
    try {
      launch = await lifecycle.startLaunch({
        ...input,
        workspace_dir: context.worktree_path,

        config_root_dir: context.main_repo,
        trusted_frozen_review_contract: context.trusted_frozen_review_contract,
        readiness: Object.freeze({
          ...(isPlainObject(input.readiness) ? input.readiness : {}),
          frozen_wk_review_target: Object.freeze({
            ref: context.wk_ref,
            sha: context.wk_sha,
            diff_base_sha: context.diff_base_sha,
            diff_head_sha: context.diff_head_sha,
            diff_range: context.diff_range,
            complete_parent_wk_contract: true,
            accumulated_wk_diff: true
          })
        })
      });
    } catch (error) {
      frozenReviewContexts.set(input.subject, context);
      throw error;
    }
    if (launch?.accepted === true) {
      frozenReviewContexts.set(input.subject, Object.freeze({
        ...context,
        reservation_state: FROZEN_REVIEW_CONTEXT_STATES.CONSUMED,
        consumed: true,
        consumed_by_run_id: launch.run_id
      }));
    } else {

      frozenReviewContexts.set(input.subject, context);

      if (launch?.refusal?.reason === "reviewer_model_unset" &&
          !existsSync(path.join(context.main_repo, AGENT_LAUNCH_ROLE_CONFIG_FILENAME))) {
        return managedRefusal(RUNTIME_BLOCKER_CODES.REVIEW_TRANSPORT_RUNTIME_FAILURE, {
          capability: "wk_context_review",
          reason: "reviewer_role_config_root_unreadable",
          detail: {
            config_root: context.main_repo,
            config_file: AGENT_LAUNCH_ROLE_CONFIG_FILENAME
          }
        });
      }
    }
    return launch;
  };

  const recoverIntegratedWorkerRun = async ({ workspace, monitor_handle, subject } = {}) => {
    if (postWorkerSliceLifecycle === null || !worktreeProvisioningConfig ||
        !workspace || path.resolve(workspace.dir ?? "") !== worktreeProvisioningConfig.mainRepo ||
        typeof monitor_handle !== "string" || typeof subject !== "string" ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject)) {
      return null;
    }
    const key = JSON.stringify([monitor_handle, subject]);
    if (!recoveredIntegratedRuns.has(key)) {
      const recovery = (async () => {
        try {
          const pair = resolveUniqueManagedLifecycleBindingPairForRecovery({
            mainRepo: worktreeProvisioningConfig.mainRepo,
            launchRef: monitor_handle,
            expectedSubject: subject
          });
          if (!pair) return null;
          const status = Object.freeze({
            accepted: true,
            recovered: true,
            run_id: pair.run_id,
            monitor_handle,
            app: null,
            role: "worker",
            subject,
            status: "succeeded",
            terminal: true,
            started_at: null,
            updated_at: null,
            exit: null,
            final_result: null
          });
          const lifecycleResult = await postWorkerSliceLifecycle({
            workspace,
            status,
            deps: {
              resolveManagedRunBinding: () => pair.provisioning,
              resolveCanonicalReviewUnit: ({ mainRepo, wkId }) =>
                resolveCanonicalFindingsOnlyReviewUnit(mainRepo, wkId),
              bindFrozenReviewContext,
              recoveryOnly: true
            }
          });
          if (!lifecycleResult || lifecycleResult.phase !== "finalized" ||
              lifecycleResult.integration?.recovered !== true) {
            return null;
          }
          return Object.freeze({ status, lifecycle: lifecycleResult });
        } catch {
          return null;
        }
      })();
      recoveredIntegratedRuns.set(key, recovery);
    }
    const pending = recoveredIntegratedRuns.get(key);
    const result = await pending;
    if (result === null && recoveredIntegratedRuns.get(key) === pending) {

      recoveredIntegratedRuns.delete(key);
    }
    return result;
  };

  const getManagedLifecycleCapabilityAuthorityFacts = async () => Object.freeze({
    native_edit: managedLifecycleCapabilityFact(
      Object.keys(executors).length > 0,
      "agent_launch.dispatch_backend.executor_registry"
    ),
    repository_read_boundary: managedLifecycleCapabilityFact(
      hasManagedConfinementActivation(worktreeProvisioningConfig),
      "agent_launch.dispatch_backend.repository_read_boundary"
    ),
    commit: managedLifecycleCapabilityFact(
      closedInputCommitCompositionInstalled,
      "agent_launch.dispatch_backend.closed_input_commit_composition"
    ),
    managed_worktree_provisioning: managedLifecycleCapabilityFact(
      worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.worktree_provisioning"
    ),
    slice_to_wk_integration: managedLifecycleCapabilityFact(
      postWorkerSliceLifecycle !== null && worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.terminal_slice_integration"
    ),
    wk_context_review: managedLifecycleCapabilityFact(
      postWorkerSliceLifecycle !== null && worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.frozen_wk_review_context"
    ),
    automatic_main_promotion: managedLifecycleCapabilityFact(
      false,
      "agent_launch.dispatch_backend.main_promotion_unwired"
    )
  });

  return {
    schema_version: WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
    startLaunch,
    getRunStatus: lifecycle.getRunStatus,
    waitForRunStatus: lifecycle.waitForRunStatus,
    planLaunch: lifecycle.planLaunch,
    getManagedLifecycleCapabilityAuthorityFacts,
    ...(runPostWorkerSliceLifecycle !== null
      ? { runPostWorkerSliceLifecycle, recoverIntegratedWorkerRun }
      : {}),

    __snapshotRuns: lifecycle.snapshotRuns,
    __snapshotFrozenReviewContexts: () => [...frozenReviewContexts.values()],

    ...(options.__testHooks === true
      ? {
          __deleteRunForTest: (runId) => runs.delete(runId),
          __replaceReviewerLaunchIdentityForTest:
            lifecycle.replaceReviewerLaunchIdentityForTest
        }
      : {}),
    __resolveCanonicalFindingsOnlyReviewUnit: (mainRepo, wkId) =>
      resolveCanonicalFindingsOnlyReviewUnit(mainRepo, wkId)
  };
}
