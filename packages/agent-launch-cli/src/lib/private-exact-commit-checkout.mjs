

import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  OID_RE,
  TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES,
  assertMode0700,
  assertPrivateCandidateRoot,
  fail,
  gitStdout,
  requireRunGit
} from "./terminal-materialization-primitives.mjs";

const PRIVATE_EXACT_COMMIT_CHECKOUT_SCHEMA_VERSION =
  "agent_launch.private_exact_commit_checkout.v1";

async function verifyPrivateExactCommitCheckout({ runGit, mainRepo, commit, checkoutPath, tree }) {
  const symbolic = await runGit({ repo: checkoutPath, args: ["symbolic-ref", "--quiet", "HEAD"] });
  if (symbolic?.ok === true) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
      "private exact-commit checkout HEAD must be detached", {
        symbolic_head: String(symbolic.stdout ?? "").trim()
      });
  }
  const probe = (repo, args, message) => gitStdout(runGit, repo, args, {
    code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED, message
  });
  const expectedTree = tree ?? await probe(mainRepo, ["rev-parse", "--verify", `${commit}^{tree}`],
    "could not resolve the authenticated exact commit tree");
  const checks = [
    ["head", await probe(checkoutPath, ["rev-parse", "--verify", "HEAD^{commit}"],
      "could not resolve private checkout HEAD"), commit],
    ["tree", await probe(checkoutPath, ["rev-parse", "--verify", "HEAD^{tree}"],
      "could not resolve private checkout tree"), expectedTree],
    ["index_tree", await probe(checkoutPath, ["write-tree"],
      "could not resolve private checkout index tree"), expectedTree],
    ["status", await probe(checkoutPath, ["status", "--porcelain=v1", "--untracked-files=all"],
      "could not inspect private checkout cleanliness"), ""]
  ];
  const mismatch = checks.find(([, actual, expected]) => actual !== expected);
  if (mismatch) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
      `private exact-commit checkout failed ${mismatch[0]} binding`, {
        field: mismatch[0], expected: mismatch[2], actual: mismatch[1]
      });
  }
  return expectedTree;
}

function makePrivateCheckoutWritable(target) {
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) return;
  try {
    chmodSync(target, stat.isDirectory() ? 0o700 : 0o600);
  } catch {
    return;
  }
  if (!stat.isDirectory()) return;
  let entries = [];
  try {
    entries = readdirSync(target);
  } catch {
    return;
  }
  for (const entry of entries) makePrivateCheckoutWritable(path.join(target, entry));
}

async function removePrivateExactCommitCheckout({ runGit, mainRepo, checkoutRoot, checkoutPath, created }) {
  let detail = null;
  makePrivateCheckoutWritable(checkoutRoot);

  let registrationRetained = false;
  if (created) {
    let removed = null;
    try {
      removed = await runGit({ repo: mainRepo, args: ["worktree", "remove", "--force", checkoutPath] });
    } catch (error) {
      detail = { step: "worktree_remove", error: error?.message ?? String(error) };
      registrationRetained = true;
    }
    if (detail === null && removed?.ok !== true) {
      detail = { step: "worktree_remove", status: removed?.status ?? null };
      registrationRetained = true;
    }
  }

  if (registrationRetained) {
    return { ...detail, registration_retained: true, checkout_path: checkoutPath };
  }
  try {
    rmSync(checkoutRoot, { recursive: true, force: true });
  } catch (error) {
    detail = { step: "remove", errno: error?.code ?? null };
  }
  if (existsSync(checkoutRoot)) detail = detail ?? { step: "residue" };
  return detail;
}

export async function withPrivateExactCommitCheckout(
  { mainRepo, commit, checkoutRoot, runGit } = {}, use
) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo)) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARG,
      "mainRepo must be an absolute path");
  }
  if (typeof commit !== "string" || !OID_RE.test(commit) || /^0+$/u.test(commit)) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARG,
      "the exact commit is not a canonical object id", { commit: commit ?? null });
  }
  if (typeof use !== "function") {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARG,
      "a private exact-commit checkout is only materialized for one bounded use");
  }
  assertPrivateCandidateRoot({ binding: { main_repo: mainRepo }, candidateRoot: checkoutRoot });
  const git = requireRunGit(runGit);
  if (existsSync(checkoutRoot)) {
    fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARG,
      "a private exact-commit checkout root must not already exist",
      { checkout_root: checkoutRoot });
  }
  const checkoutPath = path.join(checkoutRoot, "checkout");
  mkdirSync(checkoutRoot, { recursive: true, mode: 0o700 });
  chmodSync(checkoutRoot, 0o700);
  let created = false;
  let settled = false;
  try {
    await gitStdout(git, mainRepo, ["worktree", "add", "--detach", checkoutPath, commit], {
      code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
      message: "could not create the private detached exact-commit checkout"
    });
    created = true;
    chmodSync(checkoutPath, 0o700);
    assertMode0700(checkoutRoot, "private checkout root");
    assertMode0700(checkoutPath, "private checkout");
    const tree = await verifyPrivateExactCommitCheckout({
      runGit: git, mainRepo, commit, checkoutPath, tree: null
    });
    const materialization = Object.freeze({
      schema_version: PRIVATE_EXACT_COMMIT_CHECKOUT_SCHEMA_VERSION,
      checkout_root: checkoutRoot,
      checkout_path: checkoutPath,
      main_repo: mainRepo,
      commit,
      tree,
      detached: true,
      full_checkout: true,
      mode: 0o700,
      verified: true
    });
    const result = await use(materialization);
    await verifyPrivateExactCommitCheckout({
      runGit: git, mainRepo, commit, checkoutPath, tree
    });
    settled = true;
    return result;
  } finally {
    const teardown = await removePrivateExactCommitCheckout({
      runGit: git, mainRepo, checkoutRoot, checkoutPath, created
    });
    if (settled && teardown !== null) {
      fail(TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
        "the private exact-commit checkout could not be removed",
        { checkout_root: checkoutRoot, ...teardown });
    }
  }
}
