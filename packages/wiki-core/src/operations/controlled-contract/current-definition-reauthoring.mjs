import {
  ControlledContractToolError,
  controlledContractCarrierFilename,
  withCanonicalControlledContractSourceLease
} from "../../lib/controlled-contract-tools.mjs";
import { loadControlledContractPackage } from "./package-runtime.mjs";
import {
  compileControlledContractAuthoringProspectiveMembers,
  settleControlledContractAuthoringProspectiveMembers,
  validateControlledContractAuthoringProspectiveMembers
} from "./authoring-prospective-settlement.mjs";
import {
  composeControlledContractRuntimeTestSelectorCorrection
} from "./contract-requirement-runtime-proof.mjs";

function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, {
    changed: false,
    limb: "mechanical_failure",
    owner: "controlled_contract_current_definition_reauthoring",
    ...details
  });
}

export async function reauthorControlledContractCurrentDefinitions({
  repoRoot, wkId, focus = null, expectedContentDigest, qualification, definitions
}, {
  withSourceLease = withCanonicalControlledContractSourceLease,
  compile = compileControlledContractAuthoringProspectiveMembers,
  validateProspective = validateControlledContractAuthoringProspectiveMembers,
  settle = settleControlledContractAuthoringProspectiveMembers
} = {}) {
  return withSourceLease({ repoRoot, wkId, focus,
    mutation: { carrierKind: "contract" } }, async (source) => {
    const filename = controlledContractCarrierFilename({
      wkId, focus, carrierKind: "contract"
    });
    const member = source.canonical_set.members_by_basename[filename] ?? null;
    if (member === null || member.content_digest !== expectedContentDigest) fail(
      "controlled_contract_current_definition_source_stale",
      "the canonical definition source moved after the correction offer was issued",
      { expected_content_digest: expectedContentDigest,
        actual_content_digest: member?.content_digest ?? null }
    );
    const contract = source.canonical_members[filename];
    const qualifiedById = new Map(qualification.definitions.map((definition) =>
      [definition.verification_claim_id, definition]));
    const storedById = new Map((contract?.test_proofs ?? []).map((proof) =>
      [proof.verification_claim_id, proof]));
    const replacements = definitions.map((answer, index) => {
      const qualified = qualifiedById.get(answer.verification_claim_id);
      const stored = storedById.get(answer.verification_claim_id);
      if (qualified === undefined || stored === undefined) fail(
        "controlled_contract_current_definition_answer_foreign",
        "one definition answer is not a member of the server-selected population",
        { answer_index: index,
          verification_claim_id: answer.verification_claim_id ?? null }
      );
      return {
        op: "replace",
        verification_id: answer.verification_claim_id,
        binding: composeControlledContractRuntimeTestSelectorCorrection({
          storedBinding: stored,
          runtimeTest: answer.runtime_test,
          retireFields: answer.retire_fields,
          expectedRetiredFields: qualified.unexpected_fields,
          field: `definitions[${index}]`
        })
      };
    });
    const pkg = await loadControlledContractPackage();
    let prepared;
    try {
      prepared = pkg.reauthorStableCurrentDefinitionBindings({
        contract, qualification, replacements
      });
    } catch (error) {
      if (!(error instanceof pkg.StableTestProofContractError)) throw error;
      throw new ControlledContractToolError(error.code, error.message, {
        ...error.details,
        changed: false,
        limb: "mechanical_failure",
        owner: "stable_test_proof"
      });
    }
    const prospective = compile({
      wkId,
      focus,
      source,
      contributions: [{
        owner: "test_proof",
        carrier_kind: "contract",
        filename,
        content: prepared.contract
      }]
    });
    validateProspective(prospective, { source });
    const receipt = await settle({
      repoRoot, wkId, focus, source, prospective, coverage: null
    });
    return Object.freeze({
      schema_version: "controlled-contract-current-definition-reauthoring-result.v1",
      changed: receipt.outcome === "written",
      changed_verification_ids: prepared.changed_verification_ids,
      invalidated_proof_plan: prospective.invalidated_proof_plan,
      preserved_unselected_falsifiers: true,
      verification_outcomes_transferred: false,
      receipt
    });
  });
}
