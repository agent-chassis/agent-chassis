

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
  createBackendSliceReview
} from "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-slice-review.mjs";
import {
  resolveCanonicalSliceReviewUnit
} from "../packages/agent-launch-cli/src/lib/backend-scope-authority.mjs";
import {
  resolveCommittedSliceReviewAdmission
} from "../packages/agent-launch-cli/src/lib/committed-slice-review-admission.mjs";
import {
  prepareSliceReviewSurface, defaultSliceReviewRunGit
} from "../packages/agent-launch-cli/src/lib/slice-review-materialization.mjs";
import {
  buildServerGeneratedCommitMessage
} from "../packages/agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs";
import { defaultRunGit } from "../packages/agent-launch-cli/src/lib/worktree-substrate.mjs";
import {
  runPostWorkerSliceLifecycle
} from "../packages/wiki-mcp/src/lib/dispatch-post-worker-lifecycle.mjs";

process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_SYSTEM = "/dev/null";
process.env.GIT_AUTHOR_NAME = "t";
process.env.GIT_AUTHOR_EMAIL = "t@t.local";
process.env.GIT_COMMITTER_NAME = "t";
process.env.GIT_COMMITTER_EMAIL = "t@t.local";

const INITIATIVE = "IN-0030";
const RECORD_ID = "WK-1790";
const SLICE_ID = "SLICE-006";
const SUBJECT = `${RECORD_ID}#${SLICE_ID}`;
const UNIT_ADDRESS = `${INITIATIVE}/${RECORD_ID}/${SLICE_ID}`;
const REPO_ID = "agent-chassis/agent-chassis";
const SLICE_BRANCH = `slice/${INITIATIVE}/${RECORD_ID}/${SLICE_ID}`;
const SLICE_REF = `refs/heads/${SLICE_BRANCH}`;
const WK_BRANCH = `wk/${INITIATIVE}/${RECORD_ID}`;
const WK_REF = `refs/heads/${WK_BRANCH}`;
const WORKTREE_DIR = `slice-${INITIATIVE}-${RECORD_ID}-${SLICE_ID}`;
const LAUNCH_REF = "wkmh_7835d09d67d4e31b5f8c6ea2";
const RUN_ID = "wkdb_124922a47560d740";
const DELIVERY_PATH = "delivery.txt";
const IDENTITY_DIGEST = `sha256:${"a".repeat(64)}`;

const BINDER_MODULE_PATH = fileURLToPath(new URL(
  "../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-slice-review.mjs",
  import.meta.url
));
const REPO_ROOT = path.resolve(path.dirname(BINDER_MODULE_PATH), "..", "..", "..", "..");
const BINDER_BYTES_AT_LOAD =
  createHash("sha256").update(readFileSync(BINDER_MODULE_PATH)).digest("hex");

function git(cwd, args, input = undefined) {
  return execFileSync("git", args, { cwd, input, encoding: "utf8" }).trim();
}

function deliveryMessage(parent, subject = SUBJECT) {
  return `agent-launch worker delivery: ${subject} (base ${parent.slice(0, 12)})\n\nWk-Slice: ${subject}`;
}

function canonicalRecord(sliceStatus = "todo") {
  return {
    schema_version: "work-record.v1",
    id: RECORD_ID,
    repo: REPO_ID,
    initiative: INITIATIVE,
    record_kind: "work_item",
    work_kind: "implementation",
    status: "active",
    read_scope: [],
    repo_paths: [],
    write_scope: [DELIVERY_PATH],
    slices: [{
      id: SLICE_ID,
      work_kind: "implementation",
      status: sliceStatus,
      read_scope: [],
      repo_paths: [],
      write_scope: [DELIVERY_PATH],
      depends_on: []
    }]
  };
}

