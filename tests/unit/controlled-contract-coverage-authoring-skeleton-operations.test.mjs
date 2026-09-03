import assert from "node:assert/strict";
import test from "node:test";

import { composeControlledContractCoverageAuthoringSkeleton } from
  "../../packages/wiki-core/src/lib/controlled-contract-coverage-authoring-skeleton.mjs";
import {
  describeControlledContractAcceptanceCoverageOperation,
  describeControlledContractObligationCoverageOperation
} from "../../packages/wiki-core/src/operations/controlled-contract.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const referenceIds = Array.from({ length: 39 }, (_, index) =>
  `ref-skeleton-entry-${String(index + 1).padStart(2, "0")}`);

function assertCompleteBoundedSkeleton(skeleton) {
  assert.deepEqual(skeleton.complete_population.map(({ reference_id: id }) => id),
    referenceIds);
  assert.equal(skeleton.inline_projection.total, 39);
  assert.equal(skeleton.inline_projection.returned +
    skeleton.inline_projection.omitted, 39);
  assert.equal(skeleton.facts.intended_entry_count, 39);
  assert.equal(skeleton.facts.returned_entry_count,
    skeleton.inline_projection.returned);
  assert.equal(skeleton.facts.omitted_entry_count,
    skeleton.inline_projection.omitted);
  assert.equal(skeleton.inline_projection.utf8_bytes,
    Buffer.byteLength(JSON.stringify(skeleton.inline_projection), "utf8"));
  assert.ok(skeleton.inline_projection.utf8_bytes <= 16_384);
  for (const field of ["cursor", "continuation", "next_calls", "recovery_state"]) {
    assert.equal(Object.hasOwn(skeleton, field), false);
  }
}

function largeContractNodes() {
  return Array.from({ length: 80 }, (_, index) => ({
    id: `contract-node-${index}-${"x".repeat(240)}`,
    mandatory: index % 2 === 0
  }));
}

function selectedPacks() {
  return [{
    pack_id: "pack-1",
    profile_id: "proof.example",
    profile_version: "1.0.0",
    requested_intents: ["intent-1"],
    selectors: [{
      kind: "claim",
      component_id: "component-1",
      evaluation_stage: "verification"
    }]
  }];
}

function obligationResolved({ current = false, stale = false } = {}) {
  const contentDigest = digest("e");
  const present = current || stale;
  return {
    wkId: "WK-2439",
    focus: null,
    selectedUnit: "SLICE-004",
    canonicalSet: {
      generation: "generation-1",
      manifest_content_digest: digest("f")
    },
    bindings: {
      workRecordDigest: digest("1"),
      selectedUnitDigest: digest("2"),
      contractNodeDigest: digest("3"),
      selectedPackDigest: digest("4")
    },
    criterionIdentities: {
      digest: digest("5"),
      identities: [{ identity: "criterion-1", position: 0 }]
    },
    contract: { content_digest: digest("6") },
    contractNodes: largeContractNodes(),
    plan: { content_digest: digest("7"), content: { packs: selectedPacks() } },
    selectedPacks: selectedPacks(),
    source: present ? {
      content_digest: contentDigest,
      content: { obligations: [] }
    } : null,
    sourceCurrent: !stale,
    staleReasons: stale ? ["contract_content_digest"] : [],
    sourceLocator: {
      kind: "canonical_obligation_coverage",
      repository_relative:
        "wiki/contracts/WK-2439--unit-slice-004.obligation-coverage.json",
      digest: digest("8")
    },
    prospectiveIdentity: {
      source_kind: "obligation-coverage",
      wk_id: "WK-2439",
      controlled_focus: null,
      selected_unit: "SLICE-004",
      locator_digest: digest("8"),
      content_digest: present ? contentDigest : null
    },
    authoringIdentity: digest("9")
  };
}

function acceptanceResolved({ current = false, stale = false } = {}) {
  const bindings = {
    workRecordLocatorDigest: digest("1"),
    contractDigest: digest("2"),
    contractNodeDigest: digest("3"),
    proofPlanDigest: digest("4"),
    selectedPackDigest: digest("5"),
    assessmentDigest: null,
    proofAssessmentDigest: null,
    profileVersionDigest: digest("6"),
    selectorArtifactDigest: digest("7"),
    ownershipDigest: digest("8"),
    verificationDigest: digest("9"),
    optionalScopeDigest: null,
    sourceDigest: digest("a"),
    sourceKind: "obligation-coverage",
    mappingDigest: digest("b")
  };
  const carrierDigest = digest("c");
  const present = current || stale;
  const carrierBindings = structuredClone(bindings);
  if (stale) carrierBindings.contractDigest = digest("0");
  return {
    wkId: "WK-2439",
    focus: null,
    selectedUnit: "SLICE-004",
    unit: { id: "SLICE-004", acceptance: { criteria: ["criterion one"] } },
    criteria: ["criterion one"],
    contractNodes: largeContractNodes(),
    selectedPackNodeIds: ["contract-node-0"],
    contract: { content_digest: digest("d") },
    plan: { content_digest: digest("e"), content: { packs: selectedPacks() } },
    selectedPacks: selectedPacks(),
    source: { source_kind: "obligation-coverage", content_digest: digest("a") },
    bindings,
    carrier: present ? {
      content_digest: carrierDigest,
      content: { source_bindings: carrierBindings, rows: [] }
    } : null,
    rows: [],
    proof_coverage: [],
    result_facts: null
  };
}

