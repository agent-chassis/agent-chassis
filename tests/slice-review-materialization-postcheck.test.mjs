

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  defaultSliceReviewRunGit,
  prepareSliceReviewSurface,
  SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES,
  SLICE_REVIEW_POSTCHECK_STATE_BUDGET
} from "../packages/agent-launch-cli/src/lib/slice-review-materialization.mjs";
import {
  SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION
} from "../packages/agent-launch-cli/src/lib/trusted-operation-contracts.mjs";

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";
process.env.GIT_AUTHOR_NAME = "t";
process.env.GIT_AUTHOR_EMAIL = "t@t.local";
process.env.GIT_COMMITTER_NAME = "t";
process.env.GIT_COMMITTER_EMAIL = "t@t.local";

const INITIATIVE = "IN-0030";
const RECORD_ID = "WK-1691";
const SLICE_ID = "SLICE-001";
const ASSIGNED_UNIT = `${RECORD_ID}#${SLICE_ID}`;
const BASE_REF = `wk/${INITIATIVE}/${RECORD_ID}`;
const SLICE_BRANCH = `slice/${INITIATIVE}/${RECORD_ID}/${SLICE_ID}`;
const SLICE_REF = `refs/heads/${SLICE_BRANCH}`;
const WORKTREE_DIR = `slice-${INITIATIVE}-${RECORD_ID}-${SLICE_ID}`;
const LAUNCH_REF = `refs/agent-launch/wk-1691/slice-001`;
const RUN_ID = "wkdb_1691slice001";
const DIGEST = `sha256:${"a".repeat(64)}`;
const CODES = SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function createFixture(t, { indexAt = "reviewed", symlinkedObjects = false } = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "slice-review-postcheck-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const mainRepo = path.join(root, "main");
  mkdirSync(mainRepo);
  git(mainRepo, ["init", "-q", "--initial-branch=main"]);
  git(mainRepo, ["config", "commit.gpgsign", "false"]);
  writeFileSync(path.join(mainRepo, "seed.txt"), "seed\n");
  git(mainRepo, ["add", "-A"]);
  git(mainRepo, ["commit", "-qm", "seed"]);

  git(mainRepo, ["branch", BASE_REF]);
  const baseSha = git(mainRepo, ["rev-parse", BASE_REF]).trim();
  git(mainRepo, ["branch", SLICE_BRANCH, BASE_REF]);

  const otherWorktree = path.join(root, "other-worktree");
  git(mainRepo, ["branch", "other"]);
  git(mainRepo, ["worktree", "add", "-q", otherWorktree, "other"]);

  writeFileSync(path.join(otherWorktree, "unrelated.txt"), "unrelated\n");
  git(otherWorktree, ["add", "-A"]);
  git(otherWorktree, ["commit", "-qm", "unrelated"]);
  const otherSha = git(otherWorktree, ["rev-parse", "HEAD"]).trim();

  const worktreePath = path.join(root, WORKTREE_DIR);
  git(mainRepo, ["worktree", "add", "-q", worktreePath, SLICE_BRANCH]);
  writeFileSync(path.join(worktreePath, "src.txt"), "slice delivery\n");
  git(worktreePath, ["add", "-A"]);
  git(worktreePath, ["commit", "-qm", "slice delivery"]);
  const reviewedSha = git(worktreePath, ["rev-parse", "HEAD"]).trim();
  const reviewedTree = git(worktreePath, ["rev-parse", "HEAD^{tree}"]).trim();
  const baseTree = git(worktreePath, ["rev-parse", `${baseSha}^{tree}`]).trim();
  const gitDir = path.join(mainRepo, ".git", "worktrees", WORKTREE_DIR);

  if (indexAt === "base") git(worktreePath, ["read-tree", baseSha]);

  if (symlinkedObjects) {
    const objects = path.join(mainRepo, ".git", "objects");
    renameSync(objects, path.join(mainRepo, ".git", "objects-a"));
    cpSync(path.join(mainRepo, ".git", "objects-a"), path.join(mainRepo, ".git", "objects-b"), {
      recursive: true
    });
    symlinkSync(path.join(mainRepo, ".git", "objects-a"), objects);
  }

  return {
    root,
    mainRepo,
    worktreePath,
    otherWorktree,
    gitDir,
    baseSha,
    baseTree,
    otherSha,
    reviewedSha,
    reviewedTree,
    objectsDir: path.join(mainRepo, ".git", "objects"),
    binding(overrides = {}) {
      return {
        schema_version: "worktree-identity-binding.v2",
        launch_ref: LAUNCH_REF,
        run_id: `${RUN_ID}.slice`,
        retry_id: 0,
        unit_address: `${INITIATIVE}/${RECORD_ID}/${SLICE_ID}`,
        initiative: INITIATIVE,
        record_id: RECORD_ID,
        slice_id: SLICE_ID,
        base_ref: BASE_REF,
        base_sha: baseSha,
        output_branch: SLICE_BRANCH,
        worktree_path: worktreePath,
        read_scope: [],
        repo_paths: ["src.txt"],
        write_scope: ["src.txt"],
        write_scope_source: `wiki/work-records/${RECORD_ID}.json#${SLICE_ID}`,
        selected_unit: {
          kind: "slice",
          address: ASSIGNED_UNIT,
          record_id: RECORD_ID,
          slice_id: SLICE_ID,
          repo: null
        },
        source_digest: `sha256:${"0".repeat(64)}`,
        source_version: null,
        checkout_mode: "full",
        ...overrides
      };
    }
  };
}

