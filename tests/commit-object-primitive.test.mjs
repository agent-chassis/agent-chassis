

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  statSync,
  writeFileSync,
  chmodSync,
  symlinkSync,
  renameSync,
  readdirSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  COMMIT_OBJECT_PRIMITIVE_SCHEMA_VERSION,
  COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES as CODES,
  COMMIT_OBJECT_MATERIALIZE_CONFIG,
  CommitObjectPrimitiveError,
  materializeCommitObject,
  advanceWkRef
} from "../packages/agent-launch-cli/src/lib/commit-object-primitive.mjs";
import { verifyAndMeasureCommitScope } from "../packages/agent-launch-cli/src/lib/commit-scope-envelope.mjs";

function oid(n) {
  return n.toString(16).padStart(40, "0");
}

const ZERO_OID = "0".repeat(40);

const GIT_DIR = "/abs/isolated/.git";
const WORK_TREE = "/abs/wt";
const REF = "refs/heads/wk/IN-0021/WK-1428";

const BASE_SHA = oid(0xba5e);
const REQUIRED_MATERIALIZE_CONFIG_VALUES = Object.freeze([
  "core.autocrlf=false",
  "core.eol=lf",
  "core.symlinks=true",
  "core.hooksPath=",
  "core.fsmonitor="
]);

function splitGitArgs(args) {
  const config = [];
  let i = 0;
  while (args[i] === "-c") {
    config.push(args[i + 1]);
    i += 2;
  }
  return { config, sub: args[i], rest: args.slice(i + 1) };
}

function makeMaterializeGit(spec, calls) {
  return function runGit({ gitDir, workTree, args }) {
    const parsed = splitGitArgs(args);
    calls.push({ gitDir, workTree, ...parsed });
    if (spec.failOn === parsed.sub) {
      return { ok: false, status: 128, stderr: `fatal: forced failure on ${parsed.sub}` };
    }
    switch (parsed.sub) {
      case "config":
        return { ok: false, status: 1, stdout: "", stderr: "" };
      case "read-tree":
        return { ok: true, stdout: "" };
      case "add":
        return { ok: true, stdout: "" };
      case "write-tree":
        return { ok: true, stdout: `${spec.tree}\n` };
      case "commit-tree":
        return { ok: true, stdout: `${spec.commit}\n` };
      default:
        throw new Error(`unexpected materialize git invocation: ${args.join(" ")}`);
    }
  };
}

function expectCode(fn, code, message) {
  assert.throws(
    fn,
    (err) => {
      assert.ok(
        err instanceof CommitObjectPrimitiveError,
        `expected CommitObjectPrimitiveError, got: ${err && err.name}: ${err && err.message}`
      );
      assert.equal(err.code, code, message);
      return true;
    }
  );
}

test("materialize: read-tree(base) -> add -A -> write-tree -> commit-tree(parent=base) under the content-inert config", () => {
  const tree = oid(0x77);
  const commit = oid(0xcc);
  const calls = [];
  const runGit = makeMaterializeGit({ tree, commit }, calls);

  const result = materializeCommitObject({
    gitDir: GIT_DIR,
    workTree: WORK_TREE,
    baseSha: BASE_SHA,
    message: "WK-1428 delivery",
    deps: { runGit }
  });

  assert.deepEqual(result, {
    schema_version: COMMIT_OBJECT_PRIMITIVE_SCHEMA_VERSION,
    tree,
    commit,
    base_sha: BASE_SHA
  });
  assert.ok(Object.isFrozen(result), "materialize result must be frozen");

  assert.deepEqual(
    calls.map((c) => c.sub),
    ["config", "read-tree", "add", "write-tree", "commit-tree"]
  );
  const [, readTree, add, writeTree, commitTree] = calls;
  assert.deepEqual(readTree.rest, [BASE_SHA], "read-tree seeds the index from base_sha's tree (complete delta)");
  assert.deepEqual(add.rest, ["-A"], "add -A stages the COMPLETE worktree delta, never a write_scope subset");
  assert.deepEqual(writeTree.rest, []);
  assert.deepEqual(
    commitTree.rest,
    [tree, "-p", BASE_SHA, "-m", "WK-1428 delivery"],
    "commit-tree writes the tree with parent=base_sha and the message as a single arg"
  );

  const inertValues = REQUIRED_MATERIALIZE_CONFIG_VALUES;
  for (const c of calls) {
    assert.deepEqual(
      c.config.slice(0, inertValues.length),
      inertValues,
      `required content-inert config prefix present on ${c.sub}`
    );
    for (const required of inertValues) {
      assert.ok(c.config.includes(required), `${c.sub} carries ${required}`);
    }
  }
  assert.deepEqual(
    COMMIT_OBJECT_MATERIALIZE_CONFIG.slice(0, inertValues.length * 2),
    inertValues.flatMap((value) => ["-c", value]),
    "exported materialize config must preserve the required -c flags"
  );

  assert.ok(
    commitTree.config.includes("user.name=agent-launch commit primitive"),
    "commit-tree supplies user.name via -c"
  );
  assert.ok(
    commitTree.config.includes("user.email=commit-primitive@agent-launch.local"),
    "commit-tree supplies user.email via -c"
  );

  assert.equal(calls[0].gitDir, GIT_DIR);
  assert.equal(calls[0].workTree, WORK_TREE);
});

