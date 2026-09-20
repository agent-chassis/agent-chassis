

import { ControlledContractToolError } from "../../lib/controlled-contract-tools.mjs";

export const CONTROLLED_CONTRACT_CONTINUATION_ADMISSIBILITY_SCHEMA =
  "controlled-contract-continuation-admissibility.v1";

export const CONTROLLED_CONTRACT_CONTINUATION_INADMISSIBLE_REASON =
  "controlled_contract_verification_continuation_inadmissible";

export const CONTROLLED_CONTRACT_CONTINUATION_ADMISSIBILITY_CHECKS = Object.freeze([
  "identity_schema_invalid",
  "identity_absent",
  "identity_ambiguous",
  "not_verification_claim",
  "method_not_runtime",
  "cross_owner_conflict",
  "template_unavailable",
  "bound_target_invalid"
]);

function refused(check, detail = {}) {
  if (!CONTROLLED_CONTRACT_CONTINUATION_ADMISSIBILITY_CHECKS.includes(check)) {
    throw new ControlledContractToolError(
      "controlled_contract_continuation_admissibility_check_unknown",
      "an admissibility refusal named a check outside the bounded vocabulary",
      { changed: false, failed_check: check });
  }
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_CONTINUATION_ADMISSIBILITY_SCHEMA,
    response_kind: "verification_bundle",
    admissible: false,
    failed_check: check,
    reason_code: CONTROLLED_CONTRACT_CONTINUATION_INADMISSIBLE_REASON,
    ...detail
  });
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function claimIdentityAdmitted(pkg, verificationId) {
  const pattern = pkg?.VERIFICATION_BUNDLE_VOCABULARY?.identity_patterns?.claim_id;
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new ControlledContractToolError(
      "controlled_contract_verification_bundle_vocabulary_unavailable",
      "the package owns no verification-claim identity pattern",
      { changed: false });
  }
  return new RegExp(pattern, "u").test(verificationId);
}

export function resolveControlledContractVerificationBundleAdmissibility({
  contract, verificationId, eligibility = null, pkg
}) {
  if (typeof verificationId !== "string" || verificationId.length === 0) {
    return refused("identity_schema_invalid", { verification_id: null });
  }
  const bound = { verification_id: verificationId };
  if (!claimIdentityAdmitted(pkg, verificationId)) {

    return refused("identity_schema_invalid", bound);
  }
  if (!plainObject(contract) || !Array.isArray(contract.claims)) {
    return refused("identity_absent", bound);
  }
  const matches = contract.claims.filter(({ claim_id: id }) => id === verificationId);
  if (matches.length === 0) return refused("identity_absent", bound);
  if (matches.length > 1) {
    return refused("identity_ambiguous", { ...bound, claim_count: matches.length });
  }
  const [claim] = matches;
  const vocabulary = pkg?.VERIFICATION_BUNDLE_VOCABULARY?.verification_claim ?? null;
  if (vocabulary === null) {
    throw new ControlledContractToolError(
      "controlled_contract_verification_bundle_vocabulary_unavailable",
      "the package owns no verification-claim contract",
      { changed: false });
  }
  if (claim.kind !== vocabulary.kind) {
    return refused("not_verification_claim", { ...bound, claim_kind: claim.kind ?? null });
  }
  if (claim.verification_method !== vocabulary.verification_method) {
    return refused("method_not_runtime",
      { ...bound, verification_method: claim.verification_method ?? null });
  }
  if (eligibility !== null) {

    const row = eligibility.find(({ verification_id: id }) => id === verificationId)
      ?? null;
    if (row !== null && row.classification !== "runtime") {
      return refused("cross_owner_conflict", { ...bound,
        classification: row.classification ?? null,
        reason_code_observed: row.reason_code ?? null });
    }
  }
  let template;
  try {
    template = pkg.buildVerificationBundleTemplate({ contract, verificationId });
  } catch (error) {
    return refused("template_unavailable", { ...bound,
      owner_code: error?.code ?? null });
  }

  const bundle = template?.bundle ?? null;
  const holes = Array.isArray(template?.author_semantics)
    ? template.author_semantics : [];
  if (!plainObject(bundle) || bundle.verification_id !== verificationId ||
      !Array.isArray(bundle.claims) || bundle.claims.length !== 1 ||
      bundle.claims[0].claim_id !== verificationId ||
      bundle.claims[0].kind !== vocabulary.kind ||
      bundle.claims[0].verification_method !== vocabulary.verification_method ||
      bundle.claims[0].modality !== claim.modality ||
      holes.length === 0 ||
      holes.some(({ pointer }) => typeof pointer !== "string" ||
        !pointer.startsWith("/"))) {
    return refused("bound_target_invalid", bound);
  }
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_CONTINUATION_ADMISSIBILITY_SCHEMA,
    response_kind: "verification_bundle",
    admissible: true,
    failed_check: null,
    reason_code: null,
    verification_id: verificationId,
    semantic_hole_count: holes.length
  });
}

export function projectControlledContractContinuationAdmissibility(result) {
  if (result === null || result === undefined) return null;
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_CONTINUATION_ADMISSIBILITY_SCHEMA,
    response_kind: result.response_kind,
    admissible: result.admissible === true,
    failed_check: result.failed_check ?? null,
    reason_code: result.reason_code ?? null,
    verification_id: result.verification_id ?? null,
    semantic_hole_count: result.semantic_hole_count ?? null
  });
}
