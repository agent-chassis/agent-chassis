

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  defaultSliceReviewRunGit, prepareSliceReviewSurface,
  HISTORICAL_DELIVERY_INDEX_RECOVERY, SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES
} from "../packages/agent-launch-cli/src/lib/slice-review-materialization.mjs";
import {
  buildServerGeneratedCommitMessage
} from "../packages/agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs";
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
const RECORD_ID = "WK-1795";
const SLICE_ID = "SLICE-001";
const ASSIGNED_UNIT = `${RECORD_ID}#${SLICE_ID}`;
const BASE_REF = `wk/${INITIATIVE}/${RECORD_ID}`;
const SLICE_BRANCH = `slice/${INITIATIVE}/${RECORD_ID}/${SLICE_ID}`;
const SLICE_REF = `refs/heads/${SLICE_BRANCH}`;
const WORKTREE_DIR = `slice-${INITIATIVE}-${RECORD_ID}-${SLICE_ID}`;
const LAUNCH_REF = "refs/agent-launch/wk-1795/slice-001";
const RUN_ID = "wkdb_fa7e7e024ed2d2bc";
const DIGEST = `sha256:${"a".repeat(64)}`;
const DRIFTED_DIGEST = `sha256:${"b".repeat(64)}`;
const CODES = SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES;
const STAMP = "t <t@t.local> 1700000000 +0000";
const NOT_CANONICAL = /not an exact canonical server-minted delivery/u;

const MODULE_PATH = fileURLToPath(
  new URL("../packages/agent-launch-cli/src/lib/slice-review-materialization.mjs", import.meta.url)
);
const PRODUCTION_BYTES_AT_LOAD = createHash("sha256").update(readFileSync(MODULE_PATH)).digest("hex");

function git(cwd, args, input = undefined) {
  return execFileSync("git", args, { cwd, input, encoding: "utf8" }).trim();
}

function deliveryMessage(parent, subject = ASSIGNED_UNIT) {
  return `agent-launch worker delivery: ${subject} (base ${parent.slice(0, 12)})\n\nWk-Slice: ${subject}`;
}

function commitBytes(tree, parents, message) {
  const headers = parents.map((p) => `parent ${p}\n`).join("");
  return `tree ${tree}\n${headers}author ${STAMP}\ncommitter ${STAMP}\n\n${message}\n`;
}

function createRepo(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "slice-review-stale-index-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const mainRepo = path.join(root, "main");
  mkdirSync(mainRepo);
  git(mainRepo, ["init", "-q", "--initial-branch=main"]);
  git(mainRepo, ["config", "commit.gpgsign", "false"]);
  writeFileSync(path.join(mainRepo, ".gitignore"), "ignored/\n");
  writeFileSync(path.join(mainRepo, "src.txt"), "seed\n");
  git(mainRepo, ["add", "-A"]);
  git(mainRepo, ["commit", "-qm", "seed"]);

  writeFileSync(path.join(mainRepo, "src.txt"), "launcher base\n");
  git(mainRepo, ["add", "-A"]);
  git(mainRepo, ["commit", "-qm", "chore(wiki): snapshot WK-1795 dispatch contract"]);
  const launcherBase = git(mainRepo, ["rev-parse", "HEAD"]);
  git(mainRepo, ["branch", BASE_REF, launcherBase]);
  const scratch = path.join(root, "scratch");
  git(mainRepo, ["worktree", "add", "-q", "--detach", scratch, launcherBase]);
  return { root, mainRepo, scratch, launcherBase };
}

function treeWith(repo, content) {
  writeFileSync(path.join(repo.scratch, "src.txt"), content);
  git(repo.scratch, ["add", "-A"]);
  return git(repo.scratch, ["write-tree"]);
}

