import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import { registerDispatchTools } from "./dispatch-tools.mjs";
import {
  runPostWorkerSliceLifecycle,
  runRetainedSliceCleanupDisposition
} from "./dispatch-run-monitor-routes.mjs";
import { errorContent, jsonContent } from "./mcp-response.mjs";

function createDispatchToolRegistry({
  backend = {}
} = {}) {
  const tools = new Map();
  const registerTool = (name, config, handler) => {
    tools.set(name, { config, handler });
  };

  registerDispatchTools({
    registerTool,
    registeredToolNames: new Set([
      "workspace_agent_dispatch",
      "workspace_record_graph_impact_evidence",
      "workspace_validate_dispatch"
    ]),
    workspaceRepos: [{ repo: "agent-chassis", dir: "/home/user/agent-chassis" }],
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo: () => ({
      repo: "agent-chassis",
      dir: "/home/user/agent-chassis"
    }),
    dispatchBackend: {
      startLaunch: async () => {
        throw new Error("Cannot open /home/user/agent-chassis/wiki/work-records/WK-1160.json");
      },
      getRunStatus: async () => {
        throw new Error("Cannot open /home/user/agent-chassis/wiki/work-records/WK-1160.json");
      },
      waitForRunStatus: async () => {
        throw new Error("Cannot open /home/user/agent-chassis/wiki/work-records/WK-1160.json");
      },
      ...backend
    },
    dispatchSessionIdentity: "session-123"
  });

  return tools;
}

function parseStructuredTextResponse(result) {
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, "text");
  assert.equal(typeof result.content[0].text, "string");
  const structured = JSON.parse(result.content[0].text);
  assert.deepEqual(result.structuredContent, structured);
  return structured;
}

