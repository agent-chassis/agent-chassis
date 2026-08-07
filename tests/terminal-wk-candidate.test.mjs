import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  TERMINAL_WK_CANDIDATE_CODES,
  TERMINAL_WK_CANDIDATE_SCHEMA_VERSION,
  TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3,
  TerminalWkCandidateError,
  assertTerminalWkCandidateInputsUnmoved,
  casTerminalCandidateCurrentRef,
  constructTerminalWkCandidate,
  defaultTerminalCandidateRunGit,
  deriveRecoveredTerminalWkCandidateIdentity,
  deriveTerminalCandidateCurrentRef,
  deriveTerminalCandidateDurableRefs,
  deriveTerminalWkCandidate,
  freezeReconstructedTerminalWkCandidateInputs,
  freezeRecoveredTerminalWkCandidateInputs,
  freezeTerminalWkCandidateInputs,
  readTerminalCandidateCurrentRef,
  readTerminalWkCandidateMetadata,
  verifyTerminalWkCandidateObjectBinding
} from "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import {
  materializeTerminalCandidateCheckout,
  verifyTerminalCandidateCheckout
} from "../packages/agent-launch-cli/src/lib/terminal-review-materialization.mjs";

import { defaultRunGit as substrateRunGit } from
  "../packages/agent-launch-cli/src/lib/worktree-substrate.mjs";

const candidateSource = readFileSync(new URL(
  "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs",
  import.meta.url
), "utf8");

const COORDINATOR_MODULE_PATHS = Object.freeze([
  "../packages/wiki-mcp/src/lib/dispatch-launch-runtime.mjs",
  "../packages/wiki-mcp/src/lib/dispatch-terminal-candidate-runtime.mjs"
]);

const coordinatorModules = Object.freeze(COORDINATOR_MODULE_PATHS
  .map((relativePath) => ({ relativePath, url: new URL(relativePath, import.meta.url) }))
  .filter(({ url }) => existsSync(url))
  .map(({ relativePath, url }) => Object.freeze({
    relativePath,
    source: readFileSync(url, "utf8")
  })));

