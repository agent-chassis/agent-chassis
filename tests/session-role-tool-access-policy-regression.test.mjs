

import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_ROLE_VALUES,
  shouldExposeTool
} from "../packages/wiki-mcp/src/lib/tool-profile.mjs";
import {
  KNOWN_SESSION_ROLE_VALUES,
  collectRegisteredAgentReachableToolNames,
  lintSessionRoleToolAccessPolicy
} from "../packages/wiki-core/src/operations/lint.mjs";
import {
  SESSION_ROLE_TOOL_ACCESS_POLICY_PATH,
  resolveRoleToolGrantsFromPolicy,
  loadToolDiscoveryDescriptor
} from "../packages/wiki-core/src/lib/tool-discovery.mjs";

const AGENT_ROLES = Object.freeze(["orchestrator", "reviewer", "worker", "redteam"]);

function loadPolicy() {
  return JSON.parse(readFileSync(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH, "utf8"));
}

function collectFindings(descriptor, policy) {
  const findings = [];
  lintSessionRoleToolAccessPolicy({
    descriptor,
    policy,
    addFinding: (level, message, meta = {}) => findings.push({ level, message, ...meta })
  });
  return findings;
}

function registeredTool(toolName) {
  return {
    kind: "mcp_tool",
    tool_name: toolName,
    install_state: "installed",
    runtime_posture: "supported"
  };
}

test("F2: wiki-mcp SESSION_ROLE_VALUES equals wiki-core KNOWN_SESSION_ROLE_VALUES as a sorted set", () => {
  const mcpRoles = [...SESSION_ROLE_VALUES].sort();
  const coreRoles = [...KNOWN_SESSION_ROLE_VALUES].sort();
  assert.deepEqual(
    mcpRoles,
    coreRoles,
    "the wiki-mcp session-role enum and the wiki-core known-role enum used by the " +
      "completeness guard must stay identical (they cannot share a module across the " +
      "wiki-core<-wiki-mcp layering boundary)"
  );

  assert.equal(new Set(SESSION_ROLE_VALUES).size, SESSION_ROLE_VALUES.length);
  assert.equal(new Set(KNOWN_SESSION_ROLE_VALUES).size, KNOWN_SESSION_ROLE_VALUES.length);
});

test("F4: shouldExposeTool exposes EXACTLY each agent role's central-policy grant, no other role's tools", () => {
  const policy = loadPolicy();
  const grants = resolveRoleToolGrantsFromPolicy(policy);

  const allToolNames = Object.keys(policy.access);
  assert.ok(allToolNames.length > 0, "policy must classify at least one tool");

  for (const role of AGENT_ROLES) {
    const granted = grants.get(role) ?? new Set();
    for (const name of allToolNames) {
      const expected = granted.has(name);
      assert.equal(
        shouldExposeTool(role, name),
        expected,
        `${role} predicate exposure of '${name}' must match its central-policy grant ` +
          `(expected ${expected}); a mismatch is a predicate-level leak or a wrongly ` +
          "denied grant"
      );
    }
  }
});

test("F4: a tool granted only to one role is not visible to any other agent role at the predicate", () => {
  const policy = loadPolicy();
  const grants = resolveRoleToolGrantsFromPolicy(policy);

  assert.deepEqual([...(grants.get("worker") ?? new Set())].includes("commit"), true);
  for (const role of ["orchestrator", "reviewer", "redteam"]) {
    assert.equal(
      shouldExposeTool(role, "commit"),
      false,
      `${role} must not see the worker-only commit primitive`
    );
  }

  for (const orchestratorOnly of [
    "workspace_agent_dispatch",
    "workspace_validate_dispatch",
    "workspace_node_engine_admission_runtime_diagnostic",
    "workspace_work_record_set_status"
  ]) {
    for (const role of ["reviewer", "redteam", "worker"]) {
      assert.equal(
        shouldExposeTool(role, orchestratorOnly),
        false,
        `${role} must not see orchestrator-only '${orchestratorOnly}' at the predicate`
      );
    }
  }
});

test("guard: a valid complete policy over its registered corpus produces no findings", () => {
  const descriptor = { tools: [registeredTool("tool_a"), registeredTool("tool_b")] };
  const policy = {
    roles: [...KNOWN_SESSION_ROLE_VALUES],
    access: {
      tool_a: ["orchestrator", "operator"],
      tool_b: ["worker", "operator"]
    }
  };
  assert.deepEqual(collectFindings(descriptor, policy), []);
});

test("guard: a stranded tool (granted to zero roles) fails loudly", () => {

  const descriptor = { tools: [registeredTool("tool_a"), registeredTool("tool_b")] };
  const policy = { access: { tool_a: ["orchestrator"] } };
  const findings = collectFindings(descriptor, policy);
  const stranded = findings.filter((f) => f.code === "session_role_policy_tool_unassigned");
  assert.equal(stranded.length, 1);
  assert.equal(stranded[0].level, "error");
  assert.match(stranded[0].message, /tool_b/);
});

test("guard: a dangling policy entry (unregistered tool) fails loudly", () => {
  const descriptor = { tools: [registeredTool("tool_a")] };
  const policy = {
    access: {
      tool_a: ["orchestrator"],
      tool_ghost: ["orchestrator"]
    }
  };
  const findings = collectFindings(descriptor, policy);
  const dangling = findings.filter((f) => f.code === "session_role_policy_dangling_tool");
  assert.equal(dangling.length, 1);
  assert.equal(dangling[0].level, "error");
  assert.match(dangling[0].message, /tool_ghost/);
});

test("guard: an unknown role key fails loudly (grant list and declared roles enum)", () => {
  const descriptor = { tools: [registeredTool("tool_a")] };
  const policy = {
    roles: ["orchestrator", "bogus_declared_role"],
    access: { tool_a: ["orchestrator", "bogus_grant_role"] }
  };
  const findings = collectFindings(descriptor, policy);
  const unknown = findings.filter((f) => f.code === "session_role_policy_unknown_role");

  assert.equal(unknown.length, 2);
  assert.ok(unknown.every((f) => f.level === "error"));
  assert.ok(findings.some((f) => /bogus_grant_role/.test(f.message)));
  assert.ok(findings.some((f) => /bogus_declared_role/.test(f.message)));
});

test("guard: the checked-in policy is complete, non-dangling, and known-role over the real corpus", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const policy = loadPolicy();
  const findings = collectFindings(descriptor, policy);
  assert.deepEqual(
    findings,
    [],
    "the shipped session-role-tool-access.json must satisfy the completeness/dangling/" +
      `known-role guard over the assembled descriptor corpus; findings: ${JSON.stringify(findings)}`
  );

  assert.ok(collectRegisteredAgentReachableToolNames(descriptor).size > 0);
});