function createResumableLifecycleHarness({ bindFailures = 0, integrationGate = null } = {}) {
  const base = "a".repeat(40);
  const commit = "b".repeat(40);
  const sliceRef = "refs/heads/slice/IN-0021/WK-1537/SLICE-001";
  const wkRef = "refs/heads/wk/IN-0021/WK-1537";
  const sliceWorktree = "/tmp/slice-IN-0021-WK-1537-SLICE-001";
  const wkWorktree = "/tmp/wk-IN-0021-WK-1537";
  const status = {
    accepted: true,
    timed_out: false,
    run_id: "run-worker-resumable",
    monitor_handle: "wkmh_worker_resumable",
    role: "worker",
    subject: "WK-1537#SLICE-001",
    status: "succeeded",
    terminal: true,
    started_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:01:00.000Z"
  };
  const reviewTarget = Object.freeze({
    schema_version: "slice-integration.v1",
    unit_address: "IN-0021/WK-1537",
    ref: wkRef,
    sha: commit,
    diff_base_sha: base,
    diff_head_sha: commit,
    diff_range: `${base}..${commit}`,
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  });
  const integrationResult = Object.freeze({
    schema_version: "slice-integration.v1",
    integrated: true,
    rebased: false,
    previous_wk_sha: base,
    slice_ref: sliceRef,
    slice_sha: commit,
    wk_ref: wkRef,
    wk_sha: commit,
    review_target: reviewTarget,
    transition: Object.freeze({ valid: true, written: true })
  });
  let canonicalStatus = "in_progress";
  let integrationCalls = 0;
  let bindCalls = 0;
  const provisioning = {
    record_id: "WK-1537",
    slice_id: "SLICE-001",
    slice_binding: {
      unit_address: "IN-0021/WK-1537/SLICE-001",
      output_branch: sliceRef,
      worktree_path: sliceWorktree,
      base_sha: base
    },
    wk_binding: {
      unit_address: "IN-0021/WK-1537",
      output_branch: wkRef,
      worktree_path: wkWorktree,
      base_sha: base
    },
    validation_worktree_path: wkWorktree
  };
  const deps = {
    resolveManagedRunBinding: () => provisioning,
    resolveCanonicalReviewUnit: () => ({
      record_id: "WK-1537",
      slice_id: "SLICE-003",
      subject: "WK-1537#SLICE-003",
      unit_contract: "canonical-review",
      parent_status: canonicalStatus
    }),
    runGit: ({ repo, args }) => {
      if (args[0] === "symbolic-ref") {
        return { ok: true, stdout: `${repo === sliceWorktree ? sliceRef : wkRef}\n` };
      }
      if (args[0] === "status") return { ok: true, stdout: "" };
      if (args[0] === "rev-list") return { ok: true, stdout: `${commit} ${base}\n` };
      if (args[0] === "merge-base" && args[1] === "--is-ancestor") return { ok: true, stdout: "" };
      if (args[0] === "merge-base") return { ok: true, stdout: `${base}\n` };
      if (args[0] === "rev-parse") {
        const value = args.at(-1);
        if (repo === sliceWorktree || String(value).includes("slice/")) {
          return { ok: true, stdout: `${commit}\n` };
        }
        if (repo === wkWorktree || String(value).includes("wk/")) {
          return { ok: true, stdout: `${canonicalStatus === "review" ? commit : base}\n` };
        }
        if (String(value).includes("main")) return { ok: true, stdout: `${base}\n` };
      }
      return { ok: false, status: 128, stderr: `unexpected git call: ${args.join(" ")}` };
    },
    integrateCommittedSlice: async (input) => {
      integrationCalls += 1;
      if (integrationGate) await integrationGate;
      canonicalStatus = "review";
      await input.transitionToReview({ unitAddress: "WK-1537", status: "review" });
      return integrationResult;
    },
    setWorkRecordStatusByUnit: async () => ({ valid: true, written: true }),
    bindFrozenReviewContext: () => {
      bindCalls += 1;
      if (bindCalls <= bindFailures) throw new Error("injected post-integration context failure");
      return { schema_version: "workspace-agent-frozen-wk-review-context.v1" };
    }
  };
  const invoke = ({ workspace, status: lifecycleStatus }) =>
    runPostWorkerSliceLifecycle({ workspace, status: lifecycleStatus, deps });
  return {
    status,
    deps,
    invoke,
    integrationResult,
    counts: () => ({ integrationCalls, bindCalls }),
    setCanonicalStatus(value) { canonicalStatus = value; }
  };
}

test("workspace_agent_dispatch returns a structured blocker when the handler throws", async () => {
  const tools = createDispatchToolRegistry();
  const response = await tools.get("workspace_agent_dispatch").handler({
    role: "worker",
    subject: "WK-1160#SLICE-012",
    app: "codex"
  });

  const structured = parseStructuredTextResponse(response);
  assert.equal(structured.accepted, false);
  assert.equal(structured.blocker.code, RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED);
  assert.equal(structured.blocker.reason, "dispatch_tool_exception");
  assert.equal(structured.blocker.detail.tool, "workspace_agent_dispatch");
  assert.equal(structured.blocker.detail.error_name, "Error");
  assert.equal(
    structured.blocker.detail.error_message,
    "Cannot open [redacted absolute path]"
  );
});

test("workspace_agent_run_status returns a structured blocker when the handler throws", async () => {
  const tools = createDispatchToolRegistry();
  const response = await tools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_test",
    subject: "WK-1160#SLICE-012"
  });

  const structured = parseStructuredTextResponse(response);
  assert.equal(structured.accepted, false);
  assert.equal(structured.blocker.code, RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED);
  assert.equal(structured.blocker.reason, "run_status_tool_exception");
  assert.equal(structured.blocker.detail.tool, "workspace_agent_run_status");
  assert.equal(
    structured.blocker.detail.error_message,
    "Cannot open [redacted absolute path]"
  );
});

