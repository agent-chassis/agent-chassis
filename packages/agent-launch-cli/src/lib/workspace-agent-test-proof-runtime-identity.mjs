import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync
} from "node:fs";
import path from "node:path";

import {
  SCHEMA_VERSION_V1,
  STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS,
  classifyStableTestProofRuntimeReadiness
} from "@agent-chassis/controlled-contract";

import {
  assertTrustedManagedWorkerTestRunAuthority
} from "./managed-worker-test-run-authority.mjs";
import {
  assertTerminalCandidateMaterialization,
  verifyTerminalCandidateCheckout
} from "./terminal-review-materialization.mjs";
import { defaultTerminalCandidateRunGit } from "./terminal-wk-candidate.mjs";
import {
  assertSelectedDependencyMountIntegrity,
  selectOptionalReviewerDependencyProjection,
  verifyTerminalCandidateDependencies
} from "./terminal-wk-candidate-validation.mjs";

export const TEST_PROOF_RUNTIME_IDENTITY_SCHEMA_VERSION =
  "workspace-agent-test-proof-runtime-identity.v1";
export const TEST_PROOF_SOURCE_SNAPSHOT_SCHEMA_VERSION =
  "workspace-agent-test-proof-source-snapshot.v1";
export const ORCHESTRATOR_PROOF_CANDIDATE_IDENTITY_SCHEMA_VERSION =
  "workspace-agent-orchestrator-proof-candidate-identity.v1";

const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const RUNTIME_AUTHORITIES = new WeakSet();
const RUNTIME_CONTEXTS = new WeakSet();
const OID_RE = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const UNIT_RE = /^WK-[0-9]{4}(?:#SLICE-[0-9]{3})?$/u;

export class TestProofRuntimeIdentityError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "TestProofRuntimeIdentityError";
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = null) {
  throw new TestProofRuntimeIdentityError(code, message, detail);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])])
  );
  return value;
}

function digestCanonical(value) {
  return `sha256:${createHash("sha256")
    .update(`${JSON.stringify(canonicalJson(value))}\n`, "utf8").digest("hex")}`;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function mintAuthority(value) {
  const authority = deepFreeze(value);
  RUNTIME_AUTHORITIES.add(authority);
  return authority;
}

function optionalDependencyProof({ mainRepo, worktreePath, projectionKind }) {
  const projectionRoot = path.join(
    path.dirname(worktreePath),
    projectionKind,
    path.basename(worktreePath)
  );
  const selection = selectOptionalReviewerDependencyProjection({
    mainRepo,
    checkoutPath: worktreePath,
    projectionRoot
  });
  const projection = selection.projection;
  return deepFreeze({
    schema_version: "managed-worker-test-proof-dependency.v1",
    projection_selected: selection.selected === true,
    projection_unavailable_reason: selection.reason_code,
    projection_root: projection?.projection_root ?? null,
    projection_identity: projection?.projection_identity ?? null,
    dependency_installation_digest: projection?.installation_digest ?? null,
    reviewer_read_only_bind: projection?.read_only_bind ?? null,
    reviewer_read_only_binds: projection === null ? [] : projection.read_only_binds,
    workspace_links_resolve_against_reviewed_checkout:
      projection?.workspace_links_resolve_against_reviewed_checkout ?? false
  });
}

function noDependencyProof() {
  return deepFreeze({
    schema_version: "managed-worker-test-proof-dependency.v1",
    projection_selected: false,
    projection_unavailable_reason: "orchestrator_existing_worktree",
    projection_root: null,
    projection_identity: null,
    dependency_installation_digest: null,
    reviewer_read_only_bind: null,
    reviewer_read_only_binds: [],
    workspace_links_resolve_against_reviewed_checkout: false
  });
}

function assertOrchestratorSourceInput({ mainRepo, repository, selectedUnit }) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) ||
      realpathSync(mainRepo) !== mainRepo ||
      typeof repository !== "string" || repository.length === 0 ||
      !UNIT_RE.test(selectedUnit ?? "")) fail(
    "test_proof_orchestrator_source_identity_invalid",
    "orchestrator proof source requires the configured canonical repository and unit"
  );
}

