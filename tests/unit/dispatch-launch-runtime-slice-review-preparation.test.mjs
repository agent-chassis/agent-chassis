import test from "node:test";
import assert from "node:assert/strict";

import {
  SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION,
  SLICE_REVIEW_SURFACE_PREPARATION_VERIFIED_PARTS
} from "../../packages/agent-launch-cli/src/lib/trusted-operation-contracts.mjs";
import {
  createDirectSliceReviewPreparationAdapter,
  validateSliceReviewPreparationResult
} from "../../packages/wiki-mcp/src/lib/dispatch-launch-runtime.mjs";
import {
  createDispatchRunLifecycle
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle.mjs";
import {
  ATTEMPT_LINEAGE_RESOLUTION_STATES,
  buildAttemptLineageResolutionProjection
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle-settlement.mjs";

const MAIN_REPO = "/launcher/owned/main-repo";

function replacementProjection({
  state = ATTEMPT_LINEAGE_RESOLUTION_STATES.SELECTED,
  conflict_class = "none",
  next_action = "poll_selected_attempt"
} = {}) {
  return buildAttemptLineageResolutionProjection({
    state,
    prior_run_id: "wkdb_prior",
    replacement_run_id: "wkdb_replacement",
    monitor_handle: "wkmh_replacement",
    prior_mode: "runtime_failure",
    attempted_mode: null,
    conflict_class,
    next_action
  });
}

function replacementLifecycle(executor, {
  captureSliceReviewTerminalResult = null,
  runId = "wkdb_replacement",
  monitorHandle = "wkmh_replacement"
} = {}) {
  return createDispatchRunLifecycle({
    executors: { codex: executor },
    executorRegistryEntries: { codex: executor },
    familyAwareWiring: true,
    runs: new Map(),
    clock: () => 1_700_000_000_000,
    sleep: async () => {},
    monotonicNow: () => 0,
    runIdFactory: () => runId,
    monitorHandleFactory: () => monitorHandle,
    captureSliceReviewTerminalResult
  });
}

const REPLACEMENT_LAUNCH = Object.freeze({
  caller_session_id: "session-wk2256",
  role: "reviewer",
  app: "codex",
  subject: "WK-2256#SLICE-004",
  workspace_alias: "default",
  workspace_dir: MAIN_REPO,
  config_root_dir: process.cwd(),
  trusted_frozen_review_contract: Object.freeze({ review_subject: "WK-2256#SLICE-004" })
});

test("WK-2256 resumes the launcher-selected lineage with actionable run and monitor identities", async () => {
  let executorCalls = 0;
  const lifecycle = replacementLifecycle(async () => {
    executorCalls += 1;
    return { accepted: true, status: "launching" };
  });
  const launch = await lifecycle.startLaunch({
    ...REPLACEMENT_LAUNCH,
    bindReviewerAttemptLineage: async () => ({
      ok: true,
      kind: "resume",
      projection: replacementProjection({ next_action: "consume_selected_result" }),
      status: "succeeded",
      terminal: true
    })
  });
  assert.equal(launch.accepted, true);
  assert.equal(launch.resumed, true);
  assert.equal(launch.run_id, "wkdb_replacement");
  assert.equal(launch.monitor_handle, "wkmh_replacement");
  assert.equal(launch.attempt_lineage_resolution.next_action, "consume_selected_result");
  assert.equal(executorCalls, 0, "resuming an existing lineage never spawns another reviewer");
});

test("WK-2256 pre-spawn validation refusal settles the elected lineage and authorizes no spawn", async () => {
  let executorCalls = 0;
  let settlements = 0;
  const lifecycle = replacementLifecycle(async () => {
    executorCalls += 1;
    return { accepted: true, status: "launching" };
  });
  const launch = await lifecycle.startLaunch({
    ...REPLACEMENT_LAUNCH,
    readiness: {
      reviewer_validation_evidence: [{}],
      frozen_terminal_candidate_review_target: { candidate_sha: "a", base_sha: "b" }
    },
    bindReviewerAttemptLineage: async () => ({
      ok: true,
      kind: "elected",
      projection: replacementProjection(),
      reassess: async () => ({ ok: true }),
      settleBeforeSpawn: async () => { settlements += 1; }
    })
  });
  assert.equal(launch.accepted, false);
  assert.equal(launch.refusal.reason, "reviewer_validation_evidence_invalid");
  assert.equal(settlements, 1);
  assert.equal(executorCalls, 0);
});

test("WK-2256 pre-spawn settlement refusal retains one actionable no-spawn lineage", async () => {
  let executorCalls = 0;
  const lifecycle = replacementLifecycle(async () => {
    executorCalls += 1;
    return { accepted: true, status: "launching" };
  });
  const launch = await lifecycle.startLaunch({
    ...REPLACEMENT_LAUNCH,
    readiness: {
      reviewer_validation_evidence: [{}],
      frozen_terminal_candidate_review_target: { candidate_sha: "a", base_sha: "b" }
    },
    bindReviewerAttemptLineage: async () => ({
      ok: true,
      kind: "elected",
      projection: replacementProjection(),
      reassess: async () => ({ ok: false, conflict_class: "stale_contract_generation" }),
      settleBeforeSpawn: async () => {
        const error = new Error("fault:generation-reassessment");
        error.code = "stale_contract_generation";
        throw error;
      }
    })
  });
  assert.equal(launch.accepted, true);
  assert.equal(launch.run_id, "wkdb_replacement");
  assert.equal(launch.monitor_handle, "wkmh_replacement");
  assert.equal(launch.status, "failed");
  assert.equal(launch.terminal, true);
  assert.equal(launch.attempt_lineage_resolution.conflict_class, "stale_contract_generation");
  assert.equal(launch.attempt_lineage_resolution.next_action,
    "retry_generation_tip_reassessment");
  assert.equal(executorCalls, 0);
});

test("WK-2256 executor uncertainty retains one elected attempt for same-handle recovery", async () => {
  let settlements = 0;
  const lifecycle = replacementLifecycle(async () => {
    throw new Error("fault:executor-spawn-bind-uncertain");
  });
  const launch = await lifecycle.startLaunch({
    ...REPLACEMENT_LAUNCH,
    bindReviewerAttemptLineage: async () => ({
      ok: true,
      kind: "elected",
      projection: replacementProjection(),
      reassess: async () => ({ ok: true }),
      settleBeforeSpawn: async () => { settlements += 1; }
    })
  });
  assert.equal(launch.accepted, true);
  assert.equal(launch.run_id, "wkdb_replacement");
  assert.equal(launch.monitor_handle, "wkmh_replacement");
  assert.equal(launch.attempt_lineage_resolution.conflict_class,
    "executor_spawn_bind_uncertain");
  assert.equal(launch.attempt_lineage_resolution.next_action, "poll_selected_attempt");
  assert.equal(settlements, 0, "post-spawn uncertainty must not falsely terminalize the selected lineage");
  const status = await lifecycle.getRunStatus({
    caller_session_id: REPLACEMENT_LAUNCH.caller_session_id,
    monitor_handle: launch.monitor_handle,
    subject: REPLACEMENT_LAUNCH.subject
  });
  assert.equal(status.run_id, launch.run_id);
  assert.equal(status.status, "launching");
  assert.equal(status.attempt_lineage_resolution.conflict_class,
    "executor_spawn_bind_uncertain");
});

test("WK-2304 terminal capture is the single owner of projection, reassessment, and settlement", async () => {
  let captureCalls = 0;
  let reassessCalls = 0;
  const lifecycle = replacementLifecycle(async () => ({
    accepted: true,
    status: "succeeded",
    final_result: { kind: "missing_result" }
  }), {
    captureSliceReviewTerminalResult: async ({ reassess }) => {
      captureCalls += 1;
      const applicability = await reassess();
      if (applicability.ok !== true) {
        throw new Error("fault:authority-reassessment");
      }
    }
  });
  const launch = await lifecycle.startLaunch({
    ...REPLACEMENT_LAUNCH,
    bindReviewerAttemptLineage: async () => ({
      ok: true,
      kind: "elected",
      projection: replacementProjection(),
      reassess: async () => {
        reassessCalls += 1;
        return reassessCalls === 1
          ? { ok: false, conflict_class: "stale_contract_generation" }
          : { ok: true };
      },
      settleBeforeSpawn: async () => {}
    })
  });
  assert.equal(launch.accepted, true);
  assert.equal(launch.attempt_lineage_resolution.state, "operator_recovery_needed");
  assert.equal(launch.attempt_lineage_resolution.conflict_class,
    "selected_lineage_settlement_failed");
  assert.equal(captureCalls, 1,
    "the terminal transaction owner is entered before reassessment can refuse");
  assert.equal(reassessCalls, 1);

  const firstRetry = await lifecycle.getRunStatus({
    caller_session_id: REPLACEMENT_LAUNCH.caller_session_id,
    monitor_handle: launch.monitor_handle,
    subject: REPLACEMENT_LAUNCH.subject
  });
  assert.equal(firstRetry.attempt_lineage_resolution.state, "selected");
  assert.equal(firstRetry.attempt_lineage_resolution.conflict_class, "none");
  assert.equal(captureCalls, 2);
  assert.equal(reassessCalls, 2);
  assert.equal(firstRetry.attempt_lineage_resolution.replacement_run_id, launch.run_id);
});

const REQUEST = Object.freeze({
  assigned_unit: "WK-1687#SLICE-001",
  launch_ref: "refs/agent-launch/wk-1687/slice-001",
  run_id: "wkdb_937cf33a3adceda6",
  retry_id: 0
});

function canonicalPreparation(overrides = {}) {
  return {
    schema_version: SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION,
    assigned_unit: REQUEST.assigned_unit,
    launch_ref: REQUEST.launch_ref,
    run_id: REQUEST.run_id,
    retry_id: REQUEST.retry_id,
    worktree_identity_digest: "sha256:9f2b1c",
    worktree_path: "/launcher/owned/worktrees/wk-1687-slice-001",
    slice_ref: "refs/agent-launch/wk-1687/slice-001",
    base_sha: "1111111111111111111111111111111111111111",
    reviewed_sha: "a450802df874c122eed960867aaafa3dcd533710",
    reviewed_tree: "2222222222222222222222222222222222222222",
    verified_parts: [...SLICE_REVIEW_SURFACE_PREPARATION_VERIFIED_PARTS],
    ...overrides
  };
}

function adapterReturning(preparation, { onCall } = {}) {
  return createDirectSliceReviewPreparationAdapter(MAIN_REPO, {
    prepareSurface: async (args) => {
      if (onCall) {
        onCall(args);
      }
      return preparation;
    }
  });
}

test("WK-1688 adapter accepts the canonical slice-review-surface-preparation.v1 result", async () => {

  const preparation = canonicalPreparation();
  assert.ok(
    !("prepared" in preparation),
    "the canonical producer result must carry no prepared field"
  );

  const seenArgs = [];
  const adapter = adapterReturning(preparation, { onCall: (args) => seenArgs.push(args) });
  const result = await adapter({ ...REQUEST });

  assert.deepEqual(result, { accepted: true, preparation });

  assert.deepEqual(seenArgs, [{
    mainRepo: MAIN_REPO,
    assignedUnit: REQUEST.assigned_unit,
    launchRef: REQUEST.launch_ref,
    runId: REQUEST.run_id,
    retryId: REQUEST.retry_id
  }]);
});

test("WK-1688 adapter refuses null and malformed preparation results", async () => {
  for (const malformed of [null, undefined, "prepared", 7, true, [], []]) {
    const adapter = adapterReturning(malformed);
    await assert.rejects(
      adapter({ ...REQUEST }),
      /direct slice-review preparation returned an invalid trusted result/u,
      `malformed result ${JSON.stringify(malformed) ?? String(malformed)} must be refused`
    );
  }
});

test("WK-1688 adapter refuses a wrong or absent schema version", async () => {
  const wrongVersions = [
    "slice-review-surface-preparation.v2",
    "worktree-identity-binding.v2",
    "",
    undefined
  ];
  for (const schema_version of wrongVersions) {
    const adapter = adapterReturning(canonicalPreparation({ schema_version }));
    await assert.rejects(
      adapter({ ...REQUEST }),
      /direct slice-review preparation returned an invalid trusted result/u,
      `schema_version ${String(schema_version)} must be refused`
    );
  }
});

test("WK-1688 adapter refuses every exact-tuple mismatch", async () => {
  const mismatches = [
    { assigned_unit: "WK-1687#SLICE-002" },
    { launch_ref: "refs/agent-launch/wk-1687/slice-002" },
    { run_id: "wkdb_0000000000000000" },
    { retry_id: 1 },

    { assigned_unit: undefined },
    { launch_ref: undefined },
    { run_id: undefined },
    { retry_id: undefined }
  ];
  for (const override of mismatches) {
    const adapter = adapterReturning(canonicalPreparation(override));
    await assert.rejects(
      adapter({ ...REQUEST }),
      /direct slice-review preparation returned an invalid trusted result/u,
      `tuple drift ${JSON.stringify(override)} must be refused`
    );
  }
});

test("WK-1688 adapter still binds the exact launcher tuple before calling the producer", async () => {

  let called = false;
  const adapter = createDirectSliceReviewPreparationAdapter(MAIN_REPO, {
    prepareSurface: async () => {
      called = true;
      return canonicalPreparation();
    }
  });

  const badRequests = [
    null,
    {},
    { ...REQUEST, assigned_unit: "WK-1687" },
    { ...REQUEST, retry_id: -1 },
    { ...REQUEST, retry_id: "0" },
    { ...REQUEST, launch_ref: "" },

    { ...REQUEST, main_repo: "/attacker/repo" }
  ];
  for (const request of badRequests) {
    await assert.rejects(
      adapter(request),
      /trusted lifecycle operation requires the exact launcher tuple/u,
      `request ${JSON.stringify(request)} must be refused before the producer runs`
    );
  }
  assert.equal(called, false, "the producer must not run for a malformed tuple");
});

test("WK-1688 the exported validator pins the canonical contract, with no prepared field", () => {
  const bound = { ...REQUEST };
  assert.equal(validateSliceReviewPreparationResult(canonicalPreparation(), bound), true);

  assert.equal(
    validateSliceReviewPreparationResult(canonicalPreparation({ prepared: true }), bound),
    true
  );
  assert.equal(validateSliceReviewPreparationResult(null, bound), false);
  assert.equal(
    validateSliceReviewPreparationResult(canonicalPreparation({ schema_version: "x" }), bound),
    false
  );
});
