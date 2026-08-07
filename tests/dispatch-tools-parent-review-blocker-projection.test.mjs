import test from "node:test";
import assert from "node:assert/strict";

import { registerDispatchTools } from "../packages/wiki-mcp/src/lib/dispatch-tools/register.mjs";
import { RUNTIME_BLOCKER_CODES } from "../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

const SUBJECT = "WK-1930#SLICE-005";
const RECORD_ID = "WK-1930";
const schemaStub = new Proxy({}, { get: () => () => schemaStub });

function createFixture(refusal) {
  const tools = new Map();
  registerDispatchTools({
    registerTool: (name, _config, handler) => tools.set(name, handler),
    registeredToolNames: new Set(["workspace_agent_dispatch"]),
    workspaceRepos: [{ repo: "agent-chassis", dir: "/workspace" }],
    z: schemaStub,
    jsonContent: (value) => value,
    errorContent: (value) => value,
    resolveWorkspaceRepo: () => ({ repo: "agent-chassis", dir: "/workspace" }),
    validateDispatch: async () => ({
      dispatchable: true,
      decision_code: "dispatchable",
      reasons: [],
      recovery: { graph_impact: "not_required", admission_metrics: "fresh", target_resolution: "fresh" }
    }),
    validateLaunchIntent: async () => ({
      readiness: { dispatchable: true, decision_code: "dispatchable", reasons: [] },
      private_handoff: {
        authored_source_digest: "authored",
        full_persistence_snapshot_digest: "persistence",
        reviewed_unit_digest: "reviewed"
      }
    }),
    revalidatePrivateHandoff: async () => ({ valid: true }),
    dispatchBackend: {
      startLaunch: async () => ({ accepted: false, refusal }),
      getRunStatus: async () => ({ accepted: true }),
      waitForRunStatus: async () => ({ accepted: true })
    },
    dispatchSessionIdentity: "session-test"
  });
  return tools.get("workspace_agent_dispatch");
}

test("parent-review LAUNCH_REFUSED projects the declared coordinator blocker", async () => {
  const handler = createFixture({
    code: "launch_refused",
    reason: "managed_parent_wk_review_blocks_worker_dispatch",
    detail: {
      record_id: RECORD_ID,
      parent_status: "review",
      remediation: "move the parent out of whole-WK review, or complete the terminal cycle"
    }
  });

  const result = await handler({ role: "worker", subject: SUBJECT });

  assert.equal(result.accepted, false);
  assert.equal(result.blocker.code, RUNTIME_BLOCKER_CODES.MANAGED_PARENT_WK_REVIEW_BLOCKS_WORKER_DISPATCH);
  assert.equal(result.blocker.detail.parent_status, "review");
  assert.equal(result.blocker.detail.actor_recovery, "coordinator");
  assert.equal(result.blocker.detail.recovery_route, "reconcile_parent_wk_review_state");
  assert.deepEqual(result.blocker.detail.next_action_args, { role: "worker", subject: SUBJECT });
  assert.equal(result.next_action, "workspace_work_record_set_status(unit=WK-1930, status=active)");
});

test("an unrelated LAUNCH_REFUSED keeps the generic validation fallback", async () => {
  const handler = createFixture({
    code: "launch_refused",
    reason: "another_admission_reason",
    detail: { message: "unrelated" }
  });

  const result = await handler({ role: "worker", subject: SUBJECT });

  assert.equal(result.accepted, false);
  assert.equal(result.blocker.code, RUNTIME_BLOCKER_CODES.VALIDATION_FAILURE);
  assert.equal(result.blocker.reason, "another_admission_reason");
  assert.deepEqual(result.blocker.detail, {
    app: undefined,
    backend_refusal: { message: "unrelated" },
    admission: {
      role: "worker",
      subject: SUBJECT,
      subject_kind: "work_record_slice",
      readiness: {
        decision_code: "dispatchable",
        dispatchable: true,
        record_id: null,
        unit: null
      }
    }
  });
});
