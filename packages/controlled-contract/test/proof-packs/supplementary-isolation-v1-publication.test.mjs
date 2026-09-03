import assert from "node:assert/strict";
import test from "node:test";

import {
  describeProofPackAuthoring,
  discoverProofIntents,
  inspectProofPackBindingsPage,
  selectProofPacks
} from "../../current.mjs";
import { loadAdmittedProofPack } from "../../lib/admitted-proof-packs.mjs";
import { buildSupplementaryIsolationSources } from "./supplementary-isolation-v1-fixture.mjs";
import { buildSupplementaryIsolationEvaluationInput } from
  "./supplementary-isolation-v1-profile.mjs";

const intentId = "controlled-proof-intent.supplementary-failure-isolation";
const profileId = "proof.failure.supplementary-isolation";
const profileVersion = "2.0.0";

function fixture() {
  const source = buildSupplementaryIsolationSources({ branch: "omitted" });
  const contract = JSON.parse(source.projectionBytes);
  return { contract, evaluationInput: buildSupplementaryIsolationEvaluationInput(contract) };
}

test("supplementary-failure-isolation intent discovers and selects only the exact pack", () => {
  const discovery = discoverProofIntents({ query: "optional enrichment failure preserves core" });
  assert.deepEqual(discovery.intents.map(({ intent_id: id }) => id), [intentId]);
  const selection = selectProofPacks({ contract: fixture().contract,
    requestedIntents: [intentId] });
  assert.deepEqual(selection.selected_packs.map(({ profile_id: id, profile_version: version }) =>
    [id, version]), [[profileId, profileVersion]]);
  assert.equal(selection.selected_packs[0].selection_status, "requires_bindings");
});

test("authoring description retains exact local branch and absence/preservation roles", () => {
  const description = describeProofPackAuthoring({
    profileId, profileVersion, requestedIntents: [intentId]
  });
  assert.deepEqual(description.requested_intents, [intentId]);
  assert.equal(JSON.stringify(description.proof_obligations.satisfaction_expression)
    .includes("exactly_one"), true);
  const roles = new Set(description.evaluation_input_skeleton.reference_bindings
    .map(({ role }) => role));
  for (const role of ["core_members", "final_core_members", "supplementary_results",
    "supplementary_failure_reason", "disclosed_reasons"]) assert.equal(roles.has(role), true, role);
});

test("binding assistance validates projection-authored exact roles", async () => {
  const { contract, evaluationInput } = fixture();
  const assistance = await inspectProofPackBindingsPage({
    contract, profileId, profileVersion, requestedIntents: [intentId], evaluationInput,
    roles: ["attempt", "core_members", "supplementary_results", "disclosed_omissions"],
    maximumItems: 30
  });
  assert.equal(assistance.summary.status, "valid");
  assert.equal(assistance.summary.incompatible_binding_count, 0);
});

test("published admission binds semantic adequacy and exact certification", async () => {
  const pack = await loadAdmittedProofPack(profileId);
  assert.equal(pack.admission.certification.method, "executable_semantic_adequacy");
  assert.equal(pack.admission.certification.executable_control_count, 39);
  assert.equal(pack.admission.exact_binding.executable_control_count, 12);
  assert.equal(pack.admission.exact_binding.binding_kinds.includes("artifact_bytes"), true);
});
