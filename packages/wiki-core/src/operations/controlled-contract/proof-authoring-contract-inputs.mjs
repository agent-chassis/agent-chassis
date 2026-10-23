import { accountParentRequirementSource, compactRequirementSourceAccounting } from './contract-requirement-source-links.mjs';
import { ControlledContractToolError, controlledContractContentDigest } from "../../lib/controlled-contract-tools.mjs";
import { today } from "../../lib/wiki-shared.mjs";
import {
  inspectWorkRecordProofPosture,
  prepareControlledAcceptanceProofPostureAmendment
} from "../../lib/work-record-proof-posture.mjs";
import { projectControlledContractRequirements, projectControlledContractReferenceClosure } from "./contract-requirement-authoring.mjs";
import { controlledContractIdentityScope } from "./contract-requirement-identity.mjs";
import { requirementDescriptionEntities } from "./contract-requirement-projection.mjs";
import { prepareRequirementDescriptionSources } from './contract-requirement-description-sources.mjs';

function contractInput(input, key) {
  return Object.hasOwn(input, key) ? input[key] : undefined;
}

export function requireRequirementAuthoringOperation(requirementAuthoring, member) {
  if (typeof requirementAuthoring?.[member] !== "function") throw new ControlledContractToolError(
    "record_authoring_operation_unavailable",
    `The captured requirement authoring operation ${member} is unavailable.`, {
      changed: false, phase: "preparation", operation: member,
      cause: "The trusted composition supplied no callable operation.",
      correction: "Supply the captured requirementAuthoring group through trusted host options." });
  return requirementAuthoring[member];
}

export function compileProofAuthoringContractInputs({
  pkg, initial, input, requirementAuthoring, baseContract = initial.contract?.content ?? null,
  retainedReferenceIds = [],
  now = today
}) {
  const requirements = contractInput(input, "contractRequirements");
  const controlledAcceptance = contractInput(input, "controlledAcceptance");
  let contract = baseContract;
  let requirementCompilation = null;
  if (requirements !== undefined) {
    requirementCompilation = requireRequirementAuthoringOperation(requirementAuthoring, "compileRequirements")({
      pkg, initial, baseContract: contract, retainedReferenceIds, answer: requirements });
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
