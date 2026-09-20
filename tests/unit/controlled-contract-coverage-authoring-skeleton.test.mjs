import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  composeCoverageAuthoringSkeleton
} from "../../packages/controlled-contract/current.mjs";

const sha = (character) => `sha256:${character.repeat(64)}`;
const baseServer = () => ({
  unitAddress: "WK-2439#SLICE-003",
  selectedUnit: "SLICE-003",
  focus: null,
  selectedUnitDigest: sha("a"),
  criterionIdentities: [{ identity: "criterion-1", position: 0 }],
  contractContentDigest: sha("b"),
  contractNodes: [{ id: "node-1" }, { id: "node-2" }],
  proofPlanContentDigest: sha("c"),
  selectedPacks: [{ profile_id: "proof.example", profile_version: "1.0.0" }],
  carrierStatus: "carrier_present_current",
  changedBindings: [],
  mutation: {
    operation: "workspace_controlled_contract_acceptance_coverage_upsert",
    stableArguments: { unit: "WK-2439#SLICE-003", focus: null },
    receiptFedDigestFields: [
      "expected_content_digest", "carrier_identity.content_digest"
    ]
  },
  obligation: {
    mechanisms: ["test", "inspection"],
    gapAlternatives: [{ kind: "explicit_gap", gap_kind: "infeasible" }],
    packComponents: [{ component_id: "component-1" }],
    expectedAuthoringIdentity: "authoring-identity",
    sourceIdentity: { source_locator_digest: sha("d") }
  }
});

test("composes the exact closed 39-entry vocabulary in controlled order", () => {
  const input = { surface: "acceptance", server: baseServer() };
  const first = composeCoverageAuthoringSkeleton(input);
  const second = composeCoverageAuthoringSkeleton(structuredClone(input));
  assert.equal(first.projection_visibility, "internal_only");
  assert.equal(first.complete_population.length, 39);
  assert.deepEqual(first.complete_population.map((entry) => entry.reference_id),
    Array.from({ length: 39 }, (_, index) =>
      `ref-skeleton-entry-${String(index + 1).padStart(2, "0")}`));
  assert.equal(createHash("sha256").update(first.complete_population
    .map((entry) => entry.term).join("\n")).digest("hex"),
  "052111bc88d83e0e9774ca108422a71c9bb80760e8369f5e8ac71a3bdebdd921");
  assert.deepEqual(first, second);
});

test("leaves semantic choices unresolved and never invents authored values", () => {
  const result = composeCoverageAuthoringSkeleton({
    surface: "acceptance", server: baseServer()
  });
  assert.deepEqual(result.complete_population[14].value.map(({ field }) => field), ['node_ids', 'axes']);
  assert.equal(result.facts.unresolved_slot_count, 2);
  for (const entry of result.complete_population.filter(entry => entry.status === 'unresolved')) {
    assert.equal(Object.hasOwn(entry, 'value'), false);
  }
});

test("preserves normalized node meaning and declared verification facts", () => {
  const server = baseServer();
  server.contractNodes = [{
    id: "opaque-claim-a",
    mandatory: true,
    semantic: {
      node_kind: "claim",
      claim_kind: "behavior",
      modality: "MUST",
      proposition: {
        proposition_id: "opaque-proposition-a",
        operator: "boolean:exists",
        subject_reference_id: "opaque-reference-a",
        subject: {
          reference_id: "opaque-reference-a",
          type_term: "cc:runtime_component",
          identity: { kind: "profile_term", term: "semantic-owner" }
        },
        operands: [{ kind: "boolean", value: true }],
        applicability_context: {
          mode: "unconditional", operand_reference_ids: [], operand_references: []
        }
      }
    },
    declared_verification: {
      relationships: [{
        edge_kind: "claim_verifies_claim",
        relation_id: "opaque-relation-a",
        role: "verifies",
        source_claim_id: "opaque-verification-a",
        target_claim_id: "opaque-claim-a",
        evidence_status: "declared_not_executed"
      }],
      test_definitions: [],
      executed_outcomes_included: false
    }
  }];
  const result = composeCoverageAuthoringSkeleton({ surface: "acceptance", server });
  assert.deepEqual(result.complete_population[6].value, server.contractNodes);
  assert.equal(result.complete_population[6].value[0]
    .declared_verification.executed_outcomes_included, false);
});

test("validates server-resolved authored decisions without echoing them", () => {
  const server = baseServer();
  server.authoredDecisions = { node_ids: ['node-1'] };
  const result = composeCoverageAuthoringSkeleton({ surface: "acceptance", server });
  assert.equal(result.complete_population[37].status, "authored");
  assert.equal(Object.hasOwn(result.complete_population[37], "value"), false);
  assert.equal(result.diagnostics.some(({ code }) => code === "invalid_authored_decision"), false);
  server.authoredDecisions.node_ids = ['absent-node'];
  const invalid = composeCoverageAuthoringSkeleton({ surface: "acceptance", server });
  assert.ok(invalid.diagnostics.some(({ code, field }) => code === "invalid_authored_decision" && field === "node_ids"));
});

