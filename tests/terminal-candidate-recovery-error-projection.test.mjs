

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TerminalWkCandidateError,
  constructTerminalWkCandidate,
  defaultTerminalCandidateRunGit,
  freezeTerminalWkCandidateInputs,
  projectTerminalWkCandidateFailure,
  verifyTerminalWkCandidateObjectBinding
} from "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import { createTerminalCandidateCoordinator } from
  "../packages/wiki-mcp/src/lib/dispatch-launch-runtime.mjs";
import { createTestDispatchBackend } from "./workspace-agent-dispatch-backend-shared.mjs";

const GIT_FAILED_CODE = "agent_launch.terminal_wk_candidate.git_failed.v1";
const SWALLOWED_CODE = "terminal_candidate_recovery_exact_candidate_disagrees";
const SUBJECT = "WK-1634#SLICE-008";

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }
  }).trim();
}

function terminalRecord() {
  return {
    schema_version: "work-record.v1",
    id: "WK-1634",
    initiative: "IN-0030",
    title: "terminal candidate",
    status: "review",
    acceptance: {
      criteria: ["Review the exact terminal candidate."],
      validation: ["node --test tests/whole-wk.test.mjs"]
    },
    sections: {
      structured_validation: {
        allowed: [{ command: "node_test", target: "tests/whole-wk.test.mjs" }]
      }
    },
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
}

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "wk1717-projection-"));
  const repo = path.join(root, "repo");
  const worktrees = path.join(root, "worktrees");
  mkdirSync(repo);
  mkdirSync(worktrees);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "test");
  git(repo, "config", "user.email", "test@example.invalid");
  mkdirSync(path.join(repo, "wiki", "work-records"), { recursive: true });
  writeFileSync(path.join(repo, "wiki", "work-records", "WK-1634.json"),
    JSON.stringify(terminalRecord()));
  writeFileSync(path.join(repo, "shared.txt"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  const B = git(repo, "rev-parse", "HEAD");
  git(repo, "branch", "wk/IN-0030/WK-1634");

  git(repo, "checkout", "-q", "wk/IN-0030/WK-1634");
  writeFileSync(path.join(repo, "shared.txt"), "base\nwk\n");
  writeFileSync(path.join(repo, "wk-only.txt"), "complete WK change\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "wk");
  const W = git(repo, "rev-parse", "HEAD");

  git(repo, "checkout", "-q", "main");
  writeFileSync(path.join(repo, "landing-only.txt"), "landing stays\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "landing");

  const constructionArgs = [];
  const recordingRunGit = (input) => {
    constructionArgs.push([...input.args]);
    return defaultTerminalCandidateRunGit(input);
  };
  const frozen = freezeTerminalWkCandidateInputs({
    mainRepo: repo,
    baseSha: B,
    baseRef: "main",
    wkRef: "refs/heads/wk/IN-0030/WK-1634",
    canonicalWkId: "WK-1634",
    canonicalWkDigest: `sha256:${"a".repeat(64)}`,
    runGit: recordingRunGit
  });
  const binding = constructTerminalWkCandidate({ frozen, runGit: recordingRunGit });
  return { root, repo, worktrees, B, W, candidate: binding.candidate, binding, constructionArgs };
}

function treeResolutionExecutionFailureRunGit() {
  return (input) => {
    if (input.args[0] === "rev-parse" && input.args.some((a) => /\^\{tree\}$/u.test(String(a)))) {
      return {
        ok: false,
        status: 128,
        stdout: "",
        stderr: "fatal: failed to write object: Read-only file system"
      };
    }
    return defaultTerminalCandidateRunGit(input);
  };
}

function unexpectedThrowRunGit() {
  return (input) => {
    if (input.args[0] === "rev-parse" && input.args.some((a) => /\^\{tree\}$/u.test(String(a)))) {
      const error = new Error("unexpected tree-resolution failure");
      error.name = "RangeError";
      throw error;
    }
    return defaultTerminalCandidateRunGit(input);
  };
}

function backendFor(state, coordinator) {
  const executorInputs = [];
  const backend = createTestDispatchBackend({
    launchExecutor: async (input) => {
      executorInputs.push({ role: input.role, subject: input.subject });
      return { accepted: true, status: "launching" };
    },
    worktreeProvisioning: { mainRepo: state.repo, worktreeRoot: state.worktrees },
    recoverTerminalCandidate: coordinator.recoverTerminalCandidate
  });
  const dispatch = () => backend.startLaunch({
    caller_session_id: "session-wk1717",
    role: "reviewer",
    subject: SUBJECT,
    app: "codex",
    workspace_alias: "default",
    workspace_dir: state.repo
  });
  return { dispatch, executorCalls: () => executorInputs.length };
}

test("WK-1717 fixture publishes a real recoverable v2 candidate ref and construction issues no merge-tree", (t) => {
  const state = fixture(t);

  const publishedRef = git(state.repo, "rev-parse", "--verify",
    "refs/agent-launch/terminal-current-v2/WK-1634^{commit}");
  assert.equal(publishedRef, state.candidate);
  assert.equal(state.binding.candidate_ref, "refs/agent-launch/terminal-current-v2/WK-1634");
  assert.equal(state.binding.candidate_parent, state.B);
  assert.equal(state.binding.base, state.B);
  assert.equal(state.binding.wk_tip, state.W);

  assert.equal(state.binding.candidate_tree, git(state.repo, "rev-parse", `${state.W}^{tree}`));
  const parents = git(state.repo, "rev-list", "--parents", "-n", "1", state.candidate).split(" ");
  assert.deepEqual(parents, [state.candidate, state.B]);

  verifyTerminalWkCandidateObjectBinding({ binding: state.binding });

  assert.equal(state.constructionArgs.some((args) => args[0] === "merge-tree"), false,
    "v2 construction must never issue merge-tree");
});

test("WK-1717 projectTerminalWkCandidateFailure keeps a typed candidate error's exact code and bounded mechanical detail only", () => {
  const typed = new TerminalWkCandidateError("could not resolve the accumulated WK tree", {
    code: GIT_FAILED_CODE,
    detail: {
      args: ["rev-parse", "--verify", `${"b".repeat(40)}^{tree}`],
      status: 128,
      stderr: "fatal: failed to write object: Read-only file system",

      stdout: "MERGED-SECRET-CONTENT",
      env: { SECRET_TOKEN: "leak" },
      stack: "at secret stack frame"
    },
    cause: new Error("inner cause carrying a stack")
  });
  const projected = projectTerminalWkCandidateFailure(typed);
  assert.equal(projected.kind, "typed_candidate_error");
  assert.equal(projected.code, GIT_FAILED_CODE);
  assert.match(projected.message, /could not resolve the accumulated WK tree/u);

  assert.deepEqual(Object.keys(projected).sort(), ["code", "detail", "kind", "message"]);

  assert.deepEqual(Object.keys(projected.detail).sort(), ["git_args", "git_status", "git_stderr"]);
  assert.equal(projected.detail.git_args[0], "rev-parse");
  assert.equal(projected.detail.git_status, 128);
  assert.match(projected.detail.git_stderr, /Read-only file system/u);
  const serialized = JSON.stringify(projected);
  for (const forbidden of ["MERGED-SECRET-CONTENT", "SECRET_TOKEN", "leak", "secret stack frame", "inner cause"]) {
    assert.equal(serialized.includes(forbidden), false, `projection must not leak: ${forbidden}`);
  }
});

test("WK-1717 projectTerminalWkCandidateFailure keeps an unknown cause as a bounded name/message with no detail or stack", () => {
  const unknown = new Error("z".repeat(9000));
  unknown.name = "RangeError";
  unknown.stack = "at leaked stack frame";
  const projected = projectTerminalWkCandidateFailure(unknown);
  assert.equal(projected.kind, "unknown_cause");
  assert.equal(projected.name, "RangeError");
  assert.equal(projected.detail, null);

  assert.equal(projected.message.length, 4096);
  assert.equal(JSON.stringify(projected).includes("leaked stack frame"), false);
});

test("WK-1717 coordinator preserves the typed Git-failure code for a tree-resolution execution failure", async (t) => {
  const state = fixture(t);
  const coordinator = createTerminalCandidateCoordinator({
    mainRepo: state.repo,
    worktreeRoot: state.worktrees,
    runGit: treeResolutionExecutionFailureRunGit()
  });
  await assert.rejects(coordinator.recoverTerminalCandidate("WK-1634"), (error) => {
    assert.notEqual(error.code, SWALLOWED_CODE);
    const failure = error.terminal_candidate_failure;
    assert.equal(failure.kind, "typed_candidate_error");
    assert.equal(failure.code, GIT_FAILED_CODE);
    assert.equal(failure.detail.git_status, 128);
    assert.match(failure.detail.git_stderr, /Read-only file system/u);
    assert.equal(failure.detail.git_args[0], "rev-parse");
    return true;
  });
});

test("WK-1717 registered dispatch refusal preserves the typed Git-failure code with bounded detail and never spawns", async (t) => {
  const state = fixture(t);
  const coordinator = createTerminalCandidateCoordinator({
    mainRepo: state.repo,
    worktreeRoot: state.worktrees,
    runGit: treeResolutionExecutionFailureRunGit()
  });
  const { dispatch, executorCalls } = backendFor(state, coordinator);
  const result = await dispatch();
  assert.equal(result.accepted, false);
  assert.equal(result.run_id, undefined);
  assert.equal(result.monitor_handle, undefined);
  const detail = result.refusal.detail;
  assert.equal(detail.recovery_code, GIT_FAILED_CODE);
  assert.equal(detail.recovery_detail.detail.git_status, 128);
  assert.match(detail.recovery_detail.detail.git_stderr, /Read-only file system/u);
  assert.equal(detail.recovery_detail.detail.git_args[0], "rev-parse");

  assert.equal(JSON.stringify(result).includes(SWALLOWED_CODE), false);
  assert.equal(JSON.stringify(result).includes("conflict"), false);
  assert.equal(executorCalls(), 0);
});

test("WK-1717 an unknown re-derivation exception refuses with a bounded truthful cause, not exact_candidate_disagrees", async (t) => {
  const state = fixture(t);
  const coordinator = createTerminalCandidateCoordinator({
    mainRepo: state.repo,
    worktreeRoot: state.worktrees,
    runGit: unexpectedThrowRunGit()
  });
  await assert.rejects(coordinator.recoverTerminalCandidate("WK-1634"), (error) => {
    assert.equal(error.code, "terminal_candidate_recovery_construction_failed");
    assert.notEqual(error.code, SWALLOWED_CODE);
    const failure = error.terminal_candidate_failure;
    assert.equal(failure.kind, "unknown_cause");
    assert.equal(failure.name, "RangeError");
    assert.match(failure.message, /unexpected tree-resolution failure/u);
    return true;
  });
  const { dispatch, executorCalls } = backendFor(state, coordinator);
  const result = await dispatch();
  assert.equal(result.accepted, false);
  assert.equal(result.run_id, undefined);
  assert.equal(result.monitor_handle, undefined);
  const detail = result.refusal.detail;
  assert.equal(detail.recovery_code, "terminal_candidate_recovery_construction_failed");
  assert.equal(detail.recovery_detail.kind, "unknown_cause");
  assert.equal(detail.recovery_detail.name, "RangeError");
  assert.match(detail.recovery_detail.message, /unexpected tree-resolution failure/u);
  assert.equal(JSON.stringify(result).includes(SWALLOWED_CODE), false);
  assert.equal(executorCalls(), 0);
});

test("WK-1717 mutation witness: re-derivation failures never collapse to exact_candidate_disagrees", async (t) => {

  for (const makeRunGit of [treeResolutionExecutionFailureRunGit, unexpectedThrowRunGit]) {
    const state = fixture(t);
    const coordinator = createTerminalCandidateCoordinator({
      mainRepo: state.repo,
      worktreeRoot: state.worktrees,
      runGit: makeRunGit()
    });
    let thrown = null;
    try {
      await coordinator.recoverTerminalCandidate("WK-1634");
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, "recovery must refuse");
    assert.notEqual(thrown.code, SWALLOWED_CODE);
    assert.equal(JSON.stringify(thrown.terminal_candidate_failure).includes(SWALLOWED_CODE), false);
  }
});
