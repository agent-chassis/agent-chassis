import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKEND_REFUSAL_CODES
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES
} from "../packages/agent-launch-cli/src/lib/worktree-provisioning-dispatch.mjs";
import { createTestDispatchBackend } from "./workspace-agent-dispatch-backend-shared.mjs";

const MAIN_REPO = "/srv/agent-chassis";
const WORKTREE_ROOT = "/srv/agent-chassis/.agent-worktrees";
const BASE_SHA = "1111111111111111111111111111111111111111";

function ok(stdout = "") {
  return { ok: true, status: 0, stdout, stderr: "" };
}

function makeRunGit({ expected = { summary: "expected envelope" }, events }) {
  return ({ args }) => {
    if (args[0] === "show-ref") {
      events.push("git:show-ref");
      return ok("");
    }
    if (args[0] === "rev-parse") {
      events.push("git:rev-parse");
      return ok(`${BASE_SHA}\n`);
    }
    if (args[0] === "show") {
      events.push("git:show-wk-record");
      return ok(JSON.stringify({ id: "WK-1432", expected }));
    }
    throw new Error(`unexpected git args in dispatch wire test: ${args.join(" ")}`);
  };
}

function makeProvisioningConfig({ events, expected }) {
  return {
    mainRepo: MAIN_REPO,
    worktreeRoot: WORKTREE_ROOT,
    deps: {
      integrationBranchRef: () => "integration/IN-0017",
      runGit: makeRunGit({ expected, events }),
      allocatePerWkWorktree: (input) => {
        events.push("allocate");
        assert.equal(input.mainRepo, MAIN_REPO);
        assert.equal(input.initiative, "IN-0017");
        assert.equal(input.subject, "WK-1432#SLICE-003");
        assert.equal(input.launchRef, "wkmh_wire_test");
        assert.equal(input.runId, "wkdb_wire_test");
        assert.equal(input.retryId, 0);
        assert.equal(input.worktreeRoot, WORKTREE_ROOT);
        return {
          output_branch: "wk/IN-0017/WK-1432",
          worktree_path: `${WORKTREE_ROOT}/WK-1432`,
          write_scope: ["tests/worktree-provisioning-dispatch-wire.test.mjs"],
          base_sha: BASE_SHA,
          base_ref: "integration/IN-0017"
        };
      }
    }
  };
}

function makeBackend({ events, expected, launchExecutor }) {
  return createTestDispatchBackend({
    runIdFactory: () => "wkdb_wire_test",
    monitorHandleFactory: () => "wkmh_wire_test",
    clock: () => Date.parse("2026-07-08T06:59:45.845Z"),
    worktreeProvisioning: makeProvisioningConfig({ events, expected }),
    launchExecutor
  });
}

test("dispatch backend provisions the WK worktree before spawning the worker role process", async () => {
  const events = [];
  let executorInput = null;
  const backend = makeBackend({
    events,
    launchExecutor: async (input) => {
      events.push("executor");
      executorInput = input;
      return {
        accepted: true,
        status: "launching",
        probe: async () => ({ status: "running" })
      };
    }
  });

  const result = await backend.startLaunch({
    caller_session_id: "session-wire",
    role: "worker",
    app: "codex",
    subject: "WK-1432#SLICE-003",
    readiness: { dispatchable: true, initiative: "IN-0017" }
  });

  assert.equal(result.accepted, true);
  assert.equal(result.run_id, "wkdb_wire_test");
  assert.equal(result.monitor_handle, "wkmh_wire_test");
  assert.deepEqual(events, [
    "git:show-ref",
    "git:rev-parse",
    "git:show-wk-record",
    "allocate",
    "executor"
  ]);

  assert.equal(executorInput.workspace_dir, `${WORKTREE_ROOT}/WK-1432`);
  assert.equal(executorInput.worktree_provisioning.base_sha, BASE_SHA);
  assert.equal(executorInput.worktree_provisioning.expected_envelope_present, true);
  assert.equal(executorInput.provisionedWorktreeGitBinding.worktreePath, `${WORKTREE_ROOT}/WK-1432`);
  assert.equal(
    executorInput.provisioned_worktree_git_binding.gitDir,
    `${MAIN_REPO}/.git/worktrees/WK-1432`
  );
});

test("dispatch backend propagates structured provisioning refusal without spawning or pending handle", async () => {
  const events = [];
  const backend = makeBackend({
    events,
    expected: {},
    launchExecutor: async () => {
      events.push("executor");
      return { accepted: true, status: "launching" };
    }
  });

  const result = await backend.startLaunch({
    caller_session_id: "session-wire",
    role: "worker",
    app: "codex",
    subject: "WK-1432#SLICE-003",
    readiness: { dispatchable: true, initiative: "IN-0017" }
  });

  assert.equal(result.accepted, false);
  assert.equal(result.refusal.code, BACKEND_REFUSAL_CODES.LAUNCH_REFUSED);
  assert.equal(result.refusal.reason, "worktree_provisioning_refused");
  assert.equal(
    result.refusal.detail.code,
    WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.EXPECTED_ENVELOPE_MISSING
  );
  assert.deepEqual(events, ["git:show-ref", "git:rev-parse", "git:show-wk-record"]);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "run_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "monitor_handle"), false);
  assert.deepEqual(backend.__snapshotRuns(), []);
});
