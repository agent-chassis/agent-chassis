import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { z } from "zod";

import { registerDispatchTools } from "./dispatch-tools.mjs";
import { createWorkspaceAgentDispatchBackend } from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";

import { runPostWorkerSliceLifecycle } from "./dispatch-run-monitor-routes.mjs";
import {
  createDispatchToolRegistry,
  createResumableLifecycleHarness,
  parseStructuredTextResponse,
  RETIRED_POST_WORKER_REVIEW_SEAMS
} from "./dispatch-tools-test-helpers.mjs";
import {
  CLOSED_LIFECYCLE_FAILURE_CODES,
  isClosedLifecycleFailure
} from "./dispatch-lifecycle-failure-projection.mjs";

const WORKSPACE = Object.freeze({ repo: "agent-chassis", dir: "/home/user/agent-chassis" });
const DECLARED_TERMINAL_UNIT = Object.freeze({
  record_id: "WK-1537",
  initiative: "IN-0021",
  slice_id: "SLICE-099",
  subject: "WK-1537#SLICE-099"
});

test("review findings remain evidence only and cause no automatic slice lifecycle mutation", async () => {
  let lifecycleCalls = 0;
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({
        accepted: true,
        run_id: "run-reviewer",
        monitor_handle: "wkmh_reviewer",
        role: "reviewer",
        subject: "WK-1537#SLICE-003",
        status: "succeeded",
        terminal: true,
        started_at: "2026-07-12T00:02:00.000Z",
        updated_at: "2026-07-12T00:03:00.000Z",
        review_result: {
          review_outcome: "changes_requested",
          blocking_finding_count: 1,
          medium_finding_count: 0,
          clean_review: false
        }
      }),
      runPostWorkerSliceLifecycle: async () => { lifecycleCalls += 1; }
    }
  });

  const result = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    subject: "WK-1537#SLICE-003"
  }));
  assert.equal(result.review_result.review_outcome, "changes_requested");
  assert.equal("slice_lifecycle" in result, false);
  assert.equal(lifecycleCalls, 0, "findings do not trigger integration, cleanup, revert, or reissue");
});

test("WK-1555#SLICE-033 the post-worker lifecycle delegates integration to the host adapter and consumes its result", async () => {
  const harness = createResumableLifecycleHarness();
  const adapterCalls = [];
  const delegatedIntegration = { ...harness.integrationResult, tuple: {
    assigned_unit: harness.status.subject,
    launch_ref: harness.status.monitor_handle,
    run_id: harness.status.run_id,
    retry_id: 0
  } };
  const hostSliceIntegrationAdapter = async (request) => {
    adapterCalls.push(request);
    return { accepted: true, integration: delegatedIntegration };
  };
  const finalized = await runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
    status: { ...harness.status },
    deps: { ...harness.deps, hostSliceIntegrationAdapter }
  });

  assert.equal(harness.counts().integrationCalls, 0);

  assert.deepEqual(adapterCalls, [{
    assigned_unit: harness.status.subject,
    launch_ref: harness.status.monitor_handle,
    run_id: harness.status.run_id,
    retry_id: 0
  }]);
  assert.equal(finalized.phase, "finalized");
  assert.equal(finalized.integrated, true);
  assert.equal(finalized.wk_transitioned_to_review, true);
  assert.deepEqual(finalized.integration, delegatedIntegration);
  assert.equal(Object.hasOwn(finalized, "reviewer_dispatch"), false);
  assert.equal(Object.hasOwn(finalized, "slice_review"), false);
  assert.equal(harness.counts().reviewSeamCalls, 0);
});