function coordinatorModulesMatching(pattern) {
  return coordinatorModules.filter(({ source }) => pattern.test(source));
}

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function commit(repo, message) {
  git(repo, "add", "-A");
  git(repo, "commit", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

test("WK-1718 production recovery has no historical-ref enumeration or compatibility namespace", () => {
  assert.notEqual(coordinatorModules.length, 0, "no allowed coordinator module is present");
  for (const source of [candidateSource, ...coordinatorModules.map(({ source: s }) => s)]) {
    assert.equal(source.includes("refs/agent-launch/terminal-candidates"), false);
    assert.equal(/for-each-ref[^\n]*terminal-candidates/iu.test(source), false);
    assert.equal(/candidate_ref_(?:ambiguous|missing)/u.test(source), false);
  }
  assert.match(candidateSource, /refs\/agent-launch\/terminal-current/u);
  assert.equal((candidateSource.match(/"for-each-ref"/gu) ?? []).length, 1,
    "one exact fixed-ref observation owns current-candidate lookup");
  assert.equal(candidateSource.includes('["symbolic-ref", "--quiet", ref]'), false,
    "current-candidate lookup has no separate symbolic-ref probe");
  assert.equal(
    coordinatorModulesMatching(/deriveTerminalCandidateCurrentRef/u).length,
    1,
    "exactly one allowed coordinator module may resolve the fixed current-candidate ref"
  );
  for (const { source } of coordinatorModules) {
    assert.equal(source.includes(
      "terminal_candidate_recovery_current_ref_unavailable"
    ), false);
  }

  assert.equal(candidateSource.includes("merge-tree"), false);

  for (const owned of [
    /const reconstructAbsentTerminalCandidate = \(/u,
    /terminal_candidate_recovery_current_ref_absent/u,
    /observed === null[\s\S]{0,200}reconstructAbsentTerminalCandidate\(/u,
    /freezeReconstructedTerminalWkCandidateInputs\(/u
  ]) {
    assert.equal(coordinatorModulesMatching(owned).length, 1,
      `exactly one allowed coordinator module may own the cold-reconstruction body: ${owned}`);
  }
  for (const source of [candidateSource, ...coordinatorModules.map(({ source: s }) => s)]) {

    assert.equal(/"[^"\n]*refs\/heads\/main[^"\n]*"/u.test(source), false);
    assert.equal(/"[^"\n]*reflog[^"\n]*"/u.test(source), false);
    assert.equal(/"--all"|"--fork-point"|"--octopus"/u.test(source), false);
  }

  assert.deepEqual(
    [...candidateSource.matchAll(/"merge-base",\s*"([^"]+)"/gu)].map((match) => match[1]),
    ["--is-ancestor"]
  );
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

test("WK-1718 direct current candidate ref uses expected-old CAS and same-input convergence", () => {
  const { repo, base } = setup();
  const binding = constructTerminalWkCandidate({ frozen: freeze(repo, base) });
  assert.equal(readTerminalCandidateCurrentRef({
    mainRepo: repo,
    canonicalWkId: "WK-1634"
  }), binding.candidate);
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

test("WK-1718 current-candidate lookup is one exact raw observation with no follow-up window", () => {
  const ref = deriveTerminalCandidateCurrentRef({ canonicalWkId: "WK-1634" });
  const candidate = "a".repeat(40);
  const calls = [];
  const runGit = (input) => {
    calls.push(input.args);
    assert.deepEqual(input.args, [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)",
      "--count=2",
      "--",
      ref
    ], "the old check-then-follow race cannot issue a second Git observation");
    return {
      ok: true,
      status: 0,
      stdout: `${ref}\0${candidate}\0commit\0\n`,
      stderr: ""
    };
  };
  assert.equal(readTerminalCandidateCurrentRef({
    mainRepo: "/tmp",
    canonicalWkId: "WK-1634",
    runGit
  }), candidate);
  assert.equal(calls.length, 1, "raw ref name, target, type, and symref are one observation");
});

test("WK-1718 current-candidate raw observation rejects malformed, ambiguous, and faulty results", () => {
  const ref = deriveTerminalCandidateCurrentRef({ canonicalWkId: "WK-1634" });
  const oid = "a".repeat(40);
  const record = ({ name = ref, target = oid, type = "commit", symbolic = "", newline = true } = {}) =>
    `${name}\0${target}\0${type}\0${symbolic}${newline ? "\n" : ""}`;
  const refuseBinding = (stdout, label) => {
    assert.throws(() => readTerminalCandidateCurrentRef({
      mainRepo: "/tmp",
      canonicalWkId: "WK-1634",
      runGit: () => ({ ok: true, status: 0, stdout, stderr: "" })
    }), (error) => {
      assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH, label);
      return true;
    });
  };
  for (const [label, stdout] of [
    ["uppercase", record({ target: oid.toUpperCase() })],
    ["abbreviated", record({ target: oid.slice(0, 12) })],
    ["zero", record({ target: "0".repeat(40) })],
    ["decorated", record({ target: `${oid} decorated` })],
    ["wrong exact ref", record({ name: `${ref}-suffix` })],
    ["missing final newline", record({ newline: false })],
    ["multiple records", `${record()}${record({ name: `${ref}/child` })}`],
    ["extra field", `${ref}\0${oid}\0commit\0\0extra\n`],
    ["symbolic", record({ symbolic: "refs/heads/alias" })]
  ]) refuseBinding(stdout, label);

  for (const result of [
    { ok: false, status: 128, stdout: "", stderr: "git fault" },
    { ok: true, status: null, stdout: "", stderr: "" },
    { ok: true, status: 0, stdout: "", stderr: "indeterminate warning" },
    { ok: true, status: 0, stdout: "", stderr: "", signal: "SIGTERM" }
  ]) {
    assert.throws(() => readTerminalCandidateCurrentRef({
      mainRepo: "/tmp",
      canonicalWkId: "WK-1634",
      runGit: () => result
    }), (error) => {
      assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED);
      return true;
    });
  }
});

test("WK-1718 current-candidate authority refuses annotated and symbolic tag indirection", () => {
  for (const indirection of ["annotated", "symbolic-lightweight"]) {
    const { repo, base } = setup();
    const binding = constructTerminalWkCandidate({ frozen: freeze(repo, base) });
    const tagRef = `refs/tags/current-${indirection}`;
    if (indirection === "annotated") {
      git(repo, "tag", "-a", tagRef.slice("refs/tags/".length), binding.candidate,
        "-m", "not direct authority");
      const tagObject = git(repo, "rev-parse", tagRef);
      git(repo, "update-ref", binding.candidate_ref, tagObject, binding.candidate);
    } else {
      git(repo, "tag", tagRef.slice("refs/tags/".length), binding.candidate);
      git(repo, "symbolic-ref", binding.candidate_ref, tagRef);
    }
    assert.throws(() => readTerminalCandidateCurrentRef({
      mainRepo: repo,
      canonicalWkId: "WK-1634"
    }), (error) => {
      assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH);
      return true;
    }, indirection);
  }
});

test("WK-1718 current-candidate authority refuses non-commit objects", () => {
  for (const object of ["tree", "blob"]) {
    const { repo, base } = setup();
    const binding = constructTerminalWkCandidate({ frozen: freeze(repo, base) });
    const objectId = object === "tree"
      ? git(repo, "rev-parse", `${binding.candidate}^{tree}`)
      : git(repo, "rev-parse", `${binding.candidate}:wk-only.txt`);
    git(repo, "update-ref", binding.candidate_ref, objectId, binding.candidate);
    assert.throws(() => readTerminalCandidateCurrentRef({
      mainRepo: repo,
      canonicalWkId: "WK-1634"
    }), (error) => {
      assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH);
      return true;
    }, object);
  }
});

test("WK-1718 failed CAS cannot converge through an annotated tag that peels to C", () => {
  const { repo, base } = setup();
  const binding = constructTerminalWkCandidate({ frozen: freeze(repo, base) });
  git(repo, "tag", "-a", "candidate-alias", binding.candidate, "-m", "peels to candidate");
  const tagObject = git(repo, "rev-parse", "refs/tags/candidate-alias");
  let updateAttempts = 0;
  const runGit = (input) => {
    if (input.args[0] === "update-ref") {
      updateAttempts += 1;
      defaultTerminalCandidateRunGit({
        repo,
        args: ["update-ref", binding.candidate_ref, tagObject, binding.candidate],
        env: null
      });
      return { ok: false, status: 1, stdout: "", stderr: "expected-old mismatch" };
    }
    return defaultTerminalCandidateRunGit(input);
  };
  assert.throws(() => casTerminalCandidateCurrentRef({
    mainRepo: repo,
    canonicalWkId: "WK-1634",
    candidate: binding.candidate,
    expectedOld: binding.candidate,
    runGit
  }), (error) => {
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH);
    return true;
  });
  assert.equal(updateAttempts, 1);
  assert.equal(git(repo, "rev-parse", binding.candidate_ref), tagObject,
    "the raw fixed ref remains the tag object, not C");
  assert.equal(git(repo, "rev-parse", `${binding.candidate_ref}^{commit}`), binding.candidate,
    "the mutation witness would falsely peel the tag to C");
});

test("WK-1718 no-deref CAS acts on the fixed ref and preserves a raced symbolic referent", () => {
  const { repo, base } = setup();
  const binding = deriveTerminalWkCandidate({ frozen: freeze(repo, base) });
  const referent = "refs/heads/current-candidate-authority-alias";
  let updateArgs = null;
  const runGit = (input) => {
    if (input.args[0] === "update-ref") {
      updateArgs = input.args;
      git(repo, "symbolic-ref", binding.candidate_ref, referent);
    }
    return defaultTerminalCandidateRunGit(input);
  };
  let result;
  assert.doesNotThrow(() => {
    result = casTerminalCandidateCurrentRef({
      mainRepo: repo,
      canonicalWkId: "WK-1634",
      candidate: binding.candidate,
      expectedOld: null,
      runGit
    });
  }, "--no-deref must operate on the fixed ref instead of the symbolic referent");
  assert.equal(result.state, "created");
  assert.deepEqual(updateArgs, [
    "update-ref", "--no-deref", binding.candidate_ref, binding.candidate, ""
  ]);
  assert.throws(() => git(repo, "rev-parse", "--verify", referent),
    "CAS must not create or update the raced symbolic referent");
  assert.equal(git(repo, "rev-parse", binding.candidate_ref), binding.candidate,
    "--no-deref replaces the fixed ref itself rather than following the symbolic referent");
  assert.throws(() => git(repo, "symbolic-ref", binding.candidate_ref),
    "the successful result is a direct fixed ref, never false convergence through a symbolic ref");
});

test("WK-1718 failed CAS followed by a symbolic ref to exact C cannot converge", () => {
  const { repo, base } = setup();
  const binding = constructTerminalWkCandidate({ frozen: freeze(repo, base) });
  const referent = "refs/heads/exact-candidate-alias";
  git(repo, "update-ref", referent, binding.candidate);
  let updateAttempts = 0;
  const runGit = (input) => {
    if (input.args[0] === "update-ref") {
      updateAttempts += 1;
      git(repo, "symbolic-ref", binding.candidate_ref, referent);
      return { ok: false, status: 1, stdout: "", stderr: "expected-old mismatch" };
    }
    return defaultTerminalCandidateRunGit(input);
  };
  assert.throws(() => casTerminalCandidateCurrentRef({
    mainRepo: repo,
    canonicalWkId: "WK-1634",
    candidate: binding.candidate,
    expectedOld: binding.candidate,
    runGit
  }), (error) => {
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH);
    return true;
  });
  assert.equal(updateAttempts, 1);
  assert.equal(git(repo, "rev-parse", referent), binding.candidate);
  assert.equal(git(repo, "symbolic-ref", binding.candidate_ref), referent);
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

const REVIEW_SUBJECT = "WK-1634#SLICE-008";
const REVIEW_CONTRACT_DIGEST = `sha256:${"b".repeat(64)}`;
const FORK_REF = "refs/agent-launch/wk-forks/IN-0030/WK-1634";
const WK_REF = "refs/heads/wk/IN-0030/WK-1634";

function reconstructionSetup() {
  const state = setup();
  git(state.repo, "update-ref", FORK_REF, state.base);
  return state;
}

function freezeReconstructed(repo, overrides = {}) {
  return freezeReconstructedTerminalWkCandidateInputs({
    mainRepo: repo,
    initiative: "IN-0030",
    canonicalWkId: "WK-1634",
    canonicalWkDigest: `sha256:${"a".repeat(64)}`,
    terminalReviewSubject: REVIEW_SUBJECT,
    terminalReviewContractDigest: REVIEW_CONTRACT_DIGEST,
    ...overrides
  });
}

test("WK-1782 durable launcher ref names are derived from canonical identity, never supplied", () => {
  assert.deepEqual({ ...deriveTerminalCandidateDurableRefs({
    initiative: "IN-0030",
    canonicalWkId: "WK-1634"
  }) }, {
    wk_ref: WK_REF,
    fork_ref: FORK_REF
  });
  for (const input of [
    { initiative: "IN-30", canonicalWkId: "WK-1634" },
    { initiative: "IN-0030", canonicalWkId: "WK-16345" },
    { initiative: "../../heads/main", canonicalWkId: "WK-1634" },
    { initiative: "IN-0030", canonicalWkId: "refs/heads/main" },
    {}
  ]) {
    assert.throws(() => deriveTerminalCandidateDurableRefs(input), (error) => {
      assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT);
      return true;
    }, JSON.stringify(input));
  }
});

test("WK-1782 reconstruction freezes B and W from exact direct durable refs only", () => {
  const { repo, base, wk, landing } = reconstructionSetup();
  const frozen = freezeReconstructed(repo);
  assert.equal(frozen.schema_version, TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3);
  assert.equal(frozen.base, base);
  assert.equal(frozen.wk_tip, wk);
  assert.equal(frozen.base_ref, FORK_REF);
  assert.equal(frozen.wk_ref, WK_REF);
  assert.equal(frozen.terminal_review_subject, REVIEW_SUBJECT);
  assert.equal(frozen.terminal_review_contract_digest, REVIEW_CONTRACT_DIGEST);

  git(repo, "update-ref", "-d", FORK_REF, base);
  assert.equal(freezeReconstructed(repo), null);
  git(repo, "update-ref", FORK_REF, base);
  git(repo, "update-ref", "-d", WK_REF, wk);
  assert.equal(freezeReconstructed(repo), null);
  git(repo, "update-ref", WK_REF, wk);

  git(repo, "update-ref", FORK_REF, landing, base);
  assert.throws(() => freezeReconstructed(repo), (error) => {
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.BASE_INVALID);
    return true;
  });
  git(repo, "update-ref", FORK_REF, base, landing);

  git(repo, "update-ref", "refs/heads/fork-alias", base);
  git(repo, "symbolic-ref", FORK_REF, "refs/heads/fork-alias");
  assert.throws(() => freezeReconstructed(repo), (error) => {
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH);
    return true;
  });
  git(repo, "update-ref", "--no-deref", FORK_REF, git(repo, "rev-parse", `${base}^{tree}`));
  assert.throws(() => freezeReconstructed(repo), (error) => {
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.BINDING_MISMATCH);
    return true;
  });
});

