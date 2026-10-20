import { accountParentRequirementSource, compactRequirementSourceAccounting } from './contract-requirement-source-links.mjs';
import { controlledContractContentDigest } from "../../lib/controlled-contract-tools.mjs";
import { today } from "../../lib/wiki-shared.mjs";
import {
  inspectWorkRecordProofPosture,
  prepareControlledAcceptanceProofPostureAmendment
} from "../../lib/work-record-proof-posture.mjs";
import {
  compileControlledContractRequirements,
  projectControlledContractRequirements,
  projectControlledContractReferenceClosure,
  controlledContractIdentityScope
} from "./contract-requirement-authoring.mjs";
import { prepareRequirementBatch, requirementDescriptionEntities } from "./contract-requirement-projection.mjs";
import { prepareRequirementDescriptionSources } from './contract-requirement-description-sources.mjs';
import {
  deriveControlledContractAuthoringVocabulary
} from "./contract-requirement-vocabulary.mjs";

function contractInput(input, key) {
  return Object.hasOwn(input, key) ? input[key] : undefined;
}

const requirementCompiler = ({ pkg, initial, contract, retainedReferenceIds = [] }) =>
  (answer, { statementsOfRows = answer.authored_requirements !== undefined } = {}) =>
  compileControlledContractRequirements({
    wkId: initial.wkId,
    focus: initial.focus,
    answer,
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
    retainedReferenceIds,

    ...(statementsOfRows ? { statementBound: Number.POSITIVE_INFINITY } : {})
  });

export function prepareProofAuthoringRequirementBatch({ pkg, initial, batch, removeRowIds, retireClaimIds, sourceText, selectionContext }) {
  const contract = initial.contract?.content ?? null;
  return prepareRequirementBatch({ wkId: initial.wkId, focus: initial.focus, contract, batch, removeRowIds, retireClaimIds,
    sourceText, selectionContext, compile: requirementCompiler({ pkg, initial, contract }) });
}

export function compileProofAuthoringContractInputs({
  pkg, initial, input, baseContract = initial.contract?.content ?? null,
  retainedReferenceIds = [],
  now = today
}) {
  const requirements = contractInput(input, "contractRequirements");
  const controlledAcceptance = contractInput(input, "controlledAcceptance");
  let contract = baseContract;
  let requirementCompilation = null;
  if (requirements !== undefined) {
    requirementCompilation = requirementCompiler({ pkg, initial, contract, retainedReferenceIds })(requirements);
    contract = requirementCompilation.content;
  }
  let record = initial.record;
  let postureChanged = false;

  let proofPosturePreparation = null;
  if (controlledAcceptance !== undefined) {
    const prepared = prepareControlledAcceptanceProofPostureAmendment({
      record,
      wkId: initial.wkId,
      disposition: controlledAcceptance.disposition,
      rationale: controlledAcceptance.rationale ?? null,
      sourcePassages: controlledAcceptance.sourcePassages,
      allowCorrection: true,
      now,
      sourceDigest: initial.recordSourceDigest
    });
    proofPosturePreparation = prepared;
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
    postureChanged,
    proofPosturePreparation
  });
}

export function projectProofAuthoringContractInputs(resolved, {
  controlledContractNodeIds = null, descriptionPreparation = null, visibleNodeIds = null
} = {}) {
  const requirements = projectControlledContractRequirements(
    resolved.contract?.content ?? null,
    { controlledContractNodeIds, descriptionOwner: controlledContractIdentityScope(resolved.wkId, resolved.focus), visibleNodeIds,
      sourceDescriptions: descriptionPreparation?.descriptions ?? new Map(), sourceGeneration: descriptionPreparation?.source_generation ?? null }
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
    parent_source_accounting: compactRequirementSourceAccounting(
      accountParentRequirementSource(resolved.contract?.content ?? null, resolved.record)),
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

export async function prepareProofAuthoringDescriptionRead(resolved, { controlledContractNodeIds = null, additionalReferenceIds = [] } = {}) {
  const owner = controlledContractIdentityScope(resolved.wkId, resolved.focus);
  const selected = projectControlledContractRequirements(resolved.contract?.content ?? null, { controlledContractNodeIds, descriptionOwner: owner });
  projectControlledContractReferenceClosure(resolved.contract?.content ?? null, additionalReferenceIds.map(reference_id =>
    ({ reference_id, field: 'cases.component.reference_id' })));
  const references = new Map((resolved.contract?.content.references ?? []).map(row => [row.reference_id, row]));
  const entities = requirementDescriptionEntities(resolved.contract?.content ?? null, { unit: owner,
    claimIds: controlledContractNodeIds === null ? null : new Set(selected.requirements.map(row => row.claim_id)),
    additionalRoots: additionalReferenceIds.map(id => {
      const reference = references.get(id);
      return { owner, entity: { type_term: reference.type_term, identity: reference.identity } };
    }) });
  return prepareRequirementDescriptionSources({ repoRoot: resolved.repoRoot, repository: resolved.record.repo,
    owner, entities });
}
