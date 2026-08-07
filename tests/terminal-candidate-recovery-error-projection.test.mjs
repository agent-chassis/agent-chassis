

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TERMINAL_WK_CANDIDATE_CODES,
  TerminalWkCandidateError,
  constructTerminalWkCandidate,
  defaultTerminalCandidateRunGit,
  freezeTerminalWkCandidateInputs,
  verifyTerminalWkCandidateObjectBinding
} from "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  createTerminalCandidateCoordinator,
  projectAuthenticatedTerminalCandidateFailure,
  projectTerminalCandidateRecoveryReason,
  projectTerminalWkCandidateFailure,
  TERMINAL_CANDIDATE_FAILURE_PROJECTION_SCHEMA_VERSION,
  TERMINAL_CANDIDATE_TYPED_FAILURE_MESSAGE,
  TERMINAL_CANDIDATE_UNKNOWN_FAILURE_MESSAGE
} from "../packages/wiki-mcp/src/lib/dispatch-launch-runtime.mjs";
import { createTestDispatchBackend } from "./workspace-agent-dispatch-backend-shared.mjs";

const SWALLOWED_CODE = "terminal_candidate_recovery_exact_candidate_disagrees";
const SUBJECT = "WK-1634#SLICE-008";
const UNKNOWN_FAILURE = Object.freeze({
  schema_version: TERMINAL_CANDIDATE_FAILURE_PROJECTION_SCHEMA_VERSION,
  kind: "unknown_cause",
  code: null,
  message: TERMINAL_CANDIDATE_UNKNOWN_FAILURE_MESSAGE,
  detail: null
});

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
      error.code = "E_UNEXPECTED_TREE_RESOLUTION";
      throw error;
    }
    return defaultTerminalCandidateRunGit(input);
  };
}

const UNKNOWN_CAUSE_TEXT = Object.freeze([
  "RangeError",
  "E_UNEXPECTED_TREE_RESOLUTION",
  "unexpected tree-resolution failure"
]);

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

test("WK-1783#SLICE-001 all eight typed codes use the exact five-key projection", () => {
  const codes = Object.values(TERMINAL_WK_CANDIDATE_CODES);
  assert.equal(codes.length, 8);
  for (const code of codes) {
    const internalDetail = code === TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID
      ? { base: "a".repeat(40), wk_tip: "b".repeat(40), status: 128, stderr: "SECRET-STDERR" }
      : { args: ["rev-parse", "SECRET-ARG"], status: 128, stderr: "SECRET-STDERR" };
    const projected = projectTerminalWkCandidateFailure(new TerminalWkCandidateError(
      "SECRET raw typed message",
      {
        code,
        detail: internalDetail,
        cause: new Error("SECRET-CAUSE")
      }
    ));
    assert.deepEqual(Object.keys(projected).sort(),
      ["code", "detail", "kind", "message", "schema_version"]);
    assert.equal(projected.schema_version, TERMINAL_CANDIDATE_FAILURE_PROJECTION_SCHEMA_VERSION);
    assert.equal(projected.kind, "typed_candidate_error");
    assert.equal(projected.code, code);
    assert.equal(projected.message, TERMINAL_CANDIDATE_TYPED_FAILURE_MESSAGE);
    assert.deepEqual(projected.detail,
      code === TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED
        ? { git_operation: "rev-parse", git_status: 128 }
        : code === TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID
          ? { git_operation: "merge-base", git_status: 128 }
          : null);
    const serialized = JSON.stringify(projected);
    for (const forbidden of ["SECRET raw", "SECRET-ARG", "SECRET-STDERR", "SECRET-CAUSE"]) {
      assert.equal(serialized.includes(forbidden), false, `projection must not leak: ${forbidden}`);
    }
  }
});

