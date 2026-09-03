

import {
  ControlledContractToolError,
  controlledContractCarrierFilename,
  readCanonicalProofPlanInputs,
  readControlledContractCarrierFile
} from "../../lib/controlled-contract-tools.mjs";
import { deriveControlledContractCarrierValidationRemediation } from
  "../../lib/controlled-contract-authoring-state.mjs";
import {
  addressedEvaluationInputPack,
  assertPackageValidContract,
  loadControlledContractPackage,
  loadEvaluationInputSchema
} from "./package-runtime.mjs";

async function validateAuthorableCarrier(input, content, canonicalSet = null) {
  const pkg = await loadControlledContractPackage();
  if (input.carrierKind === "contract") {
    const validation = pkg.validateStableTestProofContract(content);
    try {
      assertPackageValidContract(validation);
    } catch (error) {
      const replacementCall = deriveControlledContractCarrierValidationRemediation({
        wkId: input.wkId,
        focus: input.focus ?? null,
        expectedContentDigest: input.expectedContentDigest,
        candidate: content,
        diagnostics: validation.diagnostics
      });
      if (replacementCall !== null) error.details.replacement_call = replacementCall;
      throw error;
    }
    return;
  }
  if (input.carrierKind === "evaluation_input") {
    const pack = addressedEvaluationInputPack(input);
    if (pack !== null) {
      const contract = await readControlledContractCarrierFile({
        ...input,
        carrierKind: "contract",
        pack: null,
        canonicalSet
      });
      const contractValidation = assertPackageValidContract(
        pkg.validateStableTestProofContract(contract.content)
      );
      void contractValidation;
      const inspection = await pkg.inspectProofPackBindingsPage({
        contract: contract.content,
        profileId: pack.profileId,
        profileVersion: pack.profileVersion,
        evaluationInput: content,
        maximumItems: 0
      });
      if (inspection.summary.status !== "valid") throw new ControlledContractToolError(
        "proof_plan_request_evaluation_input_invalid",
        "evaluation input is invalid for the addressed exact proof pack",
        {
          profile_id: pack.profileId,
          profile_version: pack.profileVersion,
          counts: inspection.counts,
          diagnostics: inspection.evaluation_input_diagnostics,
          invalid_roles: inspection.role_index.filter(({ status }) =>
            status !== "validly_bound").map(({ role, status }) => ({ role, status }))
        }
      );
      return;
    }
    const validate = await loadEvaluationInputSchema();
    const stableInputValid = validate(content);
    let request;
    try {
      request = await readControlledContractCarrierFile({
        ...input, carrierKind: "proof_plan_request", canonicalSet
      });
    } catch (error) {
      if (error?.code === "controlled_contract_carrier_not_found") {
        if (!stableInputValid) throw new ControlledContractToolError(
          "controlled_contract_carrier_validation_failed",
          "evaluation input failed package-schema validation",
          { diagnostics: structuredClone(validate.errors) }
        );
        return;
      }
      throw error;
    }
    const filename = controlledContractCarrierFilename(input);
    if (!request.content.selected_packs?.some(({ evaluation_input_path: value }) => value === filename)) {
      if (!stableInputValid) throw new ControlledContractToolError(
        "controlled_contract_carrier_validation_failed",
        "evaluation input failed package-schema validation",
        { diagnostics: structuredClone(validate.errors) }
      );
      return;
    }
    const loaded = await readCanonicalProofPlanInputs({
      ...input, requestContent: request.content, evaluationOverrides: { [filename]: content },
      canonicalSet
    });
    const contractValidation = assertPackageValidContract(
      pkg.validateStableTestProofContract(loaded.contract.content)
    );
    if (contractValidation.family !== "stable_v1" || !stableInputValid) {
      throw new ControlledContractToolError(
        "controlled_contract_carrier_validation_failed",
        "evaluation input failed package-schema validation",
        { diagnostics: structuredClone(validate.errors) }
      );
    }
    await pkg.buildProofPlan({ contract: loaded.contract.content, request: request.content,
      evaluationInputs: loaded.evaluationInputs });
    return;
  }
  const loaded = await readCanonicalProofPlanInputs({
    ...input, requestContent: content, canonicalSet
  });
  await pkg.buildProofPlan({ contract: loaded.contract.content, request: content,
    evaluationInputs: loaded.evaluationInputs });
}

export { validateAuthorableCarrier };