test("WK-1782 reconstruction inputs are closed to malformed launcher identity", () => {
  const { repo } = reconstructionSetup();
  for (const overrides of [
    { canonicalWkDigest: "sha256:not-a-digest" },
    { terminalReviewSubject: "WK-1634#SLICE-8" },
    { terminalReviewSubject: "WK-9999#SLICE-008" },
    { terminalReviewContractDigest: "sha1:deadbeef" },
    { canonicalWkId: "WK-16" },
    { mainRepo: "relative/path" }
  ]) {
    assert.throws(() => freezeReconstructed(repo, overrides), (error) => {
      assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT);
      return true;
    }, JSON.stringify(overrides));
  }
});

test("WK-1782 the reconstructed candidate is the same exact product with an explicit versioned binding", () => {
  const { repo, base, wk } = reconstructionSetup();
  const frozen = freezeReconstructed(repo);
  const derived = deriveTerminalWkCandidate({ frozen });
  assert.equal(derived.candidate_tree, git(repo, "rev-parse", `${wk}^{tree}`), "tree(C) === tree(W)");
  assert.deepEqual(git(repo, "rev-list", "--parents", "-n", "1", derived.candidate).split(" "),
    [derived.candidate, base]);
  const bytes = execFileSync("git", ["-C", repo, "cat-file", "commit", derived.candidate],
    { encoding: "utf8" });
  assert.match(bytes, /^Review-Unit: WK-1634#SLICE-008$/mu);
  assert.match(bytes, new RegExp(`^Review-Contract: ${REVIEW_CONTRACT_DIGEST}$`, "mu"));
  assert.equal(/^Contract: /mu.test(bytes), false,
    "a reconstructed candidate never reuses the v2 contract field");
  assert.ok(bytes.endsWith(`Review-Contract: ${REVIEW_CONTRACT_DIGEST}\n`));

  const metadata = readTerminalWkCandidateMetadata({ mainRepo: repo, candidate: derived.candidate });
  assert.equal(metadata.schema_version, TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3);
  assert.equal(metadata.canonical_wk_digest, null);
  assert.equal(metadata.terminal_review_subject, REVIEW_SUBJECT);
  assert.equal(metadata.terminal_review_contract_digest, REVIEW_CONTRACT_DIGEST);
  verifyTerminalWkCandidateObjectBinding({ binding: derived });

  const recoveredFrozen = freezeRecoveredTerminalWkCandidateInputs({
    mainRepo: repo,
    wkRef: WK_REF,
    canonicalWkId: "WK-1634",
    candidate: derived.candidate,
    canonicalWkDigest: `sha256:${"c".repeat(64)}`
  });
  assert.equal(recoveredFrozen.schema_version, TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3);
  assert.equal(recoveredFrozen.base_ref, FORK_REF);
  assert.equal(recoveredFrozen.terminal_review_contract_digest, REVIEW_CONTRACT_DIGEST);
  assert.equal(deriveRecoveredTerminalWkCandidateIdentity({ frozen: recoveredFrozen }).candidate,
    derived.candidate, "the bound contract identity is recovered from the object, not the caller");
  assert.throws(() => freezeRecoveredTerminalWkCandidateInputs({
    mainRepo: repo,
    wkRef: WK_REF,
    canonicalWkId: "WK-1634",
    candidate: derived.candidate
  }), (error) => {
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT);
    return true;
  });
});