function makeDeps(fx, { mutate = null, binding = null, digest = null } = {}) {
  const state = { fired: false, bindingCalls: 0, digestCalls: 0 };
  const deps = {
    resolveWorktreeBinding: () => {
      state.bindingCalls += 1;
      return binding ? binding(state.bindingCalls) : fx.binding();
    },
    digestWorktreeIdentity: () => {
      state.digestCalls += 1;
      return digest ? digest(state.digestCalls) : DIGEST;
    },
    runGit: (options) => {
      const result = defaultSliceReviewRunGit(options);
      if (!state.fired && mutate &&
          options.indexFile == null && options.args?.[0] === "write-tree") {
        state.fired = true;
        mutate();
      }
      return result;
    }
  };
  return { deps, state };
}

function prepare(fx, deps) {
  return prepareSliceReviewSurface({
    mainRepo: fx.mainRepo,
    assignedUnit: ASSIGNED_UNIT,
    launchRef: LAUNCH_REF,
    runId: RUN_ID,
    retryId: 0,
    deps
  });
}

async function expectRefusal(fx, options, { code, field = null, detail = null }) {
  const { deps, state } = makeDeps(fx, options);
  const error = await prepare(fx, deps).then(
    () => null,
    (thrown) => thrown
  );
  assert.ok(error, "preparation must fail closed");
  assert.equal(error.name, "SliceReviewMaterializationError");
  assert.equal(error.code, code, `unexpected code for ${error.message}`);
  if (field) {
    assert.ok(
      SLICE_REVIEW_POSTCHECK_STATE_BUDGET.bound_fields.includes(error.detail?.field),
      `mismatch must name a bound field; got ${JSON.stringify(error.detail ?? null)}`
    );
    assert.equal(error.detail.field, field);
  }
  if (detail) assert.deepEqual({ ...error.detail }, detail);
  if (options?.mutate) assert.equal(state.fired, true, "the mid-flight mutation must have run");
  return error;
}

async function expectTolerated(fx, options) {
  const { deps, state } = makeDeps(fx, options);
  const result = await prepare(fx, deps);
  if (options?.mutate) assert.equal(state.fired, true, "the mid-flight mutation must have run");
  assert.equal(result.schema_version, SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION);
  assert.equal(result.reviewed_sha, fx.reviewedSha);
  assert.equal(result.reviewed_tree, fx.reviewedTree);
  assert.equal(result.slice_ref, SLICE_REF);
  return result;
}

test("the postcheck state budget is closed, frozen, and classifies pseudorefs explicitly", () => {
  const budget = SLICE_REVIEW_POSTCHECK_STATE_BUDGET;
  assert.equal(Object.isFrozen(budget), true);
  assert.equal(budget.schema_version, "slice-review-postcheck-state-budget.v1");
  for (const key of ["bound_fields", "bound_refs", "refused_pseudorefs", "unbound"]) {
    assert.equal(Object.isFrozen(budget[key]), true, `${key} must be frozen`);
  }
  assert.deepEqual([...budget.bound_fields], [
    "worktreeIdentityDigest",
    "canonicalWorktreePath",
    "gitDir",
    "commonDirectory",
    "objectDirectory",
    "objectAlternates",
    "targetRegistration",
    "sliceRef",
    "headSymbolicRef",
    "headSha",
    "reviewedSha",
    "reviewedTree",
    "baseSha",
    "baseTree",
    "sequencerState"
  ]);
  assert.deepEqual([...budget.refused_pseudorefs], [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "REBASE_HEAD",
    "BISECT_HEAD",
    "AUTO_MERGE"
  ]);

  assert.ok(budget.unbound.includes("ORIG_HEAD"));
  assert.ok(budget.unbound.includes("FETCH_HEAD"));
  assert.equal(budget.refused_pseudorefs.includes("ORIG_HEAD"), false);
  assert.equal(budget.bound_fields.includes("refsSnapshot"), false,
    "a repository-global ref snapshot is no longer bound state");
  assert.equal(budget.bound_fields.includes("registrationRaw"), false,
    "the raw all-worktree registration listing is no longer bound state");
});