test("obligation describe exposes an exact lossless absent-carrier skeleton", async () => {
  const resolved = obligationResolved();
  const described = await describeControlledContractObligationCoverageOperation({
    repoRoot: null,
    wkId: "WK-2439",
    selectedUnit: "SLICE-004"
  }, { resolveFacts: async () => structuredClone(resolved) });

  assert.equal(described.status, "source_absent");
  assert.deepEqual(described.supported_next_calls, [
    "workspace_controlled_contract_obligation_coverage_create",
    "workspace_controlled_contract_obligation_coverage_describe"
  ]);
  assert.equal(described.next_calls[0].tool,
    "workspace_controlled_contract_obligation_coverage_create");
  assertCompleteBoundedSkeleton(described.authoring_skeleton);
  assert.ok(described.authoring_skeleton.inline_projection.omitted > 0);
  assert.equal(described.authoring_skeleton.complete_population.length, 39);
  assert.deepEqual(described.authoring_skeleton.complete_population[33]
    .allowed_alternatives, [{
    kind: "pack_mapping",
    pack_id: "pack-1",
    requested_intent: "intent-1",
    profile_id: "proof.example",
    profile_version: "1.0.0",
    selector: { kind: "claim", component_id: "component-1" },
    evaluation_stage: "verification"
  }]);
  assert.deepEqual(described.authoring_skeleton.mutation_handoff, {
    operation: "workspace_controlled_contract_obligation_coverage_create",
    stable_arguments: described.next_calls[0].fixed_arguments,
    authored_fields: ["obligation_id", "statement", "controlled_contract_node_ids",
      "mechanism", "gap", "pack_component"],
    call_shape: "complete_population",
    receipt_fed_digest_state: null
  });
  assert.deepEqual(described.authoring_skeleton.execution_handoff, {
    mode: "complete_population_create",
    receipt_source: null,
    final_verification_operations: [
      "workspace_controlled_contract_obligation_coverage_query",
      "workspace_controlled_contract_obligation_coverage_describe"
    ]
  });
});

test("obligation describe models current multi-row mutation as sequential CAS", async () => {
  const resolved = obligationResolved({ current: true });
  const input = { repoRoot: null, wkId: "WK-2439", selectedUnit: "SLICE-004" };
  const options = { resolveFacts: async () => structuredClone(resolved) };
  const first = await describeControlledContractObligationCoverageOperation(input, options);
  const second = await describeControlledContractObligationCoverageOperation(input, options);

  assert.deepEqual(first, second);
  assert.equal(first.status, "source_present_current");
  assertCompleteBoundedSkeleton(first.authoring_skeleton);
  assert.equal(first.authoring_skeleton.mutation_handoff.operation,
    "workspace_controlled_contract_obligation_coverage_upsert");
  assert.deepEqual(first.authoring_skeleton.mutation_handoff.stable_arguments, {
    unit: "WK-2439#SLICE-004"
  });
  assert.deepEqual(first.authoring_skeleton.mutation_handoff.receipt_fed_digest_state, {
    source: "immediately_prior_mutation_receipt",
    fields: ["expected_content_digest"]
  });
  assert.equal(first.authoring_skeleton.execution_handoff.mode,
    "sequential_single_row");
});

test("stale obligation describe preserves recovery without mutation handoff", async () => {
  const resolved = obligationResolved({ stale: true });
  const described = await describeControlledContractObligationCoverageOperation({
    repoRoot: null,
    wkId: "WK-2439",
    selectedUnit: "SLICE-004"
  }, { resolveFacts: async () => structuredClone(resolved) });

  assert.equal(described.status, "source_present_stale");
  assert.deepEqual(described.supported_next_calls, [
    "workspace_controlled_contract_obligation_coverage_query",
    "workspace_controlled_contract_obligation_coverage_rebase",
    "workspace_controlled_contract_obligation_coverage_describe"
  ]);
  assert.deepEqual(described.next_calls.map(({ tool }) => tool), [
    "workspace_controlled_contract_obligation_coverage_rebase",
    "workspace_controlled_contract_obligation_coverage_describe"
  ]);
  assertCompleteBoundedSkeleton(described.authoring_skeleton);
  assert.equal(Object.hasOwn(described.authoring_skeleton, "mutation_handoff"), false);
  assert.equal(Object.hasOwn(described.authoring_skeleton, "execution_handoff"), false);
});

