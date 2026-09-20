

import { compiledValidators } from "./compiled-validator-cache.mjs";
import { ASSESSMENT_SCHEMA } from "./contract-assessment.mjs";

import intentSchema from "../schema/controlled-contract-proof-intent-catalog.v2.schema.json" with { type: "json" };

import selectionV1Schema from "../schema/controlled-contract-proof-pack-selection.v3.schema.json" with { type: "json" };

import selectionV2Schema from "../schema/controlled-contract-proof-pack-selection.v4.schema.json" with { type: "json" };

import stableAuthoringSchema from "../schema/controlled-contract-proof-pack-authoring.v2.schema.json" with { type: "json" };

import proofPlanSchema from "../schema/controlled-contract-proof-plan.v1.schema.json" with { type: "json" };

import assessmentSchema from "../schema/controlled-contract-multi-pack-assessment.v2.schema.json" with { type: "json" };

import evaluationInputSchema from "../schema/controlled-contract-verification-profile-input.v2.schema.json" with { type: "json" };

import resultSchema from "../schema/controlled-contract-proof-pack-binding-assistance.v1.schema.json" with { type: "json" };

import requestSchema from "../schema/controlled-contract-proof-plan-request.v1.schema.json" with { type: "json" };

export const {
  validateIntentArtifact,
  validateSelectionResult,
  validateSelectionResultV2,
  validateProofPackAuthoringProjection
} = await compiledValidators("controlled-contract.proof-intent-selection.v1", {
  validators: {
    validateIntentArtifact: intentSchema,
    validateSelectionResult: selectionV1Schema,
    validateSelectionResultV2: selectionV2Schema,
    validateProofPackAuthoringProjection: stableAuthoringSchema
  }
});

export const { validateProofPlan, validateMultiPackAssessment } = await compiledValidators(
  "controlled-contract.multi-pack-assessment.v1", {
    schemas: [ASSESSMENT_SCHEMA],
    validators: {
      validateProofPlan: proofPlanSchema,
      validateMultiPackAssessment: assessmentSchema
    }
  }
);

export const {
  validateEvaluationInput,
  validateProofPackBindingAssistance
} = await compiledValidators("controlled-contract.proof-pack-binding-assistance.v1", {
  validators: {
    validateEvaluationInput: evaluationInputSchema,
    validateProofPackBindingAssistance: resultSchema
  }
});

export const { validateProofPlanRequest } = await compiledValidators(
  "controlled-contract.proof-plan-request.v1",
  { validators: { validateProofPlanRequest: requestSchema } }
);
