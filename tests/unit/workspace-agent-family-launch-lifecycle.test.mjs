import test from "node:test";
import assert from "node:assert/strict";

import {
  launchWorkspaceAgentFamilyLaunchLifecycle
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-family-launch-lifecycle.mjs";
import {
  MODEL_REGISTRY_BY_NAME,
  resolveModelRuntime
} from "../../packages/agent-launch-cli/src/lib/agent-launch-model-registry.mjs";
import {
  REVIEWER_CLOSURE_TRANSPORTS,
  planReviewerClosure,
  planTerminalWholeWkClosure,
  runPostWorkerSliceLifecycleBody
} from "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-run.mjs";
import {
  freezeSliceReviewSurface
} from "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-review.mjs";
import {
  createLifecycleCheckpoint,
  POST_WORKER_LIFECYCLE_CHECKPOINT,
  POST_WORKER_LIFECYCLE_PHASES
} from "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-bindings.mjs";
import {
  TERMINAL_REVIEW_EVIDENCE_MODES
} from "../../packages/wiki-mcp/src/lib/dispatch-terminal-review-evidence.mjs";
import {
  TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION,
  TERMINAL_REVIEW_VERIFY_PARTS
} from "../../packages/agent-launch-cli/src/lib/terminal-review-materialization.mjs";

function requiredCallbacks(overrides = {}) {
  return {
    parseFinalResult: () => ({ kind: "caller-final-result" }),
    buildSpawnThrewRefusal: (detail) => ({
      accepted: false,
      reason: "caller_spawn_threw",
      detail
    }),
    buildNoChildRefusal: (detail) => ({
      accepted: false,
      reason: "caller_spawn_no_child",
      detail
    }),
    ...overrides
  };
}

test("spawn success delegates caller-owned command, supervision, metadata, and envelope adapters", async () => {
  const events = [];
  const child = { pid: 1234 };
  const parser = () => ({ kind: "parsed-by-caller" });
  const passthrough = { source: "neutral-test" };
  const warning = { code: "caller-warning" };
  const enforcement = { mode: "caller-enforcement" };
  const env = { TEST_ENV: "1" };
  const options = { stdio: "pipe", detached: false };
  const args = ["--one"];
  const superviseCalls = [];

  const result = await launchWorkspaceAgentFamilyLaunchLifecycle({
    command: "/bin/tool",
    args,
    cwd: "/workspace/repo",
    env,
    options,
    spawn: async (command, spawnArgs, spawnOptions) => {
      events.push("spawn");
      assert.equal(command, "/bin/tool");
      assert.deepEqual(spawnArgs, ["--one"]);
      assert.notEqual(spawnArgs, args);
      assert.deepEqual(spawnOptions, {
        stdio: "pipe",
        detached: false,
        cwd: "/workspace/repo",
        env
      });
      return child;
    },
    superviseChildLaunch: (superviseOptions) => {
      events.push("supervise");
      superviseCalls.push(superviseOptions);
      return {
        accepted: true,
        status: "launching",
        pid: superviseOptions.child.pid
      };
    },
    ...requiredCallbacks({ parseFinalResult: parser }),
    passthrough,
    role: "neutral-role",
    subject: "WK-1329#SLICE-015",
    kind: "neutral-family",
    killTimeoutMs: 500,
    killSignal: "SIGTERM",
    warning,
    enforcement,
    adaptSupervisedResult: (supervised, context) => {
      events.push("adapt-supervised");
      assert.deepEqual(context, {
        command: "/bin/tool",
        args: ["--one"],
        cwd: "/workspace/repo",
        env,
        options,
        passthrough,
        baseline: null
      });
      return { ...supervised, adapted: true };
    },
    adaptEnvelope: (supervised, context) => {
      events.push("adapt-envelope");
      return {
        envelope: supervised,
        contextArgs: context.args
      };
    }
  });

  assert.deepEqual(events, ["spawn", "supervise", "adapt-supervised", "adapt-envelope"]);
  assert.equal(superviseCalls.length, 1);
  assert.deepEqual(superviseCalls[0], {
    child,
    parseFinalResult: parser,
    role: "neutral-role",
    subject: "WK-1329#SLICE-015",
    family: "neutral-family",
    passthrough,
    killTimeoutMs: 500,
    killSignal: "SIGTERM"
  });
  assert.deepEqual(result, {
    envelope: {
      accepted: true,
      status: "launching",
      pid: 1234,
      warning,
      enforcement,
      adapted: true
    },
    contextArgs: ["--one"]
  });
});

test("spawn threw and spawn returned no child are mapped by caller-supplied refusal builders", async () => {
  const threw = await launchWorkspaceAgentFamilyLaunchLifecycle({
    command: "neutral",
    spawn: () => {
      throw new Error("spawn exploded");
    },
    superviseChildLaunch: () => assert.fail("supervise must not run after spawn throw"),
    ...requiredCallbacks()
  });

  assert.deepEqual(threw, {
    accepted: false,
    reason: "caller_spawn_threw",
    detail: { message: "spawn exploded" }
  });

  const noChild = await launchWorkspaceAgentFamilyLaunchLifecycle({
    command: "neutral",
    spawn: () => null,
    superviseChildLaunch: () => assert.fail("supervise must not run without a child"),
    ...requiredCallbacks()
  });

  assert.deepEqual(noChild, {
    accepted: false,
    reason: "caller_spawn_no_child",
    detail: null
  });
});

test("caller-supplied baseline capture runs before spawn and is passed to verifier/adapters", async () => {
  const events = [];
  const baseline = Object.freeze({ before: ["a.txt"] });
  let adapterBaseline;
  let verifierBaseline;

  const launched = await launchWorkspaceAgentFamilyLaunchLifecycle({
    command: "neutral",
    spawn: () => {
      events.push("spawn");
      return { pid: 5 };
    },
    superviseChildLaunch: () => {
      events.push("supervise");
      return {
        accepted: true,
        probe: async () => ({
          status: "succeeded",
          final_result: { kind: "findings" }
        })
      };
    },
    ...requiredCallbacks(),
    postRunVerification: {
      captureBaseline: async () => {
        events.push("baseline");
        return baseline;
      },
      run: async ({ baseline: receivedBaseline }) => {
        events.push("verify");
        verifierBaseline = receivedBaseline;
        return { ok: true };
      },
      attachFinalResult: (finalResult, { baseline: receivedBaseline, checkResult }) => {
        events.push("attach");
        adapterBaseline = receivedBaseline;
        return { ...finalResult, caller_verification: checkResult };
      }
    }
  });

  assert.deepEqual(events, ["baseline", "spawn", "supervise"]);
  const terminal = await launched.probe();
  assert.deepEqual(events, ["baseline", "spawn", "supervise", "verify", "attach"]);
  assert.equal(verifierBaseline, baseline);
  assert.equal(adapterBaseline, baseline);
  assert.deepEqual(terminal.final_result, {
    kind: "findings",
    caller_verification: { ok: true }
  });
});

test("terminal probe preserves supervised final_result normalization while verifier runs once across repeated probes", async () => {
  let probeCount = 0;
  let verifyCount = 0;
  const attachContexts = [];
  const adaptedStatuses = [];

  const launched = await launchWorkspaceAgentFamilyLaunchLifecycle({
    command: "neutral",
    spawn: () => ({ pid: 8 }),
    superviseChildLaunch: () => ({
      accepted: true,
      probe: async () => {
        probeCount += 1;
        return {
          status: "succeeded",
          final_result: {
            schema_version: "normalized-by-superviseChildLaunch",
            kind: "findings",
            probeCount
          }
        };
      }
    }),
    ...requiredCallbacks(),
    postRunVerification: {
      run: async () => {
        verifyCount += 1;
        return { changed_paths: ["tests/unit/workspace-agent-family-launch-lifecycle.test.mjs"] };
      },
      attachFinalResult: (finalResult, context) => {
        attachContexts.push(context);
        return {
          ...finalResult,
          verification: context.checkResult
        };
      },
      adaptProbeResult: (probed, context) => {
        adaptedStatuses.push(probed.status);
        return {
          ...probed,
          adapted_by_caller: true,
          final_result: {
            ...probed.final_result,
            adapted_probe_status: context.probed.status
          }
        };
      }
    }
  });

  const first = await launched.probe();
  const second = await launched.probe();

  assert.equal(verifyCount, 1);
  assert.equal(attachContexts.length, 2);
  assert.deepEqual(adaptedStatuses, ["succeeded", "succeeded"]);
  assert.deepEqual(first, {
    status: "succeeded",
    adapted_by_caller: true,
    final_result: {
      schema_version: "normalized-by-superviseChildLaunch",
      kind: "findings",
      probeCount: 1,
      verification: {
        changed_paths: ["tests/unit/workspace-agent-family-launch-lifecycle.test.mjs"]
      },
      adapted_probe_status: "succeeded"
    }
  });
  assert.equal(second.final_result.schema_version, "normalized-by-superviseChildLaunch");
  assert.equal(second.final_result.probeCount, 2);
  assert.deepEqual(second.final_result.verification, first.final_result.verification);
});

test("verifier failure mapping and final_result field attachment are caller supplied", async () => {
  const baseline = { before: "snapshot" };
  let mappedInput;

  const launched = await launchWorkspaceAgentFamilyLaunchLifecycle({
    command: "neutral",
    spawn: () => ({ pid: 9 }),
    superviseChildLaunch: () => ({
      accepted: true,
      probe: async () => ({
        status: "failed",
        final_result: { kind: "missing_result" }
      })
    }),
    ...requiredCallbacks(),
    postRunVerification: {
      captureBaseline: () => baseline,
      run: () => {
        throw new Error("verification exploded");
      },
      mapFailure: ({ phase, error, baseline: receivedBaseline }) => {
        mappedInput = { phase, message: error.message, baseline: receivedBaseline };
        return {
          mapped_by: "caller",
          phase,
          reason: error.message
        };
      },
      finalResultField: "caller_verification"
    }
  });

  const terminal = await launched.probe();

  assert.deepEqual(mappedInput, {
    phase: "terminal",
    message: "verification exploded",
    baseline
  });
  assert.deepEqual(terminal.final_result, {
    kind: "missing_result",
    caller_verification: {
      mapped_by: "caller",
      phase: "terminal",
      reason: "verification exploded"
    }
  });
});

test("verification is not run or attached for non-terminal probes or probes missing final_result", async () => {
  const probes = [
    {
      status: "running",
      final_result: { kind: "should-not-be-attached" }
    },
    {
      status: "succeeded",
      final_result: null
    },
    {
      status: "failed"
    }
  ];
  let verifyCount = 0;
  let attachCount = 0;

  const launched = await launchWorkspaceAgentFamilyLaunchLifecycle({
    command: "neutral",
    spawn: () => ({ pid: 10 }),
    superviseChildLaunch: () => ({
      accepted: true,
      probe: async () => probes.shift()
    }),
    ...requiredCallbacks(),
    postRunVerification: {
      run: () => {
        verifyCount += 1;
        return { ok: true };
      },
      attachFinalResult: (finalResult, context) => {
        attachCount += 1;
        return { ...finalResult, verification: context.checkResult };
      },
      adaptProbeResult: (probed) => ({
        ...probed,
        adapted: true
      })
    }
  });

  assert.deepEqual(await launched.probe(), {
    status: "running",
    final_result: { kind: "should-not-be-attached" }
  });
  assert.deepEqual(await launched.probe(), {
    status: "succeeded",
    final_result: null
  });
  assert.deepEqual(await launched.probe(), {
    status: "failed"
  });
  assert.equal(verifyCount, 0);
  assert.equal(attachCount, 0);
});

test("every registry member reaches the same typed managed-reviewer closure decision", () => {
  const members = [...MODEL_REGISTRY_BY_NAME.keys()];
  assert.equal(members.length > 0, true, "the authoritative registry must be non-empty");

  const decisions = new Map();
  for (const model of members) {
    const runtime = resolveModelRuntime(model);
    assert.notEqual(runtime, null, model);

    const plan = planReviewerClosure({
      transport: REVIEWER_CLOSURE_TRANSPORTS.MANAGED_TERMINAL_RESULT,
      repository: "/repo",
      role: "reviewer",
      purpose: "terminal_whole_wk_candidate",
      subject: "WK-2356#SLICE-001",
      reviewed_sha: "a".repeat(40),
      diff_base_sha: "b".repeat(40),
      controlled_generation: `sha256:${"c".repeat(64)}`,
      receipt_identity: "workspace-agent-exact-slice-review-receipt.v4",
      provenance_shape: "terminal_candidate"
    });
    decisions.set(runtime.app, [...(decisions.get(runtime.app) ?? []), plan]);
    assert.equal(plan.transport, "managed_terminal_result", model);
    assert.equal(plan.supported_continuation, "workspace_agent_run_status", model);
    assert.equal(plan.receipt_identity, "workspace-agent-exact-slice-review-receipt.v4", model);
  }

  const apps = new Set([...members].map((model) => resolveModelRuntime(model).app));
  assert.deepEqual([...decisions.keys()].sort(), [...apps].sort());
  for (const plans of decisions.values()) {
    for (const plan of plans) assert.deepEqual(plan, plans[0]);
  }
});

test("a standalone technical redteam freezes only its submit-for-review facts", () => {
  let reference = null;
  for (const model of MODEL_REGISTRY_BY_NAME.keys()) {
    const plan = planReviewerClosure({
      transport: REVIEWER_CLOSURE_TRANSPORTS.STANDALONE_SUBMIT_FOR_REVIEW,
      repository: "/repo",
      role: "redteam",
      purpose: "technical_redteam",
      subject: "WK-2356#SLICE-003"
    });
    assert.equal(plan.transport, "standalone_submit_for_review", model);
    assert.equal(plan.supported_continuation, "workspace_submit_for_review", model);

    assert.equal(plan.receipt_identity, null, model);
    assert.equal(plan.provenance_shape, null, model);
    assert.equal(Object.hasOwn(plan, "reviewed_sha"), false, model);
    assert.equal(Object.hasOwn(plan, "controlled_generation"), false, model);

    reference = reference ?? plan;
    assert.deepEqual(plan, reference, model);
  }
  assert.notEqual(reference, null);
});

test("no transport may mint a fact it does not own", () => {
  const refusal = (facts) => {
    try {
      planReviewerClosure(facts);
      return null;
    } catch (error) {
      return error;
    }
  };
  const overreaching = refusal({
    transport: REVIEWER_CLOSURE_TRANSPORTS.STANDALONE_SUBMIT_FOR_REVIEW,
    repository: "/repo",
    role: "redteam",
    purpose: "technical_redteam",
    subject: "WK-2356#SLICE-003",
    receipt_identity: "workspace-agent-exact-slice-review-receipt.v4"
  });
  assert.equal(overreaching.code, "agent_launch.reviewer_closure_plan.incomplete.v1");
  assert.equal(overreaching.detail.correctable_field, "receipt_identity");
  assert.equal(overreaching.detail.transport, "standalone_submit_for_review");
});

test("a structurally impossible closure refuses before spawn and names the correctable field", () => {
  const complete = {
    transport: REVIEWER_CLOSURE_TRANSPORTS.MANAGED_TERMINAL_RESULT,
    repository: "/repo",
    role: "reviewer",
    purpose: "terminal_whole_wk_candidate",
    subject: "WK-2356#SLICE-001",
    reviewed_sha: "a".repeat(40),
    diff_base_sha: "b".repeat(40),
    controlled_generation: `sha256:${"c".repeat(64)}`,
    receipt_identity: "workspace-agent-exact-slice-review-receipt.v4",
    provenance_shape: "terminal_candidate"
  };

  for (const field of Object.keys(complete).filter((key) => key !== "transport")) {
    let refused = null;
    try {
      planReviewerClosure({ ...complete, [field]: null });
    } catch (error) {
      refused = error;
    }
    assert.notEqual(refused, null, field);
    assert.equal(refused.code, "agent_launch.reviewer_closure_plan.incomplete.v1", field);
    assert.equal(refused.detail.correctable_field, field, field);
  }
  let unsupported = null;
  try {
    planReviewerClosure({ ...complete, transport: "submit_via_shell" });
  } catch (error) {
    unsupported = error;
  }
  assert.equal(unsupported.detail.correctable_field, "transport");
});

const SLICE_SHA = "1".repeat(40);
const SLICE_BASE = "2".repeat(40);
const GENERATION = `sha256:${"e".repeat(64)}`;

function sliceFreezeArgs(overrides = {}) {
  const { deps: depsOverrides = {}, ...rest } = overrides;
  return {
    workspaceDir: "/repo",
    status: { subject: "WK-2377#SLICE-001", run_id: "run-worker", monitor_handle: "mon-worker" },
    bindings: { provisioning: { record_id: "WK-2377", slice_id: "SLICE-001" } },
    binding: { base_sha: SLICE_BASE, worktree_path: "/worktrees/slice", retry_id: 0 },
    sliceRef: "refs/heads/slice/IN-0042/WK-2377/SLICE-001",
    wkId: "WK-2377",
    sliceId: "SLICE-001",
    commit: SLICE_SHA,

    planReviewerClosure,
    deps: {
      resolveCanonicalSliceReviewUnit: () => ({
        record_id: "WK-2377",
        slice_id: "SLICE-001",
        subject: "WK-2377#SLICE-001",
        initiative: "IN-0042",
        parent_status: "in_progress",
        canonical_parent_wk_contract: "canonical-parent",
        review_unit_contract: "canonical-slice"
      }),
      bindFrozenSliceReviewContext: () => Object.freeze({
        schema_version: "workspace-agent-frozen-slice-review-context.v1",
        worktree_path: "/worktrees/slice"
      }),
      readCanonicalContractGenerationIdentity: () => ({ digest: GENERATION }),
      ...depsOverrides
    },
    ...rest
  };
}

test("the exact-slice pre-spawn seam plans its managed closure before the reviewer dispatch exists", async () => {
  const surface = await freezeSliceReviewSurface(sliceFreezeArgs());
  const plan = surface.reviewer_dispatch.closure_plan;

  assert.equal(plan.transport, "managed_terminal_result");
  assert.equal(plan.supported_continuation, "workspace_agent_run_status");
  assert.equal(plan.receipt_identity, "workspace-agent-exact-slice-review-receipt.v4");
  assert.equal(plan.subject, "WK-2377#SLICE-001");

  assert.equal(plan.reviewed_sha, surface.reviewed_sha);
  assert.equal(plan.diff_base_sha, surface.diff_base_sha);
  assert.equal(plan.controlled_generation, GENERATION);
  assert.notEqual(plan.controlled_generation, "workspace-agent-frozen-slice-review-context.v1");
  assert.equal(plan.repository, "/worktrees/slice");
});

test("mutation witness: an exact-slice seam with no composed planner refuses before spawn", async () => {
  const transitions = [];
  await assert.rejects(
    () => freezeSliceReviewSurface({
      ...sliceFreezeArgs({
        deps: { setWorkRecordStatusByUnit: async (write) => {
          transitions.push(write);
          return { valid: true, written: true };
        } }
      }),
      planReviewerClosure: undefined
    }),
    /requires the composed reviewer closure planner/u
  );

  assert.deepEqual(transitions, []);
});

test("a structurally impossible exact-slice closure refuses with the existing stable code", async () => {
  let refused = null;
  try {
    await freezeSliceReviewSurface(sliceFreezeArgs({

      deps: { readCanonicalContractGenerationIdentity: () => ({ digest: null }) }
    }));
  } catch (error) {
    refused = error;
  }
  assert.notEqual(refused, null);
  assert.equal(refused.code, "agent_launch.reviewer_closure_plan.incomplete.v1");
  assert.equal(refused.detail.correctable_field, "controlled_generation");
  assert.equal(refused.detail.transport, "managed_terminal_result");
});

const WHOLE_WK_TARGET = Object.freeze({
  candidate_sha: "3".repeat(40),
  sha: "4".repeat(40),
  diff_base_sha: "5".repeat(40)
});

function reviewUnitContract(workKind) {
  return {
    subject: "WK-2377#SLICE-002",
    review_unit_contract: JSON.stringify({ id: "SLICE-002", work_kind: workKind })
  };
}

test("the terminal whole-WK closure binds the selected controlled generation, not a schema label", () => {
  const reviewContext = Object.freeze({
    schema_version: "workspace-agent-frozen-wk-review-context.v1",
    terminal_candidate_version_decision: Object.freeze({
      version_identity: "version-1",
      controlled_generation: GENERATION
    })
  });
  const plan = planTerminalWholeWkClosure({
    repository: "/repo",
    reviewUnit: reviewUnitContract("review"),
    reviewTarget: WHOLE_WK_TARGET,
    reviewContext,
    terminalCandidate: { binding: { candidate: WHOLE_WK_TARGET.candidate_sha } }
  });
  assert.equal(plan.transport, "managed_terminal_result");
  assert.equal(plan.purpose, "terminal_whole_wk_candidate");
  assert.equal(plan.controlled_generation, GENERATION);

  assert.notEqual(plan.controlled_generation, reviewContext.schema_version);
  assert.equal(plan.reviewed_sha, WHOLE_WK_TARGET.candidate_sha);
  assert.equal(plan.diff_base_sha, WHOLE_WK_TARGET.diff_base_sha);
});

test("a terminal candidate whose version decision is absent refuses before spawn", () => {
  let refused = null;
  try {
    planTerminalWholeWkClosure({
      repository: "/repo",
      reviewUnit: reviewUnitContract("review"),
      reviewTarget: WHOLE_WK_TARGET,

      reviewContext: { schema_version: "workspace-agent-frozen-wk-review-context.v1" },
      terminalCandidate: { binding: { candidate: WHOLE_WK_TARGET.candidate_sha } }
    });
  } catch (error) {
    refused = error;
  }
  assert.notEqual(refused, null);
  assert.equal(refused.code, "agent_launch.reviewer_closure_plan.incomplete.v1");
  assert.equal(refused.detail.correctable_field, "controlled_generation");
});

test("a whole-WK findings unit with no terminal candidate plans the standalone submit closure", () => {
  for (const [workKind, purpose] of [
    ["redteam", "technical_redteam"],
    ["review", "whole_wk_findings"]
  ]) {
    const plan = planTerminalWholeWkClosure({
      repository: "/repo",
      reviewUnit: reviewUnitContract(workKind),
      reviewTarget: WHOLE_WK_TARGET,
      reviewContext: { schema_version: "workspace-agent-frozen-wk-review-context.v1" },
      terminalCandidate: null
    });

    assert.equal(plan.transport, "standalone_submit_for_review", workKind);
    assert.equal(plan.supported_continuation, "workspace_submit_for_review", workKind);
    assert.equal(plan.purpose, purpose, workKind);
    assert.equal(plan.receipt_identity, null, workKind);
    assert.equal(plan.provenance_shape, null, workKind);
    assert.equal(Object.hasOwn(plan, "controlled_generation"), false, workKind);
  }
});

const WK_SHA = "6".repeat(40);
const WK_BASE = "7".repeat(40);
const WK_WORKTREE = "/worktrees/wk-2383";
const WK_REF = "refs/heads/wk/IN-0042/WK-2383";

const WHOLE_WK_INTEGRATION = Object.freeze({
  integrated: true,
  slice_ref: "refs/heads/slice/IN-0042/WK-2383/SLICE-001",
  slice_sha: WK_SHA,
  wk_ref: WK_REF,

  wk_sha: WK_SHA,
  review_target: Object.freeze({
    schema_version: "slice-integration.v1",
    unit_address: "IN-0042/WK-2383",
    ref: WK_REF,
    sha: WK_SHA,
    diff_base_sha: WK_BASE,
    diff_head_sha: WK_SHA,
    diff_range: `${WK_BASE}..${WK_SHA}`,
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  })
});

const WHOLE_WK_MATERIALIZATION = Object.freeze({
  schema_version: TERMINAL_REVIEW_MATERIALIZATION_SCHEMA_VERSION,
  worktree_path: WK_WORKTREE,
  wk_ref: WK_REF,
  reviewed_sha: WK_SHA,
  reviewed_tree: "8".repeat(40),
  verified: true,
  verified_parts: TERMINAL_REVIEW_VERIFY_PARTS
});

async function finalizeWholeWkNoCandidate(workKind) {
  const checkpoint = createLifecycleCheckpoint();
  checkpoint.phase = POST_WORKER_LIFECYCLE_PHASES.INTEGRATED;
  checkpoint.integration = WHOLE_WK_INTEGRATION;
  const status = {
    role: "worker",
    terminal: true,
    status: "succeeded",
    subject: "WK-2383#SLICE-001",
    run_id: "worker-run",
    monitor_handle: "worker-handle"
  };
  Object.defineProperty(status, POST_WORKER_LIFECYCLE_CHECKPOINT, { value: checkpoint });
  return await runPostWorkerSliceLifecycleBody({
    workspace: { dir: "/repo" },
    status,
    deps: {
      resolveManagedRunBinding: () => ({
        slice_binding: {
          unit_address: "IN-0042/WK-2383/SLICE-001",
          output_branch: "slice/IN-0042/WK-2383/SLICE-001"
        },
        wk_binding: { output_branch: "wk/IN-0042/WK-2383", worktree_path: WK_WORKTREE },
        validation_worktree_path: WK_WORKTREE
      }),

      resolveCanonicalReviewUnit: () => ({
        record_id: "WK-2383",
        initiative: "IN-0042",
        subject: "WK-2383#SLICE-002",
        review_unit_contract: JSON.stringify({ id: "SLICE-002", work_kind: workKind })
      }),
      terminalReviewEvidenceMode: TERMINAL_REVIEW_EVIDENCE_MODES.LIVE_MATERIALIZER,
      materializeTerminalReviewWorktree: () => WHOLE_WK_MATERIALIZATION,
      bindFrozenReviewContext: () => Object.freeze({
        schema_version: "workspace-agent-frozen-wk-review-context.v1"
      })
    }
  });
}

test("a canonical redteam whole-WK unit plans AND dispatches the redteam role", async () => {
  const finalized = await finalizeWholeWkNoCandidate("redteam");
  const dispatch = finalized.reviewer_dispatch;

  assert.equal(dispatch.closure_plan.transport, "standalone_submit_for_review");
  assert.equal(dispatch.closure_plan.supported_continuation, "workspace_submit_for_review");
  assert.equal(dispatch.closure_plan.purpose, "technical_redteam");

  assert.equal(dispatch.closure_plan.role, "redteam");
  assert.equal(dispatch.args.role, "redteam");
  assert.equal(dispatch.tool, "workspace_agent_dispatch");
  assert.equal(dispatch.args.subject, "WK-2383#SLICE-002");

  assert.equal(dispatch.closure_plan.receipt_identity, null);
  assert.equal(dispatch.closure_plan.provenance_shape, null);
});

test("an ordinary whole-WK findings unit still plans AND dispatches the reviewer role", async () => {
  const finalized = await finalizeWholeWkNoCandidate("review");
  const dispatch = finalized.reviewer_dispatch;

  assert.equal(dispatch.closure_plan.transport, "standalone_submit_for_review");
  assert.equal(dispatch.closure_plan.supported_continuation, "workspace_submit_for_review");
  assert.equal(dispatch.closure_plan.purpose, "whole_wk_findings");
  assert.equal(dispatch.closure_plan.role, "reviewer");
  assert.equal(dispatch.args.role, "reviewer");
});

test("mutation witness: the dispatched role is the planned role and the two canonical kinds do not collapse", async () => {
  const roles = {};
  for (const workKind of ["redteam", "review"]) {
    const dispatch = (await finalizeWholeWkNoCandidate(workKind)).reviewer_dispatch;

    assert.equal(dispatch.args.role, dispatch.closure_plan.role, workKind);
    roles[workKind] = dispatch.args.role;
  }

  assert.notEqual(roles.redteam, roles.review);
  assert.deepEqual(roles, { redteam: "redteam", review: "reviewer" });
});
