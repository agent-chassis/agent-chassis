

import path from "node:path";
import { defaultRunGit } from "./worktree-substrate.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import {
  assertTerminalCandidateMaterialization,
  TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION,
  TERMINAL_REVIEW_VERIFY_PARTS
} from "./terminal-review-materialization.mjs";
import { verifyTerminalWkCandidateObjectBinding } from "./terminal-wk-candidate.mjs";

export const TERMINAL_CANDIDATE_REVIEW_TARGET_SCHEMA_VERSION =
  "agent_launch.terminal_candidate_review_target.v1";

const TERMINAL_CANDIDATE_REVIEW_TARGET_FIELDS = Object.freeze([
  "schema_version",
  "review_identity_kind",
  "ref",
  "sha",
  "candidate_ref",
  "candidate_sha",
  "base_ref",
  "base_sha",
  "wk_ref",
  "wk_sha",
  "worktree_path",
  "canonical_wk_digest",
  "diff_base_sha",
  "diff_head_sha",
  "diff_range",
  "complete_parent_wk_contract",
  "accumulated_wk_diff"
]);

const TERMINAL_CANDIDATE_READINESS_FIELDS = Object.freeze([
  "review_identity_kind",
  "candidate_ref",
  "candidate_sha",
  "base_ref",
  "base_sha",
  "wk_ref",
  "wk_sha",
  "diff_base_sha",
  "diff_head_sha",
  "diff_range",
  "canonical_wk_digest",
  "complete_parent_wk_contract",
  "accumulated_wk_diff"
]);

function hasExactFields(value, fields) {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

export function assertFrozenReviewTarget(target) {
  if (target?.review_identity_kind === "terminal_candidate") {
    return assertFrozenTerminalCandidateReviewTarget(target);
  }
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

export function assertFrozenTerminalCandidateReviewTarget(target) {
  if (!isPlainObject(target) ||
      !hasExactFields(target, TERMINAL_CANDIDATE_REVIEW_TARGET_FIELDS) ||
      target.schema_version !== TERMINAL_CANDIDATE_REVIEW_TARGET_SCHEMA_VERSION ||
      target.review_identity_kind !== "terminal_candidate" ||
      typeof target.candidate_ref !== "string" ||
      !/^refs\/agent-launch\/terminal-current-v2\/WK-\d{4}$/u.test(target.candidate_ref) ||
      typeof target.candidate_sha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(target.candidate_sha) ||
      target.sha !== target.candidate_sha || target.ref !== target.candidate_ref ||
      typeof target.wk_ref !== "string" || !/^refs\/heads\/wk\/IN-\d{4}\/WK-\d{4}$/u.test(target.wk_ref) ||
      typeof target.wk_sha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(target.wk_sha) ||
      typeof target.base_ref !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/u.test(target.base_ref) ||
      typeof target.base_sha !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(target.base_sha) ||
      target.diff_base_sha !== target.base_sha || target.diff_head_sha !== target.candidate_sha ||
      target.diff_range !== `${target.base_sha}..${target.candidate_sha}` ||
      typeof target.worktree_path !== "string" || !path.isAbsolute(target.worktree_path) ||
      typeof target.canonical_wk_digest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(target.canonical_wk_digest) ||
      target.complete_parent_wk_contract !== true || target.accumulated_wk_diff !== true) {
    throw new Error("frozen terminal-candidate review target is incomplete or incompatible");
  }
  return target;
}

export async function createTerminalCandidateReviewTarget({
  binding,
  materialization,
  runGit
} = {}) {
  await verifyTerminalWkCandidateObjectBinding({ binding, runGit });
  assertTerminalCandidateMaterialization(materialization, binding);
  const target = {
    schema_version: TERMINAL_CANDIDATE_REVIEW_TARGET_SCHEMA_VERSION,
    review_identity_kind: "terminal_candidate",
    ref: binding.candidate_ref,
    sha: binding.candidate,
    candidate_ref: binding.candidate_ref,
    candidate_sha: binding.candidate,
    base_ref: binding.base_ref,
    base_sha: binding.base,
    wk_ref: binding.wk_ref,
    wk_sha: binding.wk_tip,
    worktree_path: materialization.checkout_path,
    canonical_wk_digest: binding.canonical_wk_digest,
    diff_base_sha: binding.base,
    diff_head_sha: binding.candidate,
    diff_range: `${binding.base}..${binding.candidate}`,
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  };
  assertFrozenTerminalCandidateReviewTarget(target);
  return Object.freeze(target);
}

export function projectTerminalCandidateReviewTargetReadiness(target) {
  const validated = assertFrozenTerminalCandidateReviewTarget(target);
  if (!Object.isFrozen(validated)) {
    throw new Error("frozen terminal-candidate review target is not immutable");
  }
  const readiness = Object.fromEntries(
    TERMINAL_CANDIDATE_READINESS_FIELDS.map((field) => [field, validated[field]])
  );
  return Object.freeze(readiness);
}

export function runFrozenReviewTargetObjectStoreProbes({ mainRepo, probes, runGit }) {
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

export { assertTerminalReviewMaterializationAttestation } from "./terminal-review-materialization.mjs";

export function verifyFrozenWkReviewTargetAgainstObjectStore({ mainRepo, context, runGit = defaultRunGit }) {
  if (context?.review_identity_kind === "terminal_candidate") {
    return runFrozenReviewTargetObjectStoreProbes({
      mainRepo,
      runGit,
      probes: [
        { name: "candidate_commit_object_present", rev: `${context.candidate_sha}^{commit}`, expect: context.candidate_sha },
        { name: "base_parent_object_present", rev: `${context.base_sha}^{commit}`, expect: context.base_sha },
        { name: "wk_ref_remains_accumulated_tip", rev: `${context.wk_ref}^{commit}`, expect: context.wk_sha },
        { name: "wk_tip_object_present", rev: `${context.wk_sha}^{commit}`, expect: context.wk_sha }
      ]
    });
  }
  return runFrozenReviewTargetObjectStoreProbes({
    mainRepo,
    runGit,
    probes: [
      { name: "wk_ref_resolves_to_frozen_sha", rev: `${context.wk_ref}^{commit}`, expect: context.wk_sha },
      { name: "frozen_commit_object_present", rev: `${context.wk_sha}^{commit}`, expect: context.wk_sha },
      { name: "frozen_diff_base_object_present", rev: `${context.diff_base_sha}^{commit}`, expect: context.diff_base_sha }
    ]
  });
}