test("acceptance describe preserves stable identity and receipt-fed digest slots", async () => {
  const absentResolved = acceptanceResolved();
  const input = { repoRoot: null, wkId: "WK-2439", selectedUnit: "SLICE-004" };
  const absent = await describeControlledContractAcceptanceCoverageOperation(input, {
    resolveFacts: async () => structuredClone(absentResolved)
  });
  assert.equal(absent.status, "carrier_absent");
  assertCompleteBoundedSkeleton(absent.authoring_skeleton);
  assert.equal(absent.authoring_skeleton.mutation_handoff.operation,
    "workspace_controlled_contract_acceptance_coverage_create");
  assert.deepEqual(absent.authoring_skeleton.mutation_handoff.stable_arguments,
    absent.next_calls[0].fixed_arguments);

  const currentResolved = acceptanceResolved({ current: true });
  const options = { resolveFacts: async () => structuredClone(currentResolved) };
  const current = await describeControlledContractAcceptanceCoverageOperation(input, options);
  const replay = await describeControlledContractAcceptanceCoverageOperation(input, options);
  assert.deepEqual(current, replay);
  assert.equal(current.status, "carrier_present_current");
  assertCompleteBoundedSkeleton(current.authoring_skeleton);
  assert.equal(current.authoring_skeleton.mutation_handoff.operation,
    "workspace_controlled_contract_acceptance_coverage_upsert");
  assert.deepEqual(current.authoring_skeleton.mutation_handoff.stable_arguments, {
    unit: "WK-2439#SLICE-004",
    carrier_identity: {
      carrier_kind: "controlled-acceptance",
      wk_id: "WK-2439",
      focus: null,
      selected_unit: "SLICE-004"
    },
    source_identity: { source_kind: "obligation-coverage" }
  });
  assert.deepEqual(current.authoring_skeleton.mutation_handoff
    .receipt_fed_digest_state, {
    source: "immediately_prior_mutation_receipt",
    fields: ["expected_content_digest", "carrier_identity.content_digest",
      "source_identity.content_digest"]
  });
  assert.deepEqual(current.authoring_skeleton.execution_handoff, {
    mode: "sequential_single_row",
    receipt_source: "immediately_prior_mutation_receipt",
    final_verification_operations: [
      "workspace_controlled_contract_acceptance_coverage_query",
      "workspace_controlled_contract_acceptance_coverage_describe"
    ]
  });
});

test("stale acceptance describe preserves recovery without mutation handoff", async () => {
  const resolved = acceptanceResolved({ stale: true });
  const described = await describeControlledContractAcceptanceCoverageOperation({
    repoRoot: null,
    wkId: "WK-2439",
    selectedUnit: "SLICE-004"
  }, { resolveFacts: async () => structuredClone(resolved) });

  assert.equal(described.status, "carrier_present_stale");
  assert.deepEqual(described.supported_next_calls, [
    "workspace_controlled_contract_acceptance_coverage_query",
    "workspace_controlled_contract_acceptance_coverage_rebase",
    "workspace_controlled_contract_acceptance_coverage_describe"
  ]);
  assert.deepEqual(described.next_calls.map(({ tool }) => tool), [
    "workspace_controlled_contract_acceptance_coverage_rebase",
    "workspace_controlled_contract_acceptance_coverage_describe"
  ]);
  assertCompleteBoundedSkeleton(described.authoring_skeleton);
  assert.equal(Object.hasOwn(described.authoring_skeleton, "mutation_handoff"), false);
  assert.equal(Object.hasOwn(described.authoring_skeleton, "execution_handoff"), false);
});

test("the adapter accepts only resolved facts and exports raw local facts", () => {
  const result = composeControlledContractCoverageAuthoringSkeleton({
    surface: "acceptance",
    unit: {
      address: "WK-2439#SLICE-004",
      selectedUnit: "SLICE-004",
      focus: null,
      digest: digest("1")
    },
    criterionIdentities: [{ identity: "criterion-1", position: 0 }],
    contract: { contentDigest: digest("2"), nodes: [{ id: "node-1" }] },
    proofPlan: { contentDigest: null, selectedPacks: [] },
    carrier: { status: "carrier_absent", changedBindings: [] },
    mutation: {
      operation: "workspace_controlled_contract_acceptance_coverage_create",
      fixedArguments: { unit: "WK-2439#SLICE-004", expected_content_digest: null },
      receiptFedDigestFields: []
    }
  });
  assertCompleteBoundedSkeleton(result);
  assert.equal(result.facts.request_utf8_bytes > 0, true);
  assert.equal(result.facts.result_utf8_bytes > 0, true);
  assert.equal(Object.hasOwn(result.facts, "workflow_conclusion"), false);
});
