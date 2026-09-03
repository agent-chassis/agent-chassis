import { realpathSync } from "node:fs";
import path from "node:path";

import {
  assertMaterializedImmutableCandidateCurrent,
  ImmutableCandidateError,
  materializeImmutableCandidate,
  resolveImmutableExactCommitCandidate
} from "./backend-immutable-candidate.mjs";
import { resolveAuthenticatedConfiguredWorktree } from
  "./backend-review-target-resolver.mjs";
import { defaultRunGit } from "./worktree-substrate.mjs";
import { mintOrchestratorProofAuthority } from
  "./workspace-agent-test-proof-runtime-identity.mjs";

export const ORCHESTRATOR_TEST_PROOF_RUNTIME_SCHEMA_VERSION =
  "workspace-agent-orchestrator-test-proof-runtime.v1";

export const ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES = Object.freeze({
  GIT_OBJECT_MISSING: "verify_proof.git_object_missing.v1",
  INPUT_FORBIDDEN: "verify_proof.orchestrator_runtime_input_forbidden.v1",
  INPUT_INVALID: "verify_proof.orchestrator_runtime_input_invalid.v1",
  REPOSITORY_IDENTITY: "verify_proof.configured_repository_identity_refused.v1",
  WORKTREE_BINDING: "verify_proof.existing_worktree_binding_refused.v1",
  WORKTREE_MOVED: "verify_proof.existing_worktree_moved.v1"
});

const OID_RE = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const ROOT_UNIT_RE = /^WK-[0-9]{4}$/u;
const ALLOWED_KEYS = new Set([
  "gitSha", "mainRepo", "repository", "selectedUnit", "worktreeRoot"
]);

export class OrchestratorTestProofRuntimeError extends Error {
  constructor(code, message, detail = null, cause = null) {
    super(message, cause === null ? undefined : { cause });
    this.name = "OrchestratorTestProofRuntimeError";
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = null, cause = null) {
  throw new OrchestratorTestProofRuntimeError(code, message, detail, cause);
}

function assertClosedInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(
    ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES.INPUT_INVALID,
    "orchestrator proof runtime requires one closed server-owned input object"
  );
  const unsupported = Object.keys(input).filter((key) => !ALLOWED_KEYS.has(key)).sort();
  if (unsupported.length > 0) fail(
    ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES.INPUT_FORBIDDEN,
    "orchestrator proof runtime refuses caller-selected execution or authority input",
    { unsupported }
  );
  if (typeof input.mainRepo !== "string" || !path.isAbsolute(input.mainRepo) ||
      realpathSync(input.mainRepo) !== input.mainRepo ||
      typeof input.repository !== "string" || input.repository.length === 0 ||
      !ROOT_UNIT_RE.test(input.selectedUnit ?? "") ||
      (input.gitSha !== undefined &&
        (typeof input.gitSha !== "string" || !OID_RE.test(input.gitSha) ||
          /^0+$/u.test(input.gitSha))) ||
      (input.gitSha !== undefined &&
        (typeof input.worktreeRoot !== "string" || !path.isAbsolute(input.worktreeRoot)))) fail(
    ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES.INPUT_INVALID,
    "orchestrator proof runtime requires one configured repository and launcher-owned exact-SHA materialization root"
  );
}

function notExecutable(reasonCode, action) {
  return Object.freeze({
    schema_version: ORCHESTRATOR_TEST_PROOF_RUNTIME_SCHEMA_VERSION,
    status: "not_executable",
    reason_code: reasonCode,
    candidate_identity: null,
    recovery: Object.freeze({
      state: "exact_commit_required",
      action,
      retry_operation: "workspace_verify_proof"
    })
  });
}

function resolveCurrentWorktree(input, runGit) {
  try {
    return resolveAuthenticatedConfiguredWorktree({
      mainRepo: input.mainRepo,
      runGit
    });
  } catch (error) {
    fail(ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES.WORKTREE_BINDING,
      "configured current worktree could not be authenticated",
      { selector: "current_main" }, error);
  }
}

function sameIdentity(left, right) {
  return left?.authenticated_worktree_identity === right?.authenticated_worktree_identity &&
    left?.worktree_path === right?.worktree_path && left?.commit === right?.commit &&
    left?.tree === right?.tree && left?.clean === right?.clean &&
    left?.status_digest === right?.status_digest;
}

