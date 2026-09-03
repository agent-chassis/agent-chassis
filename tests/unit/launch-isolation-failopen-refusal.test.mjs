

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BubblewrapIsolationError
} from "../../packages/agent-launch-cli/src/lib/launch-isolation-errors.mjs";
import {
  WORKSPACE_AGENT_FAIL_OPEN_CLOSED_REASONS,
  WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS,
  WORKSPACE_AGENT_MANAGED_PLAIN_SPAWN_BLOCKER
} from "../../packages/agent-launch-cli/src/lib/launch-isolation-failopen.mjs";
import {
  buildCodexRoleSandboxFailOpenPlan,
  prepareCodexRoleSandboxLaunch
} from "../../packages/agent-launch-cli/src/lib/codex-role-sandbox-fail-open.mjs";
import {
  runHeadlessCaptureChild,
  runHeadlessVerboseChild
} from "../../packages/agent-launch-cli/src/commands/codex-role.mjs";

const WORKER_SCOPE_AUTHORITY = Object.freeze({
  schema_version: "workspace-agent-frozen-scope-authority.v1",
  unit_address: "IN-0032/WK-1626/SLICE-001",
  selected_unit: Object.freeze({
    kind: "slice",
    address: "WK-1626#SLICE-001",
    record_id: "WK-1626",
    slice_id: "SLICE-001"
  })
});

function bwrapUnavailable() {
  return new BubblewrapIsolationError("agent-launch isolation: bwrap is not available", {
    code: BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_UNAVAILABLE
  });
}

const HERMETIC_WORKSPACE = mkdtempSync(path.join(tmpdir(), "wk1626-failopen-"));

after(() => {
  rmSync(HERMETIC_WORKSPACE, { recursive: true, force: true });
});

function plan({ workerScopeAuthority = null, isolationAuthority = null } = {}) {
  return {
    mode: "headless-verbose",
    role: "worker",
    subject: "WK-1626#SLICE-001",
    repo: HERMETIC_WORKSPACE,
    command: "codex",
    args: ["exec", "prompt"],
    env: { PATH: process.env.PATH ?? "" },
    logPrefix: "codex-worker",
    isolation: { worker_scope_authority: isolationAuthority },
    worker_scope_authority: workerScopeAuthority
  };
}

function assertManagedRefusal(decision) {
  assert.equal(decision.disposition, WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.CLOSED);
  assert.equal(decision.accepted, false);
  assert.equal(decision.plan, null);
  assert.equal(
    decision.refusal.reason,
    WORKSPACE_AGENT_FAIL_OPEN_CLOSED_REASONS.ENFORCEMENT_REQUIRED
  );
  assert.equal(
    decision.refusal.detail.blocker,
    WORKSPACE_AGENT_MANAGED_PLAIN_SPAWN_BLOCKER
  );
}

function assertManagedRefusalStderr(stderr) {
  const text = stderr.join("");
  assert.ok(
    text.includes("a managed worker scope authority may not fall back to plain spawn"),
    "the managed scope-authority refusal is the reported cause"
  );
  assert.ok(
    !text.includes("a paid enforcement key requires an enforced isolation backend"),
    "the refusal is not misreported as the paid-key posture refusal"
  );
  assert.ok(
    !text.includes("set the explicit unsandboxed opt-out only if"),
    "the operator is never invited to opt out of confinement to clear this refusal"
  );
}

test("a managed worker whose bwrap plan fails refuses instead of plain-spawning", () => {
  const decision = buildCodexRoleSandboxFailOpenPlan(
    plan({ workerScopeAuthority: WORKER_SCOPE_AUTHORITY }),
    bwrapUnavailable()
  );
  assertManagedRefusal(decision);
});

test("the scope authority is honored when carried on plan.isolation", () => {
  const decision = buildCodexRoleSandboxFailOpenPlan(
    plan({ isolationAuthority: WORKER_SCOPE_AUTHORITY }),
    bwrapUnavailable()
  );
  assertManagedRefusal(decision);
});

test("an unmanaged worker keeps its unenforced plain-spawn disposition", () => {
  const decision = buildCodexRoleSandboxFailOpenPlan(plan(), bwrapUnavailable());
  assert.equal(decision.disposition, WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN);
  assert.equal(decision.accepted, true);
  assert.equal(decision.refusal, null);
});

test("the preflight resolver refuses a managed worker with an unusable backend", () => {
  const prepared = prepareCodexRoleSandboxLaunch(
    plan({ workerScopeAuthority: WORKER_SCOPE_AUTHORITY }),
    {
      buildBwrapPlan() {
        throw bwrapUnavailable();
      }
    }
  );
  assert.equal(prepared.outcome, "refused");
  assertManagedRefusal(prepared.decision);
});

test("the preflight resolver still plain-spawns an unmanaged worker", () => {
  const prepared = prepareCodexRoleSandboxLaunch(plan(), {
    buildBwrapPlan() {
      throw bwrapUnavailable();
    }
  });
  assert.equal(prepared.outcome, "plain");
});

test("a late bwrap failure never plain-spawns a managed worker", async () => {
  const stderr = [];
  const plainSpawns = [];
  const previousExitCode = process.exitCode;
  try {
    await runHeadlessVerboseChild({
      plan: plan({ workerScopeAuthority: WORKER_SCOPE_AUTHORITY }),
      io: { stderr: { write: (chunk) => stderr.push(chunk) } },
      bwrapPlan: {},
      spawnEnforced() {
        throw bwrapUnavailable();
      },
      spawnPlain(...args) {
        plainSpawns.push(args);
        return 0;
      }
    });
    assert.deepEqual(plainSpawns, []);
    assert.equal(process.exitCode, 1);
    assertManagedRefusalStderr(stderr);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("a late bwrap failure never plain-spawns a managed worker in capture mode", async () => {
  const runDir = mkdtempSync(path.join(HERMETIC_WORKSPACE, "run-"));
  const stderr = [];
  const plainSpawns = [];
  const previousExitCode = process.exitCode;
  try {
    await runHeadlessCaptureChild({
      plan: {
        ...plan({ workerScopeAuthority: WORKER_SCOPE_AUTHORITY }),
        mode: "headless",
        runDir,
        logPath: path.join(runDir, "run.log"),
        finalPath: path.join(runDir, "final.md")
      },
      io: { stderr: { write: (chunk) => stderr.push(chunk) }, stdout: { write: () => {} } },
      bwrapPlan: {},
      spawnEnforced() {
        throw bwrapUnavailable();
      },

      spawnPlain(...args) {
        plainSpawns.push(args);
        return {
          pid: 1,
          on(event, handler) {
            if (event === "close") setImmediate(() => handler(0));
          }
        };
      }
    });
    assert.deepEqual(plainSpawns, []);
    assert.equal(process.exitCode, 1);
    assertManagedRefusalStderr(stderr);
  } finally {
    process.exitCode = previousExitCode;
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("a late bwrap failure still plain-spawns an unmanaged worker", async () => {
  const plainSpawns = [];
  const previousExitCode = process.exitCode;
  try {
    await runHeadlessVerboseChild({
      plan: plan(),
      io: { stderr: { write: () => {} } },
      bwrapPlan: {},
      spawnEnforced() {
        throw bwrapUnavailable();
      },
      spawnPlain(...args) {
        plainSpawns.push(args);
        return 0;
      }
    });
    assert.equal(plainSpawns.length, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});
