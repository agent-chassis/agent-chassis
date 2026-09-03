

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  BACKEND_MISSING_RESULT_CODES
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  superviseChildLaunch
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-launch-core.mjs";
import {
  maybeWrapExecutorWithWorktreeProvisioning
} from "../../packages/agent-launch-cli/src/lib/backend-worktree-binding.mjs";
import {
  assertNoForbiddenTokens,
  createTestDispatchBackend
} from "../workspace-agent-dispatch-backend-shared.mjs";

function makeFakeChild({ pid = 5150 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.emitStdout = (chunk) => child.stdout.emit("data", chunk);
  child.emitStderr = (chunk) => child.stderr.emit("data", chunk);
  child.finish = (code, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("exit", code, signal);
  };
  return child;
}

function fakeCoreParser({ stdout, role, subject }) {
  if (typeof stdout !== "string" || stdout.trim().length === 0) {
    return {
      kind: "missing_result",
      missing_result: {
        code: BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
        reason: "claude_stdout_empty",
        detail: null
      }
    };
  }
  return {
    kind: "findings",
    findings: {
      schema_version: "claude-final-message.v1",
      format: "text",
      role: role ?? null,
      subject: subject ?? null,
      source: { kind: "claude_stdout", bytes: stdout.length },
      text: stdout
    }
  };
}

test("WK-0626 backend surfaces shared launch core findings final_result with full_response", async () => {
  const reportText = "## Findings\n- packages/y.mjs:9 — example\n";
  const backend = createTestDispatchBackend({
    launchExecutor: async (req) => {
      const child = makeFakeChild();
      const handle = superviseChildLaunch({
        child,
        parseFinalResult: fakeCoreParser,
        role: req.role,
        subject: req.subject,
        family: "claude"
      });
      child.emitStdout(reportText);
      child.finish(0);
      return handle;
    }
  });
  const launch = await backend.startLaunch({
    caller_session_id: "session-LC-A",
    role: "worker",
    app: "codex",
    model: "gpt-5.5",
    subject: "WK-0626#SLICE-001"
  });
  const status = await backend.getRunStatus({
    caller_session_id: "session-LC-A",
    monitor_handle: launch.monitor_handle
  });
  assert.equal(status.status, "succeeded");
  assert.equal(status.final_result.kind, "findings");
  assert.equal(status.final_result.findings.text, reportText);
  assert.ok(status.final_result.full_response, "full_response must survive the backend boundary");
  assert.equal(status.final_result.full_response.text, reportText);
});

test("WK-0626 backend preserves bounded stderr detail for shared launch core failed terminal", async () => {
  const backend = createTestDispatchBackend({
    launchExecutor: async (req) => {
      const child = makeFakeChild();
      const handle = superviseChildLaunch({
        child,
        parseFinalResult: fakeCoreParser,
        role: req.role,
        subject: req.subject,
        family: "claude"
      });
      child.emitStderr("Error: ANTHROPIC_API_KEY is not set\n");
      child.finish(1);
      return handle;
    }
  });
  const launch = await backend.startLaunch({
    caller_session_id: "session-LC-B",
    role: "worker",
    app: "codex",
    model: "gpt-5.5",
    subject: "WK-0626#SLICE-001"
  });
  const status = await backend.getRunStatus({
    caller_session_id: "session-LC-B",
    monitor_handle: launch.monitor_handle
  });
  assert.equal(status.status, "failed");
  assert.equal(status.final_result.kind, "missing_result");

  const detail = status.final_result.missing_result.detail;
  assert.ok(detail.stderr_bytes > 0, "stderr_bytes must be non-zero");
  assert.match(detail.stderr_tail, /ANTHROPIC_API_KEY is not set/);
  assert.equal(detail.exit_code, 1);
  assert.equal(status.final_result.full_response, null);
  assertNoForbiddenTokens(status, "shared-launch-core-stderr-missing-result");
});

test("WK-0755 exit-without-close child terminates the flush gate instead of hanging", async () => {
  const child = makeFakeChild();
  const handle = superviseChildLaunch({
    child,
    parseFinalResult: fakeCoreParser,
    role: "reviewer",
    subject: "WK-0755#shared-core-flush-gate-test-hang",
    family: "claude"
  });
  child.emitStdout("## Findings\n- packages/z.mjs:1 — example\n");

  child.finish(0);

  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("probe() hung on the flush gate (regression)")),
      4000
    );
  });
  let probe;
  try {
    probe = await Promise.race([handle.probe(), timeout]);
  } finally {
    clearTimeout(timer);
  }

  assert.equal(probe.status, "succeeded");
  assert.equal(probe.final_result.kind, "findings");
  assert.match(probe.final_result.findings.text, /packages\/z\.mjs:1/);
});