function buildFixture(t, { rounds, wkTipAt, indexAt = null, suffix = "chained" }) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), `chained-corrective-${suffix}-`)));
  t.after(() => {

    try {
      execFileSync("chmod", ["-R", "u+rwX", root], { stdio: "ignore" });
    } catch {   }
    rmSync(root, { recursive: true, force: true });
  });
  const mainRepo = path.join(root, "main");
  const worktreeRoot = path.join(root, "worktrees");
  mkdirSync(mainRepo, { recursive: true });
  mkdirSync(worktreeRoot, { recursive: true });

  mkdirSync(path.join(mainRepo, "node_modules"), { recursive: true });

  git(mainRepo, ["init", "-q", "--initial-branch=main"]);
  git(mainRepo, ["config", "commit.gpgsign", "false"]);
  mkdirSync(path.join(mainRepo, "wiki", "work-records"), { recursive: true });
  writeFileSync(path.join(mainRepo, ".gitignore"), "node_modules/\n");
  writeFileSync(
    path.join(mainRepo, "wiki", "work-records", `${RECORD_ID}.json`),
    `${JSON.stringify(canonicalRecord(), null, 2)}\n`
  );
  writeFileSync(path.join(mainRepo, DELIVERY_PATH), "seed\n");
  git(mainRepo, ["add", "-A"]);

  git(mainRepo, ["commit", "-qm", `chore(wiki): snapshot ${RECORD_ID} dispatch contract`]);
  const launcherBase = git(mainRepo, ["rev-parse", "HEAD"]);

  const scratch = path.join(root, "scratch");
  git(mainRepo, ["worktree", "add", "-q", "--detach", scratch, launcherBase]);
  const treeWith = (content) => {
    writeFileSync(path.join(scratch, DELIVERY_PATH), content);
    git(scratch, ["add", "-A"]);
    return git(scratch, ["write-tree"]);
  };

  const built = [];
  let parent = launcherBase;
  rounds.forEach((round, index) => {
    const tree = round.sameTreeAsParent === true
      ? built[built.length - 1].tree
      : treeWith(round.content ?? `corrective delivery ${index}\n`);
    const message = round.message ? round.message(parent) : deliveryMessage(parent);
    const sha = git(mainRepo, ["commit-tree", "-p", parent, "-m", message, tree]);
    built.push({ sha, tree });
    parent = sha;
  });

  const reviewed = built[built.length - 1];
  const attemptBase = built.length >= 2 ? built[built.length - 2] : { sha: launcherBase };
  const integrated = wkTipAt === null
    ? { sha: launcherBase, tree: git(mainRepo, ["rev-parse", `${launcherBase}^{tree}`]) }
    : built[wkTipAt];

  const wkTip = wkTipAt === null
    ? launcherBase
    : git(mainRepo, [
        "commit-tree", "-p", integrated.sha,
        "-m", `agent-launch zero-delta integration evidence: ${SUBJECT}`,
        integrated.tree
      ]);
  git(mainRepo, ["branch", WK_BRANCH, wkTip]);
  git(mainRepo, ["branch", SLICE_BRANCH, reviewed.sha]);

  const worktreePath = path.join(worktreeRoot, WORKTREE_DIR);
  git(mainRepo, ["worktree", "add", "-q", worktreePath, SLICE_BRANCH]);
  if (indexAt !== null) git(worktreePath, ["read-tree", built[indexAt].tree]);

  const sliceBinding = Object.freeze({
    schema_version: "worktree-identity-binding.v2",
    checkout_mode: "full",
    launch_ref: LAUNCH_REF,
    run_id: `${RUN_ID}.slice`,
    retry_id: 0,
    unit_address: UNIT_ADDRESS,
    initiative: INITIATIVE,
    record_id: RECORD_ID,
    slice_id: SLICE_ID,
    base_ref: WK_BRANCH,
    base_sha: attemptBase.sha,
    output_branch: SLICE_BRANCH,
    worktree_path: worktreePath,
    read_scope: [],
    repo_paths: [DELIVERY_PATH],
    write_scope: [DELIVERY_PATH],
    write_scope_source: `wiki/work-records/${RECORD_ID}.json#${SLICE_ID}`,
    selected_unit: Object.freeze({
      kind: "slice", address: SUBJECT, record_id: RECORD_ID, slice_id: SLICE_ID, repo: REPO_ID
    }),
    source_digest: `sha256:${"0".repeat(64)}`,
    source_version: null
  });
  const wkBinding = Object.freeze({
    schema_version: "worktree-identity-binding.v1",
    launch_ref: LAUNCH_REF,
    run_id: `${RUN_ID}.wk`,
    retry_id: 0,
    unit_address: `${INITIATIVE}/${RECORD_ID}`,
    initiative: INITIATIVE,
    record_id: RECORD_ID,
    slice_id: null,
    base_ref: "main",
    base_sha: launcherBase,
    output_branch: WK_BRANCH,
    worktree_path: path.join(worktreeRoot, `wk-${INITIATIVE}-${RECORD_ID}`),
    write_scope: [DELIVERY_PATH],
    write_scope_source: `wiki/work-records/${RECORD_ID}.json`,
    wk_tip_sha: wkTip
  });

  return {
    root, mainRepo, worktreeRoot, worktreePath, launcherBase, built,
    reviewedSha: reviewed.sha,
    reviewedTree: reviewed.tree,
    attemptBaseSha: attemptBase.sha,
    wkTip,
    accumulatedBaseSha: integrated.sha,
    accumulatedBaseTree: integrated.tree,
    sliceBinding,
    wkBinding,
    recordPath: path.join(mainRepo, "wiki", "work-records", `${RECORD_ID}.json`),
    provisioning: Object.freeze({
      record_id: RECORD_ID,
      slice_id: SLICE_ID,
      slice_binding: sliceBinding,
      wk_binding: wkBinding,
      validation_worktree_path: wkBinding.worktree_path
    }),
    status: Object.freeze({
      role: "worker",
      subject: SUBJECT,
      terminal: true,
      status: "succeeded",
      monitor_handle: LAUNCH_REF,
      run_id: RUN_ID
    }),
    indexTree: () => git(worktreePath, ["write-tree"]),
    readRecord: () => JSON.parse(readFileSync(path.join(mainRepo, "wiki", "work-records", `${RECORD_ID}.json`), "utf8"))
  };
}

