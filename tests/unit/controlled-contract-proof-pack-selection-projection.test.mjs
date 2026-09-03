import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROLLED_CONTRACT_PROOF_PACK_SELECTION_PROJECTION_VERSION,
  projectProofPackSelectionTaskContext
} from "../../packages/wiki-core/src/operations/controlled-contract/proof-pack-operations.mjs";
import { projectProofPackSelectionRepository } from
  "../../packages/wiki-mcp/src/lib/controlled-contract-tools.mjs";

const CONTRACT_DIGEST = `sha256:${"a".repeat(64)}`;
const INTENT = "controlled-proof-intent.synthetic-task-context";

function authoring(index) {
  return {
    profile_id: `proof.synthetic.${index}`,
    profile_version: "2.0.0",
    intent_distinctions: [{ intent_id: INTENT, distinction: `candidate-${index}` }],
    explicit_exclusions: [`unsupported-${index}`],
    compatibility: { contract_schema_version: "controlled-acceptance-contract.v1" },
    evaluation_input_skeleton: {
      input_version: "controlled-contract-verification-profile-input.v1",
      reference_bindings: [{ role: "operation", cardinality: "one" }]
    },
    role_constraints: { binding_constraint_patterns: [{ pattern_id: `b-${index}` }] },
    proof_obligations: {
      claim_patterns: [{ pattern_id: `claim-${index}` }],
      satisfaction_expression: { claim: `claim-${index}` }
    },
    source_digests: { profile: `sha256:${String(index + 1).repeat(64).slice(0, 64)}` }
  };
}

function selection(count = 2) {
  const candidates = Array.from({ length: count }, (_, index) => ({
    profile_id: `proof.synthetic.${index}`,
    profile_version: "2.0.0",
    requested_intents: [INTENT],
    guarantee: `guarantee-${index}`,
    exact_binding_required: true,
    required_inputs: [{ input_id: "controlled_contract" }],
    missing_compatible_reference_types: [],
    source_digests: { profile: `sha256:${"c".repeat(64)}` }
  }));
  return {
    schema_version: "controlled-contract-proof-pack-selection.v2",
    decision: {
      selection_scope: "requested_intents_only",
      selection_status: "compatible_candidates_ready_for_authoring",
      requested_intent_count: 1,
      compatible_candidate_count: count,
      uncovered_requested_intent_count: 0,
      hard_incompatibility_count: 0,
      missing_authoring_binding_count: 0,
      unrequested_intent_applicability: "not_evaluated",
      runtime_evidence_applicability: "not_evaluated"
    },
    requested_intents: [INTENT], candidates,
    per_intent_outcomes: [{
      intent_id: INTENT,
      selection_status: "compatible_candidates_ready_for_authoring",
      candidate_outcomes: candidates.map(({ profile_id, profile_version }) => ({
        profile_id, profile_version,
        compatibility_state: "compatible",
        authoring_state: "ready_for_authoring",
        missing_authoring_binding_count: 0
      }))
    }],
    compatible_candidates: candidates.map(
      ({ profile_id, profile_version, requested_intents }) => ({
        profile_id, profile_version, requested_intents,
        authoring_state: "ready_for_authoring",
        missing_authoring_binding_count: 0
      })
    ),
    hard_incompatibilities: [],
    digests: {
      catalog: `${"d".repeat(64)}`,
      vocabulary: `${"e".repeat(64)}`,
      profiles: `${"f".repeat(64)}`,
      intent_artifact: `${"1".repeat(64)}`
    },
    authority: "non_authoritative"
  };
}

function project(count = 2) {
  return projectProofPackSelectionTaskContext({
    selection: selection(count),
    contractContentDigest: CONTRACT_DIGEST,
    authoringProjections: Array.from({ length: count }, (_, index) => authoring(index)),
    intentArtifact: { intents: [{ intent_id: INTENT, definition: "Choose a task pack." }] },
    wkId: "WK-9999",
    focus: null
  });
}