test("workspace_agent_run_wait returns a structured blocker when the handler throws", async () => {
  const tools = createDispatchToolRegistry();
  const response = await tools.get("workspace_agent_run_wait").handler({
    monitor_handle: "wkmh_test",
    subject: "WK-1160#SLICE-012"
  });

  const structured = parseStructuredTextResponse(response);
  assert.equal(structured.accepted, false);
  assert.equal(structured.blocker.code, RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED);
  assert.equal(structured.blocker.reason, "run_wait_tool_exception");
  assert.equal(structured.blocker.detail.tool, "workspace_agent_run_wait");
  assert.equal(
    structured.blocker.detail.error_message,
    "Cannot open [redacted absolute path]"
  );
});

const DISPATCH_EXCEPTION_DIAGNOSTIC_MAX_CHARS = 512;

const OVERLONG_THROWN_MESSAGE =
  "Cannot open /home/user/agent-chassis/wiki/work-records/WK-1160.json\n" +
  "detail-".repeat(300);

function createOverlongThrowingRegistry() {
  const overlong = () => {
    throw new Error(OVERLONG_THROWN_MESSAGE);
  };
  return createDispatchToolRegistry({
    backend: {
      startLaunch: overlong,
      getRunStatus: overlong,
      waitForRunStatus: overlong
    }
  });
}

function assertBoundedRedactedBlocker(structured, { reason, tool }) {

  assert.equal(structured.accepted, false);
  assert.equal(structured.blocker.code, RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED);
  assert.equal(structured.blocker.reason, reason);
  assert.equal(structured.blocker.detail.tool, tool);
  assert.equal(structured.blocker.detail.error_name, "Error");

  const message = structured.blocker.detail.error_message;

  assert.ok(message.includes("[redacted absolute path]"));
  assert.ok(!message.includes("/home/user/agent-chassis/wiki/work-records/WK-1160.json"));

  assert.equal(message.length, DISPATCH_EXCEPTION_DIAGNOSTIC_MAX_CHARS);
  assert.ok(message.length <= DISPATCH_EXCEPTION_DIAGNOSTIC_MAX_CHARS);

  assert.equal(structured.blocker.detail.error_message_truncated, true);
}

test("workspace_agent_dispatch caps an overlong redacted thrown diagnostic", async () => {
  const tools = createOverlongThrowingRegistry();
  const response = await tools.get("workspace_agent_dispatch").handler({
    role: "worker",
    subject: "WK-1160#SLICE-012",
    app: "codex"
  });

  const structured = parseStructuredTextResponse(response);
  assertBoundedRedactedBlocker(structured, {
    reason: "dispatch_tool_exception",
    tool: "workspace_agent_dispatch"
  });
});

test("workspace_agent_run_status caps an overlong redacted thrown diagnostic", async () => {
  const tools = createOverlongThrowingRegistry();
  const response = await tools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_test",
    subject: "WK-1160#SLICE-012"
  });

  const structured = parseStructuredTextResponse(response);
  assertBoundedRedactedBlocker(structured, {
    reason: "run_status_tool_exception",
    tool: "workspace_agent_run_status"
  });
});

test("workspace_agent_run_wait caps an overlong redacted thrown diagnostic", async () => {
  const tools = createOverlongThrowingRegistry();
  const response = await tools.get("workspace_agent_run_wait").handler({
    monitor_handle: "wkmh_test",
    subject: "WK-1160#SLICE-012"
  });

  const structured = parseStructuredTextResponse(response);
  assertBoundedRedactedBlocker(structured, {
    reason: "run_wait_tool_exception",
    tool: "workspace_agent_run_wait"
  });
});

test("short thrown dispatch diagnostics are not marked truncated", async () => {
  const tools = createDispatchToolRegistry();
  const response = await tools.get("workspace_agent_dispatch").handler({
    role: "worker",
    subject: "WK-1160#SLICE-012",
    app: "codex"
  });

  const structured = parseStructuredTextResponse(response);
  assert.equal(structured.blocker.detail.error_message, "Cannot open [redacted absolute path]");
  assert.ok(
    structured.blocker.detail.error_message.length <= DISPATCH_EXCEPTION_DIAGNOSTIC_MAX_CHARS
  );
  assert.equal(structured.blocker.detail.error_message_truncated, false);
});

