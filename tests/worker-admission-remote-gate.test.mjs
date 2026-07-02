

import assert from "node:assert/strict";
import test from "node:test";
import {
  NODE_ENGINE_RATIFIED_BINDING_STATUS_MARKER,
  NODE_ENGINE_UNRATIFIED_PLACEHOLDER_MARKER,
  REMOTE_WORKER_ADMISSION_GATE_CODES,
  REMOTE_WORKER_ADMISSION_LOCAL_ONLY_FAIL_OPEN_DISPOSITION,
  evaluateRemoteWorkerAdmissionWrapperGate,
  normalizeSuppliedRemoteWorkerAdmissionPackResult
} from "../packages/agent-launch-core/src/lib/worker-admission-remote-gate.mjs";

const UNIT = "WK-1287#SLICE-001";

function gate(remote, { localAllowed = true } = {}) {
  return evaluateRemoteWorkerAdmissionWrapperGate({ localAllowed, remote, unitAddress: UNIT });
}

function localOnly(overrides = {}) {
  return {
    disposition: REMOTE_WORKER_ADMISSION_LOCAL_ONLY_FAIL_OPEN_DISPOSITION,
    effect: null,
    pack_backed: false,
    node_engine_backed_success: false,
    node_engine_binding_status: null,
    outcome: "local_only_fail_open",
    reason_code: "local_only_fail_open",
    ...overrides
  };
}

function ratifiedRemote(effect, overrides = {}) {
  return {
    disposition: "structural_remote",
    effect,
    pack_backed: true,
    node_engine_backed_success: true,
    node_engine_binding_status: NODE_ENGINE_RATIFIED_BINDING_STATUS_MARKER,
    outcome: "remote_decided",
    reason_code: `remote_${effect}`,
    ...overrides
  };
}

test("WK-1287 confirmed local-only fails OPEN (the single fail-open disposition)", () => {
  const r = gate(localOnly());
  assert.equal(r.allowed, true);
  assert.equal(r.engaged, false);
  assert.equal(r.remote_gate_code, "remote_enforcement_local_only");
});

test("WK-1287 the local-only fail-open is keyed on the DISPOSITION, not a verified provenance descriptor", () => {

  const r = gate(localOnly({ effect: "reject", node_engine_binding_status: NODE_ENGINE_RATIFIED_BINDING_STATUS_MARKER }));
  assert.equal(r.allowed, true);
  assert.equal(r.engaged, false);
  assert.equal(r.remote_gate_code, "remote_enforcement_local_only");
});

test("WK-1287 the fail-open path never emits the Node Engine authority-bound marker", () => {
  const r = gate(localOnly());
  const serialized = JSON.stringify(r);
  assert.ok(!serialized.includes(NODE_ENGINE_RATIFIED_BINDING_STATUS_MARKER));

  assert.equal(r.engaged, false);
});

test("WK-1287 remote_enforcement_absent (no result artifact at all) fails CLOSED", () => {
  for (const absent of [undefined, null, "not-an-object", 42, ["array"]]) {
    const r = gate(absent);
    assert.equal(r.allowed, false, JSON.stringify(absent));
    assert.equal(r.engaged, false);
    assert.equal(r.remote_gate_code, "remote_enforcement_absent");
  }
});

test("WK-1287 NE-configured-but-not-granting dispositions all fail CLOSED", () => {

  const unratified = gate(ratifiedRemote("admit", {
    node_engine_binding_status: NODE_ENGINE_UNRATIFIED_PLACEHOLDER_MARKER
  }));
  assert.equal(unratified.allowed, false);
  assert.equal(unratified.remote_gate_code, "remote_admit_unratified");

  assert.equal(gate(ratifiedRemote("needs_review")).remote_gate_code, "remote_needs_review");
  assert.equal(gate(ratifiedRemote("needs_review")).allowed, false);
  assert.equal(gate(ratifiedRemote("reject")).remote_gate_code, "remote_reject");
  assert.equal(gate(ratifiedRemote("reject")).allowed, false);

  const unavailable = gate(ratifiedRemote("kaboom"));
  assert.equal(unavailable.allowed, false);
  assert.equal(unavailable.remote_gate_code, "remote_enforcement_unavailable");
});

test("WK-1287 only a ratified pack-backed admit authorizes the engaged lane", () => {
  const r = gate(ratifiedRemote("admit"));
  assert.equal(r.allowed, true);
  assert.equal(r.engaged, true);
  assert.equal(r.remote_gate_code, "remote_admit");
});

test("WK-1287 a local structural refusal is preserved even on confirmed local-only", () => {
  const r = gate(localOnly(), { localAllowed: false });
  assert.equal(r.allowed, false);
  assert.equal(r.remote_gate_code, "local_refusal_preserved");
});

test("WK-1287 every gate result advertises only the closed code vocabulary", () => {
  for (const remote of [localOnly(), ratifiedRemote("admit"), ratifiedRemote("reject"), null]) {
    const r = gate(remote);
    assert.ok(REMOTE_WORKER_ADMISSION_GATE_CODES.includes(r.remote_gate_code), r.remote_gate_code);
    assert.ok(Object.isFrozen(r));
  }
});

test("WK-1287 normalizer marks the local-only disposition non-engaged and drops no provenance object", () => {
  const n = normalizeSuppliedRemoteWorkerAdmissionPackResult(localOnly());
  assert.equal(n.engaged, false);
  assert.equal(n.disposition, REMOTE_WORKER_ADMISSION_LOCAL_ONLY_FAIL_OPEN_DISPOSITION);

  assert.equal("trusted_local_only_provenance" in n, false);
});
