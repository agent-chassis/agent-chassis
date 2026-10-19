import test from "node:test";
import assert from "node:assert/strict";
import { parseAgentLaunchRoleConfigSource, roleGuideDeliveryFromSnapshot } from "../../packages/agent-launch-cli/src/lib/agent-launch-role-config.mjs";
import { resolveRoleModelSelection } from "../../packages/agent-launch-cli/src/lib/agent-launch-profiles.mjs";
import { resolveRoleGuideInstructions, withRoleGuideInstructionsPrompt } from "../../packages/agent-launch-cli/src/lib/role-guide-instructions.mjs";
import { resolveLaunchRoleGuidePath } from "../../packages/agent-launch-cli/src/lib/launch-isolation-plan.mjs";
import { buildCodexRoleGuideHookConfigOverrides } from "../../packages/agent-launch-cli/src/lib/codex-role-guide-hook.mjs";
import { defaultBuildClaudeCommandLine, buildClaudeRoleGuideCompactionHookSettings } from "../../packages/agent-launch-cli/src/lib/workspace-agent-claude-launch-support.mjs";

test("one per-role boolean freezes into launch selection; defaults enable only workers", () => {
  const empty = parseAgentLaunchRoleConfigSource("");
  for (const role of ["worker", "reviewer", "review", "redteam", "orchestrator", "resume"]) {
    assert.equal(roleGuideDeliveryFromSnapshot(role, empty), role === "worker");
  }
  const snapshot = parseAgentLaunchRoleConfigSource('[roles.worker]\nmodel="gpt-5.4"\nhigh_priority_role_guide=false\n[roles.reviewer]\nmodel="gpt-5.4"\nhigh_priority_role_guide=true');
  for (const role of ["worker", "review"]) {
    const resolved = resolveRoleModelSelection({ role, model: "gpt-5.4", snapshot });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.value.high_priority_role_guide, role === "review");
  }
  assert.throws(() => parseAgentLaunchRoleConfigSource('[roles.worker]\nmodel="gpt-5.4"\nhigh_priority_role_guide="true"'), { code: "role_config.value_not_boolean" });
});

test("role-independent native adapters consume the selected complete-guide descriptor", () => {
  const usageHook = { command: "/bin/true", matcher: "startup", timeoutSec: 5 };
  for (const role of ["worker", "review", "reviewer", "redteam", "orch", "orch-resume"]) {
    for (const highPriority of [true, false]) {
      const delivery = resolveRoleGuideInstructions({ role, highPriority, registeredTier: "free_local" });
      assert.equal(delivery.guidePath, resolveLaunchRoleGuidePath(role, "free_local"));
      const overrides = buildCodexRoleGuideHookConfigOverrides(delivery, { usageHook });
      assert.equal(overrides.length, 2);
      assert.ok(overrides[0].includes('/bin/true'), "usage hook is composed");
      assert.ok(overrides[0].includes('additionalContextLimit'));
      assert.equal(overrides[0].includes('Role reminder:'), !highPriority);
      assert.equal(overrides[0].includes('startup|compact|clear'), highPriority);
      assert.equal(buildCodexRoleGuideHookConfigOverrides(delivery, { confined: false }).length, highPriority ? 2 : 0);
      assert.equal(buildClaudeRoleGuideCompactionHookSettings(delivery) === null, highPriority);
      const cmd = defaultBuildClaudeCommandLine({ role: "worker", subject: "WK-2802", model: "sonnet", guideDelivery: delivery });
      assert.equal(cmd.optionArgs.includes("--append-system-prompt-file"), highPriority);
      assert.equal(cmd.optionArgs.includes("--system-prompt"), false);
      const prompt = `${delivery.readReference}\nTask remains unchanged.`;
      const rendered = withRoleGuideInstructionsPrompt(prompt, delivery);
      assert.equal(rendered.includes("Read your"), !highPriority);
      assert.ok(rendered.includes("Task remains unchanged."));
      const assignmentLine = `Read your assignment mentioning ${delivery.guidePath} carefully.`;
      assert.equal(withRoleGuideInstructionsPrompt(assignmentLine, delivery), assignmentLine);
    }
  }
  assert.equal(resolveRoleGuideInstructions({ role: "operator" }), null);
});
