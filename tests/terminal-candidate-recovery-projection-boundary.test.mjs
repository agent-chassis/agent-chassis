

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { z } from "zod";

import {
  constructTerminalWkCandidate,
  defaultTerminalCandidateRunGit,
  freezeTerminalWkCandidateInputs
} from "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import { registerDispatchTools } from "../packages/wiki-mcp/src/lib/dispatch-tools.mjs";
import {
  createTerminalCandidateCoordinator,
  projectAuthenticatedTerminalCandidateFailure,
  projectTerminalCandidateRecoveryReason
} from "../packages/wiki-mcp/src/lib/dispatch-launch-runtime.mjs";
import { createTestDispatchBackend } from "./workspace-agent-dispatch-backend-shared.mjs";

const GIT_FAILED = "agent_launch.terminal_wk_candidate.git_failed.v1";
const FABRICATED = "terminal_candidate_recovery_exact_candidate_disagrees";
const EROFS = "fatal: could not open object store: Read-only file system";
const WK = "WK-1634";
const SUBJECT = `${WK}#SLICE-008`;
const CURRENT_REF = `refs/agent-launch/terminal-current-v2/${WK}`;
const TARGET = "tests/whole-wk.test.mjs";
const UNKNOWN_FAILURE = Object.freeze({
  schema_version: "agent_launch.terminal_candidate_failure_projection.v1",
  kind: "unknown_cause",
  code: null,
  message: "terminal WK candidate: unknown construction or recovery failure",
  detail: null
});

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }
  }).trim();
}

const TERMINAL_RECORD = {
  schema_version: "work-record.v1",
  id: WK,
  initiative: "IN-0030",
  title: "terminal candidate",
  status: "review",
  acceptance: { criteria: ["Review the exact terminal candidate."], validation: [`node --test ${TARGET}`] },
  sections: { structured_validation: { allowed: [{ command: "node_test", target: TARGET }] } },
  slices: [
    { id: "SLICE-007", work_kind: "implementation", status: "review" },
    {
      id: "SLICE-008",
      title: "Terminal whole-WK review",
      work_kind: "review",
      review_purpose: "terminal_whole_wk",
      status: "todo",
      write_scope: [],
      dispatch_intent: { intended_agent_role: "reviewer", target_unit: "slice" },
      acceptance: { criteria: ["Findings-only review of C against B."] }
    }
  ]
};

