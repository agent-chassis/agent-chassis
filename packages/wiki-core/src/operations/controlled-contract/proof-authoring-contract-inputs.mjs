import { controlledContractContentDigest } from "../../lib/controlled-contract-tools.mjs";
import {
  inspectWorkRecordProofPosture
} from "../../lib/work-record-proof-posture.mjs";
import {
  compileControlledContractRequirements,
  projectControlledContractRequirements
} from "./contract-requirement-authoring.mjs";
import {
  deriveControlledContractAuthoringVocabulary
} from "./contract-requirement-vocabulary.mjs";
import {
  prepareControlledAcceptanceProofPostureAmendment
} from "./proof-posture-operations.mjs";

function contractInput(input, key) {
  return Object.hasOwn(input, key) ? input[key] : undefined;
}

export function compileProofAuthoringContractInputs({
  pkg, initial, input, baseContract = initial.contract?.content ?? null,
  retainedReferenceIds = [],
  now = () => new Date().toISOString()
}) {
  const requirements = contractInput(input, "contractRequirements");
  const controlledAcceptance = contractInput(input, "controlledAcceptance");
  let contract = baseContract;
  let requirementCompilation = null;
  if (requirements !== undefined) {
    requirementCompilation = compileControlledContractRequirements({
      wkId: initial.wkId,
      focus: initial.focus,
      answer: requirements,
      contract,
      vocabulary: deriveControlledContractAuthoringVocabulary(
        pkg.NATIVE_CONTRACT_SCHEMA_V1
      ),
      buildTestProofTemplate: pkg.buildStableTestProofBindingTemplate,
      schemaIdentity: {
        schema_version: pkg.SCHEMA_VERSION_V1,
        vocabulary_version: pkg.VOCABULARY_VERSION_V1,
        profile_id: pkg.PROFILE_ID_V1,
        test_proof_version: pkg.TEST_PROOF_VERSION_V1
      },
      retainedReferenceIds
    });
    contract = requirementCompilation.content;
  }
  let record = initial.record;
  let postureChanged = false;
  if (controlledAcceptance !== undefined) {
    const prepared = prepareControlledAcceptanceProofPostureAmendment({
      record,
      wkId: initial.wkId,
      disposition: controlledAcceptance.disposition,
      rationale: controlledAcceptance.rationale ?? null,
      allowCorrection: true,
      now
    });
    record = prepared.record;
    postureChanged = prepared.changed;
  }
  return Object.freeze({
    contract,
    contractChanged: requirements !== undefined &&
      controlledContractContentDigest(contract) !==
        controlledContractContentDigest(baseContract),
    requirementCompilation,
    record,
    postureChanged
  });
}

export function projectProofAuthoringContractInputs(resolved, {
  controlledContractNodeIds = null
} = {}) {
  const requirements = projectControlledContractRequirements(
    resolved.contract?.content ?? null,
    { controlledContractNodeIds }
  );
  const posture = inspectWorkRecordProofPosture(resolved.record, {
    expectedRecordId: resolved.wkId
  });
  return Object.freeze({
    schema_version: "proof-authoring-contract-inputs.v1",
    owner: Object.freeze({
      wk_id: resolved.wkId,
      focus: resolved.focus,
      controlled_acceptance_unit: resolved.wkId
    }),
    revision: resolved.revision,
    contract_content_digest: resolved.contract?.content_digest ?? null,
    requirements,
    controlled_acceptance: Object.freeze({
      status: !posture.present ? "unset" : posture.valid
        ? posture.disposition : "invalid",
      disposition: posture.valid ? posture.disposition : null,
      rationale: posture.valid
        ? posture.proof_posture?.classification_rationale ?? null : null,
      proof_posture: posture.valid ? posture.proof_posture : null,
      ...(posture.reason === null ? {} : { problem: posture.reason })
    })
  });
}
