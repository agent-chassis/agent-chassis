

import {
  AGENT_CHILD_TOOL_SURFACE_SCHEMA_VERSION
} from "./agent-child-tool-surface.mjs";
import {
  MANAGED_WORKTREE_BINDING_SCHEMA_VERSION,
  WORKTREE_PROVISIONING_DISPATCH_SCHEMA_VERSION
} from "./worktree-provisioning-dispatch.mjs";

export const WK_SUBJECT_RE = /^(WK-\d{4})(?:#[A-Za-z0-9._-]+)?$/;
export const EXACT_IMPLEMENTATION_SLICE_RE = /^(WK-\d{4})#(SLICE-\d{3})$/;

export const WORKSPACE_AGENT_FROZEN_SCOPE_AUTHORITY_SCHEMA_VERSION =
  "workspace-agent-frozen-scope-authority.v1";

export const WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V1 = "worktree-identity-binding.v1";
export const WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2 = "worktree-identity-binding.v2";
export const WORKTREE_CHECKOUT_MODE_FULL = "full";
export const WORKSPACE_AGENT_LAUNCH_CORE_SCHEMA_VERSION = "workspace-agent-launch-core.v1";
export const MANAGED_WORKER_CONFINEMENT_ACTIVATION_SCHEMA_VERSION =
  "managed-worker-confinement-activation.v1";
export const MANAGED_WORKER_ATTEMPT_STATE_SCHEMA_VERSION =
  "managed-worker-attempt-state.v1";
export const WORKER_READ_BOUNDARY_UNSUPPORTED_BLOCKER =
  "worker_read_boundary_unsupported";
export const WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER = "worker_scope_authority_invalid";
export const SUPPORTED_WORKER_READ_BOUNDARY_FAMILIES = Object.freeze(["codex"]);
export const SUPPORTED_WORKER_READ_BOUNDARY_BACKENDS = Object.freeze(["bwrap"]);
export const CALLER_SCOPE_CARRIERS = Object.freeze([
  "readScope", "read_scope", "repoPaths", "repo_paths", "writeScope", "write_scope",
  "readableScope", "readable_scope", "selectedUnit", "selected_unit", "sourceDigest",
  "source_digest", "sourceVersion", "source_version", "workerScopeAuthority",
  "worker_scope_authority",

  "checkoutMode", "checkout_mode"
]);
export const CALLER_MANAGED_LIFECYCLE_CARRIERS = Object.freeze([
  "retryId", "retry_id", "priorIdentity", "prior_identity", "livenessDeps",
  "liveness_deps", "attemptState", "attempt_state", "resolveAttemptState",
  "resolve_attempt_state", "mainRepo", "main_repo", "worktreeRoot",
  "worktree_root", "sharedDependencyRoot", "shared_dependency_root",
  "cacheRoot", "cache_root", "confinementAvailable", "confinement_available",
  "managedConfinementActivation", "managed_confinement_activation", "env", "argv",
  "claimedIdentity", "claimed_identity"
]);
export const CALLER_REVIEW_CONTEXT_CARRIERS = Object.freeze([
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
export const CONFIG_ATTEMPT_STATE_CARRIERS = Object.freeze([
  "resolveAttemptState", "resolveProvisioningAttemptState", "getAttemptState",
  "getProvisioningAttemptState", "attemptState", "attempt_state", "retryId",
  "retry_id", "priorIdentity", "prior_identity", "livenessDeps", "liveness_deps"
]);
export const REMOVED_MANAGED_PROVISIONING_ROOT_FIELDS = Object.freeze([
  "sharedDependencyRoot", "shared_dependency_root", "cacheRoot", "cache_root"
]);

export const EXPECTED_MANAGED_CONFINEMENT_ACTIVATION = Object.freeze({
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

export const EXPECTED_CLOSED_INPUT_COMMIT_COMPOSITION = Object.freeze({
  schema_version: "workspace-closed-input-commit-composition.v1",
  installed: true,
  tool_name: "commit",
  input_contract: "closed",
  binding_authority: "server_resolved"
});

export const FROZEN_REVIEW_CONTEXT_STATES = Object.freeze({
  AVAILABLE: "available",
  RESERVED: "reserved",
  CONSUMED: "consumed"
});
export const RETAINED_REVIEWER_LAUNCH_IDENTITY_FIELDS = Object.freeze([
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
export const FROZEN_REVIEW_CONTRACT_IDENTITY_FIELDS = Object.freeze([
  "canonical_parent_wk_contract",
  "review_subject",
  "review_unit_contract",
  "schema_version"
]);
