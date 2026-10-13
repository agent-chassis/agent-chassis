

import { WK_FORGE_HANDOFF_FAILURE_CATEGORIES } from "./trusted-operation-contracts.mjs";
import {
  assertTerminalWkCandidateVersionDecision,
  inspectTerminalWkCandidateVersion,
  verifyHistoricalTerminalWkCandidateVersion,
  TERMINAL_WK_CANDIDATE_CODES,
  TerminalWkCandidateError,
  verifyTerminalWkCandidateObjectBinding
} from "./terminal-wk-candidate.mjs";
import {
  TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES,
  TerminalReviewMaterializationError
} from "./terminal-materialization-primitives.mjs";
import {
  assertTerminalCandidateMaterialization,
  verifyTerminalCandidateCheckout
} from "./terminal-candidate-checkout.mjs";
import { resolveCapturedWkBase } from "./worktree-substrate-identity.mjs";
import { captureDiagnosticEvidence } from "./diagnostic-evidence.mjs";
import {
  HANDOFF_TRANSPORTS,
  listRecordedHandoffs,
  resolveHandoffDestination,
  resolveRemoteUrl,
  wkHandoffRef
} from "./wk-handoff-destination.mjs";
import { isCanonicalWorkRecordBaseBranch } from
  "@agent-chassis/wiki-core/src/lib/work-record-base-branch.mjs";
import { authenticatedChainAt, readCandidateBoundRecord } from "./wk-forge-closeout-chain.mjs";
import {
  defaultRunGit,
  resolveCanonicalForgeRepository,
  sameForgeRepository
} from "./wk-forge-command.mjs";
import { buildGhForge } from "./wk-forge-gh-adapter.mjs";
import {
  INITIATIVE_RE,
  isPlainObject,
  projectHandoffDestination,
  refuse
} from "./wk-forge-handoff-refusal.mjs";

export function deriveForgeBranchName({ initiative, wk, candidate }) {
  return `handoff/wk/${initiative}/${wk}/${candidate}`;
}

async function authenticateCandidateMaterial({ binding, materialization, runGit }) {
  assertTerminalCandidateMaterialization(materialization, binding);
  await verifyTerminalWkCandidateObjectBinding({ binding, runGit });
  await verifyTerminalCandidateCheckout({
    binding, candidateRoot: materialization.candidate_root, runGit
  });
  const observedDecision = await inspectTerminalWkCandidateVersion({ binding, runGit });
  assertTerminalWkCandidateVersionDecision(observedDecision, {
    binding,
    requireSelected: true
  });
  return observedDecision;
}

const CANDIDATE_DISAGREEMENT_CODES = new Map([
  [TerminalWkCandidateError, new Set([
    TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
    TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED,
    TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_REF_DISAGREES,
    TERMINAL_WK_CANDIDATE_CODES.CONTROLLED_GENERATION_STALE
  ])],
  [TerminalReviewMaterializationError, new Set([
    TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID,
    TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.FROZEN_TARGET_MISMATCH
  ])]
]);

function isObservedCheckoutDisagreement(error) {
  return error instanceof TerminalReviewMaterializationError &&
    error.code === TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED &&
    isPlainObject(error.detail) && Object.hasOwn(error.detail, "expected") &&
    Object.hasOwn(error.detail, "actual");
}

function isObservedCandidateDisagreement(error) {
  for (const [owner, codes] of CANDIDATE_DISAGREEMENT_CODES) {
    if (error instanceof owner) return codes.has(error.code) || isObservedCheckoutDisagreement(error);
  }
  return false;
}

function candidateAuthenticationRefusal({ error, phase, binding, observed = null }) {
  const subject = { assigned_unit: binding.canonical_wk_id, candidate: binding.candidate };
  const evidence = captureDiagnosticEvidence(error);
  if (observed !== null || isObservedCandidateDisagreement(error)) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      stage: "candidate_authentication", phase, reason: "terminal_candidate_binding_moved", subject,
      observed: observed ?? { code: error.code, facts: error.detail ?? null },
      evidence
    });
  }
  return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
    stage: "candidate_authentication", phase,
    reason: "terminal_candidate_authentication_incomplete", subject,
    evidence
  });
}

