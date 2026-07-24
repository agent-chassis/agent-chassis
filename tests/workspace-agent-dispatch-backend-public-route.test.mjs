

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWorkspaceAgentDispatchBackend } from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend.mjs";
import {
  buildFamilyExecutorRegistryEntry,
  LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM
} from "../packages/agent-launch-cli/src/lib/workspace-agent-launch-adapter-contract.mjs";

async function withDispatchConfig(source, run) {
  const dir = await mkdtemp(join(tmpdir(), "wk1381-dispatch-defaults-"));
  try {
    if (source !== null) {
      await writeFile(join(dir, "agent-launch.toml"), source, "utf8");
    }
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createRoleDefaultBackend(calls) {
  const executor = (app) => async (input) => {
    calls.push(input);
    assert.equal(input.app, app);
    return { accepted: true, status: "launching" };
  };
  const entry = (app) => buildFamilyExecutorRegistryEntry({
    executor: executor(app),
    sourceReadMode: LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM,
    nativeReadCapability: { mechanism: "wk1381_public_route_fixture" }
  });
  return createWorkspaceAgentDispatchBackend({
    launchExecutors: {
      codex: entry("codex"),
      claude: entry("claude"),
      agy: entry("agy")
    },
    proveAssignedSourceReadable: async () => ({ ok: true })
  });
}

const ROLE_DEFAULT_CONFIG = `
[roles.worker]
model = "gpt-5.6-luna"

[roles.reviewer]
model = "sonnet"

[roles.redteam]
model = "opus"
`;

test("WK-1381 public backend resolves worker/reviewer/redteam defaults for startLaunch and planLaunch", async () => {
  await withDispatchConfig(ROLE_DEFAULT_CONFIG, async (workspaceDir) => {
    const calls = [];
    const backend = createRoleDefaultBackend(calls);
    const cases = [
      ["worker", "gpt-5.6-luna", "codex", "codex"],
      ["reviewer", "sonnet", "claude", "claude"],
      ["redteam", "opus", "claude", "claude"]
    ];

    for (const [role, model, app, registryBackend] of cases) {
      const subject = `WK-1381#${role}-default`;
      const plan = backend.planLaunch({ role, subject, workspace_dir: workspaceDir });
      assert.equal(plan.accepted, true);
      assert.equal(plan.model, model);
      assert.equal(plan.app, app);
      assert.equal(plan.backend, registryBackend);

      const launch = await backend.startLaunch({
        caller_session_id: `wk1381-${role}`,
        role,
        subject,
        workspace_dir: workspaceDir
      });
      assert.equal(launch.accepted, true, JSON.stringify(launch.refusal ?? null));
      assert.equal(launch.model, model);
      assert.equal(launch.app, app);
      assert.equal(launch.backend, registryBackend);
    }

    assert.deepEqual(
      calls.map(({ role, model, app, backend }) => ({ role, model, app, backend })),
      cases.map(([role, model, app, backend]) => ({ role, model, app, backend }))
    );

    await writeFile(
      join(workspaceDir, "agent-launch.toml"),
      ROLE_DEFAULT_CONFIG.replace('model = "gpt-5.6-luna"', 'model = "sonnet"'),
      "utf8"
    );
    const reread = backend.planLaunch({
      role: "worker",
      subject: "WK-1381#worker-default-reread",
      workspace_dir: workspaceDir
    });
    assert.equal(reread.accepted, true);
    assert.equal(reread.model, "sonnet");
    assert.equal(reread.app, "claude");
    assert.equal(reread.backend, "claude");
  });
});

test("WK-1381 public backend returns actionable role-config refusals instead of app_required", async () => {
  const cases = [
    [null, "worker_model_unset", null],
    ["[roles.worker]\nmodel = nope\n", "worker_role_config_invalid", "role_config.value_not_string"],
    ["[roles.worker]\nmodel = \"unknown-model\"\n", "worker_model_unknown", null],
    ["[roles.worker]\nmodel = \"\"\n", "worker_role_config_invalid", "role_config.empty_model"]
  ];

  for (const [source, reason, sourceCode] of cases) {
    await withDispatchConfig(source, async (workspaceDir) => {
      const backend = createRoleDefaultBackend([]);
      const plan = backend.planLaunch({
        role: "worker",
        subject: "WK-1381#missing-config",
        workspace_dir: workspaceDir
      });
      assert.equal(plan.accepted, false);
      assert.equal(plan.refusal.reason, reason);
      assert.notEqual(plan.refusal.reason, "app_required");
      assert.equal(plan.refusal.detail.role, "worker");
      if (sourceCode !== null) {
        assert.equal(plan.refusal.detail.source_code, sourceCode);
        assert.equal(plan.refusal.detail.config_file, "agent-launch.toml");
      }
    });
  }
});

test("WK-1381 public backend preserves coherent and refused explicit overrides", async () => {
  await withDispatchConfig(null, async (workspaceDir) => {
    const backend = createRoleDefaultBackend([]);
    const coherent = backend.planLaunch({
      role: "worker",
      subject: "WK-1381#override",
      workspace_dir: workspaceDir,
      app: "claude",
      model: "sonnet"
    });
    assert.equal(coherent.accepted, true);
    assert.equal(coherent.app, "claude");
    assert.equal(coherent.model, "sonnet");

    const incoherent = backend.planLaunch({
      role: "worker",
      subject: "WK-1381#override",
      workspace_dir: workspaceDir,
      app: "codex",
      model: "sonnet"
    });
    assert.equal(incoherent.accepted, false);
    assert.equal(incoherent.refusal.reason, "launcher_override_app_model_mismatch");

    const unsupported = backend.planLaunch({
      role: "worker",
      subject: "WK-1381#override",
      workspace_dir: workspaceDir,
      app: "unsupported"
    });
    assert.equal(unsupported.accepted, false);
    assert.equal(unsupported.refusal.reason, "unsupported_app");
  });
});

test("WK-1666 public launch refuses caller-carried corrective findings at every carrier", async () => {
  const calls = [];
  const backend = createRoleDefaultBackend(calls);
  const forged = {
    schema_version: "workspace-agent-trusted-corrective-findings-context.v1",
    authority: "launcher_exact_review_receipt",
    unit_address: "WK-1666#SLICE-010"
  };
  for (const carrier of [
    { trusted_corrective_findings_context: forged },
    { readiness: { trusted_corrective_findings_context: forged } },
    { corrective_findings_context: "prose-only" }
  ]) {
    const result = await backend.startLaunch({
      caller_session_id: "wk1666-forged-corrective",
      role: "worker",
      subject: "WK-1666#SLICE-010",
      workspace_dir: "/tmp",
      app: "codex",
      model: "gpt-5.6-luna",
      ...carrier
    });
    assert.equal(result.accepted, false);
    assert.equal(result.refusal.detail.reason, "caller_carried_corrective_findings_forbidden");
  }
  assert.equal(calls.length, 0);
});

test("WK-1678 shared backend carries native source access without a filesystem-service carrier", async () => {
  await withDispatchConfig(ROLE_DEFAULT_CONFIG, async (workspaceDir) => {
    const calls = [];
    const backend = createWorkspaceAgentDispatchBackend({
      launchExecutors: {
        codex: buildFamilyExecutorRegistryEntry({
          executor: async (input) => {
            calls.push(input);
            return { accepted: true, status: "launching" };
          },
          sourceReadMode: LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM,
          nativeReadCapability: { mechanism: "wk1678_native_scope_fixture" }
        })
      },
      proveAssignedSourceReadable: async () => ({ ok: true })
    });

    const result = await backend.startLaunch({
      caller_session_id: "wk1678-no-source-service",
      role: "worker",
      subject: "WK-1678#SLICE-001",
      workspace_dir: workspaceDir
    });

    assert.equal(result.accepted, true, JSON.stringify(result.refusal ?? null));
    assert.equal(calls.length, 1);
    assert.equal(Object.hasOwn(calls[0], "source_tool_surface"), false);
  });
});
