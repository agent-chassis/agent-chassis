import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  composeCoverageAuthoringSkeleton
} from "../../packages/controlled-contract/current.mjs";
import { coverageAuthoringActionProjection } from
  "../../packages/wiki-core/src/operations/controlled-contract/coverage-recovery-guidance.mjs";

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
    operation: "workspace_controlled_contract_obligation_coverage_upsert",
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
  const input = { surface: "obligation", server: baseServer() };
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
    surface: "obligation", server: baseServer()
  });
  assert.deepEqual(result.complete_population[14].value.map(({ field }) => field), [
    "obligation_id", "statement", "controlled_contract_node_ids", "mechanism",
    "proof"
  ]);
  assert.equal(result.facts.unresolved_slot_count, 5);
  for (const entry of result.complete_population.filter(({ authority }) =>
    authority === "caller_authored")) assert.equal(Object.hasOwn(entry, "value"), false);
  assert.deepEqual(result.complete_population[31].allowed_alternatives,
    ["test", "inspection"]);
});

test("validates server-resolved authored decisions without echoing them", () => {
  const server = baseServer();
  server.authoredDecisions = {
    obligation_id: "O-1", statement: "Caller authored",
    controlled_contract_node_ids: ["node-1"], mechanism: "test",
    gap: { kind: "explicit_gap", gap_kind: "infeasible" }
  };
  const result = composeCoverageAuthoringSkeleton({ surface: "obligation", server });
  assert.equal(result.complete_population[27].status, "authored");
  assert.equal(Object.hasOwn(result.complete_population[27], "value"), false);
  assert.equal(result.diagnostics.some(({ code }) =>
    code === "invalid_authored_decision"), false);

  server.authoredDecisions.mechanism = "invented";
  const invalid = composeCoverageAuthoringSkeleton({ surface: "obligation", server });
  assert.ok(invalid.diagnostics.some(({ code, field }) =>
    code === "invalid_authored_decision" && field === "mechanism"));
});

test("separates stable arguments from receipt-fed digest CAS state", () => {
  const result = composeCoverageAuthoringSkeleton({
    surface: "obligation", server: baseServer()
  });
  assert.deepEqual(result.mutation_handoff, {
    operation: "workspace_controlled_contract_obligation_coverage_upsert",
    stable_arguments: { unit: "WK-2439#SLICE-003", focus: null },
    authored_fields: ["obligation_id", "statement", "controlled_contract_node_ids",
      "mechanism", "gap", "pack_component"],
    call_shape: "single_row",
    receipt_fed_digest_state: {
      source: "immediately_prior_mutation_receipt",
      fields: ["expected_content_digest", "carrier_identity.content_digest"]
    }
  });
  const server = baseServer();
  server.mutation.stableArguments.expected_content_digest = sha("e");
  assert.throws(() => composeCoverageAuthoringSkeleton({
    surface: "obligation", server
  }), (error) => error.name === "CoverageAuthoringSkeletonError" &&
    /receipt-fed digest state/.test(error.message));
});

test("bounds the gap-first inline projection without discarding the population", () => {
  const server = baseServer();
  server.contractNodes = Array.from({ length: 60 }, (_, index) => ({
    id: `node-${index}-${"x".repeat(300)}`
  }));
  const result = composeCoverageAuthoringSkeleton({
    surface: "obligation", server
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
    surface: "obligation", server
  }), (error) => error.name === "CoverageAuthoringSkeletonError");
  assert.throws(() => composeCoverageAuthoringSkeleton({
    surface: "obligation", server: baseServer(), path: "/tmp/carrier"
  }), (error) => error.name === "CoverageAuthoringSkeletonError");
});

