

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { WORKER_COMMIT_TOOL_NAME } from "../../packages/agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs";
import {
  SESSION_ROLE_TOOL_ACCESS_POLICY_PATH,
  resolveToolAudience,
  resolveToolTierVisibility
} from "../../packages/wiki-core/src/lib/tool-discovery.mjs";
import {
  isToolTierRegistrable,
  parseToolProfile,
  shouldExposeTool,
  shouldExposeToolFromPolicy,
  SESSION_ROLE_VALUES
} from "../../packages/wiki-mcp/src/lib/tool-profile.mjs";

const SUBMIT_FOR_REVIEW = "workspace_submit_for_review";

function loadAccessPolicy() {
  return JSON.parse(readFileSync(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("known session roles are exactly the five policy roles", () => {
  assert.deepEqual(
    [...SESSION_ROLE_VALUES].sort(),
    ["operator", "orchestrator", "redteam", "reviewer", "worker"]
  );
});

test("orchestrator gets content reads, process-measurement reads, and authority; not delivery or cache writers", () => {
  const role = "orchestrator";
  for (const name of [
    "workspace_search_repo",
    "workspace_read_page",
    "workspace_validate_dispatch",
    "workspace_coordination_preflight",
    "workspace_initiative_status",
    "workspace_agent_run_wait",
    "workspace_node_engine_admission_runtime_diagnostic",
    "workspace_work_record_set_status",
    "workspace_agent_dispatch",
    "workspace_generate_and_lint"
  ]) {
    assert.equal(shouldExposeTool(role, name), true, `orchestrator must see ${name}`);
  }
  for (const name of [
    WORKER_COMMIT_TOOL_NAME,
    SUBMIT_FOR_REVIEW,
    "workspace_build_search_index",
    "workspace_code_index_build"
  ]) {
    assert.equal(shouldExposeTool(role, name), false, `orchestrator must not see ${name}`);
  }
});

test("reviewer and redteam get broad CONTENT reads + submit-for-review, but no process-measurement or authority", () => {
  for (const role of ["reviewer", "redteam"]) {
    for (const name of [
      "workspace_search_repo",
      "workspace_read_page",
      "workspace_get_record",
      "workspace_code_index_callers",
      "workspace_work_record_validate",
      "workspace_work_record_summary",
      SUBMIT_FOR_REVIEW
    ]) {
      assert.equal(shouldExposeTool(role, name), true, `${role} must see ${name}`);
    }

    for (const name of [
      "workspace_validate_dispatch",
      "workspace_coordination_preflight",
      "workspace_initiative_status",
      "workspace_integration_status",
      "workspace_agent_run_status",
      "workspace_agent_run_wait",
      "workspace_node_engine_admission_runtime_diagnostic",
      "workspace_work_record_set_status",
      "workspace_agent_dispatch",
      "workspace_create_record",
      WORKER_COMMIT_TOOL_NAME
    ]) {
      assert.equal(shouldExposeTool(role, name), false, `${role} must not see ${name}`);
    }
  }
});

test("worker gets the closed-input commit primitive and the launcher-bound declared-test capability", () => {
  const role = "worker";
  assert.equal(shouldExposeTool(role, WORKER_COMMIT_TOOL_NAME), true);

  assert.equal(shouldExposeTool(role, "workspace_worker_run_declared_test"), true);
  assert.equal(shouldExposeTool(role, SUBMIT_FOR_REVIEW), false);
  for (const name of [
    "workspace_search_repo",
    "workspace_read_page",
    "workspace_work_record_validate",
    "workspace_work_record_set_status",

    "workspace_run_validation"
  ]) {
    assert.equal(shouldExposeTool(role, name), false, `worker must not see ${name}`);
  }
});

test("operator (and the full alias) follow the exact central grant and deny unlisted names", () => {
  for (const profile of ["operator", "full"]) {
    for (const name of [
      "workspace_build_search_index",
      "workspace_code_index_rebuild",
      WORKER_COMMIT_TOOL_NAME,
      SUBMIT_FOR_REVIEW
    ]) {
      assert.equal(shouldExposeTool(profile, name), true, `${profile} must see ${name}`);
    }
    assert.equal(
      shouldExposeTool(profile, "some_unlisted_tool_name"),
      false,
      `${profile} must deny a policy-unlisted operation`
    );
  }
});

test("runtime requires matching sibling disposition and grant entries", () => {
  const policy = loadAccessPolicy();
  assert.deepEqual(
    Object.keys(policy.access).sort(),
    Object.keys(policy.dispositions).sort(),
    "the checked-in runtime policy populations must match exactly"
  );

  const missingDisposition = clone(policy);
  delete missingDisposition.dispositions.workspace_search_repo;
  assert.equal(
    shouldExposeToolFromPolicy("orchestrator", "workspace_search_repo", missingDisposition),
    false
  );

  const missingGrant = clone(policy);
  delete missingGrant.access.workspace_search_repo;
  assert.equal(
    shouldExposeToolFromPolicy("operator", "workspace_search_repo", missingGrant),
    false
  );
});

test("runtime refuses an unknown central policy schema", () => {
  const policy = loadAccessPolicy();
  policy.schema_version = "session-role-tool-access.v999";
  assert.throws(
    () => shouldExposeToolFromPolicy("orchestrator", "workspace_search_repo", policy),
    (error) => error?.code === "session_role_policy_incompatible_schema_version"
  );
});

test("resolved descriptor defaults and role/tier composition fail closed", () => {
  assert.deepEqual(resolveToolAudience({}), ["agent", "operator"]);
  assert.deepEqual(resolveToolTierVisibility({}), []);

  const name = "workspace_agent_dispatch";
  assert.equal(shouldExposeTool("orchestrator", name), true);
  assert.equal(isToolTierRegistrable("free_local", name, new Set([name])), false);
  assert.equal(isToolTierRegistrable("paid_cce", name, new Set([name])), true);
  assert.equal(shouldExposeTool("reviewer", name), false);
});

test("accepted-decision capability floor retains exactly the enumerated role grants", () => {
  const policy = loadAccessPolicy();
  const expected = {
    commit: ["worker", "operator"],
    workspace_worker_run_declared_test: ["worker", "operator"],
    workspace_verify_proof: ["orchestrator", "reviewer", "worker"],
    workspace_submit_for_review: ["reviewer", "redteam", "operator"]
  };
  for (const [name, roles] of Object.entries(expected)) {
    assert.deepEqual(policy.access[name], roles, name);
    for (const role of SESSION_ROLE_VALUES) {
      assert.equal(
        shouldExposeTool(role, name),
        roles.includes(role),
        `${name}/${role}`
      );
    }
  }
});

test("SLICE-008 retain-only identity preserves exposure and real removal mutants remain discriminating", () => {
  const baseline = loadAccessPolicy();
  const retainOnlyPolicy = clone(baseline);
  const classifiedNames = Object.keys(baseline.access).sort();
  assert.deepEqual(
    retainOnlyPolicy,
    baseline,
    "retain-only identity confirms that no candidate policy change occurred"
  );

  for (const role of ["orchestrator", "operator"]) {
    const visible = classifiedNames.filter((name) =>
      shouldExposeToolFromPolicy(role, name, retainOnlyPolicy));
    assert.equal(visible.length, role === "orchestrator" ? 112 : 142, role);
  }

  for (const [role, toolName] of [
    ["orchestrator", "workspace_search_repo"],
    ["operator", "lint_repo"]
  ]) {
    const countOnlyMutant = clone(baseline);
    countOnlyMutant.access[toolName] = countOnlyMutant.access[toolName]
      .filter((candidateRole) => candidateRole !== role);
    const before = classifiedNames.filter((name) =>
      shouldExposeToolFromPolicy(role, name, baseline));
    const after = classifiedNames.filter((name) =>
      shouldExposeToolFromPolicy(role, name, countOnlyMutant));
    assert.equal(after.length, before.length - 1, `${role}: raw count decreases`);
    assert.equal(shouldExposeToolFromPolicy(role, toolName, countOnlyMutant), false);
  }
});

test("agent-safe resolves to the orchestrator surface (transition alias)", () => {
  for (const name of [
    "workspace_search_repo",
    "workspace_validate_dispatch",
    "workspace_work_record_set_status",
    WORKER_COMMIT_TOOL_NAME,
    SUBMIT_FOR_REVIEW,
    "workspace_build_search_index"
  ]) {
    assert.equal(
      shouldExposeTool("agent-safe", name),
      shouldExposeTool("orchestrator", name),
      `agent-safe must mirror orchestrator for ${name}`
    );
  }
});

test("shouldExposeTool ignores any caller-threaded descriptor-derived set", () => {

  assert.equal(
    shouldExposeTool("reviewer", "workspace_agent_dispatch", {
      roleToolNames: new Set(["workspace_agent_dispatch"]),
      agentSafeToolNames: new Set(["workspace_agent_dispatch"])
    }),
    false
  );

  assert.equal(
    shouldExposeTool("reviewer", "workspace_search_repo", {
      roleToolNames: new Set(),
      agentSafeToolNames: new Set()
    }),
    true
  );
});

test("an unknown/unmintable profile is exposed nothing (fail closed)", () => {
  assert.equal(shouldExposeTool("nonsense-role", "workspace_search_repo"), false);
  assert.throws(() => parseToolProfile({ WIKI_MCP_TOOL_PROFILE: "nonsense-role" }));
});

test("an absent or empty profile is rejected (fail closed)", () => {
  for (const env of [
    {},
    { WIKI_MCP_TOOL_PROFILE: "" },
    { WIKI_MCP_TOOL_PROFILE: "   " }
  ]) {
    assert.throws(
      () => parseToolProfile(env),
      /WIKI_MCP_TOOL_PROFILE is required.*absent or empty profile/s
    );
  }
});