function orchestratorRunId(value) {
  return `run-orchestrator-${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function mintOrchestratorProofAuthority({
  mainRepo,
  repository,
  selectedUnit,
  worktreePath,
  selector,
  commit,
  tree,
  clean,
  candidateKind,
  authenticatedCandidateIdentity
} = {}) {
  assertOrchestratorSourceInput({ mainRepo, repository, selectedUnit });
  if (typeof worktreePath !== "string" || !path.isAbsolute(worktreePath) ||
      realpathSync(worktreePath) !== worktreePath ||
      !selector || !["current_main", "exact_sha"].includes(selector.kind) ||
      !["existing_worktree", "immutable_exact_commit"].includes(candidateKind) ||
      (selector.kind === "current_main" && candidateKind !== "existing_worktree") ||
      (selector.kind === "exact_sha" && candidateKind !== "immutable_exact_commit") ||
      typeof authenticatedCandidateIdentity !== "string" ||
      !DIGEST_RE.test(authenticatedCandidateIdentity) || typeof clean !== "boolean") fail(
    "test_proof_orchestrator_worktree_identity_invalid",
    "orchestrator proof execution requires one authenticated existing worktree"
  );
  if (!OID_RE.test(commit ?? "") || /^0+$/u.test(commit ?? "") ||
      !OID_RE.test(tree ?? "") || /^0+$/u.test(tree ?? "")) fail(
    "test_proof_orchestrator_git_identity_invalid",
    "orchestrator existing worktree requires resolved commit and tree identities"
  );
  const sourceSnapshotBody = {
    schema_version: TEST_PROOF_SOURCE_SNAPSHOT_SCHEMA_VERSION,
    algorithm: `sha256-authenticated-${candidateKind}-v1`,
    exclusions: [],
    runtime_dependency: {
      projection_selected: false,
      dependency_installation_digest: null
    },
    selected_source: {
      authenticated_candidate_identity: authenticatedCandidateIdentity,
      commit,
      tree,
      clean
    },
    entries: []
  };
  const sourceSnapshot = deepFreeze({
    ...sourceSnapshotBody,
    source_snapshot_digest: digestCanonical(sourceSnapshotBody)
  });
  const candidateIdentity = deepFreeze({
    schema_version: ORCHESTRATOR_PROOF_CANDIDATE_IDENTITY_SCHEMA_VERSION,
    candidate_kind: candidateKind,
    selector: { ...selector },
    configured_repository: repository,
    commit,
    tree,
    clean,
    authenticated_candidate_identity: authenticatedCandidateIdentity,
    selected_unit: selectedUnit,
    runtime_owner: "workspace-agent-test-proof-runtime-identity"
  });
  return mintAuthority({
    schema_version: TEST_PROOF_RUNTIME_IDENTITY_SCHEMA_VERSION,
    candidate_identity_schema_version: ORCHESTRATOR_PROOF_CANDIDATE_IDENTITY_SCHEMA_VERSION,
    kind: "orchestrator_git_commit",
    run_id: orchestratorRunId(
      `${repository}\0${candidateKind}\0${selector.kind}\0${commit}\0${tree}\0${authenticatedCandidateIdentity}`
    ),
    wk_id: selectedUnit.split("#")[0],
    selected_unit: selectedUnit,
    main_repo: mainRepo,
    configured_repository: repository,
    worktree_path: worktreePath,
    attempt: 1,
    commit,
    tree,
    head: commit,
    dirty: !clean,
    selector: deepFreeze({ ...selector }),
    authenticated_candidate_identity: authenticatedCandidateIdentity,
    source_snapshot: sourceSnapshot,
    source_snapshot_digest: sourceSnapshot.source_snapshot_digest,
    candidate_identity: candidateIdentity,
    dependency_proof: noDependencyProof()
  });
}

export function mintManagedWorkerTestProofRuntimeAuthority({ authority } = {}) {
  const managed = assertTrustedManagedWorkerTestRunAuthority(authority);
  if (typeof managed.run_id !== "string" || !/^run-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(
    managed.run_id
  )) fail("test_proof_run_identity_invalid",
    "managed proof execution requires the launcher-authenticated run identity");
  const dependencyProof = optionalDependencyProof({
    mainRepo: managed.main_repo,
    worktreePath: managed.worktree_path,
    projectionKind: ".worker-declared-test-dependency"
  });
  return mintAuthority({
    schema_version: TEST_PROOF_RUNTIME_IDENTITY_SCHEMA_VERSION,
    kind: "managed_worker",
    run_id: managed.run_id,
    wk_id: managed.record_id,
    selected_unit: managed.unit_address,
    main_repo: managed.main_repo,
    worktree_path: managed.worktree_path,
    attempt: 1,
    dependency_proof: dependencyProof,
    managed_authority: managed
  });
}

export async function mintTerminalCandidateTestProofRuntimeAuthority({
  binding,
  materialization,
  runGit = defaultTerminalCandidateRunGit
} = {}) {
  if (runGit !== defaultTerminalCandidateRunGit) fail(
    "test_proof_terminal_authority_untrusted",
    "terminal proof authority requires the launcher-fixed Git implementation"
  );
  assertTerminalCandidateMaterialization(materialization, binding);
  await verifyTerminalCandidateCheckout({
    binding,
    candidateRoot: materialization.candidate_root,
    runGit
  });
  const dependencyProof = verifyTerminalCandidateDependencies({ binding, materialization });
  if (!/^WK-[0-9]{4}$/u.test(binding.canonical_wk_id ?? "") ||
      !/^[a-f0-9]{40,64}$/u.test(binding.candidate ?? "")) fail(
    "test_proof_terminal_authority_invalid",
    "terminal proof authority requires one exact candidate-bound WK identity"
  );
  return mintAuthority({
    schema_version: TEST_PROOF_RUNTIME_IDENTITY_SCHEMA_VERSION,
    kind: "terminal_candidate",
    run_id: `run-terminal-${binding.candidate}`,
    wk_id: binding.canonical_wk_id,
    selected_unit: binding.canonical_wk_id,
    main_repo: binding.main_repo,
    worktree_path: materialization.checkout_path,
    attempt: 1,
    dependency_proof: dependencyProof,
    terminal_candidate: binding.candidate,
    terminal_base: binding.base,
    terminal_wk_tip: binding.wk_tip
  });
}

async function assertManagedReviewerCheckoutCurrent(authority) {
  const probes = await Promise.all([
    defaultTerminalCandidateRunGit({
      repo: authority.worktree_path,
      args: ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{commit}"]
    }),
    defaultTerminalCandidateRunGit({
      repo: authority.worktree_path,
      args: ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{tree}"]
    }),
    defaultTerminalCandidateRunGit({
      repo: authority.worktree_path,
      args: ["--no-replace-objects", "status", "--porcelain=v1", "--untracked-files=all"]
    })
  ]);
  const commit = probes[0]?.ok === true ? String(probes[0].stdout ?? "").trim() : null;
  const tree = probes[1]?.ok === true ? String(probes[1].stdout ?? "").trim() : null;
  const dirty = probes[2]?.ok === true ? String(probes[2].stdout ?? "") : null;
  if (commit !== authority.reviewer_candidate || tree !== authority.reviewer_tree || dirty !== "") {
    fail("test_proof_reviewer_candidate_moved",
      "managed reviewer proof candidate changed or became dirty", {
        expected_commit: authority.reviewer_candidate,
        actual_commit: commit,
        expected_tree: authority.reviewer_tree,
        actual_tree: tree,
        status_available: dirty !== null,
        clean: dirty === ""
      });
  }
  return authority;
}

export async function mintManagedReviewerTestProofRuntimeAuthority({
  mainRepo,
  worktreePath,
  runId,
  wkId,
  selectedUnit,
  reviewedSha,
  reviewedTree
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) ||
      typeof worktreePath !== "string" || !path.isAbsolute(worktreePath) ||
      realpathSync(mainRepo) !== mainRepo || realpathSync(worktreePath) !== worktreePath ||
      !/^run-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(runId ?? "") ||
      !/^WK-[0-9]{4}$/u.test(wkId ?? "") ||
      !/^WK-[0-9]{4}#SLICE-[0-9]{3}$/u.test(selectedUnit ?? "") ||
      !/^[a-f0-9]{40,64}$/u.test(reviewedSha ?? "") ||
      !/^[a-f0-9]{40,64}$/u.test(reviewedTree ?? "")) {
    fail("test_proof_reviewer_authority_invalid",
      "managed reviewer proof authority requires launcher-resolved exact-candidate facts");
  }
  const dependencyProof = optionalDependencyProof({
    mainRepo,
    worktreePath,
    projectionKind: ".reviewer-verify-proof-dependency"
  });
  const authority = mintAuthority({
    schema_version: TEST_PROOF_RUNTIME_IDENTITY_SCHEMA_VERSION,
    kind: "managed_reviewer",
    run_id: runId,
    wk_id: wkId,
    selected_unit: selectedUnit,
    main_repo: mainRepo,
    worktree_path: worktreePath,
    attempt: 1,
    dependency_proof: dependencyProof,
    candidate_identity: reviewedSha,
    reviewer_candidate: reviewedSha,
    reviewer_tree: reviewedTree,
    independent_execution: true
  });
  await assertManagedReviewerCheckoutCurrent(authority);
  return authority;
}

export async function assertManagedReviewerTestProofRuntimeCurrent(authority) {
  const trusted = assertLauncherTestProofRuntimeAuthority(authority);
  if (trusted.kind !== "managed_reviewer") fail(
    "test_proof_reviewer_authority_invalid",
    "reviewer current-identity checks require managed reviewer authority"
  );
  return assertManagedReviewerCheckoutCurrent(trusted);
}

export function mintIntegratedSliceTestProofRuntimeAuthority({
  integratedState,
  mainRepo,
  wkRef,
  wkTip,
  forkRef,
  fork,
  checkout
} = {}) {
  if (!/^WK-[0-9]{4}$/u.test(integratedState?.record_id ?? "") ||
      !/^SLICE-[0-9]{3}$/u.test(integratedState?.slice_id ?? "") ||
      !/^IN-[0-9]{4}$/u.test(integratedState?.initiative ?? "") ||
      typeof integratedState?.lifecycle_state !== "string") fail(
    "test_proof_integrated_state_invalid",
    "integrated proof authority requires one canonical integrated slice state");
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) fail(
    "test_proof_integrated_repository_invalid",
    "integrated proof authority requires the canonical repository path");
  if (!/^refs\/heads\/wk\/IN-[0-9]{4}\/WK-[0-9]{4}$/u.test(wkRef ?? "") ||
      !/^[a-f0-9]{40,64}$/u.test(wkTip ?? "") ||
      !/^refs\/agent-launch\/wk-forks\/IN-[0-9]{4}\/WK-[0-9]{4}$/u.test(forkRef ?? "") ||
      !/^[a-f0-9]{40,64}$/u.test(fork ?? "")) fail(
    "test_proof_integrated_ref_authority_invalid",
    "integrated proof authority requires the launcher-owned fixed WK ref and tip");
  if (checkout?.verified !== true || checkout?.detached !== true ||
      checkout?.full_checkout !== true || checkout?.commit !== wkTip ||
      checkout?.main_repo !== mainRepo ||
      typeof checkout?.checkout_path !== "string") fail(
    "test_proof_integrated_checkout_invalid",
    "integrated proof authority requires one verified private checkout at the exact tip");
  const dependencyProof = optionalDependencyProof({
    mainRepo,
    worktreePath: checkout.checkout_path,
    projectionKind: ".integrated-test-proof-dependency"
  });
  return mintAuthority({
    schema_version: TEST_PROOF_RUNTIME_IDENTITY_SCHEMA_VERSION,
    kind: "integrated_slice",
    run_id: `run-integrated-${wkTip}`,
    wk_id: integratedState.record_id,
    selected_unit: `${integratedState.record_id}#${integratedState.slice_id}`,
    main_repo: mainRepo,
    worktree_path: checkout.checkout_path,
    attempt: 1,
    dependency_proof: dependencyProof,
    initiative: integratedState.initiative,
    lifecycle_state: integratedState.lifecycle_state,
    integrated_wk_ref: wkRef,
    integrated_wk_tip: wkTip,
    integrated_fork_ref: forkRef,
    integrated_fork: fork
  });
}

