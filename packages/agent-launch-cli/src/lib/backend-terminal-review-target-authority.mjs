

import path from "node:path";
import { defaultRunGit } from "./worktree-substrate.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";

import {
  TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION,
  TERMINAL_REVIEW_VERIFY_PARTS
} from "./terminal-review-materialization.mjs";

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
      target.schema_version !== "agent_launch.terminal_candidate_review_target.v1" ||
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
