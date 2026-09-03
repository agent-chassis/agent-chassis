import assert from "node:assert/strict";
import test from "node:test";

import {
  OBLIGATION_COVERAGE_GAP_KINDS,
  OBLIGATION_COVERAGE_SCHEMA_VERSION,
  validateObligationCoverageCarrier
} from "../lib/obligation-coverage-carrier.mjs";

const digest = `sha256:${"a".repeat(64)}`;

function mapping(overrides = {}) {
  return {
    kind: "pack_mapping",
    pack_id: "pack-one",
    requested_intent: "implementation-readiness",
    profile_id: "proof.design.implementation-readiness",
    profile_version: "2.0.0",
    selector: { kind: "claim", component_id: "mechanism-owner" },
    evaluation_stage: "pre_dispatch",
    ...overrides
  };
}

function row(id = "OBL-001", overrides = {}) {
  return {
    obligation_id: id,
    source_locator: "/acceptance/criteria/0",
    source_locator_digest: digest,
    statement: "Implement one exact behavior.",
    controlled_contract_node_ids: [`node-${id.toLowerCase()}`],
    mechanism: {
      owner: "packages/controlled-contract/lib/example.mjs",
      kind: "code_symbol",
      selector: "implementExample"
    },
    proof: mapping(),
    ...overrides
  };
}

function carrier(obligations = [row()], overrides = {}) {
  return {
    schema_version: OBLIGATION_COVERAGE_SCHEMA_VERSION,
    wk_id: "WK-2095",
    obligations,
    ...overrides
  };
}

test("accepts minimal parent and full focused carriers", () => {
  const minimal = validateObligationCoverageCarrier(carrier());
  assert.equal(minimal.valid, true);
  assert.equal(Object.isFrozen(minimal.carrier), true);
  const full = validateObligationCoverageCarrier(carrier([
    row("OBL-001"),
    row("OBL-002", {
      source_locator: "/slices/0/acceptance/criteria/0",
      proof: {
        kind: "explicit_gap", gap_kind: "catalog_gap",
        reason: "No exact admitted proof component exists."
      }
    })
  ], { focus: "SLICE-001" }));
  assert.equal(full.valid, true);
  assert.deepEqual(full.carrier.obligations.map(({ obligation_id: id }) => id),
    ["OBL-001", "OBL-002"]);
});

test("accepts every exact explicit-gap variant", () => {
  for (const gapKind of OBLIGATION_COVERAGE_GAP_KINDS) {
    const result = validateObligationCoverageCarrier(carrier([row("OBL-001", {
      proof: { kind: "explicit_gap", gap_kind: gapKind, reason: "Exact reason." }
    })]));
    assert.equal(result.valid, true, gapKind);
  }
});

test("rejects every authorable census field and legacy scratch aliases", () => {
  const forbidden = [
    "total", "total_count", "pack_bound", "pack_bound_count", "gap",
    "gap_count", "invalid_mapping", "invalid_mapping_count", "unmapped",
    "unmapped_count", "proven", "proven_count", "mechanically_proven",
    "coverage", "census", "counts", "summary", "mapped", "statuses",
    "obligation_map", "proof_profile", "P01"
  ];
  for (const field of forbidden) {
    const result = validateObligationCoverageCarrier(carrier([row()], {
      [field]: field
    }));
    assert.equal(result.valid, false, field);
    assert.ok(result.schema_errors.some(({ keyword }) =>
      keyword === "additionalProperties"), field);
  }
});

test("rejects unknown row fields, malformed identities, and incomplete dispositions", () => {
  const cases = [
    carrier([row("OBL-001", { caller_count: 1 })]),
    carrier([row()], { wk_id: "2095" }),
    carrier([row()], { focus: "slice-1" }),
    carrier([row("bad")]),
    carrier([row("OBL-001", { source_locator: "acceptance/criteria/0" })]),
    carrier([row("OBL-001", { source_locator_digest: "a".repeat(64) })]),
    carrier([row("OBL-001", { statement: "first\nsecond" })]),
    carrier([row("OBL-001", { controlled_contract_node_ids: [] })]),
    carrier([row("OBL-001", { mechanism: { owner: "x", kind: "code_symbol" } })]),
    carrier([row("OBL-001", { proof: { kind: "explicit_gap",
      gap_kind: "catalog_gap" } })])
  ];
  for (const [index, value] of cases.entries()) {
    assert.equal(validateObligationCoverageCarrier(value).valid, false, `${index}`);
  }
});

test("rejects duplicate obligation identities before assessment", () => {
  const result = validateObligationCoverageCarrier(carrier([
    row("OBL-001"), row("OBL-001", {
      source_locator: "/acceptance/criteria/1",
      controlled_contract_node_ids: ["node-other"]
    })
  ]));
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code,
    "obligation_coverage_obligation_id_duplicate");
});

test("rejects duplicate pack-selector-node credit deterministically", () => {
  const rows = [
    row("OBL-001", { controlled_contract_node_ids: ["node-shared"] }),
    row("OBL-002", { source_locator: "/acceptance/criteria/1",
      controlled_contract_node_ids: ["node-shared"] })
  ];
  const forward = validateObligationCoverageCarrier(carrier(rows));
  const reverse = validateObligationCoverageCarrier(carrier([...rows].reverse()));
  assert.equal(forward.valid, false);
  assert.equal(forward.diagnostics[0].code,
    "obligation_coverage_credit_tuple_duplicate");
  assert.deepEqual(forward.diagnostics.map(({ first_index, duplicate_index,
    ...detail }) => detail), reverse.diagnostics.map(({ first_index,
    duplicate_index, ...detail }) => detail));
});

test("permits one population selector to credit distinct assessed members", () => {
  const result = validateObligationCoverageCarrier(carrier([
    row("OBL-001", { controlled_contract_node_ids: ["member-a"] }),
    row("OBL-002", { source_locator: "/acceptance/criteria/1",
      controlled_contract_node_ids: ["member-b"] })
  ]));
  assert.equal(result.valid, true);
});