export function assertLauncherTestProofRuntimeAuthority(authority) {
  if (authority === null || typeof authority !== "object" ||
      !Object.isFrozen(authority) || !RUNTIME_AUTHORITIES.has(authority) ||
      authority.schema_version !== TEST_PROOF_RUNTIME_IDENTITY_SCHEMA_VERSION) fail(
    "test_proof_runtime_authority_untrusted",
    "test-proof execution requires launcher-minted runtime authority"
  );
  return authority;
}

const SNAPSHOT_EXCLUDED_NAMES = new Set([".agent-launch", ".git", "node_modules"]);
function snapshotEntries(root, directory = root, entries = []) {
  const topLevel = directory === root;
  for (const name of readdirSync(directory).sort()) {
    const absolute = path.join(directory, name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (topLevel && SNAPSHOT_EXCLUDED_NAMES.has(name)) continue;
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) {
      entries.push({ path: relative, kind: "directory", mode: stat.mode & 0o777 });
      snapshotEntries(root, absolute, entries);
    } else if (stat.isFile()) {
      entries.push({
        path: relative,
        kind: "file",
        mode: stat.mode & 0o777,
        digest: `sha256:${createHash("sha256").update(readFileSync(absolute)).digest("hex")}`
      });
    } else if (stat.isSymbolicLink()) {
      fail("test_proof_source_snapshot_symlink_unsupported",
        "source snapshot refuses symlinks because link-target bytes are not authenticated",
        { path: relative });
    } else fail("test_proof_source_snapshot_unsupported_entry",
      "source snapshot encountered a non-file repository entry", { path: relative });
  }
  return entries;
}

