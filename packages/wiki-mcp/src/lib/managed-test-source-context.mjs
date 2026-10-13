

import { realpathSync } from "node:fs";
import path from "node:path";

import { TEST_RUNTIME_RUNNER_CATALOG } from "@agent-chassis/controlled-contract/test-proof";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";

import { classifyWorktreeAtCommit, resolveAuthenticatedConfiguredWorktree, resolveCanonicalUnitBranch,
  resolveExactCommitIdentity, resolveImmediateParentCommit, resolveOwnedExactCommitWorktree } from
  "../../../agent-launch-cli/src/lib/backend-review-target-resolver.mjs";
import { verifyExactSliceCommitBinding } from "../../../agent-launch-cli/src/lib/exact-slice-commit-binding.mjs";
import { captureRepositorySourceSnapshot } from "../../../agent-launch-cli/src/lib/repository-source-snapshot.mjs";
import { verifiedNpmDependencyMappings } from
  "../../../agent-launch-cli/src/lib/test-execution/dependency-projection.mjs";
import { defaultTerminalCandidateRunGit } from "../../../agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import { resolveCurrentRunnerRuntime } from
  "../../../agent-launch-cli/src/lib/test-execution/current-runtime.mjs";
import { expandOrdinaryTargetPattern, isOrdinaryTargetPattern } from
  "../../../agent-launch-cli/src/lib/test-execution/ordinary-test-glob.mjs";
import { ordinaryTargetDefect } from
  "../../../agent-launch-cli/src/lib/test-execution/ordinary-test-runner.mjs";
import { resolveProofEnvironment, resolveRunnerRuntimeInputs } from
  "../../../agent-launch-cli/src/lib/test-execution/runtime-inputs.mjs";
import { defaultRunGit, resolveWorktreeBinding } from "../../../agent-launch-cli/src/lib/worktree-substrate.mjs";
import { resolveUniqueManagedLifecycleBindingPairForRecovery } from
  "../../../agent-launch-cli/src/lib/worktree-substrate-identity.mjs";
import { canonicalWorkRecordIdentity } from "./dispatch-terminal-review-contract.mjs";
import { advisoryReviewSourceBindings, resolveAuthenticatedFindingsSource } from "./launcher-run-credential.mjs";
import { observeTerminalCandidateOwnership } from "./managed-test-terminal-source.mjs";

export const MANAGED_TEST_SOURCE_CODES = Object.freeze({
  ROLE_INELIGIBLE: "run_test.role_ineligible.v1",
  WORKER_UNAUTHENTICATED: "run_test.worker_source_unauthenticated.v1",
  REVIEWER_UNAUTHENTICATED: "run_test.reviewer_source_unauthenticated.v1",
  NOT_EXECUTABLE: "run_test.source_not_executable.v1",
  SOURCE_REQUIRED: "run_test.source_required.v1",
  SOURCE_NOT_PERMITTED: "run_test.source_not_permitted.v1"
});

const SOURCE_OWNERS = Object.freeze({
  worker: Object.freeze({ unavailable_capability: "launcher_bound_worker_source",
    owner: "launcher identity store (exact WK/slice binding)" }),
  reviewer: Object.freeze({ unavailable_capability: "frozen_review_materialization",
    owner: "launcher review materialization" }),
  current_main: Object.freeze({ unavailable_capability: "configured_checkout",
    owner: "configured worktree of this repository" }),
  exact_sha: Object.freeze({ unavailable_capability: "owned_clean_exact_commit_checkout",
    owner: "launcher worktree owners (configured, bound or terminal)" }),
  branch: Object.freeze({ unavailable_capability: "canonical_unit_branch",
    owner: "launcher WK and slice branch naming over this repository's branches" })
});

const EXECUTION_ROLES = Object.freeze(["orchestrator", "reviewer", "worker"]);

export function authenticateManagedWorkerSliceBinding({ mainRepo, state, wkId }) {
  const credential = state.credential;
  if (!credential || state.assignedUnit?.startsWith(`${wkId}#`) !== true) throw Object.assign(
    new Error("managed worker proof authority is unavailable"),
    { code: "verify_proof.worker_authority_unavailable.v1" });
  return verifyExactSliceCommitBinding({
    binding: resolveWorktreeBinding({ mainRepo, launchRef: credential.launchRef,
      runId: credential.runId, retryId: credential.retryId }),
    mainRepo,
    assignedUnit: state.assignedUnit,
    launchRef: credential.launchRef,
    runId: credential.runId,
    retryId: credential.retryId
  });
}

