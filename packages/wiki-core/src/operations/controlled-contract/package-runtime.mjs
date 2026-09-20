

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

const SHARED_CONTRACT_SPECIFIERS = Object.freeze([
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/proof-contract`,
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/test-proof`,
  `${CONTROLLED_CONTRACT_MODULE_SPECIFIER}/native-test-cases`
]);

const loadControlledContractSharedContract = createEvictOnRejectionMemo(async () => {
  const modules = await Promise.all(SHARED_CONTRACT_SPECIFIERS.map(
    (specifier) => import(specifier)));
  return Object.freeze(Object.assign({}, ...modules.map((module) => ({ ...module }))));
});

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

export function packageValidationDiagnostics(validation) {
  const projection = validation.diagnostics;
  const details = structuredClone(validation.diagnostic_details ??
    projection?.diagnostics ?? []);
  const lossless = projection?.truncated === false && projection?.omitted_count === 0;
  return {
    contract_family: validation.family,
    diagnostics: projection,
    ...(lossless
      ? { diagnostic_details_omitted: Object.freeze({
        reason: "bounded_projection_carries_every_diagnostic_fact",
        diagnostic_count: details.length
      }) }
      : { diagnostic_details: details })
  };
}

function assertPackageValidContract(validation) {
  if (!validation.valid) throw new ControlledContractToolError(
    "controlled_contract_carrier_validation_failed", "contract failed package validation",
    {

      changed: false,
      ...packageValidationDiagnostics(validation)
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
  loadControlledContractSharedContract,
  loadEvaluationInputSchema,
  loadEvaluationInputSchemaValue,
  loadProofPlanRequestSchema
};
