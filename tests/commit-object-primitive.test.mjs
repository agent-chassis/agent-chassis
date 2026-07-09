

import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMIT_OBJECT_PRIMITIVE_SCHEMA_VERSION,
  COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES as CODES,
  COMMIT_OBJECT_MATERIALIZE_CONFIG,
  CommitObjectPrimitiveError,
  materializeCommitObject,
  advanceWkRef
} from "../packages/agent-launch-cli/src/lib/commit-object-primitive.mjs";

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
    ["read-tree", "add", "write-tree", "commit-tree"]
  );
  const [readTree, add, writeTree, commitTree] = calls;
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
