

import { readFile } from "node:fs/promises";

import {
  compiledValidators,
  createEvictOnRejectionMemo
} from "@agent-chassis/controlled-contract/validator-cache";

import { ControlledContractToolError } from "../../lib/controlled-contract-tool-shared.mjs";

const CONTROLLED_CONTRACT_MODULE_SPECIFIER = "@agent-chassis/controlled-contract";
const PROOF_PLAN_REQUEST_SCHEMA_SPECIFIER =
  "@agent-chassis/controlled-contract/schema/controlled-contract-proof-plan-request.v1.schema.json";
const EVALUATION_INPUT_SCHEMA_SPECIFIER =
  "@agent-chassis/controlled-contract/schema/controlled-contract-verification-profile-input.v2.schema.json";

const EVALUATION_INPUT_VALIDATOR_GROUP =
  "wiki-core.controlled-contract-operations.evaluation-input.v1";

function addressedEvaluationInputPack(input) {
  const hasProfileId = input.profileId !== undefined;
  const hasProfileVersion = input.profileVersion !== undefined;
  if (hasProfileId !== hasProfileVersion) throw new ControlledContractToolError(
    "controlled_contract_pack_identity_invalid",
    "profile_id and profile_version must be supplied together"
  );
  if (!hasProfileId) return null;
  if (input.carrierKind !== "evaluation_input") throw new ControlledContractToolError(
    "controlled_contract_pack_identity_forbidden",
    "exact profile identity addresses only an evaluation-input carrier"
  );
  return { profileId: input.profileId, profileVersion: input.profileVersion };
}

const loadControlledContractPackage = createEvictOnRejectionMemo(() =>
  import(CONTROLLED_CONTRACT_MODULE_SPECIFIER));

const loadControlledContractProofPlanCompiler = createEvictOnRejectionMemo(() =>
  import(`${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/proof-plan-compiler`));

const SHARED_CONTRACT_SPECIFIERS = Object.freeze([
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/proof-contract`,
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/test-proof`,
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/native-test-cases`,
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/obligation-coverage`,
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/acceptance-coverage-identity`
]);

const loadControlledContractSharedContract = createEvictOnRejectionMemo(async () => {
  const modules = await Promise.all(SHARED_CONTRACT_SPECIFIERS.map(
    (specifier) => import(specifier)));
  return Object.freeze(Object.assign({}, ...modules.map((module) => ({ ...module }))));
});

const PROOF_AUTHORING_SPECIFIERS = Object.freeze([
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/proof-selection`,
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/native-contract`,
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/proof-authoring-diagnostic-groups`
]);

const loadControlledContractProofAuthoring = createEvictOnRejectionMemo(async () => {
  const [shared, ...modules] = await Promise.all([loadControlledContractSharedContract(),
    ...PROOF_AUTHORING_SPECIFIERS.map((specifier) => import(specifier))]);
  return Object.freeze(Object.assign({}, shared, ...modules.map((module) => ({ ...module }))));
});

const loadControlledContractProofIntents = createEvictOnRejectionMemo(() =>
  import(`${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/proof-intents`));

const loadProofPlanRequestSchema = createEvictOnRejectionMemo(() =>
  readFile(new URL(import.meta.resolve(PROOF_PLAN_REQUEST_SCHEMA_SPECIFIER)), "utf8")
    .then(JSON.parse));

const loadEvaluationInputSchemaValue = createEvictOnRejectionMemo(() =>
  readFile(new URL(import.meta.resolve(EVALUATION_INPUT_SCHEMA_SPECIFIER)), "utf8")
    .then(JSON.parse));

const loadEvaluationInputSchema = createEvictOnRejectionMemo(async () => {
  const schema = await loadEvaluationInputSchemaValue();
  const { validateEvaluationInput } = await compiledValidators(
    EVALUATION_INPUT_VALIDATOR_GROUP,
    { validators: { validateEvaluationInput: schema } }
  );
  return validateEvaluationInput;
});

export function packageValidationDiagnostics(validation, candidate = null) {
  const projection = validation.diagnostics;
  const details = structuredClone(validation.diagnostic_details ??
    projection?.diagnostics ?? []);
  const lossless = projection?.truncated === false && projection?.omitted_count === 0;
  const contradictions = details.filter(row => row.code === 'irreflexive_proposition');
  const authored = contradictions.flatMap(diagnostic => (candidate?.authored_requirements?.rows ?? []).flatMap(row => {
    const verifications = (candidate.relations ?? []).filter(relation => relation.role === 'verifies' &&
      row.claim_ids.includes(relation.target_claim_id)).map(relation => relation.source_claim_id);
    return (candidate.claims ?? []).filter(claim => verifications.includes(claim.claim_id) &&
      claim.falsifying_proposition_id === diagnostic.proposition_id).map(claim => ({
      code: diagnostic.code, proposition_id: diagnostic.proposition_id, row_id: row.row_id,
      claim_ids: row.claim_ids, verification_claim_id: claim.claim_id, field: 'verification.fails_when'
    }));
  }));
  const mappedIds = [...new Set(authored.map(row => row.proposition_id))];
  const unmappedIds = contradictions.filter(diagnostic => !mappedIds.includes(diagnostic.proposition_id))
    .map(diagnostic => diagnostic.proposition_id);
  return {
    contract_family: validation.family,
    diagnostics: projection,
    ...(contradictions.length === 0 ? {} : { authored_falsifiers: authored,
      ...(unmappedIds.length === 0 ? {} : { unmapped_contradiction_ids: unmappedIds, location_limitation:
        'No authored field is established for the listed native propositions; their native diagnostic locations remain authoritative.' }),
      ...(mappedIds.length === 0 ? {} : { falsifier_recovery: {
        proposition_ids: mappedIds, guidance_path: ['required_object_shapes', 'verification'],
        correction: 'For these mapped falsifiers, asserting a subject differs from itself cannot describe a contrary outcome. KEEP the required behavior and its applicability, source and evidence associations. Supply an author-defined verification.fails_when tied to that behavior; a different arbitrary symbol is not a falsifier.' } }) }),
    ...(lossless
      ? { diagnostic_details_omitted: Object.freeze({
        reason: "bounded_projection_carries_every_diagnostic_fact",
        diagnostic_count: details.length
      }) }
      : { diagnostic_details: details })
  };
}

function assertPackageValidContract(validation, candidate = null) {
  if (!validation.valid) throw new ControlledContractToolError(
    "controlled_contract_carrier_validation_failed", "contract failed package validation",
    {

      changed: false,
      ...packageValidationDiagnostics(validation, candidate)
    }
  );
  return validation;
}

export {
  EVALUATION_INPUT_VALIDATOR_GROUP,
  SHARED_CONTRACT_SPECIFIERS,
  addressedEvaluationInputPack,
  assertPackageValidContract,
  loadControlledContractPackage,
  loadControlledContractProofPlanCompiler,
  loadControlledContractProofAuthoring,
  loadControlledContractProofIntents,
  loadControlledContractSharedContract,
  loadEvaluationInputSchema,
  loadEvaluationInputSchemaValue,
  loadProofPlanRequestSchema
};
