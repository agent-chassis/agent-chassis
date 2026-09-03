

import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalSerializeLauncherAgentSessionContract,
  mintTrustedStdioMcpConduitAuthority,
  resolveLauncherAgentSessionContract
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";
import {
  WIKI_MCP_AGENT_SESSION_CONTRACT_ENV_VAR,
  WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT_ENV_VAR,
  WIKI_MCP_ASSIGNED_UNIT_ENV_VAR,
  WIKI_MCP_TOOL_PROFILE_ENV_VAR,
  resolveAssignedUnit,
  resolveLauncherRunCredential,
  resolveLauncherRunState
} from "../../packages/wiki-mcp/src/lib/launcher-run-credential.mjs";
import {
  BASE_SHA,
  COMMIT_SHA,
  TREE_SHA,
  WORKSPACE_DIR,
  assertCommitFailsClosedBeforeGit,
  exactSliceBinding,
  installIdentityStoreEnv,
  installState,
  registerCommitTool
} from "../helpers/workspace-commit-function-contract-harness.mjs";

test("WK-2203#SLICE-011: launcher resolver accepts only launcher runtime state", () => {
  const authority = mintTrustedStdioMcpConduitAuthority({
    family: "codex",
    role: "worker",
    assignedUnit: "WK-2203#SLICE-011",
    workspaceDir: WORKSPACE_DIR,
    canonicalWriteScope: []
  });
  const sessionContract = resolveLauncherAgentSessionContract(authority);
  const sessionContractBytes = canonicalSerializeLauncherAgentSessionContract(
    sessionContract).toString("utf8");
  const runtimeState = {
    [WIKI_MCP_AGENT_SESSION_CONTRACT_ENV_VAR]: sessionContractBytes,
    [WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT_ENV_VAR]: sessionContractBytes,
    [WIKI_MCP_ASSIGNED_UNIT_ENV_VAR]: " WK-2203#SLICE-011 ",
    [WIKI_MCP_TOOL_PROFILE_ENV_VAR]: " worker ",
    WIKI_MCP_COMMIT_LAUNCH_REF: " launch-WK-2203-SLICE-011 ",
    WIKI_MCP_COMMIT_RUN_ID: " run-WK-2203-SLICE-011 ",
    WIKI_MCP_COMMIT_RETRY_ID: "2"
  };
  assert.equal(resolveAssignedUnit(runtimeState), "WK-2203#SLICE-011");
  assert.deepEqual(resolveLauncherRunCredential(runtimeState), {
    kind: "identity_store_tuple",
    launchRef: "launch-WK-2203-SLICE-011",
    runId: "run-WK-2203-SLICE-011",
    retryId: 2
  });
  assert.deepEqual(resolveLauncherRunState(runtimeState), {
    assignedUnit: "WK-2203#SLICE-011",
    credential: resolveLauncherRunCredential(runtimeState),
    frozenReviewContractPath: null,
    role: "worker",
    sessionContract
  });
});

test("WK-2203#SLICE-011: incomplete or malformed launcher state refuses closed binding", () => {
  assert.equal(resolveAssignedUnit({}), null);
  assert.equal(resolveLauncherRunCredential({
    WIKI_MCP_COMMIT_LAUNCH_REF: "launch-only"
  }), null);
  assert.throws(
    () => resolveLauncherRunCredential({
      WIKI_MCP_COMMIT_LAUNCH_REF: "launch",
      WIKI_MCP_COMMIT_RUN_ID: "run",
      WIKI_MCP_COMMIT_RETRY_ID: "not-an-integer"
    }),
    /must be a non-negative integer string/u
  );
});

test("WK-1678: a substituted worktree path is refused before any Git operation", async (t) => {
  for (const [label, worktreePath] of [

    ["sibling slice worktree", "/worktrees/slice-IN-0011-WK-1429-SLICE-005"],
    ["sibling WK worktree", "/worktrees/slice-IN-0011-WK-9999-SLICE-004"],
    ["sibling initiative worktree", "/worktrees/slice-IN-9999-WK-1429-SLICE-004"],

    ["external repository", "/tmp/attacker-repo/slice-IN-0011-WK-1429-SLICE-004-not"],
    ["external repository bare name", "/tmp/attacker-repo"],

    ["relative path", "worktrees/slice-IN-0011-WK-1429-SLICE-004"],
    ["unnormalized traversal", "/worktrees/../worktrees/slice-IN-0011-WK-1429-SLICE-004"],
    ["glob metacharacters", "/worktrees/slice-IN-0011-WK-1429-SLICE-00[4]"]
  ]) {
    await t.test(label, async (t) => {
      await assertCommitFailsClosedBeforeGit(
        t, exactSliceBinding({ worktree_path: worktreePath }), label
      );
    });
  }
});