test("separates stable arguments from receipt-fed digest CAS state", () => {
  const result = composeCoverageAuthoringSkeleton({
    surface: "acceptance", server: baseServer()
  });
  assert.deepEqual(result.mutation_handoff, {
    operation: "workspace_controlled_contract_acceptance_coverage_upsert",
    stable_arguments: { unit: "WK-2439#SLICE-003", focus: null },
    authored_fields: ["node_ids", "axes"],
    call_shape: "single_row",
    receipt_fed_digest_state: {
      source: "immediately_prior_mutation_receipt",
      fields: ["expected_content_digest", "carrier_identity.content_digest"]
    }
  });
  const server = baseServer();
  server.mutation.stableArguments.expected_content_digest = sha("e");
  assert.throws(() => composeCoverageAuthoringSkeleton({
    surface: "acceptance", server
  }), (error) => error.name === "CoverageAuthoringSkeletonError" &&
    /receipt-fed digest state/.test(error.message));
});

test("bounds the gap-first inline projection without discarding the population", () => {
  const server = baseServer();
  server.contractNodes = Array.from({ length: 60 }, (_, index) => ({
    id: `node-${index}-${"x".repeat(300)}`
  }));
  const result = composeCoverageAuthoringSkeleton({
    surface: "acceptance", server
  });
  assert.ok(result.inline_projection.utf8_bytes <= 16_384);
  assert.equal(Buffer.byteLength(JSON.stringify(result.inline_projection)),
    result.inline_projection.utf8_bytes);
  assert.equal(result.inline_projection.total, 39);
  assert.equal(result.inline_projection.returned + result.inline_projection.omitted, 39);
  assert.equal(result.complete_population.length, 39);
  assert.ok(result.inline_projection.omitted > 0);
  assert.equal(result.inline_projection.entries[0].status, "unresolved");
});

test("exposes only package-local byte and population facts", () => {
  const server = baseServer();
  delete server.obligation;
  server.mutation = {
    operation: "workspace_controlled_contract_acceptance_coverage_create",
    stableArguments: { expected_content_digest: null },
    receiptFedDigestFields: []
  };
  const result = composeCoverageAuthoringSkeleton({
    surface: "acceptance", server
  });
  assert.equal(result.facts.intended_entry_count, 39);
  assert.equal(result.facts.result_utf8_bytes,
    Buffer.byteLength(JSON.stringify(result)));
  assert.deepEqual(result.complete_population[38].allowed_alternatives &&
    Object.keys(result.complete_population[38].allowed_alternatives), [
    "authored_contract_coverage", "structural_verification",
    "selected_pack_guarantee_coverage", "implementation_ownership",
    "verification_ownership", "scope_feasibility"
  ]);
  for (const forbidden of ["cursor", "continuation", "next_calls", "recovery_state"])
    assert.equal(Object.hasOwn(result, forbidden), false);
});

test("rejects non-plain or unsupported inputs locally", () => {
  const server = baseServer();
  server.selectedPacks = [new Map()];
  assert.throws(() => composeCoverageAuthoringSkeleton({
    surface: "acceptance", server
  }), (error) => error.name === "CoverageAuthoringSkeletonError");
  assert.throws(() => composeCoverageAuthoringSkeleton({
    surface: "acceptance", server: baseServer(), path: "/tmp/carrier"
  }), (error) => error.name === "CoverageAuthoringSkeletonError");
});

test("rejects sparse arrays before canonical byte accounting", () => {
  const sparseServer = baseServer();
  sparseServer.selectedPacks = Array(2_000);
  assert.throws(() => composeCoverageAuthoringSkeleton({
    surface: "acceptance", server: sparseServer
  }), (error) => error.name === "CoverageAuthoringSkeletonError" &&
    error.code === "coverage_authoring_skeleton_input_invalid" &&
    error.message ===
      "input.server.selectedPacks[0] must not be a sparse array hole" &&
    error.details.name === "input.server.selectedPacks" &&
    error.details.index === 0);

  const accepted = { surface: "acceptance", server: baseServer() };
  const result = composeCoverageAuthoringSkeleton(accepted);
  assert.equal(result.facts.request_utf8_bytes,
    Buffer.byteLength(JSON.stringify(accepted), "utf8"));
  assert.equal(result.inline_projection.utf8_bytes,
    Buffer.byteLength(JSON.stringify(result.inline_projection), "utf8"));
  assert.ok(result.inline_projection.utf8_bytes <= 16_384);
  assert.equal(result.facts.result_utf8_bytes,
    Buffer.byteLength(JSON.stringify(result), "utf8"));
});

test('the package retires the complete-row obligation authoring skeleton', () => {
  assert.throws(() => composeCoverageAuthoringSkeleton({ surface: 'obligation', server: baseServer() }), error => {
    assert.equal(error.code, 'obligation_coverage_authoring_route_retired');
    assert.ok(error.details.operations.includes('workspace_controlled_contract_obligation_coverage_upsert'));
    return true;
  });
});
