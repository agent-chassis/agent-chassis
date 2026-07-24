import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  CODEX_CONDUIT_BINDING_REFUSAL_REASON,
  resolveCodexConduitInput
} from "../packages/agent-launch-cli/src/lib/codex-conduit-binding.mjs";
import {
  isTrustedStdioMcpConduitAuthority
} from "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";

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
  assert.deepEqual(input.authority.readScope, ["docs/**", "packages/agent-launch-cli/**"]);
  assert.deepEqual(input.authority.writeScope,
    ["packages/agent-launch-cli/src/lib/codex-conduit-binding.mjs"]);
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
