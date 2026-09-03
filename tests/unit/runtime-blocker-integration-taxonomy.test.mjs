import test from "node:test";
import assert from "node:assert/strict";

import {
  RUNTIME_BLOCKER_DESCRIPTOR,
  assertRuntimeBlockerSubset,
  classifySemanticIdentity,
  getRuntimeBlockerEntry,
  isPublicMechanicalRefusalCode
} from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

const INTEGRATION_LIMBS = [
  "backend_unavailable",
  "validation_failure",
  "operator_recovery_needed"
];

test("committed-slice integration uses exact public recovery limbs", () => {
  assertRuntimeBlockerSubset(INTEGRATION_LIMBS);
  for (const code of INTEGRATION_LIMBS) {
    const entry = getRuntimeBlockerEntry(code);
    assert.ok(entry, `registry entry missing for ${code}`);
    assert.equal(entry.blocking, true);
    assert.match(entry.consumer_notes, /committed-slice integration route/iu);
    assert.match(entry.consumer_notes, /public recovery limb/iu);
  }
});

test("integration taxonomy documents launcher ownership without diagnostic inference", () => {
  const entries = INTEGRATION_LIMBS.map(getRuntimeBlockerEntry);
  const notes = entries.map((entry) => entry.consumer_notes).join("\n");

  assert.match(notes, /launcher-owned diagnostic codes and messages remain opaque/iu);
  assert.match(notes, /diagnostic code and message spelling remain non-authoritative/iu);
  assert.match(notes, /review evidence and contributor sequencing never classify or authorize/iu);
  assert.doesNotMatch(notes, /AGENTS\.md|DEC-0164|review receipt|reviewer result|disposition/iu);
  assert.deepEqual(
    entries.map((entry) => entry.category),
    ["backend", "validation", "operator_recovery"]
  );
  assert.equal(RUNTIME_BLOCKER_DESCRIPTOR.owner, "IN-0016");
});

test("the integration recovery limbs are public mechanical codes, not launcher causes", () => {

  for (const code of INTEGRATION_LIMBS) {
    assert.equal(isPublicMechanicalRefusalCode(code), true, code);
    assert.equal(classifySemanticIdentity(code), "public_mechanical_code", code);
  }

  assert.equal(
    classifySemanticIdentity("launcher_transition.cce_policy_refused.v1"),
    "public_mechanical_code",
    "a deliberately registered transition code stays public"
  );
  assert.equal(
    classifySemanticIdentity("frozen_standalone_findings_contract_invalid"),
    "private_launcher_cause"
  );
});
