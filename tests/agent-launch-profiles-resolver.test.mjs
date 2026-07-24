import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AGENT_LAUNCH_FAMILY_EFFORT_MAP,
  AGENT_LAUNCH_NEUTRAL_EFFORTS,
  isNeutralEffortLevel,
  neutralEffortMapping,
  roleEffortEnvKey,
  resolveDispatchedRoleModel,
  resolveLauncherOverrideToken,
  resolveLauncherProfile
} from "../packages/agent-launch-cli/src/lib/agent-launch-profiles.mjs";
import {
  resolveFamilyRoleModelGate
} from "../packages/agent-launch-cli/src/lib/workspace-agent-family-policy.mjs";

async function withRoleConfig(t, roles) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-launch-profiles-resolver-"));
  const lines = [];
  for (const [role, declaration] of Object.entries(roles)) {
    const config = typeof declaration === "string"
      ? { model: declaration }
      : declaration;
    lines.push(`[roles.${role}]`);
    lines.push(`model = ${JSON.stringify(config.model)}`);
    if (typeof config.effort === "string") {
      lines.push(`effort = ${JSON.stringify(config.effort)}`);
    }
    lines.push("");
  }
  await writeFile(path.join(dir, "agent-launch.toml"), lines.join("\n"), "utf8");
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("neutral role effort declarations and family maps cover the five-level enum", () => {
  assert.deepEqual(AGENT_LAUNCH_NEUTRAL_EFFORTS, ["low", "medium", "high", "xhigh", "max"]);
  for (const level of AGENT_LAUNCH_NEUTRAL_EFFORTS) {
    assert.equal(isNeutralEffortLevel(level), true);
    assert.ok(AGENT_LAUNCH_FAMILY_EFFORT_MAP.codex[level], `codex missing ${level}`);
    assert.ok(AGENT_LAUNCH_FAMILY_EFFORT_MAP.claude[level], `claude missing ${level}`);
  }
  assert.equal(isNeutralEffortLevel("default"), false);

  assert.equal(roleEffortEnvKey("worker"), "WORKER_EFFORT");
  assert.equal(roleEffortEnvKey("reviewer"), "REVIEWER_EFFORT");
  assert.equal(roleEffortEnvKey("review"), "REVIEWER_EFFORT");
  assert.equal(roleEffortEnvKey("redteam"), "REDTEAM_EFFORT");
  assert.equal(roleEffortEnvKey("orchestrator"), "ORCHESTRATOR_EFFORT");
  assert.equal(roleEffortEnvKey("resume"), "ORCHESTRATOR_EFFORT");
  assert.equal(roleEffortEnvKey("decider"), null);
});

test("neutral effort maps codex max to xhigh and keeps claude native max", () => {
  assert.equal(neutralEffortMapping({ family: "codex", effort: "low" }).model_reasoning_effort, "low");
  assert.equal(neutralEffortMapping({ family: "codex", effort: "medium" }).model_reasoning_effort, "medium");
  assert.equal(neutralEffortMapping({ family: "codex", effort: "high" }).model_reasoning_effort, "high");
  assert.equal(neutralEffortMapping({ family: "codex", effort: "xhigh" }).model_reasoning_effort, "xhigh");

  const codexMax = neutralEffortMapping({ family: "codex", effort: "max" });
  assert.equal(codexMax.model_reasoning_effort, "xhigh");
  assert.equal(codexMax.clamped_from, "max");
  assert.equal(codexMax.backend_profile_key, "orchestrator_xhigh");
  assert.equal(codexMax.backend_profile_key_scope, "orchestrator_existing_tier");

  const codexXhigh = neutralEffortMapping({ family: "codex", effort: "xhigh" });
  assert.equal(codexXhigh.backend_profile_key, "orchestrator_xhigh");
  assert.equal(codexXhigh.backend_profile_key_scope, "orchestrator_existing_tier");

  for (const level of AGENT_LAUNCH_NEUTRAL_EFFORTS) {
    const claude = neutralEffortMapping({ family: "claude", effort: level });
    assert.equal(claude.output_config.effort, level);
  }
  assert.equal(neutralEffortMapping({ family: "agy", effort: "high" }), null);
  assert.equal(neutralEffortMapping({ family: "codex", effort: "default" }), null);
});

