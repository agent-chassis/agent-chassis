

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { randomUUID } from "node:crypto";

import { ATTEMPT_EVENT_KINDS, admitAttemptCommand } from "@agent-chassis/agent-launch-core";
import { publishAttemptJournalEvents } from
  "../../packages/agent-launch-cli/src/lib/managed-run-process-identity-store.mjs";

import { createDirectSliceIntegrationAdapter } from
  "../../packages/wiki-mcp/src/lib/dispatch-launch-runtime.mjs";
import { runPostWorkerSliceLifecycle } from
  "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle.mjs";
import { createGetRunResultTask } from
  "../../packages/wiki-mcp/src/lib/task-get-run-result.mjs";
import { canonicalSerializeLauncherAgentSessionContract, mintTrustedStdioMcpConduitAuthority,
  resolveLauncherAgentSessionContract } from
  "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";
import { buildLifecycleFailure, publishableLifecycleFailure, publishableLifecycleResolution } from
  "../../packages/wiki-mcp/src/lib/dispatch-lifecycle-failure-disclosure.mjs";
import { createLifecycleCheckpoint, lifecycleRetryFactsOf, POST_WORKER_LIFECYCLE_CHECKPOINT,
  projectLifecycleResolution, recordLifecycleFailure } from
  "../../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle-bindings.mjs";
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

export function createGetRunResultObserver({ workspace, dispatchBackend, sessionIdentity,
  jsonContent = defaultJsonContent, responseEnv = process.env }) {
  const contract = resolveLauncherAgentSessionContract(mintTrustedStdioMcpConduitAuthority({
    family: "codex", role: "orchestrator", assignedUnit: "IN-0001", workspaceDir: workspace.dir
  }));
  const bytes = canonicalSerializeLauncherAgentSessionContract(contract).toString("utf8");
  const sessionEnv = { WIKI_MCP_TOOL_PROFILE: "orchestrator", WIKI_MCP_ASSIGNED_UNIT: "IN-0001",
    WIKI_MCP_AGENT_SESSION_CONTRACT: bytes, WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT: bytes };
  const task = createGetRunResultTask({ workspace, sessionEnv, responseEnv,
    preparedDispatchBackend: dispatchBackend, dispatchSessionIdentity: sessionIdentity });
  return async args => jsonContent(task.presentObservation(await task.observe(args), args));
}

export function createLifecycleExecution({ workspace, dispatchBackend, status }) {
  const checkpoint = createLifecycleCheckpoint();
  let lifecycle = null;
  let retryFacts = null;
  const project = () => ({ lifecycle: publishableLifecycleFailure(lifecycle),
    resolution: publishableLifecycleResolution(projectLifecycleResolution({ lifecycle, checkpoint })) });
  return {
    checkpoint,
    get retryFacts() { return retryFacts; },
    read: project,
    async execute() {
      const input = { ...status, [POST_WORKER_LIFECYCLE_CHECKPOINT]: checkpoint };
      try {
        lifecycle = await dispatchBackend.runPostWorkerSliceLifecycle({ workspace, status: input });
        retryFacts = null;
      } catch (error) {
        lifecycle = recordLifecycleFailure(checkpoint, buildLifecycleFailure(checkpoint, error));
        retryFacts = lifecycleRetryFactsOf(error);
        const publication = await dispatchBackend.recordManagedLifecycleFailure({
          subject: status.subject, invocationId: randomUUID(), failure: lifecycle });
        assert.equal(publication.ok, true, JSON.stringify(publication));
        checkpoint.failure_history_durability = Object.freeze({ state: "durable" });
      }
      return project();
    },
    history() {
      const observed = dispatchBackend.readManagedRunObservation({ subject: status.subject,
        attemptId: status.run_id, detail: { kind: "failure_history", limit: 100 } });
      assert.equal(observed.ok, true, JSON.stringify(observed));
      return observed;
    }
  };
}