test("WK-1782 an already-valid v2 candidate keeps its bytes, version, and recovery", () => {
  const { repo, base } = reconstructionSetup();
  const binding = constructTerminalWkCandidate({ frozen: freeze(repo, base) });
  const bytes = execFileSync("git", ["-C", repo, "cat-file", "commit", binding.candidate],
    { encoding: "utf8" });
  assert.ok(bytes.endsWith(`Contract: sha256:${"a".repeat(64)}\n`));
  assert.equal(/Review-(Unit|Contract): /u.test(bytes), false);
  const metadata = readTerminalWkCandidateMetadata({ mainRepo: repo, candidate: binding.candidate });
  assert.equal(metadata.schema_version, TERMINAL_WK_CANDIDATE_SCHEMA_VERSION);
  assert.equal(metadata.canonical_wk_digest, `sha256:${"a".repeat(64)}`);
  assert.equal(metadata.terminal_review_subject, null);
  assert.equal(metadata.terminal_review_contract_digest, null);
  const recovered = freezeRecoveredTerminalWkCandidateInputs({
    mainRepo: repo,
    wkRef: WK_REF,
    canonicalWkId: "WK-1634",
    candidate: binding.candidate
  });
  assert.equal(recovered.schema_version, TERMINAL_WK_CANDIDATE_SCHEMA_VERSION);
  assert.equal(recovered.base_ref, "main");
  assert.equal(recovered.canonical_wk_digest, `sha256:${"a".repeat(64)}`);
  assert.equal(Object.hasOwn(recovered, "terminal_review_subject"), false);
});