test("WK-1678: a caller-carried Git directory cannot be smuggled into the commit", async (t) => {

  for (const [label, overrides] of [
    ["gitDir", { gitDir: "/tmp/attacker-repo/.git" }],
    ["git_dir", { git_dir: "/tmp/attacker-repo/.git" }],
    ["worktreeGitDir", { worktreeGitDir: "/tmp/attacker-repo/.git" }],
    ["worktree_git_dir", { worktree_git_dir: "/tmp/attacker-repo/.git" }],
    ["git_binding", { git_binding: { gitDir: "/tmp/attacker-repo/.git", worktreePath: "/tmp/attacker-repo" } }],
    ["provisioned_worktree_git_binding", {
      provisioned_worktree_git_binding: { gitDir: "/tmp/attacker-repo/.git", worktreePath: "/tmp/attacker-repo" }
    }]
  ]) {
    await t.test(label, async (t) => {
      await assertCommitFailsClosedBeforeGit(t, exactSliceBinding(overrides), label);
    });
  }
});

test("WK-1678: a substituted base ref or base sha is refused before any Git operation", async (t) => {
  for (const [label, overrides] of [
    ["sibling WK base_ref", { base_ref: "wk/IN-0011/WK-9999" }],
    ["sibling initiative base_ref", { base_ref: "wk/IN-9999/WK-1429" }],

    ["refs/heads-qualified base_ref", { base_ref: "refs/heads/wk/IN-0011/WK-1429" }],
    ["main base_ref", { base_ref: "main" }],
    ["slice base_ref", { base_ref: "slice/IN-0011/WK-1429/SLICE-004" }],
    ["non-canonical base_sha", { base_sha: "not-a-sha" }],
    ["truncated base_sha", { base_sha: "b".repeat(39) }],
    ["upper-case base_sha", { base_sha: "B".repeat(40) }],
    ["ref-shaped base_sha", { base_sha: "refs/heads/main" }]
  ]) {
    await t.test(label, async (t) => {
      await assertCommitFailsClosedBeforeGit(t, exactSliceBinding(overrides), label);
    });
  }
});

test("WK-1678: a substituted write-scope source or non-canonical write scope is refused", async (t) => {
  for (const [label, overrides] of [

    ["sibling slice scope source", { write_scope_source: "wiki/work-records/WK-1429.json#SLICE-005" }],
    ["sibling WK scope source", { write_scope_source: "wiki/work-records/WK-9999.json#SLICE-004" }],
    ["parent-record scope source", { write_scope_source: "wiki/work-records/WK-1429.json" }],

    ["opaque placeholder scope source", { write_scope_source: "canonical_record" }],
    ["empty write_scope", { write_scope: [] }],
    ["absolute write_scope entry", { write_scope: ["/etc/passwd"] }],
    ["traversal write_scope entry", { write_scope: ["../outside/file.mjs"] }],
    ["unsorted write_scope", { write_scope: ["tests/b.mjs", "tests/a.mjs"] }],
    ["duplicated write_scope", { write_scope: ["tests/a.mjs", "tests/a.mjs"] }],
    ["non-string write_scope entry", { write_scope: [42] }],
    ["absolute read_scope entry", { read_scope: ["/etc"] }],
    ["traversal repo_paths entry", { repo_paths: ["../elsewhere"] }]
  ]) {
    await t.test(label, async (t) => {
      await assertCommitFailsClosedBeforeGit(t, exactSliceBinding(overrides), label);
    });
  }
});

test("WK-1678: a replayed or stale identity tuple is refused before any Git operation", async (t) => {

  const canonicalTuple = {
    launchRef: "launch-WK-1429-SLICE-004",
    runId: "wkdb_WK1429_SLICE004",
    retryId: 0
  };
  for (const [label, overrides] of [
    ["replayed launch_ref", { launch_ref: "launch-WK-1429-SLICE-004-previous" }],
    ["replayed run_id", { run_id: "wkdb_WK1429_SLICE004_previous" }],
    ["stale retry_id (binding older than request)", { retry_id: 0 }],
    ["future retry_id (binding newer than request)", { retry_id: 2 }],
    ["non-integer retry_id", { retry_id: "0" }]
  ]) {
    await t.test(label, async (t) => {
      const requestTuple = label.includes("retry_id")
        ? { ...canonicalTuple, retryId: 1 }
        : canonicalTuple;
      await assertCommitFailsClosedBeforeGit(
        t, exactSliceBinding(overrides), label, { requestTuple }
      );
    });
  }
});

test("WK-1678: the strict verifier admits the exact canonical allocator binding", async (t) => {

  const binding = exactSliceBinding();
  installIdentityStoreEnv(t, binding);
  const state = installState({
    binding,
    advanced: {
      base_sha: BASE_SHA,
      commit: COMMIT_SHA,
      tree: TREE_SHA,
      ref: "refs/heads/slice/IN-0011/WK-1429/SLICE-004",
      idempotent: false
    }
  });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  assert.equal(result.structuredContent.committed, true);

  assert.deepEqual(state.calls.map((call) => call.op), [
    "resolve_binding",
    "materialize",
    "verify_measure",
    "commit_slice_ref",
    "transition"
  ]);

  const materialize = state.calls.find((call) => call.op === "materialize");
  assert.equal(
    materialize.args.gitDir,
    `${WORKSPACE_DIR}/.git/worktrees/slice-IN-0011-WK-1429-SLICE-004`
  );
  assert.equal(materialize.args.workTree, "/worktrees/slice-IN-0011-WK-1429-SLICE-004");
});
