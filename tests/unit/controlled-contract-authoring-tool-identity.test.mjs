import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROLLED_CONTRACT_AUTHORING_STAGES,
  CONTROLLED_CONTRACT_AUTHORING_TOOLS,
  deriveControlledContractAuthoringState
} from "../../packages/wiki-core/src/lib/controlled-contract-authoring-state.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const carrier = (kind, contentDigest, content = {}) => ({
  carrier_kind: kind, content_digest: contentDigest, content
});

test("the central authoring vocabulary points state recovery at ordinary query", () => {
  assert.equal(CONTROLLED_CONTRACT_AUTHORING_TOOLS.state,
    "workspace_controlled_contract_obligation_coverage_query");
  assert.equal(new Set(Object.values(CONTROLLED_CONTRACT_AUTHORING_TOOLS)).size,
    Object.keys(CONTROLLED_CONTRACT_AUTHORING_TOOLS).length);
  assert.equal(Object.values(CONTROLLED_CONTRACT_AUTHORING_TOOLS)
    .includes("workspace_controlled_contract_authoring_state"), false);
});

test("the identity cutover leaves incumbent stage and readiness derivation unchanged", () => {
  assert.deepEqual(CONTROLLED_CONTRACT_AUTHORING_STAGES, [
    "contract_required", "verification_graph_required", "stable_test_proof_required",
    "proof_graph_required", "proof_authoring_required", "evaluation_input_ready",
    "proof_plan_request_ready", "evaluation_input_population_incomplete",
    "proof_plan_ready", "proof_plan_rebuild_required", "complete"
  ]);
  const empty = deriveControlledContractAuthoringState({ wkId: "WK-2504" });
  assert.equal(empty.stage, "contract_required");

  const proofPlanDigest = digest("b");
  const complete = deriveControlledContractAuthoringState({
    wkId: "WK-2504",
    carriers: {
      contract: carrier("contract", digest("a"), { residue: [] }),
      evaluation_input: carrier("evaluation_input", digest("c")),
      proof_plan_request: carrier("proof_plan_request", digest("d"), {
        requested_intents: ["intent"], selected_packs: []
      }),
      proof_plan: carrier("proof_plan", proofPlanDigest)
    },
    proofPlanBinding: { status: "current", content_digest: proofPlanDigest }
  });
  assert.equal(complete.stage, "complete");
  assert.equal(complete.stop_condition, "controlled_contract_authoring_complete");
});