test("materialize: honors an injected committer identity", () => {
  const calls = [];
  const runGit = makeMaterializeGit({ tree: oid(1), commit: oid(2) }, calls);
  materializeCommitObject({
    gitDir: GIT_DIR,
    workTree: WORK_TREE,
    baseSha: BASE_SHA,
    message: "m",
    committer: { name: "Alice", email: "alice@example.com" },
    deps: { runGit }
  });
  const commitTree = calls.find((c) => c.sub === "commit-tree");
  assert.ok(commitTree.config.includes("user.name=Alice"));
  assert.ok(commitTree.config.includes("user.email=alice@example.com"));
});

for (const failOn of ["read-tree", "add", "write-tree", "commit-tree"]) {
  test(`materialize: MATERIALIZE_FAILED when git fails at ${failOn}`, () => {
    const runGit = makeMaterializeGit({ tree: oid(1), commit: oid(2), failOn }, []);
    expectCode(
      () =>
        materializeCommitObject({
          gitDir: GIT_DIR,
          workTree: WORK_TREE,
          baseSha: BASE_SHA,
          message: "m",
          deps: { runGit }
        }),
      CODES.MATERIALIZE_FAILED,
      `git failure at ${failOn} must surface MATERIALIZE_FAILED`
    );
  });
}

test("materialize: MATERIALIZE_FAILED when write-tree emits a non-oid tree", () => {
  const runGit = makeMaterializeGit({ tree: "not-a-real-oid", commit: oid(2) }, []);
  expectCode(
    () =>
      materializeCommitObject({
        gitDir: GIT_DIR,
        workTree: WORK_TREE,
        baseSha: BASE_SHA,
        message: "m",
        deps: { runGit }
      }),
    CODES.MATERIALIZE_FAILED,
    "a garbage write-tree output must fail closed, not propagate"
  );
});

test("materialize: MATERIALIZE_FAILED when commit-tree emits a non-oid commit", () => {
  const runGit = makeMaterializeGit({ tree: oid(1), commit: "xyz" }, []);
  expectCode(
    () =>
      materializeCommitObject({
        gitDir: GIT_DIR,
        workTree: WORK_TREE,
        baseSha: BASE_SHA,
        message: "m",
        deps: { runGit }
      }),
    CODES.MATERIALIZE_FAILED
  );
});

test("materialize: rejects a non-oid / zero base_sha", () => {
  const runGit = makeMaterializeGit({ tree: oid(1), commit: oid(2) }, []);
  for (const bad of ["cafe", ZERO_OID, "", 123, null]) {
    expectCode(
      () =>
        materializeCommitObject({
          gitDir: GIT_DIR,
          workTree: WORK_TREE,
          baseSha: bad,
          message: "m",
          deps: { runGit }
        }),
      CODES.INVALID_SHA,
      `base_sha ${JSON.stringify(bad)} must be rejected`
    );
  }
});

test("materialize: rejects empty gitDir / workTree / message", () => {
  const runGit = makeMaterializeGit({ tree: oid(1), commit: oid(2) }, []);
  const base = {
    gitDir: GIT_DIR,
    workTree: WORK_TREE,
    baseSha: BASE_SHA,
    message: "m",
    deps: { runGit }
  };
  expectCode(() => materializeCommitObject({ ...base, gitDir: "" }), CODES.INVALID_ARG);
  expectCode(() => materializeCommitObject({ ...base, workTree: "" }), CODES.INVALID_ARG);
  expectCode(() => materializeCommitObject({ ...base, message: "" }), CODES.INVALID_ARG);
});

test("materialize: rejects an incomplete committer", () => {
  const runGit = makeMaterializeGit({ tree: oid(1), commit: oid(2) }, []);
  const base = {
    gitDir: GIT_DIR,
    workTree: WORK_TREE,
    baseSha: BASE_SHA,
    message: "m",
    deps: { runGit }
  };
  for (const committer of [
    { email: "a@b" },
    { name: "a" },
    { name: "", email: "a@b" },
    { name: "a", email: "" },
    null,
    "nope"
  ]) {
    expectCode(() => materializeCommitObject({ ...base, committer }), CODES.INVALID_ARG);
  }
});

test("materialize: rejects a newline in the committer identity", () => {
  const runGit = makeMaterializeGit({ tree: oid(1), commit: oid(2) }, []);
  const base = {
    gitDir: GIT_DIR,
    workTree: WORK_TREE,
    baseSha: BASE_SHA,
    message: "m",
    deps: { runGit }
  };
  expectCode(
    () => materializeCommitObject({ ...base, committer: { name: "a\nx", email: "a@b" } }),
    CODES.INVALID_ARG
  );
  expectCode(
    () => materializeCommitObject({ ...base, committer: { name: "a", email: "a@b\r" } }),
    CODES.INVALID_ARG
  );
});