test("an untouched retained slice worktree prepares from the already-aligned index", async (t) => {
  const fx = createFixture(t);
  const result = await expectTolerated(fx, {});
  assert.equal(result.assigned_unit, ASSIGNED_UNIT);
  assert.equal(result.run_id, RUN_ID);
  assert.equal(result.base_sha, fx.baseSha);
  assert.equal(result.worktree_path, fx.worktreePath);
  assert.equal(result.worktree_identity_digest, DIGEST);
});

test("an untouched retained slice worktree prepares from the base-tree index", async (t) => {
  const fx = createFixture(t, { indexAt: "base" });
  await expectTolerated(fx, {});
  assert.equal(git(fx.worktreePath, ["write-tree"]).trim(), fx.reviewedTree);
});

test("concurrent unregistered ref churn does not invalidate the review surface", async (t) => {
  const fx = createFixture(t);
  await expectTolerated(fx, {
    mutate: () => {

      git(fx.mainRepo, ["update-ref", "refs/heads/unrelated", fx.baseSha]);
      git(fx.mainRepo, ["update-ref", "refs/heads/unrelated", fx.reviewedSha]);
      git(fx.mainRepo, ["tag", "unrelated-tag", fx.reviewedSha]);
      git(fx.mainRepo, ["update-ref", "refs/agent-launch/unrelated", fx.baseSha]);
      git(fx.mainRepo, ["update-ref", "-d", "refs/heads/other"]);
    }
  });
});

test("movement in another checked-out worktree does not invalidate the review surface", async (t) => {
  const fx = createFixture(t);
  await expectTolerated(fx, {
    mutate: () => {

      writeFileSync(path.join(fx.otherWorktree, "sibling.txt"), "sibling work\n");
      git(fx.otherWorktree, ["add", "-A"]);
      git(fx.otherWorktree, ["commit", "-qm", "sibling"]);
    }
  });
});

test("registering and pruning an unrelated worktree does not invalidate the review surface", async (t) => {
  const fx = createFixture(t);
  const extra = path.join(fx.root, "extra-worktree");
  await expectTolerated(fx, {
    mutate: () => {
      git(fx.mainRepo, ["worktree", "add", "-q", "--detach", extra, fx.baseSha]);
      git(fx.mainRepo, ["worktree", "remove", "--force", fx.otherWorktree]);
    }
  });
});

test("ORIG_HEAD and FETCH_HEAD churn does not invalidate the review surface", async (t) => {
  const fx = createFixture(t);
  await expectTolerated(fx, {
    mutate: () => {

      assert.notEqual(readFileSync(path.join(fx.gitDir, "ORIG_HEAD"), "utf8").trim(), fx.otherSha);
      writeFileSync(path.join(fx.gitDir, "ORIG_HEAD"), `${fx.otherSha}\n`);
      writeFileSync(
        path.join(fx.gitDir, "FETCH_HEAD"),
        `${fx.otherSha}\t\tbranch 'other' of somewhere\n`
      );
    }
  });
});

test("the bound slice ref moving mid-preparation fails closed", async (t) => {
  const fx = createFixture(t);

  git(fx.mainRepo, ["worktree", "add", "-q", "--detach", path.join(fx.root, "scratch"), fx.baseSha]);
  writeFileSync(path.join(fx.root, "scratch", "other.txt"), "other\n");
  git(path.join(fx.root, "scratch"), ["add", "-A"]);
  git(path.join(fx.root, "scratch"), ["commit", "-qm", "competing"]);
  const competing = git(path.join(fx.root, "scratch"), ["rev-parse", "HEAD"]).trim();

  await expectRefusal(fx, {
    mutate: () => git(fx.mainRepo, ["update-ref", SLICE_REF, competing])
  }, { code: CODES.POSTCHECK_FAILED, field: "targetRegistration" });
});

