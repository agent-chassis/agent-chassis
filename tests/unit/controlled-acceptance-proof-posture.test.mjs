import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROLLED_ACCEPTANCE_OPT_OUT_PROVENANCE,
  assertControlledAcceptanceStateProjection,
  buildControlledAcceptanceProofPosture,
  controlledAcceptanceOptOutProvenance,
  inspectWorkRecordProofPosture
} from "../../packages/wiki-core/src/lib/work-record-proof-posture.mjs";
import { validateWorkRecord } from
  "../../packages/wiki-core/src/lib/work-record-schema.mjs";
import { classifyControlledAcceptanceStateOperation } from
  "../../packages/wiki-core/src/operations/controlled-contract/controlled-acceptance-state-operations.mjs";
import { applyControlledContractDesignSemanticResponse } from
  "../../packages/wiki-core/src/operations/controlled-contract/authoring-operations.mjs";
import {
  persistControlledAcceptanceProofPostureOperation,
  prepareControlledAcceptanceProofPostureAmendment
} from "../../packages/wiki-core/src/operations/controlled-contract/proof-posture-operations.mjs";
import { today } from "../../packages/wiki-core/src/lib/wiki-shared.mjs";
import { isWorkRecordUpdatedDate } from "../../packages/agent-launch-cli/src/lib/wk-forge-handoff-recovery.mjs";

function record(extra = {}) {
  return {
    schema_version: "work-record.v1", record_kind: "work_item", id: "WK-9997",
    title: "Proof posture fixture", repo: "agent-chassis/agent-chassis",
    work_kind: "implementation", status: "inbox", priority: "medium", owner: null,
    initiative: null, depends_on: [], blocked_by: [], related: [],
    read_scope: ["docs/"], repo_paths: ["packages/wiki-core/"],
    write_scope: ["packages/wiki-core/"],
    dispatch_intent: { intended_agent_role: "worker", target_unit: "slice",
      requires_graph_impact: false, requires_escalation: false },
    acceptance: { criteria: ["Implement proof posture"], validation: ["node --test"] },
    created: "2026-09-04", updated: "2026-09-04", ...extra
  };
}

function workbench(generation, complete, contractDigest = null, coverage = "complete") {
  return {
    subject: { generation_id: generation }, mechanically_complete: complete,
    evaluated_snapshot: coverage === null ? null : {
      ordinary_authoring_readiness: { acceptance_coverage: { status: coverage } } },
    dimension_count: 9, incomplete_row_count: complete ? 0 : 4,
    actionable_row_count: complete ? 0 : 3,
    non_actionable_row_count: complete ? 0 : 1,
    dimensions: [{ dimension_id: "authoring_stage", owner_result: {
      selected_resources: contractDigest === null ? {} : {
        contract: { content_digest: contractDigest }
      }
    } }]
  };
}

test("proof posture is the sole carrier for absent, incomplete, complete, and opted_out", async () => {
  const bare = record();
  const absent = await classifyControlledAcceptanceStateOperation({ repoRoot: "/repo",
    wkId: bare.id, record: bare }, { inspectWorkbench: async () => workbench(null, false) });
  assert.equal(absent.state, "absent");
  assert.equal(absent.recovery.tool, "workspace_controlled_contract_obligation_coverage_query");
  assert.equal(
    absent.recovery.follow_up_tool,
    "workspace_controlled_contract_obligation_coverage_upsert"
  );

  const required = record({ proof_posture: buildControlledAcceptanceProofPosture({
    wkId: bare.id, disposition: "required"
  }) });
  const incomplete = await classifyControlledAcceptanceStateOperation({ repoRoot: "/repo",
    wkId: required.id, record: required }, {
    inspectWorkbench: async () => workbench("sha256:generation", false)
  });
  assert.equal(incomplete.state, "incomplete");
  assert.equal(incomplete.population.incomplete_row_count, 4);

  const complete = await classifyControlledAcceptanceStateOperation({ repoRoot: "/repo",
    wkId: required.id, record: required }, {
    inspectWorkbench: async () => workbench("sha256:generation", true)
  });
  assert.equal(complete.state, "complete");
  assert.equal(complete.mechanically_complete, true);

  for (const coverage of ["incomplete", null]) {
    const uncovered = await classifyControlledAcceptanceStateOperation({ repoRoot: "/repo",
      wkId: required.id, record: required }, {
      inspectWorkbench: async () => workbench("sha256:generation", true, null, coverage)
    });
    assert.equal(uncovered.state, "incomplete", `coverage ${coverage}`);
    assert.equal(uncovered.semantic.admission.blocked_reason_code,
      "controlled_acceptance_incomplete");
  }

  const opted = record({ proof_posture: buildControlledAcceptanceProofPosture({
    wkId: bare.id, disposition: "opted_out", rationale: "No executable behavior applies."
  }) });
  const optedOut = await classifyControlledAcceptanceStateOperation({ repoRoot: "/repo",
    wkId: opted.id, record: opted }, { inspectWorkbench: async () => workbench(null, false) });
  assert.equal(optedOut.state, "opted_out");
  assert.equal(optedOut.disposition.exemption, "no_controlled_contract");
  assert.equal(optedOut.disposition.classification_rationale,
    "No executable behavior applies.");
});