function chainedCorrectiveFixture(t, suffix = "chained") {
  return buildFixture(t, {
    suffix,
    rounds: [
      { content: "round zero\n" },
      { content: "round one\n" },
      { sameTreeAsParent: true }
    ],
    wkTipAt: 0,
    indexAt: 0
  });
}

function firstRoundFixture(t, suffix = "first-round") {
  return buildFixture(t, {
    suffix,
    rounds: [{ content: "first round\n" }],
    wkTipAt: null,
    indexAt: null
  });
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
    refs: git(fx.mainRepo, ["for-each-ref", "--format=%(refname) %(objectname)"]),
    registration: git(fx.mainRepo, ["worktree", "list", "--porcelain"]),
    record: readFileSync(fx.recordPath, "utf8"),
    deliveries: fx.built.map((round) => git(fx.mainRepo, ["cat-file", "commit", round.sha]))
  };
}

const sliceReviewTargetKey = (context) => JSON.stringify([
  context.review_subject,
  context.reviewed_sha,
  context.diff_base_sha,
  context.committed_target_digest ?? context.worktree_identity_digest
]);

function composeBinder(fx, module = { createBackendSliceReview }) {
  const frozenSliceReviewContexts = new Map();
  const backend = module.createBackendSliceReview({
    frozenSliceReviewContexts,
    frozenReviewContexts: new Map(),
    worktreeProvisioningConfig: { mainRepo: fx.mainRepo, worktreeRoot: fx.worktreeRoot },
    reviewContextRunGit: defaultRunGit,
    sliceReviewRunContexts: new Map(),
    runs: new Map(),
    exactSliceReviewReceiptStore: null,
    sliceReviewTargetKey,
    postWorkerSliceLifecycle: null,
    attemptStateAuthority: null,
    lifecycle: null
  });
  return { backend, frozenSliceReviewContexts };
}

