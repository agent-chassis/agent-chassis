import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  TERMINAL_WK_CANDIDATE_CODES,
  casTerminalCandidateCurrentRef,
  defaultTerminalCandidateRunGit,
  deriveTerminalCandidateCurrentRef,
  deriveTerminalCandidateDurableRefs,
  freezeReconstructedTerminalWkCandidateInputs,
  constructTerminalWkCandidate
} from "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";

const WK = "WK-1634";
const INIT = "IN-0030";
const current = deriveTerminalCandidateCurrentRef({ canonicalWkId: WK });
const durable = deriveTerminalCandidateDurableRefs({ initiative: INIT, canonicalWkId: WK });
const digest = `sha256:${"a".repeat(64)}`;
const review = `sha256:${"b".repeat(64)}`;

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }
  }).trim();
}
function hasRef(repo, ref) {
  try { git(repo, "show-ref", "--verify", ref); return true; } catch { return false; }
}
function commit(repo, message) {
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", message);
  return git(repo, "rev-parse", "HEAD");
}
function fixture(t, objectFormat = "sha1") {
  const root = mkdtempSync(path.join(os.tmpdir(), "terminal-candidate-atomicity-"));
  const repo = path.join(root, "repo");
  execFileSync("git", ["init", "-q", ...(objectFormat === "sha256" ? ["--object-format=sha256"] : []), "-b", "main", repo]);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  writeFileSync(path.join(repo, "wiki.txt"), "base\n");
  const base = commit(repo, "base");
  git(repo, "checkout", "-qb", `wk/${INIT}/${WK}`);
  writeFileSync(path.join(repo, "wiki.txt"), "wk\n");
  const wk = commit(repo, "wk");
  git(repo, "update-ref", durable.fork_ref, base);
  return { repo, base, wk };
}
function frozen(state) {
  return freezeReconstructedTerminalWkCandidateInputs({
    mainRepo: state.repo, initiative: INIT, canonicalWkId: WK,
    canonicalWkDigest: digest, terminalReviewSubject: `${WK}#SLICE-008`,
    terminalReviewContractDigest: review
  });
}

test("reconstruction is replacement-neutral for SHA-1 and SHA-256 and preserves C/B/W", (t) => {
  for (const format of ["sha1", "sha256"]) {
    const state = fixture(t, format);
    const f = frozen(state);
    assert.equal(f.base, state.base);
    assert.equal(f.wk_tip, state.wk);
    const calls = [];
    const runGit = (input) => { calls.push(input.args); return defaultTerminalCandidateRunGit(input); };
    const binding = constructTerminalWkCandidate({ frozen: f, runGit });
    assert.equal(git(state.repo, "rev-parse", `${binding.candidate}^{tree}`), git(state.repo, "rev-parse", `${state.wk}^{tree}`));
    assert.deepEqual(git(state.repo, "rev-list", "--parents", "-n1", binding.candidate).split(" "), [binding.candidate, state.base]);
    assert.ok(calls.every((args) => args[0] === "--no-replace-objects"));
    git(state.repo, "checkout", "-q", "main");
    writeFileSync(path.join(state.repo, "replacement.txt"), "replacement\n");
    const replacement = commit(state.repo, "replacement");
    git(state.repo, "replace", state.wk, replacement);
    assert.equal(freezeReconstructedTerminalWkCandidateInputs({
      mainRepo: state.repo, initiative: INIT, canonicalWkId: WK,
      canonicalWkDigest: digest, terminalReviewSubject: `${WK}#SLICE-008`,
      terminalReviewContractDigest: review
    }).wk_tip, state.wk);
    git(state.repo, "replace", "-d", state.wk);
  }
});

test("malformed, symbolic, missing, non-commit, and moved B/W authorities refuse without publishing", (t) => {
  const state = fixture(t);
  const cases = [
    () => git(state.repo, "symbolic-ref", durable.fork_ref, "refs/heads/main"),
    () => git(state.repo, "update-ref", "--no-deref", durable.fork_ref, git(state.repo, "rev-parse", `${state.wk}^{tree}`)),
    () => git(state.repo, "update-ref", "-d", durable.wk_ref),
    () => {
      git(state.repo, "checkout", "-q", "--orphan", "unrelated");
      writeFileSync(path.join(state.repo, "unrelated.txt"), "unrelated\n");
      const unrelated = commit(state.repo, "unrelated");
      git(state.repo, "checkout", "-q", `wk/${INIT}/${WK}`);
      git(state.repo, "update-ref", durable.wk_ref, unrelated);
    }
  ];
  for (const [index, mutate] of cases.entries()) {
    git(state.repo, "update-ref", "--no-deref", "-d", durable.fork_ref);
    git(state.repo, "update-ref", "--no-deref", "-d", durable.wk_ref);
    git(state.repo, "update-ref", durable.fork_ref, state.base);
    git(state.repo, "update-ref", durable.wk_ref, state.wk);
    mutate();
    let refused = false;
    try { refused = frozen(state) === null; } catch (error) {
      refused = [
        TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH,
        TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED,
        TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID,
        TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED
      ].includes(error.code);
    }
    assert.equal(refused, true, `authority case ${index}`);
    assert.equal(hasRef(state.repo, current), false, "refusal leaves candidate ref absent");
  }
});

test("CAS converges only on the same winner and rejects a different winner", (t) => {
  const state = fixture(t);
  const candidate = state.wk;
  const makeRace = (winner) => (input) => {
    if (input.args.at(-1) === "--stdin") {
      git(state.repo, "update-ref", current, winner);
      return { ok: false, status: 128, stdout: "", stderr: "race" };
    }
    return defaultTerminalCandidateRunGit(input);
  };
  assert.equal(casTerminalCandidateCurrentRef({
    mainRepo: state.repo, canonicalWkId: WK, candidate, expectedOld: null,
    verifyRefs: [{ ref: durable.wk_ref, oid: state.wk }], runGit: makeRace(candidate)
  }).state, "converged");
  git(state.repo, "update-ref", "-d", current);
  assert.throws(() => casTerminalCandidateCurrentRef({
    mainRepo: state.repo, canonicalWkId: WK, candidate, expectedOld: null,
    verifyRefs: [{ ref: durable.wk_ref, oid: state.wk }], runGit: makeRace(state.base)
  }), (error) => error.code === TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_REF_DISAGREES);
});

test("the atomicity suite keeps the semantic mutant controls loaded", () => {
  const source = readFileSync(new URL("../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs", import.meta.url), "utf8");
  assert.match(source, /authorityGitArgs\(args\)/u);
  assert.match(source, /verifyRefs\.map\(\(\{ ref, oid \}\)/u);
  assert.match(source, /update-ref.*--stdin/u);
  assert.match(source, /assertTerminalWkCandidateInputsUnmoved\(\{ frozen, runGit \}\)/u);
  assert.match(source, /expectedOld === null/u);
});
