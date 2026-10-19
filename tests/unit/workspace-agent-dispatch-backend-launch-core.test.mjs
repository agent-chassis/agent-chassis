

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  BACKEND_MISSING_RESULT_CODES
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  superviseChildLaunch
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-launch-core.mjs";
import {
  maybeWrapExecutorWithWorktreeProvisioning
} from "../../packages/agent-launch-cli/src/lib/backend-worktree-binding.mjs";
import { createLauncherOwnedManagedAttemptStateAuthority } from "../../packages/agent-launch-cli/src/lib/backend-provisioning-state.mjs";
import { computeWorkRecordSourceDigest } from "../../packages/wiki-core/src/lib/work-record-schema.mjs";
import {
  assertNoForbiddenTokens,
  createTestDispatchBackend
} from "../workspace-agent-dispatch-backend-shared.mjs";
import { fixtureFrozenScopeFacts } from "../helpers/frozen-worker-resolved-scope.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";

const LAUNCH_CORE_WK = "WK-0626";
const LAUNCH_CORE_SUBJECT = `${LAUNCH_CORE_WK}#SLICE-001`;

async function launchCoreWorkspace(t) {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const root = await scope.acquire("launch-core-workspace",
    () => mkdtempSync(path.join(os.tmpdir(), "launch-core-workspace-")),
    (created) => rmSync(created, { recursive: true, force: true }));
  mkdirSync(path.join(root, "wiki", "work-records"), { recursive: true });
  writeFileSync(path.join(root, "wiki", "work-records", `${LAUNCH_CORE_WK}.json`), JSON.stringify({
    id: LAUNCH_CORE_WK,
    initiative: "IN-0030",
    status: "active",
    slices: [{ id: "SLICE-001", work_kind: "implementation",
      write_scope: ["packages/agent-launch-cli/src/lib/workspace-agent-launch-core.mjs"] }]
  }));
  return root;
}

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

test("WK-0626 backend surfaces shared launch core findings final_result with full_response", async (t) => {
  const workspaceDir = await launchCoreWorkspace(t);
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
    subject: LAUNCH_CORE_SUBJECT,
    workspace_dir: workspaceDir
  });
  assert.equal(launch.accepted, true, JSON.stringify(launch));
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

test("WK-0626 backend preserves bounded stderr detail for shared launch core failed terminal", async (t) => {
  const workspaceDir = await launchCoreWorkspace(t);
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
    subject: LAUNCH_CORE_SUBJECT,
    workspace_dir: workspaceDir
  });
  assert.equal(launch.accepted, true, JSON.stringify(launch));
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