export function captureLauncherTestProofSourceSnapshot(authority) {
  const trusted = assertLauncherTestProofRuntimeAuthority(authority);
  if (trusted.kind === "orchestrator_git_commit") return trusted.source_snapshot;
  if (trusted.dependency_proof?.projection_selected === true) {
    assertSelectedDependencyMountIntegrity(trusted.dependency_proof);
  }
  const root = realpathSync(trusted.worktree_path);
  if (root !== trusted.worktree_path) fail("test_proof_source_snapshot_root_mismatch",
    "launcher proof execution root is not canonical");
  const body = {
    schema_version: TEST_PROOF_SOURCE_SNAPSHOT_SCHEMA_VERSION,
    algorithm: "sha256-canonical-json-repository-source-v1",
    exclusions: [...SNAPSHOT_EXCLUDED_NAMES].sort(),

    runtime_dependency: {
      projection_selected: trusted.dependency_proof?.projection_selected === true,
      dependency_installation_digest:
        trusted.dependency_proof?.dependency_installation_digest ?? null
    },
    entries: snapshotEntries(root)
  };
  return deepFreeze({
    ...body,
    source_snapshot_digest: digestCanonical(body)
  });
}

export function canonicalTestProofCommandIdentity(target) {
  if (typeof target !== "string" || target.length === 0 || path.isAbsolute(target) ||
      path.posix.normalize(target) !== target || target.startsWith("../")) fail(
    "test_proof_command_target_invalid",
    "test-proof command target must be one normalized repository-relative path"
  );
  const digest = digestCanonical({ operation: "node_test", target });
  return Object.freeze({
    command_id: `command-${digest.slice("sha256:".length)}`,
    command_target: target
  });
}