test("the worktree identity digest changing mid-preparation fails closed", async (t) => {
  const fx = createFixture(t);
  await expectRefusal(fx, {
    digest: (call) => (call === 1 ? DIGEST : `sha256:${"b".repeat(64)}`)
  }, { code: CODES.POSTCHECK_FAILED, field: "worktreeIdentityDigest" });
});

test("the bound base commit changing mid-preparation fails closed", async (t) => {
  const fx = createFixture(t);

  await expectRefusal(fx, {
    binding: (call) => (call === 1 ? fx.binding() : fx.binding({ base_sha: fx.otherSha }))
  }, { code: CODES.OBJECT_MISMATCH });
});

test("locking the target worktree registration mid-preparation fails closed", async (t) => {
  const fx = createFixture(t);
  await expectRefusal(fx, {
    mutate: () => git(fx.mainRepo, ["worktree", "lock", fx.worktreePath])
  }, { code: CODES.WORKTREE_MISMATCH });
});

test("moving the target worktree mid-preparation fails closed", async (t) => {
  const fx = createFixture(t);
  await expectRefusal(fx, {
    mutate: () => git(fx.mainRepo, ["worktree", "move", fx.worktreePath, path.join(fx.root, "moved")])
  }, { code: CODES.WORKTREE_MISMATCH });
});

test("detaching the target worktree HEAD mid-preparation fails closed", async (t) => {
  const fx = createFixture(t);
  await expectRefusal(fx, {
    mutate: () => git(fx.worktreePath, ["checkout", "-q", "--detach"])
  }, { code: CODES.WORKTREE_MISMATCH });
});

test("staging a change into the ordinary index mid-preparation fails closed", async (t) => {
  const fx = createFixture(t);
  await expectRefusal(fx, {
    mutate: () => {
      writeFileSync(path.join(fx.worktreePath, "src.txt"), "staged drift\n");
      git(fx.worktreePath, ["add", "src.txt"]);
    }
  }, { code: CODES.POSTCHECK_FAILED });
});

test("editing the physical checkout mid-preparation fails closed", async (t) => {
  const fx = createFixture(t);
  await expectRefusal(fx, {
    mutate: () => writeFileSync(path.join(fx.worktreePath, "src.txt"), "worktree drift\n")
  }, { code: CODES.POSTCHECK_FAILED });
});

test("untracked content appearing in the physical checkout mid-preparation fails closed", async (t) => {
  const fx = createFixture(t);
  await expectRefusal(fx, {
    mutate: () => writeFileSync(path.join(fx.worktreePath, "stray.txt"), "stray\n")
  }, { code: CODES.PHYSICAL_TREE_REFUSED });
});

test("every in-progress sequencer pseudoref fails closed, resolvable or not", async (t) => {
  for (const pseudoref of SLICE_REVIEW_POSTCHECK_STATE_BUDGET.refused_pseudorefs) {
    const resolvable = createFixture(t);

    const oid = pseudoref === "AUTO_MERGE" ? resolvable.baseTree : resolvable.baseSha;
    writeFileSync(path.join(resolvable.gitDir, pseudoref), `${oid}\n`);
    await expectRefusal(resolvable, {}, {
      code: CODES.WORKTREE_MISMATCH,
      detail: { pseudoref }
    });

    const unresolvable = createFixture(t);
    writeFileSync(path.join(unresolvable.gitDir, pseudoref), "not-an-object-id\n");
    await expectRefusal(unresolvable, {}, {
      code: CODES.WORKTREE_MISMATCH,
      detail: { pseudoref }
    });
  }
});

const PRESENT_BUT_UNRESOLVABLE_SHAPES = [
  ["malformed", (target) => writeFileSync(target, "not-an-object-id\n")],
  ["empty", (target) => writeFileSync(target, "")],
  ["whitespace-only", (target) => writeFileSync(target, "\n")],
  ["a dangling symlink", (target) => symlinkSync(path.join(path.dirname(target), "no-such-target"), target)],
  ["a dangling symref", (target) => writeFileSync(target, "ref: refs/heads/no-such-branch\n")],
  ["unreadable (mode 000)", (target) => {
    writeFileSync(target, "not-an-object-id\n");
    chmodSync(target, 0o000);
  }]
];