function provisioningTicketFixture({
  execute = null, beforeBinding = null, afterResult = null,
  transformProvisioning = value => value, transformInput = value => value
} = {}) {
  const ticket = Object.freeze({});
  const selectedUnit = Object.freeze({
    kind: "slice",
    address: "WK-2261#SLICE-004",
    record_id: "WK-2261",
    slice_id: "SLICE-004",
    repo: "agent-chassis/agent-chassis"
  });

  const canonicalRecord = Object.freeze({
    schema_version: "work-record.v1",
    id: "WK-2261",
    repo: "agent-chassis/agent-chassis",
    title: "Provisioning ticket fixture",
    work_kind: "tracker",
    status: "active",
    priority: "medium",
    read_scope: ["README.md"],
    repo_paths: ["README.md"],
    write_scope: ["tests/example.test.mjs"],
    depends_on: [],
    acceptance: { criteria: [], validation: [] },
    sections: { agent_notes: "WK2261_SLICE_NOTES", tasks: [] },
    slices: [{
      id: "SLICE-004",
      title: "Provisioned slice",
      work_kind: "implementation",
      status: "todo",
      depends_on: [],
      read_scope: ["README.md"],
      repo_paths: ["README.md"],
      write_scope: ["tests/example.test.mjs"],
      acceptance: { criteria: ["WK2261_SLICE_CRITERION"], validation: [] },
      sections: { agent_notes: "WK2261_SLICE_NOTES" }
    }]
  });
  const dispatchReadiness = Object.freeze({
    schema_version: "dispatch-readiness.v1",
    decision_code: "dispatchable",
    dispatchable: true,
    record_id: "WK-2261",
    unit: Object.freeze({ address: "WK-2261#SLICE-004", record_id: "WK-2261", slice_id: "SLICE-004" }),
    reasons: Object.freeze([]),
    validation_hints: Object.freeze([]),
    canonical_refs: Object.freeze([]),
    derived_evidence: Object.freeze([])
  });

  const authority = Object.freeze({
    schema_version: "workspace-agent-frozen-scope-authority.v1",
    unit_address: "IN-0038/WK-2261/SLICE-004",
    selected_unit: selectedUnit,
    source: "wiki/work-records/WK-2261.json#SLICE-004",

    source_digest: computeWorkRecordSourceDigest(canonicalRecord),
    source_version: "work-record.v1",
    read_scope: Object.freeze(["README.md"]),
    repo_paths: Object.freeze(["README.md"]),
    readable_scope: Object.freeze(["README.md"]),
    write_scope: Object.freeze(["tests/example.test.mjs"]),
    scope_exclusions: Object.freeze(["wiki/contracts"]),
    ...fixtureFrozenScopeFacts({ readable: ["README.md"],
      writable: ["tests/example.test.mjs"] })
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
  const provisioning = transformProvisioning(Object.freeze({
    complete: true,
    initiative: "IN-0038",
    unit_address: authority.unit_address,
    record_id: "WK-2261",
    slice_id: "SLICE-004",
    worktree_path: "/tmp/wk2261-slice",
    slice_binding: sliceBinding
  }));
  let consumed = false;
  const events = [];
  const provisioningAuthority = {
    markExecutorEntered({ ticket: candidate }) {
      assert.equal(candidate, ticket);
      assert.equal(consumed, true);
    },
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
  const realAuthority = createLauncherOwnedManagedAttemptStateAuthority();
  const attemptStateAuthority = {
    ...realAuthority,
    recordProvisioned(identity) { events.push("record-provisioned"); realAuthority.recordProvisioned(identity); },
    recordProvisioningBinding(binding) {
      events.push("record-binding");
      beforeBinding?.();
      realAuthority.recordProvisioningBinding(binding);
    },
    recordExecutorResult(result) {
      events.push("record-result");
      realAuthority.recordExecutorResult(result);
      afterResult?.();
    }
  };
  let spawnCalls = 0;
  const executor = async (input) => {
    spawnCalls += 1;
    events.push("spawn");
    if (execute !== null) return execute(input);
    assert.equal(Object.hasOwn(input, "frozen_worker_scope_snapshot"), false);
    assert.equal(JSON.stringify(input).includes("managed_provisioning_ticket"), false);
    assert.equal(input.worktree_provisioning, provisioning);
    assert.equal(input.worker_scope_authority, authority);

    assert.equal(input.workspace_dir, "/tmp/wk2261-slice");
    assert.equal(input.workspace_alias, "wk2261");
    assert.ok(Object.isFrozen(input.dispatch_workspace_binding));
    assert.deepEqual(input.dispatch_workspace_binding, {
      workspace_alias: "wk2261",
      workspace_dir: "/srv/wk2261"
    });

    assert.ok(Object.isFrozen(input.worker_assignment));
    assert.equal(input.worker_assignment.unit_address, "WK-2261#SLICE-004");
    assert.equal(input.worker_assignment.run_id, "wkdb_WK2261");
    assert.equal(input.worker_assignment.monitor_handle, "wkmh_WK2261");
    assert.equal(input.worker_assignment.worktree_path, "/tmp/wk2261-slice");

    assert.match(input.worker_assignment.prompt, /workspace_read_wiki with arguments \{"assignment":true\}/);
    assert.equal(input.worker_assignment.assignment_delivery, "read_page");
    assert.match(input.worker_assignment.assignment_guidance, /WK2261_SLICE_CRITERION/);
    assert.match(input.worker_assignment.assignment_guidance, /WK2261_SLICE_NOTES/);
    assert.doesNotMatch(input.worker_assignment.prompt, /WK2261_SLICE_CRITERION/);
    assert.equal(Object.hasOwn(input.worker_assignment, "record"), false);
    return { accepted: true, status: "launching", completion: new Promise(() => {}) };
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
    workspace_alias: "wk2261",
    workspace_dir: "/srv/wk2261",
    readiness: dispatchReadiness,
    frozen_worker_scope_snapshot: Object.freeze({
      authority,
      record: canonicalRecord,
      selected_unit_contract: canonicalRecord.slices[0],
      assignment_capture: Object.freeze({
        schema_version: "worker-assignment-capture.v1",
        repository: "agent-chassis",
        entry_material: null
      }),
      managed_provisioning_ticket: ticket
    })
  };

  return { wrapped, input: transformInput(input), events, authority: realAuthority,
    identity: { unitAddress: authority.unit_address, launchRef: input.monitor_handle, runId: input.run_id, retryId: 0 },
    spawnCalls: () => spawnCalls };
}
test("WK-2261 executor consumes one launcher-private provisioning ticket without leaking it", async () => {
  const { wrapped, input, events, spawnCalls } = provisioningTicketFixture();
  const launched = await wrapped(input);
  assert.equal(launched.accepted, true, JSON.stringify(launched.refusal ?? launched));
  assert.deepEqual(events, [
    "consume-ticket", "validate-snapshot", "record-provisioned",
    "record-binding", "spawn", "record-result"
  ]);

  const replay = await wrapped(input);
  assert.equal(replay.accepted, false);
  assert.equal(replay.refusal.detail.reason, "launcher_private_provisioning_unavailable");
  assert.equal(spawnCalls(), 1, "a consumed ticket must never provision or spawn twice");
});

async function confirmsTermination(fixture) {
  const { identity } = fixture;
  const next = { role: "worker", subject: fixture.input.subject, initiative: "IN-0038",
    launchRef: "next-launch", runId: "next-run" };
  const state = await fixture.authority.resolve(next);
  assert.equal(state.disposition, "reissue");
  return state.livenessDeps.confirmPriorWorkerTerminated({ unitAddress: identity.unitAddress,
    launchRef: next.launchRef, runId: next.runId, retryId: 1, priorIdentity: state.priorIdentity });
}

test("every pre-executor preparation exit settles the exact recorded attempt", async t => {
  for (const stage of ["binding", "git binding", "result mode", "presentation", "mint arguments", "mint validation", "executor input"]) {
    await t.test(stage, async () => {
      const original = new Error(`fixture ${stage} preparation failure`);
      const getterFailure = (object, field) => Object.defineProperty({ ...object }, field, {
        enumerable: true, get() { throw original; }
      });
      const options = {
        ...(stage === "binding" ? { beforeBinding() { throw original; } } : {}),
        transformProvisioning(value) {
          if (stage === "git binding") return getterFailure(value, "provisionedWorktreeGitBinding");
          if (stage === "result mode") return getterFailure(value, "worktree_path");
          if (stage === "mint arguments") return { ...value, slice_binding: getterFailure(value.slice_binding, "run_id") };
          if (stage === "mint validation") return { ...value, worktree_path: "" };
          return value;
        },
        transformInput(input) {
          if (stage === "presentation") return { ...input, frozen_worker_scope_snapshot: {
            ...input.frozen_worker_scope_snapshot, record: null } };

          if (stage === "executor input") return getterFailure(input, "workspace_alias");
          return input;
        }
      };
      const fixture = provisioningTicketFixture(options);
      if (["presentation", "mint arguments", "mint validation"].includes(stage)) {
        const failed = await fixture.wrapped(fixture.input);
        assert.equal(failed.accepted, false);
        assert.equal(failed.refusal.reason, stage === "mint validation"
          ? "worker_assignment_binding_mismatch" : "worker_assignment_projection_invalid");
        if (stage === "mint arguments") assert.equal(failed.refusal.detail.message, original.message);
      } else {
        await assert.rejects(fixture.wrapped(fixture.input), error => error === original);
      }
      assert.equal(fixture.spawnCalls(), 0);
      assert.equal(fixture.events.filter(event => event === "record-result").length, 1);
      assert.equal(await confirmsTermination(fixture), true);
      if (stage !== "binding") assert.equal(fixture.authority.resolveProvisioningBinding({
        subject: fixture.input.subject, run_id: fixture.identity.runId, monitor_handle: fixture.identity.launchRef
      }).complete, true, "settlement retains the provisioned binding");
    });
  }
});

test("executor refusal, throw, terminal and running results each record once without inventing death", async t => {
  for (const [name, result, terminated] of [
    ["refused", { accepted: false, refusal: { code: "fixture_executor_refused" } }, true],
    ["threw", new Error("executor threw"), true],
    ["terminal", { accepted: true, status: "failed" }, true],
    ["completed probe", { accepted: true, status: "launching", probe: async () => ({ status: "succeeded" }) }, true],
    ["running", { accepted: true, status: "running", probe: async () => ({ status: "running" }) }, false],
    ["missing result", null, false],
    ["uncertain", { accepted: true, status: "launching" }, false],
    ["probe throws", { accepted: true, status: "running", probe: async () => { throw new Error("probe unavailable"); } }, false]
  ]) await t.test(name, async () => {
    const fixture = provisioningTicketFixture({ execute: () => {
      if (result instanceof Error) throw result;
      return result;
    } });
    if (result instanceof Error) await assert.rejects(fixture.wrapped(fixture.input), error => error === result);
    else assert.equal(await fixture.wrapped(fixture.input), result);
    assert.equal(fixture.spawnCalls(), 1);
    assert.equal(fixture.events.filter(event => event === "record-result").length, 1);
    assert.equal(await confirmsTermination(fixture), terminated);
    const status = { subject: fixture.input.subject, run_id: fixture.identity.runId,
      monitor_handle: fixture.identity.launchRef };
    assert.equal(fixture.authority.resolveProvisioningBinding(status).complete, true);
    for (const field of ["unitAddress", "launchRef", "runId", "retryId"]) {
      assert.throws(() => fixture.authority.recordExecutorResult({ ...fixture.identity,
        [field]: field === "retryId" ? 99 : "foreign", result: { accepted: false } }), /identity changed/u);
    }
    assert.equal(await confirmsTermination(fixture), terminated, "foreign settlement cannot change liveness");
    fixture.authority.recordProvisioned({ ...fixture.identity, launchRef: "new-launch", runId: "new-run", retryId: 1 });
    assert.throws(() => fixture.authority.recordExecutorResult({ ...fixture.identity,
      result: { accepted: false } }), /identity changed/u, "superseded settlement refuses");
  });
});

test("result recording failure cannot settle a running executor a second time", async () => {
  const original = new Error("result observer failed after recording");
  const fixture = provisioningTicketFixture({
    execute: () => ({ accepted: true, status: "running", probe: async () => ({ status: "running" }) }),
    afterResult: () => { throw original; }
  });
  await assert.rejects(fixture.wrapped(fixture.input), error => error === original);
  assert.equal(fixture.events.filter(event => event === "record-result").length, 1);
  assert.equal(await confirmsTermination(fixture), false);
});

test("an already-stranded recorded attempt without a probe remains unconfirmed", async () => {
  const fixture = provisioningTicketFixture();
  fixture.authority.recordProvisioned(fixture.identity);
  assert.equal(await confirmsTermination(fixture), false);
  assert.equal(fixture.spawnCalls(), 0);
});
