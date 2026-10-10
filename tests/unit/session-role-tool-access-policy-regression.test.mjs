

import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SESSION_ROLE_VALUES,
  shouldExposeTool,
  shouldExposeToolFromPolicy
} from "../../packages/wiki-mcp/src/lib/tool-profile.mjs";
import {
  KNOWN_SESSION_ROLE_VALUES,
  collectRegisteredAgentReachableToolNames,
  lintSessionRoleToolAccessPolicy
} from "../../packages/wiki-core/src/operations/lint.mjs";
import {
  SESSION_ROLE_TOOL_ACCESS_POLICY_PATH,
  resolveRoleToolGrantsFromPolicy,
  loadToolDiscoveryDescriptor
} from "../../packages/wiki-core/src/lib/tool-discovery.mjs";
import {
  loadSessionRoleToolAccessPolicy,
  resolveToolDispositionsFromPolicy,
  SESSION_ROLE_TOOL_ACCESS_POLICY_FILENAME,
  SESSION_ROLE_TOOL_ACCESS_POLICY_KIND,
  SESSION_ROLE_TOOL_ACCESS_POLICY_RELATIVE_PATH,
  SESSION_ROLE_TOOL_ACCESS_POLICY_SCHEMA_VERSION,
  SESSION_ROLE_TOOL_DISPOSITIONS,
  SESSION_ROLE_TOOL_DISPOSITION_VALUES
} from "../../packages/wiki-core/src/lib/tool-discovery/gating.mjs";
import {
  resolveFrozenReviewContractArtifact,
  resolveLauncherRunState
} from "../../packages/wiki-mcp/src/lib/launcher-run-credential.mjs";
import {
  canonicalSerializeLauncherAgentSessionContract,
  mintTrustedStdioMcpConduitAuthority,
  resolveLauncherAgentSessionContract
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";

const AGENT_ROLES = Object.freeze(["orchestrator", "reviewer", "worker", "redteam"]);

const SLICE_008_POLICY_SHA256 =
  "7b8a59af867b6884a607c912d0cbe11b2ab713ad9ac9ee2dfbc7e8e5f6791f5d";
const SLICE_008_NORMALIZED_ACCESS_GRANT_SHA256 =
  "fd850e4c7485dfe3e2ff8317b2903cc9cadeb6b82b6a1ed03d054a402d150372";
const SLICE_008_PROTECTED_ROLE_GRANTS = Object.freeze({
  commit: Object.freeze(["operator"]),
  verify_proof: Object.freeze(["orchestrator"]),
  workspace_submit_for_review: Object.freeze(["operator"])
});

function loadPolicy() {
  return JSON.parse(readFileSync(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedAccessGrantBytes(policy) {
  return JSON.stringify(Object.fromEntries(
    Object.keys(policy.access).sort().map((toolName) => [
      toolName,
      [...policy.access[toolName]].sort()
    ])
  ));
}

function classifySlice008Candidate({ role, tool }) {
  if (SLICE_008_PROTECTED_ROLE_GRANTS[tool.tool_name]?.includes(role)) {
    return "retained_protected_decision_required";
  }
  const nonReadOnlyOrNonDescriptorAuthority =
    tool.side_effects.some((effect) => effect !== "read_only") ||
    tool.authority.some((source) => source !== "checked_in_descriptor");
  return nonReadOnlyOrNonDescriptorAuthority
    ? "retained_unproven_non_read_only_or_non_descriptor_authority"
    : "retained_unproven_authenticated_client";
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
    runtime_posture: "supported",
    audience: ["agent", "operator"],
    tier_visibility: ["free_local"]
  };
}

function policyFor(access, dispositions = null) {
  return {
    schema_version: SESSION_ROLE_TOOL_ACCESS_POLICY_SCHEMA_VERSION,
    kind: SESSION_ROLE_TOOL_ACCESS_POLICY_KIND,
    roles: [...KNOWN_SESSION_ROLE_VALUES],
    access,
    dispositions: dispositions ?? Object.fromEntries(
      Object.keys(access).map((toolName) => [toolName, [SESSION_ROLE_TOOL_DISPOSITIONS.DIRECT]])
    )
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

  assert.deepEqual([...(grants.get("worker") ?? new Set())].includes("workspace_deliver_work"), true);
  for (const role of ["orchestrator", "reviewer", "redteam"]) {
    assert.equal(
      shouldExposeTool(role, "workspace_deliver_work"),
      false,
      `${role} must not see the worker-only commit primitive`
    );
  }

  for (const orchestratorOnly of [
    "start_agent", "save_record", "integrate_work", "workspace_advance_candidate"
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

test("verify_proof is exposed only to authenticated execution roles", () => {
  const policy = loadPolicy();
  assert.deepEqual(
    policy.access.verify_proof,
    ["orchestrator", "reviewer", "worker"]
  );
  for (const role of ["orchestrator", "reviewer", "worker"]) {
    assert.equal(shouldExposeTool(role, "verify_proof"), true, role);
  }
  for (const role of ["redteam", "operator"]) {
    assert.equal(shouldExposeTool(role, "verify_proof"), false, role);
  }
});

test("workspace_run_test is exposed only to authenticated execution roles", () => {
  const policy = loadPolicy();
  assert.deepEqual(policy.access.workspace_run_test, ["orchestrator", "reviewer", "worker"]);
  assert.deepEqual(policy.dispositions.workspace_run_test, [SESSION_ROLE_TOOL_DISPOSITIONS.DIRECT]);
  assert.deepEqual(policy.access.workspace_run_test, policy.access.verify_proof,
    "ordinary execution grants exactly the proof-execution roles");
  const grants = resolveRoleToolGrantsFromPolicy(policy);
  for (const role of ["orchestrator", "reviewer", "worker"]) {
    assert.equal(shouldExposeTool(role, "workspace_run_test"), true, role);
    assert.equal(grants.get(role)?.has("workspace_run_test"), true, role);
  }
  for (const role of ["redteam", "operator"]) {
    assert.equal(shouldExposeTool(role, "workspace_run_test"), false, role);
  }
  assert.deepEqual(Object.keys(policy.access).filter((name) => /run_test|ordinary_test/u.test(name)),
    ["workspace_run_test"], "no alias or second ordinary-test route");
});

test("frozen review contract query is visible only to operator", () => {
  const policy = loadPolicy();
  assert.deepEqual(
    policy.access.workspace_frozen_review_contract_query,
    ["operator"]
  );

  const grants = resolveRoleToolGrantsFromPolicy(policy);
  for (const role of ["orchestrator", "reviewer", "redteam", "worker"]) {
    assert.equal(
      grants.get(role)?.has("workspace_frozen_review_contract_query") ?? false,
      false,
      `${role} must not receive frozen review contract query discovery visibility`
    );
  }
  assert.equal(grants.get("operator")?.has("workspace_frozen_review_contract_query"), true);
});

function frozenArtifactFixture(t, {
  reviewPurpose = "standalone",
  assignedUnit = "WK-2300#SLICE-001",
  artifactSubject = "WK-2300#SLICE-001",
  schemaVersion = "workspace-agent-frozen-standalone-findings-acceptance-contract.v1"
} = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "wk2300-redteam-query-"));
  chmodSync(directory, 0o700);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const unit = {
    id: "SLICE-001",
    work_kind: "redteam",
    write_scope: [],
    dispatch_intent: { intended_agent_role: "redteam", target_unit: "slice" },
    acceptance: { criteria: ["advisory findings"], validation: ["node --test"] }
  };
  if (reviewPurpose !== null) unit.review_purpose = reviewPurpose;
  const bytes = Buffer.from(JSON.stringify({
    canonical_parent_wk_contract: JSON.stringify({ id: "WK-2300", slices: [unit] }),
    review_subject: artifactSubject,
    review_unit_contract: JSON.stringify(unit),
    schema_version: schemaVersion
  }));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const artifactPath = path.join(directory,
    `frozen-review-contract-sha256-${digest}.json`);
  writeFileSync(artifactPath, bytes, { mode: 0o600 });
  chmodSync(artifactPath, 0o400);
  const tuple = {
    assigned_unit: assignedUnit,
    launch_ref: "wkmh-redteam-1",
    run_id: "wkdb-redteam-1",
    retry_id: 0
  };
  const sessionContract = resolveLauncherAgentSessionContract(
    mintTrustedStdioMcpConduitAuthority({
      family: "codex",
      role: "redteam",
      assignedUnit,
      workspaceDir: directory
    })
  );
  const sessionContractBytes = canonicalSerializeLauncherAgentSessionContract(
    sessionContract
  ).toString("utf8");
  const env = {
    WIKI_MCP_TOOL_PROFILE: "redteam",
    WIKI_MCP_ASSIGNED_UNIT: assignedUnit,
    WIKI_MCP_WORKSPACE_DIR: directory,
    WIKI_MCP_COMMIT_LAUNCH_REF: tuple.launch_ref,
    WIKI_MCP_COMMIT_RUN_ID: tuple.run_id,
    WIKI_MCP_COMMIT_RETRY_ID: "0",
    WIKI_MCP_FROZEN_REVIEW_CONTRACT_PATH: artifactPath,
    WIKI_MCP_AGENT_SESSION_CONTRACT: sessionContractBytes,
    WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT: sessionContractBytes
  };
  const state = resolveLauncherRunState(env, {
    readManagedRunIdentity: () => ({ state: "bound", role: "redteam", tuple })
  });
  return { artifactPath, env, state, tuple };
}

test("redteam frozen-query credential authenticates exact run, unit, subject, purpose, and artifact", (t) => {
  const valid = frozenArtifactFixture(t);
  const accepted = resolveFrozenReviewContractArtifact({ state: valid.state });
  assert.equal(accepted.technical_role, "redteam");
  assert.equal(accepted.review_purpose, "standalone");
  assert.equal(accepted.review_subject, "WK-2300#SLICE-001");

  const omitted = frozenArtifactFixture(t, {
    reviewPurpose: null,
    schemaVersion: "workspace-agent-frozen-findings-only-acceptance-contract.v1"
  });
  const mismatched = frozenArtifactFixture(t, { reviewPurpose: "terminal_whole_wk" });
  const wrongUnit = frozenArtifactFixture(t, {
    assignedUnit: "WK-2300#SLICE-002",
    artifactSubject: "WK-2300#SLICE-002"
  });
  const wrongSubject = frozenArtifactFixture(t, {
    artifactSubject: "WK-2300#SLICE-002"
  });
  for (const [state, label] of [
    [omitted.state, "omitted purpose"],
    [mismatched.state, "mismatched purpose"],
    [wrongUnit.state, "wrong unit"],
    [wrongSubject.state, "wrong subject"],
    [{ ...valid.state, managedRunBinding: null }, "absent binding"],
    [{ ...valid.state, managedRunBinding: Object.freeze({}) }, "substituted binding"],
    [{ ...valid.state, role: "reviewer" }, "role only"],
    [{ ...valid.state, credential: { ...valid.state.credential, runId: "wkdb-redteam-2" } },
      "wrong run"]
  ]) {
    assert.equal(resolveFrozenReviewContractArtifact({ state }).readable, false, label);
  }
  chmodSync(valid.artifactPath, 0o600);
  assert.equal(resolveFrozenReviewContractArtifact({ state: valid.state }).readable, false,
    "unauthenticated artifact permissions");
});

test("guard: a valid complete policy over its registered corpus produces no findings", () => {
  const descriptor = { tools: [registeredTool("tool_a"), registeredTool("tool_b")] };
  const policy = policyFor({
      tool_a: ["orchestrator", "operator"],
      tool_b: ["worker", "operator"]
  });
  assert.deepEqual(collectFindings(descriptor, policy), []);
});

test("guard: a stranded tool (granted to zero roles) fails loudly", () => {

  const descriptor = { tools: [registeredTool("tool_a"), registeredTool("tool_b")] };
  const policy = policyFor({ tool_a: ["orchestrator"] }, {
    tool_a: [SESSION_ROLE_TOOL_DISPOSITIONS.DIRECT],
    tool_b: [SESSION_ROLE_TOOL_DISPOSITIONS.DIRECT]
  });
  const findings = collectFindings(descriptor, policy);
  const stranded = findings.filter((f) => f.code === "session_role_policy_tool_unassigned");
  assert.equal(stranded.length, 1);
  assert.equal(stranded[0].level, "error");
  assert.match(stranded[0].message, /tool_b/);
});

test("guard: a dangling policy entry (unregistered tool) fails loudly", () => {
  const descriptor = { tools: [registeredTool("tool_a")] };
  const policy = policyFor({
      tool_a: ["orchestrator"],
      tool_ghost: ["orchestrator"]
  });
  const findings = collectFindings(descriptor, policy);
  const dangling = findings.filter((f) => f.code === "session_role_policy_dangling_tool");
  assert.equal(dangling.length, 1);
  assert.equal(dangling[0].level, "error");
  assert.match(dangling[0].message, /tool_ghost/);
});

test("guard: an unknown role key fails loudly (grant list and declared roles enum)", () => {
  const descriptor = { tools: [registeredTool("tool_a")] };
  const policy = policyFor({ tool_a: ["orchestrator", "bogus_grant_role"] });
  policy.roles = ["orchestrator", "bogus_declared_role"];
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

test("guard: checked-in policy classifies the exact supported operation population once", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const policy = loadPolicy();
  const supported = collectRegisteredAgentReachableToolNames(descriptor);
  const dispositions = resolveToolDispositionsFromPolicy(policy);

  assert.equal(dispositions.size, supported.size);
  assert.deepEqual([...dispositions.keys()].sort(), [...supported].sort());
  assert.ok(
    [...dispositions.values()].every((value) =>
      SESSION_ROLE_TOOL_DISPOSITION_VALUES.includes(value)
    )
  );
  const totals = Object.fromEntries(SESSION_ROLE_TOOL_DISPOSITION_VALUES.map((value) => [
    value,
    [...dispositions.values()].filter((candidate) => candidate === value).length
  ]));
  assert.equal(Object.values(totals).reduce((sum, count) => sum + count, 0), supported.size);
  assert.ok(totals[SESSION_ROLE_TOOL_DISPOSITIONS.DIRECT] > 0);
  assert.ok(totals[SESSION_ROLE_TOOL_DISPOSITIONS.OPERATOR_RECOVERY_ONLY] > 0);
  assert.equal(path.isAbsolute(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH), true);
  assert.equal(SESSION_ROLE_TOOL_ACCESS_POLICY_FILENAME, "session-role-tool-access.json");
  assert.equal(
    SESSION_ROLE_TOOL_ACCESS_POLICY_RELATIVE_PATH,
    "packages/wiki-core/data/tool-discovery/session-role-tool-access.json"
  );
});

test("guard: missing, duplicate, and unknown dispositions fail loudly", () => {
  const descriptor = { tools: [registeredTool("tool_a"), registeredTool("tool_b")] };

  const missing = policyFor(
    { tool_a: ["orchestrator"], tool_b: ["operator"] },
    { tool_a: [SESSION_ROLE_TOOL_DISPOSITIONS.DIRECT] }
  );
  assert.ok(collectFindings(descriptor, missing).some(
    (finding) => finding.code === "session_role_policy_supported_operation_unclassified" &&
      /tool_b/.test(finding.message)
  ));

  const duplicate = policyFor(
    { tool_a: ["orchestrator"], tool_b: ["operator"] },
    {
      tool_a: [SESSION_ROLE_TOOL_DISPOSITIONS.DIRECT, SESSION_ROLE_TOOL_DISPOSITIONS.DIRECT],
      tool_b: [SESSION_ROLE_TOOL_DISPOSITIONS.DIRECT]
    }
  );
  assert.ok(collectFindings(descriptor, duplicate).some(
    (finding) => finding.code === "session_role_policy_invalid_disposition_count"
  ));

  const unknown = policyFor(
    { tool_a: ["orchestrator"], tool_b: ["operator"] },
    { tool_a: ["invented_disposition"], tool_b: [SESSION_ROLE_TOOL_DISPOSITIONS.DIRECT] }
  );
  assert.ok(collectFindings(descriptor, unknown).some(
    (finding) => finding.code === "session_role_policy_unknown_disposition"
  ));
});

test("guard: disposition/grant and resolved audience/tier conflicts fail loudly", () => {
  const directPolicy = policyFor({ tool_a: ["orchestrator", "operator"] });

  const indirectWithAgentGrant = policyFor(
    { tool_a: ["orchestrator", "operator"] },
    { tool_a: [SESSION_ROLE_TOOL_DISPOSITIONS.CLOSED_TYPED_FRONT_DOOR] }
  );
  assert.ok(collectFindings(
    { tools: [registeredTool("tool_a")] },
    indirectWithAgentGrant
  ).some((finding) => finding.code === "session_role_policy_disposition_grant_conflict"));

  const continuationWithAgentGrant = policyFor(
    { tool_a: ["orchestrator", "operator"] },
    { tool_a: [SESSION_ROLE_TOOL_DISPOSITIONS.SERVER_ISSUED_CONTINUATION] }
  );
  assert.deepEqual(collectFindings(
    { tools: [registeredTool("tool_a")] },
    continuationWithAgentGrant
  ), [], "a server-issued continuation is an agent-callable authority gate");

  const operatorAudienceOnly = {
    ...registeredTool("tool_a"),
    audience: ["operator"]
  };
  assert.ok(collectFindings(
    { tools: [operatorAudienceOnly] },
    directPolicy
  ).some((finding) => finding.code === "session_role_policy_disposition_axis_conflict"));

  const operatorTierOnly = {
    ...registeredTool("tool_a"),
    tier_visibility: ["operator_only"]
  };
  assert.ok(collectFindings(
    { tools: [operatorTierOnly] },
    directPolicy
  ).some((finding) => finding.code === "session_role_policy_disposition_axis_conflict"));
});

test("guard: operator recovery accepts an operator-only grant across registered tiers", () => {
  const dispositions = {
    tool_a: [SESSION_ROLE_TOOL_DISPOSITIONS.OPERATOR_RECOVERY_ONLY]
  };
  const descriptor = { tools: [registeredTool("tool_a")] };

  assert.deepEqual(
    collectFindings(descriptor, policyFor({ tool_a: ["operator"] }, dispositions)),
    [],
    "an operator-only grant remains operator/recovery-only when tier visibility is free_local"
  );

  assert.ok(collectFindings(
    descriptor,
    policyFor({ tool_a: ["orchestrator", "operator"] }, dispositions)
  ).some((finding) => finding.code === "session_role_policy_disposition_grant_conflict"));
});

test("guard: audience-absent entries use the canonical resolved default", () => {
  const descriptorEntry = registeredTool("tool_a");
  delete descriptorEntry.audience;
  const findings = collectFindings(
    { tools: [descriptorEntry] },
    policyFor({ tool_a: ["orchestrator", "operator"] })
  );
  assert.deepEqual(findings, []);
});

test("guard: unsupported descriptor operations stay outside the classified population", () => {
  const unsupported = {
    ...registeredTool("tool_retired"),
    runtime_posture: "deactivated"
  };
  assert.deepEqual(
    collectFindings(
      { tools: [registeredTool("tool_a"), unsupported] },
      policyFor({ tool_a: ["orchestrator"] })
    ),
    []
  );
});

test("guard: a supported operation outside access and dispositions fails both population gates", () => {
  const findings = collectFindings(
    { tools: [registeredTool("tool_a"), registeredTool("tool_new")] },
    policyFor({ tool_a: ["orchestrator"] })
  );
  assert.ok(findings.some((finding) =>
    finding.code === "session_role_policy_tool_unassigned" && /tool_new/.test(finding.message)
  ));
  assert.ok(findings.some((finding) =>
    finding.code === "session_role_policy_supported_operation_unclassified" &&
      /tool_new/.test(finding.message)
  ));
});

test("required policy loader models absent, unreadable, malformed, and invalid input", async () => {
  const absent = await loadSessionRoleToolAccessPolicy({
    readPolicyFile: async () => {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    }
  });
  assert.equal(absent.policy, null);
  assert.deepEqual(absent.diagnostics.map((entry) => entry.code), [
    "session_role_policy_required_file_absent"
  ]);

  const unreadable = await loadSessionRoleToolAccessPolicy({
    readPolicyFile: async () => {
      const error = new Error("permission denied");
      error.code = "EACCES";
      throw error;
    }
  });
  assert.equal(unreadable.policy, null);
  assert.deepEqual(unreadable.diagnostics.map((entry) => entry.code), [
    "session_role_policy_required_file_unreadable"
  ]);

  const malformed = await loadSessionRoleToolAccessPolicy({
    readPolicyFile: async () => "{"
  });
  assert.equal(malformed.policy, null);
  assert.deepEqual(malformed.diagnostics.map((entry) => entry.code), [
    "session_role_policy_invalid_json"
  ]);

  const invalid = await loadSessionRoleToolAccessPolicy({
    readPolicyFile: async () => JSON.stringify({
      schema_version: SESSION_ROLE_TOOL_ACCESS_POLICY_SCHEMA_VERSION,
      kind: SESSION_ROLE_TOOL_ACCESS_POLICY_KIND,
      roles: [...KNOWN_SESSION_ROLE_VALUES]
    })
  });
  assert.ok(invalid.policy);
  assert.ok(invalid.diagnostics.some((entry) =>
    entry.code === "session_role_policy_missing_access"
  ));
  assert.ok(invalid.diagnostics.some((entry) =>
    entry.code === "session_role_policy_missing_dispositions"
  ));
});

test("unrecognized schema_version is rejected by loading, lint, and both resolvers", async () => {
  const descriptor = { tools: [registeredTool("tool_a")] };
  const policy = policyFor({ tool_a: ["orchestrator"] });
  policy.schema_version = "session-role-tool-access.v999";

  assert.ok(collectFindings(descriptor, policy).some(
    (finding) => finding.code === "session_role_policy_incompatible_schema_version"
  ));
  const loaded = await loadSessionRoleToolAccessPolicy({
    readPolicyFile: async () => JSON.stringify(policy)
  });
  assert.ok(loaded.diagnostics.some(
    (diagnostic) => diagnostic.code === "session_role_policy_incompatible_schema_version"
  ));
  assert.throws(
    () => resolveRoleToolGrantsFromPolicy(policy),
    (error) => error?.code === "session_role_policy_incompatible_schema_version"
  );
  assert.throws(
    () => resolveToolDispositionsFromPolicy(policy),
    (error) => error?.code === "session_role_policy_incompatible_schema_version"
  );
});

test("proof-tool retirement preserves the exact remaining role populations", () => {
  const policy = loadPolicy();
  assert.equal(Object.hasOwn(policy.access,
    "workspace_controlled_contract_private_scope_census"), false);
  assert.equal(Object.hasOwn(policy.dispositions,
    "workspace_controlled_contract_private_scope_census"), false);
  assert.deepEqual(Object.fromEntries(policy.roles.map((role) => [
    role,
    Object.values(policy.access).filter((grants) => grants.includes(role)).length
  ])), {
    orchestrator: 15,
    reviewer: 7,
    worker: 5,
    redteam: 4,
    operator: 28
  });
});

test("consolidated proof and authoring tasks own their exact grants", () => {
  const policy = loadPolicy();
  for (const name of ["save_record", "workspace_create_record"]) {
    assert.deepEqual(policy.access[name], ["orchestrator", "operator"]);
    assert.deepEqual(policy.dispositions[name], ["direct"]);
  }
  assert.deepEqual(policy.access.workspace_find_proofs, ["orchestrator", "reviewer", "redteam", "operator"]);
  assert.deepEqual(policy.access.workspace_assess_contract, ["orchestrator", "reviewer", "redteam", "operator"]);
  for (const name of ["workspace_controlled_contract_obligation_coverage_query",
    "workspace_controlled_contract_obligation_coverage_upsert", "workspace_work_record_entry_read",
    "workspace_work_record_entry_upsert", "workspace_controlled_proof_intents_discover"]) {
    assert.equal(Object.hasOwn(policy.access, name), false);
    assert.equal(Object.hasOwn(policy.dispositions, name), false);
    for (const role of policy.roles) assert.equal(shouldExposeTool(role, name), false);
  }
});

test("query_code_index inherits the replaced code reads' grants and leaves no alias", () => {
  const policy = loadPolicy();
  const question = "query_code_index";
  const replaced = ["workspace_code_index_impact", "workspace_code_index_context_for_path",
    "workspace_code_index_definition", "workspace_code_index_find_references",
    "workspace_code_index_callers", "workspace_code_index_callees", "workspace_code_index_status"];
  const expected = ["orchestrator", "reviewer", "redteam", "operator"];
  assert.deepEqual(policy.access[question], expected);
  assert.deepEqual(policy.dispositions[question], ["direct"]);
  const grants = resolveRoleToolGrantsFromPolicy(policy);
  for (const route of replaced) {
    assert.equal(Object.hasOwn(policy.access, route), false, `${route} keeps no grant`);
    assert.equal(Object.hasOwn(policy.dispositions, route), false, `${route} keeps no disposition`);
    for (const role of [...AGENT_ROLES, "worker"]) {
      assert.equal(shouldExposeTool(role, route), false, `${role} must not reach ${route}`);
      assert.equal(grants.get(role)?.has(route) ?? false, false, `${role} grant -> ${route}`);
    }
  }
  for (const role of AGENT_ROLES) {
    const granted = expected.includes(role);
    assert.equal(shouldExposeTool(role, question), granted, `${role} -> ${question}`);
    assert.equal(grants.get(role)?.has(question) ?? false, granted, `${role} grant -> ${question}`);
  }
  assert.equal(shouldExposeTool("worker", question), false, "a worker never reaches the code read");
  for (const writer of ["workspace_code_index_build", "workspace_code_index_rebuild"]) {
    assert.deepEqual(policy.access[writer], ["operator"], `${writer} stays operator-only`);
  }
});

test("selected wiki and result readers grant workers without a spill-reader bypass", () => {
  const policy = loadPolicy();
  assert.deepEqual(policy.access.workspace_read_wiki, ["orchestrator", "reviewer", "worker", "redteam", "operator"]);
  assert.deepEqual(policy.access.get_run_result, ["orchestrator", "worker", "reviewer"]);
  assert.equal(shouldExposeTool("worker", "get_run_result"), true);
  assert.equal(shouldExposeTool("redteam", "get_run_result"), false);
  for (const name of ["workspace_read_mcp_content_reference", "workspace_read_page", "workspace_get_record"]) {
    for (const role of policy.roles) assert.equal(shouldExposeTool(role, name), false);
  }
});