test("WK-2261 executor consumes one launcher-private provisioning ticket without leaking it", async () => {
  const ticket = Object.freeze({});
  const selectedUnit = Object.freeze({
    kind: "slice",
    address: "WK-2261#SLICE-004",
    record_id: "WK-2261",
    slice_id: "SLICE-004",
    repo: "agent-chassis/agent-chassis"
  });
  const authority = Object.freeze({
    unit_address: "IN-0038/WK-2261/SLICE-004",
    selected_unit: selectedUnit,
    source: "wiki/work-records/WK-2261.json#SLICE-004",
    source_digest: "sha256:scope",
    source_version: "work-record.v1",
    read_scope: Object.freeze(["README.md"]),
    repo_paths: Object.freeze(["README.md"]),
    write_scope: Object.freeze(["tests/example.test.mjs"])
  });
  const sliceBinding = Object.freeze({
    schema_version: "worktree-identity-binding.v2",
    checkout_mode: "full",
    unit_address: authority.unit_address,
    selected_unit: selectedUnit,
    write_scope_source: authority.source,
    source_digest: authority.source_digest,
    source_version: authority.source_version,
    read_scope: authority.read_scope,
    repo_paths: authority.repo_paths,
    write_scope: authority.write_scope,
    base_ref: "refs/heads/wk/IN-0038/WK-2261",
    base_sha: "a".repeat(40)
  });
  const provisioning = Object.freeze({
    complete: true,
    initiative: "IN-0038",
    unit_address: authority.unit_address,
    record_id: "WK-2261",
    slice_id: "SLICE-004",
    worktree_path: "/tmp/wk2261-slice",
    slice_binding: sliceBinding
  });
  let consumed = false;
  const events = [];
  const provisioningAuthority = {
    resolve({ ticket: candidate, input, app, consume }) {
      events.push("consume-ticket");
      assert.equal(candidate, ticket);
      assert.equal(input.subject, "WK-2261#SLICE-004");
      assert.equal(app, "codex");
      assert.equal(consume, true);
      if (consumed) return null;
      consumed = true;
      return {
        provisioning,
        initiative: "IN-0038",
        retry_id: 0
      };
    }
  };
  const attemptStateAuthority = {
    recordProvisioned() { events.push("record-provisioned"); },
    recordProvisioningBinding() { events.push("record-binding"); },
    recordExecutorResult() { events.push("record-result"); }
  };
  let spawnCalls = 0;
  const executor = async (input) => {
    spawnCalls += 1;
    events.push("spawn");
    assert.equal(Object.hasOwn(input, "frozen_worker_scope_snapshot"), false);
    assert.equal(JSON.stringify(input).includes("managed_provisioning_ticket"), false);
    assert.equal(input.worktree_provisioning, provisioning);
    assert.equal(input.worker_scope_authority, authority);
    return { accepted: true, status: "launching" };
  };
  const wrapped = maybeWrapExecutorWithWorktreeProvisioning(
    executor,
    "codex",
    {},
    true,
    attemptStateAuthority,
    async ({ snapshot, consumer, result }) => {
      events.push("validate-snapshot");
      assert.equal(snapshot.managed_provisioning_ticket, ticket);
      assert.equal(consumer, "provisioning");
      assert.equal(result, provisioning);
      return { ok: true };
    },
    provisioningAuthority
  );
  const input = {
    role: "worker",
    subject: "WK-2261#SLICE-004",
    run_id: "wkdb_WK2261",
    monitor_handle: "wkmh_WK2261",
    frozen_worker_scope_snapshot: Object.freeze({
      authority,
      managed_provisioning_ticket: ticket
    })
  };

  const launched = await wrapped(input);
  assert.equal(launched.accepted, true);
  assert.deepEqual(events, [
    "consume-ticket", "validate-snapshot", "record-provisioned",
    "record-binding", "spawn", "record-result"
  ]);

  const replay = await wrapped(input);
  assert.equal(replay.accepted, false);
  assert.equal(replay.refusal.detail.reason, "launcher_private_provisioning_unavailable");
  assert.equal(spawnCalls, 1, "a consumed ticket must never provision or spawn twice");
});
