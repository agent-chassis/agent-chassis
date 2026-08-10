

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createBackendTerminalReview } from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-terminal-review.mjs";
import {
  CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES,
  createTerminalCandidateCoordinator,
  projectTerminalCandidateRecoveryDiagnostic,
  projectTerminalCandidateRecoveryReason,
  TERMINAL_CANDIDATE_RECOVERY_DIAGNOSTIC_SCHEMA_VERSION,
  TERMINAL_REVIEW_UNIT_PROJECTION_CODES
} from "../packages/wiki-mcp/src/lib/dispatch-launch-runtime.mjs";

const RUNTIME_MODULE_URL = new URL(
  "../packages/wiki-mcp/src/lib/dispatch-terminal-candidate-runtime.mjs",
  import.meta.url
);
const WK = "WK-1991";
const REVIEW_SLICE = "SLICE-006";
const REVIEW_ADDRESS = Object.freeze({
  subject: `${WK}#${REVIEW_SLICE}`,
  record_id: WK,
  slice_id: REVIEW_SLICE,
  initiative: "IN-0030"
});
const DIAGNOSTIC_KEYS = [
  "schema_version",
  "contract_code",
  "projection_code",
  "missing_facts",
  "ambiguous_facts"
];

const SECRET = "glpat-WK1840-EXAMPLE-do-not-reflect";

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }
  }).trim();
}

function emptyAcceptanceRecord() {
  return {
    schema_version: "work-record.v1",
    id: WK,
    initiative: "IN-0030",
    title: `terminal diagnostic witness ${SECRET}`,
    status: "review",
    acceptance: { criteria: [], validation: [] },
    sections: {
      structured_validation: {
        allowed: [{ command: "node_test", target: "tests/diagnostic.test.mjs" }]
      }
    },
    slices: [
      { id: "SLICE-001", work_kind: "implementation", status: "done" },
      {
        id: REVIEW_SLICE,
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

function fixture(t, { record = emptyAcceptanceRecord(), rawRecord = null } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), `wk1840-${SECRET}-`));
  const repo = path.join(root, "repo");
  const worktrees = path.join(root, "worktrees");
  mkdirSync(repo);
  mkdirSync(worktrees);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "test");
  git(repo, "config", "user.email", "test@example.invalid");
  const recordPath = path.join(repo, "wiki", "work-records", `${WK}.json`);
  mkdirSync(path.dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, rawRecord ?? JSON.stringify(record));
  writeFileSync(path.join(repo, "base.txt"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "update-ref", `refs/agent-launch/wk-forks/IN-0030/${WK}`, "HEAD");
  git(repo, "branch", `wk/IN-0030/${WK}`);
  assert.throws(() => git(repo, "rev-parse", "--verify",
    `refs/agent-launch/terminal-current-v2/${WK}`));
  return { root, repo, worktrees, recordPath };
}

async function refusedRecovery({ repo, worktrees }) {
  const coordinator = createTerminalCandidateCoordinator({
    mainRepo: repo,
    worktreeRoot: worktrees
  });
  try {
    await coordinator.recoverTerminalCandidate(WK);
  } catch (error) {
    return error;
  }
  return assert.fail("cold terminal-candidate recovery must refuse");
}

function backendContext(state) {
  const coordinator = createTerminalCandidateCoordinator({
    mainRepo: state.repo,
    worktreeRoot: state.worktrees
  });
  return {
    frozenSliceReviewContexts: new Map(),
    frozenReviewContexts: new Map(),
    worktreeProvisioningConfig: { mainRepo: state.repo },
    reviewContextRunGit() {
      assert.fail("Git verification must not run after a recovery refusal");
    },
    recoverTerminalCandidate: (wkId) => coordinator.recoverTerminalCandidate(wkId),
    terminalCandidateRecoveryInFlight: new Map(),
    currentTerminalReviewTargetByWk: new Map(),
    frozenReviewContextsByTarget: new Map(),
    wholeReviewRunContexts: new Map(),
    runs: new Map(),
    wholeReviewTargetKey() {
      assert.fail("review target resolution must not run after a recovery refusal");
    },
    terminalReviewAttemptContracts: new Map(),
    terminalReviewAttemptContractBySubject: new Map(),
    structuredReceiptOutcome() {
      assert.fail("review result projection must not run after a recovery refusal");
    }
  };
}

async function backendRefusalDetail(state) {
  const ctx = backendContext(state);
  const result = await createBackendTerminalReview(ctx).recoverTerminalReviewContext(REVIEW_ADDRESS);
  assert.equal(result.ok, false);
  assert.equal(result.refusal.accepted, false);
  assert.equal(ctx.runs.size, 0);
  assert.equal(ctx.frozenReviewContexts.size, 0);
  return result.refusal.refusal.detail;
}

function assertBorrowsNothing(value, state, label) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(SECRET), false, `${label} reflected planted material`);
  assert.equal(serialized.includes(state.repo), false, `${label} reflected the repository path`);
  assert.equal(/Unexpected token|ENOENT|fatal:|at .*\.mjs/u.test(serialized), false,
    `${label} reflected raw parser, syscall, Git, or stack text`);
}

