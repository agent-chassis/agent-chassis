import assert from "node:assert/strict";
import test from "node:test";

import { composeControlledContractCoverageAuthoringSkeleton } from
  "../../packages/wiki-core/src/lib/controlled-contract-coverage-authoring-skeleton.mjs";
import {
  describeControlledContractAcceptanceCoverageOperation
} from "../../packages/wiki-core/src/operations/controlled-contract.mjs";
import { CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA } from
  "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";

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
    }]
  }];
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
    contractNodeSemantics: largeContractNodes(),
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

test('obligation guidance exposes the current upsert without contract or plan prerequisites', () => {
  const result = composeControlledContractCoverageAuthoringSkeleton({ surface: 'obligation', unit: { address: 'WK-2439' } });
  assert.equal(result.mutation.operation, 'workspace_controlled_contract_obligation_coverage_upsert');
  assert.deepEqual(result.mutation.fixed_arguments, { unit: 'WK-2439' });
  assert.ok(result.mutation.request_schema.required.includes('expected_content_digest'));

  assert.deepEqual(Object.keys(result.field_contracts),
    ['expected_content_digest', 'obligations']);
  assert.equal(Object.hasOwn(result.field_contracts, 'clear_parameters'), false);
  const clearParameters =
    result.field_contracts.obligations.items.properties.clear_parameters;
  assert.deepEqual(clearParameters,
    CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA
      .properties.obligations.items.properties.clear_parameters);

  assert.deepEqual(
    { type: clearParameters.type, uniqueItems: clearParameters.uniqueItems,
      items: clearParameters.items },
    { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } });
  assert.deepEqual(result.next_calls, [{ tool: 'workspace_controlled_contract_obligation_coverage_query', arguments: { unit: 'WK-2439' } }]);
});

test("retired acceptance describe preserves internal facts without public calls", async () => {
  const absentResolved = acceptanceResolved();
  const input = { repoRoot: null, wkId: "WK-2439", selectedUnit: "SLICE-004" };
  const absent = await describeControlledContractAcceptanceCoverageOperation(input, {
    resolveFacts: async () => structuredClone(absentResolved)
  });
  assert.equal(absent.status, "carrier_absent");
  assertCompleteBoundedSkeleton(absent.authoring_skeleton);
  assert.equal(absent.authoring_skeleton.mutation_handoff.operation,
    "acceptance_coverage_authoring");
  assert.deepEqual(absent.authoring_skeleton.mutation_handoff.stable_arguments,
    { unit: "WK-2439#SLICE-004" });
  assert.deepEqual(absent.supported_next_calls, []);
  assert.deepEqual(absent.next_calls, []);

  const currentResolved = acceptanceResolved({ current: true });
  const options = { resolveFacts: async () => structuredClone(currentResolved) };
  const current = await describeControlledContractAcceptanceCoverageOperation(input, options);
  const replay = await describeControlledContractAcceptanceCoverageOperation(input, options);
  assert.deepEqual(current, replay);
  assert.equal(current.status, "carrier_present_current");
  assertCompleteBoundedSkeleton(current.authoring_skeleton);
  assert.equal(current.authoring_skeleton.mutation_handoff.operation,
    "acceptance_coverage_authoring");
  assert.deepEqual(current.authoring_skeleton.mutation_handoff.stable_arguments, {
    unit: "WK-2439#SLICE-004"
  });
  assert.deepEqual(current.authoring_skeleton.mutation_handoff
    .receipt_fed_digest_state, {
    source: "immediately_prior_mutation_receipt",
    fields: ["expected_content_digest", "carrier_identity.content_digest",
      "source_identity.content_digest"]
  });
  assert.equal(Object.hasOwn(current.authoring_skeleton, "execution_handoff"), false);
  assert.deepEqual(current.supported_next_calls, []);
  assert.deepEqual(current.next_calls, []);
});

test("stale acceptance describe preserves recovery without mutation handoff", async () => {
  const resolved = acceptanceResolved({ stale: true });
  const described = await describeControlledContractAcceptanceCoverageOperation({
    repoRoot: null,
    wkId: "WK-2439",
    selectedUnit: "SLICE-004"
  }, { resolveFacts: async () => structuredClone(resolved) });

  assert.equal(described.status, "carrier_present_stale");
  assert.deepEqual(described.supported_next_calls, []);
  assert.deepEqual(described.next_calls, []);
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
