import { createRegisterTool } from "../../packages/wiki-mcp/src/lib/register-tool.mjs";
import { loadMcpToolTierRegistrationPolicy } from "../../packages/wiki-mcp/src/lib/server-composition-helpers.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { resolveSessionProfile, sessionProfileAllowsTool } from "../../packages/wiki-core/src/lib/tool-discovery/session-profile.mjs";
import { resolveRegisteredTier } from "../../packages/wiki-mcp/src/lib/tool-profile.mjs";
import { resolveOrchestratorGuidancePair } from "../../packages/agent-launch-core/src/lib/agent-role-guides.mjs";

test("resolved host configuration alone selects guidance, with descriptor filtering for both profiles", () => {
  for (const [apiKey, tier, directory] of [[null, "free_local", "01"], [{ value: "fixture-key" }, "paid_cce", "02"]]) {
    const profile = resolveSessionProfile({ apiKey, family: "hostile", model: "paid", registeredTier: "forged" });
    assert.deepEqual(profile, { registeredTier: tier });
    assert.ok(Object.isFrozen(profile));
    assert.match(resolveOrchestratorGuidancePair(tier).guide, new RegExp(`/orchestrator/${directory}/guide.md$`));
    assert.equal(sessionProfileAllowsTool(profile, { kind: "mcp_tool", tier_visibility: ["free_local"] }), true);
    assert.equal(sessionProfileAllowsTool(profile, { kind: "mcp_tool", tier_visibility: [] }), false);
    assert.equal(sessionProfileAllowsTool(profile, { kind: "mcp_tool" }), false);
    assert.equal(sessionProfileAllowsTool(profile, { kind: "cli_command", tier_visibility: [tier] }), false);
  }
  assert.equal(resolveRegisteredTier({}), "free_local");
  assert.equal(resolveRegisteredTier({ NODE_ENGINE_API_KEY: "fixture-key" }), "paid_cce");
  for (const config of [{}, { apiKey: undefined }, { apiKey: {} }, { apiKey: { value: "" } }])
    assert.throws(() => resolveSessionProfile(config), { code: "orchestrator_guidance_profile_invalid" });
  assert.throws(() => resolveSessionProfile(null), { code: "orchestrator_guidance_profile_invalid" });
  assert.throws(() => resolveOrchestratorGuidancePair("forged"), { code: "orchestrator_guidance_profile_invalid" });
  const cause = Object.assign(new Error("configuration getter failed"), { code: "fixture_config_failed" });
  assert.throws(() => resolveRegisteredTier(new Proxy({}, { get() { throw cause; } })), error => error === cause);
});


test("the real registrar denies nonvisible descriptor rows for both captured profiles before any effect", async () => {
  const canonical = await loadMcpToolTierRegistrationPolicy();
  const name = "workspace_read_wiki";
  for (const registeredTier of ["free_local", "paid_cce"]) {
    for (const row of [undefined, { kind: "mcp_tool", tier_visibility: [] },
      { kind: "mcp_tool", tier_visibility: ["unknown"] }, { kind: "cli_command", tier_visibility: ["free_local", "paid_cce"] }]) {
      const toolDescriptors = new Map(canonical.toolDescriptors);
      if (row === undefined) toolDescriptors.delete(name); else toolDescriptors.set(name, { ...row, tool_name: name });
      let writes = 0, audit = 0;
      const registeredToolNames = new Set();
      const register = createRegisterTool({ server: { registerTool() { writes++; } }, toolProfile: "orchestrator", registeredTier,
        mcpToolTierRegistrationPolicy: { ...canonical, toolDescriptors }, registeredToolNames, structuredLog() {},
        toolUsageAuditBoundary: { wrapHandler() { audit++; throw new Error("unavailable tool reached audit"); } } });
      assert.doesNotThrow(() => register(name, {}, () => assert.fail("handler must not be retained")));
      assert.deepEqual([writes, audit, [...registeredToolNames]], [0, 0, []]);
    }
  }
});
