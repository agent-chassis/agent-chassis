import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createCompactValidateDispatchResponse } from
  "../../packages/wiki-mcp/src/lib/work-record-write-route-helpers.mjs";
import { REGISTERED_TIER_FREE_LOCAL } from "../../packages/wiki-mcp/src/lib/tool-profile.mjs";
import {
  WORKSPACE_REPO,
  REQUEST_CONTRACT_DIGEST_ENV,
  assertNoSecretLeak,
  syntheticUndeterminedReadiness,
  FREE_LOCAL_GENERIC_STRUCTURAL_DEFAULT,
  syntheticFreeLocalStructuralReadiness,
  assertNamesNoPaidTool
} from "../helpers/validate-dispatch-diagnostic-fixture.mjs";

test("generic invalid_request keeps a distinct fallback next_action (not a problem-specific remediation)", () => {
  const generic = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_request_invalid")
  );
  assert.equal(typeof generic.next_action, "string");
  assert.ok(generic.next_action.length > 0, "generic fallback next_action must be non-empty");

  assert.ok(
    !generic.next_action.includes(REQUEST_CONTRACT_DIGEST_ENV),
    "generic fallback must not reference the request-contract digest rebind"
  );
  assert.doesNotMatch(generic.next_action, /policy[ -]?profile/i, "generic fallback must not reference policy-profile remediation");
  assert.doesNotMatch(generic.next_action, /dependency graph/i, "generic fallback must not reference dependency-graph remediation");

  const packInputRequired = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_pack_input_required")
  );
  const packInputInvalid = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_pack_input_invalid")
  );
  assert.notEqual(generic.next_action, packInputRequired.next_action);
  assert.notEqual(generic.next_action, packInputInvalid.next_action);
});

test("free-local missing_graph_impact carries no directed remedy under the supplementary-graph contract", () => {
  const compact = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticFreeLocalStructuralReadiness("missing_graph_impact"),
    REGISTERED_TIER_FREE_LOCAL
  );

  assert.equal(
    compact.next_action,
    FREE_LOCAL_GENERIC_STRUCTURAL_DEFAULT,
    "a code the current readiness contract cannot emit must not gain a directed remedy"
  );
  assertNamesNoPaidTool(compact.next_action, "missing_graph_impact");

  assert.ok(Object.prototype.hasOwnProperty.call(compact, "blast_radius_level"));
  assert.ok(Object.prototype.hasOwnProperty.call(compact, "cluster_count"));
  assert.ok(
    !Object.prototype.hasOwnProperty.call(compact, "admissibility"),
    "free-local projection must not surface a paid admissibility mirror"
  );

  assertNoSecretLeak(compact, "free-local missing_graph_impact");
});

test("no decision-code remedy directs a caller to a retired route", () => {
  const retired = [
    "workspace_work_record_refresh_target_resolution_evidence",
    "workspace_controlled_contract_acceptance_coverage_describe",
    "workspace_controlled_contract_refactor_plan"
  ];
  for (const decisionCode of ["missing_target_resolution_evidence", "missing_graph_impact",
    "multi_cluster", "missing_write_scope", "record_validation_failure",
    "controlled_acceptance_incomplete", "work_record_readiness_failure"]) {
    for (const tier of [undefined, REGISTERED_TIER_FREE_LOCAL]) {
      const compact = createCompactValidateDispatchResponse(
        WORKSPACE_REPO, syntheticFreeLocalStructuralReadiness(decisionCode), tier);
      for (const name of retired) {
        assert.equal(compact.next_action.includes(name), false,
          `${decisionCode} (${tier ?? "paid_cce"}) must not name the retired route ${name}`);
      }
    }
  }
});

test("free-local missing_target_resolution_evidence falls to the generic structural default (DEC-0125), naming no paid refresh tool", () => {
  const compact = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticFreeLocalStructuralReadiness("missing_target_resolution_evidence"),
    REGISTERED_TIER_FREE_LOCAL
  );

  assert.equal(
    compact.next_action,
    FREE_LOCAL_GENERIC_STRUCTURAL_DEFAULT,
    "free-local missing_target_resolution_evidence must route to the generic structural default"
  );

  assertNamesNoPaidTool(compact.next_action, "missing_target_resolution_evidence");

  assertNoSecretLeak(compact, "free-local missing_target_resolution_evidence");
});