function realPreparationAdapter(fx) {
  return async (input) => ({
    accepted: true,
    preparation: await prepareSliceReviewSurface({
      mainRepo: fx.mainRepo,
      assignedUnit: input.assigned_unit,
      launchRef: input.launch_ref,
      runId: input.run_id,
      retryId: input.retry_id,
      deps: {
        resolveWorktreeBinding: () => fx.sliceBinding,
        digestWorktreeIdentity: () => IDENTITY_DIGEST,
        runGit: defaultSliceReviewRunGit
      }
    })
  });
}

function recordTransition(fx, writes) {
  return async ({ unitAddress, status }) => {
    writes.push({ unitAddress, status });
    assert.equal(unitAddress, SUBJECT);
    const record = fx.readRecord();
    record.slices[0].status = status;
    writeFileSync(fx.recordPath, `${JSON.stringify(record, null, 2)}\n`);
    return {
      valid: true, written: true, no_op: false, status,
      selected_unit: {
        kind: "slice", address: SUBJECT, record_id: RECORD_ID, slice_id: SLICE_ID, repo: REPO_ID
      }
    };
  };
}

function lifecycleDeps(fx, { binder, writes, extra = null }) {
  return {
    runGit: defaultRunGit,
    resolveManagedRunBinding: () => fx.provisioning,
    reconcileIntegratedSliceRecord: () => null,
    resolveCanonicalReviewUnit: () => null,
    bindFrozenReviewContext: () => null,
    resolveCanonicalSliceReviewUnit: ({ mainRepo, subject }) =>
      resolveCanonicalSliceReviewUnit(mainRepo, subject),
    bindFrozenSliceReviewContext: binder,
    setWorkRecordStatusByUnit: recordTransition(fx, writes),
    hostSliceReviewPreparationAdapter: realPreparationAdapter(fx),
    resolveCommittedSliceIntegrationContinuation: async () => null,
    hostSliceIntegrationAdapter: async () => {
      throw new Error("a parked slice review must never delegate integration");
    },
    ...(extra ?? {})
  };
}

function runLifecycle(fx, deps) {
  return runPostWorkerSliceLifecycle({
    workspace: { repo: REPO_ID, dir: fx.mainRepo },
    status: fx.status,
    deps
  });
}

function bindDirectly(fx, backend, sliceTarget, provisioning = fx.provisioning) {
  const record = fx.readRecord();
  if (record.slices[0].status !== "review") {
    record.slices[0].status = "review";
    writeFileSync(fx.recordPath, `${JSON.stringify(record, null, 2)}\n`);
  }
  const reviewUnit = resolveCanonicalSliceReviewUnit(fx.mainRepo, SUBJECT);
  return backend.bindFrozenSliceReviewContext({
    status: fx.status, provisioning, sliceTarget, reviewUnit
  });
}

function attemptTarget(fx, overrides = {}) {
  const sha = overrides.sha ?? fx.reviewedSha;
  const base = overrides.diff_base_sha ?? fx.attemptBaseSha;
  return Object.freeze({
    ref: overrides.ref ?? SLICE_REF,
    sha,
    diff_base_sha: base,
    diff_head_sha: sha,
    diff_range: `${base}..${sha}`,
    slice_level_review: true
  });
}

