import {
  canonicalValue,
  compareCodeUnits,
  deepFreeze
} from "./deterministic-projection-primitives.mjs";
import { buildProofPlan } from "./proof-plan-compiler.mjs";
import { assignIntents, loadSelectedPacks, packKey } from
  "./proof-plan-intent-assignment.mjs";
import { inspectProofPackBindingsPage } from
  "./proof-pack-binding-assistance.mjs";
import { validateStableTestProofContract } from "./test-proof-contract-v1.mjs";

class ProspectiveProofPlanError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProspectiveProofPlanError";
    this.code = code;
    this.details = deepFreeze(structuredClone(details));
  }
}

function refuse(code, message, details = {}) {
  throw new ProspectiveProofPlanError(code, message, details);
}

function verificationClaims(contract) {
  return (contract.claims ?? []).filter(({ kind, verification_method: method }) =>
    kind === "verification" && method === "test_execution");
}

const UNDERDETERMINED_PROOF_FIELDS = Object.freeze(["test_selector"]);

function completeProspectiveStableTestProofs({ sourceContract, prospectiveContract }) {
  const testExecutionClaimIds = new Set(verificationClaims(prospectiveContract).map(
    ({ claim_id: id }) => id));
  const retainedProofs = (prospectiveContract.test_proofs ?? []).filter(
    ({ verification_claim_id: id }) => testExecutionClaimIds.has(id));
  const removed = (prospectiveContract.test_proofs ?? []).filter(
    ({ verification_claim_id: id }) => !testExecutionClaimIds.has(id)).map(
    ({ test_proof_id: proofId, verification_claim_id: claimId }) => Object.freeze({
      test_proof_id: proofId, verification_claim_id: claimId,
      reason: "verification_method_not_test_execution"
    })).sort((left, right) => compareCodeUnits(
    `${left.verification_claim_id}\0${left.test_proof_id}`,
    `${right.verification_claim_id}\0${right.test_proof_id}`));
  const currentProofClaims = new Set(retainedProofs.map(
    ({ verification_claim_id: id }) => id));
  const missing = verificationClaims(prospectiveContract).filter(({ claim_id: id }) =>
    !currentProofClaims.has(id)).sort((left, right) =>
      compareCodeUnits(left.claim_id, right.claim_id));
  if (missing.length > 0) refuse(
    "controlled_contract_prospective_proof_semantics_underdetermined",
    "missing stable test proofs carry author-owned declarative meaning that cannot be derived",
    { missing_verification_claim_ids: missing.map(({ claim_id: id }) => id),
      underdetermined_fields: [...UNDERDETERMINED_PROOF_FIELDS] }
  );
  const generated = [];
  const contract = structuredClone(prospectiveContract);
  contract.test_proofs = [...retainedProofs, ...generated].sort(
    (left, right) => compareCodeUnits(left.verification_claim_id,
      right.verification_claim_id));
  const validation = validateStableTestProofContract(contract);
  if (!validation.valid) refuse(
    "controlled_contract_prospective_contract_invalid",
    "the uniquely derived stable proof population does not complete the prospective contract",
    { diagnostics: validation.diagnostics }
  );
  return Object.freeze({ contract: deepFreeze(canonicalValue(contract)),
    generated: Object.freeze(generated.map(({ test_proof_id: proofId,
      verification_claim_id: claimId }) => Object.freeze({
        test_proof_id: proofId, verification_claim_id: claimId
      }))), removed: Object.freeze(removed) });
}

function selectedEvaluationInput(evaluationInputs, selectedPack) {
  const path = selectedPack.evaluation_input_path;
  const content = typeof path === "string" ? evaluationInputs[path] : undefined;
  if (content === null || typeof content !== "object" || Array.isArray(content)) refuse(
    "controlled_contract_prospective_proof_input_missing",
    "a selected proof pack has no authenticated canonical evaluation input",
    { selected_pack: { profile_id: selectedPack.profile_id,
      profile_version: selectedPack.profile_version }, evaluation_input_path: path ?? null }
  );
  return { path, content };
}

function candidateForRole(inspection, role) {
  const candidates = inspection.items.filter(({ kind, role: candidateRole }) =>
    kind === `${role.kind}_candidate` && candidateRole === role.role);
  return candidates.length === 1 ? candidates[0].candidate : null;
}

