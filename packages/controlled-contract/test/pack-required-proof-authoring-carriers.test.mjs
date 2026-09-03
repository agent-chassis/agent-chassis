import assert from "node:assert/strict";
import test from "node:test";

import {
  ProofAuthoringSkeletonError,
  buildProofAuthoringSkeleton
} from "../lib/proof-authoring-skeleton.mjs";

test("package API rejects symbol and non-enumerable own input keys", async () => {
  const symbolInput = {
    contract: {},
    selectedPack: { profile_id: "proof.example", profile_version: "2.0.0" },
    requestedIntents: ["example"]
  };
  symbolInput[Symbol("caller_override")] = true;
  await assert.rejects(buildProofAuthoringSkeleton(symbolInput), {
    code: "proof_authoring_input_invalid"
  });

  const hiddenInput = { ...symbolInput };
  delete hiddenInput[Object.getOwnPropertySymbols(hiddenInput)[0]];
  Object.defineProperty(hiddenInput, "caller_override", { value: true });
  await assert.rejects(buildProofAuthoringSkeleton(hiddenInput), {
    code: "proof_authoring_input_invalid"
  });
});

test("integration-prefix requests require an exact requested-intents array", async () => {
  await assert.rejects(buildProofAuthoringSkeleton({
    canonicalRecord: {}, contract: {}, mappingContract: {}, slices: [],
    proofPlanRequest: { selected_packs: [], requested_intents: "not-an-array" },
    evaluationInputs: {}
  }), { code: "integration_prefix_input_invalid" });
});

test("ordinary authoring refuses caller-supplied catalog and path overrides", async () => {
  for (const key of ["catalog", "path"]) {
    const input = {
      contract: {},
      selectedPack: { profile_id: "proof.example", profile_version: "2.0.0" },
      requestedIntents: ["example"],
      [key]: {}
    };
    await assert.rejects(buildProofAuthoringSkeleton(input),
      (error) => error instanceof ProofAuthoringSkeletonError &&
        error.code === "proof_authoring_input_invalid");
  }
});