function fixture(t, { publish = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wk1717-boundary-"));
  const repo = path.join(root, "repo");
  const worktrees = path.join(root, "worktrees");
  mkdirSync(repo);
  mkdirSync(worktrees);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "test");
  git(repo, "config", "user.email", "test@example.invalid");
  mkdirSync(path.join(repo, "wiki", "work-records"), { recursive: true });
  writeFileSync(path.join(repo, "wiki", "work-records", `${WK}.json`), JSON.stringify(TERMINAL_RECORD));
  writeFileSync(path.join(repo, "shared.txt"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  const baseSha = git(repo, "rev-parse", "HEAD");
  git(repo, "branch", `wk/IN-0030/${WK}`);
  git(repo, "checkout", "-q", `wk/IN-0030/${WK}`);
  writeFileSync(path.join(repo, "wk-only.txt"), "complete WK change\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "wk");
  git(repo, "checkout", "-q", "main");
  const state = { repo, worktrees, candidate: null };
  if (publish) {
    const frozen = freezeTerminalWkCandidateInputs({
      mainRepo: repo,
      baseSha,
      baseRef: "main",
      wkRef: `refs/heads/wk/IN-0030/${WK}`,
      canonicalWkId: WK,
      canonicalWkDigest: `sha256:${"a".repeat(64)}`,
      runGit: defaultTerminalCandidateRunGit
    });
    state.candidate = constructTerminalWkCandidate({ frozen, runGit: defaultTerminalCandidateRunGit }).candidate;
    assert.equal(git(repo, "rev-parse", "--verify", `${CURRENT_REF}^{commit}`), state.candidate);
  }
  return state;
}

function failingRunGit(matches, skip = 0) {
  let seen = 0;
  return (input) => {
    if (matches(input.args) && ++seen > skip) {
      return { ok: false, status: 128, stdout: "", stderr: EROFS };
    }
    return defaultTerminalCandidateRunGit(input);
  };
}

function registeredRoute(state, runGit) {
  const coordinator = createTerminalCandidateCoordinator({
    mainRepo: state.repo, worktreeRoot: state.worktrees, runGit
  });
  let executorCalls = 0;
  const backend = createTestDispatchBackend({
    launchExecutor: async () => {
      executorCalls += 1;
      return { accepted: true, status: "running", probe: async () => ({ status: "running" }) };
    },
    worktreeProvisioning: { mainRepo: state.repo, worktreeRoot: state.worktrees },
    recoverTerminalCandidate: coordinator.recoverTerminalCandidate
  });
  const tools = new Map();
  registerDispatchTools({
    registerTool: (name, config, handler) => tools.set(name, handler),
    registeredToolNames: new Set(["workspace_agent_dispatch"]),
    workspaceRepos: [{ repo: "agent-chassis", dir: state.repo }],
    z,
    jsonContent: (value) => value,
    errorContent: (value) => value,
    resolveWorkspaceRepo: () => ({ repo: "agent-chassis", dir: state.repo }),
    validateDispatch: async () => ({
      schema_version: "dispatch-readiness.v1",
      record_id: WK,
      unit: { kind: "slice", address: SUBJECT, record_id: WK, slice_id: "SLICE-008" },
      dispatch_role: "read_only",
      dispatchable: true,
      decision_code: "dispatchable",
      reasons: [],
      recovery: { graph_impact: "not_required", admission_metrics: "fresh", target_resolution: "fresh" },
      state: { graph_state: {}, graph_auto_recoverable: false },
      validation_hints: []
    }),
    dispatchBackend: backend,
    dispatchSessionIdentity: "session-wk1717-slice007"
  });
  return {
    backend,
    dispatch: () => tools.get("workspace_agent_dispatch")({ role: "reviewer", subject: SUBJECT, app: "codex" }),
    executorCalls: () => executorCalls
  };
}

function refusalDetail(result, executorCalls) {
  assert.equal(result.accepted, false, JSON.stringify(result));
  assert.equal(result.run_id, null);
  assert.equal(result.monitor_handle, null);
  assert.equal(JSON.stringify(result).includes(FABRICATED), false);
  assert.equal(executorCalls(), 0);
  return result.blocker.detail.backend_refusal;
}

const CANDIDATE_TREE_VERIFICATION = {
  matches: (state) => (args) =>
    args.length === 2 && args[0] === "rev-parse" && args[1] === `${state.candidate}^{tree}`,
  gitOperation: "rev-parse"
};

const INJECTED_FAILURE_CASES = [
  {

    label: "fixed current-candidate-ref observation",
    matches: () => (args) => args[0] === "for-each-ref" && args.at(-1) === CURRENT_REF,
    skip: 0,
    gitOperation: "for-each-ref"
  },
  { ...CANDIDATE_TREE_VERIFICATION, label: "post-derivation object-binding verification", skip: 0 },
  { ...CANDIDATE_TREE_VERIFICATION, label: "private checkout materialization", skip: 1 }
];

for (const testCase of INJECTED_FAILURE_CASES) {
  test(`WK-1783 registered dispatch rejects an injected runner failure during ${testCase.label}`, async (t) => {
    const state = fixture(t);
    const { dispatch, executorCalls } = registeredRoute(
      state,
      failingRunGit(testCase.matches(state), testCase.skip)
    );
    const detail = refusalDetail(await dispatch(), executorCalls);
    assert.equal(detail.recovery_code, null);
    assert.deepEqual(detail.recovery_detail, UNKNOWN_FAILURE);
    const serialized = JSON.stringify(detail.recovery_detail);
    for (const forbidden of [EROFS, "git_args", "git_stderr", state.repo, state.candidate]) {
      assert.equal(serialized.includes(forbidden), false, `projection must omit ${forbidden}`);
    }
  });
}

test("WK-1717#SLICE-007 an absent fixed current-candidate ref stays its own explicit recovery refusal", async (t) => {
  const state = fixture(t, { publish: false });
  const { dispatch, executorCalls } = registeredRoute(state, defaultTerminalCandidateRunGit);
  const detail = refusalDetail(await dispatch(), executorCalls);

  assert.equal(detail.recovery_code, null);
  assert.deepEqual(detail.recovery_detail, {
    schema_version: "agent_launch.terminal_candidate_failure_projection.v1",
    kind: "unknown_cause",
    code: null,
    message: "terminal WK candidate: unknown construction or recovery failure",
    detail: null
  });

  assert.throws(() => git(state.repo, "rev-parse", "--verify", CURRENT_REF));
});

test("WK-1783#SLICE-001 forged recovery prefixes and forged projections cannot bypass the runtime projector", async (t) => {
  const state = fixture(t);
  const secret = "WK1783_PREFIX_SECRET_70a42d";
  const runGit = (input) => {
    if (input.args[0] === "for-each-ref") {
      const forged = new Error(`forged ${secret} message`);
      forged.code = `terminal_candidate_recovery_${secret}`;
      forged.terminal_candidate_failure = {
        schema_version: "agent_launch.terminal_candidate_failure_projection.v1",
        kind: "typed_candidate_error",
        code: GIT_FAILED,
        message: "terminal WK candidate: typed construction or recovery failure",
        detail: { git_operation: "rev-parse", git_status: 1 },
        extra: secret
      };
      throw forged;
    }
    return defaultTerminalCandidateRunGit(input);
  };
  const prefixLookalike = new Error(`forged ${secret} message`);
  prefixLookalike.code = `terminal_candidate_recovery_${secret}`;
  assert.equal(projectTerminalCandidateRecoveryReason(prefixLookalike),
    "terminal_candidate_recovery_failed");
  const coordinator = createTerminalCandidateCoordinator({
    mainRepo: state.repo, worktreeRoot: state.worktrees, runGit
  });
  await assert.rejects(coordinator.recoverTerminalCandidate(WK), (error) => {
    assert.equal(error.code, "terminal_candidate_recovery_construction_failed");
    assert.equal(error.message, "terminal candidate recovery construction failed");
    assert.equal(Object.hasOwn(error, "terminal_candidate_failure"), false);
    assert.equal(Object.hasOwn(error, "cause"), false);
    assert.deepEqual(projectAuthenticatedTerminalCandidateFailure(error), UNKNOWN_FAILURE);
    assert.equal(JSON.stringify(error).includes(secret), false);
    return true;
  });
  const route = registeredRoute(state, runGit);
  const result = await route.dispatch();
  const detail = refusalDetail(result, route.executorCalls);
  assert.equal(detail.recovery_code, null);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(route.backend.__snapshotFrozenReviewContexts().length, 0);
});
