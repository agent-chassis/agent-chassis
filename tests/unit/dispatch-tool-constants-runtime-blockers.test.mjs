

import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKEND_REFUSAL_TO_DISPATCH_BLOCKER,
  DISPATCH_BLOCKER_CODES,
  DISPATCH_GRAPH_BLOCKER_CODE_VALUES,
  DISPATCH_MECHANICAL_BLOCKER_CODES,
  RETIRED_DISPATCH_BLOCKER_CODE_IDENTITIES
} from "../../packages/wiki-mcp/src/lib/dispatch-tool-constants.mjs";
import {
  RUNTIME_BLOCKER_DESCRIPTOR,
  getRuntimeBlockerEntry,
  isRuntimeBlockerCode
} from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

const RETIRED_THRESHOLD_IDENTITY = "worker_admission_review_threshold_exceeded";

test("every exported dispatch blocker constant resolves to a registered taxonomy code", () => {
  for (const [mapName, map] of [
    ["DISPATCH_BLOCKER_CODES", DISPATCH_BLOCKER_CODES],
    ["DISPATCH_MECHANICAL_BLOCKER_CODES", DISPATCH_MECHANICAL_BLOCKER_CODES]
  ]) {
    for (const [key, code] of Object.entries(map)) {
      assert.equal(typeof code, "string", `${mapName}.${key} must be a string code`);
      assert.ok(isRuntimeBlockerCode(code), `${mapName}.${key} (${code}) must be registered`);
    }
  }
  for (const code of DISPATCH_GRAPH_BLOCKER_CODE_VALUES) {
    assert.ok(isRuntimeBlockerCode(code), `${code} must be registered`);
  }
});

test("no exported constant carries an undefined code after the taxonomy narrowing", () => {

  const allValues = [
    ...Object.values(DISPATCH_BLOCKER_CODES),
    ...Object.values(DISPATCH_MECHANICAL_BLOCKER_CODES),
    ...DISPATCH_GRAPH_BLOCKER_CODE_VALUES,
    ...Object.values(BACKEND_REFUSAL_TO_DISPATCH_BLOCKER)
  ];
  assert.equal(allValues.some((value) => value === undefined || value === null), false);
});

test("worker_admission_review_threshold_exceeded is retired, not merely unused", () => {
  assert.deepEqual(RETIRED_DISPATCH_BLOCKER_CODE_IDENTITIES, [RETIRED_THRESHOLD_IDENTITY]);
  assert.equal(isRuntimeBlockerCode(RETIRED_THRESHOLD_IDENTITY), false);
  assert.equal(getRuntimeBlockerEntry(RETIRED_THRESHOLD_IDENTITY), null);
  for (const map of [DISPATCH_BLOCKER_CODES, DISPATCH_MECHANICAL_BLOCKER_CODES]) {
    assert.equal(Object.values(map).includes(RETIRED_THRESHOLD_IDENTITY), false);
    assert.equal(Object.hasOwn(map, "WORKER_ADMISSION_REVIEW_THRESHOLD_EXCEEDED"), false);
  }
  assert.equal(
    Object.values(BACKEND_REFUSAL_TO_DISPATCH_BLOCKER).includes(RETIRED_THRESHOLD_IDENTITY),
    false
  );
  assert.equal(DISPATCH_GRAPH_BLOCKER_CODE_VALUES.includes(RETIRED_THRESHOLD_IDENTITY), false);
});

test("no retired identity is reachable through a taxonomy alias", () => {
  const retired = new Set(RETIRED_DISPATCH_BLOCKER_CODE_IDENTITIES);
  for (const entry of RUNTIME_BLOCKER_DESCRIPTOR.codes) {
    for (const alias of entry.aliases ?? []) {
      assert.equal(retired.has(alias), false, `${entry.code} aliases a retired identity`);
    }
  }
});

test("the actor-correct mechanical codes the producer census needs are all present", () => {

  const requiredMechanicalIdentities = [
    "work_record_readiness_failure",
    "worker_admission_carrier_invalid",
    "backend_unavailable",
    "operator_recovery_needed",
    "validation_failure",
    "role_policy_violation",
    "managed_slice_tip_reconcile_required",
    "graph_impact_unavailable",
    "graph_impact_query_error",
    "graph_impact_artifact_missing",
    "graph_impact_rebuild_required",
    "graph_impact_unknown_state",
    "graph_impact_persistence_unavailable"
  ];
  const exported = new Set(Object.values(DISPATCH_MECHANICAL_BLOCKER_CODES));
  for (const code of requiredMechanicalIdentities) {
    assert.ok(exported.has(code), `${code} must be an exported mechanical identity`);
  }
  assert.equal(exported.size, requiredMechanicalIdentities.length);
});

test("the graph subset holds exactly the graph_impact families and nothing else", () => {
  for (const code of DISPATCH_GRAPH_BLOCKER_CODE_VALUES) {
    const entry = getRuntimeBlockerEntry(code);
    assert.ok(
      entry.category === "graph_impact" || entry.category === "graph_impact_persistence",
      `${code} must be a graph-family code, got ${entry.category}`
    );
  }
  const graphFamilyCodes = RUNTIME_BLOCKER_DESCRIPTOR.codes
    .filter((entry) => entry.category === "graph_impact" || entry.category === "graph_impact_persistence")
    .map((entry) => entry.code);

  assert.deepEqual(
    [...DISPATCH_GRAPH_BLOCKER_CODE_VALUES].sort(),
    graphFamilyCodes.filter((code) => code !== "graph_impact_degraded_overlay").sort()
  );
});

test("no repository blocker identity is exported for an authenticated CCE policy result", () => {

  const policyShapedIdentities = Object.values(DISPATCH_MECHANICAL_BLOCKER_CODES)
    .concat(Object.values(DISPATCH_BLOCKER_CODES))
    .filter((code) => /needs_review|admit|reject|threshold|policy_refused/.test(code));
  assert.deepEqual(policyShapedIdentities, []);
});

test("every exported mechanical identity carries a coherent actor_recovery", () => {
  for (const code of Object.values(DISPATCH_MECHANICAL_BLOCKER_CODES)) {
    const entry = getRuntimeBlockerEntry(code);
    assert.ok(entry, `${code} must have a taxonomy entry`);
    assert.ok(
      RUNTIME_BLOCKER_DESCRIPTOR.actor_recovery_values.includes(entry.actor_recovery),
      `${code} actor_recovery ${entry.actor_recovery} must be in the controlled vocabulary`
    );
    assert.equal(entry.blocking, true, `${code} must be a blocking refusal identity`);
  }
});

test("only the ready-slice authored-defect limb keeps work_record_readiness_failure recovery guidance", () => {
  const readiness = getRuntimeBlockerEntry(DISPATCH_MECHANICAL_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE);
  assert.equal(readiness.recovery.kind, "exact_named_contract_defect");
  for (const code of DISPATCH_GRAPH_BLOCKER_CODE_VALUES) {
    assert.notEqual(code, DISPATCH_MECHANICAL_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE);
  }
});