test("terminal worker monitoring invokes the trusted post-worker slice lifecycle and exposes the frozen WK target", async () => {
  const calls = [];
  const frozen = {
    ref: "refs/heads/wk/IN-0021/WK-1537",
    sha: "b".repeat(40),
    diff_base_sha: "a".repeat(40),
    diff_head_sha: "b".repeat(40),
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  };
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({
        accepted: true,
        run_id: "run-worker",
        monitor_handle: "wkmh_worker",
        role: "worker",
        subject: "WK-1537#SLICE-001",
        status: "succeeded",
        terminal: true,
        started_at: "2026-07-12T00:00:00.000Z",
        updated_at: "2026-07-12T00:01:00.000Z"
      }),
      runPostWorkerSliceLifecycle: async ({ workspace, status }) => {
        calls.push({ workspace, status });
        return {
          invoked: true,
          integrated: true,
          integration: { review_target: frozen },
          reviewer_dispatch: {
            tool: "workspace_agent_dispatch",
            args: { role: "reviewer", subject: "WK-1537#SLICE-003" },
            context: { frozen_review_target: frozen, complete_parent_wk_contract: true }
          }
        };
      },
      waitForRunStatus: async () => ({
        accepted: true,
        timed_out: false,
        run_id: "run-worker",
        monitor_handle: "wkmh_worker",
        role: "worker",
        subject: "WK-1537#SLICE-001",
        status: "succeeded",
        terminal: true,
        started_at: "2026-07-12T00:00:00.000Z",
        updated_at: "2026-07-12T00:01:00.000Z"
      })
    }
  });

  const first = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_worker",
    subject: "WK-1537#SLICE-001"
  }));
  const second = parseStructuredTextResponse(await tools.get("workspace_agent_run_wait").handler({
    monitor_handle: "wkmh_worker",
    subject: "WK-1537#SLICE-001",
    timeout_ms: 1000,
    poll_interval_ms: 500
  }));

  assert.equal(calls.length, 1, "one terminal worker run is integrated once per monitor lifecycle");
  assert.equal(calls[0].workspace.dir, "/home/user/agent-chassis");
  assert.deepEqual(first.slice_lifecycle.reviewer_dispatch.context.frozen_review_target, frozen);
  assert.equal(first.slice_lifecycle.reviewer_dispatch.args.subject, "WK-1537#SLICE-003");
  assert.deepEqual(second.slice_lifecycle, first.slice_lifecycle);
});

test("post-integration finalization failure resumes across repeated status and wait without reintegration", async () => {
  const harness = createResumableLifecycleHarness({ bindFailures: 1 });
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({ ...harness.status }),
      waitForRunStatus: async () => ({ ...harness.status }),
      runPostWorkerSliceLifecycle: harness.invoke
    }
  });

  const failed = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: harness.status.monitor_handle,
    subject: harness.status.subject
  }));
  assert.equal(failed.slice_lifecycle.phase, "integrated");
  assert.equal(failed.slice_lifecycle.integrated, true);
  assert.deepEqual(failed.slice_lifecycle.integration, harness.integrationResult);
  assert.deepEqual(harness.counts(), { integrationCalls: 1, bindCalls: 1 });

  const resumed = parseStructuredTextResponse(await tools.get("workspace_agent_run_wait").handler({
    monitor_handle: harness.status.monitor_handle,
    subject: harness.status.subject,
    timeout_ms: 1000,
    poll_interval_ms: 500
  }));
  assert.equal(resumed.slice_lifecycle.phase, "finalized");
  assert.deepEqual(resumed.slice_lifecycle.integration, harness.integrationResult);
  assert.deepEqual(harness.counts(), { integrationCalls: 1, bindCalls: 2 });

  const repeated = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: harness.status.monitor_handle,
    subject: harness.status.subject
  }));
  assert.deepEqual(repeated.slice_lifecycle, resumed.slice_lifecycle);
  assert.deepEqual(harness.counts(), { integrationCalls: 1, bindCalls: 2 });
});