test("WK-1783#SLICE-001 allowed Git detail is closed and invalid or inapplicable detail collapses", () => {
  const typed = (code, detail) => projectTerminalWkCandidateFailure(
    new TerminalWkCandidateError("raw", { code, detail })
  );
  assert.deepEqual(typed(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, {
    args: ["update-ref", "SECRET-ARG"], status: null, stdout: "SECRET", stderr: "SECRET"
  }).detail, { git_operation: "update-ref", git_status: null });
  assert.deepEqual(typed(TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID, {
    base: "SECRET-BASE", wk_tip: "SECRET-TIP", status: 1
  }).detail, { git_operation: "merge-base", git_status: 1 });
  for (const operation of ["rev-parse", "rev-list", "cat-file", "commit-tree",
    "for-each-ref", "update-ref", "merge-base"]) {
    const internal = operation === "for-each-ref"
      ? { ref: "refs/agent-launch/terminal-current-v2/WK-1783", status: 0 }
      : { args: [operation], status: 0 };
    assert.deepEqual(typed(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, internal).detail,
      { git_operation: operation, git_status: 0 });
  }
  assert.deepEqual(typed(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED,
    { args: ["cat-file"], status: 255 }).detail,
    { git_operation: "cat-file", git_status: 255 });
  for (const [code, detail] of [
    [TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, { args: ["show"], status: 1 }],
    [TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, { args: ["rev-parse"], status: -1 }],
    [TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, { args: ["rev-parse"], status: 1.5 }],
    [TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, { args: ["rev-parse"], status: "1" }],
    [TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, { args: ["rev-parse"], status: 256 }],
    [TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, { args: ["rev-parse"] }],
    [TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, { git_operation: "rev-parse", git_status: 1 }],
    [TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID, { status: 1 }],
    [TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID, { args: ["rev-parse"], status: 1 }],
    [TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT, { args: ["rev-parse"], status: 1 }]
  ]) {
    assert.equal(typed(code, detail).detail, null);
  }
});

test("WK-1783#SLICE-001 unknown causes reduce to the exact byte-stable projection", () => {
  const unknown = new Error(`${"z".repeat(9000)} SECRET-UNKNOWN-CAUSE-TEXT`);
  unknown.name = "RangeError";
  unknown.code = "E_SECRET_UNKNOWN_CAUSE";
  unknown.stack = "at leaked stack frame";
  const projected = projectTerminalWkCandidateFailure(unknown);
  assert.equal(projected.kind, "unknown_cause");
  assert.equal(projected.code, null);
  assert.equal(projected.detail, null);

  assert.equal(projected.schema_version, TERMINAL_CANDIDATE_FAILURE_PROJECTION_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(projected).sort(),
    ["code", "detail", "kind", "message", "schema_version"]);
  assert.equal(projected.message, TERMINAL_CANDIDATE_UNKNOWN_FAILURE_MESSAGE);
  assert.equal(projected.message, "terminal WK candidate: unknown construction or recovery failure");
  const serialized = JSON.stringify(projected);
  for (const forbidden of ["RangeError", "E_SECRET_UNKNOWN_CAUSE", "SECRET-UNKNOWN-CAUSE-TEXT",
    "leaked stack frame", "zzzz"]) {
    assert.equal(serialized.includes(forbidden), false, `projection must not leak: ${forbidden}`);
  }
});

test("WK-1783#SLICE-001 composition recovery reasons never trust caller code prefixes", () => {
  const secret = "WK1783_COMPOSITION_PREFIX_SECRET";
  const lookalike = new Error(secret);
  lookalike.code = `terminal_candidate_recovery_${secret}`;
  assert.equal(projectTerminalCandidateRecoveryReason(lookalike),
    "terminal_candidate_recovery_failed");
  assert.equal(projectTerminalCandidateRecoveryReason({
    code: `terminal_candidate_construction_${secret}`
  }), "terminal_candidate_recovery_failed");
});

test("WK-1783 injected tree-resolution runner cannot mint typed authentication", async (t) => {
  const state = fixture(t);
  const coordinator = createTerminalCandidateCoordinator({
    mainRepo: state.repo,
    worktreeRoot: state.worktrees,
    runGit: treeResolutionExecutionFailureRunGit()
  });
  await assert.rejects(coordinator.recoverTerminalCandidate("WK-1634"), (error) => {
    assert.equal(error.code, "terminal_candidate_recovery_construction_failed");
    assert.equal(error.message, "terminal candidate recovery construction failed");
    assert.notEqual(error.code, SWALLOWED_CODE);
    assert.equal(Object.hasOwn(error, "terminal_candidate_failure"), false);
    assert.equal(Object.hasOwn(error, "cause"), false);
    assert.deepEqual(projectAuthenticatedTerminalCandidateFailure(error), UNKNOWN_FAILURE);
    assert.equal(projectTerminalCandidateRecoveryReason(error),
      "terminal_candidate_recovery_failed");
    return true;
  });
});

