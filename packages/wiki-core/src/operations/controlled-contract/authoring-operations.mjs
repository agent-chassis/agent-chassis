

import {
  ControlledContractToolError,
  assertControlledContractAuthorableCarrierKind,
  assertControlledContractOperationInput,
  deriveCanonicalControlledContractAuthoringState,
  resolveControlledContractAuthoringContinuationMutation,
  writeControlledContractCarrierFile
} from "../../lib/controlled-contract-tools.mjs";
import { describeControlledContractAuthoring } from
  "../../lib/controlled-contract-authoring-projections.mjs";
import {
  loadControlledContractPackage,
  loadEvaluationInputSchemaValue,
  loadProofPlanRequestSchema
} from "./package-runtime.mjs";
import { validateAuthorableCarrier } from "./authorable-carrier-validation.mjs";
import { throwAuthoringRefusal } from "./authoring-refusals.mjs";
import { controlledContractOperation } from "./refusal.mjs";

export async function describeControlledContractAuthoringOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, ["carrierKind", "target"]);
    assertControlledContractAuthorableCarrierKind(input.carrierKind);
    const pkg = await loadControlledContractPackage();
    return describeControlledContractAuthoring({ carrierKind: input.carrierKind,
      target: input.target ?? null, schemas: { contract: pkg.NATIVE_CONTRACT_SCHEMA_V1,
        evaluation_input: await loadEvaluationInputSchemaValue(),
        proof_plan_request: await loadProofPlanRequestSchema() } });
  });
}

export async function controlledContractAuthoringStateOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "continuation"
    ]);
    return deriveCanonicalControlledContractAuthoringState({
      ...input,
      focus: input.focus ?? null,
      continuation: input.continuation ?? null,
      request: {
        wk_id: input.wkId,
        ...(input.focus === undefined || input.focus === null ? {} : { focus: input.focus }),
        ...(input.continuation === undefined ? {} : { continuation: input.continuation })
      }
    });
  });
}

export async function continueControlledContractAuthoringOperation(input) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, [
      "repoRoot", "wkId", "focus", "continuation", "expectedStage"
    ]);
    const mutation = await resolveControlledContractAuthoringContinuationMutation({
      ...input,
      focus: input.focus ?? null
    });
    if (mutation.refused) throwAuthoringRefusal(mutation.refused);

    const actualStage = mutation.carrierKind === "evaluation_input"
      ? "evaluation_input_ready"
      : mutation.carrierKind === "proof_plan_request"
        ? "proof_plan_request_ready" : null;
    const writableCarrierKind = actualStage === null
      ? null : mutation.carrierKind ?? null;
    if (input.expectedStage !== undefined && input.expectedStage !== actualStage) {
      throw new ControlledContractToolError(
        "controlled_contract_authoring_continuation_stale",
        "authoring continuation stage changed before mutation",
        { expected_stage: input.expectedStage, actual_stage: actualStage,
          replacement_call: { tool: "workspace_controlled_contract_authoring_state",
            arguments: { wk_id: input.wkId,
              ...(input.focus === undefined || input.focus === null
                ? {} : { focus: input.focus }) } } }
      );
    }
    if (writableCarrierKind !== null) {
      const carrierInput = {
        repoRoot: input.repoRoot,
        wkId: input.wkId,
        focus: input.focus ?? null,
        carrierKind: writableCarrierKind,
        content: mutation.content,
        expectedContentDigest: mutation.expectedContentDigest
      };
      if (writableCarrierKind === "evaluation_input") {
        const selectedPack = mutation.continuationRecord.skeleton.selected_pack;
        carrierInput.profileId = selectedPack.profile_id;
        carrierInput.profileVersion = selectedPack.profile_version;
      }
      carrierInput.canonicalSet = mutation.canonicalSet;
      await validateAuthorableCarrier(
        carrierInput, mutation.content, mutation.canonicalSet);
      await writeControlledContractCarrierFile(carrierInput);
    }
    return deriveCanonicalControlledContractAuthoringState({
      repoRoot: input.repoRoot,
      wkId: input.wkId,
      focus: input.focus ?? null,
      continuation: input.continuation,
      request: {
        wk_id: input.wkId,
        ...(input.focus === undefined || input.focus === null ? {} : { focus: input.focus }),
        continuation: input.continuation
      }
    });
  });
}