function selectedBinding(selection, verificationId) {
  if (selection?.status !== "complete" || !Array.isArray(selection.bindings) ||
      selection.matched_count !== selection.bindings.length ||
      selection.requested_count !== selection.bindings.length) fail(
    "test_proof_contract_binding_incomplete",
    "authenticated controlled-contract selection must contain every requested binding"
  );
  const matches = selection.bindings.filter(
    (binding) => binding?.verification_claim_id === verificationId
  );
  if (matches.length !== 1) fail(
    "test_proof_contract_binding_mismatch",
    "controlled-contract selection does not contain one exact requested verification binding"
  );
  return matches[0];
}

const RUNTIME_READINESS_FAILURE_CODES = Object.freeze({
  [STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.MISSING_INVENTORY]:
    "test_proof_runtime_inventory_missing",
  [STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.MISSING_SELECTION]:
    "test_proof_runtime_test_selection_missing",
  [STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.INVALID_SELECTION]:
    "test_proof_runtime_test_selection_invalid"
});

function packageReadyRuntimeTestIdentity(binding, { wkId, verificationId }) {
  const readiness = classifyStableTestProofRuntimeReadiness(binding);
  if (readiness.status !== "ready") fail(
    RUNTIME_READINESS_FAILURE_CODES[readiness.reason],
    "production evidence requires one package-ready stable runtime test identity",
    {
      readiness_reason: readiness.reason,
      candidate_test_ids: readiness.current_test_ids.slice(0, 16),
      candidate_total: readiness.candidate_total,
      candidate_test_ids_omitted:
        Math.max(readiness.candidate_total - 16, 0),
      selected_test_id: readiness.selected_test_id,
      authority_limb: "mechanical_failure",
      admissibility_effect: "none",
      recovery_operation: "workspace_controlled_test_proof_patch",
      complete_retrieval: {
        tool: "workspace_controlled_test_proof_query",
        arguments: { wk_id: wkId, verification_ids: [verificationId] }
      }
    }
  );
  return readiness.runtime_test_identity;
}