test("WK-1783 registered dispatch rejects an injected tree-resolution runner before spawn", async (t) => {
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
  assert.equal(detail.recovery_code, null);
  assert.deepEqual(detail.recovery_detail, UNKNOWN_FAILURE);

  assert.equal(JSON.stringify(result).includes(SWALLOWED_CODE), false);
  assert.equal(JSON.stringify(result).includes("conflict"), false);
  assert.equal(executorCalls(), 0);
});

test("WK-1717 an unknown re-derivation exception refuses with the closed generic cause, not exact_candidate_disagrees", async (t) => {
  const state = fixture(t);
  const coordinator = createTerminalCandidateCoordinator({
    mainRepo: state.repo,
    worktreeRoot: state.worktrees,
    runGit: unexpectedThrowRunGit()
  });
  await assert.rejects(coordinator.recoverTerminalCandidate("WK-1634"), (error) => {

    assert.equal(error.code, "terminal_candidate_recovery_construction_failed");
    assert.equal(error.message, "terminal candidate recovery construction failed");
    assert.notEqual(error.code, SWALLOWED_CODE);
    assert.equal(Object.hasOwn(error, "terminal_candidate_failure"), false);
    assert.equal(Object.hasOwn(error, "cause"), false);
    assert.deepEqual(projectAuthenticatedTerminalCandidateFailure(error), UNKNOWN_FAILURE);
    const serializedError = JSON.stringify({ code: error.code, message: error.message });
    for (const forbidden of UNKNOWN_CAUSE_TEXT) {
      assert.equal(serializedError.includes(forbidden), false,
        `coordinator error must not leak: ${forbidden}`);
    }
    return true;
  });
  const { dispatch, executorCalls } = backendFor(state, coordinator);
  const result = await dispatch();
  assert.equal(result.accepted, false);
  assert.equal(result.run_id, undefined);
  assert.equal(result.monitor_handle, undefined);
  const detail = result.refusal.detail;
  assert.equal(detail.recovery_code, null);
  assert.equal(detail.recovery_detail.kind, "unknown_cause");
  assert.equal(detail.recovery_detail.code, null);
  assert.equal(detail.recovery_detail.detail, null);
  assert.equal(detail.recovery_detail.message, TERMINAL_CANDIDATE_UNKNOWN_FAILURE_MESSAGE);
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes(TERMINAL_CANDIDATE_UNKNOWN_FAILURE_MESSAGE), true);
  for (const forbidden of UNKNOWN_CAUSE_TEXT) {
    assert.equal(serialized.includes(forbidden), false, `refusal must not leak: ${forbidden}`);
  }
  assert.equal(serialized.includes(SWALLOWED_CODE), false);
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
    assert.equal(Object.hasOwn(thrown, "terminal_candidate_failure"), false);
    assert.deepEqual(projectAuthenticatedTerminalCandidateFailure(thrown), UNKNOWN_FAILURE);
  }
});

const RECONSTRUCTION_SECRET = "glpat-EXAMPLE-TOKEN-do-not-reflect";