test("WK-1555#SLICE-033 a host-delegated integration refusal fails the lifecycle closed", async () => {
  const harness = createResumableLifecycleHarness();
  const hostSliceIntegrationAdapter = async () => ({
    accepted: false,
    refusal: { code: "operator_recovery_needed", reason: "trusted_operation_refused", detail: null }
  });
  await assert.rejects(
    runPostWorkerSliceLifecycle({
      workspace: WORKSPACE,
      status: { ...harness.status },
      deps: { ...harness.deps, hostSliceIntegrationAdapter }
    }),
    (error) => {

      assert.equal(isClosedLifecycleFailure(error), true);
      assert.equal(error.code, CLOSED_LIFECYCLE_FAILURE_CODES.COMMITTED_SLICE_INTEGRATION_FAILED);
      assert.equal(error.message, "post-worker committed slice integration failed");
      assert.deepEqual({ ...error.failure_cause }, {
        kind: "integration_refusal", reason: null,
        diagnostic_code: null, diagnostic_kind: null, public_blocker_code: null
      });
      const thrown = error.evidence.thrown.value;
      assert.equal(thrown.message,
        "workspace-agent post-worker lifecycle: host-delegated slice-to-WK integration failed");
      assert.equal(thrown.properties.code, "agent_launch.slice_integration.git_failed.v1");
      assert.deepEqual(thrown.properties.detail.integration_refusal,
        { code: "operator_recovery_needed", reason: "trusted_operation_refused", detail: null });
      assert.equal(error.detail.evidence, error.evidence);
      assert.match(error.stack, /Caused by: SliceIntegrationError: workspace-agent post-worker lifecycle/u);
      return true;
    }
  );
  assert.deepEqual(harness.counts(), { integrationCalls: 0, declaredUnitCalls: 0, reviewSeamCalls: 0 });
});

test("WK-1587 a non-final slice integration leaves the WK dispatchable and consults no terminal review unit", async () => {
  const harness = createResumableLifecycleHarness({ declaredTerminalReviewUnit: DECLARED_TERMINAL_UNIT });

  const nonFinalIntegration = { ...harness.integrationResult, review_target: null };
  let integrationCalls = 0;
  let prepareCalls = 0;
  const finalized = await runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
    status: { ...harness.status, run_id: "run-worker-nonfinal" },
    deps: {
      ...harness.deps,
      prepareTerminalCandidate: async () => { prepareCalls += 1; },
      hostSliceIntegrationAdapter: async () => {
        integrationCalls += 1;
        return { accepted: true, integration: nonFinalIntegration };
      }
    }
  });
  assert.equal(integrationCalls, 1);
  assert.equal(finalized.phase, "finalized");
  assert.equal(finalized.integrated, true);
  assert.equal(finalized.wk_transitioned_to_review, false);
  assert.deepEqual(finalized.integration, nonFinalIntegration);
  assert.equal(Object.hasOwn(finalized, "terminal_candidate"), false);
  assert.equal(Object.hasOwn(finalized, "reviewer_dispatch"), false);
  assert.equal(prepareCalls, 0);
  assert.deepEqual(harness.counts(), { integrationCalls: 0, declaredUnitCalls: 0, reviewSeamCalls: 0 });
});

test("managed lifecycle refuses a committed delivery when the writable host integration adapter is absent", async () => {
  const harness = createResumableLifecycleHarness();
  await assert.rejects(
    runPostWorkerSliceLifecycle({
      workspace: WORKSPACE,
      status: { ...harness.status },
      deps: { ...harness.deps, hostSliceIntegrationAdapter: undefined }
    }),
    /requires the writable host slice integration adapter/u
  );
  assert.deepEqual(harness.counts(), { integrationCalls: 0, declaredUnitCalls: 0, reviewSeamCalls: 0 });
});

test("a final integration whose record declares no terminal review unit prepares no candidate", async () => {
  const harness = createResumableLifecycleHarness({ declaredTerminalReviewUnit: null });
  const resolverInputs = [];
  let prepareCalls = 0;
  const finalized = await runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
    status: { ...harness.status },
    deps: {
      ...harness.deps,
      resolveDeclaredTerminalReviewUnit: (input) => {
        resolverInputs.push(input);
        return harness.deps.resolveDeclaredTerminalReviewUnit(input);
      },
      prepareTerminalCandidate: async () => { prepareCalls += 1; }
    }
  });
  assert.deepEqual(resolverInputs, [{ mainRepo: WORKSPACE.dir, wkId: "WK-1537" }]);
  assert.equal(prepareCalls, 0);
  assert.equal(finalized.phase, "finalized");
  assert.equal(finalized.wk_transitioned_to_review, true);
  assert.equal(Object.hasOwn(finalized, "terminal_candidate"), false);
  assert.equal(Object.hasOwn(finalized, "terminal_candidate_validations"), false);
  assert.deepEqual(harness.counts(), { integrationCalls: 1, declaredUnitCalls: 1, reviewSeamCalls: 0 });
});