test("the fixture reproduces the retained WK-1790#SLICE-006 chained corrective topology", (t) => {
  const fx = chainedCorrectiveFixture(t, "topology");

  for (const round of fx.built) {
    const raw = execFileSync("git", ["cat-file", "commit", round.sha], { cwd: fx.mainRepo, encoding: "utf8" });
    const parent = raw.split("\n")[1].slice("parent ".length);
    assert.equal(deliveryMessage(parent), buildServerGeneratedCommitMessage({
      subject: SUBJECT, base_sha: parent
    }));
  }

  assert.equal(git(fx.mainRepo, ["rev-list", "--parents", "-n", "1", fx.reviewedSha]),
    `${fx.reviewedSha} ${fx.attemptBaseSha}`);
  assert.equal(git(fx.mainRepo, ["rev-parse", `${fx.reviewedSha}^{tree}`]),
    git(fx.mainRepo, ["rev-parse", `${fx.attemptBaseSha}^{tree}`]));

  assert.equal(fx.attemptBaseSha, fx.built[1].sha);
  assert.match(git(fx.mainRepo, ["show", "-s", "--format=%B", fx.attemptBaseSha]),
    new RegExp(`^agent-launch worker delivery: ${SUBJECT} `, "u"));

  assert.throws(
    () => git(fx.mainRepo, ["merge-base", "--is-ancestor", fx.attemptBaseSha, fx.wkTip]),
    "the persistent WK tip must not contain the current attempt base"
  );

  assert.equal(git(fx.mainRepo, ["merge-base", "--is-ancestor", fx.accumulatedBaseSha, fx.wkTip]), "");

  assert.equal(git(fx.mainRepo, ["merge-base", fx.wkTip, fx.reviewedSha]), fx.accumulatedBaseSha);
  assert.equal(fx.accumulatedBaseSha, fx.built[0].sha);

  assert.notEqual(fx.attemptBaseSha, fx.accumulatedBaseSha);

  assert.equal(fx.indexTree(), fx.accumulatedBaseTree);
  assert.notEqual(fx.indexTree(), fx.reviewedTree);
  assert.equal(git(fx.worktreePath, ["rev-parse", "HEAD^{tree}"]), fx.reviewedTree);
  assert.equal(git(fx.worktreePath, ["rev-parse", "HEAD"]), fx.reviewedSha);
  assert.equal(git(fx.mainRepo, ["rev-parse", SLICE_REF]), fx.reviewedSha);
  assert.equal(git(fx.mainRepo, ["rev-parse", WK_REF]), fx.wkTip);
});

test("the canonical committed-slice admission independently derives the ACCUMULATED base", (t) => {
  const fx = chainedCorrectiveFixture(t, "admission");
  const record = fx.readRecord();
  record.slices[0].status = "review";
  writeFileSync(fx.recordPath, `${JSON.stringify(record, null, 2)}\n`);
  const admission = resolveCommittedSliceReviewAdmission({
    mainRepo: fx.mainRepo,
    worktreeRoot: fx.worktreeRoot,
    subject: SUBJECT,
    reviewUnit: resolveCanonicalSliceReviewUnit(fx.mainRepo, SUBJECT),
    runGit: defaultRunGit
  });

  assert.equal(admission.target.diff_base_sha, fx.accumulatedBaseSha);
  assert.equal(admission.target.sha, fx.reviewedSha);
  assert.equal(admission.target.diff_range, `${fx.accumulatedBaseSha}..${fx.reviewedSha}`);
  assert.equal(admission.worktree_path, fx.worktreePath);
  assert.notEqual(admission.target.diff_base_sha, fx.sliceBinding.base_sha);

  assert.deepEqual([...admission.identity.commit_chain], [fx.attemptBaseSha, fx.reviewedSha]);
});