test("concurrent status and wait polling share one phased post-worker lifecycle", async () => {
  let releaseIntegration;
  const integrationGate = new Promise((resolve) => { releaseIntegration = resolve; });
  const harness = createResumableLifecycleHarness({ integrationGate });
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({ ...harness.status }),
      waitForRunStatus: async () => ({ ...harness.status }),
      runPostWorkerSliceLifecycle: harness.invoke
    }
  });

  const statusPromise = tools.get("workspace_agent_run_status").handler({
    monitor_handle: harness.status.monitor_handle,
    subject: harness.status.subject
  });
  const waitPromise = tools.get("workspace_agent_run_wait").handler({
    monitor_handle: harness.status.monitor_handle,
    subject: harness.status.subject,
    timeout_ms: 1000,
    poll_interval_ms: 500
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.counts().integrationCalls, 1);
  releaseIntegration();
  const [statusResult, waitResult] = await Promise.all([statusPromise, waitPromise]);
  const first = parseStructuredTextResponse(statusResult);
  const second = parseStructuredTextResponse(waitResult);
  assert.equal(first.slice_lifecycle.phase, "finalized");
  assert.deepEqual(second.slice_lifecycle, first.slice_lifecycle);
  assert.deepEqual(harness.counts(), { integrationCalls: 1, bindCalls: 1 });
});

test("process-local checkpoint loss recovers integrated phase only from canonical review and exact matching bindings and refs", async () => {
  const harness = createResumableLifecycleHarness({ bindFailures: 1 });
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  await assert.rejects(
    runPostWorkerSliceLifecycle({ workspace, status: { ...harness.status }, deps: harness.deps }),
    /injected post-integration context failure/
  );
  assert.deepEqual(harness.counts(), { integrationCalls: 1, bindCalls: 1 });

  const recovered = await runPostWorkerSliceLifecycle({
    workspace,
    status: { ...harness.status },
    deps: harness.deps
  });
  assert.equal(recovered.phase, "finalized");
  assert.equal(recovered.integration.recovered, true);
  assert.equal(recovered.integration.previous_wk_sha, "a".repeat(40));
  assert.deepEqual(recovered.integration.review_target, harness.integrationResult.review_target);
  assert.deepEqual(harness.counts(), { integrationCalls: 1, bindCalls: 2 });
});

test("restart recovery-only mode refuses pre-integration, missing, mismatched, and dirty evidence without integrating", async () => {
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };

  const preIntegration = createResumableLifecycleHarness();
  assert.equal(await runPostWorkerSliceLifecycle({
    workspace,
    status: { ...preIntegration.status },
    deps: { ...preIntegration.deps, recoveryOnly: true }
  }), null);
  assert.deepEqual(preIntegration.counts(), { integrationCalls: 0, bindCalls: 0 });

  const missing = createResumableLifecycleHarness();
  await assert.rejects(
    runPostWorkerSliceLifecycle({
      workspace,
      status: { ...missing.status },
      deps: { ...missing.deps, recoveryOnly: true, resolveManagedRunBinding: () => null }
    }),
    /complete launcher-owned WK and slice provisioning binding/
  );
  assert.deepEqual(missing.counts(), { integrationCalls: 0, bindCalls: 0 });

  for (const failure of ["dirty", "mismatched"]) {
    const harness = createResumableLifecycleHarness();
    harness.setCanonicalStatus("review");
    const normalRunGit = harness.deps.runGit;
    await assert.rejects(
      runPostWorkerSliceLifecycle({
        workspace,
        status: { ...harness.status },
        deps: {
          ...harness.deps,
          recoveryOnly: true,
          runGit: (input) => {
            if (failure === "dirty" && input.args[0] === "status") {
              return { ok: true, stdout: "?? unexpected.txt\n" };
            }
            if (failure === "mismatched" && input.args[0] === "rev-parse" &&
                String(input.args.at(-1)).includes("slice/")) {
              return { ok: true, stdout: `${"c".repeat(40)}\n` };
            }
            return normalRunGit(input);
          }
        }
      }),
      failure === "dirty" ? /retained slice worktree does not match/ : /matching integrated slice and WK refs/
    );
    assert.deepEqual(harness.counts(), { integrationCalls: 0, bindCalls: 0 });
  }
});

