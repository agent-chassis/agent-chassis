import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  LAUNCHER_AGENT_SESSION_CONTRACT_FIELDS,
  LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES,
  LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION,
  canonicalSerializeLauncherAgentSessionContract,
  digestLauncherAgentSessionContract,
  mintLauncherAgentSessionContract,
  mintTrustedStdioMcpConduitAuthority,
  resolveLauncherAgentSessionContract,
  resolveLauncherAgentSessionContractFacts
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";
import {
  authenticateLauncherAgentSessionContract
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-core.mjs";

function authority(role) {
  return mintTrustedStdioMcpConduitAuthority({
    family: "codex",
    role,
    assignedUnit: role === "orchestrator" ? "IN-0038" : "WK-2446#SLICE-005",
    workspaceDir: "/tmp/wk-2446-session-contract",
    canonicalWriteScope: role === "worker" ? ["tests", "packages"] : null
  });
}

function refusalCode(error) {
  return error?.detail?.refusal_code ?? error?.detail?.detail?.refusal_code ?? null;
}

function redigest(contract) {
  const withoutDigest = structuredClone(contract);
  delete withoutDigest.contract_digest;
  return { ...withoutDigest, contract_digest: digestLauncherAgentSessionContract(withoutDigest) };
}

test("v1 projection has the exact closed fields, canonical bytes, and role populations", () => {
  for (const role of ["orchestrator", "worker", "reviewer", "redteam"]) {
    const mintedAuthority = authority(role);
    const contract = resolveLauncherAgentSessionContract(mintedAuthority);
    assert.equal(contract.schema_version, LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION);
    assert.deepEqual(Object.keys(contract).sort(), [...LAUNCHER_AGENT_SESSION_CONTRACT_FIELDS].sort());
    assert.equal(contract.role, role);
    assert.equal(contract.lifecycle.review_purpose,
      role === "reviewer" || role === "redteam" ? "standalone" : null);
    assert.equal(contract.assigned_unit.slice_id,
      role === "orchestrator" ? null : "SLICE-005");
    assert.equal(contract.assigned_unit.record_id,
      role === "orchestrator" ? "IN-0038" : "WK-2446");
    assert.equal(contract.contract_digest, digestLauncherAgentSessionContract(contract));
    assert.equal(
      canonicalSerializeLauncherAgentSessionContract(contract).toString("utf8"),
      JSON.stringify(JSON.parse(canonicalSerializeLauncherAgentSessionContract(contract)))
    );
    assert.deepEqual(
      authenticateLauncherAgentSessionContract({
        contract: structuredClone(contract),
        expectedFacts: resolveLauncherAgentSessionContractFacts(mintedAuthority)
      }),
      contract
    );
  }
});

test("assigned-unit parsing is exact and role-aware", () => {
  assert.equal(
    resolveLauncherAgentSessionContract(authority("orchestrator")).assigned_unit.address,
    "IN-0038"
  );
  for (const assignedUnit of [
    "WK-2446#not-a-slice",
    "WK-2446#SLICE-1",
    "WK-2446#../../x",
    "WK-2446 trailing",
    " IN-0038",
    "IN-0038 "
  ]) {
    const minted = mintTrustedStdioMcpConduitAuthority({
      family: "codex",
      role: "worker",
      assignedUnit,
      workspaceDir: "/tmp/wk-2446-session-contract",
      canonicalWriteScope: []
    });
    assert.throws(() => resolveLauncherAgentSessionContract(minted), assignedUnit);
  }
  for (const role of ["worker", "reviewer", "redteam"]) {
    const minted = mintTrustedStdioMcpConduitAuthority({
      family: "codex",
      role,
      assignedUnit: "IN-0038",
      workspaceDir: "/tmp/wk-2446-session-contract",
      canonicalWriteScope: role === "worker" ? [] : null
    });
    assert.throws(() => resolveLauncherAgentSessionContract(minted), `${role}/IN-0038`);
  }
  const crossRole = mintTrustedStdioMcpConduitAuthority({
    family: "codex",
    role: "orchestrator",
    assignedUnit: "WK-2446",
    workspaceDir: "/tmp/wk-2446-session-contract"
  });
  assert.throws(() => resolveLauncherAgentSessionContract(crossRole), "orchestrator/WK-2446");
});

test("DEC-0182 action binding is closed and digest-bound", () => {
  const mintedAuthority = authority("reviewer");
  const body = {
    decision_id: "DEC-0182",
    action_id: "review-WK-2446",
    authenticated_actor_binding_digest: `sha256:${"a".repeat(64)}`,
    selected_findings_source_digest: `sha256:${"b".repeat(64)}`
  };
  const actionDigest = `sha256:${createHash("sha256").update(JSON.stringify({
      action_id: body.action_id,
      authenticated_actor_binding_digest: body.authenticated_actor_binding_digest,
      decision_id: body.decision_id,
      selected_findings_source_digest: body.selected_findings_source_digest
    })).digest("hex")}`;
  const facts = resolveLauncherAgentSessionContractFacts(mintedAuthority);
  const contract = mintLauncherAgentSessionContract({
    ...facts,
    operatorActionBinding: { ...body, action_binding_digest: actionDigest }
  });
  assert.equal(contract.minting_provenance.operator_action_binding.decision_id, "DEC-0182");
  assert.throws(() => mintLauncherAgentSessionContract({
    ...facts,
    operatorActionBinding: { ...body, action_binding_digest: `sha256:${"0".repeat(64)}` }
  }));
});

test("the neutral consumer exposes the complete ten-code refusal taxonomy", () => {
  assert.deepEqual(new Set(Object.values(LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES)), new Set([
    "session_contract_missing",
    "session_contract_schema_unsupported",
    "session_contract_shape_invalid",
    "session_contract_authority_untrusted",
    "session_contract_fact_mismatch",
    "session_contract_digest_mismatch",
    "session_contract_capability_unknown",
    "session_contract_completion_transport_mismatch",
    "session_contract_operator_action_binding_invalid",
    "session_contract_consumer_version_mismatch"
  ]));
  const mintedAuthority = authority("worker");
  const contract = resolveLauncherAgentSessionContract(mintedAuthority);
  const expectedFacts = resolveLauncherAgentSessionContractFacts(mintedAuthority);
  const cases = [
    [null, {}, "session_contract_missing"],
    [{ ...contract, schema_version: "launcher-stdio-mcp-completion-credential.v2" }, {},
      "session_contract_schema_unsupported"],
    [{ ...contract, extra: true }, {}, "session_contract_shape_invalid"],
    [contract, { expectedFacts: null }, "session_contract_authority_untrusted"],
    [redigest({ ...contract, repository: { repository_id: "other/repo" } }), {},
      "session_contract_fact_mismatch"],
    [redigest({ ...contract, capabilities: ["unknown"] }), {},
      "session_contract_capability_unknown"],
    [redigest({ ...contract, completion_transport: { transport_id: "standalone_findings" } }), {},
      "session_contract_completion_transport_mismatch"],
    [{ ...contract, repository: { repository_id: "other/repo" } }, {},
      "session_contract_digest_mismatch"]
  ];
  for (const [candidate, options, code] of cases) {
    assert.throws(() => authenticateLauncherAgentSessionContract({
      contract: candidate,
      expectedFacts,
      ...options
    }), (error) => refusalCode(error) === code);
  }
  assert.throws(() => authenticateLauncherAgentSessionContract({
    contract,
    expectedFacts,
    consumerVersion: "launcher-agent-session-contract.v2"
  }), (error) => refusalCode(error) === "session_contract_consumer_version_mismatch");
});
