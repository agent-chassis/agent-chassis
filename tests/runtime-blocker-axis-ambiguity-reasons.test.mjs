import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const AXIS_AMBIGUITY_CODE = "dispatch_readiness_axis_ambiguous";

async function loadAxisAmbiguityEntry() {
  const taxonomy = JSON.parse(await readFile(
    new URL(
      "../packages/wiki-core/data/runtime-blocker-codes.v1.json",
      import.meta.url
    ),
    "utf8"
  ));
  return taxonomy.codes.find(({ code }) => code === AXIS_AMBIGUITY_CODE);
}

test("axis ambiguity taxonomy declares every emitted refusal reason", async () => {
  const source = await readFile(
    new URL(
      "../packages/wiki-core/src/operations/validate-dispatch.mjs",
      import.meta.url
    ),
    "utf8"
  );
  const emittedReasons = new Set(
    [...source.matchAll(/"(intended_agent_role_[a-z_]+|derived_[a-z_]+)"/g)]
      .map(([, value]) => value)
  );
  const entry = await loadAxisAmbiguityEntry();
  const declaredReasons = new Set(entry.reasons.map(({ reason }) => reason));

  assert.deepEqual(
    emittedReasons,
    declaredReasons,
    "every emitted reason must be declared and every declaration must be reachable"
  );
});

test("derived read-only implementation guard preserves its remediation contract", async () => {
  const entry = await loadAxisAmbiguityEntry();
  const guard = entry.reasons.find(
    ({ reason }) => reason === "derived_read_only_implementation_guard"
  );

  assert.ok(guard, "the derived read-only implementation guard must be declared");
  assert.equal(guard.observed_field, "dispatch_intent.intended_agent_role");
  assert.equal(
    guard.observed_condition,
    "The intended role maps to read_only while work_kind is implementation."
  );
  assert.equal(guard.remediation.action, "supply_explicit_dispatch_role");
  assert.equal(guard.remediation.argument, "dispatch_role");
});
