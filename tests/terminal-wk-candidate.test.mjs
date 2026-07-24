import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TERMINAL_WK_CANDIDATE_CODES,
  TerminalWkCandidateError,
  casTerminalCandidateCurrentRef,
  constructTerminalWkCandidate,
  defaultTerminalCandidateRunGit,
  deriveTerminalCandidateCurrentRef,
  deriveTerminalWkCandidate,
  freezeTerminalWkCandidateInputs,
  verifyTerminalWkCandidateObjectBinding
} from "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  materializeTerminalCandidateCheckout,
  verifyTerminalCandidateCheckout
} from "../packages/agent-launch-cli/src/lib/terminal-review-materialization.mjs";

const candidateSource = readFileSync(new URL(
  "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs",
  import.meta.url
), "utf8");
const coordinatorSource = readFileSync(new URL(
  "../packages/wiki-mcp/src/lib/dispatch-launch-runtime.mjs",
  import.meta.url
), "utf8");

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function commit(repo, message) {
  git(repo, "add", "-A");
  git(repo, "commit", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

test("WK-1718 production recovery has no historical-ref enumeration or compatibility namespace", () => {
  for (const source of [candidateSource, coordinatorSource]) {
    assert.equal(source.includes("refs/agent-launch/terminal-candidates"), false);
    assert.equal(/for-each-ref[^\n]*terminal/iu.test(source), false);
    assert.equal(/candidate_ref_(?:ambiguous|missing)/u.test(source), false);
  }
  assert.match(candidateSource, /refs\/agent-launch\/terminal-current/u);
  assert.match(coordinatorSource, /deriveTerminalCandidateCurrentRef/u);
  assert.equal(coordinatorSource.includes(
    "terminal_candidate_recovery_current_ref_unavailable"
  ), false);
  assert.match(coordinatorSource, /candidate === null[\s\S]*constructTerminalWkCandidate/u);
});

function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wk1634-candidate-"));
  const repo = path.join(root, "repo");
  execFileSync("git", ["init", "-b", "main", repo]);
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  writeFileSync(path.join(repo, "shared.txt"), "base\n");
  writeFileSync(path.join(repo, "delete.txt"), "delete me\n");
  writeFileSync(path.join(repo, "rename-old.txt"), "rename payload\n");
  writeFileSync(path.join(repo, "script.sh"), "#!/bin/sh\nexit 0\n");
  chmodSync(path.join(repo, "script.sh"), 0o644);
  const base = commit(repo, "base");

  git(repo, "checkout", "-b", "wk/IN-0030/WK-1634");
  writeFileSync(path.join(repo, "shared.txt"), "base\nwk\n");
  git(repo, "rm", "delete.txt");
  git(repo, "mv", "rename-old.txt", "rename-new.txt");
  chmodSync(path.join(repo, "script.sh"), 0o755);
  symlinkSync("shared.txt", path.join(repo, "shared-link"));
  writeFileSync(path.join(repo, "wk-only.txt"), "whole WK delta\n");
  const wk = commit(repo, "wk delta");

  git(repo, "checkout", "main");
  writeFileSync(path.join(repo, "landing-only.txt"), "landing stays\n");
  const landing = commit(repo, "landing only");
  return { root, repo, base, wk, landing };
}

function freeze(repo) {
  return freezeTerminalWkCandidateInputs({
    mainRepo: repo,
    landingRef: "refs/heads/main",
    wkRef: "refs/heads/wk/IN-0030/WK-1634",
    canonicalWkId: "WK-1634",
    canonicalWkDigest: `sha256:${"a".repeat(64)}`
  });
}

test("WK-1634 candidate deterministically preserves landing and the complete WK delta", () => {
  const { repo, base, wk, landing } = setup();
  const frozen = freeze(repo);
  assert.equal(frozen.merge_base, base);
  assert.equal(frozen.wk_tip, wk);
  assert.equal(frozen.landing_tip, landing);

  const first = constructTerminalWkCandidate({ frozen });
  const second = constructTerminalWkCandidate({ frozen });
  assert.equal(second.candidate, first.candidate);
  assert.equal(second.candidate_ref_state, "current");
  assert.equal(first.candidate_ref, "refs/agent-launch/terminal-current/WK-1634");
  assert.deepEqual(git(repo, "rev-list", "--parents", "-n", "1", first.candidate).split(" "), [
    first.candidate,
    landing
  ]);
  assert.equal(git(repo, "show", `${first.candidate}:landing-only.txt`), "landing stays");
  assert.equal(git(repo, "show", `${first.candidate}:wk-only.txt`), "whole WK delta");
  assert.equal(git(repo, "show", `${first.candidate}:shared.txt`), "base\nwk");
  assert.throws(() => git(repo, "cat-file", "-e", `${first.candidate}:delete.txt`));
  assert.equal(git(repo, "show", `${first.candidate}:rename-new.txt`), "rename payload");
  assert.throws(() => git(repo, "cat-file", "-e", `${first.candidate}:rename-old.txt`));
  assert.match(git(repo, "ls-tree", first.candidate, "script.sh"), /^100755 /u);
  assert.match(git(repo, "ls-tree", first.candidate, "shared-link"), /^120000 /u);
  assert.equal(git(repo, "rev-parse", "refs/heads/wk/IN-0030/WK-1634"), wk,
    "candidate construction must not move the WK branch");
  verifyTerminalWkCandidateObjectBinding({ binding: first });
});

test("WK-1634 candidate merge conflicts fail closed without a candidate ref", () => {
  const { repo } = setup();
  git(repo, "checkout", "wk/IN-0030/WK-1634");
  writeFileSync(path.join(repo, "shared.txt"), "wk replacement\n");
  commit(repo, "wk conflict");
  git(repo, "checkout", "main");
  writeFileSync(path.join(repo, "shared.txt"), "landing replacement\n");
  commit(repo, "landing conflict");
  const frozen = freeze(repo);
  assert.throws(() => constructTerminalWkCandidate({ frozen }), (error) => {
    assert.ok(error instanceof TerminalWkCandidateError);
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.CONFLICT);
    return true;
  });
});

