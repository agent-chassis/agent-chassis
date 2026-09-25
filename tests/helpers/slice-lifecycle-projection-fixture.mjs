

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { ATTEMPT_EVENT_KINDS, admitAttemptCommand } from "@agent-chassis/agent-launch-core";
import { publishAttemptJournalEvents } from
  "../../packages/agent-launch-cli/src/lib/managed-run-process-identity-store.mjs";

import { createDirectSliceIntegrationAdapter } from
  "../../packages/wiki-mcp/src/lib/dispatch-launch-runtime.mjs";
import { runPostWorkerSliceLifecycle } from
  "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle.mjs";
import { registerRunMonitorRoutes } from
  "../../packages/wiki-mcp/src/lib/dispatch-run-monitor-routes.mjs";
import { jsonContent as defaultJsonContent } from
  "../../packages/wiki-mcp/src/lib/mcp-response.mjs";

export function sliceLifecycleProvisioning({
  initiative, recordId, sliceId, sliceRef, baseSha, sliceWorktree, wkWorktree,
  dispatchTuple = null
}) {
  return Object.freeze({
    record_id: recordId,
    slice_id: sliceId,
    slice_binding: Object.freeze({
      unit_address: `${initiative}/${recordId}/${sliceId}`,
      output_branch: sliceRef,
      base_sha: baseSha,
      worktree_path: sliceWorktree,
      retry_id: dispatchTuple?.retry_id ?? 0,
      ...(dispatchTuple === null ? {} : {
        run_id: `${dispatchTuple.run_id}.slice`,
        launch_ref: dispatchTuple.launch_ref
      })
    }),
    wk_binding: Object.freeze({
      output_branch: `refs/heads/wk/${initiative}/${recordId}`,
      worktree_path: wkWorktree
    }),
    validation_worktree_path: wkWorktree
  });
}

export function sliceIntegrationAdapter({ requestCommittedSliceIntegration }) {
  return createDirectSliceIntegrationAdapter({ requestCommittedSliceIntegration });
}

export function productionSliceLifecycle({
  provisioning, hostSliceIntegrationAdapter, runGit, verifyDeliveredProofs = async () => null,
  deps = {}
}) {
  return ({ workspace, status }) => runPostWorkerSliceLifecycle({
    workspace,
    status,
    deps: {
      resolveManagedRunBinding: () => provisioning,
      reconcileIntegratedSliceRecord: async () => null,
      resolveCommittedSliceIntegrationContinuation: async () => null,
      hostSliceIntegrationAdapter,
      verifyDeliveredProofs,
      runGit,
      ...deps
    }
  });
}

export async function createLifecycleFailureJournal(scope, subject, dispatchTuple) {
  const mainRepo = await scope.acquire("attempt-journal",
    () => mkdtempSync(path.join(os.tmpdir(), "lifecycle-failure-journal-")),
    (dir) => rmSync(dir, { recursive: true, force: true }));
  seedLifecycleFailureJournal(mainRepo, subject, dispatchTuple);
  return mainRepo;
}

export function seedLifecycleFailureJournal(mainRepo, subject, dispatchTuple) {
  const attempt = {
    assigned_unit: subject,
    launch_ref: "managed-run-subject-reservation",
    run_id: "reservation-1",
    retry_id: 0
  };
  let events = [];
  for (const [kind, payload] of [
    [ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED, {}],
    [ATTEMPT_EVENT_KINDS.PENDING_PUBLISHED, { dispatch_tuple: dispatchTuple }]
  ]) {
    const admitted = admitAttemptCommand({
      repository: mainRepo, subject, events, attempt, kind, payload,
      generationDigest: kind === ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED ? "generation-1" : null,
      wkTip: kind === ATTEMPT_EVENT_KINDS.RESERVATION_CLAIMED ? "tip-1" : null
    });
    assert.equal(admitted.admitted, true, admitted.refusal?.reason);
    events = admitted.events;
  }
  publishAttemptJournalEvents({ mainRepo, repository: mainRepo, subject, events });
  return mainRepo;
}

export function registeredRunStatus({
  registerRoutes = registerRunMonitorRoutes,
  workspace,
  dispatchBackend,
  jsonContent = defaultJsonContent,
  sessionIdentity,
  runStatusCallBudgetMs = undefined
}) {
  const tools = new Map();
  registerRoutes({
    registerTool: (name, config, handler) => tools.set(name, { config, handler }),
    workspaceRepos: [workspace],
    z,
    jsonContent,
    resolveWorkspaceRepo: () => workspace,
    dispatchBackend,
    dispatchSessionIdentity: sessionIdentity,
    ...(runStatusCallBudgetMs === undefined ? {} : { runStatusCallBudgetMs })
  });
  return tools.get("workspace_agent_run_status").handler;
}