test("malformed and contradictory proof posture fails closed", async () => {
  const malformed = record({ proof_posture: {
    schema_version: "work-record-proof-posture.v1", record_id: "WK-9997",
    classification: "standard", classification_rationale: "   ",
    controlled_contract: { required: false, exemption: "no_controlled_contract", focus: null }
  } });
  assert.equal(inspectWorkRecordProofPosture(malformed).valid, false);
  assert.ok(validateWorkRecord(malformed).some(({ path }) => path === "proof_posture"));
  await assert.rejects(() => classifyControlledAcceptanceStateOperation({ repoRoot: "/repo",
    wkId: malformed.id, record: malformed }, {
    inspectWorkbench: async () => workbench(null, false)
  }), { code: "controlled_acceptance_proof_posture_invalid" });

  const contradictory = record({ proof_posture: {
    ...buildControlledAcceptanceProofPosture({ wkId: "WK-9997",
      disposition: "opted_out", rationale: "No applicable surface." }),
    controlled_contract: { required: false, exemption: "no_controlled_contract",
      focus: null, content_digest: `sha256:${"a".repeat(64)}` }
  } });
  await assert.rejects(() => classifyControlledAcceptanceStateOperation({ repoRoot: "/repo",
    wkId: contradictory.id, record: contradictory }, {
    inspectWorkbench: async () => workbench("sha256:generation", true)
  }), { code: "controlled_acceptance_proof_posture_invalid" });
});

test("required posture does not pin mechanical completion to an old content digest",
  async () => {
    const required = buildControlledAcceptanceProofPosture({ wkId: "WK-9997",
      disposition: "required" });
    const pinned = record({ proof_posture: { ...required,
      controlled_contract: { ...required.controlled_contract,
        content_digest: `sha256:${"1".repeat(64)}` } } });
    const inspected = inspectWorkRecordProofPosture(pinned);
    assert.equal(inspected.valid, true);
    const incomplete = await classifyControlledAcceptanceStateOperation({ repoRoot: "/repo",
      wkId: pinned.id, record: pinned }, { inspectWorkbench: async () =>
      workbench(`sha256:${"2".repeat(64)}`, false, `sha256:${"3".repeat(64)}`) });
    assert.equal(incomplete.state, "incomplete");
    const complete = await classifyControlledAcceptanceStateOperation({ repoRoot: "/repo",
      wkId: pinned.id, record: pinned }, { inspectWorkbench: async () =>
      workbench(`sha256:${"4".repeat(64)}`, true, `sha256:${"5".repeat(64)}`) });
    assert.equal(complete.state, "complete");
    assert.equal(complete.generation, `sha256:${"4".repeat(64)}`);
  });

test("retired proof-posture authoring and enforcement keys are rejected", () => {
  const base = buildControlledAcceptanceProofPosture({ wkId: "WK-9997",
    disposition: "required" });
  for (const key of ["enforcement", "enforcement_authorities", "authoring_state",
    "guidance", "next_actions", "optional_proof_carriers", "emitted_next_action"]) {
    const inspected = inspectWorkRecordProofPosture(record({ proof_posture: {
      ...base, [key]: key === "optional_proof_carriers" ? [] : {}
    } }));
    assert.equal(inspected.valid, false, key);
  }
});

test("the semantic owner replaces an otherwise-valid retired posture shape", async () => {
  const retired = record({ proof_posture: {
    ...buildControlledAcceptanceProofPosture({ wkId: "WK-9997", disposition: "required" }),
    enforcement: "advisory"
  } });
  let written = null;
  const result = await persistControlledAcceptanceProofPostureOperation({
    repoRoot: "/repo", wkId: "WK-9997", disposition: "required",
    expectedSourceDigest: `sha256:${"a".repeat(64)}`
  }, {
    loadRecord: async () => ({ valid: false, record: retired,
      source_digest: `sha256:${"a".repeat(64)}`, diagnostics: [{
        code: "invalid_record", severity: "error", path: "proof_posture",
        message: "retired posture key"
      }] }),
    writeRecord: async ({ record: replacement }) => {
      written = replacement;
      return { written: true, source_digest: `sha256:${"b".repeat(64)}` };
    },
    now: () => "2026-09-04"
  });
  assert.equal(result.written, true);
  assert.deepEqual(written.proof_posture,
    buildControlledAcceptanceProofPosture({ wkId: "WK-9997", disposition: "required" }));
  assert.equal(Object.hasOwn(written.proof_posture, "enforcement"), false);
});