test("a final integration without a candidate capability never resolves the declared unit", async () => {
  const harness = createResumableLifecycleHarness({ declaredTerminalReviewUnit: DECLARED_TERMINAL_UNIT });
  const finalized = await harness.invoke({ workspace: WORKSPACE, status: { ...harness.status } });
  assert.equal(finalized.phase, "finalized");
  assert.equal(finalized.wk_transitioned_to_review, true);
  assert.equal(Object.hasOwn(finalized, "terminal_candidate"), false);
  assert.deepEqual(harness.counts(), { integrationCalls: 1, declaredUnitCalls: 0, reviewSeamCalls: 0 });
});

test("a declared terminal review unit for another WK identity refuses before candidate preparation", async () => {
  for (const unit of [
    { ...DECLARED_TERMINAL_UNIT, record_id: "WK-9999" },
    { ...DECLARED_TERMINAL_UNIT, initiative: "IN-9999" }
  ]) {
    const harness = createResumableLifecycleHarness({ declaredTerminalReviewUnit: unit });
    let prepareCalls = 0;
    harness.deps.prepareTerminalCandidate = async () => { prepareCalls += 1; };
    await assert.rejects(
      harness.invoke({ workspace: WORKSPACE, status: { ...harness.status } }),
      /declared terminal review unit does not match the exact launcher WK identity/u
    );
    assert.equal(prepareCalls, 0);
    assert.deepEqual(harness.counts(), { integrationCalls: 1, declaredUnitCalls: 1, reviewSeamCalls: 0 });
  }
});

test("a declared terminal review unit prepares the candidate from the exact integration and fails closed under its own seam", async () => {
  const harness = createResumableLifecycleHarness({ declaredTerminalReviewUnit: DECLARED_TERMINAL_UNIT });
  const prepared = [];
  harness.deps.prepareTerminalCandidate = async (input) => {
    prepared.push(input);
    throw new Error("injected candidate preparation failure");
  };
  await assert.rejects(
    harness.invoke({ workspace: WORKSPACE, status: { ...harness.status } }),
    (error) => {
      assert.equal(isClosedLifecycleFailure(error), true);
      assert.equal(error.code, CLOSED_LIFECYCLE_FAILURE_CODES.TERMINAL_CANDIDATE_PREPARATION_FAILED);
      assert.equal(error.message.includes("injected candidate preparation failure"), false);
      return true;
    }
  );
  assert.equal(prepared.length, 1);
  assert.deepEqual(prepared[0].integration, harness.integrationResult);
  assert.equal(prepared[0].reviewUnit, DECLARED_TERMINAL_UNIT);
  assert.equal(prepared[0].initiative, "IN-0021");
  assert.equal(prepared[0].wkId, "WK-1537");
  assert.equal(prepared[0].wkRef, harness.wkRef);
  assert.equal(prepared[0].baseSha, "a".repeat(40));
  assert.equal(prepared[0].baseRef, "main");
  assert.equal(typeof prepared[0].authenticateAuthoredState, "function");
  assert.deepEqual(harness.counts(), { integrationCalls: 1, declaredUnitCalls: 1, reviewSeamCalls: 0 });
});

test("a prepared terminal candidate without a binding refuses with missing_binding", async () => {
  const harness = createResumableLifecycleHarness({ declaredTerminalReviewUnit: DECLARED_TERMINAL_UNIT });
  harness.deps.prepareTerminalCandidate = async () => ({ binding: null });
  await assert.rejects(
    harness.invoke({ workspace: WORKSPACE, status: { ...harness.status } }),
    { code: "agent_launch.terminal_candidate.missing_binding.v1" }
  );
});

