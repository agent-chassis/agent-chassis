

import { existsSync } from "node:fs";

import {
  WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES,
  fail,
  assertAbsolutePath,
  branchExists,
  revParse,
  defaultRunGit
} from "./worktree-substrate-primitives.mjs";
import {
  deriveExactUnitName,
  resolveWkBranchTipBase
} from "./worktree-substrate-exact-unit-identity.mjs";

export const SLICE_TIP_RECONCILE_DIAGNOSTIC_CODES = Object.freeze({
  SLICE_TIP_RECONCILE_REQUIRED: "agent_launch.worktree_substrate.slice_tip_reconcile_required.v1"
});

export const SLICE_TIP_RECONCILE_STATES = Object.freeze({
  ABSENT: "absent",
  EQUAL: "equal",
  INTEGRATED: "integrated",
  AUTHENTICATED_CONTINUATION: "authenticated_continuation",
  ORPHANED: "orphaned",
  WK_BASE_UNRESOLVED: "wk_base_unresolved"
});

export const CORRECTIVE_CONTINUATION_PROOF_SCHEMA_VERSION =
  "workspace-agent-corrective-continuation-proof.v1";

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const CORRECTIVE_CONTINUATION_PROOF_FIELDS = Object.freeze([
  "schema_version", "subject", "unit_address", "slice_ref", "frozen_base_sha",
  "delivered_tip_sha", "commit_chain", "committed_target_digest", "worktree_path"
]);

export const SLICE_TIP_RECOVERY_ROUTES = Object.freeze({
  EXACT_SLICE_REVIEW_RECOVERY: "exact_slice_review_recovery",
  OPERATOR_RECONCILE: "operator_reconcile"
});

function reconcileRefusal(state, message, detail) {
  fail(
    SLICE_TIP_RECONCILE_DIAGNOSTIC_CODES.SLICE_TIP_RECONCILE_REQUIRED,
    message,
    Object.freeze({ reconcile_state: state, ...detail })
  );
}

function classifyExistingSliceTip({ runGit, repo, branch, wkBaseSha }) {
  const sliceTip = revParse(runGit, repo, branch);
  if (sliceTip === wkBaseSha) {
    return Object.freeze({ state: SLICE_TIP_RECONCILE_STATES.EQUAL, slice_tip: sliceTip });
  }
  const contained = runGit({ repo, args: ["merge-base", "--is-ancestor", sliceTip, wkBaseSha] });
  if (contained?.ok === true) {
    return Object.freeze({ state: SLICE_TIP_RECONCILE_STATES.INTEGRATED, slice_tip: sliceTip });
  }
  if (!contained || contained.status !== 1) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
      "failed to determine whether the existing slice tip is contained in the canonical WK base",
      {
        branch,
        slice_tip: sliceTip,
        wk_base_sha: wkBaseSha,
        status: contained?.status ?? null,
        stderr: contained?.stderr ?? null,
        error: contained?.error ?? null
      }
    );
  }
  return Object.freeze({ state: SLICE_TIP_RECONCILE_STATES.ORPHANED, slice_tip: sliceTip });
}

function hasExactKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}

function authenticateCorrectiveContinuation({
  runGit,
  repo,
  name,
  branch,
  worktreePath,
  wkBaseSha,
  sliceTip,
  resolveProof
}) {
  if (typeof resolveProof !== "function") return null;
  const expectedSubject = `${name.wk_id}#${name.slice_id}`;
  const expectedSliceRef = `refs/heads/${branch}`;
  let proof;
  try {
    proof = resolveProof(Object.freeze({
      subject: expectedSubject,
      unit_address: name.unit_address,
      slice_ref: expectedSliceRef,
      slice_tip: sliceTip,
      worktree_path: worktreePath
    }));
  } catch {
    return null;
  }
  if (!hasExactKeys(proof, CORRECTIVE_CONTINUATION_PROOF_FIELDS) ||
      proof.schema_version !== CORRECTIVE_CONTINUATION_PROOF_SCHEMA_VERSION ||
      proof.subject !== expectedSubject || proof.unit_address !== name.unit_address ||
      proof.slice_ref !== expectedSliceRef || proof.delivered_tip_sha !== sliceTip ||
      proof.worktree_path !== worktreePath || !OID_RE.test(proof.frozen_base_sha ?? "") ||
      !OID_RE.test(proof.delivered_tip_sha ?? "") ||
      typeof proof.committed_target_digest !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(proof.committed_target_digest) ||
      !Array.isArray(proof.commit_chain) || proof.commit_chain.length === 0 ||
      proof.commit_chain.some((commit) => !OID_RE.test(commit))) {
    return null;
  }

  const baseRetained = runGit({
    repo,
    args: ["merge-base", "--is-ancestor", proof.frozen_base_sha, wkBaseSha]
  });
  if (!baseRetained || (baseRetained.ok !== true && baseRetained.status !== 1)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
      "failed to verify that the authenticated delivery base remains in the canonical WK chain",
      { frozen_base_sha: proof.frozen_base_sha, wk_base_sha: wkBaseSha }
    );
  }
  if (baseRetained.ok !== true) return null;

  const range = runGit({
    repo,
    args: ["rev-list", "--reverse", "--parents", `${proof.frozen_base_sha}..${sliceTip}`]
  });
  if (range?.ok !== true) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
      "failed to verify the authenticated corrective delivery chain",
      { frozen_base_sha: proof.frozen_base_sha, slice_tip: sliceTip }
    );
  }
  const lines = String(range.stdout ?? "").trim().split("\n").filter(Boolean);
  if (lines.length !== proof.commit_chain.length) return null;
  let expectedParent = proof.frozen_base_sha;
  for (let index = 0; index < lines.length; index += 1) {
    const parts = lines[index].trim().split(/\s+/u);
    if (parts.length !== 2 || parts[0] !== proof.commit_chain[index] ||
        parts[1] !== expectedParent) return null;
    const message = runGit({ repo, args: ["show", "-s", "--format=%B", parts[0]] });
    if (message?.ok !== true) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.GIT_FAILED,
        "failed to verify a corrective delivery commit identity",
        { commit: parts[0] }
      );
    }
    const expectedMessage =
      `agent-launch worker delivery: ${expectedSubject} (base ${expectedParent.slice(0, 12)})` +
      `\n\nWk-Slice: ${expectedSubject}`;
    if (String(message.stdout ?? "").trimEnd() !== expectedMessage) return null;
    expectedParent = parts[0];
  }
  if (expectedParent !== sliceTip || !existsSync(worktreePath)) return null;
  const association = runGit({ repo: worktreePath, args: ["symbolic-ref", "--quiet", "HEAD"] });
  if (association?.ok !== true || String(association.stdout ?? "").trim() !== expectedSliceRef) return null;
  if (revParse(runGit, worktreePath, "HEAD") !== sliceTip ||
      revParse(runGit, repo, branch) !== sliceTip) return null;

  return Object.freeze({
    state: SLICE_TIP_RECONCILE_STATES.AUTHENTICATED_CONTINUATION,
    slice_tip: sliceTip,
    authenticated_base_sha: proof.frozen_base_sha,
    committed_target_digest: proof.committed_target_digest
  });
}