function chainFixture(t, entries, { indexAt = 0 } = {}) {
  const repo = createRepo(t);
  const built = [];
  let parent = repo.launcherBase;
  entries.forEach((entry, i) => {
    const tree = treeWith(repo, `corrective delivery ${i}\n`);
    const parents = entry?.parents ? entry.parents(repo, parent) : [parent];
    const message = entry?.message ? entry.message(parents[0]) : deliveryMessage(parents[0]);
    const sha = entry?.bytes
      ? git(repo.mainRepo, ["hash-object", "-t", "commit", "-w", "--stdin", "--literally"],
        entry.bytes(tree, parents, message))
      : git(repo.mainRepo, ["commit-tree", ...parents.flatMap((p) => ["-p", p]), "-m", message, tree]);
    built.push({ sha, tree });
    parent = sha;
  });
  const reviewed = built[built.length - 1];
  const base = built[built.length - 2];
  const retained = indexAt === null ? reviewed : built[indexAt];

  const worktreePath = path.join(repo.root, WORKTREE_DIR);
  git(repo.mainRepo, ["branch", SLICE_BRANCH, reviewed.sha]);
  git(repo.mainRepo, ["worktree", "add", "-q", worktreePath, SLICE_BRANCH]);
  if (indexAt !== null) git(worktreePath, ["read-tree", retained.tree]);

  return {
    ...repo,
    built, worktreePath,
    gitDir: path.join(repo.mainRepo, ".git", "worktrees", WORKTREE_DIR),
    baseSha: base.sha, baseTree: base.tree,
    reviewedSha: reviewed.sha, reviewedTree: reviewed.tree,
    historicalSha: retained.sha, historicalTree: retained.tree,
    indexTree: () => git(worktreePath, ["write-tree"]),
    binding(overrides = {}) {
      return {
        schema_version: "worktree-identity-binding.v2", checkout_mode: "full",
        launch_ref: LAUNCH_REF, run_id: `${RUN_ID}.slice`, retry_id: 0,
        unit_address: `${INITIATIVE}/${RECORD_ID}/${SLICE_ID}`, initiative: INITIATIVE,
        record_id: RECORD_ID, slice_id: SLICE_ID,
        base_ref: BASE_REF, base_sha: base.sha,
        output_branch: SLICE_BRANCH, worktree_path: worktreePath,
        read_scope: [], repo_paths: ["src.txt"], write_scope: ["src.txt"],
        write_scope_source: `wiki/work-records/${RECORD_ID}.json#${SLICE_ID}`,
        selected_unit: {
          kind: "slice", address: ASSIGNED_UNIT, record_id: RECORD_ID, slice_id: SLICE_ID, repo: null
        },
        source_digest: `sha256:${"0".repeat(64)}`, source_version: null,
        ...overrides
      };
    }
  };
}

function correctiveFixture(t, options = {}) {
  return chainFixture(t, Array.from({ length: 6 }, () => ({})), { indexAt: 1, ...options });
}

function craftedFixture(t, at, entry) {
  return chainFixture(t, Array.from({ length: 5 }, (unused, i) => (i === at ? entry : {})), { indexAt: 0 });
}

function snapshot(fx) {
  const files = {};
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (rel === "" && entry.name === ".git") continue;
      const abs = path.join(dir, entry.name);
      const key = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, key);
      else files[key] = readFileSync(abs).toString("hex");
    }
  };
  walk(fx.worktreePath, "");
  return {
    files,
    staged: git(fx.worktreePath, ["ls-files", "--stage"]),
    head: readFileSync(path.join(fx.gitDir, "HEAD"), "utf8"),
    refs: git(fx.mainRepo, ["for-each-ref", "--format=%(refname) %(objectname)"]),
    registration: git(fx.mainRepo, ["worktree", "list", "--porcelain"])
  };
}