function restartReplayLifecycleArgs(markerOverrides = {}) {
  const commit = "b".repeat(40);
  const base = "a".repeat(40);
  const wkRef = "refs/heads/wk/IN-0021/WK-1537";
  const sliceRef = "refs/heads/slice/IN-0021/WK-1537/SLICE-001";

  const sliceBinding = {
    launch_ref: "wkmh_worker",
    run_id: "run-worker.slice",
    unit_address: "IN-0021/WK-1537/SLICE-001",
    output_branch: "slice/IN-0021/WK-1537/SLICE-001",
    worktree_path: "/tmp/slice-IN-0021-WK-1537-SLICE-001",
    base_sha: base,
    retry_id: 0
  };
  const wkBinding = {
    launch_ref: "wkmh_worker",
    run_id: "run-worker.wk",
    retry_id: 0,
    unit_address: "IN-0021/WK-1537",
    output_branch: "wk/IN-0021/WK-1537",
    worktree_path: "/tmp/wk-IN-0021-WK-1537",
    base_sha: base
  };
  const recoveredMarker = {
    integrated: true,
    slice_ref: sliceRef,
    slice_sha: commit,
    wk_ref: wkRef,
    wk_sha: commit,
    review_target: null,
    integrated_state: "final",
    ...markerOverrides
  };
  const counters = { adapter: 0, declared: 0, prepare: 0, reviewSeams: 0 };
  const deps = {
    ...Object.fromEntries(RETIRED_POST_WORKER_REVIEW_SEAMS.map((name) => [name, () => {
      counters.reviewSeams += 1;
      throw new Error(`retired seam ${name} called`);
    }])),
    resolveManagedRunBinding: () => ({
      record_id: "WK-1537",
      slice_id: "SLICE-001",
      slice_binding: sliceBinding,
      wk_binding: wkBinding,
      validation_worktree_path: wkBinding.worktree_path
    }),
    reconcileIntegratedSliceRecord: () => ({ ...recoveredMarker }),
    resolveCommittedSliceIntegrationContinuation: () => null,
    hostSliceIntegrationAdapter: async () => {
      counters.adapter += 1;
      return { accepted: true, integration: { ...recoveredMarker } };
    },
    resolveDeclaredTerminalReviewUnit: () => {
      counters.declared += 1;
      return DECLARED_TERMINAL_UNIT;
    },
    prepareTerminalCandidate: async () => {
      counters.prepare += 1;
      throw new Error("a recovered replay reconstructs no candidate");
    },
    runGit: () => ({ ok: true, stdout: `${commit}\n` })
  };
  return {
    counters,
    args: {
      workspace: WORKSPACE,
      status: {
        run_id: "run-worker",
        monitor_handle: "wkmh_worker",
        role: "worker",
        subject: "WK-1537#SLICE-001",
        status: "succeeded",
        terminal: true
      },
      deps
    }
  };
}

test("an authenticated final restart replay finalizes as the WK handoff without constructing a candidate", async () => {
  const { args, counters } = restartReplayLifecycleArgs();
  const result = await runPostWorkerSliceLifecycle(args);
  assert.equal(result.phase, "finalized");
  assert.equal(result.integrated, true);
  assert.equal(result.wk_transitioned_to_review, true);
  assert.equal(result.integration.recovered, true);
  assert.equal(result.integration.integrated_state, "final");
  assert.equal(result.integration.review_target, null);
  assert.equal(Object.hasOwn(result, "terminal_candidate"), false);
  assert.equal(Object.hasOwn(result, "reviewer_dispatch"), false);
  assert.deepEqual(counters, { adapter: 1, declared: 0, prepare: 0, reviewSeams: 0 });
});

test("an authenticated non-final exact-tip restart replay finalizes without a WK review handoff", async () => {
  const { args, counters } = restartReplayLifecycleArgs({ integrated_state: "non_final" });
  const result = await runPostWorkerSliceLifecycle(args);
  assert.equal(result.phase, "finalized");
  assert.equal(result.integrated, true);
  assert.equal(result.wk_transitioned_to_review, false);
  assert.equal(result.integration.integrated_state, "non_final");
  assert.deepEqual(counters, { adapter: 1, declared: 0, prepare: 0, reviewSeams: 0 });
});

