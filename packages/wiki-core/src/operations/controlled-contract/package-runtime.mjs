

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
  "@agent-chassis/controlled-contract/schema/controlled-contract-verification-profile-input.v1.schema.json";

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

function assertPackageValidContract(validation) {
  if (!validation.valid) throw new ControlledContractToolError(
    "controlled_contract_carrier_validation_failed", "contract failed package validation",
    {
      contract_family: validation.family,
      diagnostics: validation.diagnostics
    }
  );
  return validation;
}

export {
  EVALUATION_INPUT_VALIDATOR_GROUP,
  addressedEvaluationInputPack,
  assertPackageValidContract,
  loadControlledContractPackage,
  loadEvaluationInputSchema,
  loadEvaluationInputSchemaValue,
  loadProofPlanRequestSchema
};
