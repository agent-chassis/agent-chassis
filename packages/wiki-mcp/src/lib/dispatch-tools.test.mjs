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
            args: { role: "reviewer", subject: "WK-1537" },
            context: { frozen_review_target: frozen, complete_parent_wk_contract: true }
          }
        };
      }
    }
  });

  const first = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_worker",
    subject: "WK-1537#SLICE-001"
  }));
  const second = parseStructuredTextResponse(await tools.get("workspace_agent_run_status").handler({
    monitor_handle: "wkmh_worker",
    subject: "WK-1537#SLICE-001"
  }));

  assert.equal(calls.length, 1, "one terminal worker run is integrated once per monitor lifecycle");
  assert.equal(calls[0].workspace.dir, "/home/user/agent-chassis");
  assert.deepEqual(first.slice_lifecycle.reviewer_dispatch.context.frozen_review_target, frozen);
  assert.equal(first.slice_lifecycle.reviewer_dispatch.args.subject, "WK-1537");
  assert.deepEqual(second.slice_lifecycle, first.slice_lifecycle);
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
  const calls = { integration: [], transition: [] };
  const commit = "b".repeat(40);
  const reviewTarget = { ref: "refs/heads/wk/IN-0021/WK-1537", sha: commit };
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
      resolveWorktreeBinding: () => ({
        unit_address: "IN-0021/WK-1537/SLICE-001",
        output_branch: "slice/IN-0021/WK-1537/SLICE-001",
        worktree_path: "/tmp/slice-IN-0021-WK-1537-SLICE-001",
        base_sha: "a".repeat(40)
      }),
      runGit: () => ({ ok: true, stdout: `${commit}\n` }),
      setWorkRecordStatusByUnit: async (input) => {
        calls.transition.push(input);
        return { valid: true, written: true };
      },
      integrateCommittedSlice: async (input) => {
        calls.integration.push(input);
        await input.transitionToReview({ unitAddress: "WK-1537", status: "review", reviewTarget });
        return { review_target: reviewTarget };
      }
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
  assert.deepEqual(result.reviewer_dispatch.args, { role: "reviewer", subject: "WK-1537" });
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
        subject: "WK-1537",
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
    subject: "WK-1537"
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