test("WK-1840 empty record-level acceptance names acceptance.criteria and acceptance.validation", async (t) => {
  const state = fixture(t);
  const error = await refusedRecovery(state);

  assert.equal(error.code, "terminal_candidate_recovery_canonical_review_contract_unavailable");
  assert.equal(projectTerminalCandidateRecoveryReason(error), error.code);

  const diagnostic = projectTerminalCandidateRecoveryDiagnostic(error);
  assert.notEqual(diagnostic, null, "the refusal must carry a launcher-owned diagnostic");
  assert.deepEqual(Object.keys(diagnostic), DIAGNOSTIC_KEYS);
  assert.equal(diagnostic.schema_version, TERMINAL_CANDIDATE_RECOVERY_DIAGNOSTIC_SCHEMA_VERSION);
  assert.equal(diagnostic.contract_code,
    CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.TERMINAL_REVIEW_UNIT_UNPROJECTABLE);
  assert.equal(diagnostic.projection_code,
    TERMINAL_REVIEW_UNIT_PROJECTION_CODES.PARENT_LIFECYCLE_CONTRACT_INCOMPLETE);

  assert.deepEqual(diagnostic.missing_facts, ["acceptance.criteria", "acceptance.validation"]);
  assert.deepEqual(diagnostic.ambiguous_facts, []);
  assertBorrowsNothing(diagnostic, state, "runtime diagnostic");
});

test("WK-1840 the reviewer backend refusal carries the verdict and the named fields", async (t) => {
  const state = fixture(t);
  const detail = await backendRefusalDetail(state);

  assert.equal(detail.reason,
    "terminal_candidate_recovery_canonical_review_contract_unavailable");
  assert.equal(detail.subject, REVIEW_ADDRESS.subject);
  assert.deepEqual(Object.keys(detail.recovery_diagnostic), DIAGNOSTIC_KEYS);
  assert.equal(detail.recovery_diagnostic.contract_code,
    CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.TERMINAL_REVIEW_UNIT_UNPROJECTABLE);
  assert.deepEqual(detail.recovery_diagnostic.missing_facts,
    ["acceptance.criteria", "acceptance.validation"]);
  assert.deepEqual(detail.recovery_diagnostic.ambiguous_facts, []);

  assert.equal(detail.recovery_code, null);
  assert.equal(detail.recovery_detail.kind, "unknown_cause");
  assertBorrowsNothing(detail, state, "backend refusal");
});