test("WK-1782 a candidate carrying both or neither contract binding is refused", () => {
  const { repo, base, wk } = reconstructionSetup();
  const tree = git(repo, "rev-parse", `${wk}^{tree}`);
  const repositoryDigest = freezeReconstructed(repo).repository.digest;
  const commitWithMessage = (message) => execFileSync(
    "git",
    ["-C", repo, "commit-tree", tree, "-p", base],
    {
      input: message,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "x", GIT_AUTHOR_EMAIL: "x@example.invalid",
        GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
        GIT_COMMITTER_NAME: "x", GIT_COMMITTER_EMAIL: "x@example.invalid",
        GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z"
      }
    }
  ).trim();
  const header = [
    "WK-1634: terminal squash candidate",
    "",
    `Base: ${base}`,
    `WK: ${wk}`,
    `Repository: ${repositoryDigest}`
  ];
  for (const [label, trailer] of [
    ["both bindings", [`Contract: sha256:${"a".repeat(64)}`, `Review-Unit: ${REVIEW_SUBJECT}`,
      `Review-Contract: ${REVIEW_CONTRACT_DIGEST}`]],
    ["v3 binding without its review unit", [`Review-Contract: ${REVIEW_CONTRACT_DIGEST}`]],
    ["v3 review unit without its contract", [`Review-Unit: ${REVIEW_SUBJECT}`]],
    ["no binding at all", []],
    ["a v2 contract that is not the final field", [`Contract: sha256:${"a".repeat(64)}`, "Trailing: x"]]
  ]) {
    const candidate = commitWithMessage([...header, ...trailer, ""].join("\n"));
    assert.throws(() => readTerminalWkCandidateMetadata({ mainRepo: repo, candidate }), (error) => {
      assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_INVALID, label);
      return true;
    }, label);
  }
});