test("override token resolver maps app names to app defaults and model names to registry apps", () => {
  const codex = resolveLauncherOverrideToken("codex");
  assert.equal(codex.ok, true);
  assert.equal(codex.app, "codex");
  assert.equal(codex.model, "gpt-5.5");
  assert.equal(codex.model_source, "app_default");

  const claude = resolveLauncherOverrideToken("claude");
  assert.equal(claude.ok, true);
  assert.equal(claude.app, "claude");
  assert.equal(claude.model, "opus");
  assert.equal(claude.model_source, "app_default");

  const claudeModel = resolveLauncherOverrideToken("sonnet");
  assert.equal(claudeModel.ok, true);
  assert.equal(claudeModel.app, "claude");
  assert.equal(claudeModel.model, "sonnet");
  assert.equal(claudeModel.model_source, "operator_override");

  const claudeFable = resolveLauncherOverrideToken("fable");
  assert.equal(claudeFable.ok, true);
  assert.equal(claudeFable.app, "claude");
  assert.equal(claudeFable.model, "fable");
  assert.equal(claudeFable.model_spec.default_effort, "max");

  const model = resolveLauncherOverrideToken("gpt-5.4");
  assert.equal(model.ok, true);
  assert.equal(model.app, "codex");
  assert.equal(model.model, "gpt-5.4");
  assert.equal(model.model_source, "operator_override");

  const frontier = resolveLauncherOverrideToken("gpt-5.5-pro");
  assert.equal(frontier.ok, true);
  assert.equal(frontier.app, "codex");
  assert.equal(frontier.model, "gpt-5.5-pro");
  assert.equal(frontier.model_spec.codex_profile, "orchestrator_xhigh");

  const coding = resolveLauncherOverrideToken("gpt-5.3-codex");
  assert.equal(coding.ok, true);
  assert.equal(coding.app, "codex");
  assert.equal(coding.model_spec.codex_profile, "worker");

  const agy = resolveLauncherOverrideToken("agy");
  assert.equal(agy.ok, false);
  assert.equal(agy.reason, "app_default_model_unset");
  assert.equal(agy.detail.app, "agy");

  const unknown = resolveLauncherOverrideToken("not-a-model-or-app");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, "unknown_launcher_app_or_model");
  assert.deepEqual(unknown.detail.known_apps, ["codex", "claude", "agy"]);
  assert.ok(unknown.detail.known_models.includes("opus"));
});

test("plain dispatch reads agent-launch.toml role default model and derives the app", async (t) => {
  const dir = await withRoleConfig(t, { worker: "sonnet" });

  const roleModel = resolveDispatchedRoleModel({
    role: "worker",
    resolvedProfile: { model: null },
    dir
  });
  assert.equal(roleModel.ok, true);
  assert.equal(roleModel.model, "sonnet");
  assert.equal(roleModel.app, "claude");
  assert.equal(roleModel.model_source, "role_config");
  assert.equal(roleModel.resolvedProfile.app, "claude");

  const profile = resolveLauncherProfile({
    role: "worker",
    env: {},
    dir,
    readWorkspaceEnvValue: () => null
  });
  assert.equal(profile.ok, true, JSON.stringify(profile));
  assert.equal(profile.value.profile_name, "worker");
  assert.equal(profile.value.app, "claude");
  assert.equal(profile.value.model, "sonnet");
  assert.equal(profile.value.model_source, "role_config");
  assert.equal(profile.value.effort, "high");
  assert.equal(profile.value.effort_source, "model_registry_default");
  assert.equal(profile.value.backend, "claude");
});

