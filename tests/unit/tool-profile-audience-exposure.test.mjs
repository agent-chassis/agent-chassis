import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SESSION_ROLE_TOOL_ACCESS_POLICY_PATH } from "../../packages/wiki-core/src/lib/tool-discovery/gating.mjs";
import { parseToolProfile, shouldExposeTool, shouldExposeToolFromPolicy, SESSION_ROLE_VALUES } from "../../packages/wiki-mcp/src/lib/tool-profile.mjs";
import { resolveSessionProfile, sessionProfileAllowsTool } from "../../packages/wiki-core/src/lib/tool-discovery/session-profile.mjs";
const policy = () => JSON.parse(readFileSync(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH, "utf8"));
const ORCHESTRATOR = ["get_run_result", "integrate_work", "query_code_index", "save_record", "start_agent", "verify_proof", "workspace_advance_candidate", "workspace_assess_contract", "workspace_check_landing", "workspace_create_record", "workspace_find_proofs", "workspace_inspect_candidate", "workspace_publish_work", "workspace_read_wiki", "workspace_record_feedback", "workspace_run_test"];

test("startup accepts exactly the current roles and refuses absent, unknown and retired profiles", () => {
  for (const role of SESSION_ROLE_VALUES) assert.equal(parseToolProfile({ WIKI_MCP_TOOL_PROFILE: role }), role);
  for (const env of [{}, { WIKI_MCP_TOOL_PROFILE: "" }, { WIKI_MCP_TOOL_PROFILE: "   " }]) {
    assert.throws(() => parseToolProfile(env), /WIKI_MCP_TOOL_PROFILE is required.*absent or empty profile/su);
  }
  for (const role of ["nonsense-role", "full", "agent-safe"]) {
    assert.throws(() => parseToolProfile({ WIKI_MCP_TOOL_PROFILE: role }), /Unsupported WIKI_MCP_TOOL_PROFILE/u);
    for (const name of ORCHESTRATOR) assert.equal(shouldExposeTool(role, name), false);
  }
});

test("current roles use exact central grants, deny retired routes and cannot widen through caller options", () => {
  assert.deepEqual([...SESSION_ROLE_VALUES].sort(), ["operator", "orchestrator", "redteam", "reviewer", "worker"]);
  const canonical = policy();
  assert.deepEqual(Object.keys(canonical.access).sort(), Object.keys(canonical.dispositions).sort());
  assert.deepEqual(Object.keys(canonical.access).filter(name => shouldExposeTool("orchestrator", name)).sort(), ORCHESTRATOR);
  for (const role of SESSION_ROLE_VALUES) {
    for (const [name, roles] of Object.entries(canonical.access)) {
      assert.equal(shouldExposeTool(role, name, { toolNames: new Set(["forged"]) }), roles.includes(role), `${role}/${name}`);
    }
    for (const name of ["forged", "commit", "workspace_submit_for_review", "workspace_read_page", "workspace_agent_dispatch"]) {
      assert.equal(shouldExposeTool(role, name), false, `${role}/${name}`);
    }
  }
  assert.equal(shouldExposeTool("worker", "workspace_deliver_work"), true);
  assert.equal(shouldExposeTool("orchestrator", "workspace_deliver_work"), false);
});

test("missing classifications and grants fail closed independently, including operator", () => {
  for (const removed of ["access", "dispositions"]) {
    const mutant = policy();
    delete mutant[removed].workspace_read_wiki;
    for (const role of SESSION_ROLE_VALUES) assert.equal(shouldExposeToolFromPolicy(role, "workspace_read_wiki", mutant), false);
  }
  const mutant = policy();
  mutant.access.workspace_read_wiki = mutant.access.workspace_read_wiki.filter(role => role !== "orchestrator");
  assert.equal(shouldExposeToolFromPolicy("orchestrator", "workspace_read_wiki", mutant), false);
  assert.equal(shouldExposeToolFromPolicy("operator", "workspace_read_wiki", mutant), true);
  const unknown = policy(); unknown.schema_version = "session-role-tool-access.v999";
  assert.throws(() => shouldExposeToolFromPolicy("orchestrator", "workspace_read_wiki", unknown), { code: "session_role_policy_incompatible_schema_version" });
});

test("both profiles require descriptor visibility independently of role grants", () => {
  for (const apiKey of [null, {value: "fixture"}]) {
    const profile = resolveSessionProfile({apiKey});
    assert.equal(sessionProfileAllowsTool(profile, {kind: "mcp_tool", tier_visibility: []}), false);
    assert.equal(sessionProfileAllowsTool(profile, {kind: "mcp_tool"}), false);
    assert.equal(sessionProfileAllowsTool(profile, {kind: "mcp_tool", tier_visibility: [profile.registeredTier]}), true);
  }
});