test("WK-1782 a frozen tuple cannot present itself under the other candidate version", () => {
  const { repo, base } = reconstructionSetup();
  const v2 = freeze(repo, base);
  const v3 = freezeReconstructed(repo);
  const smuggled = Object.freeze({ ...v2, terminal_review_subject: REVIEW_SUBJECT });
  assert.throws(() => assertTerminalWkCandidateInputsUnmoved({ frozen: smuggled }), (error) => {
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT);
    return true;
  });
  for (const broken of [
    { ...v3, base_ref: "main" },
    { ...v3, terminal_review_subject: "WK-9999#SLICE-008" },
    { ...v3, terminal_review_contract_digest: undefined },
    { ...v3, base_ref: "refs/agent-launch/wk-forks/IN-0031/WK-1634" }
  ]) {
    assert.throws(() => assertTerminalWkCandidateInputsUnmoved({ frozen: Object.freeze(broken) }),
      (error) => {
        assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.INVALID_ARGUMENT);
        return true;
      });
  }

  assert.equal(assertTerminalWkCandidateInputsUnmoved({ frozen: v3 }), v3);
  git(repo, "update-ref", FORK_REF, v3.wk_tip, v3.base);
  assert.throws(() => assertTerminalWkCandidateInputsUnmoved({ frozen: v3 }), (error) => {
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED);
    assert.equal(error.detail.field, "base");
    return true;
  });
  git(repo, "update-ref", FORK_REF, v3.base, v3.wk_tip);
  git(repo, "update-ref", "-d", WK_REF, v3.wk_tip);
  assert.throws(() => assertTerminalWkCandidateInputsUnmoved({ frozen: v3 }), (error) => {
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED);
    assert.equal(error.detail.field, "wk_tip");
    assert.equal(error.detail.actual, null, "a deleted durable ref refuses exactly like a moved one");
    return true;
  });
});

