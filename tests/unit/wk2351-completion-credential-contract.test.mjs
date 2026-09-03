import assert from "node:assert/strict";
import test from "node:test";

import {
  LAUNCHER_AGENT_SESSION_CONTRACT_FIELDS,
  LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION,
  digestLauncherAgentSessionContract,
  mintTrustedStdioMcpConduitAuthority,
  resolveLauncherAgentSessionContract,
  resolveLauncherAgentSessionContractFacts
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";
import {
  authenticateLauncherAgentSessionContract
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-core.mjs";

function reviewerAuthority() {
  return mintTrustedStdioMcpConduitAuthority({
    family: "codex",
    role: "reviewer",
    assignedUnit: "WK-2351#SLICE-003",
    workspaceDir: "/workspace/agent-chassis"
  });
}

function fixture() {
  const authority = reviewerAuthority();
  return {
    authority,
    contract: resolveLauncherAgentSessionContract(authority),
    expectedFacts: resolveLauncherAgentSessionContractFacts(authority)
  };
}

function redigest(contract) {
  const candidate = structuredClone(contract);
  delete candidate.contract_digest;
  return { ...candidate, contract_digest: digestLauncherAgentSessionContract(candidate) };
}

function refusal(contract, expectedFacts, refusalCode) {
  assert.throws(
    () => authenticateLauncherAgentSessionContract({ contract, expectedFacts }),
    (error) => error.code === "stdio_mcp_conduit_input_invalid" &&
      error.detail?.refusal_code === refusalCode
  );
}

test("mints the exact frozen v1 launcher agent session contract", () => {
  const { contract } = fixture();
  assert.equal(LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION,
    "launcher-agent-session-contract.v1");
  assert.deepEqual(Object.keys(contract).sort(),
    [...LAUNCHER_AGENT_SESSION_CONTRACT_FIELDS].sort());
  assert.equal(contract.schema_version, LAUNCHER_AGENT_SESSION_CONTRACT_SCHEMA_VERSION);
  assert.equal(contract.role, "reviewer");
  assert.deepEqual(contract.assigned_unit, {
    record_id: "WK-2351",
    slice_id: "SLICE-003",
    address: "WK-2351#SLICE-003"
  });
  assert.equal(contract.completion_transport.transport_id, "standalone_findings");
  assert.equal(contract.contract_digest, digestLauncherAgentSessionContract(contract));
  assert.equal(Object.isFrozen(contract), true);
});

test("authenticates v1 against launcher-resolved facts and returns a frozen projection", () => {
  const { contract, expectedFacts } = fixture();
  const authenticated = authenticateLauncherAgentSessionContract({
    contract: structuredClone(contract),
    expectedFacts
  });
  assert.deepEqual(authenticated, contract);
  assert.equal(Object.isFrozen(authenticated), true);
});

test("authenticates role from launcher authority without a transported technical-role field", () => {
  const { contract, expectedFacts } = fixture();
  assert.equal("technical_role" in contract, false);
  refusal(redigest({ ...contract, role: "redteam" }), expectedFacts,
    "session_contract_fact_mismatch");
});

test("classifies an unsupported present session schema before the current field inventory", () => {
  const { contract, expectedFacts } = fixture();
  refusal({ schema_version: "launcher-agent-session-contract.unsupported" }, expectedFacts,
    "session_contract_schema_unsupported");
  refusal({
    ...contract,
    schema_version: "launcher-agent-session-contract.unsupported",
    unexpected: true
  }, expectedFacts, "session_contract_schema_unsupported");
});

test("refuses authority provenance not minted by the expected launcher authority", () => {
  const { contract, expectedFacts } = fixture();
  const untrusted = structuredClone(contract);
  untrusted.minting_provenance.authority_digest = `sha256:${"0".repeat(64)}`;
  refusal(redigest(untrusted), expectedFacts, "session_contract_authority_untrusted");
  refusal(contract, null, "session_contract_authority_untrusted");
});

test("classifies current transported session-contract fact mismatches", () => {
  const { contract, expectedFacts } = fixture();
  const cases = [
    [redigest({
      ...contract,
      repository: { repository_id: "other/repository" }
    }), "session_contract_fact_mismatch"],
    [redigest({
      ...contract,
      assigned_unit: {
        record_id: "WK-2351",
        slice_id: "SLICE-004",
        address: "WK-2351#SLICE-004"
      }
    }), "session_contract_fact_mismatch"],
    [redigest({ ...contract, capabilities: ["unknown_capability"] }),
      "session_contract_capability_unknown"],
    [redigest({
      ...contract,
      completion_transport: { transport_id: "workspace_submit_for_review" }
    }), "session_contract_completion_transport_mismatch"]
  ];
  for (const [candidate, code] of cases) refusal(candidate, expectedFacts, code);
});

test("refuses missing, malformed, and digest-mismatched session contracts", () => {
  const { contract, expectedFacts } = fixture();
  refusal(undefined, expectedFacts, "session_contract_missing");
  refusal("not-an-object", expectedFacts, "session_contract_shape_invalid");
  refusal({ ...contract, unexpected: true }, expectedFacts,
    "session_contract_shape_invalid");
  refusal({ ...contract, role: "redteam" }, expectedFacts,
    "session_contract_digest_mismatch");
});