function reconstructionProjectionFixture(t, { forkRef = true } = {}) {

  const root = mkdtempSync(path.join(os.tmpdir(), `wk1782-${RECONSTRUCTION_SECRET}-`));
  const repo = path.join(root, "repo");
  const worktrees = path.join(root, "worktrees");
  mkdirSync(repo);
  mkdirSync(worktrees);
  t.after(() => {
    try {
      execFileSync("chmod", ["-R", "u+rwX", root]);
    } catch {   }
    rmSync(root, { recursive: true, force: true });
  });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "test");
  git(repo, "config", "user.email", "test@example.invalid");
  const recordPath = path.join(repo, "wiki", "work-records", "WK-1634.json");
  mkdirSync(path.dirname(recordPath), { recursive: true });
  const frozen = { ...terminalRecord(), status: "todo", slices: [
    { id: "SLICE-007", work_kind: "implementation", status: "review" }
  ] };
  writeFileSync(recordPath, JSON.stringify(frozen));
  writeFileSync(path.join(repo, "shared.txt"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "fork");
  const B = git(repo, "rev-parse", "HEAD");
  if (forkRef) git(repo, "update-ref", "refs/agent-launch/wk-forks/IN-0030/WK-1634", B);
  git(repo, "branch", "wk/IN-0030/WK-1634");
  git(repo, "checkout", "-q", "wk/IN-0030/WK-1634");
  writeFileSync(path.join(repo, "wk-only.txt"), "complete WK change\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "wk");
  const W = git(repo, "rev-parse", "HEAD");
  git(repo, "checkout", "-q", "main");

  writeFileSync(recordPath, JSON.stringify(terminalRecord()));
  return { root, repo, worktrees, recordPath, B, W };
}

async function refusedColdReconstruction(state) {
  const coordinator = createTerminalCandidateCoordinator({
    mainRepo: state.repo,
    worktreeRoot: state.worktrees
  });
  let thrown = null;
  try {
    await coordinator.recoverTerminalCandidate("WK-1634");
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, "cold reconstruction must refuse");
  assert.throws(() => git(state.repo, "rev-parse", "--verify",
    "refs/agent-launch/terminal-current-v2/WK-1634"));
  return thrown;
}

function assertNoBorrowedMaterial(thrown, state) {
  const surface = JSON.stringify({
    message: thrown.message,
    code: thrown.code,
    cause: thrown.cause ?? null,
    carrier: thrown.terminal_candidate_failure ?? null,
    projection: projectAuthenticatedTerminalCandidateFailure(thrown),
    reason: projectTerminalCandidateRecoveryReason(thrown)
  });
  assert.equal(surface.includes(RECONSTRUCTION_SECRET), false, "no secret-bearing path may be reflected");
  assert.equal(surface.includes(state.repo), false, "no repository path may be reflected");
  assert.equal(/Unexpected token|ENOENT|fatal:/u.test(surface), false,
    "no raw parser, syscall, or Git text may be reflected");
  assert.ok(surface.length < 2048, "the refusal surface stays bounded");
}

test("WK-1782#SLICE-001 an absent durable authority refusal is stable, bounded, and borrows nothing", async (t) => {
  const state = reconstructionProjectionFixture(t, { forkRef: false });
  const thrown = await refusedColdReconstruction(state);
  assert.equal(thrown.code, "terminal_candidate_recovery_current_ref_absent");
  assert.equal(projectTerminalCandidateRecoveryReason(thrown),
    "terminal_candidate_recovery_current_ref_absent");
  assert.deepEqual(projectAuthenticatedTerminalCandidateFailure(thrown), UNKNOWN_FAILURE);
  assert.notEqual(thrown.code, SWALLOWED_CODE);
  assertNoBorrowedMaterial(thrown, state);
});

test("WK-1782#SLICE-001 an unreadable canonical review contract refuses without reflecting the record", async (t) => {
  const state = reconstructionProjectionFixture(t);
  writeFileSync(state.recordPath, `{ "id": "WK-1634", ${RECONSTRUCTION_SECRET}`);
  const thrown = await refusedColdReconstruction(state);
  assert.equal(thrown.code, "terminal_candidate_recovery_canonical_review_contract_unavailable");
  assert.equal(projectTerminalCandidateRecoveryReason(thrown), thrown.code);
  assert.deepEqual(projectAuthenticatedTerminalCandidateFailure(thrown), UNKNOWN_FAILURE);
  assertNoBorrowedMaterial(thrown, state);
});

test("WK-1782#SLICE-001 a Git fault during reconstruction keeps its closed typed detail", async (t) => {
  const state = reconstructionProjectionFixture(t);

  execFileSync("chmod", ["-R", "a-w", path.join(state.repo, ".git", "objects")]);
  const thrown = await refusedColdReconstruction(state);
  assert.equal(thrown.code, "terminal_candidate_recovery_construction_failed");
  const projection = projectAuthenticatedTerminalCandidateFailure(thrown);
  assert.equal(projection.kind, "typed_candidate_error");
  assert.equal(projection.code, TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED);
  assert.equal(projection.message, TERMINAL_CANDIDATE_TYPED_FAILURE_MESSAGE);
  assert.deepEqual(Object.keys(projection.detail), ["git_operation", "git_status"]);
  assert.equal(projection.detail.git_operation, "commit-tree");
  assert.equal(Number.isInteger(projection.detail.git_status), true);
  assertNoBorrowedMaterial(thrown, state);
});
