

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  runWorkspaceWorkRecordAdmissionRefreshRoute,
  createCompactWorkRecordEditResponse,
  createCompactContractEditResponse,
  createCompactValidateDispatchResponse
} from "../../packages/wiki-mcp/src/lib/work-record-write-route-helpers.mjs";
import { applyWorkerScopePreflightOverlay } from
  "../../packages/wiki-core/src/lib/work-record-dispatch-readiness-shape.mjs";

async function withWorkspace(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "wk1056-write-route-"));
  try {
    const workspaceRepos = { repos: new Map([["repo", dir]]), currentAlias: "repo" };
    return await run(workspaceRepos);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function refreshSelectedUnit(workspaceRepos, unit) {
  const res = await runWorkspaceWorkRecordAdmissionRefreshRoute({
    workspaceRepos,
    args: { repo: "repo", unit, verbose: true },
    toolName: "workspace_work_record_refresh_admission_metrics"
  });
  return res.structuredContent.selected_unit;
}

test("WK-1056: WK record-address validation is unchanged", async () => {
  await withWorkspace(async (workspaceRepos) => {

    assert.deepEqual(await refreshSelectedUnit(workspaceRepos, "WK-0892"), {
      kind: "work_item",
      address: "WK-0892",
      record_id: "WK-0892",
      slice_id: null
    });

    for (const bad of [
      "not-an-id", "WK-1", "WK-12345", "WK-0892#a#b",
      "WK-0892#SLICE-0001", "WK-0892#SLICE-ABC", "WK-0892#"
    ]) {
      assert.equal(
        await refreshSelectedUnit(workspaceRepos, bad),
        null,
        `expected null selected_unit for ${bad}`
      );
    }
  });
});

test("WK-1358: admission-refresh route projects canonical ordinal SLICE-### selected_unit", async () => {
  await withWorkspace(async (workspaceRepos) => {
    assert.deepEqual(await refreshSelectedUnit(workspaceRepos, "WK-0892#SLICE-001"), {
      kind: "slice",
      address: "WK-0892#SLICE-001",
      record_id: "WK-0892",
      slice_id: "SLICE-001"
    });
  });
});

test("WK-1358: admission-refresh route still accepts grandfathered semantic slice ids", async () => {
  await withWorkspace(async (workspaceRepos) => {
    assert.equal(
      (await refreshSelectedUnit(workspaceRepos, "WK-0730#core-edit")).slice_id,
      "core-edit"
    );
  });
});

test("WK-1358: admission-refresh route rejects malformed slice ids", async () => {
  await withWorkspace(async (workspaceRepos) => {
    assert.equal(await refreshSelectedUnit(workspaceRepos, "WK-0892#SLICE-1"), null);
  });
});

const STALE_CURRENT_DIGEST = "sha256:" + "a".repeat(64);
const GUARD_EXPECTED_DIGEST = "sha256:" + "b".repeat(64);
const CANONICAL_RECORD_PATH = "wiki/work-records/WK-0892.json";

function staleWriteResult({ guarded } = { guarded: false }) {
  return {
    valid: false,
    written: false,
    diagnostics: [
      {
        code: "stale_source_digest",
        severity: "error",
        message: "source digest does not match the current on-disk record",
        path: CANONICAL_RECORD_PATH
      }
    ],
    record_id: "WK-0892",
    source_digest: "sha256:" + "c".repeat(64),
    canonical_record_path: CANONICAL_RECORD_PATH,
    current_source_digest: STALE_CURRENT_DIGEST,
    ...(guarded ? { expected_source_digest: GUARD_EXPECTED_DIGEST } : {})
  };
}

function successfulWriteResult() {
  return {
    valid: true,
    written: true,
    no_op: false,
    changed_fields: ["status"],
    record_id: "WK-0892",
    source_digest: "sha256:" + "d".repeat(64),
    canonical_record_path: CANONICAL_RECORD_PATH,
    status: "active",
    diagnostics: []
  };
}

function nonStaleRefusalResult() {
  return {
    valid: true,
    written: false,
    diagnostics: [
      {
        code: "work_record_write_failed",
        severity: "error",
        message: "failed to write canonical work record JSON",
        path: CANONICAL_RECORD_PATH
      }
    ],
    record_id: "WK-0892",
    source_digest: "sha256:" + "d".repeat(64),
    canonical_record_path: CANONICAL_RECORD_PATH
  };
}

function assertStaleRetrySurfaced(response) {

  assert.equal(
    response.current_source_digest,
    "a".repeat(16),
    "stale refusal must surface the fresh current_source_digest"
  );
  assert.equal(typeof response.next_action, "string");
  assert.ok(response.next_action.length > 0, "stale refusal must carry a retry next_action");

  assert.match(response.next_action, /stale_source_digest/);
  assert.match(response.next_action, /expected_source_digest/);
}

for (const [label, compactor] of [
  ["createCompactWorkRecordEditResponse", createCompactWorkRecordEditResponse],
  ["createCompactContractEditResponse", createCompactContractEditResponse]
]) {
  test(`WK-1411 C3: ${label} surfaces current_source_digest + retry next_action on a BLIND stale refusal`, () => {
    const response = compactor("agent-chassis/agent-chassis", staleWriteResult({ guarded: false }));
    assertStaleRetrySurfaced(response);
  });

  test(`WK-1411 C3: ${label} surfaces current_source_digest + retry next_action on a GUARDED stale refusal`, () => {
    const response = compactor("agent-chassis/agent-chassis", staleWriteResult({ guarded: true }));
    assertStaleRetrySurfaced(response);

    assert.equal(response.expected_source_digest, "b".repeat(16));
  });

  test(`WK-1411 C3: ${label} does not attach a stale digest/next_action on a successful write`, () => {
    const response = compactor("agent-chassis/agent-chassis", successfulWriteResult());
    assert.equal(response.written, true);

    assert.equal(
      Object.prototype.hasOwnProperty.call(response, "current_source_digest"),
      false,
      "successful write must not carry current_source_digest"
    );
    assert.ok(!response.next_action, "successful write must not carry a stale retry next_action");
  });

  test(`WK-1411 C3: ${label} does not attach the stale retry on a non-stale refusal`, () => {
    const response = compactor("agent-chassis/agent-chassis", nonStaleRefusalResult());
    assert.equal(response.written, false);
    assert.equal(
      Object.prototype.hasOwnProperty.call(response, "current_source_digest"),
      false,
      "non-stale refusal must not gain a current_source_digest from the C3 path"
    );
    assert.ok(
      !response.next_action || !/stale_source_digest/.test(response.next_action),
      "non-stale refusal must not carry the stale retry next_action"
    );
  });
}

const BASE_GUIDANCE = "Root WK-0892 selects no base_branch; author it on the root, then dispatch.";
const BASE_SELECTION_MISSING = "scope_existence_base_selection_missing";
const DISPATCH_GUIDANCE = "Dispatch implementation worker via workspace_agent_dispatch";

function structuralReadiness(overrides = {}) {
  return {
    schema_version: "dispatch-readiness.v1",
    record_id: "WK-0892",
    unit: { kind: "slice", address: "WK-0892#SLICE-001" },
    dispatch_role: "implementation",
    dispatchable: true,
    decision_code: "dispatchable",
    reasons: [],
    ...overrides
  };
}

function notEvaluatedReport(reason) {
  return {
    schema_version: "worker-scope-preflight.v1", status: "not_evaluated", base: null,
    refusal: null, reason, evaluated: [], pending_at_launch: ["worktree_provisioning"]
  };
}

const PASSED_REPORT = Object.freeze({
  schema_version: "worker-scope-preflight.v1", status: "passed",
  base: { ref: "main", sha: "a".repeat(40), source: "configured_base" },
  refusal: null, evaluated: ["read_scope", "write_scope"], pending_at_launch: ["worktree_provisioning"]
});

function present(readiness, report, tier) {
  const overlaid = applyWorkerScopePreflightOverlay(readiness, report);
  return { overlaid, response: createCompactValidateDispatchResponse("repo", overlaid, tier) };
}

for (const tier of ["paid_cce", "free_local"]) {
  test(`WK-2669: ${tier} missing base selection is a false result with the launcher's guidance`, () => {
    const report = notEvaluatedReport({ code: BASE_SELECTION_MISSING, message: BASE_GUIDANCE });
    const before = structuredClone(report);
    const { overlaid, response } = present(structuralReadiness({ reasons: ["prior"] }), report, tier);
    assert.deepEqual(overlaid.structural_readiness, { dispatchable: true, decision_code: "dispatchable" });
    assert.deepEqual(report, before, "the launcher's report is retained unchanged");
    assert.equal(response.dispatchable, false);
    assert.equal(response.decision_code, BASE_SELECTION_MISSING);
    assert.deepEqual(response.reasons, [BASE_GUIDANCE, "prior"]);
    assert.equal(response.next_action, BASE_GUIDANCE);
    assert.doesNotMatch(response.next_action, /^Dispatch /u);
    assert.deepEqual(response.worker_scope_preflight, before);
    assert.equal(response.worker_scope_preflight.status, "not_evaluated");
    assert.deepEqual(response.worker_scope_preflight.evaluated, []);
    assert.equal(response.worker_scope_preflight.base, null);
  });

  test(`WK-2669: ${tier} the exact reason decides even without prose`, () => {
    const { overlaid, response } = present(structuralReadiness(),
      notEvaluatedReport({ code: BASE_SELECTION_MISSING, message: null }), tier);
    assert.equal(overlaid.dispatchable, false);
    assert.equal(overlaid.decision_code, BASE_SELECTION_MISSING);
    assert.deepEqual(overlaid.reasons, [], "no second diagnosis is invented");
    assert.equal(response.dispatchable, false);
    assert.notEqual(response.next_action, DISPATCH_GUIDANCE);
    assert.equal(response.next_action, tier === "free_local"
      ? "Resolve structural dispatch-readiness issues reported in reasons"
      : `Resolve blocking issue: ${BASE_SELECTION_MISSING}`);
  });

  test(`WK-2669: ${tier} unrelated not_evaluated, passed and absent preflight stay dispatchable`, () => {
    const reports = [
      notEvaluatedReport({ code: "initiative_unresolvable", message: null }),
      notEvaluatedReport({ code: "scope_existence_base_unresolved",
        message: `${BASE_SELECTION_MISSING} lookalike prose: ${BASE_GUIDANCE}` }),
      PASSED_REPORT,
      null
    ];
    for (const report of reports) {
      const { overlaid, response } = present(structuralReadiness(), report, tier);
      assert.equal(Object.hasOwn(overlaid, "structural_readiness"), false, JSON.stringify(report));
      assert.equal(response.dispatchable, true, JSON.stringify(report));
      assert.equal(response.decision_code, "dispatchable");
      assert.equal(response.next_action, DISPATCH_GUIDANCE, JSON.stringify(report));
    }
  });

  test(`WK-2669: ${tier} higher-priority refusal guidance outranks missing base selection`, () => {
    const { overlaid, response } = present(structuralReadiness(
      { dispatchable: false, decision_code: "record_validation_failure", reasons: ["bad"] }),
    notEvaluatedReport({ code: BASE_SELECTION_MISSING, message: BASE_GUIDANCE }), tier);
    assert.equal(Object.hasOwn(overlaid, "structural_readiness"), false);
    assert.deepEqual(overlaid.reasons, ["bad"]);
    assert.equal(response.dispatchable, false);
    assert.equal(response.decision_code, "record_validation_failure");
    assert.equal(response.next_action,
      "Fix work-record validation errors reported in reasons and re-validate");
  });

  test(`WK-2669: ${tier} an existing structural result is preserved`, () => {
    const structural = { dispatchable: true, decision_code: "dispatchable_with_accepted_escalation" };
    const { overlaid } = present(structuralReadiness({ structural_readiness: structural }),
      notEvaluatedReport({ code: BASE_SELECTION_MISSING, message: BASE_GUIDANCE }), tier);
    assert.equal(overlaid.structural_readiness, structural);
    assert.equal(overlaid.decision_code, BASE_SELECTION_MISSING);
  });
}