function makeDeps(fx, { mutate = null, when = null, digest = null } = {}) {
  const fires = (options) => (when
    ? when(options)
    : options.indexFile == null && options.args?.[0] === "write-tree");
  const state = { fired: false, calls: 0 };
  const deps = {
    resolveWorktreeBinding: () => fx.binding(),
    digestWorktreeIdentity: () => {
      state.calls += 1;
      return digest ? digest(state.calls) : DIGEST;
    },
    runGit: (options) => {
      const result = defaultSliceReviewRunGit(options);
      if (!state.fired && mutate && fires(options)) {
        state.fired = true;
        mutate();
      }
      return result;
    }
  };
  return { deps, state };
}

function prepareWith(module, fx, deps) {
  return module.prepareSliceReviewSurface({
    mainRepo: fx.mainRepo, assignedUnit: ASSIGNED_UNIT, launchRef: LAUNCH_REF,
    runId: RUN_ID, retryId: 0, deps
  }).then((result) => ({ ok: true, result }), (error) => ({ ok: false, error }));
}

const PRODUCTION = { prepareSliceReviewSurface };

async function expectRefusal(fx, options, { code, message = null, preserved = true }) {
  const before = snapshot(fx);
  const { deps, state } = makeDeps(fx, options);
  const outcome = await prepareWith(PRODUCTION, fx, deps);
  assert.equal(outcome.ok, false, "preparation must fail closed");
  assert.equal(outcome.error.name, "SliceReviewMaterializationError");
  assert.equal(outcome.error.code, code, `unexpected code for: ${outcome.error.message}`);
  if (message) assert.match(outcome.error.message, message);
  if (options?.mutate) assert.equal(state.fired, true, "the injected mid-flight mutation must have run");
  if (preserved) assert.deepEqual(snapshot(fx), before, "a refusal preserves every surface exactly");
  return outcome.error;
}

async function expectPrepared(fx, options = {}) {
  const { deps } = makeDeps(fx, options);
  const outcome = await prepareWith(PRODUCTION, fx, deps);
  assert.equal(outcome.ok, true, `preparation must succeed: ${outcome.error?.message}`);
  assert.deepEqual({ ...outcome.result }, {
    schema_version: SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION,
    assigned_unit: ASSIGNED_UNIT, launch_ref: LAUNCH_REF, run_id: RUN_ID, retry_id: 0,
    worktree_identity_digest: DIGEST, worktree_path: fx.worktreePath, slice_ref: SLICE_REF,
    base_sha: fx.baseSha, reviewed_sha: fx.reviewedSha, reviewed_tree: fx.reviewedTree,
    verified_parts: outcome.result.verified_parts
  });
  return outcome.result;
}

test("the fixture reproduces the retained WK-1795 corrective stale-index topology", (t) => {
  const fx = correctiveFixture(t);
  for (const round of fx.built) {
    const raw = execFileSync("git", ["cat-file", "commit", round.sha], { cwd: fx.mainRepo, encoding: "utf8" });
    const parent = raw.split("\n")[1].slice("parent ".length);

    assert.equal(deliveryMessage(parent), buildServerGeneratedCommitMessage({
      subject: ASSIGNED_UNIT, base_sha: parent
    }));
    assert.equal(raw.slice(raw.indexOf("\n\n") + 2), `${deliveryMessage(parent)}\n`);
  }
  assert.equal(git(fx.mainRepo, ["rev-list", "--parents", "-n", "1", fx.reviewedSha]),
    `${fx.reviewedSha} ${fx.baseSha}`);
  assert.equal(git(fx.worktreePath, ["rev-parse", "HEAD"]), fx.reviewedSha);
  assert.equal(git(fx.mainRepo, ["rev-parse", SLICE_REF]), fx.reviewedSha);

  assert.equal(git(fx.worktreePath, ["rev-parse", "HEAD^{tree}"]), fx.reviewedTree);
  const retained = fx.indexTree();
  assert.equal(retained, fx.historicalTree);
  assert.notEqual(retained, fx.baseTree);
  assert.notEqual(retained, fx.reviewedTree);

  assert.equal(git(fx.mainRepo, ["rev-list", "--count", `${fx.historicalSha}..${fx.reviewedSha}`]), "4");
});