test("WK-1840 all four canonical-contract refusal paths are distinguishable", async (t) => {
  const codes = CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES;
  const observed = [];

  await t.test("a symlinked repository root is not the launcher-minted canonical root", async (st) => {
    const state = fixture(st);
    const link = path.join(state.root, "linked-repo");
    symlinkSync(state.repo, link);
    const error = await refusedRecovery({ repo: link, worktrees: state.worktrees });
    const diagnostic = projectTerminalCandidateRecoveryDiagnostic(error);
    assert.equal(diagnostic.contract_code, codes.REPOSITORY_ROOT_NOT_CANONICAL);
    assert.equal(diagnostic.projection_code, null);
    observed.push(diagnostic.contract_code);
    assertBorrowsNothing(diagnostic, state, "symlinked-root diagnostic");
  });

  await t.test("an unparseable canonical record", async (st) => {
    const state = fixture(st, { rawRecord: `{ "id": "${WK}", ${SECRET}` });
    const error = await refusedRecovery(state);
    const diagnostic = projectTerminalCandidateRecoveryDiagnostic(error);
    assert.equal(diagnostic.contract_code, codes.RECORD_UNREADABLE);
    assert.equal(diagnostic.projection_code, null);
    observed.push(diagnostic.contract_code);
    assertBorrowsNothing(diagnostic, state, "unreadable-record diagnostic");
  });

  await t.test("a canonical record whose initiative is not canonical", async (st) => {
    const state = fixture(st, {
      record: { ...emptyAcceptanceRecord(), initiative: `not-an-initiative-${SECRET}` }
    });
    const error = await refusedRecovery(state);
    const diagnostic = projectTerminalCandidateRecoveryDiagnostic(error);
    assert.equal(diagnostic.contract_code, codes.RECORD_IDENTITY_DISAGREES);
    assert.equal(diagnostic.projection_code, null);
    observed.push(diagnostic.contract_code);
    assertBorrowsNothing(diagnostic, state, "identity-disagrees diagnostic");
  });

  await t.test("a record that designates no projectable terminal review unit", async (st) => {
    const state = fixture(st);
    const error = await refusedRecovery(state);
    const diagnostic = projectTerminalCandidateRecoveryDiagnostic(error);
    assert.equal(diagnostic.contract_code, codes.TERMINAL_REVIEW_UNIT_UNPROJECTABLE);
    observed.push(diagnostic.contract_code);
  });

  assert.equal(new Set(observed).size, 4, "each null path must be separately nameable");
});

test("WK-1840 an ambiguous terminal review unit is named as ambiguous, not missing", async (t) => {
  const record = emptyAcceptanceRecord();
  record.acceptance = { criteria: ["review C against B"], validation: ["node --test"] };
  record.slices.push({ ...record.slices[1], id: "SLICE-007" });
  const state = fixture(t, { record });
  const error = await refusedRecovery(state);
  const diagnostic = projectTerminalCandidateRecoveryDiagnostic(error);
  assert.deepEqual(diagnostic.missing_facts, []);
  assert.deepEqual(diagnostic.ambiguous_facts, ["terminal_review_contract_unit"]);
});

test("WK-1840 forged and copied diagnostics are not launcher-owned", async (t) => {
  const state = fixture(t);
  const authentic = projectTerminalCandidateRecoveryDiagnostic(await refusedRecovery(state));
  const forged = new Error("forged");
  forged.code = "terminal_candidate_recovery_canonical_review_contract_unavailable";
  forged.terminal_candidate_recovery_diagnostic = { ...authentic };
  for (const value of [forged, { ...authentic }, new Proxy(forged, {}), null, undefined, "x", 7]) {
    assert.equal(projectTerminalCandidateRecoveryDiagnostic(value), null);
  }

  const ctx = backendContext(state);
  ctx.recoverTerminalCandidate = async () => { throw forged; };
  const result = await createBackendTerminalReview(ctx).recoverTerminalReviewContext(REVIEW_ADDRESS);
  assert.equal(result.ok, false);
  assert.equal(result.refusal.refusal.detail.reason, "terminal_candidate_recovery_failed");
  assert.equal(result.refusal.refusal.detail.recovery_diagnostic, null);
});