for (const [shape, plant] of PRESENT_BUT_UNRESOLVABLE_SHAPES) {
  test(`${shape} MERGE_HEAD is present and fails closed`, async (t) => {
    const fx = createFixture(t);
    const target = path.join(fx.gitDir, "MERGE_HEAD");
    plant(target);

    assert.equal(
      defaultSliceReviewRunGit({
        repo: fx.worktreePath,
        args: ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]
      }).ok,
      false,
      "this shape must be unresolvable, or it proves nothing"
    );
    await expectRefusal(fx, {}, {
      code: CODES.WORKTREE_MISMATCH,
      detail: { pseudoref: "MERGE_HEAD" }
    });
  });
}

test("Git path resolution alone cannot see a symlinked pseudoref", async (t) => {
  const fx = createFixture(t);
  const literal = path.join(fx.gitDir, "MERGE_HEAD");
  symlinkSync(path.join(fx.gitDir, "no-such-target"), literal);

  const located = defaultSliceReviewRunGit({
    gitDir: fx.gitDir,
    workTree: fx.worktreePath,
    args: ["rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"]
  });
  const resolved = String(located.stdout ?? "").trim();
  assert.equal(located.ok, true);
  assert.notEqual(resolved, literal, "Git must be following the symlink for this test to mean anything");
  assert.equal(existsSync(resolved), false, "the Git-resolved location must not exist");
  assert.equal(lstatSync(literal).isSymbolicLink(), true, "the pseudoref itself is present");

  await expectRefusal(fx, {}, {
    code: CODES.WORKTREE_MISMATCH,
    detail: { pseudoref: "MERGE_HEAD" }
  });
});

test("an absent refused pseudoref leaves the review surface acceptable", async (t) => {
  const fx = createFixture(t);
  for (const pseudoref of SLICE_REVIEW_POSTCHECK_STATE_BUDGET.refused_pseudorefs) {
    assert.equal(existsSync(path.join(fx.gitDir, pseudoref)), false, `${pseudoref} must start absent`);
  }

  const target = path.join(fx.gitDir, "MERGE_HEAD");
  writeFileSync(target, `${fx.baseSha}\n`);
  unlinkSync(target);
  await expectTolerated(fx, {});
});

const MODULE_PATH = fileURLToPath(
  new URL("../packages/agent-launch-cli/src/lib/slice-review-materialization.mjs", import.meta.url)
);

