

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCanonicalArgs,
  resolveOrchestratorCommandProfile
} from "../packages/agent-launch-cli/src/commands/orchestrator.mjs";
import {
  resolveLauncherProfile
} from "../packages/agent-launch-cli/src/lib/agent-launch-profiles.mjs";
import {
  routeOrchestratorLaunch
} from "../packages/agent-launch-cli/src/lib/orchestrator-launch-dispatch.mjs";

function envReader(map) {
  return ({ key }) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null);
}

function roleConfigReader(map) {
  return (role) => (Object.prototype.hasOwnProperty.call(map, role) ? map[role] : null);
}

const FAKE_DIR = "/tmp/wk1166-slice009-fixture";

test("WK-1248#SLICE-005 orchestrator entrypoint derives family from ORCHESTRATOR_MODEL", () => {
  const result = resolveOrchestratorCommandProfile({
    role: "orch",
    parsed: {
      profileName: null,
      app: null,
      model: null
    },
    env: { ORCHESTRATOR_MODEL: "opus" },
    cwd: FAKE_DIR
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.app, "claude");
  assert.equal(result.value.model, "opus");
  assert.equal(result.value.model_source, "operator_override");
  assert.equal(result.value.profile_name, "orchestrator_claude");
});

test("WK-1248#SLICE-005 orchestrator --model overrides ORCHESTRATOR_MODEL", () => {
  const result = resolveOrchestratorCommandProfile({
    role: "orch",
    parsed: {
      profileName: null,
      app: null,
      model: "gpt-5.5"
    },
    env: { ORCHESTRATOR_MODEL: "opus" },
    cwd: FAKE_DIR
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.app, "codex");
  assert.equal(result.value.model, "gpt-5.5");
  assert.equal(result.value.profile_name, "orchestrator");
});

test("WK-1248#SLICE-005 orchestrator --effort xhigh preserves codex backend_profile_key", () => {
  const parsed = parseCanonicalArgs(["IN-0001", "--model", "gpt-5.5", "--effort", "xhigh"]);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.profileName, "orchestrator_xhigh");
  assert.equal(parsed.effort, "xhigh");
  const result = resolveOrchestratorCommandProfile({
    role: "orch",
    parsed,
    env: {},
    cwd: FAKE_DIR
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.app, "codex");
  assert.equal(result.value.backend_profile_key, "orchestrator_xhigh");
  assert.equal(result.value.profile_name, "orchestrator_xhigh");
});

test("WK-1248#SLICE-005 resume uses the same model-derived entrypoint resolver", () => {
  const result = resolveOrchestratorCommandProfile({
    role: "orch-resume",
    parsed: {
      profileName: null,
      app: null,
      model: null
    },
    env: { ORCHESTRATOR_MODEL: "opus" },
    cwd: FAKE_DIR
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.role, "resume");
  assert.equal(result.value.app, "claude");
  assert.equal(result.value.profile_name, "orchestrator_claude");
});

test("DEC-0114 orchestrator refuses orchestrator_model_unset when no model is declared", () => {
  for (const role of ["orchestrator", "resume"]) {
    const result = resolveLauncherProfile({
      role,
      env: {},
      dir: FAKE_DIR,
      readWorkspaceEnvValue: envReader({})
    });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, "orchestrator_model_unset");
    assert.equal(result.error.path, "model");
    assert.match(result.error.message, /agent-launch\.toml/);
  }
});

test("DEC-0114 explicit app-name override selects the app default model", () => {
  const result = resolveLauncherProfile({
    role: "orchestrator",
    app: "codex",
    env: {},
    dir: FAKE_DIR,
    readWorkspaceEnvValue: envReader({})
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.app, "codex");
  assert.equal(result.value.model, "gpt-5.5");
  assert.equal(result.value.model_source, "app_default");
  assert.equal(result.value.profile_name, "orchestrator");
});

test("DEC-0114 explicit claude app-name override selects the claude app default", () => {
  const result = resolveLauncherProfile({
    role: "orchestrator",
    app: "claude",
    env: {},
    dir: FAKE_DIR,
    readWorkspaceEnvValue: envReader({})
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.app, "claude");
  assert.equal(result.value.model, "opus");
  assert.equal(result.value.model_source, "app_default");
});

test("DEC-0114 role default model fills the orchestrator/resume model with role_config source", () => {
  for (const role of ["orchestrator", "resume"]) {
    const result = resolveLauncherProfile({
      role,
      env: {},
      dir: FAKE_DIR,
      readWorkspaceEnvValue: envReader({}),
      readRoleDefaultModelValue: roleConfigReader({ orchestrator: "gpt-5.5", resume: "gpt-5.5" })
    });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.app, "codex");
    assert.equal(result.value.model, "gpt-5.5");
    assert.equal(result.value.model_source, "role_config");
  }
});

test("DEC-0114 --model override takes precedence over role config", () => {
  const result = resolveLauncherProfile({
    role: "orchestrator",
    model: "gpt-5.4",
    env: {},
    dir: FAKE_DIR,
    readWorkspaceEnvValue: envReader({}),
    readRoleDefaultModelValue: roleConfigReader({ orchestrator: "gpt-5.5" })
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.model, "gpt-5.4");
  assert.equal(result.value.model_source, "operator_override");
});

test("DEC-0114 the app-bearing orchestrator_claude route declares claude but takes model from role config", () => {
  const result = resolveLauncherProfile({
    role: "orchestrator",
    profileName: "orchestrator_claude",
    env: {},
    dir: FAKE_DIR,
    readWorkspaceEnvValue: envReader({}),
    readRoleDefaultModelValue: roleConfigReader({ orchestrator: "opus" })
  });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.value.app, "claude");
  assert.equal(result.value.profile_name, "orchestrator_claude");
  assert.equal(result.value.model, "opus");
  assert.equal(result.value.model_source, "role_config");
});

function captureRunners(calls) {
  return {
    runClaudeOrchestrator: (opts) => {
      calls.push({ runner: "claude", opts });
      return "claude-ran";
    },
    runClaudeOrchestratorResume: (opts) => {
      calls.push({ runner: "claude-resume", opts });
      return "claude-resume-ran";
    },
    runCodexRole: (argv, io, ctx) => {
      calls.push({ runner: "codex", argv, ctx });
      return "codex-ran";
    }
  };
}

test("WK-1166#SLICE-009 routeOrchestratorLaunch threads the resolved model to the Codex runner (resolvedProfile carries -m)", async () => {
  const calls = [];
  const resolved = { app: "codex", model: "gpt-orch-x", profile_name: "orchestrator" };
  await routeOrchestratorLaunch({
    role: "orch",
    resolved,
    initiative: "IN-0001",
    runners: captureRunners(calls),
    io: {}
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runner, "codex");
  assert.equal(calls[0].ctx.resolvedProfile.model, "gpt-orch-x");
  assert.equal(calls[0].argv[0], "orch");
  assert.equal(calls[0].argv[1], "IN-0001");
});

test("WK-1166#SLICE-009 routeOrchestratorLaunch threads the resolved model to the Claude runner", async () => {
  const calls = [];
  const resolved = { app: "claude", model: "sonnet-x", profile_name: "orchestrator_claude" };
  await routeOrchestratorLaunch({
    role: "orch",
    resolved,
    initiative: "IN-0001",
    runners: captureRunners(calls),
    io: {}
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runner, "claude");
  assert.equal(calls[0].opts.resolvedProfile.model, "sonnet-x");
});

test("WK-1166#SLICE-009 routeOrchestratorLaunch routes orch-resume to the Claude resume runner with the resolved model", async () => {
  const calls = [];
  const resolved = { app: "claude", model: "sonnet-x", profile_name: "orchestrator_claude" };
  await routeOrchestratorLaunch({
    role: "orch-resume",
    resolved,
    initiative: "IN-0001",
    runners: captureRunners(calls),
    io: {}
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runner, "claude-resume");
  assert.equal(calls[0].opts.resolvedProfile.model, "sonnet-x");
});