function rewriteModuleSpecifiers(source, moduleUrl) {
  return source.replace(/from "([^"]+)"/gu, (_match, specifier) =>
    `from ${JSON.stringify(specifier.startsWith(".")
      ? new URL(specifier, moduleUrl).href
      : import.meta.resolve(specifier))}`);
}

function replaceOnce(source, needle, replacement) {
  assert.equal(source.split(needle).length - 1, 1,
    `the mutated production fragment must be uniquely identifiable: ${needle}`);
  return source.replace(needle, replacement);
}

async function importMutatedRuntime(t, mutate) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wk1840-mutant-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = readFileSync(RUNTIME_MODULE_URL, "utf8");
  const mutated = mutate(source);
  assert.notEqual(mutated, source, "the witness must actually change production bytes");
  const file = path.join(dir, "dispatch-terminal-candidate-runtime.mutant.mjs");
  writeFileSync(file, rewriteModuleSpecifiers(mutated, RUNTIME_MODULE_URL));
  return import(pathToFileURL(file).href);
}

for (const [label, mutate] of [
  [

    "discard the diagnostic on the way out",
    (source) => replaceOnce(
      source,
      "    failure: UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION,\n    diagnostic\n",
      "    failure: UNKNOWN_TERMINAL_CANDIDATE_FAILURE_PROJECTION,\n    diagnostic: null\n"
    )
  ],
  [

    "return a bare fact-free terminal review unit projection",
    (source) => replaceOnce(
      source,
      "      missing_facts: closedLifecycleFacts(parentLifecycle?.missing_facts),",
      "      missing_facts: NO_LIFECYCLE_FACTS,"
    )
  ]
]) {
  test(`WK-1840 mutation witness: ${label}`, async (t) => {
    const mutant = await importMutatedRuntime(t, mutate);
    const state = fixture(t);
    const coordinator = mutant.createTerminalCandidateCoordinator({
      mainRepo: state.repo,
      worktreeRoot: state.worktrees
    });
    let thrown = null;
    try {
      await coordinator.recoverTerminalCandidate(WK);
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, "the mutant must still refuse");
    assert.equal(thrown.code,
      "terminal_candidate_recovery_canonical_review_contract_unavailable");
    const diagnostic = mutant.projectTerminalCandidateRecoveryDiagnostic(thrown);
    assert.equal(diagnostic?.missing_facts?.includes("acceptance.criteria") ?? false, false,
      "the mutant must not be able to name the empty acceptance fields");
    assert.equal(diagnostic?.missing_facts?.includes("acceptance.validation") ?? false, false,
      "the mutant must not be able to name the empty acceptance fields");
  });
}

test("WK-1840 mutation witness: the four canonical-contract paths collapse to one code", async (t) => {
  const mutant = await importMutatedRuntime(t, (source) => replaceOnce(
    source,
    `    return canonicalCurrentTerminalReviewFailure(
      CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.RECORD_UNREADABLE);`,
    `    return canonicalCurrentTerminalReviewFailure(
      CANONICAL_CURRENT_TERMINAL_REVIEW_CONTRACT_CODES.TERMINAL_REVIEW_UNIT_UNPROJECTABLE);`
  ));
  const unreadable = fixture(t, { rawRecord: `{ "id": "${WK}", ${SECRET}` });
  const unprojectable = fixture(t);
  const codes = [];
  for (const state of [unreadable, unprojectable]) {
    const coordinator = mutant.createTerminalCandidateCoordinator({
      mainRepo: state.repo,
      worktreeRoot: state.worktrees
    });
    try {
      await coordinator.recoverTerminalCandidate(WK);
      assert.fail("the mutant must still refuse");
    } catch (error) {
      codes.push(mutant.projectTerminalCandidateRecoveryDiagnostic(error).contract_code);
    }
  }
  assert.equal(new Set(codes).size, 1,
    "the mutant conflates two distinct causes production now separates");
});