function makeAdvanceGit(state, events, opts = {}) {
  return function runGit({ gitDir, args }) {
    const [cmd] = args;
    events.push(`git:${cmd}`);
    if (cmd === "rev-parse") {
      const target = args[args.length - 1];
      if (target.endsWith("^{commit}")) {
        const ref = target.slice(0, -"^{commit}".length);
        const sha = state.refs[ref];
        if (typeof sha === "string" && sha.length > 0) return { ok: true, stdout: `${sha}\n` };
        return { ok: false, status: 1, stdout: "", stderr: "" };
      }
      if (target.endsWith("^{tree}")) {
        const sha = target.slice(0, -"^{tree}".length);
        const c = state.commits[sha];
        if (c) return { ok: true, stdout: `${c.tree}\n` };
        return { ok: false, status: 128, stderr: "fatal: bad object" };
      }
      throw new Error(`unexpected rev-parse target: ${target}`);
    }
    if (cmd === "rev-list") {
      const sha = args[args.length - 1];
      const c = state.commits[sha];
      if (!c) return { ok: false, status: 128, stderr: "fatal: bad object" };
      return { ok: true, stdout: `${sha} ${c.parents.join(" ")}\n` };
    }
    if (cmd === "update-ref") {
      const [, ref, newSha, oldSha] = args;
      if (opts.onUpdateRef) {
        const forced = opts.onUpdateRef({ ref, newSha, oldSha, state });
        if (forced) return forced;
      }
      if (state.refs[ref] === oldSha) {
        state.refs[ref] = newSha;
        return { ok: true, stdout: "" };
      }
      return { ok: false, status: 1, stderr: "fatal: CAS mismatch" };
    }
    throw new Error(`unexpected advance git invocation: ${args.join(" ")}`);
  };
}

const NEW_TREE = oid(0x100);
const NEW_COMMIT = oid(0x101);
const OTHER_TREE = oid(0x102);