test("monitor restart recovery is attempted only after normal unknown-handle lookup", async () => {
  let recoveryCalls = 0;
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({
        accepted: false,
        refusal: { code: "monitor_handle_subject_mismatch", reason: "subject_mismatch", detail: null }
      }),
      recoverIntegratedWorkerRun: async () => { recoveryCalls += 1; return null; }
    }
  });
  const mismatch = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_restart_selector",
    subject: "WK-1537#SLICE-011"
  }));
  assert.equal(mismatch.accepted, false);
  assert.equal(mismatch.blocker.code, RUNTIME_BLOCKER_CODES.MONITOR_HANDLE_SUBJECT_MISMATCH);
  assert.equal(recoveryCalls, 0);

  const unknownTools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({
        accepted: false,
        refusal: { code: "monitor_handle_unknown", reason: "unknown_run_or_handle", detail: null }
      }),
      recoverIntegratedWorkerRun: async () => { recoveryCalls += 1; return null; }
    }
  });
  const unknown = parseStructuredTextResponse(await unknownTools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_restart_selector",
    subject: "WK-1537#SLICE-011"
  }));
  assert.equal(unknown.accepted, false);
  assert.equal(unknown.blocker.code, RUNTIME_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN);
  assert.equal(recoveryCalls, 1);
});

test("run monitoring never invokes slice integration before confirmed worker termination", async () => {
  let lifecycleCalls = 0;
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({
        accepted: true,
        run_id: "run-worker-live",
        monitor_handle: "wkmh_worker_live",
        role: "worker",
        subject: "WK-1537#SLICE-001",
        status: "running",
        terminal: false,
        started_at: "2026-07-12T00:00:00.000Z",
        updated_at: "2026-07-12T00:00:30.000Z"
      }),
      runPostWorkerSliceLifecycle: async () => { lifecycleCalls += 1; }
    }
  });

  const result = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_worker_live",
    subject: "WK-1537#SLICE-001"
  }));
  assert.equal(result.terminal, false);
  assert.equal("slice_lifecycle" in result, false);
  assert.equal(lifecycleCalls, 0);
});