export function reconcileExistingSliceTip({
  runGit,
  repo,
  name,
  branch,
  worktreePath,
  resolveWkTip,
  resolveCorrectiveContinuationProof
}) {
  let wkBase;
  try {
    wkBase = resolveWkTip({ mainRepo: repo, unitAddress: name.unit_address, deps: { runGit } });
  } catch (error) {

    reconcileRefusal(
      SLICE_TIP_RECONCILE_STATES.WK_BASE_UNRESOLVED,
      "the canonical WK-derived base could not be resolved, so an existing slice tip cannot be reconciled",
      {
        branch,
        unit_address: name.unit_address,
        recovery_route: SLICE_TIP_RECOVERY_ROUTES.OPERATOR_RECONCILE,
        cause: error?.message ?? String(error)
      }
    );
  }
  const wkBaseSha = wkBase?.base_sha ?? null;
  if (typeof wkBaseSha !== "string" || wkBaseSha.length === 0) {
    reconcileRefusal(
      SLICE_TIP_RECONCILE_STATES.WK_BASE_UNRESOLVED,
      "the canonical WK-derived base resolver returned no base_sha for an existing slice branch",
      {
        branch,
        unit_address: name.unit_address,
        recovery_route: SLICE_TIP_RECOVERY_ROUTES.OPERATOR_RECONCILE
      }
    );
  }
  const classified = classifyExistingSliceTip({ runGit, repo, branch, wkBaseSha });
  if (classified.state === SLICE_TIP_RECONCILE_STATES.ORPHANED) {
    const authenticated = authenticateCorrectiveContinuation({
      runGit,
      repo,
      name,
      branch,
      worktreePath,
      wkBaseSha,
      sliceTip: classified.slice_tip,
      resolveProof: resolveCorrectiveContinuationProof
    });
    if (authenticated !== null) {
      return Object.freeze({
        ...authenticated,
        wk_base_ref: wkBase.base_ref,
        wk_base_sha: wkBaseSha
      });
    }

    reconcileRefusal(
      SLICE_TIP_RECONCILE_STATES.ORPHANED,
      "the existing slice tip carries commits that the canonical WK base does not contain; " +
        "an unreviewed delivery is never a continuation base and never authorizes another worker",
      {
        branch,
        unit_address: name.unit_address,
        slice_tip: classified.slice_tip,
        wk_base_ref: wkBase.base_ref,
        wk_base_sha: wkBaseSha,
        recovery_route: SLICE_TIP_RECOVERY_ROUTES.EXACT_SLICE_REVIEW_RECOVERY
      }
    );
  }
  return Object.freeze({ ...classified, wk_base_ref: wkBase.base_ref, wk_base_sha: wkBaseSha });
}

export function classifyExistingSliceTipForDispatch({
  mainRepo,
  unitAddress,
  worktreeRoot,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  const root = assertAbsolutePath(worktreeRoot, "worktreeRoot");
  const name = deriveExactUnitName({ unitAddress, worktreeRoot: root });
  if (name.kind !== "slice") {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_UNIT_ADDRESS,
      "early slice-tip reconciliation requires a slice unit_address"
    );
  }
  const branch = name.output_branch;

  if (!branchExists(runGit, repo, branch)) {
    return Object.freeze({ state: SLICE_TIP_RECONCILE_STATES.ABSENT, slice_tip: null });
  }
  const resolveWkTip = deps.resolveWkBranchTipBase ?? resolveWkBranchTipBase;
  const source = deps.resolveCorrectiveContinuationProof;
  let capturedProof = null;
  const capturingResolver = typeof source === "function"
    ? (proofContext) => {
        const proof = source(proofContext);
        if (proof != null) capturedProof = proof;
        return proof;
      }
    : undefined;
  const verdict = reconcileExistingSliceTip({
    runGit,
    repo,
    name,
    branch,
    worktreePath: name.worktree_path,
    resolveWkTip,
    resolveCorrectiveContinuationProof: capturingResolver
  });
  if (verdict.state === SLICE_TIP_RECONCILE_STATES.AUTHENTICATED_CONTINUATION && capturedProof !== null) {
    return Object.freeze({ ...verdict, corrective_continuation_proof: capturedProof });
  }
  return verdict;
}