test("advance: idempotent replay returns the EXISTING ref-tip commit, never a CAS", () => {

  const existingTip = oid(0x200);
  const state = {
    refs: { [REF]: existingTip },
    commits: { [existingTip]: { tree: NEW_TREE, parents: [BASE_SHA] } }
  };
  const events = [];
  const runGit = makeAdvanceGit(state, events);

  const result = advanceWkRef({
    gitDir: GIT_DIR,
    ref: REF,
    baseSha: BASE_SHA,
    tree: NEW_TREE,
    commit: NEW_COMMIT,
    deps: { runGit }
  });

  assert.deepEqual(result, {
    schema_version: COMMIT_OBJECT_PRIMITIVE_SCHEMA_VERSION,
    ref: REF,
    base_sha: BASE_SHA,
    tree: NEW_TREE,
    commit: existingTip,
    idempotent: true
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(!events.includes("git:update-ref"), "idempotent replay must short-circuit BEFORE the CAS");
  assert.equal(state.refs[REF], existingTip, "the ref tip must be left untouched");
});

test("advance: REF_ADVANCE_CONFLICT for a same-base different-tree sibling tip, never a clobber", () => {
  const siblingTip = oid(0x300);
  const state = {
    refs: { [REF]: siblingTip },
    commits: { [siblingTip]: { tree: OTHER_TREE, parents: [BASE_SHA] } }
  };
  const events = [];
  const runGit = makeAdvanceGit(state, events);

  expectCode(
    () =>
      advanceWkRef({
        gitDir: GIT_DIR,
        ref: REF,
        baseSha: BASE_SHA,
        tree: NEW_TREE,
        commit: NEW_COMMIT,
        deps: { runGit }
      }),
    CODES.REF_ADVANCE_CONFLICT
  );
  assert.ok(!events.includes("git:update-ref"), "a sibling conflict must not attempt a clobbering CAS");
  assert.equal(state.refs[REF], siblingTip, "the sibling tip must be left untouched");
});

test("advance: happy CAS advance updates the ref old==current-tip -> new commit", () => {

  const state = {
    refs: { [REF]: BASE_SHA },
    commits: { [BASE_SHA]: { tree: oid(0x400), parents: [oid(0x401)] } }
  };
  const events = [];
  const runGit = makeAdvanceGit(state, events);

  const result = advanceWkRef({
    gitDir: GIT_DIR,
    ref: REF,
    baseSha: BASE_SHA,
    tree: NEW_TREE,
    commit: NEW_COMMIT,
    deps: { runGit }
  });

  assert.deepEqual(result, {
    schema_version: COMMIT_OBJECT_PRIMITIVE_SCHEMA_VERSION,
    ref: REF,
    base_sha: BASE_SHA,
    tree: NEW_TREE,
    commit: NEW_COMMIT,
    idempotent: false
  });
  assert.ok(events.includes("git:update-ref"));
  assert.equal(state.refs[REF], NEW_COMMIT, "the ref must advance to the new commit");
});

test("advance: lost CAS race re-evaluates to idempotent when the new tip is this delivery", () => {
  const raceTip = oid(0x500);
  const state = {
    refs: { [REF]: BASE_SHA },
    commits: {
      [BASE_SHA]: { tree: oid(0x501), parents: [oid(0x502)] },
      [raceTip]: { tree: NEW_TREE, parents: [BASE_SHA] }
    }
  };
  const events = [];
  const runGit = makeAdvanceGit(state, events, {

    onUpdateRef: ({ ref }) => {
      state.refs[ref] = raceTip;
      return { ok: false, status: 1, stderr: "lost race" };
    }
  });

  const result = advanceWkRef({
    gitDir: GIT_DIR,
    ref: REF,
    baseSha: BASE_SHA,
    tree: NEW_TREE,
    commit: NEW_COMMIT,
    deps: { runGit }
  });

  assert.equal(result.idempotent, true);
  assert.equal(result.commit, raceTip, "must return the concurrently-landed tip commit, not our materialized sha");
});

test("advance: lost CAS race re-evaluates to REF_ADVANCE_CONFLICT for a same-base sibling", () => {
  const raceTip = oid(0x600);
  const state = {
    refs: { [REF]: BASE_SHA },
    commits: {
      [BASE_SHA]: { tree: oid(0x601), parents: [oid(0x602)] },
      [raceTip]: { tree: OTHER_TREE, parents: [BASE_SHA] }
    }
  };
  const events = [];
  const runGit = makeAdvanceGit(state, events, {
    onUpdateRef: ({ ref }) => {
      state.refs[ref] = raceTip;
      return { ok: false, status: 1, stderr: "lost race" };
    }
  });

  expectCode(
    () =>
      advanceWkRef({
        gitDir: GIT_DIR,
        ref: REF,
        baseSha: BASE_SHA,
        tree: NEW_TREE,
        commit: NEW_COMMIT,
        deps: { runGit }
      }),
    CODES.REF_ADVANCE_CONFLICT
  );
});

test("advance: lost CAS race surfaces REF_ADVANCE_FAILED when the tip moved past base", () => {

  const raceTip = oid(0x700);
  const state = {
    refs: { [REF]: BASE_SHA },
    commits: {
      [BASE_SHA]: { tree: oid(0x701), parents: [oid(0x702)] },
      [raceTip]: { tree: OTHER_TREE, parents: [oid(0x703)] }
    }
  };
  const events = [];
  const runGit = makeAdvanceGit(state, events, {
    onUpdateRef: ({ ref }) => {
      state.refs[ref] = raceTip;
      return { ok: false, status: 1, stderr: "lost race" };
    }
  });

  expectCode(
    () =>
      advanceWkRef({
        gitDir: GIT_DIR,
        ref: REF,
        baseSha: BASE_SHA,
        tree: NEW_TREE,
        commit: NEW_COMMIT,
        deps: { runGit }
      }),
    CODES.REF_ADVANCE_FAILED
  );
});

test("advance: rejects a non-allowlisted ref (defense-in-depth)", () => {
  const runGit = makeAdvanceGit({ refs: {}, commits: {} }, []);
  for (const bad of [
    "refs/heads/main",
    "refs/heads/integration/IN-0021",
    "refs/heads/wk/IN-0021/WK-1428/extra",
    "refs/heads/wk/IN-21/WK-1428",
    "wk/IN-0021/WK-1428",
    ""
  ]) {
    expectCode(
      () =>
        advanceWkRef({
          gitDir: GIT_DIR,
          ref: bad,
          baseSha: BASE_SHA,
          tree: NEW_TREE,
          commit: NEW_COMMIT,
          deps: { runGit }
        }),
      CODES.INVALID_REF,
      `ref ${JSON.stringify(bad)} must be refused before touching the ref store`
    );
  }
});

test("advance: REF_TIP_UNRESOLVABLE when the per-WK ref does not exist", () => {
  const runGit = makeAdvanceGit({ refs: {}, commits: {} }, []);
  expectCode(
    () =>
      advanceWkRef({
        gitDir: GIT_DIR,
        ref: REF,
        baseSha: BASE_SHA,
        tree: NEW_TREE,
        commit: NEW_COMMIT,
        deps: { runGit }
      }),
    CODES.REF_TIP_UNRESOLVABLE
  );
});

test("advance: REF_TIP_UNRESOLVABLE when the ref resolves to the zero oid", () => {
  const state = { refs: { [REF]: ZERO_OID }, commits: {} };
  const runGit = makeAdvanceGit(state, []);
  expectCode(
    () =>
      advanceWkRef({
        gitDir: GIT_DIR,
        ref: REF,
        baseSha: BASE_SHA,
        tree: NEW_TREE,
        commit: NEW_COMMIT,
        deps: { runGit }
      }),
    CODES.REF_TIP_UNRESOLVABLE
  );
});

test("advance: rejects a zero / non-oid base_sha, tree, or commit", () => {
  const runGit = makeAdvanceGit({ refs: { [REF]: BASE_SHA }, commits: {} }, []);
  const base = {
    gitDir: GIT_DIR,
    ref: REF,
    baseSha: BASE_SHA,
    tree: NEW_TREE,
    commit: NEW_COMMIT,
    deps: { runGit }
  };
  expectCode(() => advanceWkRef({ ...base, baseSha: ZERO_OID }), CODES.INVALID_SHA);
  expectCode(() => advanceWkRef({ ...base, tree: ZERO_OID }), CODES.INVALID_SHA);
  expectCode(() => advanceWkRef({ ...base, commit: ZERO_OID }), CODES.INVALID_SHA);
  for (const field of ["baseSha", "tree", "commit"]) {
    expectCode(
      () => advanceWkRef({ ...base, [field]: "nope" }),
      CODES.INVALID_SHA,
      `${field} must reject a non-oid value`
    );
  }
});

test("advance: rejects an empty gitDir", () => {
  const runGit = makeAdvanceGit({ refs: { [REF]: BASE_SHA }, commits: {} }, []);
  expectCode(
    () =>
      advanceWkRef({
        gitDir: "",
        ref: REF,
        baseSha: BASE_SHA,
        tree: NEW_TREE,
        commit: NEW_COMMIT,
        deps: { runGit }
      }),
    CODES.INVALID_ARG
  );
});

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: cwd,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t.local",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t.local"
    }
  });
}