async function importMutatedCandidateModule(t, mutate) {
  const source = readFileSync(new URL(
    "../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs",
    import.meta.url
  ), "utf8");
  const mutated = mutate(source);
  assert.notEqual(mutated, source, "the witness must actually change production bytes");
  const rewritten = mutated.replace(/from "([^"]+)"/gu, (_match, specifier) =>
    `from ${JSON.stringify(specifier.startsWith(".")
      ? new URL(specifier, new URL("../packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs",
        import.meta.url)).href
      : import.meta.resolve(specifier))}`);
  const dir = mkdtempSync(path.join(os.tmpdir(), "wk1782-candidate-mutant-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "terminal-wk-candidate.mutant.mjs");
  writeFileSync(file, rewritten);
  return import(pathToFileURL(file).href);
}

function uniqueReplace(source, needle, replacement) {
  assert.equal(source.split(needle).length - 1, 1,
    "the mutated production fragment must be uniquely identifiable");
  return source.replace(needle, replacement);
}

test("WK-1782 mutation witness: CAS publication without --no-deref writes a raced symbolic referent", async (t) => {
  const mutant = await importMutatedCandidateModule(t, (source) =>
    uniqueReplace(source, `args: ["update-ref", "--no-deref", candidateRef, candidate, expectedOld ?? ""],`,
      `args: ["update-ref", candidateRef, candidate, expectedOld ?? ""],`));
  const { repo, base } = reconstructionSetup();
  const referent = "refs/heads/no-deref-witness-alias";
  const binding = mutant.deriveTerminalWkCandidate({ frozen: mutant.freezeTerminalWkCandidateInputs({
    mainRepo: repo,
    baseSha: base,
    baseRef: "main",
    wkRef: WK_REF,
    canonicalWkId: "WK-1634",
    canonicalWkDigest: `sha256:${"a".repeat(64)}`
  }) });
  const runGit = (input) => {
    if (input.args[0] === "update-ref") {
      git(repo, "symbolic-ref", binding.candidate_ref, referent);
    }
    return defaultTerminalCandidateRunGit(input);
  };
  try {
    mutant.casTerminalCandidateCurrentRef({
      mainRepo: repo,
      canonicalWkId: "WK-1634",
      candidate: binding.candidate,
      expectedOld: null,
      runGit
    });
  } catch {

  }
  assert.equal(git(repo, "rev-parse", referent), binding.candidate,
    "without --no-deref the CAS follows the symbolic ref and writes the referent");

  const { repo: cleanRepo, base: cleanBase } = reconstructionSetup();
  const clean = deriveTerminalWkCandidate({ frozen: freeze(cleanRepo, cleanBase) });
  casTerminalCandidateCurrentRef({
    mainRepo: cleanRepo,
    canonicalWkId: "WK-1634",
    candidate: clean.candidate,
    expectedOld: null,
    runGit: (input) => {
      if (input.args[0] === "update-ref") git(cleanRepo, "symbolic-ref", clean.candidate_ref, referent);
      return defaultTerminalCandidateRunGit(input);
    }
  });
  assert.throws(() => git(cleanRepo, "rev-parse", "--verify", referent));
});

test("WK-1782 mutation witness: a lost CAS accepts a different winner", async (t) => {
  const mutant = await importMutatedCandidateModule(t, (source) =>
    uniqueReplace(source,
      `  if (current === candidate) return Object.freeze({ state: "converged", ref: candidateRef, candidate });`,
      `  if (current !== null) return Object.freeze({ state: "converged", ref: candidateRef, candidate });`));
  const { repo, base } = reconstructionSetup();
  const binding = constructTerminalWkCandidate({ frozen: freeze(repo, base) });
  const other = git(repo, "rev-parse", "refs/heads/main");
  git(repo, "update-ref", "--no-deref", binding.candidate_ref, other, binding.candidate);
  const accepted = mutant.casTerminalCandidateCurrentRef({
    mainRepo: repo,
    canonicalWkId: "WK-1634",
    candidate: binding.candidate,
    expectedOld: null
  });
  assert.equal(accepted.state, "converged",
    "the mutant reports convergence on a ref that names a DIFFERENT winner");
  assert.equal(git(repo, "rev-parse", binding.candidate_ref), other);

  assert.throws(() => casTerminalCandidateCurrentRef({
    mainRepo: repo,
    canonicalWkId: "WK-1634",
    candidate: binding.candidate,
    expectedOld: null
  }), (error) => {
    assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.CANDIDATE_REF_DISAGREES);
    return true;
  });
});