test("the production post-worker helper integrates the committed binding only after terminal success and freezes canonical WK review state", async () => {
  const calls = { integration: [], transition: [], bind: [], commitExercised: 0 };
  const commit = "b".repeat(40);
  const base = "a".repeat(40);
  const wkRef = "refs/heads/wk/IN-0021/WK-1537";
  const reviewTarget = {
    ref: wkRef,
    sha: commit,
    diff_base_sha: base,
    diff_head_sha: commit,
    diff_range: `${base}..${commit}`,
    complete_parent_wk_contract: true,
    accumulated_wk_diff: true
  };
  const sliceBinding = {
    unit_address: "IN-0021/WK-1537/SLICE-001",
    output_branch: "slice/IN-0021/WK-1537/SLICE-001",
    worktree_path: "/tmp/slice-IN-0021-WK-1537-SLICE-001",
    base_sha: base
  };
  const wkBinding = {
    unit_address: "IN-0021/WK-1537",
    output_branch: "wk/IN-0021/WK-1537",
    worktree_path: "/tmp/wk-IN-0021-WK-1537",
    base_sha: base
  };
  const result = await runPostWorkerSliceLifecycle({
    workspace: { repo: "agent-chassis", dir: "/home/user/agent-chassis" },
    status: {
      run_id: "run-worker",
      monitor_handle: "wkmh_worker",
      role: "worker",
      subject: "WK-1537#SLICE-001",
      status: "succeeded",
      terminal: true
    },
    deps: {
      resolveManagedRunBinding: () => ({
        record_id: "WK-1537",
        slice_id: "SLICE-001",
        slice_binding: sliceBinding,
        wk_binding: wkBinding,
        validation_worktree_path: wkBinding.worktree_path
      }),
      resolveCanonicalReviewUnit: () => ({
        record_id: "WK-1537",
        slice_id: "SLICE-003",
        subject: "WK-1537#SLICE-003",
        unit_contract: "canonical-review"
      }),
      runGit: ({ repo, args }) => {
        if (args[0] === "symbolic-ref") return { ok: true, stdout: `${wkRef}\n` };
        if (args[0] === "status" || args[0] === "reset") return { ok: true, stdout: "" };
        if (args[0] === "rev-parse" && repo.endsWith("WK-1537")) return { ok: true, stdout: `${commit}\n` };
        return { ok: true, stdout: `${commit}\n` };
      },
      setWorkRecordStatusByUnit: async (input) => {
        calls.transition.push(input);
        return { valid: true, written: true };
      },
      integrateCommittedSlice: async (input) => {
        calls.integration.push(input);
        await input.transitionToReview({ unitAddress: "WK-1537", status: "review", reviewTarget });
        return { review_target: reviewTarget, wk_ref: wkRef, wk_sha: commit };
      },
      bindFrozenReviewContext: (input) => {
        calls.bind.push(input);
        return { schema_version: "workspace-agent-frozen-wk-review-context.v1" };
      },
      markCommitAuthorityExercised: () => { calls.commitExercised += 1; }
    }
  });
  assert.equal(calls.integration.length, 1);
  assert.equal(calls.integration[0].workerTerminated, true);
  assert.equal(calls.integration[0].wkRef, "refs/heads/wk/IN-0021/WK-1537");
  assert.deepEqual(calls.transition, [{
    dir: "/home/user/agent-chassis",
    unitAddress: "WK-1537",
    status: "review"
  }]);
  assert.equal(calls.bind.length, 1);
  assert.equal(calls.bind[0].provisioning.validation_worktree_path, wkBinding.worktree_path);
  assert.equal(calls.commitExercised, 1);
  assert.deepEqual(result.reviewer_dispatch.args, { role: "reviewer", subject: "WK-1537#SLICE-003" });
  assert.deepEqual(result.reviewer_dispatch.context.frozen_review_target, reviewTarget);
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
    monitor_handle: "wkmh_reviewer",
    subject: "WK-1537#SLICE-003"
  }));
  assert.equal(result.review_result.review_outcome, "changes_requested");
  assert.equal("slice_lifecycle" in result, false);
  assert.equal(lifecycleCalls, 0, "findings do not trigger integration, cleanup, revert, or reissue");
});

test("the trusted monitor lifecycle exposes cleanup only through an explicit orchestrator disposition", () => {
  const calls = [];
  const result = runRetainedSliceCleanupDisposition({
    workspace: { dir: "/home/user/agent-chassis" },
    run: { run_id: "run-worker", monitor_handle: "wkmh_worker", terminal: true },
    disposition: "orchestrator-cancelled",
    deps: {
      releaseRetainedSlice: (input) => {
        calls.push(input);
        return { reaped: true, disposition: input.disposition };
      }
    }
  });
  assert.equal(result.reaped, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runId, "run-worker.slice");
  assert.equal(calls[0].workerTerminated, true);
  assert.equal(calls[0].disposition, "orchestrator-cancelled");
  assert.equal(calls[0].reviewResolved, true);

  runRetainedSliceCleanupDisposition({
    workspace: { dir: "/home/user/agent-chassis" },
    run: { run_id: "run-worker", monitor_handle: "wkmh_worker", terminal: true },
    disposition: "accepted-review",
    reviewStatus: {
      accepted: true,
      terminal: true,
      role: "reviewer",
      review_result: { clean_review: true }
    },
    deps: { releaseRetainedSlice: (input) => { calls.push(input); return { reaped: true }; } }
  });
  assert.equal(calls[1].reviewResolved, true, "accepted cleanup consumes trusted structured clean-review evidence");
});