test("recording the disposition moves the record's updated to a calendar date", async () => {
  let written = null;
  await persistControlledAcceptanceProofPostureOperation({
    repoRoot: "/repo", wkId: "WK-9997", disposition: "required",
    expectedSourceDigest: `sha256:${"a".repeat(64)}`
  }, {
    loadRecord: async () => ({ valid: true, record: record({ updated: "2026-01-01" }),
      source_digest: `sha256:${"a".repeat(64)}`, diagnostics: [] }),
    writeRecord: async ({ record: replacement }) => {
      written = replacement;
      return { written: true, source_digest: `sha256:${"b".repeat(64)}` };
    }
  });
  assert.equal(written.updated, today());
  assert.equal(isWorkRecordUpdatedDate(written.updated), true, written.updated);
  const amended = prepareControlledAcceptanceProofPostureAmendment({
    record: record({ updated: "2026-01-01" }), wkId: "WK-9997", disposition: "required"
  });
  assert.equal(amended.record.updated, today());
});

test("guarded responses invoke exactly one proof-posture semantic owner", async () => {
  const calls = [];
  const continuationRecord = { workbench: { semantic_owner: "proof_posture",
    owner_context: { expected_record_source_digest: `sha256:${"a".repeat(64)}` } } };
  await applyControlledContractDesignSemanticResponse({ repoRoot: "/repo", wkId: "WK-9997",
    continuationRecord, response: { kind: "declare_controlled_acceptance_applies" } }, {
    persistControlledAcceptanceProofPosture: async (input) => {
      calls.push(input); return { written: true };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].disposition, "required");

  calls.length = 0;
  await applyControlledContractDesignSemanticResponse({ repoRoot: "/repo", wkId: "WK-9997",
    continuationRecord, response: { kind: "explicitly_opt_out_controlled_acceptance",
      rationale: "No executable behavior." } }, {
    persistControlledAcceptanceProofPosture: async (input) => {
      calls.push(input); return { written: true };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].disposition, "opted_out");
  assert.equal(calls[0].expectedSourceDigest, `sha256:${"a".repeat(64)}`);
});

test("retired or derived controlled-acceptance fields cannot be serialized", () => {
  for (const field of ["controlled_acceptance_allocation", "controlled_acceptance_state"]) {
    assert.ok(validateWorkRecord(record({ [field]: {} })).some(
      ({ path, severity }) => path === field && severity === "error"));
  }
});

test("an exemption is projected as the caller's authored, unassessed disposition", async () => {
  const bare = record();

  const rationale = "No installed provider can verify this behavior.";
  const opted = record({ proof_posture: buildControlledAcceptanceProofPosture({
    wkId: bare.id, disposition: "opted_out", rationale }) });
  const optedOut = await classifyControlledAcceptanceStateOperation({ repoRoot: "/repo",
    wkId: opted.id, record: opted }, { inspectWorkbench: async () => workbench(null, false) });
  assert.equal(optedOut.mechanically_complete, true);
  assert.equal(optedOut.disposition.classification_rationale, rationale);
  assert.equal(optedOut.disposition.rationale_provenance, "caller_authored_unassessed");
  assert.equal(controlledAcceptanceOptOutProvenance(optedOut.state),
    CONTROLLED_ACCEPTANCE_OPT_OUT_PROVENANCE);
  assert.equal(CONTROLLED_ACCEPTANCE_OPT_OUT_PROVENANCE.rationale_assessment, "not_performed");
  assert.equal(CONTROLLED_ACCEPTANCE_OPT_OUT_PROVENANCE.assessed_by, null);

  const required = record({ proof_posture: buildControlledAcceptanceProofPosture({
    wkId: bare.id, disposition: "required" }) });
  const incomplete = await classifyControlledAcceptanceStateOperation({ repoRoot: "/repo",
    wkId: required.id, record: required }, {
    inspectWorkbench: async () => workbench("sha256:generation", false) });
  assert.equal(incomplete.disposition.rationale_provenance, null);
  assert.equal(controlledAcceptanceOptOutProvenance(incomplete.state), null);

  for (const provenance of [undefined, null, "verified"]) {
    const candidate = { ...optedOut, disposition: { ...optedOut.disposition,
      ...(provenance === undefined ? {} : { rationale_provenance: provenance }) } };
    if (provenance === undefined) delete candidate.disposition.rationale_provenance;
    assert.throws(() => assertControlledAcceptanceStateProjection(candidate, opted.id),
      (error) => error.code === "controlled_acceptance_state_projection_invalid",
      JSON.stringify(provenance ?? null));
  }
});