function assertGenerationBoundToSnapshot(selection, snapshot, wkId, authority) {
  const carriers = selection?.controlled_contract_generation_carriers;
  if (!Array.isArray(carriers) || carriers.length === 0 ||
      selection.controlled_contract_generation_carrier_count !== carriers.length ||
      carriers.some((entry) => typeof entry?.filename !== "string" ||
        !DIGEST_RE.test(entry?.content_digest ?? "") ||
        entry?.source_member?.schema_version !==
          "controlled-contract-authenticated-runtime-member.v1" ||
        entry.source_member.logical_filename !== entry.filename ||
        entry.source_member.content_digest !== entry.content_digest ||
        !["manifest_generation", "legacy_root"].includes(
          entry.source_member.storage_mode
        ) ||
        typeof entry.source_member.repository_relative_path !== "string" ||
        entry.source_member.repository_relative_path.length === 0 ||
        entry.source_member.repository_relative_path.length > 4096 ||
        path.posix.isAbsolute(entry.source_member.repository_relative_path) ||
        entry.source_member.repository_relative_path.includes("\\") ||
        entry.source_member.repository_relative_path.split("/").some((part) =>
          part === "" || part === "." || part === "..") ||
        (entry.source_member.storage_mode === "manifest_generation"
          ? !/^[a-f0-9]{64}$/u.test(entry.source_member.manifest_generation ?? "") ||
            !DIGEST_RE.test(entry.source_member.manifest_content_digest ?? "")
          : entry.source_member.manifest_generation !== null ||
            entry.source_member.manifest_content_digest !== null))) fail(
    "test_proof_controlled_contract_generation_invalid",
    "controlled-contract generation requires its complete authenticated carrier population"
  );
  const normalized = carriers.map((entry) => ({
    filename: entry.filename,
    content_digest: entry.content_digest
  })).sort((left, right) => left.filename.localeCompare(right.filename));
  const observedOrder = carriers.map((entry) => ({
    filename: entry.filename,
    content_digest: entry.content_digest
  }));
  if (JSON.stringify(normalized) !== JSON.stringify(observedOrder)) fail(
    "test_proof_controlled_contract_generation_invalid",
    "controlled-contract generation carrier population must be canonical and sorted"
  );
  for (const carrier of normalized) {
    const sourceMember = carriers.find(({ filename }) => filename === carrier.filename)
      .source_member;
    const sourceDigest = authority.kind === "orchestrator_git_commit"
      ? (() => {
          const sourcePath = path.resolve(
            authority.worktree_path, sourceMember.repository_relative_path
          );
          if (!sourcePath.startsWith(`${authority.worktree_path}${path.sep}`)) return null;
          try {
            return `sha256:${createHash("sha256").update(readFileSync(sourcePath)).digest("hex")}`;
          } catch {
            return null;
          }
        })()
      : new Map(snapshot.entries
        .filter((entry) => entry.kind === "file")
        .map((entry) => [entry.path, entry.digest]))
        .get(sourceMember.repository_relative_path);
    if (sourceDigest !== carrier.content_digest) fail(
      "test_proof_controlled_contract_generation_snapshot_mismatch",
      "controlled-contract generation does not describe the authenticated source snapshot",
      { filename: carrier.filename, storage_mode: sourceMember.storage_mode }
    );
  }
  const body = {
    schema_version: "controlled-contract-generation.v1",
    wk_id: wkId,
    carriers: normalized
  };
  const generationDigest = `sha256:${createHash("sha256")
    .update(`${JSON.stringify(body, null, 2)}\n`, "utf8").digest("hex")}`;
  if (generationDigest !== selection.controlled_contract_generation) fail(
    "test_proof_controlled_contract_generation_digest_mismatch",
    "controlled-contract generation digest does not authenticate its complete carrier population"
  );
}