test("WK-1555#SLICE-033 the post-worker lifecycle delegates integration to the host adapter and consumes its result", async () => {
  const harness = createResumableLifecycleHarness();
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
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
    workspace,
    status: { ...harness.status },
    deps: { ...harness.deps, hostSliceIntegrationAdapter }
  });

  assert.equal(harness.counts().integrationCalls, 0);

  assert.equal(adapterCalls.length, 1);
  assert.deepEqual(adapterCalls[0], {
    assigned_unit: harness.status.subject,
    launch_ref: harness.status.monitor_handle,
    run_id: harness.status.run_id,
    retry_id: 0
  });

  assert.equal(finalized.phase, "finalized");
  assert.equal(finalized.integrated, true);
  assert.deepEqual(finalized.reviewer_dispatch.context.frozen_review_target, harness.integrationResult.review_target);
});

test("WK-1555#SLICE-033 a host-delegated integration refusal fails the lifecycle closed", async () => {
  const harness = createResumableLifecycleHarness();
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const hostSliceIntegrationAdapter = async () => ({
    accepted: false,
    refusal: { code: "operator_recovery_needed", reason: "host_write_authority_broker_refused", detail: null }
  });
  await assert.rejects(
    runPostWorkerSliceLifecycle({
      workspace,
      status: { ...harness.status },
      deps: { ...harness.deps, hostSliceIntegrationAdapter }
    }),
    /host-delegated slice-to-WK integration failed/
  );
  assert.equal(harness.counts().integrationCalls, 0);
});

test("WK-1587 a non-final slice integration leaves the WK dispatchable and dispatches no reviewer", async () => {
  const harness = createResumableLifecycleHarness();
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };

  const nonFinalIntegration = {
    ...harness.integrationResult,
    review_target: null
  };
  let integrationCalls = 0;
  const finalized = await runPostWorkerSliceLifecycle({
    workspace,
    status: { ...harness.status, run_id: "run-worker-nonfinal" },
    deps: {
      ...harness.deps,
      integrateCommittedSlice: async () => { integrationCalls += 1; return nonFinalIntegration; }
    }
  });
  assert.equal(integrationCalls, 1);
  assert.equal(finalized.phase, "finalized");
  assert.equal(finalized.integrated, true);
  assert.equal(finalized.wk_transitioned_to_review, false);
  assert.equal(finalized.reviewer_dispatch, null, "a non-final slice dispatches no reviewer");
  assert.deepEqual(finalized.integration, nonFinalIntegration);

  assert.equal(harness.counts().bindCalls, 0);
});

test("WK-1587 concurrent integration of two slices of the same WK is serialized per WK", async () => {
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const makeDeps = (label, gate) => {
    const harness = createResumableLifecycleHarness();
    return {
      ...harness.deps,
      integrateCommittedSlice: async () => {
        order.push(`${label}:enter`);
        if (gate) await gate;
        order.push(`${label}:exit`);
        return {
          ...harness.integrationResult,
          review_target: null
        };
      }
    };
  };
  const first = runPostWorkerSliceLifecycle({
    workspace,
    status: { ...createResumableLifecycleHarness().status, run_id: "run-serial-A" },
    deps: makeDeps("A", firstGate)
  });
  const second = runPostWorkerSliceLifecycle({
    workspace,
    status: { ...createResumableLifecycleHarness().status, run_id: "run-serial-B" },
    deps: makeDeps("B", null)
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ["A:enter"], "the second slice must not integrate while the first holds the per-WK lock");
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["A:enter", "A:exit", "B:enter", "B:exit"]);
});