test("WK-1634 moved landing or WK tips invalidate the frozen tuple", () => {
  for (const branch of ["main", "wk/IN-0030/WK-1634"]) {
    const { repo } = setup();
    const frozen = freeze(repo);
    git(repo, "checkout", branch);
    writeFileSync(path.join(repo, `${branch === "main" ? "landing" : "wk"}-moved.txt`), "moved\n");
    commit(repo, "move frozen input");
    assert.throws(() => constructTerminalWkCandidate({ frozen }), (error) => {
      assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED);
      return true;
    });
  }
});

test("WK-1718 current candidate ref uses expected-old CAS and same-input convergence", () => {
  const { repo } = setup();
  const binding = constructTerminalWkCandidate({ frozen: freeze(repo) });
  const exact = casTerminalCandidateCurrentRef({
    mainRepo: repo,
    canonicalWkId: "WK-1634",
    candidate: binding.candidate,
    expectedOld: binding.candidate
  });
  assert.equal(exact.state, "current");
  const other = git(repo, "rev-parse", "refs/heads/main");
  assert.throws(() => casTerminalCandidateCurrentRef({
    mainRepo: repo,
    canonicalWkId: "WK-1634",
    candidate: other,
    expectedOld: null
  }), (error) => {
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_REF_DISAGREES);
    return true;
  });
  assert.equal(git(repo, "rev-parse", binding.candidate_ref), binding.candidate);
  verifyTerminalWkCandidateObjectBinding({ binding });
  git(repo, "update-ref", binding.candidate_ref, other, binding.candidate);
  verifyTerminalWkCandidateObjectBinding({ binding });
});

test("WK-1718 crash before CAS leaves an inert object and crash after CAS recovers from the fixed ref", () => {
  const { repo } = setup();
  const frozen = freeze(repo);
  const inert = deriveTerminalWkCandidate({ frozen });
  assert.equal(git(repo, "cat-file", "-t", inert.candidate), "commit");
  assert.throws(() => git(repo, "rev-parse", inert.candidate_ref));
  const published = constructTerminalWkCandidate({ frozen });
  assert.equal(published.candidate, inert.candidate);
  assert.equal(git(repo, "rev-parse", published.candidate_ref), inert.candidate);
  const recovered = constructTerminalWkCandidate({ frozen });
  assert.equal(recovered.candidate, inert.candidate);
  assert.equal(recovered.candidate_ref_state, "current");
});