function buildTrustedStateMutant(t) {
  const lib = path.dirname(MODULE_PATH);
  const rewrites = [
    ['"./trusted-operation-contracts.mjs"', JSON.stringify(path.join(lib, "trusted-operation-contracts.mjs"))],
    ['"./exact-slice-commit-binding.mjs"', JSON.stringify(path.join(lib, "exact-slice-commit-binding.mjs"))],

    [
      "  return Object.freeze({\n    rawBinding,",
      "  return Object.freeze(__mutateTrustedState({\n    rawBinding,"
    ],
    [
      "    sequencerState: classifySequencerState(runGit, gitContext)\n  });",
      "    sequencerState: classifySequencerState(runGit, gitContext)\n  }));"
    ]
  ];
  let source = readFileSync(MODULE_PATH, "utf8");
  for (const [from, to] of rewrites) {
    assert.ok(source.includes(from), `mutation anchor missing from the module: ${from}`);
    source = source.replace(from, to);
  }
  source += "\nfunction __mutateTrustedState(state) {\n" +
    "  const hook = globalThis.__WK1691_TRUSTED_STATE_HOOK__;\n" +
    "  return typeof hook === \"function\" ? hook(state) : state;\n}\n";
  const dir = mkdtempSync(path.join(tmpdir(), "slice-review-mutant-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "mutant.mjs");
  writeFileSync(file, source);
  return file;
}

async function prepareThroughMutant(t, fx, hook) {
  const mutant = await import(pathToFileURL(buildTrustedStateMutant(t)).href);
  const { deps } = makeDeps(fx, {});
  globalThis.__WK1691_TRUSTED_STATE_HOOK__ = hook;
  try {
    return await mutant.prepareSliceReviewSurface({
      mainRepo: fx.mainRepo,
      assignedUnit: ASSIGNED_UNIT,
      launchRef: LAUNCH_REF,
      runId: RUN_ID,
      retryId: 0,
      deps
    }).then((result) => ({ ok: true, result }), (error) => ({ ok: false, error }));
  } finally {
    delete globalThis.__WK1691_TRUSTED_STATE_HOOK__;
  }
}

function dropBoundFieldOnCall(field, targetCall) {
  let call = 0;
  return (state) => {
    call += 1;
    if (call !== targetCall) return state;
    const mutated = { ...state };
    delete mutated[field];
    return mutated;
  };
}

test("the trusted-state mutant harness prepares cleanly with no hook installed", async (t) => {
  const fx = createFixture(t);
  const outcome = await prepareThroughMutant(t, fx, null);
  assert.equal(outcome.ok, true, `the control mutant must prepare: ${outcome.error?.message}`);
  assert.equal(outcome.result.reviewed_sha, fx.reviewedSha);
});

test("a producer key renamed out of sync with the budget fails closed instead of escaping", async (t) => {
  const fx = createFixture(t);

  const outcome = await prepareThroughMutant(t, fx, (state) => {
    const { commonDirectory, ...rest } = state;
    return { ...rest, commonDirRenamed: commonDirectory };
  });
  assert.equal(outcome.ok, false, "a declared-but-unproduced bound field must fail closed");
  assert.equal(outcome.error.code, CODES.POSTCHECK_FAILED);
  assert.equal(outcome.error.detail.field, "commonDirectory");
  assert.ok(
    SLICE_REVIEW_POSTCHECK_STATE_BUDGET.bound_fields.includes(outcome.error.detail.field),
    "the mismatch must still name a canonical bound field"
  );
});

for (const [label, targetCall] of [["before", 1], ["after", 2]]) {
  test(`a bound field missing from only the ${label} snapshot fails closed`, async (t) => {
    const fx = createFixture(t);
    const outcome = await prepareThroughMutant(t, fx, dropBoundFieldOnCall("objectAlternates", targetCall));
    assert.equal(outcome.ok, false, `a bound field absent from ${label} must fail closed`);
    assert.equal(outcome.error.code, CODES.POSTCHECK_FAILED);
    assert.deepEqual({ ...outcome.error.detail }, { field: "objectAlternates" });
  });
}

test("substituting the object directory mid-preparation fails closed", async (t) => {
  const fx = createFixture(t, { symlinkedObjects: true });

  await expectRefusal(fx, {
    mutate: () => {
      unlinkSync(fx.objectsDir);
      symlinkSync(path.join(fx.mainRepo, ".git", "objects-b"), fx.objectsDir);
    }
  }, { code: CODES.POSTCHECK_FAILED, field: "objectDirectory" });
});

test("adding an object alternates entry mid-preparation fails closed", async (t) => {
  const fx = createFixture(t);
  const alternate = path.join(fx.root, "alt-objects");
  cpSync(fx.objectsDir, alternate, { recursive: true });
  await expectRefusal(fx, {
    mutate: () => {
      mkdirSync(path.join(fx.objectsDir, "info"), { recursive: true });
      writeFileSync(path.join(fx.objectsDir, "info", "alternates"), `${alternate}\n`);
    }
  }, { code: CODES.POSTCHECK_FAILED, field: "objectAlternates" });
});

test("a reviewed commit object missing from the bound store fails closed even when it is readable elsewhere", async (t) => {
  const fx = createFixture(t);

  const rescue = path.join(fx.root, "rescue-objects");
  cpSync(fx.objectsDir, rescue, { recursive: true });
  const loose = path.join(fx.objectsDir, fx.reviewedSha.slice(0, 2), fx.reviewedSha.slice(2));
  rmSync(loose, { force: true });
  assert.equal(
    readFileSync(path.join(rescue, fx.reviewedSha.slice(0, 2), fx.reviewedSha.slice(2))).length > 0,
    true,
    "the equivalent OID must remain readable in the unbound store"
  );

  await expectRefusal(fx, {}, { code: CODES.OBJECT_MISMATCH });
});

test("a missing or wrong-type bound base object fails closed", async (t) => {
  const missing = createFixture(t);
  await expectRefusal(missing, {
    binding: () => missing.binding({ base_sha: "9".repeat(40) })
  }, { code: CODES.OBJECT_MISMATCH });

  const treeTyped = createFixture(t);
  await expectRefusal(treeTyped, {

    binding: () => treeTyped.binding({ base_sha: treeTyped.baseTree })
  }, { code: CODES.OBJECT_MISMATCH });

  const blobTyped = createFixture(t);
  const blob = git(blobTyped.worktreePath, ["rev-parse", "HEAD:src.txt"]).trim();
  await expectRefusal(blobTyped, {
    binding: () => blobTyped.binding({ base_sha: blob })
  }, { code: CODES.OBJECT_MISMATCH });
});

test("a reviewed commit whose parent is not the bound base fails closed", async (t) => {
  const fx = createFixture(t);
  await expectRefusal(fx, {
    binding: () => fx.binding({ base_sha: fx.otherSha })
  }, { code: CODES.OBJECT_MISMATCH });
});