test("a restart replay whose integrated_state cannot be authenticated refuses rather than guessing", async () => {
  const reviewTarget = {
    ref: "refs/heads/wk/IN-0021/WK-1537",
    sha: "b".repeat(40),
    diff_base_sha: "a".repeat(40),
    diff_head_sha: "b".repeat(40),
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  };
  for (const [overrides, reason] of [
    [{ integrated_state: undefined }, "absent_integrated_state"],
    [{ integrated_state: "finalish" }, "unrecognized_integrated_state"],
    [{ integrated_state: "final", wk_sha: "c".repeat(40) }, "final_without_current_wk_tip_ownership"],
    [{ integrated_state: "non_final", review_target: reviewTarget }, "non_final_with_whole_wk_review_target"]
  ]) {

    const { args, counters } = restartReplayLifecycleArgs(overrides);
    await assert.rejects(
      runPostWorkerSliceLifecycle(args),
      (error) => {
        assert.equal(error.code, "agent_launch.slice_lifecycle.recovered_integrated_state_invalid.v1", reason);
        assert.equal(error.detail.reason, reason);
        return true;
      },
      reason
    );
    assert.deepEqual(counters, { adapter: 1, declared: 0, prepare: 0, reviewSeams: 0 }, reason);
  }
});

test("committed-slice recovery is disjoint from worker liveness and performs no transition", async () => {
  const harness = createResumableLifecycleHarness();
  let livenessConsults = 0;

  for (const deps of [
    {
      ...harness.deps,
      recoveryOnly: true,
      resolveManagedWorkerProvenDeath: () => {
        livenessConsults += 1;
        throw new Error("committed recovery must not consult worker liveness");
      }
    },
    { ...harness.deps, recoveryOnly: true }
  ]) {
    const recovered = await runPostWorkerSliceLifecycle({
      workspace: WORKSPACE,
      status: { ...harness.status },
      deps
    });
    assert.equal(recovered, null);
  }
  assert.equal(livenessConsults, 0);
  assert.deepEqual(harness.counts(), { integrationCalls: 0, declaredUnitCalls: 0, reviewSeamCalls: 0 });
});

function registerStandaloneRedteamDispatchFixture(t, { slice, slices, recordId = "WK-9733", subjectSliceId = "SLICE-001" } = {}) {
  const repo = mkdtempSync(path.join(tmpdir(), "wk1725-registered-"));
  const worktrees = mkdtempSync(path.join(tmpdir(), "wk1725-registered-wt-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  t.after(() => rmSync(worktrees, { recursive: true, force: true }));
  mkdirSync(path.join(repo, "wiki", "work-records"), { recursive: true });
  const subject = `${recordId}#${subjectSliceId}`;
  writeFileSync(path.join(repo, "wiki", "work-records", `${recordId}.json`), JSON.stringify({
    id: recordId,
    initiative: "IN-0030",
    status: "todo",
    acceptance: {
      criteria: ["Adversarially review the standalone unit."],
      validation: ["node --test packages/wiki-mcp/src/lib/dispatch-tools-slice-lifecycle.test.mjs"]
    },
    slices: slices ?? [slice ?? {
      id: "SLICE-001",
      title: "Standalone findings-only redteam",
      work_kind: "redteam",
      status: "todo",
      write_scope: [],
      dispatch_intent: { intended_agent_role: "redteam", target_unit: "slice" },
      acceptance: { criteria: ["Report adversarial findings; modify nothing."] }
    }]
  }));

  writeFileSync(path.join(repo, "agent-launch.toml"), '[roles.redteam]\nmodel = "gpt-5.6-terra"\n');

  for (const args of [
    ["init", "-q", "-b", "main"],
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "add", "."],
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "fixture"]
  ]) {
    const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }

  const executorInputs = [];
  let recoveryCalls = 0;
  const backend = createWorkspaceAgentDispatchBackend({
    launchExecutor: async (input) => {
      executorInputs.push({ role: input.role, subject: input.subject, workspace_dir: input.workspace_dir });
      return { accepted: true, status: "launching" };
    },
    worktreeProvisioning: { mainRepo: repo, worktreeRoot: worktrees },

    recoverTerminalCandidate: async () => { recoveryCalls += 1; return null; }
  });

  const tools = new Map();
  registerDispatchTools({
    registerTool: (name, config, handler) => tools.set(name, { config, handler }),
    registeredToolNames: new Set(["workspace_agent_dispatch"]),
    workspaceRepos: [{ repo: "agent-chassis", dir: repo }],
    z,
    jsonContent: (value) => value,
    errorContent: (value) => value,
    resolveWorkspaceRepo: () => ({ repo: "agent-chassis", dir: repo }),
    validateDispatch: async () => ({
      schema_version: "dispatch-readiness.v1",
      record_id: recordId,
      unit: { kind: "slice", address: subject, record_id: recordId, slice_id: "SLICE-001" },
      dispatch_role: "read_only",
      dispatchable: true,
      decision_code: "dispatchable",
      reasons: [],
      recovery: { graph_impact: "not_required", admission_metrics: "fresh", target_resolution: "fresh" },
      state: { graph_state: {}, graph_auto_recoverable: false },
      validation_hints: []
    }),
    dispatchBackend: backend,
    dispatchSessionIdentity: "session-wk1725-registered"
  });

  return {
    repo,
    subject,
    executorInputs,

    assertPrivateReviewWorkspace(workspaceDir) {
      assert.notEqual(workspaceDir, repo);
      assert.ok(
        workspaceDir.startsWith(path.join(worktrees, ".immutable-candidates") + path.sep),
        workspaceDir
      );
    },
    recoveryCalls: () => recoveryCalls,
    dispatch: (role = "redteam") =>
      tools.get("workspace_agent_dispatch").handler({ role, subject, app: "codex" })
  };
}