test("rejects sparse arrays before canonical byte accounting", () => {
  const sparseServer = baseServer();
  sparseServer.selectedPacks = Array(2_000);
  assert.throws(() => composeCoverageAuthoringSkeleton({
    surface: "obligation", server: sparseServer
  }), (error) => error.name === "CoverageAuthoringSkeletonError" &&
    error.code === "coverage_authoring_skeleton_input_invalid" &&
    error.message ===
      "input.server.selectedPacks[0] must not be a sparse array hole" &&
    error.details.name === "input.server.selectedPacks" &&
    error.details.index === 0);

  const accepted = { surface: "obligation", server: baseServer() };
  const result = composeCoverageAuthoringSkeleton(accepted);
  assert.equal(result.facts.request_utf8_bytes,
    Buffer.byteLength(JSON.stringify(accepted), "utf8"));
  assert.equal(result.inline_projection.utf8_bytes,
    Buffer.byteLength(JSON.stringify(result.inline_projection), "utf8"));
  assert.ok(result.inline_projection.utf8_bytes <= 16_384);
  assert.equal(result.facts.result_utf8_bytes,
    Buffer.byteLength(JSON.stringify(result), "utf8"));
});

test("selects only exact state-appropriate coverage mutations and recovery", () => {
  const call = (family, operation, requiredAuthoredFields = []) => ({
    tool: `workspace_controlled_contract_${family}_coverage_${operation}`,
    ...(operation === "query" || operation === "describe" || operation === "rebase"
      ? { arguments: { unit: "WK-2474#SLICE-005" } }
      : {
          fixed_arguments: { unit: "WK-2474#SLICE-005" },
          required_authored_fields: requiredAuthoredFields
        })
  });
  for (const family of ["obligation", "acceptance"]) {
    const status = {
      absent: family === "obligation" ? "source_absent" : "carrier_absent",
      current: family === "obligation"
        ? "source_present_current" : "carrier_present_current",
      stale: family === "obligation"
        ? "source_present_stale" : "carrier_present_stale"
    };
    const absent = coverageAuthoringActionProjection({
      family,
      status: status.absent,
      nextCalls: [call(family, "describe"), call(family, "create", ["rows"])],
      criterionCount: 12
    });
    assert.equal(absent.tool,
      `workspace_controlled_contract_${family}_coverage_create`);
    assert.equal(absent.kind, "atomic_initial_create");
    assert.equal(absent.required_population.request_field, "authored_rows");

    const current = coverageAuthoringActionProjection({
      family,
      status: status.current,
      nextCalls: [call(family, "query"), call(family, "upsert", ["row"]),
        call(family, "patch", ["operations"])],
      criterionCount: 12
    });
    assert.equal(current.tool,
      `workspace_controlled_contract_${family}_coverage_patch`);
    assert.equal(current.kind, "atomic_patch");
    assert.equal(current.required_population.request_field, "operations");

    const upsert = coverageAuthoringActionProjection({
      family,
      status: status.current,
      nextCalls: [call(family, "query"), call(family, "upsert", ["row"])],
      criterionCount: 12
    });
    assert.equal(upsert.tool,
      `workspace_controlled_contract_${family}_coverage_upsert`);
    assert.equal(upsert.kind, "single_row_upsert");
    assert.equal(upsert.required_population.request_field, "row");
    assert.equal(upsert.required_population.selector_field,
      family === "obligation" ? "obligation_selector" : "criterion_selector");

    const stale = coverageAuthoringActionProjection({
      family,
      status: status.stale,
      nextCalls: [call(family, "describe"), call(family, "rebase")],
      criterionCount: 12
    });
    assert.equal(stale.tool,
      `workspace_controlled_contract_${family}_coverage_rebase`);
    assert.equal(stale.kind, "owner_selected_recovery");

    for (const [readOnlyStatus, nextCalls] of [
      [status.absent, [call(family, "describe")]],
      [status.current, [call(family, "query"), call(family, "describe")]],
      [status.stale, [call(family, "describe"), call(family, "query")]]
    ]) assert.equal(coverageAuthoringActionProjection({
      family, status: readOnlyStatus, nextCalls, criterionCount: 12
    }), null);
  }
});