export async function resolveCandidatePublicationIdentity({ mainRepo, wk, candidateState, deps, selection = null }) {
  const runGit = deps.runGit ?? defaultRunGit;
  const binding = candidateState?.binding;
  const materialization = candidateState?.materialization ?? null;
  if (binding?.canonical_wk_id !== wk) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      reason: "exact_terminal_candidate_unavailable"
    });
  }
  const historical = selection !== null && candidateState.historical_version !== undefined;
  if (!historical && materialization === null) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      reason: "terminal_candidate_materialization_unavailable"
    });
  }
  let candidateVersionDecision;
  try {
    candidateVersionDecision = await authenticateIdentityMaterial();
  } catch (error) {
    return candidateAuthenticationRefusal({ error, phase: "identity_resolution", binding });
  }
  if (selection !== null && candidateVersionDecision.version_identity !== selection.version) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REQUEST_INVALID, {
      reason: "publication_selection_version_mismatch",
      selected_version: selection.version, authenticated_version: candidateVersionDecision.version_identity
    });
  }
  async function authenticateIdentityMaterial() {
    if (!historical) return authenticateCandidateMaterial({ binding, materialization, runGit });
    const verified = await verifyHistoricalTerminalWkCandidateVersion({ binding, runGit });
    return Object.freeze({
      version_identity: verified.version_identity, immutable_version_ref: verified.version_ref,
      current_selection_observation: null
    });
  }
  const candidateRecord = readCandidateBoundRecord({ mainRepo, wk, binding, deps });
  if (candidateRecord.ok !== true || candidateRecord.record?.initiative == null) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      reason: candidateRecord.reason ?? "candidate_bound_record_unavailable"
    });
  }
  const initiative = candidateRecord.record.initiative;
  if (!INITIATIVE_RE.test(initiative)) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      reason: "candidate_bound_initiative_invalid"
    });
  }

  const resolvedDestination = resolveHandoffDestination({ repo: mainRepo, runGit });
  if (resolvedDestination.ok !== true) {
    const { ok: _ok, ...detail } = resolvedDestination;
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID, { stage: "destination", ...detail });
  }
  const destination = resolvedDestination.destination;

  const recorded = listRecordedHandoffs({
    repo: mainRepo, initiative, wk, candidate: binding.candidate, runGit
  });
  if (recorded.ok !== true) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.GIT_FAILED, {
      stage: "handoff_ref", reason: "handoff_ref_unobservable", evidence: recorded.evidence
    });
  }
  const selectedRef = destination.transport === HANDOFF_TRANSPORTS.HOSTED
    ? null
    : wkHandoffRef({ initiative, wk, candidate: binding.candidate, destination });
  const elsewhere = recorded.handoffs.find((handoff) => handoff.ref !== selectedRef);
  if (elsewhere !== undefined) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      stage: "destination",
      reason: "handoff_destination_changed",
      recorded_destination: elsewhere.destination,
      selected_destination: projectHandoffDestination(destination)
    });
  }
  if (selection !== null &&
      (selection.destination.transport !== destination.transport ||
       (selection.destination.remote ?? null) !== (destination.remote ?? null))) {
    return refuse(recorded.handoffs.length > 0
      ? WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REQUEST_INVALID
      : WK_FORGE_HANDOFF_FAILURE_CATEGORIES.ELIGIBILITY, {
      stage: "destination",
      reason: recorded.handoffs.length > 0 ? "publication_selection_destination_mismatch"
        : "publication_selection_destination_unestablished",
      recorded_destination: recorded.handoffs.length > 0 ? projectHandoffDestination(destination) : null
    });
  }
  let repository = null;
  let forge = null;

  let remoteUrl = null;
  if (destination.transport === HANDOFF_TRANSPORTS.HOSTED) {
    const remote = resolveCanonicalForgeRepository({ repo: mainRepo, remoteName: destination.remote, deps });
    if (remote.ok !== true) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID, {
        reason: remote.reason,
        ...(remote.evidence === undefined ? {} : { evidence: remote.evidence })
      });
    }
    repository = remote.repository;
    forge = deps.forge ?? buildGhForge({ repository, mainRepo, deps });
    if (!sameForgeRepository(forge.repository, repository)) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID, { reason: "git_rest_repository_disagreement" });
    }
    const probe = forge.probe();
    if (probe.state !== "authenticated") {
      return { ok: true, unauthenticatedForge: probe, initiative };
    }
  } else if (destination.transport === HANDOFF_TRANSPORTS.GIT) {
    const remote = resolveRemoteUrl({ repo: mainRepo, remoteName: destination.remote, runGit });
    if (remote.ok !== true) {
      return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID, {
        stage: "destination",
        reason: remote.reason,
        remote: destination.remote,
        ...(remote.evidence === undefined ? {} : { evidence: remote.evidence })
      });
    }
    remoteUrl = remote.url;
  }

  const resolveCapturedBase = deps.resolveCapturedWkBase ?? resolveCapturedWkBase;
  const capturedBase = resolveCapturedBase({
    mainRepo,
    unitAddress: `${initiative}/${wk}`
  });
  const landing = candidateRecord.record.base_branch ?? capturedBase?.base_ref ?? null;
  if (!isCanonicalWorkRecordBaseBranch(landing) || capturedBase === null) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.REMOTE_INVALID, {
      reason: "wk_base_branch_identity_unavailable"
    });
  }
  if (landing !== capturedBase.base_ref) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.PUBLICATION_DISAGREEMENT, {
      reason: "authored_base_branch_disagrees_with_captured_allocation",
      authored_base_branch: landing,
      captured_base_branch: capturedBase.base_ref
    });
  }
  const branch = deriveForgeBranchName({ initiative, wk, candidate: binding.candidate });
  const handoffRef = selectedRef;

  const guard = async () => {
    let observedDecision;
    try {
      observedDecision = await authenticateIdentityMaterial();
    } catch (error) {
      return candidateAuthenticationRefusal({ error, phase: "boundary_reauthentication", binding });
    }
    const moved = ["version_identity", "immutable_version_ref", "current_selection_observation"]
      .find((field) => observedDecision[field] !== candidateVersionDecision[field]);
    if (moved !== undefined) {
      return candidateAuthenticationRefusal({
        error: new Error("terminal candidate version selection moved during forge handoff"),
        phase: "boundary_reauthentication",
        binding,
        observed: {
          field: moved, expected: candidateVersionDecision[moved], actual: observedDecision[moved]
        }
      });
    }
    return null;
  };
  return {
    ok: true,
    identity: Object.freeze({
      binding, candidateVersionDecision, candidateRecord: candidateRecord.record, initiative,
      destination, repository, forge, remoteUrl, landing, branch, handoffRef, guard
    })
  };
}

export async function authenticatedBranchHead({ mainRepo, wk, binding, sha, deps }) {
  return (await authenticatedChainAt({ mainRepo, wk, binding, sha, deps }))?.head ?? null;
}
