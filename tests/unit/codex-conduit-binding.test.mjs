import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  CODEX_CONDUIT_BINDING_REFUSAL_REASON,
  resolveCodexConduitInput
} from "../../packages/agent-launch-cli/src/lib/codex-conduit-binding.mjs";
import {
  digestLauncherAgentSessionContract,
  isTrustedStdioMcpConduitAuthority,
  mintTrustedStdioMcpConduitAuthority,
  resolveLauncherAgentSessionContract
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";
import { mintStdioMcpCompletionCredential } from
  "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit.mjs";
import { classifyLauncherFindingsCompletionTransport } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-role-contract.mjs";

const WORKSPACE = path.resolve(process.cwd());
const ASSIGNED_UNIT = "WK-1678#SLICE-009";

function workerCarriers() {
  const sliceBinding = Object.freeze({
    schema_version: "worktree-identity-binding.v2",
    unit_address: "IN-0031/WK-1678/SLICE-009",
    checkout_mode: "full"
  });
  const authority = Object.freeze({
    unit_address: sliceBinding.unit_address,
    selected_unit: Object.freeze({ address: ASSIGNED_UNIT }),
    source_digest: "sha256:test",
    read_scope: Object.freeze(["docs/**"]),
    repo_paths: Object.freeze(["packages/agent-launch-cli/**"]),
    write_scope: Object.freeze(["packages/agent-launch-cli/src/lib/codex-conduit-binding.mjs"])
  });
  const provisioning = Object.freeze({
    unit_address: sliceBinding.unit_address,
    main_repo: WORKSPACE,
    write_scope: authority.write_scope,
    slice_binding: sliceBinding
  });
  return { authority, provisioning, sliceBinding };
}

test("WK-1678: Codex conduit input carries the exact launcher-minted worktree and R∪W binding", () => {
  const { authority, provisioning, sliceBinding } = workerCarriers();
  const input = resolveCodexConduitInput({
    role: "worker",
    assignedUnit: ASSIGNED_UNIT,
    workspaceDir: WORKSPACE,
    workerScopeAuthority: authority,
    worktreeProvisioning: provisioning,
    launcherEnv: {}
  });

  assert.equal(input.family, "codex");
  assert.equal(input.role, "worker");
  assert.equal(input.assignedUnit, ASSIGNED_UNIT);

  assert.equal("worktreeIdentity" in input, false);
  assert.equal("writeAuthority" in input, false);
  assert.equal(isTrustedStdioMcpConduitAuthority(input.authority), true);
  assert.deepEqual({ ...input.authority.worktreeIdentity }, { ...sliceBinding });
  assert.equal(input.authority.mode, "assigned");
  assert.equal(input.authority.source, "launcher-frozen-scope-authority");
  assert.equal(input.authority.unitAddress, authority.unit_address);
  assert.equal(input.authority.sourceDigest, authority.source_digest);
  assert.deepEqual(input.authority.readScope, ["docs/**"]);
  assert.deepEqual(input.authority.repoPaths, ["packages/agent-launch-cli/**"]);
  assert.deepEqual(input.authority.writeScope,
    ["packages/agent-launch-cli/src/lib/codex-conduit-binding.mjs"]);
  assert.deepEqual(input.sessionContract.read_scope, ["docs/**"]);
  assert.deepEqual(input.sessionContract.repo_paths, ["packages/agent-launch-cli/**"]);
  assert.equal(Object.isFrozen(input.authority), true);
});

test("WK-1678: Codex findings roles receive launcher-derived empty write authority", () => {
  const input = resolveCodexConduitInput({
    role: "redteam",
    assignedUnit: ASSIGNED_UNIT,
    workspaceDir: WORKSPACE,
    launcherEnv: {}
  });
  assert.equal(input.authority.mode, "read_only");
  assert.equal(input.authority.source, "launcher-role-policy");
  assert.deepEqual(input.authority.readScope, []);
  assert.deepEqual(input.authority.writeScope, []);
  assert.deepEqual({ ...input.authority.worktreeIdentity }, {
    kind: "launcher-workspace",
    workspace_dir: WORKSPACE
  });
});

test("WK-1678: Codex request hints can only match, never mint or retarget authority", () => {
  const { authority, provisioning } = workerCarriers();
  assert.throws(() => resolveCodexConduitInput({
    role: "worker",
    assignedUnit: ASSIGNED_UNIT,
    workspaceDir: WORKSPACE,
    workerScopeAuthority: authority,
    worktreeProvisioning: provisioning,
    launcherEnv: {},
    requested: { write_scope: ["packages/evil/**"] }
  }), (error) => error?.code === CODEX_CONDUIT_BINDING_REFUSAL_REASON);
});

const REVIEWER_UNIT = "WK-2351#SLICE-006";

function findingsRoute() {
  return {
    role: "reviewer",
    assignedUnit: REVIEWER_UNIT,
    workspaceDir: WORKSPACE,
    launcherEnv: {}
  };
}

function reviewerSessionContract() {
  return resolveLauncherAgentSessionContract(mintTrustedStdioMcpConduitAuthority({
    family: "codex",
    role: "reviewer",
    assignedUnit: REVIEWER_UNIT,
    workspaceDir: WORKSPACE
  }));
}

function redigestSessionContract(contract) {
  const candidate = structuredClone(contract);
  delete candidate.contract_digest;
  return { ...candidate, contract_digest: digestLauncherAgentSessionContract(candidate) };
}

function reviewerCredential(overrides = {}) {
  return {
    ...mintStdioMcpCompletionCredential({
      role: "reviewer",
      completionTransport: classifyLauncherFindingsCompletionTransport({
        role: "reviewer", canonicalRepo: WORKSPACE
      }),
      canonicalRepo: WORKSPACE,
      assignedUnit: REVIEWER_UNIT
    }),
    ...overrides
  };
}

test("WK-2446: a Codex findings route carries its authenticated session contract", () => {
  const contract = reviewerSessionContract();
  const input = resolveCodexConduitInput({
    ...findingsRoute(),
    completionCredential: contract
  });
  assert.deepEqual(input.sessionContract, contract);
  assert.equal(input.sessionContract.schema_version, "launcher-agent-session-contract.v1");
  assert.equal(input.sessionContract.role, "reviewer");
  assert.equal(input.sessionContract.assigned_unit.address, REVIEWER_UNIT);
  assert.equal(input.sessionContract.completion_transport.transport_id,
    "standalone_findings");
  assert.equal(input.sessionContract.contract_digest,
    digestLauncherAgentSessionContract(input.sessionContract));
  assert.equal("completionCredential" in input, false);
});

test("WK-2446: Codex refuses defective session contracts with neutral refusal codes", () => {
  const base = findingsRoute();
  const valid = reviewerSessionContract();
  const transportMismatch = redigestSessionContract({
    ...valid,
    completion_transport: { transport_id: "workspace_submit_for_review" }
  });
  const authorityMismatch = structuredClone(valid);
  authorityMismatch.minting_provenance.authority_digest = `sha256:${"0".repeat(64)}`;
  const cases = [
    ["unsupported schema", { ...valid, schema_version: "unsupported" },
      "session_contract_schema_unsupported"],
    ["extra field", { ...valid, unexpected: true },
      "session_contract_shape_invalid"],
    ["digest", { ...valid, role: "redteam" },
      "session_contract_digest_mismatch"],
    ["authority", redigestSessionContract(authorityMismatch),
      "session_contract_authority_untrusted"],
    ["facts", redigestSessionContract({
      ...valid,
      repository: { repository_id: "other/repository" }
    }), "session_contract_fact_mismatch"],
    ["capability", redigestSessionContract({
      ...valid,
      capabilities: ["workspace_agent_dispatch"]
    }), "session_contract_capability_unknown"],
    ["transport", transportMismatch,
      "session_contract_completion_transport_mismatch"]
  ];
  for (const [label, completionCredential, refusalCode] of cases) {
    assert.throws(
      () => resolveCodexConduitInput({ ...base, completionCredential }),
      (error) => error.code === "stdio_mcp_conduit_input_invalid" &&
        error.detail?.refusal_code === refusalCode,
      label
    );
  }
});

test("WK-2351: an unmanaged Codex route keeps working without a credential", () => {
  const { authority, provisioning } = workerCarriers();
  const input = resolveCodexConduitInput({
    role: "worker",
    assignedUnit: ASSIGNED_UNIT,
    workspaceDir: WORKSPACE,
    workerScopeAuthority: authority,
    worktreeProvisioning: provisioning,
    completionCredential: null,
    launcherEnv: {}
  });
  assert.equal("completionTransport" in input, false);
  assert.equal("canonicalRepo" in input, false);
});

test("WK-2351: an unmanaged route may not carry a managed completion credential", () => {
  const { authority, provisioning } = workerCarriers();
  assert.throws(
    () => resolveCodexConduitInput({
      role: "worker",
      assignedUnit: ASSIGNED_UNIT,
      workspaceDir: WORKSPACE,
      workerScopeAuthority: authority,
      worktreeProvisioning: provisioning,
      completionCredential: reviewerCredential(),
      launcherEnv: {}
    }),

    (error) => error.code === "stdio_mcp_conduit_input_invalid" &&
      error.detail?.mismatch_class === "completion_transport_mismatch"
  );
});
