import test from "node:test";
import assert from "node:assert/strict";

import {
  launchWorkspaceAgentFamilyLaunchLifecycle
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-family-launch-lifecycle.mjs";
import * as postWorkerLifecycleRun from
  "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-run.mjs";
import {
  runPostWorkerSliceLifecycleBody
} from "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-run.mjs";
import {
  createLifecycleCheckpoint,
  POST_WORKER_LIFECYCLE_CHECKPOINT,
  POST_WORKER_LIFECYCLE_PHASES
} from "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-bindings.mjs";
import * as terminalReviewEvidence from
  "../../packages/wiki-mcp/src/lib/dispatch-terminal-review-evidence.mjs";
import {
  RETIRED_POST_WORKER_REVIEW_SEAMS
} from "../../packages/wiki-mcp/src/lib/dispatch-tools-test-helpers.mjs";

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

test("the post-worker lifecycle exports no reviewer closure planner or evidence mode", () => {
  for (const retired of [
    "planReviewerClosure",
    "planTerminalWholeWkClosure",
    "REVIEWER_CLOSURE_TRANSPORTS"
  ]) {
    assert.equal(Object.hasOwn(postWorkerLifecycleRun, retired), false, retired);
  }
  assert.deepEqual(Object.keys(terminalReviewEvidence), ["verifyTerminalCandidateCycle"]);
  assert.equal(Object.values(POST_WORKER_LIFECYCLE_PHASES).includes("awaiting-slice-review"), false);
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

async function finalizeWholeWk() {
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
  const calls = [];
  const finalized = await runPostWorkerSliceLifecycleBody({
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
      ...Object.fromEntries(RETIRED_POST_WORKER_REVIEW_SEAMS.map((name) => [name, () => {
        calls.push(name);
        throw new Error(`retired review seam ${name} was called`);
      }]))
    }
  });
  return { finalized, calls };
}

test("a final whole-WK integration finalizes with no reviewer dispatch for either findings kind", async () => {
  for (const workKind of ["redteam", "review"]) {
    const { finalized, calls } = await finalizeWholeWk();
    assert.equal(finalized.phase, POST_WORKER_LIFECYCLE_PHASES.FINALIZED, workKind);
    assert.equal(finalized.integrated, true, workKind);
    assert.equal(finalized.wk_transitioned_to_review, true, workKind);
    assert.equal(finalized.integration, WHOLE_WK_INTEGRATION, workKind);
    for (const key of ["reviewer_dispatch", "slice_review", "terminal_review_materialization",
      "terminal_candidate", "terminal_candidate_validations"]) {
      assert.equal(Object.hasOwn(finalized, key), false, `${workKind}: ${key}`);
    }

    assert.deepEqual(calls, [], workKind);
  }
});