test("the chained corrective delivery reaches awaiting-slice-review on the ACCUMULATED review range", async (t) => {
  const fx = chainedCorrectiveFixture(t, "positive");
  const before = snapshot(fx);
  const { backend, frozenSliceReviewContexts } = composeBinder(fx);
  const writes = [];
  const deps = lifecycleDeps(fx, { binder: backend.bindFrozenSliceReviewContext, writes });

  const lifecycle = await runLifecycle(fx, deps);

  assert.equal(lifecycle.invoked, true);
  assert.equal(lifecycle.phase, "awaiting-slice-review");
  assert.equal(lifecycle.integrated, false);
  assert.equal(lifecycle.integration, null);
  assert.equal(lifecycle.reason, "coordinator_integration_request_required");

  assert.equal(lifecycle.empty_delivery, true);

  const surface = lifecycle.slice_review;
  assert.equal(surface.review_subject, SUBJECT);
  assert.equal(surface.reviewed_sha, fx.reviewedSha);
  assert.equal(surface.slice_ref, SLICE_REF);
  assert.equal(surface.slice_worktree_path, fx.worktreePath);

  assert.equal(surface.diff_base_sha, fx.accumulatedBaseSha);
  assert.deepEqual({ ...surface.frozen_slice_review_target }, {
    ref: SLICE_REF,
    sha: fx.reviewedSha,
    diff_base_sha: fx.accumulatedBaseSha,
    diff_head_sha: fx.reviewedSha,
    diff_range: `${fx.accumulatedBaseSha}..${fx.reviewedSha}`,
    slice_level_review: true
  });
  assert.deepEqual(
    { ...surface.reviewer_dispatch.context.frozen_slice_review_target },
    { ...surface.frozen_slice_review_target }
  );
  assert.equal(surface.reviewer_dispatch.context.workspace_dir, fx.worktreePath);
  assert.equal(lifecycle.reviewer_dispatch, surface.reviewer_dispatch);

  assert.equal(surface.worker_attempt_base_sha, fx.attemptBaseSha);
  assert.notEqual(surface.worker_attempt_base_sha, surface.diff_base_sha);

  const context = frozenSliceReviewContexts.get(SUBJECT);
  assert.equal(context.review_admission_kind, "canonical_committed_slice");
  assert.equal(context.reviewed_sha, fx.reviewedSha);
  assert.equal(context.diff_base_sha, fx.accumulatedBaseSha);
  assert.equal(context.diff_head_sha, fx.reviewedSha);
  assert.equal(context.diff_range, `${fx.accumulatedBaseSha}..${fx.reviewedSha}`);
  assert.equal(context.worker_attempt_base_sha, fx.attemptBaseSha);
  assert.equal(context.worktree_identity.diff_base_sha, fx.accumulatedBaseSha);
  assert.equal(context.source_worker_run_id, RUN_ID);
  assert.equal(context.source_worker_monitor_handle, LAUNCH_REF);

  const after = snapshot(fx);
  assert.deepEqual(writes, [{ unitAddress: SUBJECT, status: "review" }]);
  assert.equal(fx.readRecord().slices[0].status, "review");
  assert.equal(fx.readRecord().status, "active", "the PARENT WK stays active");
  assert.equal(fx.indexTree(), fx.reviewedTree);
  assert.notEqual(after.staged, before.staged);
  assert.deepEqual(after.files, before.files, "no physical worktree file may be written");
  assert.equal(after.refs, before.refs, "no ref anywhere in the repository may move");
  assert.equal(after.registration, before.registration);
  assert.deepEqual(after.deliveries, before.deliveries, "no delivery commit may be rewritten");
  assert.equal(git(fx.mainRepo, ["rev-parse", SLICE_REF]), fx.reviewedSha);
  assert.equal(git(fx.mainRepo, ["rev-parse", WK_REF]), fx.wkTip);
  assert.equal(git(fx.worktreePath, ["rev-parse", "HEAD"]), fx.reviewedSha);

  const settled = snapshot(fx);
  const second = await runLifecycle(fx, deps);
  assert.equal(second.phase, "awaiting-slice-review");
  assert.deepEqual({ ...second.slice_review.frozen_slice_review_target },
    { ...surface.frozen_slice_review_target });
  assert.equal(frozenSliceReviewContexts.get(SUBJECT), context);
  assert.deepEqual(snapshot(fx), settled, "the repeated poll must change nothing at all");
  assert.deepEqual(writes, [{ unitAddress: SUBJECT, status: "review" }]);
});

test("an ordinary first-round delivery, where the two bases coincide, is unchanged", async (t) => {
  const fx = firstRoundFixture(t, "preserved");
  assert.equal(fx.attemptBaseSha, fx.launcherBase);
  assert.equal(git(fx.mainRepo, ["merge-base", fx.wkTip, fx.reviewedSha]), fx.launcherBase);

  const { backend } = composeBinder(fx);
  const writes = [];
  const lifecycle = await runLifecycle(fx, lifecycleDeps(fx, {
    binder: backend.bindFrozenSliceReviewContext, writes
  }));
  assert.equal(lifecycle.phase, "awaiting-slice-review");
  const surface = lifecycle.slice_review;
  assert.equal(surface.diff_base_sha, fx.attemptBaseSha);
  assert.equal(surface.worker_attempt_base_sha, fx.attemptBaseSha);
  assert.equal(surface.frozen_slice_review_target.diff_range,
    `${fx.attemptBaseSha}..${fx.reviewedSha}`);
  assert.equal(lifecycle.empty_delivery, false, "a nonempty first-round delivery stays nonempty");
});