export function mintLauncherTestProofAttemptContext({
  authority,
  target,
  authorizedTargets,
  controlledContractSelection,
  verificationId
} = {}) {
  const supplied = arguments[0] ?? {};
  const allowed = new Set([
    "authority", "target", "authorizedTargets", "controlledContractSelection",
    "verificationId"
  ]);
  const unsupported = Object.keys(supplied).filter((key) => !allowed.has(key));
  if (unsupported.length > 0) fail(
    "test_proof_caller_identity_forbidden",
    "caller-authored runtime test identity or attempt context is forbidden",
    { unsupported_keys: unsupported.sort() }
  );
  const trusted = assertLauncherTestProofRuntimeAuthority(authority);
  if (!Array.isArray(authorizedTargets) || authorizedTargets.some(
    (value) => typeof value !== "string"
  ) || !authorizedTargets.includes(target)) fail("test_proof_target_not_authorized",
    "proof target is not in the launcher-bound canonical target population");
  if (controlledContractSelection?.wk_id !== trusted.wk_id ||
      controlledContractSelection?.focus !== null ||
      !DIGEST_RE.test(controlledContractSelection?.content_digest ?? "") ||
      !DIGEST_RE.test(controlledContractSelection?.controlled_contract_generation ?? "") ||
      controlledContractSelection?.contract_schema_version !==
        SCHEMA_VERSION_V1) fail(
    "test_proof_controlled_contract_identity_invalid",
    "proof binding requires the exact same-WK root controlled-contract generation"
  );
  const binding = selectedBinding(controlledContractSelection, verificationId);
  const runtimeTestIdentity = packageReadyRuntimeTestIdentity(binding, {
    wkId: trusted.wk_id, verificationId
  });
  const snapshot = captureLauncherTestProofSourceSnapshot(trusted);
  assertGenerationBoundToSnapshot(
    controlledContractSelection, snapshot, trusted.wk_id, trusted
  );
  const command = canonicalTestProofCommandIdentity(target);
  const context = deepFreeze({
    schema_version: TEST_PROOF_RUNTIME_IDENTITY_SCHEMA_VERSION,
    authority: trusted,
    target,
    authorized_targets: [...authorizedTargets].sort(),
    source_snapshot: snapshot,
    evidence_identity: {
      run_id: trusted.run_id,
      wk_id: trusted.wk_id,
      selected_unit: trusted.selected_unit,
      controlled_contract_generation:
        controlledContractSelection.controlled_contract_generation,
      verification_id: verificationId,
      source_snapshot_digest: snapshot.source_snapshot_digest,
      ...command,
      test_id: runtimeTestIdentity.test_id,
      attempt: trusted.attempt
    },
    contract_binding: {
      contract_digest: controlledContractSelection.content_digest,
      contract_schema_version: controlledContractSelection.contract_schema_version,
      verification_claim_id: verificationId,
      test_proof_id: binding.test_proof_id
    },
    test_proof_binding: structuredClone(binding)
  });
  RUNTIME_CONTEXTS.add(context);
  return context;
}

export function assertLauncherTestProofAttemptContext(context) {
  if (context === null || typeof context !== "object" || !Object.isFrozen(context) ||
      !RUNTIME_CONTEXTS.has(context)) fail("test_proof_attempt_context_untrusted",
    "test-proof attempt requires a launcher-minted complete identity context");
  return context;
}

export function assertLauncherTestProofSourceSnapshotCurrent(context) {
  const trusted = assertLauncherTestProofAttemptContext(context);
  const current = captureLauncherTestProofSourceSnapshot(trusted.authority);
  if (current.source_snapshot_digest !== trusted.source_snapshot.source_snapshot_digest) fail(
    "test_proof_source_snapshot_stale",
    "authenticated source snapshot moved before or during proof execution", {
      expected: trusted.source_snapshot.source_snapshot_digest,
      actual: current.source_snapshot_digest
    }
  );
  return current;
}