test("effort precedence is operator override then role config then registry default", async (t) => {
  const configDir = await withRoleConfig(t, {
    worker: { model: "gpt-5.4-mini", effort: "medium" }
  });

  const overridden = resolveLauncherProfile({
    role: "worker",
    effort: "high",
    env: {},
    dir: configDir,
    readWorkspaceEnvValue: () => null
  });
  assert.equal(overridden.ok, true, JSON.stringify(overridden));
  assert.equal(overridden.value.effort, "high");
  assert.equal(overridden.value.effort_source, "operator_override");
  assert.equal(overridden.value.default_effort, "high");
  assert.equal(overridden.value.default_effort_source, "operator_override");

  const configured = resolveLauncherProfile({
    role: "worker",
    env: {},
    dir: configDir,
    readWorkspaceEnvValue: () => null
  });
  assert.equal(configured.ok, true, JSON.stringify(configured));
  assert.equal(configured.value.effort, "medium");
  assert.equal(configured.value.effort_source, "role_config");

  const defaultDir = await withRoleConfig(t, {
    reviewer: { model: "gpt-5.4" }
  });
  const registryDefault = resolveLauncherProfile({
    role: "review",
    env: {},
    dir: defaultDir,
    readWorkspaceEnvValue: () => null
  });
  assert.equal(registryDefault.ok, true, JSON.stringify(registryDefault));
  assert.equal(registryDefault.value.effort, "medium");
  assert.equal(registryDefault.value.effort_source, "model_registry_default");
});

test("unknown reviewer role default refuses through resolveFamilyRoleModelGate", async (t) => {
  const dir = await withRoleConfig(t, { reviewer: "unknown-review-model" });
  const result = await resolveFamilyRoleModelGate({
    role: "reviewer",
    resolvedProfile: { model: null },
    modelHint: null,
    dir
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "reviewer_model_unknown");
  assert.equal(result.detail.model, "unknown-review-model");
  assert.ok(result.detail.known_models.includes("gpt-5.4"));
});

test("unknown orchestrator role default refuses inside resolveLauncherProfile", async (t) => {
  const dir = await withRoleConfig(t, { orchestrator: "unknown-orch-model" });
  const result = resolveLauncherProfile({
    role: "orchestrator",
    env: {},
    dir,
    readWorkspaceEnvValue: () => null
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "orchestrator_model_unknown");
  assert.match(result.error.message, /unknown-orch-model/);
});

test("deprecated ROLE_APP probe reports agreement and errors on disagreement", async (t) => {
  const dir = await withRoleConfig(t, { worker: "opus" });

  const agreed = resolveLauncherProfile({
    role: "worker",
    env: {},
    dir,
    readWorkspaceEnvValue: ({ key }) => (key === "WORKER_APP" ? "claude" : null)
  });
  assert.equal(agreed.ok, true, JSON.stringify(agreed));
  assert.equal(agreed.value.app, "claude");
  assert.equal(agreed.value.diagnostics.length, 1);
  assert.equal(agreed.value.diagnostics[0].code, "role_app_deprecated");
  assert.equal(agreed.value.diagnostics[0].env_key, "WORKER_APP");

  const disagreed = resolveLauncherProfile({
    role: "worker",
    env: {},
    dir,
    readWorkspaceEnvValue: ({ key }) => (key === "WORKER_APP" ? "codex" : null)
  });
  assert.equal(disagreed.ok, false);
  assert.equal(disagreed.error.code, "role_app_deprecated_mismatch");
  assert.match(disagreed.error.message, /WORKER_APP=codex/);
  assert.match(disagreed.error.message, /model-derived app claude/);
});

test("deprecated ROLE_EFFORT probe reports agreement and errors on config disagreement", async (t) => {
  const dir = await withRoleConfig(t, {
    worker: { model: "gpt-5.5", effort: "high" }
  });

  const agreed = resolveLauncherProfile({
    role: "worker",
    env: {},
    dir,
    readWorkspaceEnvValue: ({ key }) => (key === "WORKER_EFFORT" ? "high" : null)
  });
  assert.equal(agreed.ok, true, JSON.stringify(agreed));
  assert.equal(agreed.value.effort, "high");
  assert.equal(agreed.value.diagnostics.length, 1);
  assert.equal(agreed.value.diagnostics[0].code, "role_effort_deprecated");
  assert.equal(agreed.value.diagnostics[0].env_key, "WORKER_EFFORT");

  const disagreed = resolveLauncherProfile({
    role: "worker",
    env: {},
    dir,
    readWorkspaceEnvValue: ({ key }) => (key === "WORKER_EFFORT" ? "medium" : null)
  });
  assert.equal(disagreed.ok, false);
  assert.equal(disagreed.error.code, "role_effort_deprecated_mismatch");
  assert.match(disagreed.error.message, /WORKER_EFFORT=medium/);
  assert.match(disagreed.error.message, /agent-launch\.toml effort high/);
});