async function completeProspectiveEvaluationInputs({ contract, request,
  evaluationInputs }) {
  const completed = structuredClone(evaluationInputs);
  const generated = [];
  const loaded = await loadSelectedPacks(request.selected_packs);
  const assignments = assignIntents(request.requested_intents, loaded);
  for (const { selected: selectedPack } of loaded) {
    const selected = selectedEvaluationInput(completed, selectedPack);
    const inspection = await inspectProofPackBindingsPage({
      contract,
      profileId: selectedPack.profile_id,
      profileVersion: selectedPack.profile_version,
      requestedIntents: assignments.get(packKey(selectedPack)),
      evaluationInput: selected.content,
      maximumItems: 128
    });
    const referenceBindings = new Map((selected.content.reference_bindings ?? []).map(
      (binding) => [binding.role, structuredClone(binding)]));
    const numberBindings = new Map((selected.content.number_bindings ?? []).map(
      (binding) => [binding.role, structuredClone(binding)]));
    for (const role of inspection.role_index) {
      if (role.status === "validly_bound") continue;
      if (role.status !== "one_compatible_candidate" ||
          role.compatible_candidate_count !== 1) refuse(
        "controlled_contract_prospective_proof_semantics_underdetermined",
        "prospective proof-plan bindings are not uniquely mechanically derivable",
        { selected_pack: { profile_id: selectedPack.profile_id,
          profile_version: selectedPack.profile_version }, role: role.role,
        binding_kind: role.kind, status: role.status,
        compatible_candidate_count: role.compatible_candidate_count }
      );
      const candidate = candidateForRole(inspection, role);
      if (candidate === null) refuse(
        "controlled_contract_prospective_proof_semantics_underdetermined",
        "prospective proof-plan binding inspection did not return its unique candidate",
        { selected_pack: { profile_id: selectedPack.profile_id,
          profile_version: selectedPack.profile_version }, role: role.role,
        binding_kind: role.kind }
      );
      if (role.kind === "reference") referenceBindings.set(role.role, {
        role: role.role, reference_ids: [candidate.reference_id]
      });
      else if (role.kind === "number") numberBindings.set(role.role, {
        role: role.role, value: candidate.value
      });
      else refuse("controlled_contract_prospective_proof_semantics_underdetermined",
        "prospective proof-plan binding has an unsupported mechanical kind",
        { role: role.role, binding_kind: role.kind });
      generated.push({ evaluation_input_path: selected.path,
        profile_id: selectedPack.profile_id,
        profile_version: selectedPack.profile_version,
        kind: role.kind, role: role.role });
    }
    const next = structuredClone(selected.content);
    next.reference_bindings = [...referenceBindings.values()].sort((left, right) =>
      compareCodeUnits(left.role, right.role));
    next.number_bindings = [...numberBindings.values()].sort((left, right) =>
      compareCodeUnits(left.role, right.role));
    completed[selected.path] = canonicalValue(next);
  }
  return deepFreeze({ evaluation_inputs: canonicalValue(completed),
    generated_bindings: generated.sort((left, right) => compareCodeUnits(
      `${left.evaluation_input_path}:${left.kind}:${left.role}`,
      `${right.evaluation_input_path}:${right.kind}:${right.role}`)) });
}

async function buildProspectiveProofPlan(input, ...unexpected) {
  if (unexpected.length > 0 || input === null || typeof input !== "object" ||
      Array.isArray(input) || JSON.stringify(Object.keys(input).sort()) !==
      JSON.stringify(["evaluationInputs", "prospectiveContract", "request",
        "sourceContract"].sort())) refuse(
    "controlled_contract_prospective_proof_plan_input_invalid",
    "prospective proof-plan compilation requires one closed owner-produced input"
  );
  const completed = completeProspectiveStableTestProofs({
    sourceContract: input.sourceContract,
    prospectiveContract: input.prospectiveContract
  });
  const completedInputs = await completeProspectiveEvaluationInputs({
    contract: completed.contract, request: input.request,
    evaluationInputs: input.evaluationInputs
  });
  const proofPlan = await buildProofPlan({ contract: completed.contract,
    request: input.request, evaluationInputs: completedInputs.evaluation_inputs });
  return deepFreeze({
    schema_version: "controlled-contract-prospective-proof-plan.v1",
    contract: completed.contract,
    proof_plan: proofPlan,
    evaluation_inputs: completedInputs.evaluation_inputs,
    generated_bindings: completedInputs.generated_bindings,
    generated_stable_test_proofs: completed.generated,
    removed_stable_test_proofs: completed.removed,
    counts: { generated_stable_test_proofs: completed.generated.length,
      removed_stable_test_proofs: completed.removed.length,
      generated_bindings: completedInputs.generated_bindings.length }
  });
}

export {
  ProspectiveProofPlanError,
  buildProspectiveProofPlan,
  completeProspectiveEvaluationInputs,
  completeProspectiveStableTestProofs
};