test("WK-1725#SLICE-001 the registered dispatch handler launches a standalone redteam through the generic route with zero terminal recovery", async (t) => {
  const fixture = registerStandaloneRedteamDispatchFixture(t);
  const result = await fixture.dispatch("redteam");
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.role, "redteam");
  assert.equal(result.subject, fixture.subject);
  assert.equal(fixture.executorInputs.length, 1, "the registered handler reaches the family executor exactly once");
  assert.equal(fixture.executorInputs[0].role, "redteam");
  fixture.assertPrivateReviewWorkspace(fixture.executorInputs[0].workspace_dir);
  assert.equal(fixture.recoveryCalls(), 0, "a registered standalone redteam must never invoke terminal-candidate recovery");
});

test("WK-1725#SLICE-001 registered dispatch readiness and backend admission agree: repeated standalone redteam attempts are never singleton-blocked", async (t) => {
  const fixture = registerStandaloneRedteamDispatchFixture(t);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await fixture.dispatch("redteam");
    assert.equal(result.accepted, true, `attempt ${attempt}: ${JSON.stringify(result)}`);
  }
  assert.equal(fixture.executorInputs.length, 3, "every registered standalone redteam attempt reaches the executor");
  assert.equal(fixture.recoveryCalls(), 0);
});

test("WK-1725#SLICE-001 the registered seam routes a standalone redteam generically even when a terminal unit exists elsewhere", async (t) => {

  const fixture = registerStandaloneRedteamDispatchFixture(t, {
    recordId: "WK-9744",
    subjectSliceId: "SLICE-001",
    slices: [
      {
        id: "SLICE-001",
        title: "Standalone findings-only redteam",
        work_kind: "redteam",
        status: "todo",
        write_scope: [],
        dispatch_intent: { intended_agent_role: "redteam", target_unit: "slice" },
        acceptance: { criteria: ["Report adversarial findings; modify nothing."] }
      },
      {
        id: "SLICE-050",
        title: "implementation",
        work_kind: "implementation",
        status: "review",
        write_scope: ["feature.txt"]
      },
      {
        id: "SLICE-099",
        title: "Terminal whole-WK review",
        work_kind: "review",
        review_purpose: "terminal_whole_wk",
        status: "todo",
        write_scope: [],
        dispatch_intent: { intended_agent_role: "reviewer", target_unit: "slice" },
        acceptance: { criteria: ["Findings-only review of C against L."] }
      }
    ]
  });
  const result = await fixture.dispatch("redteam");
  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.role, "redteam");
  assert.equal(result.subject, fixture.subject);
  assert.equal(fixture.executorInputs.length, 1, "the standalone redteam reaches the family executor exactly once");
  fixture.assertPrivateReviewWorkspace(fixture.executorInputs[0].workspace_dir);
  assert.equal(
    fixture.recoveryCalls(),
    0,
    "a terminal unit elsewhere must not drag the registered standalone redteam into terminal recovery"
  );
});