function expectBinderRefusal(fx, craft, expected) {
  const before = snapshot(fx);
  const { backend, frozenSliceReviewContexts } = composeBinder(fx);
  const { target, provisioning } = craft(fx);
  assert.throws(
    () => bindDirectly(fx, backend, target, provisioning ?? fx.provisioning),
    expected
  );
  assert.equal(frozenSliceReviewContexts.size, 0, "no frozen reviewer context may be bound");
  const after = snapshot(fx);

  assert.deepEqual({ ...after, record: null }, { ...before, record: null },
    "a refusal preserves refs, worktree files, index, registration, and deliveries exactly");
}

test("an attempt target base disagreeing with the provisioning binding refuses before reviewer spawn", (t) => {
  const fx = chainedCorrectiveFixture(t, "refuse-attempt-base");
  expectBinderRefusal(
    fx,

    () => ({ target: attemptTarget(fx, { diff_base_sha: fx.accumulatedBaseSha }) }),
    /frozen slice review target base does not match the launcher-owned current attempt provisioning binding/u
  );
});

test("a provisioning binding whose base disagrees with the attempt target refuses before reviewer spawn", (t) => {
  const fx = chainedCorrectiveFixture(t, "refuse-binding-base");
  expectBinderRefusal(
    fx,
    () => ({
      target: attemptTarget(fx),
      provisioning: Object.freeze({
        ...fx.provisioning,
        slice_binding: Object.freeze({ ...fx.sliceBinding, base_sha: fx.accumulatedBaseSha })
      })
    }),
    /frozen slice review target base does not match the launcher-owned current attempt provisioning binding/u
  );
});

test("a committed admission whose reviewed SHA disagrees with the attempt target refuses before reviewer spawn", (t) => {
  const fx = chainedCorrectiveFixture(t, "refuse-reviewed-sha");

  const sibling = git(fx.mainRepo, [
    "commit-tree", "-p", fx.attemptBaseSha,
    "-m", deliveryMessage(fx.attemptBaseSha),
    git(fx.mainRepo, ["rev-parse", `${fx.launcherBase}^{tree}`])
  ]);
  assert.notEqual(sibling, fx.reviewedSha);
  expectBinderRefusal(
    fx,
    () => ({ target: attemptTarget(fx, { sha: sibling }) }),
    /canonical committed-slice admission disagrees with the frozen worker target/u
  );
});

test("an attempt target naming another slice ref refuses before reviewer spawn", (t) => {
  const fx = chainedCorrectiveFixture(t, "refuse-ref");
  expectBinderRefusal(
    fx,
    () => ({ target: attemptTarget(fx, { ref: `refs/heads/slice/${INITIATIVE}/WK-9999/SLICE-001` }) }),
    /does not match managed provisioning and canonical slice-review identity/u
  );
});

test("a malformed, unauthenticated delivery chain refuses before reviewer spawn", (t) => {

  const fx = buildFixture(t, {
    suffix: "refuse-chain",
    rounds: [
      { content: "round zero\n" },
      { content: "round one\n" },
      { sameTreeAsParent: true, message: () => "fix stuff" }
    ],
    wkTipAt: 0,
    indexAt: 0
  });
  expectBinderRefusal(
    fx,
    () => ({ target: attemptTarget(fx) }),
    (error) => {
      assert.equal(error.name, "CommittedSliceReviewAdmissionError");
      assert.equal(error.detail.reason, "trusted_commit_binding_mismatch");
      return true;
    }
  );
});