export function authenticateManagedReviewSource({ env, state }) {
  const source = resolveAuthenticatedFindingsSource(env);
  if (source.role !== "reviewer" || state?.role !== "reviewer" ||
      source.assignedUnit !== state.assignedUnit) return null;
  return Object.freeze({ source, root: realpathSync(source.sourceRoot) });
}

export function resolveExecutionBranchSource({ mainRepo, selector, contextWkId = null, runGit = defaultRunGit }) {
  const repositoryRoot = realpathSync(mainRepo);
  return resolveCanonicalUnitBranch({ mainRepo: repositoryRoot, selector, contextWkId, runGit,
    initiativeOf: (recordId) => {
      const identity = canonicalWorkRecordIdentity({ mainRepo: repositoryRoot, recordId });
      return identity.ok === true ? identity.initiative : null;
    } });
}

export async function readCheckoutGitIdentity(root) {
  const [commitResult, treeResult] = await Promise.all([
    defaultTerminalCandidateRunGit({ repo: root,
      args: ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{commit}"] }),
    defaultTerminalCandidateRunGit({ repo: root,
      args: ["--no-replace-objects", "rev-parse", "--verify", "HEAD^{tree}"] })
  ]);
  const commit = commitResult?.ok === true ? String(commitResult.stdout ?? "").trim() : null;
  const tree = treeResult?.ok === true ? String(treeResult.stdout ?? "").trim() : null;
  if (!/^[a-f0-9]{40,64}$/u.test(commit ?? "") || !/^[a-f0-9]{40,64}$/u.test(tree ?? "")) return null;
  return { commit, tree };
}

export function managedTestAuthorityIdentity(state) {
  if (state?.role === "orchestrator") return { role: "orchestrator", session_contract: state.sessionContract ?? null };
  if (state?.role === "reviewer") {

    const bindings = advisoryReviewSourceBindings(state.sessionContract);
    const binding = bindings.length === 1 ? bindings[0] : null;
    return { role: "reviewer", assigned_unit: state.assignedUnit ?? null, run_id: binding?.id ?? null,
      review_source: binding?.digest ?? null };
  }
  return { role: state?.role ?? null, assigned_unit: state?.assignedUnit ?? null,
    launch_ref: state?.credential?.launchRef ?? null, run_id: state?.credential?.runId ?? null,
    retry_id: state?.credential?.retryId ?? null };
}

export function managedTestAuthorityAuthenticated(identity) {
  if (identity === null || typeof identity !== "object" || typeof identity.role !== "string") return false;
  if (identity.role === "orchestrator") {
    return identity.session_contract !== null && identity.session_contract !== undefined;
  }
  const run = identity.role === "reviewer" ? identity.review_source : identity.launch_ref;
  return [identity.assigned_unit, run, identity.run_id]
    .every((fact) => typeof fact === "string" && fact.length > 0);
}

function refusal(code, message, detail = {}, cause = null, nextCalls = []) {
  return Object.assign(new Error(message), { code, detail: Object.freeze({ ...detail,
    ...(cause === null ? {} : { cause_code: typeof cause?.code === "string" ? cause.code : null,
      cause_message: typeof cause?.message === "string" ? cause.message : String(cause) }) }),
  next_calls: Object.freeze([...nextCalls]) });
}

function headState(runGit, root) {
  const read = (args) => {
    const result = runGit({ repo: root, args });
    return result?.ok === true ? String(result.stdout ?? "") : null;
  };
  const commit = read(["--no-replace-objects", "rev-parse", "--verify", "HEAD^{commit}"])?.trim() ?? null;
  const tree = read(["--no-replace-objects", "rev-parse", "--verify", "HEAD^{tree}"])?.trim() ?? null;

  const status = read(["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  return { commit, tree, dirty: status === null ? null : status.length > 0 };
}

function within(checkoutRoot, absolute) {
  if (typeof absolute !== "string" || !path.isAbsolute(absolute)) return null;
  const relative = path.relative(checkoutRoot, absolute);
  return relative === "" || relative.startsWith("..") || path.isAbsolute(relative)
    ? null : relative.split(path.sep).join("/");
}

export function preparedRuntimeExclusions({ repositoryRoot, checkoutRoot, request }) {
  if (request === null || request === undefined) return [];
  const descriptor = TEST_RUNTIME_RUNNER_CATALOG.runners.find(({ name }) => name === request.runner) ?? null;
  if (descriptor === null) return [];
  const located = resolveProofEnvironment({ repositoryRoot, checkoutRoot, target: request.target,
    runner: descriptor, environment: request.environment ?? null });
  if (located?.configured !== true || located.ok !== true) return [];
  const runtime = resolveRunnerRuntimeInputs({ repositoryRoot, checkoutRoot, descriptor, project: located.project });
  if (runtime.ok !== true) return [];
  const exclusions = [];
  const populations = [...Object.values(runtime.toolchains ?? {}), runtime.preparation ?? {}];
  for (const { population = [], population_exclude: uncovered = [] } of populations) {
    for (const root of population) {
      const covered = within(checkoutRoot, root);
      if (covered !== null) exclusions.push({ path: covered, keepNames: [...uncovered] });
    }
  }
  return exclusions;
}

function requestedSource({ repositoryRoot, checkoutRoot, request }) {
  if (!isOrdinaryTargetPattern(request?.target) ||
      ordinaryTargetDefect(request.target, { pattern: true }) !== null) {
    return { targets: undefined, exclusions: preparedRuntimeExclusions({ repositoryRoot, checkoutRoot, request }) };
  }
  const targets = Object.freeze(expandOrdinaryTargetPattern(checkoutRoot, request.target));
  const exclusions = new Map(targets.flatMap((target) => preparedRuntimeExclusions({ repositoryRoot,
    checkoutRoot, request: { ...request, target } })).map((exclusion) => [JSON.stringify(exclusion), exclusion]));
  return { targets, exclusions: [...exclusions.values()] };
}

function currentnessCheck(runGit, repositoryRoot, root, initial, exclusions = []) {
  const capture = () => captureRepositorySourceSnapshot(root, { exclusions,
    mappedDependencies: verifiedNpmDependencyMappings({ repositoryRoot, checkoutRoot: root }) });
  const snapshot = capture();
  return { snapshotDigest: snapshot.source_snapshot_digest, current: () => {
    if (capture().source_snapshot_digest !== snapshot.source_snapshot_digest) {
      return { current: false, reason: "source_bytes_changed" };
    }
    const now = headState(runGit, root);
    if (now.commit !== initial.commit || now.tree !== initial.tree) return { current: false, reason: "head_moved" };
    return { current: true };
  } };
}

function availableBaseline(runGit, { repositoryRoot, checkoutRoot, commit }, request) {
  const { targets, exclusions } = requestedSource({ repositoryRoot, checkoutRoot, request });
  const { snapshotDigest, current } = currentnessCheck(runGit, repositoryRoot, checkoutRoot,
    headState(runGit, checkoutRoot), exclusions);
  return Object.freeze({ status: "available", repositoryRoot, checkoutRoot, commit, snapshotDigest, current,
    ...(targets === undefined ? {} : { targets }) });
}

const unavailableBaseline = (reason, detail = undefined) => Object.freeze({ status: "unavailable", reason,
  ...(detail === undefined ? {} : { detail }) });

function baselineCommit(runGit, mainRepo, { commit, dirty }) {
  if (dirty) return { ok: true, commit };
  const parent = resolveImmediateParentCommit({ mainRepo, commit, runGit });
  return parent.ok ? { ok: true, commit: parent.parent } : { ok: false, reason: parent.reason };
}

function ownedBaseline(runGit, mainRepo, candidate, request) {
  return () => {
    const wanted = baselineCommit(runGit, mainRepo, candidate);
    if (!wanted.ok) return unavailableBaseline(wanted.reason);
    const owned = resolveOwnedExactCommitWorktree({ mainRepo, gitSha: wanted.commit,
      exclude: [candidate.checkoutRoot], runGit });
    if (!owned.ok) return unavailableBaseline(`baseline_${owned.reason}`, owned.detail);
    return availableBaseline(runGit, { repositoryRoot: mainRepo, checkoutRoot: owned.worktree_path,
      commit: wanted.commit }, request);
  };
}

async function workerSource({ state, mainRepo, runGit, request }) {
  const wkId = typeof state.assignedUnit === "string" ? state.assignedUnit.split("#")[0] : null;
  const unauthenticated = (message, cause = null) => refusal(MANAGED_TEST_SOURCE_CODES.WORKER_UNAUTHENTICATED,
    message, { assigned_unit: state.assignedUnit ?? null, ...SOURCE_OWNERS.worker }, cause);
  let binding;
  let pair;
  try {
    binding = authenticateManagedWorkerSliceBinding({ mainRepo, state, wkId });
    pair = resolveUniqueManagedLifecycleBindingPairForRecovery({ mainRepo,
      launchRef: state.credential.launchRef, expectedSubject: state.assignedUnit });
  } catch (error) {
    throw unauthenticated("the managed worker's launcher binding could not be authenticated", error);
  }
  if (pair === null || pair.slice_binding.run_id !== state.credential.runId ||
      pair.slice_binding.retry_id !== state.credential.retryId ||
      pair.slice_binding.worktree_path !== binding.worktree_path) {
    throw unauthenticated("the managed worker's binding is not one exact WK/slice pair of this run");
  }
  const checkoutRoot = realpathSync(binding.worktree_path);
  const head = headState(runGit, checkoutRoot);
  if (checkoutRoot !== binding.worktree_path || head.commit === null || head.dirty === null) {
    throw unauthenticated("the managed worker's slice checkout is not its canonical bound worktree");
  }

  const start = pair.slice_binding.base_sha;
  const wkWorktree = pair.wk_binding.worktree_path;
  const baseline = () => {
    let wanted;
    if (head.commit === start) wanted = start;
    else {
      const chosen = baselineCommit(runGit, mainRepo, head);
      if (!chosen.ok) return unavailableBaseline(chosen.reason);
      wanted = chosen.commit;
    }

    const state = classifyWorktreeAtCommit({ mainRepo, worktreePath: wkWorktree, commit: wanted, runGit });
    if (state === "clean") {
      return availableBaseline(runGit, { repositoryRoot: mainRepo, checkoutRoot: wkWorktree, commit: wanted },
        request);
    }
    if (state === "moved") return unavailableBaseline(wanted === start ? "baseline_moved" : "baseline_not_materialized");
    return unavailableBaseline(`baseline_${state}`);
  };
  return { kind: "worker_slice", checkoutRoot, head, baseline,
    facts: { slice_start: start } };
}

async function reviewerSource({ env, state, mainRepo, runGit, request }) {
  const unauthenticated = (message, cause = null) => refusal(MANAGED_TEST_SOURCE_CODES.REVIEWER_UNAUTHENTICATED,
    message, { assigned_unit: state.assignedUnit ?? null, ...SOURCE_OWNERS.reviewer }, cause);
  let materialization;
  try {
    materialization = authenticateManagedReviewSource({ env, state });
  } catch (error) {
    throw unauthenticated("the managed reviewer's review source is unauthenticated", error);
  }
  if (materialization === null) {
    throw unauthenticated("the managed reviewer's review source is bound to another assignment");
  }
  const checkoutRoot = materialization.root;
  const head = headState(runGit, checkoutRoot);
  if (head.commit === null || head.dirty === null) {
    throw unauthenticated("the managed reviewer's materialization has no exact Git candidate identity");
  }
  return { kind: "reviewer_materialization", checkoutRoot, head,
    baseline: ownedBaseline(runGit, mainRepo, { ...head, checkoutRoot }, request) };
}

function owningSliceInspection(owned, branch) {
  const unit = owned.sole_unit;
  if (owned.reason !== "dirty" || unit?.state !== "dirty" || unit.kind !== "slice") return null;
  if (branch !== null && branch.unit_address !== unit.unit_address) return null;
  const slice = `${unit.wk_id}#${unit.slice_id}`;
  return { slice, call: buildNextCall({ tool: "get_run_result", reason: "inspect_owning_slice_delivery",
    arguments: { subject: slice } }) };
}

const TERMINAL_OWNER_EXPLAINS = Object.freeze(["unowned", "not_materialized"]);

async function orchestratorSource({ mainRepo, source, runGit, request, terminalWorktreeRoot }) {
  if (!["current_main", "exact_sha", "branch"].includes(source?.kind)) {
    throw refusal(MANAGED_TEST_SOURCE_CODES.SOURCE_REQUIRED,
      "an orchestrator names its execution source: {kind:\"current_main\"}, {kind:\"exact_sha\",value} or " +
        "{kind:\"branch\",value}",
      { role: "orchestrator" });
  }
  if (source.kind === "current_main") {
    let configured;
    try {
      configured = resolveAuthenticatedConfiguredWorktree({ mainRepo, runGit });
    } catch (error) {
      throw refusal(MANAGED_TEST_SOURCE_CODES.NOT_EXECUTABLE, "the configured current checkout is not executable",
        { source: "current_main", reason: error?.detail?.reason ?? "configured_worktree_unavailable",
          ...SOURCE_OWNERS.current_main }, error);
    }
    const head = { commit: configured.commit, tree: configured.tree, dirty: !configured.clean };
    return { kind: "current_main", checkoutRoot: configured.worktree_path, head,
      baseline: ownedBaseline(runGit, mainRepo, { ...head, checkoutRoot: configured.worktree_path }, request) };
  }

  let branch = null;
  if (source.kind === "branch") {
    branch = resolveExecutionBranchSource({ mainRepo, selector: source.value, runGit });
    if (!branch.ok) {
      throw refusal(MANAGED_TEST_SOURCE_CODES.NOT_EXECUTABLE,
        "the branch selection names no existing canonical WK or slice branch; no other source was selected",
        { source: "branch", reason: branch.reason, ...branch.detail, ...SOURCE_OWNERS.branch });
    }
    source = { kind: "exact_sha", value: branch.commit };
  }
  const selected = branch === null ? { source: "exact_sha" } : { source: "branch", branch: branch.branch };

  const terminal = resolveExactCommitIdentity({ mainRepo, gitSha: source.value, runGit }) === null
    ? { status: "absent" }
    : await observeTerminalCandidateOwnership({ mainRepo, commit: source.value, worktreeRoot: terminalWorktreeRoot });
  const owned = resolveOwnedExactCommitWorktree({ mainRepo, gitSha: source.value, runGit,
    unitAddress: branch === null ? null : branch.unit_address,
    owners: terminal.status === "owned" ? [{ worktree_path: terminal.worktree_path, owner: terminal.owner }] : [] });
  if (!owned.ok) {
    if (terminal.status === "refused") {
      throw refusal(MANAGED_TEST_SOURCE_CODES.NOT_EXECUTABLE,
        "the exact commit is a terminal candidate whose owner did not authenticate an existing checkout of it",
        { ...selected, ...owned.detail, ...SOURCE_OWNERS.exact_sha,
          reason: TERMINAL_OWNER_EXPLAINS.includes(owned.reason) ? "terminal_owner_refused" : owned.reason,
          lookup_reason: owned.reason,
          owner_cause_code: typeof terminal.error?.cause?.code === "string" ? terminal.error.cause.code : null },
        terminal.error);
    }
    const inspection = owningSliceInspection(owned, branch);
    if (inspection !== null) {
      throw refusal(MANAGED_TEST_SOURCE_CODES.NOT_EXECUTABLE,
        "the exact commit has no clean owned materialization in this repository: its one checkout is " +
          `slice ${inspection.slice}'s dirty launcher-bound worktree. Nothing ran and no other source was ` +
          "selected. The returned get_run_result only inspects that slice's delivery; match its commit to this " +
          "one before separately approving any integration that result offers",
        { ...selected, reason: owned.reason, ...owned.detail, ...SOURCE_OWNERS.exact_sha,
          owning_slice: inspection.slice }, null, [inspection.call]);
    }
    throw refusal(MANAGED_TEST_SOURCE_CODES.NOT_EXECUTABLE,
      branch === null ? "the exact commit has no clean owned materialization in this repository"
        : "the branch's own bound checkout is not a clean materialization of the commit it names; no other " +
          "checkout was selected",
      { ...selected, reason: owned.reason, ...owned.detail, ...SOURCE_OWNERS.exact_sha });
  }

  const head = { commit: owned.commit, tree: owned.tree, dirty: false };
  return { kind: branch === null ? "exact_sha" : "branch", checkoutRoot: owned.worktree_path, head,
    ...(branch === null ? {} : { facts: { branch: branch.branch } }),
    baseline: ownedBaseline(runGit, mainRepo, { ...head, checkoutRoot: owned.worktree_path }, request) };
}

export async function resolveManagedTestSource({ state, env = {}, mainRepo, source = null, request = null,
  runGit = defaultRunGit, terminalWorktreeRoot = null }) {
  if (!EXECUTION_ROLES.includes(state?.role)) {
    throw refusal(MANAGED_TEST_SOURCE_CODES.ROLE_INELIGIBLE,
      "ordinary test runs are available only to authenticated orchestrator, worker and reviewer sessions",
      { role: state?.role ?? null });
  }
  const repositoryRoot = realpathSync(mainRepo);
  const context = { mainRepo: repositoryRoot, runGit, request };
  const resolved = state.role === "worker" ? await workerSource({ ...context, state })
    : state.role === "reviewer" ? await reviewerSource({ ...context, env, state })
      : await orchestratorSource({ ...context, source, terminalWorktreeRoot });
  const { targets, exclusions } = requestedSource({ repositoryRoot, checkoutRoot: resolved.checkoutRoot,
    request });
  return Object.freeze({
    kind: resolved.kind,
    role: state.role,
    repositoryRoot,
    checkoutRoot: resolved.checkoutRoot,
    commit: resolved.head.commit,
    tree: resolved.head.tree,
    dirty: resolved.head.dirty,
    ...(resolved.facts ?? {}),
    authorityIdentity: managedTestAuthorityIdentity(state),
    ...(targets === undefined ? {} : { targets }),
    ...currentnessCheck(runGit, repositoryRoot, resolved.checkoutRoot, resolved.head, exclusions),
    baseline: resolved.baseline
  });
}

function sameIdentity(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export async function observeRuntimeAfterRun({ repositoryRoot, checkoutRoot, request, result }) {
  if (Array.isArray(result?.files)) {

    const observed = [];
    const seen = new Set();
    for (const { target, result: file } of result.files) {
      const key = JSON.stringify([file?.identity?.project, file?.identity?.environment]);
      if (file?.identity === undefined || seen.has(key)) continue;
      seen.add(key);
      observed.push(await observeRuntimeAfterRun({ repositoryRoot, checkoutRoot, request: { ...request, target },
        result: file }));
    }
    return observed.find(({ status }) => status === "changed") ?? observed.find(({ status }) => status === "unknown") ??
      observed[0] ?? Object.freeze({ status: "not_applicable", cause: "the run did not reach a runtime" });
  }
  const identity = result?.identity;
  if (identity === null || typeof identity !== "object") {
    return Object.freeze({ status: "not_applicable", cause: "the run did not reach a runtime" });
  }
  const unknown = (cause, detail = {}) => Object.freeze({ status: "unknown", cause, ...detail });
  const descriptor = TEST_RUNTIME_RUNNER_CATALOG.runners.find(({ name }) => name === request.runner) ?? null;
  if (descriptor === null) return unknown("the runner is not a runtime runner");
  let resolved;
  try {
    resolved = await resolveCurrentRunnerRuntime({ repositoryRoot, checkoutRoot, target: request.target,
      runner: descriptor, environment: request.environment ?? null });
  } catch (error) {
    return unknown("the runtime could not be resolved again", { code: error?.code ?? null,
      message: error?.message ?? String(error) });
  }
  const { located, runtime } = resolved;
  if (located.configured !== true || located.ok !== true) {
    return unknown("the target no longer routes to an environment", { code: located.failure?.code ?? null });
  }
  if (runtime.ok !== true) {
    return unknown("the environment's inputs could not be resolved again", { code: runtime.code ?? null,
      message: runtime.message ?? null });
  }
  const now = { environment: runtime.identity.environment, readiness_digest: runtime.identity.readiness_digest,
    toolchains: runtime.identity.toolchains, dependencies: runtime.identity.dependencies };
  const changed = Object.keys(now).filter((field) => !sameIdentity(now[field], identity[field]));
  return Object.freeze(changed.length === 0 ? { status: "unchanged" }
    : { status: "changed", changed: Object.freeze(changed), observed: Object.freeze(now) });
}
