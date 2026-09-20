

import {
  ControlledContractToolError,
  controlledContractContentDigest
} from "../../lib/controlled-contract-tools.mjs";
import { loadControlledContractPackage } from "./package-runtime.mjs";

export const CONTROLLED_CONTRACT_EMBEDDED_PROOF_EVOLUTION_SCHEMA =
  "controlled-contract-embedded-proof-evolution.v1";

function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, {
    changed: false, limb: "mechanical_failure",
    owner: "buildProspectiveProofPlan", ...details
  });
}

function carrierRow(carrierKind, filename, content) {
  return Object.freeze({
    carrier_kind: carrierKind, filename,
    content_digest: controlledContractContentDigest(content),
    source_content_digest: controlledContractContentDigest(content),
    content
  });
}

export async function prepareControlledContractEmbeddedProofEvolution({
  wkId, focus = null, sourceContract, prospectiveContract, contractFilename,
  proofPlanFilename, request, evaluationInputs
}, { pkg = null } = {}) {
  if (sourceContract === null || typeof sourceContract !== "object" ||
      prospectiveContract === null || typeof prospectiveContract !== "object" ||
      request === null || typeof request !== "object" ||
      evaluationInputs === null || typeof evaluationInputs !== "object" ||
      typeof contractFilename !== "string" ||
      typeof proofPlanFilename !== "string") fail(
    "controlled_contract_embedded_proof_source_incomplete",
    "embedded proof evolution requires authenticated source and prospective contracts");
  const loaded = pkg ?? await loadControlledContractPackage();
  if (typeof loaded.buildProspectiveProofPlan !== "function") fail(
    "controlled_contract_refactor_package_incompatible",
    "loaded controlled-contract package has no prospective proof-plan owner");
  let built;
  try {
    built = await loaded.buildProspectiveProofPlan({
      sourceContract, prospectiveContract, request, evaluationInputs
    });
  } catch (error) {
    fail(error?.code ?? "controlled_contract_prospective_proof_plan_invalid",
      error?.message ?? "prospective proof-plan compilation failed",
      error?.details ?? {});
  }
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_EMBEDDED_PROOF_EVOLUTION_SCHEMA,
    owner: "buildProspectiveProofPlan",
    wk_id: wkId,
    focus: focus ?? null,
    contract_filename: contractFilename,
    proof_plan_filename: proofPlanFilename,
    contract: structuredClone(built.contract),
    proof_plan: structuredClone(built.proof_plan),
    evaluation_inputs: structuredClone(built.evaluation_inputs ?? {}),
    generated_stable_test_proofs:
      structuredClone(built.generated_stable_test_proofs ?? []),
    removed_stable_test_proofs:
      structuredClone(built.removed_stable_test_proofs ?? []),
    generated_bindings: structuredClone(built.generated_bindings ?? []),
    counts: Object.freeze({
      generated_stable_test_proofs:
        built.counts?.generated_stable_test_proofs ??
          (built.generated_stable_test_proofs ?? []).length,
      removed_stable_test_proofs:
        built.counts?.removed_stable_test_proofs ??
          (built.removed_stable_test_proofs ?? []).length,
      generated_bindings:
        built.counts?.generated_bindings ?? (built.generated_bindings ?? []).length
    }),
    source_bindings: Object.freeze({
      source_contract_content_digest: controlledContractContentDigest(sourceContract),
      prospective_contract_content_digest:
        controlledContractContentDigest(prospectiveContract),
      request_content_digest: controlledContractContentDigest(request)
    })
  });
}

export async function validateControlledContractEmbeddedProofEvolution(prepared, {
  pkg = null
} = {}) {
  if (prepared === null || typeof prepared !== "object" ||
      prepared.schema_version !== CONTROLLED_CONTRACT_EMBEDDED_PROOF_EVOLUTION_SCHEMA ||
      prepared.contract === null || typeof prepared.contract !== "object" ||
      prepared.proof_plan === null || typeof prepared.proof_plan !== "object") fail(
    "controlled_contract_embedded_proof_preparation_invalid",
    "prospective embedded proof evolution is not one complete artifact set");
  const loaded = pkg ?? await loadControlledContractPackage();
  if (typeof loaded.inspectControlledContractRefactorIdentityPopulation !== "function") {
    fail("controlled_contract_refactor_package_incompatible",
      "loaded controlled-contract package has no identity-role taxonomy owner");
  }
  const liveCarriers = [
    carrierRow("contract", prepared.contract_filename, prepared.contract),
    carrierRow("proof_plan", prepared.proof_plan_filename, prepared.proof_plan),
    ...Object.entries(prepared.evaluation_inputs).map(([filename, content]) =>
      carrierRow("evaluation_input", filename, content))
  ].sort((left, right) => left.filename.localeCompare(right.filename));
  try {
    return await loaded.inspectControlledContractRefactorIdentityPopulation({
      live_carriers: liveCarriers
    });
  } catch (error) {
    throw new ControlledContractToolError(
      error?.code ?? "controlled_contract_refactor_identity_population_invalid",
      error?.message ?? "prospective proof identity population is invalid",
      { changed: false, limb: "mechanical_failure", ...(error?.details ?? {}),
        owner: error?.owner ?? "controlled_contract_refactor_graph" });
  }
}

export function controlledContractEmbeddedProofContributions(prepared) {
  return Object.freeze([
    Object.freeze({ owner: "buildProspectiveProofPlan", carrier_kind: "contract",
      filename: prepared.contract_filename, content: prepared.contract }),
    Object.freeze({ owner: "buildProspectiveProofPlan", carrier_kind: "proof_plan",
      filename: prepared.proof_plan_filename, content: prepared.proof_plan }),
    ...Object.entries(prepared.evaluation_inputs).sort(([left], [right]) =>
      left.localeCompare(right)).map(([filename, content]) =>
      Object.freeze({ owner: "buildProspectiveProofPlan",
        carrier_kind: "evaluation_input", filename, content }))
  ]);
}