test("a committed admission refusal fails the lifecycle closed with nothing bound or integrated", async (t) => {

  const fx = buildFixture(t, {
    suffix: "lifecycle-closed",
    rounds: [
      { content: "round zero\n" },
      { content: "round one\n" },
      { sameTreeAsParent: true, message: () => "fix stuff" }
    ],
    wkTipAt: 0,
    indexAt: null
  });
  const { backend, frozenSliceReviewContexts } = composeBinder(fx);
  const writes = [];
  await assert.rejects(
    () => runLifecycle(fx, lifecycleDeps(fx, { binder: backend.bindFrozenSliceReviewContext, writes })),
    (error) => error?.name === "CommittedSliceReviewAdmissionError"
  );
  assert.equal(frozenSliceReviewContexts.size, 0);
  assert.equal(git(fx.mainRepo, ["rev-parse", SLICE_REF]), fx.reviewedSha);
  assert.equal(git(fx.mainRepo, ["rev-parse", WK_REF]), fx.wkTip);
});

const EQUALITY_ANCHOR =
  "    if (reviewTarget.sha !== target.sha || reviewTarget.ref !== target.ref ||\n" +
  "        committedAdmission.worktree_path !== worktreePath) {";

async function loadBinderMutant(t, rewrites) {
  const lib = path.dirname(BINDER_MODULE_PATH);
  let source = readFileSync(BINDER_MODULE_PATH, "utf8");
  source = source.replaceAll(
    '"@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs"',
    JSON.stringify(path.join(REPO_ROOT, "packages", "wiki-core", "src", "lib", "runtime-blocker-taxonomy.mjs"))
  );
  source = source.replaceAll(/from "\.\/([^"]+)"/gu, (unused, name) =>
    `from ${JSON.stringify(path.join(lib, name))}`);
  for (const [from, to] of rewrites) {
    assert.ok(source.includes(from), `mutation anchor missing from the module: ${from}`);
    source = source.replace(from, to);
  }
  const dir = mkdtempSync(path.join(tmpdir(), "chained-corrective-mutant-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "mutant.mjs");
  writeFileSync(file, source);
  return import(pathToFileURL(file).href);
}

test("mutation witness: restoring the attempt-base/accumulated-base equality is killed by the chained topology", async (t) => {
  const mutant = await loadBinderMutant(t, [[
    EQUALITY_ANCHOR,
    EQUALITY_ANCHOR.replace(
      "reviewTarget.ref !== target.ref ||",
      "reviewTarget.ref !== target.ref ||\n        reviewTarget.diff_base_sha !== target.diff_base_sha ||"
    )
  ]]);
  assert.equal(typeof mutant.createBackendSliceReview, "function", "the mutant must import cleanly");

  const control = firstRoundFixture(t, "mutant-control");
  const controlBinder = composeBinder(control, mutant).backend;
  const controlLifecycle = await runLifecycle(control, lifecycleDeps(control, {
    binder: controlBinder.bindFrozenSliceReviewContext, writes: []
  }));
  assert.equal(controlLifecycle.phase, "awaiting-slice-review",
    "the mutant must still admit the ordinary first-round delivery");

  const attacked = chainedCorrectiveFixture(t, "mutant-attack");
  const mutantBinder = composeBinder(attacked, mutant).backend;
  await assert.rejects(
    () => runLifecycle(attacked, lifecycleDeps(attacked, {
      binder: mutantBinder.bindFrozenSliceReviewContext, writes: []
    })),
    (error) => {
      assert.match(error?.message ?? "",
        /canonical committed-slice admission disagrees with the frozen worker target/u);
      assert.equal(error?.name, "Error",
        "the kill must be the semantic binder refusal, never a Git or child-process fault");
      return true;
    }
  );

  const killed = chainedCorrectiveFixture(t, "mutant-production");
  const productionBinder = composeBinder(killed).backend;
  const lifecycle = await runLifecycle(killed, lifecycleDeps(killed, {
    binder: productionBinder.bindFrozenSliceReviewContext, writes: []
  }));
  assert.equal(lifecycle.phase, "awaiting-slice-review");
  assert.equal(lifecycle.slice_review.diff_base_sha, killed.accumulatedBaseSha);
  assert.equal(lifecycle.slice_review.reviewed_sha, killed.reviewedSha);
});

test("no mutant build ever rewrote the production binder bytes", () => {
  assert.equal(
    createHash("sha256").update(readFileSync(BINDER_MODULE_PATH)).digest("hex"),
    BINDER_BYTES_AT_LOAD
  );
});