function loadMutant(t, rewrites) {
  const lib = path.dirname(MODULE_PATH);
  let source = readFileSync(MODULE_PATH, "utf8");
  const all = [
    ['"./trusted-operation-contracts.mjs"', JSON.stringify(path.join(lib, "trusted-operation-contracts.mjs"))],
    ['"./exact-slice-commit-binding.mjs"', JSON.stringify(path.join(lib, "exact-slice-commit-binding.mjs"))],
    ['"./commit-tool-exposure-guard.mjs"', JSON.stringify(path.join(lib, "commit-tool-exposure-guard.mjs"))],
    ...rewrites
  ];
  for (const [from, to] of all) {
    assert.ok(source.includes(from), `mutation anchor missing from the module: ${from}`);
    source = source.replace(from, to);
  }
  const dir = mkdtempSync(path.join(tmpdir(), "stale-index-mutant-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "mutant.mjs");
  writeFileSync(file, source);
  return import(pathToFileURL(file).href);
}

const GATE = "  if (ordinaryIndexTree !== before.baseTree && ordinaryIndexTree !== before.reviewedTree) {\n" +
  "    await authenticateHistoricalDeliveryIndexTree({";

test("the pre-fix two-state predicate refuses the retained topology with INDEX_STATE_REFUSED", async (t) => {

  const twoState = await loadMutant(t, [[GATE, GATE.replace(
    "    await authenticateHistoricalDeliveryIndexTree({",
    "    fail(SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INDEX_STATE_REFUSED,\n" +
    "      \"ordinary index is neither the expected base tree nor the reviewed tree\",\n" +
    "      { base_tree: before.baseTree, reviewed_tree: before.reviewedTree, actual: ordinaryIndexTree });\n" +
    "    await authenticateHistoricalDeliveryIndexTree({"
  )]]);
  const fx = correctiveFixture(t);
  const before = snapshot(fx);
  const { deps } = makeDeps(fx, {});
  const outcome = await prepareWith(twoState, fx, deps);
  assert.equal(outcome.ok, false, "the pre-fix predicate must refuse");
  assert.equal(outcome.error.code, CODES.INDEX_STATE_REFUSED);
  assert.deepEqual({ ...outcome.error.detail }, {
    base_tree: fx.baseTree, reviewed_tree: fx.reviewedTree, actual: fx.historicalTree
  });
  assert.deepEqual(snapshot(fx), before, "the pre-fix refusal reached no index mutation");
});

test("an authenticated historical launcher index recovers and aligns ONLY the ordinary index", async (t) => {
  const fx = correctiveFixture(t);
  const before = snapshot(fx);
  await expectPrepared(fx);
  const after = snapshot(fx);
  assert.equal(fx.indexTree(), fx.reviewedTree, "the ordinary index must now be the reviewed tree");
  assert.notEqual(after.staged, before.staged, "the ordinary index is the one thing that changed");
  assert.deepEqual(after.files, before.files, "no physical worktree file may be written");
  assert.equal(after.head, before.head);
  assert.equal(after.refs, before.refs, "no ref anywhere in the repository may move");
  assert.equal(after.registration, before.registration);
  assert.equal(git(fx.mainRepo, ["rev-parse", SLICE_REF]), fx.reviewedSha);
  assert.equal(git(fx.worktreePath, ["rev-parse", "HEAD"]), fx.reviewedSha);

  for (const round of fx.built) {
    assert.equal(git(fx.mainRepo, ["cat-file", "-t", round.sha]), "commit");
  }
  assert.equal(git(fx.worktreePath, ["status", "--porcelain=v1", "-uall"]), "");
});

test("repeating the recovery converges without further mutation", async (t) => {
  const fx = correctiveFixture(t);
  const first = await expectPrepared(fx);
  const settled = snapshot(fx);
  assert.deepEqual({ ...(await expectPrepared(fx)) }, { ...first });
  assert.deepEqual(snapshot(fx), settled, "the repeated call must change nothing at all");
});

test("the two ordinary index states are preserved unchanged", async (t) => {
  const reviewed = correctiveFixture(t, { indexAt: null });
  assert.equal(reviewed.indexTree(), reviewed.reviewedTree);
  const settled = snapshot(reviewed);
  await expectPrepared(reviewed);
  assert.deepEqual(snapshot(reviewed), settled, "an already-reviewed index is a no-op");

  const atBase = correctiveFixture(t, { indexAt: 4 });
  assert.equal(atBase.indexTree(), atBase.baseTree);
  await expectPrepared(atBase);
  assert.equal(atBase.indexTree(), atBase.reviewedTree);
});

const ARBITRARY_INDEX_CASES = [
  ["an arbitrary staged index", (fx) => {
    const stray = treeWith(fx, "attacker staged content\n");
    git(fx.worktreePath, ["read-tree", stray]);
  }],
  ["staged bytes absent from the physical reviewed tree", (fx) => {
    const blob = git(fx.mainRepo, ["hash-object", "-w", "--stdin"], "ghost\n");
    git(fx.worktreePath, ["read-tree", fx.reviewedTree]);
    git(fx.worktreePath, ["update-index", "--add", "--cacheinfo", `100644,${blob},ghost.txt`]);
  }],

  ["a same-tree unrelated commit", (fx) => {
    const tree = treeWith(fx, "off-suffix same tree\n");
    const unrelated = git(fx.mainRepo,
      ["commit-tree", "-p", fx.launcherBase, "-m", deliveryMessage(fx.launcherBase), tree]);
    assert.equal(git(fx.mainRepo, ["cat-file", "-t", unrelated]), "commit");
    git(fx.worktreePath, ["read-tree", tree]);
  }]
];

for (const [label, plant] of ARBITRARY_INDEX_CASES) {
  test(`${label} refuses and is preserved exactly`, async (t) => {
    const fx = correctiveFixture(t);
    plant(fx);
    const planted = fx.indexTree();
    await expectRefusal(fx, {}, { code: CODES.INDEX_STATE_REFUSED, message: NOT_CANONICAL });
    assert.equal(fx.indexTree(), planted, "the planted index is left exactly as found");
  });
}

test("a mixed staged/unstaged worktree refuses even with an authenticated index", async (t) => {
  const fx = correctiveFixture(t);
  writeFileSync(path.join(fx.worktreePath, "src.txt"), "unstaged drift\n");
  await expectRefusal(fx, {}, { code: CODES.PHYSICAL_TREE_REFUSED });
});

for (const [label, plant] of [
  ["untracked", (fx) => writeFileSync(path.join(fx.worktreePath, "stray.txt"), "stray\n")],
  ["ignored", (fx) => {
    mkdirSync(path.join(fx.worktreePath, "ignored"));
    writeFileSync(path.join(fx.worktreePath, "ignored", "x.txt"), "x\n");
  }]
]) {
  test(`${label} content refuses before any index reconciliation`, async (t) => {
    const fx = correctiveFixture(t);
    plant(fx);
    await expectRefusal(fx, {}, { code: CODES.PHYSICAL_TREE_REFUSED });
  });
}

const CRAFTED_SUFFIX_CASES = [
  ["a noncanonical message on the matching commit", 0, { message: () => "fix stuff" }],
  ["a noncanonical message on an intermediate commit", 2, { message: () => "wip" }],
  ["a wrong subject in the delivery message", 0,
    { message: (parent) => deliveryMessage(parent, "WK-9999#SLICE-001") }],
  ["a base in the message that is not the literal parent", 0,
    { message: () => deliveryMessage("0".repeat(40)) }],
  ["a merge commit in the suffix", 1, { parents: (repo, prev) => [prev, repo.launcherBase] }],
  ["a malformed literal commit object", 1,
    { bytes: (tree, parents) => `tree ${tree}\nparent ${parents[0]}\nno-blank-line-separator\n` }],
  ["a truncated literal header", 1,
    { bytes: (tree) => `tree ${tree}\n\n${deliveryMessage("0".repeat(40))}\n` }],
  ["a missing parent object", 1, { parents: () => ["9".repeat(40)], bytes: commitBytes }]
];

for (const [label, at, entry] of CRAFTED_SUFFIX_CASES) {
  test(`${label} refuses without mutation`, async (t) => {
    await expectRefusal(craftedFixture(t, at, entry), {}, { code: CODES.INDEX_STATE_REFUSED });
  });
}

test("the same suffix shape with no crafted round DOES recover", async (t) => {
  const fx = craftedFixture(t, -1, {});
  await expectPrepared(fx);
  assert.equal(fx.indexTree(), fx.reviewedTree);
});

function replacementAttackFixture(t) {
  const fx = craftedFixture(t, -1, {});
  const forgedTree = treeWith(fx, "forged replacement content\n");
  const forged = git(fx.mainRepo,
    ["commit-tree", "-p", fx.built[1].sha, "-m", deliveryMessage(fx.built[1].sha), forgedTree]);
  git(fx.mainRepo, ["replace", "-f", fx.built[2].sha, forged]);
  git(fx.worktreePath, ["read-tree", forgedTree]);
  fx.forgedTree = forgedTree;
  return fx;
}

test("a replacement ref cannot forge an authenticated delivery suffix", async (t) => {
  const fx = replacementAttackFixture(t);

  assert.equal(git(fx.mainRepo, ["cat-file", "commit", fx.built[2].sha]).split("\n")[0],
    `tree ${fx.forgedTree}`);
  await expectRefusal(fx, {}, { code: CODES.INDEX_STATE_REFUSED, message: NOT_CANONICAL });
});

test("the traversal bound is fixed, frozen, and exhaustion refuses", async (t) => {
  assert.equal(Object.isFrozen(HISTORICAL_DELIVERY_INDEX_RECOVERY), true);
  assert.equal(HISTORICAL_DELIVERY_INDEX_RECOVERY.max_suffix_commits, 64);
  const rounds = HISTORICAL_DELIVERY_INDEX_RECOVERY.max_suffix_commits + 2;
  const fx = chainFixture(t, Array.from({ length: rounds }, () => ({})), { indexAt: 0 });
  await expectRefusal(fx, {}, { code: CODES.INDEX_STATE_REFUSED, message: /within the fixed traversal bound/u });
});

function competingCommit(fx) {
  const tree = treeWith(fx, "competing delivery\n");
  return git(fx.mainRepo, ["commit-tree", "-p", fx.baseSha, "-m", deliveryMessage(fx.baseSha), tree]);
}

test("the slice ref moving DURING authentication refuses with the index untouched", async (t) => {
  const fx = correctiveFixture(t);
  const competing = competingCommit(fx);
  await expectRefusal(fx, {

    when: (options) => options.args?.[1] === "cat-file" && options.args?.[2] === "commit",
    mutate: () => git(fx.mainRepo, ["update-ref", SLICE_REF, competing])
  }, {
    code: CODES.INDEX_STATE_REFUSED,
    message: /moved during historical index authentication/u,
    preserved: false
  });
  assert.equal(fx.indexTree(), fx.historicalTree,
    "a ref that moved mid-authentication must leave the retained index exactly as found");
});

test("state moving AFTER alignment fails the complete post-preparation recheck", async (t) => {
  const fx = correctiveFixture(t);
  const competing = competingCommit(fx);
  await expectRefusal(fx, {
    when: (options) => options.indexFile == null && options.args?.[0] === "read-tree",
    mutate: () => git(fx.mainRepo, ["update-ref", SLICE_REF, competing])
  }, { code: CODES.POSTCHECK_FAILED, preserved: false });
});

test("the bound identity digest drifting across preparation fails the recheck", async (t) => {
  const fx = correctiveFixture(t);
  const error = await expectRefusal(fx, {
    digest: (call) => (call === 1 ? DIGEST : DRIFTED_DIGEST)
  }, { code: CODES.POSTCHECK_FAILED, preserved: false });
  assert.equal(error.detail.field, "worktreeIdentityDigest");
});

const MUTANTS = [
  {
    name: "accepts ANY third ordinary index without authentication",
    rewrites: [[GATE, GATE.replace("  if (ordinaryIndexTree", "  if (false && ordinaryIndexTree")]],
    attack: (t) => {
      const fx = correctiveFixture(t);
      git(fx.worktreePath, ["read-tree", treeWith(fx, "attacker staged content\n")]);
      return fx;
    },
    code: CODES.INDEX_STATE_REFUSED, kill: NOT_CANONICAL
  },
  {
    name: "trusts literal ancestry and tree equality without canonical delivery authentication",
    rewrites: [["  if (commit.message !== `${canonical}\\n`) {", "  if (false) {"]],
    attack: (t) => craftedFixture(t, 0, { message: () => "fix stuff" }),
    code: CODES.INDEX_STATE_REFUSED, kill: NOT_CANONICAL
  },
  {
    name: "omits replacement-object neutralization on authority-bearing reads",
    rewrites: [['literal_object_read_options: Object.freeze(["--no-replace-objects"])',
      "literal_object_read_options: Object.freeze([])"]],
    attack: replacementAttackFixture,
    code: CODES.INDEX_STATE_REFUSED, kill: NOT_CANONICAL
  },
  {
    name: "skips the final bound-state recheck",
    rewrites: [["function assertSameTrustedState(before, after) {\n  for (const field of",
      "function assertSameTrustedState(before, after) {\n  if (before && after) return;\n  for (const field of"]],
    attack: correctiveFixture,
    options: { digest: (call) => (call === 1 ? DIGEST : DRIFTED_DIGEST) },
    code: CODES.POSTCHECK_FAILED, kill: /trusted slice\/worktree\/ref state changed/u
  }
];

for (const mutant of MUTANTS) {
  test(`mutation witness: a build that ${mutant.name} is killed`, async (t) => {
    const module = await loadMutant(t, mutant.rewrites);
    assert.equal(typeof module.prepareSliceReviewSurface, "function", "the mutant must import cleanly");
    const control = correctiveFixture(t);
    const clean = await prepareWith(module, control, makeDeps(control, {}).deps);
    assert.equal(clean.ok, true,
      `the mutant must still prepare the authenticated topology: ${clean.error?.message}`);
    assert.equal(control.indexTree(), control.reviewedTree);
    const open = mutant.attack(t);
    const failedOpen = await prepareWith(module, open, makeDeps(open, mutant.options ?? {}).deps);
    assert.equal(failedOpen.ok, true,
      `the mutant must reach its intended branch and fail OPEN: ${failedOpen.error?.message}`);
    const killed = mutant.attack(t);
    const outcome = await prepareWith(PRODUCTION, killed, makeDeps(killed, mutant.options ?? {}).deps);
    assert.equal(outcome.ok, false, "production must refuse what the mutant admitted");
    assert.equal(outcome.error.name, "SliceReviewMaterializationError",
      "the kill must be a semantic refusal, never a Git or child-process fault");
    assert.equal(outcome.error.code, mutant.code);
    assert.match(outcome.error.message, mutant.kill);
  });
}

test("no mutant build ever rewrote the production module bytes", () => {
  assert.equal(createHash("sha256").update(readFileSync(MODULE_PATH)).digest("hex"), PRODUCTION_BYTES_AT_LOAD);
});