function exactCandidateOrResult(input, runGit) {
  try {
    return resolveImmutableExactCommitCandidate({
      mainRepo: input.mainRepo, gitSha: input.gitSha, runGit
    });
  } catch (error) {
    if (!(error instanceof ImmutableCandidateError)) throw error;
    if (error.detail?.reason === "commit_object_unavailable") return notExecutable(
      ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES.GIT_OBJECT_MISSING,
      "fetch_the_exact_commit_then_retry"
    );
    throw error;
  }
}

function runtimeFor(input, authority, assertCurrentIdentity) {
  return Object.freeze({
    schema_version: ORCHESTRATOR_TEST_PROOF_RUNTIME_SCHEMA_VERSION,
    status: "ready",
    role: "orchestrator",
    authority,
    candidateIdentity: authority.candidate_identity,
    selectedUnitAddress: input.selectedUnit,
    assertCurrentIdentity
  });
}

async function useCurrentWorktree(input, use, runGit) {
  const initial = resolveCurrentWorktree(input, runGit);
  const authority = mintOrchestratorProofAuthority({
    mainRepo: input.mainRepo,
    repository: input.repository,
    selectedUnit: input.selectedUnit,
    worktreePath: initial.worktree_path,
    selector: initial.selector,
    commit: initial.commit,
    tree: initial.tree,
    clean: initial.clean,
    candidateKind: "existing_worktree",
    authenticatedCandidateIdentity: initial.authenticated_worktree_identity
  });
  const assertCurrentIdentity = () => {
    const current = resolveCurrentWorktree(input, runGit);
    if (!sameIdentity(initial, current)) fail(
      ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES.WORKTREE_MOVED,
      "configured current worktree moved during proof verification",
      { selector: "current_main" }
    );
    return current;
  };
  const runtime = runtimeFor(input, authority, assertCurrentIdentity);
  let value;
  let primary = null;
  try {
    assertCurrentIdentity();
    value = await use(runtime);
  } catch (error) {
    primary = error;
  }
  try {
    assertCurrentIdentity();
  } catch (error) {
    fail(ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES.WORKTREE_MOVED,
      "configured current worktree moved during proof verification",
      { selector: "current_main", primary_error_code:
        typeof primary?.code === "string" ? primary.code : null }, error);
  }
  if (primary !== null) throw primary;
  return value;
}

async function useExactCommit(input, use, runGit) {
  const candidate = exactCandidateOrResult(input, runGit);
  if (candidate.status === "not_executable") return candidate;
  const materialized = materializeImmutableCandidate({
    candidate, worktreeRoot: input.worktreeRoot, runGit
  });
  let value;
  let primary = null;
  try {
    const authority = mintOrchestratorProofAuthority({
      mainRepo: input.mainRepo,
      repository: input.repository,
      selectedUnit: input.selectedUnit,
      worktreePath: materialized.checkout.worktree_path,
      selector: { kind: "exact_sha", value: candidate.commit },
      commit: candidate.commit,
      tree: candidate.tree,
      clean: true,
      candidateKind: "immutable_exact_commit",
      authenticatedCandidateIdentity: candidate.authenticated_candidate_identity
    });
    const assertCurrentIdentity = () => assertMaterializedImmutableCandidateCurrent({
      materialized, runGit
    });
    const runtime = runtimeFor(input, authority, assertCurrentIdentity);
    assertCurrentIdentity();
    value = await use(runtime);
    assertCurrentIdentity();
  } catch (error) {
    primary = error;
  }
  materialized.cleanup({
    primaryErrorCode: typeof primary?.code === "string" ? primary.code : null
  });
  if (primary !== null) throw primary;
  return value;
}

export async function withOrchestratorTestProofRuntime(input = {}, use, {
  runGit = defaultRunGit
} = {}) {
  assertClosedInput(input);
  if (typeof use !== "function") fail(
    ORCHESTRATOR_TEST_PROOF_RUNTIME_CODES.INPUT_INVALID,
    "orchestrator proof runtime requires one bounded server-owned consumer"
  );
  return input.gitSha === undefined
    ? useCurrentWorktree(input, use, runGit)
    : useExactCommit(input, use, runGit);
}
