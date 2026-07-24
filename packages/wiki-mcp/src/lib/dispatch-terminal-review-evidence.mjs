

import { lifecycleError } from "./dispatch-post-worker-lifecycle-bindings.mjs";
import { assertTerminalReviewMaterializationAttestation } from "../../../agent-launch-cli/src/lib/backend-scope-authority.mjs";
import { TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES } from
  "../../../agent-launch-cli/src/lib/terminal-review-materialization.mjs";
import {
  assertTerminalCandidateMaterialization,
  verifyTerminalCandidateCheckout
} from "../../../agent-launch-cli/src/lib/terminal-review-materialization.mjs";
import { verifyTerminalWkCandidateObjectBinding } from
  "../../../agent-launch-cli/src/lib/terminal-wk-candidate.mjs";

export const TERMINAL_REVIEW_MATERIALIZER_UNAVAILABLE_CODE =
  "agent_launch.terminal_review_materialization.materializer_unavailable.v1";

export const TERMINAL_REVIEW_EVIDENCE_MODES = Object.freeze({

  LIVE_MATERIALIZER: "live_materializer"
});

export const TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES = Object.freeze({

  MODE_UNAVAILABLE:
    "agent_launch.terminal_review_materialization.evidence_mode_unavailable.v1",

  UNEXPECTED_CARRIED_EVIDENCE:
    "agent_launch.terminal_review_materialization.unexpected_carried_evidence.v1"
});

export const TERMINAL_REVIEW_POLICY_CONVERTIBLE_CODES = Object.freeze([
  TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.MODE_UNAVAILABLE,
  TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.UNEXPECTED_CARRIED_EVIDENCE,
  TERMINAL_REVIEW_MATERIALIZER_UNAVAILABLE_CODE,
  TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
  TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
  TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID
]);

const TERMINAL_REVIEW_POLICY_CONVERTIBLE_CODE_SET =
  new Set(TERMINAL_REVIEW_POLICY_CONVERTIBLE_CODES);

const POLICY_DETAIL_MAX_DEPTH = 4;
const POLICY_DETAIL_MAX_KEYS = 32;
const POLICY_DETAIL_MAX_ITEMS = 32;
const POLICY_DETAIL_MAX_STRING = 1024;

function boundedPolicyDetail(value, depth = 0) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    return value.length <= POLICY_DETAIL_MAX_STRING
      ? value
      : `${value.slice(0, POLICY_DETAIL_MAX_STRING)}…[truncated]`;
  }
  if (depth >= POLICY_DETAIL_MAX_DEPTH) return "[depth-capped]";
  if (Array.isArray(value)) {
    return value.slice(0, POLICY_DETAIL_MAX_ITEMS)
      .map((entry) => boundedPolicyDetail(entry, depth + 1));
  }
  if (!isPlainLifecycleObject(value)) return `[${typeof value}]`;
  const output = {};
  for (const key of Object.keys(value).sort().slice(0, POLICY_DETAIL_MAX_KEYS)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      output[key] = boundedPolicyDetail(descriptor.value, depth + 1);
    }
  }
  return output;
}

function ownData(value, field) {
  if (!isPlainLifecycleObject(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function policyCause({ code, message, detail, origin, originalRefusal = null }) {
  return Object.freeze({
    code,
    message: boundedPolicyDetail(typeof message === "string" ? message : String(message ?? code)),
    detail: boundedPolicyDetail(detail ?? null),
    origin,
    ...(originalRefusal === null
      ? {}
      : { original_refusal: Object.freeze(boundedPolicyDetail(originalRefusal)) })
  });
}

export function classifyTerminalReviewPolicyRefusal(error) {
  const directCode = ownData(error, "code");
  if (TERMINAL_REVIEW_POLICY_CONVERTIBLE_CODE_SET.has(directCode)) {
    return policyCause({
      code: directCode,
      message: ownData(error, "message"),
      detail: ownData(error, "detail"),
      origin: "terminal_review_evidence_gate"
    });
  }

  return null;
}

function isPlainLifecycleObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactLifecycleFields(value, fields) {
  if (!isPlainLifecycleObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length &&
    fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

export function resolveTerminalReviewEvidence({ deps, integration, bindings, wkRef, runGit, workspaceDir }) {
  const mode = deps.terminalReviewEvidenceMode ?? null;
  const materializer = deps.materializeTerminalReviewWorktree;
  const transported = integration.terminal_review_evidence ?? null;
  const refusalDetail = {
    worktree_path: bindings.provisioning.validation_worktree_path,
    wk_ref: wkRef,
    frozen_sha: integration.review_target.sha,
    evidence_mode: mode
  };

  if (mode !== TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER) {
    throw lifecycleError(
      TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.MODE_UNAVAILABLE,
      "no launcher-owned terminal review evidence mode is composed, so the persistent review worktree cannot be proven current",
      refusalDetail
    );
  }

  if (typeof materializer !== "function") {
    throw lifecycleError(
      TERMINAL_REVIEW_MATERIALIZER_UNAVAILABLE_CODE,
      "the terminal review materialize/verify step is not composed, so the persistent review worktree cannot be proven current",
      refusalDetail
    );
  }
  if (transported !== null) {
    throw lifecycleError(
      TERMINAL_REVIEW_EVIDENCE_REFUSAL_CODES.UNEXPECTED_CARRIED_EVIDENCE,
      "the trusted in-process route verifies the worktree directly and refuses carried attestation data",
      refusalDetail
    );
  }
  const materialization = materializer({
    mainRepo: workspaceDir,
    worktreePath: bindings.provisioning.validation_worktree_path,
    wkRef,
    frozenSha: integration.review_target.sha,
    runGit
  });
  assertTerminalReviewMaterializationAttestation(materialization, {
    worktreePath: bindings.provisioning.validation_worktree_path,
    wkRef,
    wkSha: integration.review_target.sha
  });
  return materialization;
}

export function createTerminalCandidateReviewTarget({ binding, materialization } = {}) {
  assertTerminalCandidateMaterialization(materialization, binding);
  return Object.freeze({
    schema_version: "agent_launch.terminal_candidate_review_target.v1",
    review_identity_kind: "terminal_candidate",
    ref: binding.candidate_ref,
    sha: binding.candidate,
    candidate_ref: binding.candidate_ref,
    candidate_sha: binding.candidate,
    landing_ref: binding.landing_ref,
    landing_sha: binding.landing_tip,
    wk_ref: binding.wk_ref,
    wk_sha: binding.wk_tip,
    worktree_path: materialization.checkout_path,
    canonical_wk_digest: binding.canonical_wk_digest,
    diff_base_sha: binding.landing_tip,
    diff_head_sha: binding.candidate,
    diff_range: `${binding.landing_tip}..${binding.candidate}`,
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  });
}

export function verifyTerminalCandidateCycle({ terminalCandidate, runGit }) {
  if (!terminalCandidate || typeof terminalCandidate !== "object" ||
      !terminalCandidate.binding || !terminalCandidate.materialization) {
    throw lifecycleError(
      "agent_launch.terminal_candidate.missing_binding.v1",
      "terminal candidate lifecycle state is absent or incomplete"
    );
  }
  verifyTerminalWkCandidateObjectBinding({ binding: terminalCandidate.binding, runGit });
  assertTerminalCandidateMaterialization(terminalCandidate.materialization, terminalCandidate.binding);
  verifyTerminalCandidateCheckout({
    binding: terminalCandidate.binding,
    candidateRoot: terminalCandidate.materialization.candidate_root,
    runGit
  });
  return terminalCandidate;
}
