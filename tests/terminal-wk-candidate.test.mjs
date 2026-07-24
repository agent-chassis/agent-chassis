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

  assert.equal(candidateSource.includes("merge-tree"), false);

  assert.match(coordinatorSource, /candidate === null[\s\S]*terminal_candidate_recovery_current_ref_absent/u);
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

function freeze(repo, base) {
  return freezeTerminalWkCandidateInputs({
    mainRepo: repo,
    baseSha: base,
    baseRef: "main",
    wkRef: "refs/heads/wk/IN-0030/WK-1634",
    canonicalWkId: "WK-1634",
    canonicalWkDigest: `sha256:${"a".repeat(64)}`
  });
}

test("WK-1634 candidate is the deterministic squash of B..W and excludes landing content", () => {
  const { repo, base, wk } = setup();
  const frozen = freeze(repo, base);
  assert.equal(frozen.base, base);
  assert.equal(frozen.wk_tip, wk);
  assert.equal(frozen.base_ref, "main");

  const first = constructTerminalWkCandidate({ frozen });
  const second = constructTerminalWkCandidate({ frozen });
  assert.equal(second.candidate, first.candidate);
  assert.equal(second.candidate_ref_state, "current");
  assert.equal(first.candidate_ref, "refs/agent-launch/terminal-current-v2/WK-1634");
  assert.equal(first.candidate_parent, base);
  assert.equal(first.candidate_tree, git(repo, "rev-parse", `${wk}^{tree}`),
    "tree(C) === tree(W)");
  assert.deepEqual(git(repo, "rev-list", "--parents", "-n", "1", first.candidate).split(" "), [
    first.candidate,
    base
  ]);

  assert.throws(() => git(repo, "cat-file", "-e", `${first.candidate}:landing-only.txt`));
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

test("WK-1634 a landing/W product conflict does not block the squash candidate", () => {
  const { repo, base, wk } = setup();
  git(repo, "checkout", "wk/IN-0030/WK-1634");
  writeFileSync(path.join(repo, "shared.txt"), "wk replacement\n");
  const conflictingW = commit(repo, "wk conflict");
  git(repo, "checkout", "main");
  writeFileSync(path.join(repo, "shared.txt"), "landing replacement\n");
  commit(repo, "landing conflict");
  const frozen = freeze(repo, base);
  const binding = constructTerminalWkCandidate({ frozen });
  assert.equal(binding.candidate_parent, base);
  assert.equal(binding.wk_tip, conflictingW);
  assert.equal(binding.candidate_tree, git(repo, "rev-parse", `${conflictingW}^{tree}`));
  assert.equal(git(repo, "show", `${binding.candidate}:shared.txt`), "wk replacement");
  assert.notEqual(conflictingW, wk);
  verifyTerminalWkCandidateObjectBinding({ binding });
});

test("WK-1634 landing movement never changes deterministic C; WK movement invalidates", () => {
  const { repo, base } = setup();
  const first = constructTerminalWkCandidate({ frozen: freeze(repo, base) });

  git(repo, "checkout", "main");
  writeFileSync(path.join(repo, "landing-extra.txt"), "moved after\n");
  commit(repo, "advance landing");
  const again = constructTerminalWkCandidate({ frozen: freeze(repo, base) });
  assert.equal(again.candidate, first.candidate,
    "landing movement must not change deterministic C");
  verifyTerminalWkCandidateObjectBinding({ binding: first });

  const frozen = freeze(repo, base);
  git(repo, "checkout", "wk/IN-0030/WK-1634");
  writeFileSync(path.join(repo, "wk-moved.txt"), "moved\n");
  commit(repo, "move WK tip");
  assert.throws(() => constructTerminalWkCandidate({ frozen }), (error) => {
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED);
    return true;
  });
});

test("WK-1718 current candidate ref uses expected-old CAS and same-input convergence", () => {
  const { repo, base } = setup();
  const binding = constructTerminalWkCandidate({ frozen: freeze(repo, base) });
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
  const { repo, base } = setup();
  const frozen = freeze(repo, base);
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
  const { repo, base } = setup();
  const first = constructTerminalWkCandidate({ frozen: freeze(repo, base) });
  const legacyA = `refs/agent-launch/terminal-candidates/WK-1634/${first.candidate}`;
  const legacyB = `refs/agent-launch/terminal-candidates/WK-1634/${"f".repeat(40)}`;
  git(repo, "update-ref", legacyA, first.candidate);
  git(repo, "update-ref", legacyB, first.base);

  git(repo, "checkout", "wk/IN-0030/WK-1634");
  writeFileSync(path.join(repo, "remediation.txt"), "replacement\n");
  const replacementW = commit(repo, "remediation");
  git(repo, "checkout", "main");
  const replacement = constructTerminalWkCandidate({ frozen: freeze(repo, base) });

  assert.notEqual(replacement.candidate, first.candidate);
  assert.equal(replacement.wk_tip, replacementW);
  assert.equal(replacement.candidate_ref, deriveTerminalCandidateCurrentRef({ canonicalWkId: "WK-1634" }));
  assert.equal(replacement.candidate_ref_state, "advanced");
  assert.equal(git(repo, "rev-parse", replacement.candidate_ref), replacement.candidate);
  assert.equal(git(repo, "rev-parse", legacyA), first.candidate);
  assert.equal(git(repo, "rev-parse", legacyB), first.base);
});

test("WK-1634 materializes a private full detached checkout and rejects drift", () => {
  const { root, repo, base, wk } = setup();
  const binding = constructTerminalWkCandidate({ frozen: freeze(repo, base) });
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

test("WK-1634 candidate construction issues no merge-tree and no current-landing resolution", () => {
  const { repo, base } = setup();
  const seen = [];
  const runGit = (input) => {
    seen.push(input.args);
    return defaultTerminalCandidateRunGit(input);
  };
  const frozen = freezeTerminalWkCandidateInputs({
    mainRepo: repo,
    baseSha: base,
    baseRef: "main",
    wkRef: "refs/heads/wk/IN-0030/WK-1634",
    canonicalWkId: "WK-1634",
    canonicalWkDigest: `sha256:${"a".repeat(64)}`,
    runGit
  });
  constructTerminalWkCandidate({ frozen, runGit });
  assert.equal(seen.some((args) => args[0] === "merge-tree"), false, "no merge-tree");
  assert.equal(seen.some((args) => args[0] === "merge-base" && args[1] === "--all"), false,
    "no merge-base --all");

  assert.equal(
    seen.some((args) => args.some((a) => typeof a === "string" &&
      (/refs\/heads\/main\b/u.test(a) || a === "main" || /\bmain\^\{/u.test(a)))),
    false,
    "no current-landing-tip resolution"
  );
});

test("WK-1717 commit-tree execution failure is a typed Git failure with bounded detail", () => {
  const { repo, base } = setup();
  const frozen = freeze(repo, base);
  const runGit = (input) => {
    if (input.args[0] === "commit-tree") {
      return {
        ok: false,
        status: 128,
        stdout: "",
        stderr: "fatal: failed to write object: Read-only file system"
      };
    }
    return defaultTerminalCandidateRunGit(input);
  };
  assert.throws(() => constructTerminalWkCandidate({ frozen, runGit }), (error) => {
    assert.ok(error instanceof TerminalWkCandidateError);
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED);
    assert.notEqual(error.code, TERMINAL_WK_CANDIDATE_CODES.CONFLICT);
    assert.equal(error.detail.status, 128);
    assert.match(error.detail.stderr, /Read-only file system/u);
    assert.equal(error.detail.args[0], "commit-tree");
    return true;
  });
  assert.throws(() => git(repo, "rev-parse", "--verify",
    deriveTerminalCandidateCurrentRef({ canonicalWkId: "WK-1634" })));
});

test("WK-1634 a base that is not an ancestor of W fails closed", () => {
  const { repo, landing } = setup();

  assert.throws(() => freezeTerminalWkCandidateInputs({
    mainRepo: repo,
    baseSha: landing,
    baseRef: "main",
    wkRef: "refs/heads/wk/IN-0030/WK-1634",
    canonicalWkId: "WK-1634",
    canonicalWkDigest: `sha256:${"a".repeat(64)}`
  }), (error) => {
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID);
    return true;
  });
});