function initRepo() {
  const repo = mkdtempSync(join(tmpdir(), "commit-object-real-git-"));
  git(repo, ["init", "-q", "--initial-branch=main"]);
  git(repo, ["config", "commit.gpgsign", "false"]);

  git(repo, ["config", "core.fileMode", "true"]);
  git(repo, ["config", "core.symlinks", "true"]);
  return repo;
}

function prefixResolveWriteScope(writeScope) {
  return {
    matches(relPath) {
      return writeScope.some(
        (s) => relPath === s || relPath.startsWith(s.endsWith("/") ? s : `${s}/`)
      );
    }
  };
}

test("materialize (real git): NEVER touches the real index — bytes, mtime, and porcelain status unchanged", () => {
  const repo = initRepo();
  try {

    writeFileSync(join(repo, "keep.txt"), "v1\n");
    writeFileSync(join(repo, "del.txt"), "delete me\n");
    writeFileSync(join(repo, "old-name.txt"), "rename payload that is long enough for similarity detection\n");
    writeFileSync(join(repo, "exec-me.txt"), "#!/bin/sh\necho hi\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "base"]);
    const baseSha = git(repo, ["rev-parse", "HEAD"]).trim();

    writeFileSync(join(repo, "keep.txt"), "v2\n");
    rmSync(join(repo, "del.txt"));
    renameSync(join(repo, "old-name.txt"), join(repo, "new-name.txt"));
    chmodSync(join(repo, "exec-me.txt"), 0o755);
    writeFileSync(join(repo, "added.txt"), "brand new\n");
    symlinkSync("keep.txt", join(repo, "link"));

    const indexPath = join(repo, ".git", "index");

    const statusBefore = git(repo, ["status", "--porcelain"]);
    const indexBytesBefore = readFileSync(indexPath);
    const indexMtimeBefore = statSync(indexPath).mtimeMs;

    const result = materializeCommitObject({
      gitDir: join(repo, ".git"),
      workTree: repo,
      baseSha,
      message: "WK-1428 delivery (real git)"
    });

    const indexBytesAfter = readFileSync(indexPath);
    const indexMtimeAfter = statSync(indexPath).mtimeMs;
    const statusAfter = git(repo, ["status", "--porcelain"]);

    assert.ok(
      indexBytesBefore.equals(indexBytesAfter),
      "the operator's real .git/index must be byte-for-byte unchanged by materialization"
    );
    assert.equal(indexMtimeAfter, indexMtimeBefore, "the real .git/index mtime must be unchanged");
    assert.equal(statusAfter, statusBefore, "`git status --porcelain` must be identical before and after");

    assert.equal(result.base_sha, baseSha);
    assert.match(result.tree, /^[0-9a-f]{40}$/);
    assert.match(result.commit, /^[0-9a-f]{40}$/);

    assert.ok(
      !readdirSync(join(repo, ".git")).includes("index.lock"),
      "no stray index lock left in the real .git"
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("materialize (real git): the produced tree still captures the COMPLETE delta vs base_sha", () => {
  const repo = initRepo();
  try {
    writeFileSync(join(repo, "keep.txt"), "v1\n");
    writeFileSync(join(repo, "del.txt"), "delete me\n");
    writeFileSync(join(repo, "old-name.txt"), "rename payload that is long enough for similarity detection\n");
    writeFileSync(join(repo, "exec-me.txt"), "#!/bin/sh\necho hi\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "base"]);
    const baseSha = git(repo, ["rev-parse", "HEAD"]).trim();

    writeFileSync(join(repo, "keep.txt"), "v2\n");
    rmSync(join(repo, "del.txt"));
    renameSync(join(repo, "old-name.txt"), join(repo, "new-name.txt"));
    chmodSync(join(repo, "exec-me.txt"), 0o755);
    writeFileSync(join(repo, "added.txt"), "brand new\n");
    symlinkSync("keep.txt", join(repo, "link"));

    const { commit, tree } = materializeCommitObject({
      gitDir: join(repo, ".git"),
      workTree: repo,
      baseSha,
      message: "complete-delta check"
    });

    const nameStatus = git(repo, ["diff-tree", "-r", "-M", "--name-status", baseSha, commit])
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
    const byPath = new Map();
    for (const line of nameStatus) {
      const cols = line.split("\t");
      byPath.set(cols[cols.length - 1], { status: cols[0], src: cols.length === 3 ? cols[1] : null });
    }

    assert.equal(byPath.get("added.txt")?.status, "A", "added file present as A");
    assert.equal(byPath.get("keep.txt")?.status, "M", "modified file present as M");
    assert.equal(byPath.get("del.txt")?.status, "D", "deleted file present as D");
    assert.equal(byPath.get("link")?.status, "A", "added symlink present as A");
    const rename = byPath.get("new-name.txt");
    assert.ok(rename && rename.status.startsWith("R"), "rename detected to new-name.txt");
    assert.equal(rename.src, "old-name.txt", "rename source is old-name.txt");

    const lsTree = git(repo, ["ls-tree", "-r", tree]).trim().split("\n");
    const modeByPath = new Map();
    for (const line of lsTree) {
      const [meta, path] = line.split("\t");
      modeByPath.set(path, meta.split(" ")[0]);
    }
    assert.equal(modeByPath.get("link"), "120000", "symlink recorded as mode 120000, not a regular blob");
    assert.equal(modeByPath.get("exec-me.txt"), "100755", "mode change recorded as 100755");
    assert.equal(modeByPath.get("added.txt"), "100644", "added regular file recorded as 100644");
    assert.ok(!modeByPath.has("del.txt"), "deleted file absent from the materialized tree");
    assert.ok(!modeByPath.has("old-name.txt"), "renamed-away path absent from the materialized tree");

    assert.equal(git(repo, ["cat-file", "-p", `${commit}:link`]), "keep.txt");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("materialize (real git): isolation keeps the write_scope containment gate non-vacuous (an out-of-scope sibling is caught)", () => {
  const repo = initRepo();
  try {
    writeFileSync(join(repo, "seed.txt"), "seed\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "base"]);
    const baseSha = git(repo, ["rev-parse", "HEAD"]).trim();

    mkdirSync(join(repo, "allowed"));
    writeFileSync(join(repo, "allowed", "in.txt"), "in scope\n");
    writeFileSync(join(repo, "rogue.txt"), "out of scope sibling\n");

    const { commit, tree } = materializeCommitObject({
      gitDir: join(repo, ".git"),
      workTree: repo,
      baseSha,
      message: "containment non-vacuous check"
    });

    const verdict = verifyAndMeasureCommitScope({
      gitDir: join(repo, ".git"),
      baseSha,
      commit,
      tree,
      writeScope: ["allowed/"],
      deps: { resolveWriteScope: prefixResolveWriteScope }
    });

    assert.equal(verdict.contained, false, "the out-of-scope sibling must fail containment");
    assert.ok(
      verdict.refusal && verdict.refusal.out_of_scope.includes("rogue.txt"),
      "the materialized object still carries the out-of-scope sibling write (gate is non-vacuous)"
    );
    assert.ok(
      !verdict.refusal.out_of_scope.includes("allowed/in.txt"),
      "the in-scope write is not flagged out of scope"
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

function enableSparseCone(repo, cone, indexSparse) {
  git(repo, ["sparse-checkout", "init", "--cone", indexSparse ? "--sparse-index" : "--no-sparse-index"]);
  git(repo, ["sparse-checkout", "set", "--cone", indexSparse ? "--sparse-index" : "--no-sparse-index", "--", cone]);
  git(repo, ["config", "--worktree", "index.sparse", String(indexSparse)]);
}

for (const indexSparse of [false, true]) {
  test(`materialize (real git): sparse-index=${indexSparse} preserves out-of-cone base paths and captures the complete cone delta`, () => {
    const repo = initRepo();
    try {
      mkdirSync(join(repo, "cone"));
      mkdirSync(join(repo, "outside"));
      writeFileSync(join(repo, "root.txt"), "root-v1\n");
      writeFileSync(join(repo, "cone", "keep.txt"), "keep-v1\n");
      writeFileSync(join(repo, "cone", "delete.txt"), "delete\n");
      writeFileSync(join(repo, "outside", "preserve.txt"), "outside\n");
      git(repo, ["add", "-A"]);
      git(repo, ["commit", "-qm", "base"]);
      const baseSha = git(repo, ["rev-parse", "HEAD"]).trim();

      enableSparseCone(repo, "cone", indexSparse);
      assert.equal(statSync(join(repo, "outside"), { throwIfNoEntry: false }), undefined, "outside directory is not materialized");
      writeFileSync(join(repo, "root.txt"), "root-v2\n");
      writeFileSync(join(repo, "cone", "keep.txt"), "keep-v2\n");
      chmodSync(join(repo, "cone", "keep.txt"), 0o755);
      writeFileSync(join(repo, "cone", "added.txt"), "added\n");
      rmSync(join(repo, "cone", "delete.txt"));

      const result = materializeCommitObject({
        gitDir: join(repo, ".git"),
        workTree: repo,
        baseSha,
        sparseBinding: { base_sha: baseSha, cone_dirs: ["cone"], index_sparse: indexSparse },
        message: `sparse-index=${indexSparse}`
      });
      const paths = git(repo, ["ls-tree", "-r", "--name-only", result.tree]).trim().split("\n");
      assert.ok(paths.includes("outside/preserve.txt"), "an absent out-of-cone base path is preserved");
      assert.equal(git(repo, ["cat-file", "-p", `${result.tree}:outside/preserve.txt`]), "outside\n");
      assert.ok(!paths.includes("cone/delete.txt"), "an in-cone deletion is captured");
      assert.equal(git(repo, ["cat-file", "-p", `${result.tree}:cone/keep.txt`]), "keep-v2\n");
      assert.match(git(repo, ["ls-tree", result.tree, "--", "cone/keep.txt"]), /^100755 /u, "in-cone mode change is captured");
      assert.equal(git(repo, ["cat-file", "-p", `${result.tree}:cone/added.txt`]), "added\n");
      assert.equal(git(repo, ["cat-file", "-p", `${result.tree}:root.txt`]), "root-v2\n", "cone-mode root file is captured");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
}

test("materialize (real git): sparse root and ancestor paths use literal pathspec semantics", () => {
  const repo = initRepo();
  try {
    mkdirSync(join(repo, "parent", "cone"), { recursive: true });
    mkdirSync(join(repo, "outside"));
    writeFileSync(join(repo, ":(exclude)root.txt"), "root-v1\n");
    writeFileSync(join(repo, "parent", "[ancestor].txt"), "ancestor-v1\n");
    writeFileSync(join(repo, "parent", "cone", "keep.txt"), "keep\n");
    writeFileSync(join(repo, "outside", "preserve.txt"), "outside\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "base"]);
    const baseSha = git(repo, ["rev-parse", "HEAD"]).trim();

    enableSparseCone(repo, "parent/cone", false);
    writeFileSync(join(repo, ":(exclude)root.txt"), "root-v2\n");
    writeFileSync(join(repo, "parent", "[ancestor].txt"), "ancestor-v2\n");

    const { tree } = materializeCommitObject({
      gitDir: join(repo, ".git"), workTree: repo, baseSha,
      sparseBinding: { base_sha: baseSha, cone_dirs: ["parent/cone"], index_sparse: false },
      message: "literal sparse paths"
    });

    assert.equal(git(repo, ["cat-file", "-p", `${tree}::(exclude)root.txt`]), "root-v2\n");
    assert.equal(git(repo, ["cat-file", "-p", `${tree}:parent/[ancestor].txt`]), "ancestor-v2\n");
    assert.equal(git(repo, ["cat-file", "-p", `${tree}:outside/preserve.txt`]), "outside\n");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("materialize (real git): sparse worktrees fail closed without a compatible WK-1518 binding", () => {
  const repo = initRepo();
  try {
    mkdirSync(join(repo, "cone"));
    writeFileSync(join(repo, "cone", "file.txt"), "base\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "base"]);
    const baseSha = git(repo, ["rev-parse", "HEAD"]).trim();
    enableSparseCone(repo, "cone", false);

    expectCode(
      () => materializeCommitObject({ gitDir: join(repo, ".git"), workTree: repo, baseSha, message: "missing binding" }),
      CODES.SPARSE_BINDING_REQUIRED
    );
    expectCode(
      () => materializeCommitObject({
        gitDir: join(repo, ".git"),
        workTree: repo,
        baseSha,
        sparseBinding: { base_sha: oid(999), cone_dirs: ["cone"], index_sparse: false },
        message: "wrong base"
      }),
      CODES.SPARSE_BINDING_INCOMPATIBLE
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("materialize (real git): sparse cone remains broader than write_scope so containment is non-vacuous", () => {
  const repo = initRepo();
  try {
    mkdirSync(join(repo, "cone"));
    writeFileSync(join(repo, "cone", "allowed.txt"), "base\n");
    writeFileSync(join(repo, "cone", "rogue.txt"), "base\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "base"]);
    const baseSha = git(repo, ["rev-parse", "HEAD"]).trim();
    enableSparseCone(repo, "cone", false);
    writeFileSync(join(repo, "cone", "allowed.txt"), "allowed\n");
    writeFileSync(join(repo, "cone", "rogue.txt"), "rogue\n");

    const { commit, tree } = materializeCommitObject({
      gitDir: join(repo, ".git"), workTree: repo, baseSha,
      sparseBinding: { base_sha: baseSha, cone_dirs: ["cone"], index_sparse: false },
      message: "non-vacuous sparse gate"
    });
    const verdict = verifyAndMeasureCommitScope({
      gitDir: join(repo, ".git"), baseSha, commit, tree,
      writeScope: ["cone/allowed.txt"],
      deps: { resolveWriteScope: prefixResolveWriteScope }
    });
    assert.equal(verdict.contained, false);
    assert.deepEqual(verdict.refusal.out_of_scope, ["cone/rogue.txt"]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("materialize (real git): refuses a rename from inside the cone to outside it", () => {
  const repo = initRepo();
  try {
    mkdirSync(join(repo, "cone"));
    mkdirSync(join(repo, "outside"));
    writeFileSync(join(repo, "cone", "source.txt"), "rename payload long enough for exact detection\n");
    writeFileSync(join(repo, "outside", "keep.txt"), "keep\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "base"]);
    const baseSha = git(repo, ["rev-parse", "HEAD"]).trim();
    enableSparseCone(repo, "cone", false);
    mkdirSync(join(repo, "outside"));
    renameSync(join(repo, "cone", "source.txt"), join(repo, "outside", "destination.txt"));

    expectCode(
      () => materializeCommitObject({
        gitDir: join(repo, ".git"), workTree: repo, baseSha,
        sparseBinding: { base_sha: baseSha, cone_dirs: ["cone"], index_sparse: false },
        message: "cross-cone rename"
      }),
      CODES.CROSS_CONE_RENAME
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("materialize (real git): refuses a copy from outside the cone to inside it", () => {
  const repo = initRepo();
  try {
    mkdirSync(join(repo, "cone"));
    mkdirSync(join(repo, "outside"));
    writeFileSync(join(repo, "cone", "keep.txt"), "keep\n");
    writeFileSync(join(repo, "outside", "source.txt"), "rename payload long enough for exact detection\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "base"]);
    const baseSha = git(repo, ["rev-parse", "HEAD"]).trim();
    enableSparseCone(repo, "cone", true);
    writeFileSync(join(repo, "cone", "destination.txt"), git(repo, ["show", `${baseSha}:outside/source.txt`]));

    expectCode(
      () => materializeCommitObject({
        gitDir: join(repo, ".git"), workTree: repo, baseSha,
        sparseBinding: { base_sha: baseSha, cone_dirs: ["cone"], index_sparse: true },
        message: "cross-cone copy"
      }),
      CODES.CROSS_CONE_RENAME
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("materialize (real git): refuses a below-threshold rename across the cone", () => {
  const repo = initRepo();
  try {
    mkdirSync(join(repo, "cone"));
    mkdirSync(join(repo, "outside"));
    const retained = "retained provenance marker 0123456789\n";
    writeFileSync(join(repo, "cone", "source.txt"), `${retained}${"old source line\n".repeat(40)}`);
    writeFileSync(join(repo, "outside", "keep.txt"), "keep\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "base"]);
    const baseSha = git(repo, ["rev-parse", "HEAD"]).trim();
    enableSparseCone(repo, "cone", false);
    mkdirSync(join(repo, "outside"));
    rmSync(join(repo, "cone", "source.txt"));
    writeFileSync(join(repo, "outside", "destination.txt"), `${retained}${"rewritten destination line\n".repeat(40)}`);

    expectCode(
      () => materializeCommitObject({
        gitDir: join(repo, ".git"), workTree: repo, baseSha,
        sparseBinding: { base_sha: baseSha, cone_dirs: ["cone"], index_sparse: false },
        message: "below-threshold cross-cone rename"
      }),
      CODES.CROSS_CONE_RENAME
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("materialize (real git): refuses a below-threshold copy into the cone", () => {
  const repo = initRepo();
  try {
    mkdirSync(join(repo, "cone"));
    mkdirSync(join(repo, "outside"));
    const retained = "retained provenance marker 0123456789\n";
    writeFileSync(join(repo, "cone", "keep.txt"), "keep\n");
    writeFileSync(join(repo, "outside", "source.txt"), `${retained}${"old source line\n".repeat(40)}`);
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "base"]);
    const baseSha = git(repo, ["rev-parse", "HEAD"]).trim();
    enableSparseCone(repo, "cone", true);
    writeFileSync(join(repo, "cone", "destination.txt"), `${retained}${"rewritten destination line\n".repeat(40)}`);

    expectCode(
      () => materializeCommitObject({
        gitDir: join(repo, ".git"), workTree: repo, baseSha,
        sparseBinding: { base_sha: baseSha, cone_dirs: ["cone"], index_sparse: true },
        message: "below-threshold cross-cone copy"
      }),
      CODES.CROSS_CONE_RENAME
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
