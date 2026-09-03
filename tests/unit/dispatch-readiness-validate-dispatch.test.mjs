import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deriveDispatchRole } from "../../packages/wiki-core/src/operations/validate-dispatch.mjs";

const CONSUMER = new URL(
  "../../packages/wiki-core/src/operations/validate-dispatch.mjs",
  import.meta.url
);

test("validate-dispatch delegates readiness construction to the owner", async () => {
  const source = await readFile(CONSUMER, "utf8");

  assert.match(source, /buildTerminalReadiness/);
  assert.doesNotMatch(source, /schema_version:\s*["']dispatch-readiness\.v1["']/);
  assert.doesNotMatch(source, /dispatchable:\s*false[\s,\n]/);
  assert.doesNotMatch(source, /recovery:\s*\{/);
  assert.doesNotMatch(source, /blast_radius:\s*\{/);
});

function subject(intendedAgentRole, workKind = "review") {
  return {
    dispatch_intent: { intended_agent_role: intendedAgentRole },
    work_kind: workKind
  };
}

test("all derived-axis refusal paths return canonical readiness envelopes", () => {
  const refusals = [
    deriveDispatchRole(subject(null), "WK-2323#SLICE-009").refusal,
    deriveDispatchRole(subject("constructor"), "WK-2323#SLICE-009").refusal,
    deriveDispatchRole(subject("redteam", "implementation"), "WK-2323#SLICE-009").refusal
  ];

  for (const refusal of refusals) {
    assert.equal(refusal.decision_code, "dispatch_readiness_axis_ambiguous");
    assert.equal(refusal.dispatchable, false);
    assert.equal(refusal.state.dirty_state, "unknown");
    assert.equal(refusal.state.staleness, "unknown");
    assert.deepEqual(refusal.recovery, {
      graph_impact: "not_required",
      admission_metrics: "not_required",
      target_resolution: "not_required"
    });
  }
});
