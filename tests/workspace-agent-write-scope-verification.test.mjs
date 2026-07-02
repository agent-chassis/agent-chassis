

import test from "node:test";
import assert from "node:assert/strict";

import {
  collectGitChangedPaths,
  verifyChangedFilesWithinWriteScope,
  WRITE_SCOPE_VERIFICATION_SCHEMA_VERSION,
  WRITE_SCOPE_VERIFICATION_REASONS
} from "../packages/agent-launch-cli/src/lib/workspace-agent-write-scope-verification.mjs";

function fakeGit({ diff = "", lsFiles = "", diffOk = true, lsOk = true } = {}) {
  return ({ args }) => {
    if (args[0] === "diff") {
      return diffOk ? { ok: true, stdout: diff } : { ok: false, status: 128, stderr: "fatal: not a git repository" };
    }
    if (args[0] === "ls-files") {
      return lsOk ? { ok: true, stdout: lsFiles } : { ok: false, status: 128 };
    }
    return { ok: false };
  };
}

test("WK-1169#SLICE-018 verify: changed files all within write_scope (dir + file entries) -> ran:true, ok:true", () => {
  const runGit = fakeGit({ diff: "docs/a.md\npackages/x/y.mjs\n", lsFiles: "" });
  const r = verifyChangedFilesWithinWriteScope({
    workspaceDir: "/repo",
    writeScope: ["docs/", "packages/x/y.mjs"],
    runGit
  });
  assert.equal(r.ran, true);
  assert.equal(r.ok, true);
  assert.deepEqual(r.out_of_scope, []);
  assert.deepEqual(r.changed, ["docs/a.md", "packages/x/y.mjs"]);

  assert.equal(r.schema_version, WRITE_SCOPE_VERIFICATION_SCHEMA_VERSION);
  assert.equal(r.enforcement.mode, "directory_scope_post_hoc_review");
  assert.equal(r.enforcement.kernel_exact_file, false);
  assert.equal(r.enforcement.enforced, false);
});

test("WK-1169#SLICE-018 verify: a SIBLING file in a bound directory but NOT in write_scope is out of scope -> ok:false", () => {

  const runGit = fakeGit({ diff: "packages/x/y.mjs\npackages/x/sibling.mjs\n" });
  const r = verifyChangedFilesWithinWriteScope({
    workspaceDir: "/repo",
    writeScope: ["packages/x/y.mjs"],
    runGit
  });
  assert.equal(r.ran, true);
  assert.equal(r.ok, false, "a sibling write must fail the subset check");
  assert.deepEqual(r.out_of_scope, ["packages/x/sibling.mjs"]);
});

test("WK-1169#SLICE-018 verify: an untracked (newly added) file is counted and judged against write_scope", () => {
  const runGit = fakeGit({ diff: "", lsFiles: "docs/new.md\nsecrets/leak.txt\n" });
  const r = verifyChangedFilesWithinWriteScope({
    workspaceDir: "/repo",
    writeScope: ["docs/"],
    runGit
  });
  assert.equal(r.ran, true);
  assert.equal(r.ok, false);
  assert.deepEqual(r.out_of_scope, ["secrets/leak.txt"]);
});

test("WK-1169#SLICE-018 verify: a deleted in-scope file (surfaced by git diff) stays in scope -> ok:true", () => {
  const runGit = fakeGit({ diff: "packages/x/y.mjs\n" });
  const r = verifyChangedFilesWithinWriteScope({
    workspaceDir: "/repo",
    writeScope: ["packages/x/y.mjs"],
    runGit
  });
  assert.equal(r.ok, true);
});

test("WK-1169#SLICE-018 verify: a pre-existing dirty path in the baseline is subtracted (only the worker's own changes are judged)", () => {
  const runGit = fakeGit({ diff: "docs/already-dirty.md\ndocs/worker-edit.md\npackages/x/sibling.mjs\n" });

  const baseline = new Set(["docs/already-dirty.md", "docs/worker-edit.md"]);
  const r = verifyChangedFilesWithinWriteScope({
    workspaceDir: "/repo",
    writeScope: ["docs/"],
    baseline,
    runGit
  });
  assert.deepEqual(r.changed, ["packages/x/sibling.mjs"], "baseline paths are subtracted");
  assert.equal(r.ok, false);
  assert.deepEqual(r.out_of_scope, ["packages/x/sibling.mjs"]);
});

test("WK-1169#SLICE-018 verify: baseline accepts a plain array too", () => {
  const runGit = fakeGit({ diff: "docs/a.md\ndocs/b.md\n" });
  const r = verifyChangedFilesWithinWriteScope({
    workspaceDir: "/repo",
    writeScope: ["docs/"],
    baseline: ["docs/a.md"],
    runGit
  });
  assert.deepEqual(r.changed, ["docs/b.md"]);
  assert.equal(r.ok, true);
});

test("WK-1169#SLICE-018 verify: FAIL CLOSED (ran:false, ok:false) when the git diff probe errors", () => {
  const runGit = fakeGit({ diffOk: false });
  const r = verifyChangedFilesWithinWriteScope({
    workspaceDir: "/repo",
    writeScope: ["docs/"],
    runGit
  });
  assert.equal(r.ran, false, "an unrunnable check must read as not-verified");
  assert.equal(r.ok, false, "fail closed: a git error is never a pass");
  assert.equal(r.reason, WRITE_SCOPE_VERIFICATION_REASONS.GIT_UNAVAILABLE);
  assert.equal(r.enforcement.mode, "directory_scope_post_hoc_review");
});

test("WK-1169#SLICE-018 verify: FAIL CLOSED when the ls-files probe errors", () => {
  const runGit = fakeGit({ diff: "docs/a.md\n", lsOk: false });
  const r = verifyChangedFilesWithinWriteScope({
    workspaceDir: "/repo",
    writeScope: ["docs/"],
    runGit
  });
  assert.equal(r.ran, false);
  assert.equal(r.ok, false);
});

test("WK-1169#SLICE-018 collectGitChangedPaths: unions tracked diff + untracked ls-files and throws on a non-ok git result", () => {
  const set = collectGitChangedPaths({
    workspaceDir: "/repo",
    runGit: fakeGit({ diff: "a.mjs\nb.mjs\n", lsFiles: "c.mjs\n" })
  });
  assert.deepEqual([...set].sort(), ["a.mjs", "b.mjs", "c.mjs"]);
  assert.throws(
    () => collectGitChangedPaths({ workspaceDir: "/repo", runGit: fakeGit({ diffOk: false }) }),
    /git diff probe failed/
  );
  assert.throws(
    () => collectGitChangedPaths({ workspaceDir: "", runGit: fakeGit() }),
    /requires a non-empty workspaceDir/
  );
});