test("WK-1782 mutation witness: v2 candidate bytes are reinterpreted as a v3 binding", async (t) => {
  const mutant = await importMutatedCandidateModule(t, (source) =>
    uniqueReplace(source,
      `    schema_version: v2
      ? TERMINAL_WK_CANDIDATE_SCHEMA_VERSION
      : TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3,`,
      `    schema_version: TERMINAL_WK_CANDIDATE_SCHEMA_VERSION_V3,`));
  const { repo, base } = reconstructionSetup();
  const binding = constructTerminalWkCandidate({ frozen: freeze(repo, base) });
  assert.equal(
    mutant.readTerminalWkCandidateMetadata({ mainRepo: repo, candidate: binding.candidate })
      .schema_version,
    "agent_launch.terminal_wk_candidate.v3",
    "the mutant reads an existing v2 candidate under v3 meaning"
  );

  assert.equal(
    readTerminalWkCandidateMetadata({ mainRepo: repo, candidate: binding.candidate }).schema_version,
    TERMINAL_WK_CANDIDATE_SCHEMA_VERSION
  );
  assert.equal(freezeRecoveredTerminalWkCandidateInputs({
    mainRepo: repo,
    wkRef: WK_REF,
    canonicalWkId: "WK-1634",
    candidate: binding.candidate
  }).schema_version, TERMINAL_WK_CANDIDATE_SCHEMA_VERSION);
});

test("WK-1782 exact-ref observation accepts every launcher-owned runner shape and still refuses faults", () => {
  const { repo, base, wk } = reconstructionSetup();
  const frozen = freezeReconstructed(repo, { runGit: substrateRunGit });
  assert.equal(frozen.base, base);
  assert.equal(frozen.wk_tip, wk);
  const binding = deriveTerminalWkCandidate({ frozen });

  assert.equal(
    verifyTerminalWkCandidateObjectBinding({ binding, runGit: substrateRunGit }),
    binding
  );
  assert.equal(readTerminalCandidateCurrentRef({
    mainRepo: repo,
    canonicalWkId: "WK-1634",
    runGit: substrateRunGit
  }), null);

  git(repo, "update-ref", FORK_REF, wk, base);
  assert.throws(() => verifyTerminalWkCandidateObjectBinding({ binding, runGit: substrateRunGit }),
    (error) => {
      assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.INPUT_MOVED);
      return true;
    });
  git(repo, "update-ref", FORK_REF, base, wk);

  const ref = deriveTerminalCandidateCurrentRef({ canonicalWkId: "WK-1634" });
  for (const faulty of [
    { ok: true, stdout: "", status: null },
    { ok: true, stdout: "", status: 1 },
    { ok: true, stdout: "", stderr: "indeterminate warning" },
    { ok: true, stdout: "", signal: "SIGTERM" },
    { ok: true, stdout: "", error: "spawn failed" },
    { ok: false, stdout: "" }
  ]) {
    assert.throws(() => readTerminalCandidateCurrentRef({
      mainRepo: repo,
      canonicalWkId: "WK-1634",
      runGit: () => faulty
    }), (error) => {
      assert.equal(error.code, TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED, JSON.stringify(faulty));
      return true;
    }, JSON.stringify(faulty));
  }

  const oid = "a".repeat(40);
  assert.equal(readTerminalCandidateCurrentRef({
    mainRepo: repo,
    canonicalWkId: "WK-1634",
    runGit: () => ({ ok: true, stdout: `${ref}\0${oid}\0commit\0\n` })
  }), oid);
});