test("WK-1718 W movement constructs and CAS-advances one fixed ref while legacy refs stay unread", () => {
  const { repo } = setup();
  const first = constructTerminalWkCandidate({ frozen: freeze(repo) });
  const legacyA = `refs/agent-launch/terminal-candidates/WK-1634/${first.candidate}`;
  const legacyB = `refs/agent-launch/terminal-candidates/WK-1634/${"f".repeat(40)}`;
  git(repo, "update-ref", legacyA, first.candidate);
  git(repo, "update-ref", legacyB, first.landing_tip);

  git(repo, "checkout", "wk/IN-0030/WK-1634");
  writeFileSync(path.join(repo, "remediation.txt"), "replacement\n");
  const replacementW = commit(repo, "remediation");
  git(repo, "checkout", "main");
  const replacement = constructTerminalWkCandidate({ frozen: freeze(repo) });

  assert.notEqual(replacement.candidate, first.candidate);
  assert.equal(replacement.wk_tip, replacementW);
  assert.equal(replacement.candidate_ref, deriveTerminalCandidateCurrentRef({ canonicalWkId: "WK-1634" }));
  assert.equal(replacement.candidate_ref_state, "advanced");
  assert.equal(git(repo, "rev-parse", replacement.candidate_ref), replacement.candidate);
  assert.equal(git(repo, "rev-parse", legacyA), first.candidate);
  assert.equal(git(repo, "rev-parse", legacyB), first.landing_tip);
});

test("WK-1634 materializes a private full detached checkout and rejects drift", () => {
  const { root, repo, wk } = setup();
  const binding = constructTerminalWkCandidate({ frozen: freeze(repo) });
  const candidateRoot = path.join(root, "private", binding.candidate);
  const materialization = materializeTerminalCandidateCheckout({
    binding,
    candidateRoot,
    runGit: defaultTerminalCandidateRunGit
  });
  assert.equal(materialization.candidate, binding.candidate);
  assert.equal(lstatSync(candidateRoot).mode & 0o777, 0o700);
  assert.equal(lstatSync(materialization.checkout_path).mode & 0o777, 0o700);
  assert.equal(git(materialization.checkout_path, "rev-parse", "HEAD"), binding.candidate);
  assert.throws(() => git(materialization.checkout_path, "symbolic-ref", "--quiet", "HEAD"));
  assert.equal(git(repo, "rev-parse", "refs/heads/wk/IN-0030/WK-1634"), wk);

  writeFileSync(path.join(materialization.checkout_path, "untracked.txt"), "drift\n");
  assert.throws(() => verifyTerminalCandidateCheckout({
    binding,
    candidateRoot,
    runGit: defaultTerminalCandidateRunGit
  }), (error) => {
    assert.equal(error.code, "agent_launch.terminal_review_materialization.verify_failed.v1");
    return true;
  });
});

test("WK-1634 ambiguous merge-base output is refused before construction", () => {
  const { repo } = setup();
  const real = (input) => {
    if (input.args[0] === "merge-base" && input.args[1] === "--all") {
      return { ok: true, stdout: `${"1".repeat(40)}\n${"2".repeat(40)}\n` };
    }
    const result = execFileSync("git", ["-C", input.repo, ...input.args], { encoding: "utf8" });
    return { ok: true, stdout: result };
  };
  assert.throws(() => freezeTerminalWkCandidateInputs({
    mainRepo: repo,
    landingRef: "refs/heads/main",
    wkRef: "refs/heads/wk/IN-0030/WK-1634",
    canonicalWkId: "WK-1634",
    canonicalWkDigest: `sha256:${"a".repeat(64)}`,
    runGit: real
  }), (error) => {
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.MERGE_BASE_INVALID);
    return true;
  });
});