test("proof-pack task context includes every candidate authoring fact", () => {
  const result = project();
  assert.equal(result.schema_version,
    CONTROLLED_CONTRACT_PROOF_PACK_SELECTION_PROJECTION_VERSION);
  assert.deepEqual(result.task.requested_intent_ids, [INTENT]);
  assert.equal(result.task.requested_intent_definitions[0].definition,
    "Choose a task pack.");
  assert.equal(result.candidates.length, 2);
  for (const candidate of result.candidates) {
    assert.deepEqual(Object.keys(candidate).sort(), [
      "bindings", "compatibility", "exact_binding_required",
      "explicit_exclusions", "guarantee", "intent_distinctions",
      "missing_compatible_reference_types", "profile_id", "profile_version",
      "proof_obligations", "requested_intents", "source_digests"
    ].sort());
    assert.ok(candidate.guarantee);
    assert.ok(candidate.bindings.required_inputs.length > 0);
    assert.ok(candidate.bindings.evaluation_input_skeleton.reference_bindings.length > 0);
    assert.ok(candidate.proof_obligations.claim_patterns.length > 0);
  }
  assert.equal(result.selection.compatible_candidates.length, 2);
  for (const candidate of result.selection.compatible_candidates) {
    assert.equal(candidate.inspection_calls.length, 2);
    assert.deepEqual(candidate.inspection_calls[0], {
      tool: "workspace_controlled_proof_pack_describe",
      arguments: {
        wk_id: "WK-9999",
        profile_id: candidate.profile_id,
        profile_version: candidate.profile_version,
        requested_intents: [INTENT]
      }
    });
    assert.deepEqual(candidate.inspection_calls[1], {
      tool: "workspace_controlled_proof_pack_bindings_inspect",
      arguments: {
        wk_id: "WK-9999",
        profile_id: candidate.profile_id,
        profile_version: candidate.profile_version,
        requested_intents: [INTENT]
      }
    });
  }
  assert.ok(Object.isFrozen(result));
});

test("package-owned v2 decision and outcomes are projected unchanged once", () => {
  const result = project(8);
  const packageSelection = selection(8);
  assert.equal(result.task.requested_intent_definitions.length, 1);
  assert.equal(JSON.stringify(result.candidates).includes("Choose a task pack."), false);
  assert.deepEqual(result.selection.decision, packageSelection.decision);
  assert.deepEqual(result.selection.per_intent_outcomes,
    packageSelection.per_intent_outcomes);
  assert.equal(result.selection.compatible_candidates.length, 8);
  assert.equal(JSON.stringify(result).includes("packs_requiring_bindings"), false);
  assert.equal(result.source_digests.contract, CONTRACT_DIGEST);
});

test("MCP adds an explicit repository only to bindings inspections", () => {
  const withoutRepo = projectProofPackSelectionRepository(project(), undefined);
  for (const candidate of withoutRepo.selection.compatible_candidates) {
    assert.equal("repo" in candidate.inspection_calls[0].arguments, false);
    assert.equal("repo" in candidate.inspection_calls[1].arguments, false);
  }

  const explicitRepo = "agent-chassis/alternate-contracts";
  const withRepo = projectProofPackSelectionRepository(project(), explicitRepo);
  for (const candidate of withRepo.selection.compatible_candidates) {
    assert.equal("repo" in candidate.inspection_calls[0].arguments, false);
    assert.equal(candidate.inspection_calls[1].arguments.repo, explicitRepo);
  }
});

test("malformed candidate and authoring populations fail before projection", () => {
  const selected = selection(1);
  assert.throws(() => projectProofPackSelectionTaskContext({
    selection: selected,
    contractContentDigest: "not-a-digest",
    authoringProjections: [authoring(0)],
    intentArtifact: { intents: [{ intent_id: INTENT }] },
    wkId: "WK-9999"
  }), ({ code }) => code ===
    "controlled_contract_proof_pack_selection_projection_invalid");
  assert.throws(() => projectProofPackSelectionTaskContext({
    selection: selected,
    contractContentDigest: CONTRACT_DIGEST,
    authoringProjections: [],
    intentArtifact: { intents: [{ intent_id: INTENT }] },
    wkId: "WK-9999"
  }), ({ code }) => code ===
    "controlled_contract_proof_pack_selection_projection_invalid");
});
