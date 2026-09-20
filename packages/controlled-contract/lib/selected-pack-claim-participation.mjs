

import { loadAdmittedProofPack } from "./admitted-proof-packs.mjs";
import { evaluateAdmittedTestValidity } from "./test-proof-assessment.mjs";
import {
  StableVerificationError,
  evaluateVerificationProfileV1
} from "./verification-profile-v1.mjs";

const TEST_VALIDITY_PROFILE_SCHEMA_VERSION =
  "controlled-contract-test-validity-profile.v1";

class SelectedPackClaimParticipationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SelectedPackClaimParticipationError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function compareCodeUnits(left, right) {
  const leftString = String(left);
  const rightString = String(right);
  return leftString < rightString ? -1 : leftString > rightString ? 1 : 0;
}

const EVALUATION_GRAPH_SELECTIONS = new WeakMap();

function evaluateAdmittedPack({ contract, evaluationInput, proofPack }, options = {}) {

  const selections = [];
  const callerSink = typeof options.graphSelectionSink === "function"
    ? options.graphSelectionSink : null;
  const graphSelectionSink = (record) => {
    selections.push(record);
    if (callerSink !== null) callerSink(record);
  };
  try {
    const evaluation = proofPack.profile.schema_version ===
      TEST_VALIDITY_PROFILE_SCHEMA_VERSION
      ? evaluateAdmittedTestValidity({
          contract: structuredClone(contract),
          evaluationInput: structuredClone(evaluationInput),
          proofPack
        })
      : evaluateVerificationProfileV1({
          contract: structuredClone(contract),
          profile: structuredClone(proofPack.profile),
          evaluation_input: structuredClone(evaluationInput)
        }, { ...options, graphSelectionSink });
    if (evaluation !== null && typeof evaluation === "object") {
      EVALUATION_GRAPH_SELECTIONS.set(evaluation, selections);
    }
    return evaluation;
  } catch (error) {
    if (!(error instanceof StableVerificationError)) throw error;
    return {
      satisfaction: "invalid",
      profile: null,
      admission: null,
      diagnostics: structuredClone(error.details?.diagnostics?.diagnostics ?? [{
        code: error.code, message: error.message
      }])
    };
  }
}

function matchedProfileCoveredClaims(evaluation) {
  const patternsByClaim = new Map();
  const add = (claimId, patternId) => {
    const patternIds = patternsByClaim.get(claimId) ?? [];
    patternIds.push(patternId);
    patternsByClaim.set(claimId, patternIds);
  };
  const satisfiedReferenceBindings = new Set();
  for (const result of evaluation?.pattern_results ?? []) {
    if (result.status !== "satisfied") continue;
    if (result.pattern_kind === "reference_binding") {
      satisfiedReferenceBindings.add(result.pattern_id);
      continue;
    }
    if (result.pattern_kind !== "claim") continue;
    for (const claimId of result.matched_ids ?? []) add(claimId, result.pattern_id);
  }
  for (const record of EVALUATION_GRAPH_SELECTIONS.get(evaluation) ?? []) {
    if (record?.trace_point !== "complete_population_binding" ||
        record.node_kind !== "claim" ||
        !satisfiedReferenceBindings.has(record.pattern_id)) continue;
    for (const claimId of record.node_ids ?? []) add(claimId, record.pattern_id);
  }
  return [...patternsByClaim.entries()].map(([claimId, patternIds]) => ({
    claim_id: claimId,
    pattern_ids: [...new Set(patternIds)].sort(compareCodeUnits)
  })).sort((left, right) => compareCodeUnits(left.claim_id, right.claim_id));
}

function matchedProfileCoveredClaimIds(evaluation) {
  return matchedProfileCoveredClaims(evaluation).map(({ claim_id: id }) => id);
}

async function evaluateSelectedPackClaimParticipation({
  contract, evaluationInput, profileId, profileVersion
}) {
  const proofPack = await loadAdmittedProofPack(profileId);
  if (proofPack.profile.profile_version !== profileVersion) {
    throw new SelectedPackClaimParticipationError(
      "selected_pack_claim_participation_pack_version_stale",
      "the selected pack version is not the admitted catalog version",
      {
        profile_id: profileId,
        requested_profile_version: profileVersion,
        admitted_profile_version: proofPack.profile.profile_version
      }
    );
  }
  const evaluation = evaluateAdmittedPack({ contract, evaluationInput, proofPack });
  const claims = matchedProfileCoveredClaims(evaluation);
  return Object.freeze({
    profile_id: proofPack.profile.profile_id,
    profile_version: proofPack.profile.profile_version,
    profile_digest: proofPack.profile_digest,
    satisfaction: evaluation.satisfaction,
    covered_claims: Object.freeze(claims.map(({ claim_id: claimId, pattern_ids: ids }) =>
      Object.freeze({ claim_id: claimId, pattern_ids: Object.freeze([...ids]) }))),
    claim_ids: Object.freeze(claims.map(({ claim_id: claimId }) => claimId))
  });
}

export {
  SelectedPackClaimParticipationError,
  evaluateAdmittedPack,
  evaluateSelectedPackClaimParticipation,
  matchedProfileCoveredClaimIds,
  matchedProfileCoveredClaims
};
