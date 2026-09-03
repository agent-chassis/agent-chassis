

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runGitAsync } from "../../../agent-launch-core/src/lib/git.mjs";

import {
  SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION,
  SLICE_REVIEW_SURFACE_PREPARATION_VERIFIED_PARTS
} from "./trusted-operation-contracts.mjs";
import {
  resolveCommitGitIdentity,
  verifyExactSliceCommitBinding
} from "./exact-slice-commit-binding.mjs";

import {
  failSliceReviewMaterialization as fail,
  HISTORICAL_DELIVERY_INDEX_RECOVERY,
  SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES,
  SLICE_REVIEW_POSTCHECK_STATE_BUDGET
} from "./slice-review-materialization-contract.mjs";

export {
  HISTORICAL_DELIVERY_INDEX_RECOVERY,
  isSliceReviewMaterializationError,
  SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES,
  SLICE_REVIEW_MATERIALIZATION_ERROR_NAME,
  SLICE_REVIEW_POSTCHECK_STATE_BUDGET,
  SliceReviewMaterializationError
} from "./slice-review-materialization-contract.mjs";

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function gitEnvironment({ indexFile = null, objectDirectory = null, alternates = null } = {}) {
  const env = { ...process.env };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES"
  ]) {
    delete env[key];
  }
  if (indexFile !== null) env.GIT_INDEX_FILE = indexFile;
  if (objectDirectory !== null) env.GIT_OBJECT_DIRECTORY = objectDirectory;
  if (alternates !== null) env.GIT_ALTERNATE_OBJECT_DIRECTORIES = alternates;
  return env;
}

export async function defaultSliceReviewRunGit({
  repo = null,
  gitDir = null,
  workTree = null,
  args,
  indexFile = null,
  objectDirectory = null,
  alternates = null
}) {
  const result = await runGitAsync({
    repo,
    gitDir,
    workTree,
    args,
    env: gitEnvironment({ indexFile, objectDirectory, alternates }),
    maxBuffer: 1024 * 1024
  });
  if (result.error) {
    return {
      ok: false,
      status: null,
      stdout: "",
      stderr: "",
      error: result.overflow === true ? `ENOBUFS: ${result.error}` : result.error,
      ...(result.overflow === true ? { overflow: true } : {})
    };
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

async function loadDefaultDeps() {
  const [substrate, receipts] = await Promise.all([
    import("./worktree-substrate.mjs"),
    import("./workspace-agent-dispatch-run-receipt.mjs")
  ]);
  return {
    resolveWorktreeBinding: substrate.resolveWorktreeBinding,
    digestWorktreeIdentity: receipts.digestTrustedExactReviewEvidence,
    runGit: defaultSliceReviewRunGit
  };
}

async function gitResult(runGit, context, args, { code, message, allow = [] } = {}) {
  const result = await runGit({ ...context, args });
  if (result?.ok === true || allow.includes(result?.status)) return result;
  fail(code, message, {
    args,
    status: result?.status ?? null,
    stderr: result?.stderr ?? result?.error ?? null
  });
}

async function gitOutput(runGit, context, args, options) {
  return String((await gitResult(runGit, context, args, options)).stdout ?? "").trim();
}

function assertOid(value, label, code = SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH) {
  if (typeof value !== "string" || !OID_RE.test(value) || /^0+$/u.test(value)) {
    fail(code, `${label} is not a canonical Git object id`, { value: value ?? null });
  }
  return value;
}

function parseWorktreeRegistrations(raw) {
  const records = [];
  let current = {};
  for (const token of String(raw ?? "").split("\0")) {
    if (token === "") {
      if (Object.keys(current).length > 0) records.push(current);
      current = {};
      continue;
    }
    const separator = token.indexOf(" ");
    const key = separator === -1 ? token : token.slice(0, separator);
    const value = separator === -1 ? true : token.slice(separator + 1);
    if (Object.prototype.hasOwnProperty.call(current, key)) {
      fail(
        SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
        "Git worktree registration contains a duplicate field",
        { field: key }
      );
    }
    current[key] = value;
  }
  if (Object.keys(current).length > 0) records.push(current);
  return records;
}

async function worktreeRegistrationSnapshot(runGit, mainRepo) {
  const result = await gitResult(runGit, { repo: mainRepo }, ["worktree", "list", "--porcelain", "-z"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
    message: "could not enumerate registered Git worktrees"
  });

  return { records: parseWorktreeRegistrations(result.stdout) };
}

function targetRegistrationFingerprint(record) {
  return JSON.stringify({
    worktree: typeof record.worktree === "string" ? record.worktree : null,
    HEAD: typeof record.HEAD === "string" ? record.HEAD : null,
    branch: typeof record.branch === "string" ? record.branch : null,
    bare: Object.prototype.hasOwnProperty.call(record, "bare"),
    detached: Object.prototype.hasOwnProperty.call(record, "detached"),
    locked: Object.prototype.hasOwnProperty.call(record, "locked"),
    prunable: Object.prototype.hasOwnProperty.call(record, "prunable")
  });
}

async function classifySequencerState(runGit, gitContext) {
  for (const pseudoref of SLICE_REVIEW_POSTCHECK_STATE_BUDGET.refused_pseudorefs) {
    if (typeof gitContext?.gitDir !== "string" || !path.isAbsolute(gitContext.gitDir)) {
      fail(
        SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
        "could not resolve the retained slice worktree operation-state path",
        { pseudoref }
      );
    }
    const located = await runGit({
      ...gitContext,
      args: ["rev-parse", "--path-format=absolute", "--git-path", pseudoref]
    });
    const location = located?.ok === true ? String(located.stdout ?? "").trim() : "";
    if (location.length === 0 || !path.isAbsolute(location)) {
      fail(
        SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
        "could not resolve the retained slice worktree operation-state path",
        { pseudoref }
      );
    }
    let present = false;
    for (const candidate of new Set([path.join(gitContext.gitDir, pseudoref), location])) {
      try {
        lstatSync(candidate);
        present = true;
      } catch (error) {

        if (error?.code !== "ENOENT") {
          fail(
            SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
            "could not classify retained slice worktree operation state",
            { pseudoref }
          );
        }
      }
    }

    if (!present) {
      const resolved = await runGit({ ...gitContext, args: ["rev-parse", "--verify", "--quiet", pseudoref] });
      present = resolved?.ok === true && String(resolved.stdout ?? "").trim().length > 0;
    }
    if (present) {
      fail(
        SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
        "retained slice worktree has in-progress Git operation state",
        { pseudoref }
      );
    }
  }
  return "clean";
}

async function resolveObjectStoreIdentity(runGit, gitContext) {
  const objectPath = await gitOutput(runGit, gitContext, ["rev-parse", "--path-format=absolute", "--git-path", "objects"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
    message: "could not resolve the canonical Git object directory"
  });
  const commonPath = await gitOutput(runGit, gitContext, ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
    message: "could not resolve the canonical Git common directory"
  });
  let objectDirectory;
  let commonDirectory;
  try {
    objectDirectory = realpathSync(objectPath);
    commonDirectory = realpathSync(commonPath);
  } catch (error) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
      "canonical Git object or common directory is missing or unreadable",
      null,
      error
    );
  }
  let objectAlternates;
  try {
    objectAlternates = `present:${readFileSync(path.join(objectDirectory, "info", "alternates"), "utf8")}`;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      fail(
        SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
        "could not classify the canonical Git object alternates",
        null,
        error
      );
    }
    objectAlternates = "absent";
  }
  return { objectDirectory, commonDirectory, objectAlternates };
}

async function physicalTreeFromIsolatedIndex({ runGit, gitContext, reviewedSha, objectDirectory }) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "slice-review-surface-"));
  const indexFile = path.join(tempRoot, "index");
  const temporaryObjects = path.join(tempRoot, "objects");
  mkdirSync(temporaryObjects);
  const isolated = {
    ...gitContext,
    indexFile,
    objectDirectory: temporaryObjects,
    alternates: objectDirectory
  };
  try {
    await gitResult(runGit, isolated, ["read-tree", reviewedSha], {
      code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PHYSICAL_TREE_REFUSED,
      message: "could not seed the isolated physical-tree index"
    });
    for (const args of [
      ["ls-files", "--others", "--exclude-standard", "--directory", "--no-empty-directory"],
      ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory"]
    ]) {
      const unexpected = await gitOutput(runGit, isolated, args, {
        code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PHYSICAL_TREE_REFUSED,
        message: "could not inspect unexpected worktree content"
      });
      if (unexpected.length > 0) {
        fail(
          SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PHYSICAL_TREE_REFUSED,
          "retained slice worktree contains unexpected untracked content",
          { path: unexpected.split("\n", 1)[0] }
        );
      }
    }
    await gitResult(runGit, isolated, ["add", "-A", "--"], {
      code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PHYSICAL_TREE_REFUSED,
      message: "could not measure the physical checkout through the isolated index"
    });
    return assertOid(await gitOutput(runGit, isolated, ["write-tree"], {
      code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PHYSICAL_TREE_REFUSED,
      message: "could not write the isolated physical checkout tree"
    }), "physical checkout tree");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function resolveTrustedState({
  mainRepo,
  assignedUnit,
  launchRef,
  runId,
  retryId,
  resolveWorktreeBinding,
  digestWorktreeIdentity,
  runGit
}) {
  let rawBinding;
  let binding;
  try {
    rawBinding = resolveWorktreeBinding({
      mainRepo,
      launchRef,
      runId: `${runId}.slice`,
      retryId
    });
    binding = verifyExactSliceCommitBinding({
      binding: rawBinding,
      mainRepo,
      assignedUnit,
      launchRef,
      runId: `${runId}.slice`,
      retryId
    });
  } catch (error) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "could not resolve and verify the exact launcher-bound slice identity",
      null,
      error
    );
  }
  if (binding.schema_version !== "worktree-identity-binding.v2" ||
      binding.checkout_mode !== "full") {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "slice review preparation requires the retained v2/full worktree binding"
    );
  }
  let worktreeIdentityDigest;
  try {
    worktreeIdentityDigest = digestWorktreeIdentity(rawBinding);
  } catch (error) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "could not derive the exact worktree identity digest",
      null,
      error
    );
  }
  if (typeof worktreeIdentityDigest !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(worktreeIdentityDigest)) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "worktree identity digest is unavailable or malformed"
    );
  }
  let canonicalWorktreePath;
  try {
    canonicalWorktreePath = realpathSync(binding.worktree_path);
  } catch (error) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
      "retained slice worktree path is missing or unreadable",
      { worktree_path: binding.worktree_path },
      error
    );
  }
  if (canonicalWorktreePath !== binding.worktree_path ||
      path.normalize(binding.worktree_path) !== binding.worktree_path) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
      "retained slice worktree path moved or is not canonical"
    );
  }
  const sliceRef = binding.output_branch.startsWith("refs/heads/")
    ? binding.output_branch
    : `refs/heads/${binding.output_branch}`;
  const registration = await worktreeRegistrationSnapshot(runGit, mainRepo);
  const matchingRegistrations = registration.records.filter(
    (record) => record.worktree === canonicalWorktreePath
  );
  if (matchingRegistrations.length !== 1 ||
      matchingRegistrations[0].branch !== sliceRef ||
      Object.prototype.hasOwnProperty.call(matchingRegistrations[0], "detached") ||
      Object.prototype.hasOwnProperty.call(matchingRegistrations[0], "prunable") ||
      Object.prototype.hasOwnProperty.call(matchingRegistrations[0], "locked")) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
      "retained slice worktree registration is missing, moved, detached, locked, or mismatched"
    );
  }
  const expectedGit = resolveCommitGitIdentity(binding, mainRepo);
  const actualGitDir = await gitOutput(runGit, { repo: canonicalWorktreePath }, ["rev-parse", "--absolute-git-dir"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
    message: "could not resolve the retained linked-worktree Git directory"
  });
  const topLevel = await gitOutput(runGit, { repo: canonicalWorktreePath }, ["rev-parse", "--show-toplevel"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
    message: "could not resolve the retained linked-worktree top level"
  });
  let actualGitDirectory;
  let expectedGitDirectory;
  let actualTopLevel;
  try {
    actualGitDirectory = realpathSync(actualGitDir);
    expectedGitDirectory = realpathSync(expectedGit.gitDir);
    actualTopLevel = realpathSync(topLevel);
  } catch (error) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
      "retained linked-worktree Git association is missing or unreadable",
      null,
      error
    );
  }
  if (actualGitDirectory !== expectedGitDirectory || actualTopLevel !== canonicalWorktreePath) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
      "retained path is not the registered exact linked worktree"
    );
  }
  const gitContext = { gitDir: actualGitDir, workTree: canonicalWorktreePath };
  const symbolicHead = await gitOutput(runGit, gitContext, ["symbolic-ref", "-q", "HEAD"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
    message: "retained slice worktree HEAD is detached or unreadable"
  });
  const reviewedSha = assertOid(await gitOutput(runGit, gitContext, ["rev-parse", "--verify", `${sliceRef}^{commit}`], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
    message: "could not resolve the exact reviewed slice ref"
  }), "reviewed slice SHA");
  const headSha = assertOid(await gitOutput(runGit, gitContext, ["rev-parse", "--verify", "HEAD^{commit}"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
    message: "could not resolve retained slice HEAD"
  }), "slice HEAD SHA");
  if (symbolicHead !== sliceRef || headSha !== reviewedSha ||
      matchingRegistrations[0].HEAD !== reviewedSha) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
      "symbolic HEAD, slice ref, registration, and reviewed SHA do not agree"
    );
  }
  for (const [object, type] of [
    [binding.base_sha, "commit"],
    [reviewedSha, "commit"]
  ]) {
    const actualType = await gitOutput(runGit, gitContext, ["cat-file", "-t", object], {
      code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
      message: "required slice object is missing or unreadable"
    });
    if (actualType !== type) {
      fail(SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
        "required slice object has the wrong Git type", { object, expected: type, actual: actualType });
    }
  }
  const parents = (await gitOutput(runGit, gitContext, ["rev-list", "--parents", "-n", "1", reviewedSha], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
    message: "could not resolve the reviewed slice parent"
  })).split(/\s+/u);
  if (parents.length !== 2 || parents[0] !== reviewedSha || parents[1] !== binding.base_sha) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
      "reviewed slice commit does not have the exact launcher-bound base parent"
    );
  }
  const baseTree = assertOid(await gitOutput(runGit, gitContext, ["rev-parse", "--verify", `${binding.base_sha}^{tree}`], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
    message: "could not resolve the exact base tree"
  }), "base tree");
  const reviewedTree = assertOid(await gitOutput(runGit, gitContext, ["rev-parse", "--verify", `${reviewedSha}^{tree}`], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
    message: "could not resolve the reviewed tree"
  }), "reviewed tree");
  if (await gitOutput(runGit, gitContext, ["cat-file", "-t", reviewedTree], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
    message: "reviewed tree object is missing"
  }) !== "tree") {
    fail(SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
      "reviewed tree object has the wrong Git type");
  }
  const { objectDirectory, commonDirectory, objectAlternates } =
    await resolveObjectStoreIdentity(runGit, gitContext);
  return Object.freeze({
    rawBinding,
    binding,
    worktreeIdentityDigest,
    canonicalWorktreePath,
    sliceRef,
    headSymbolicRef: symbolicHead,
    headSha,
    reviewedSha,
    reviewedTree,
    baseSha: binding.base_sha,
    baseTree,
    gitContext,
    gitDir: actualGitDir,
    commonDirectory,
    objectDirectory,
    objectAlternates,
    targetRegistration: targetRegistrationFingerprint(matchingRegistrations[0]),
    sequencerState: await classifySequencerState(runGit, gitContext)
  });
}

const LITERAL_TREE_HEADER = "tree ";
const LITERAL_PARENT_HEADER = "parent ";

let canonicalDeliveryMintPoint = null;
async function loadCanonicalDeliveryMintPoint() {
  if (canonicalDeliveryMintPoint === null) {
    const guard = await import("./commit-tool-exposure-guard.mjs");
    canonicalDeliveryMintPoint = Object.freeze({
      buildServerGeneratedCommitMessage: guard.buildServerGeneratedCommitMessage,
      buildWkSliceMarkerTrailer: guard.buildWkSliceMarkerTrailer
    });
  }
  return canonicalDeliveryMintPoint;
}

function refuseIndexState(message, detail = null, cause = null) {
  fail(SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INDEX_STATE_REFUSED, message, detail, cause);
}

async function literalObjectType(runGit, gitContext, oid, cache) {
  if (cache.has(oid)) return cache.get(oid);
  const result = await runGit({
    ...gitContext,
    args: [...HISTORICAL_DELIVERY_INDEX_RECOVERY.literal_object_read_options, "cat-file", "-t", oid]
  });
  const type = result?.ok === true ? String(result.stdout ?? "").trim() : null;
  cache.set(oid, type);
  return type;
}

function parseLiteralDeliveryCommit(raw, oid) {
  const text = String(raw ?? "");
  const boundary = text.indexOf("\n\n");
  if (boundary === -1) {
    refuseIndexState("historical commit object has no literal header/message boundary", { object: oid });
  }
  const headerLines = text.slice(0, boundary).split("\n");
  const message = text.slice(boundary + 2);
  const treeLine = headerLines[0] ?? "";
  const parentLine = headerLines[1] ?? "";
  if (!treeLine.startsWith(LITERAL_TREE_HEADER) || !parentLine.startsWith(LITERAL_PARENT_HEADER)) {
    refuseIndexState("historical commit is not a literal single-parent commit object", { object: oid });
  }
  for (const line of headerLines.slice(2)) {
    if (line.startsWith(LITERAL_PARENT_HEADER) || line.startsWith(LITERAL_TREE_HEADER)) {
      refuseIndexState("historical commit carries extra literal tree/parent headers", { object: oid });
    }
  }
  const code = SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INDEX_STATE_REFUSED;
  return Object.freeze({
    tree: assertOid(treeLine.slice(LITERAL_TREE_HEADER.length), "historical commit tree", code),
    parent: assertOid(parentLine.slice(LITERAL_PARENT_HEADER.length), "historical commit parent", code),
    message
  });
}

function assertCanonicalServerMintedDelivery(mint, subject, oid, commit) {
  const canonical = mint.buildServerGeneratedCommitMessage({ subject, base_sha: commit.parent });
  if (commit.message !== `${canonical}\n`) {
    refuseIndexState("commit is not an exact canonical server-minted delivery for this slice", {
      object: oid
    });
  }
}

async function resolveFixedWkFork(runGit, gitContext, binding) {
  const ref = `refs/agent-launch/wk-forks/${binding.initiative}/${binding.record_id}`;
  const symbolic = await runGit({
    ...gitContext,
    args: [...HISTORICAL_DELIVERY_INDEX_RECOVERY.literal_object_read_options, "symbolic-ref", "-q", ref]
  });
  if (symbolic?.ok === true) {
    refuseIndexState("the launcher-owned WK fork ref is symbolic", { ref });
  }
  const target = await runGit({
    ...gitContext,
    args: [...HISTORICAL_DELIVERY_INDEX_RECOVERY.literal_object_read_options, "show-ref", "--verify", "--hash", ref]
  });
  if (target?.ok !== true) return null;
  const sha = assertOid(String(target.stdout ?? "").trim(), "launcher-owned WK fork commit",
    SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INDEX_STATE_REFUSED);
  if (await literalObjectType(runGit, gitContext, sha, new Map()) !== "commit") {
    refuseIndexState("the launcher-owned WK fork ref does not name a commit", { ref });
  }
  const tree = assertOid(await gitOutput(runGit, gitContext,
    [...HISTORICAL_DELIVERY_INDEX_RECOVERY.literal_object_read_options, "rev-parse", "--verify", `${sha}^{tree}`], {
      code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INDEX_STATE_REFUSED,
      message: "could not resolve the launcher-owned WK fork tree"
    }), "launcher-owned WK fork tree", SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INDEX_STATE_REFUSED);
  if (await literalObjectType(runGit, gitContext, tree, new Map()) !== "tree") {
    refuseIndexState("the launcher-owned WK fork tree object is missing or is not a tree", { ref });
  }
  return Object.freeze({ ref, sha, tree });
}

async function authenticateHistoricalDeliveryIndexTree({
  runGit,
  gitContext,
  subject,
  reviewedSha,
  reviewedTree,
  baseSha,
  baseTree,
  ordinaryIndexTree,
  binding
}) {
  let mint;
  try {
    mint = await loadCanonicalDeliveryMintPoint();
  } catch (error) {
    refuseIndexState("the canonical delivery mint point is unavailable", null, error);
  }

  if (typeof subject !== "string" || mint.buildWkSliceMarkerTrailer(subject) === null) {
    refuseIndexState("historical index authentication requires a canonical managed slice subject");
  }
  const fixedFork = await resolveFixedWkFork(runGit, gitContext, binding);
  const types = new Map();
  const commits = new Map();
  const visited = new Set();
  let cursor = reviewedSha;
  for (let depth = 0; depth < HISTORICAL_DELIVERY_INDEX_RECOVERY.max_suffix_commits; depth += 1) {
    if (visited.has(cursor)) {
      refuseIndexState("historical delivery suffix is cyclic", { object: cursor, depth });
    }
    visited.add(cursor);
    if (await literalObjectType(runGit, gitContext, cursor, types) !== "commit") {
      refuseIndexState("historical delivery suffix object is missing or is not a commit", {
        object: cursor,
        depth
      });
    }

    if (fixedFork !== null && cursor === fixedFork.sha) {
      if (depth === 0 || ordinaryIndexTree !== fixedFork.tree) {
        refuseIndexState(
          depth === 0
            ? "the authenticated suffix reached an invalid launcher-owned WK fork terminal"
            : "ordinary index is not the authenticated launcher-owned WK fork tree",
          { depth }
        );
      }
      return Object.freeze({
        historical_sha: cursor,
        historical_tree: fixedFork.tree,
        suffix_depth: depth
      });
    }
    let commit = commits.get(cursor);
    if (commit === undefined) {
      const read = await runGit({
        ...gitContext,
        args: [...HISTORICAL_DELIVERY_INDEX_RECOVERY.literal_object_read_options, "cat-file", "commit", cursor]
      });
      if (read?.ok !== true) {
        refuseIndexState("could not read the literal historical delivery commit object", {
          object: cursor,
          depth
        });
      }
      commit = parseLiteralDeliveryCommit(read.stdout, cursor);
      commits.set(cursor, commit);
    }
    assertCanonicalServerMintedDelivery(mint, subject, cursor, commit);

    if (depth === 0 && (commit.tree !== reviewedTree || commit.parent !== baseSha)) {
      refuseIndexState("the reviewed delivery does not literally head the authenticated suffix");
    }
    if (depth === 1 && (cursor !== baseSha || commit.tree !== baseTree)) {
      refuseIndexState("the authenticated binding base does not literally follow the reviewed delivery");
    }
    if (commit.tree === ordinaryIndexTree) {
      if (await literalObjectType(runGit, gitContext, commit.tree, types) !== "tree") {
        refuseIndexState("historical delivery tree is missing or is not a tree object", {
          object: commit.tree
        });
      }
      return Object.freeze({ historical_sha: cursor, historical_tree: commit.tree, suffix_depth: depth });
    }
    cursor = commit.parent;
  }
    refuseIndexState("no authenticated historical launcher delivery within the fixed traversal bound", {
    bound: HISTORICAL_DELIVERY_INDEX_RECOVERY.max_suffix_commits
  });
}

async function assertHistoricalRecoveryStillBound(runGit, before, ordinaryIndexTree) {
  const options = {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INDEX_STATE_REFUSED,
    message: "could not re-prove the bound review surface before historical index reconciliation"
  };
  const symbolicHead = await gitOutput(runGit, before.gitContext, ["symbolic-ref", "-q", "HEAD"], options);
  const sliceSha = await gitOutput(runGit, before.gitContext,
    ["rev-parse", "--verify", `${before.sliceRef}^{commit}`], options);
  const headSha = await gitOutput(runGit, before.gitContext, ["rev-parse", "--verify", "HEAD^{commit}"], options);
  const indexTree = await gitOutput(runGit, before.gitContext, ["write-tree"], options);
  if (symbolicHead !== before.headSymbolicRef || sliceSha !== before.reviewedSha ||
      headSha !== before.headSha || indexTree !== ordinaryIndexTree) {
    refuseIndexState(
      "the bound slice ref, HEAD, or ordinary index moved during historical index authentication"
    );
  }
}

function assertSameTrustedState(before, after) {
  for (const field of SLICE_REVIEW_POSTCHECK_STATE_BUDGET.bound_fields) {
    if (!Object.prototype.hasOwnProperty.call(before, field) ||
        !Object.prototype.hasOwnProperty.call(after, field)) {
      fail(
        SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED,
        "declared bound review-surface state was not produced for comparison",
        { field }
      );
    }
    if (before[field] !== after[field]) {
      fail(
        SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED,
        "trusted slice/worktree/ref state changed during review-surface preparation",
        { field }
      );
    }
  }
}

export async function prepareSliceReviewSurface({
  mainRepo,
  assignedUnit,
  launchRef,
  runId,
  retryId,
  deps = null
} = {}) {
  if (typeof mainRepo !== "string" || !path.isAbsolute(mainRepo) ||
      typeof assignedUnit !== "string" || !/^WK-\d{4}#SLICE-\d{3}$/u.test(assignedUnit) ||
      typeof launchRef !== "string" || launchRef.length === 0 ||
      typeof runId !== "string" || runId.length === 0 ||
      runId.endsWith(".slice") || runId.endsWith(".wk") ||
      !Number.isInteger(retryId) || retryId < 0) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARGUMENT,
      "preparation requires the canonical main repo and exact base launcher tuple"
    );
  }
  const loaded = deps ?? await loadDefaultDeps();
  const resolveWorktreeBinding = loaded.resolveWorktreeBinding;
  const digestWorktreeIdentity = loaded.digestWorktreeIdentity;
  const runGit = loaded.runGit ?? defaultSliceReviewRunGit;
  if (typeof resolveWorktreeBinding !== "function" ||
      typeof digestWorktreeIdentity !== "function" || typeof runGit !== "function") {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INVALID_ARGUMENT,
      "trusted binding, digest, and Git dependencies are required"
    );
  }
  const identity = { mainRepo, assignedUnit, launchRef, runId, retryId };
  const before = await resolveTrustedState({
    ...identity,
    resolveWorktreeBinding,
    digestWorktreeIdentity,
    runGit
  });
  const indexLock = path.join(before.gitDir, "index.lock");
  if (existsSync(indexLock)) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INDEX_LOCKED,
      "ordinary linked-worktree index is locked; refusing without deleting the lock"
    );
  }
  const physicalBefore = await physicalTreeFromIsolatedIndex({
    runGit,
    gitContext: before.gitContext,
    reviewedSha: before.reviewedSha,
    objectDirectory: before.objectDirectory
  });
  if (physicalBefore !== before.reviewedTree) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PHYSICAL_TREE_REFUSED,
      "physical checkout does not exactly materialize the reviewed commit tree",
      { expected: before.reviewedTree, actual: physicalBefore }
    );
  }
  const ordinaryIndexTree = assertOid(await gitOutput(runGit, before.gitContext, ["write-tree"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INDEX_STATE_REFUSED,
    message: "could not compute the ordinary linked-worktree index tree"
  }), "ordinary index tree", SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INDEX_STATE_REFUSED);

  if (ordinaryIndexTree !== before.baseTree && ordinaryIndexTree !== before.reviewedTree) {
    await authenticateHistoricalDeliveryIndexTree({
      runGit,
      gitContext: before.gitContext,
      subject: before.binding.subject,
      reviewedSha: before.reviewedSha,
      reviewedTree: before.reviewedTree,
      baseSha: before.baseSha,
      baseTree: before.baseTree,
      ordinaryIndexTree,
      binding: before.binding
    });
    await assertHistoricalRecoveryStillBound(runGit, before, ordinaryIndexTree);
  }
  if (ordinaryIndexTree !== before.reviewedTree) {
    if (existsSync(indexLock)) {
      fail(
        SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INDEX_LOCKED,
        "ordinary linked-worktree index became locked before preparation"
      );
    }
    await gitResult(runGit, before.gitContext, ["read-tree", before.reviewedSha], {
      code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PREPARE_FAILED,
      message: "git read-tree could not align the ordinary index with the reviewed commit"
    });
  }
  if (existsSync(indexLock)) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED,
      "ordinary linked-worktree index lock remained after preparation"
    );
  }
  const after = await resolveTrustedState({
    ...identity,
    resolveWorktreeBinding,
    digestWorktreeIdentity,
    runGit
  });
  assertSameTrustedState(before, after);
  const headTree = assertOid(await gitOutput(runGit, after.gitContext, ["rev-parse", "--verify", "HEAD^{tree}"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED,
    message: "could not resolve the post-preparation HEAD tree"
  }), "post-preparation HEAD tree");
  const postIndexTree = assertOid(await gitOutput(runGit, after.gitContext, ["write-tree"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED,
    message: "could not resolve the post-preparation ordinary index tree"
  }), "post-preparation ordinary index tree");
  const physicalAfter = await physicalTreeFromIsolatedIndex({
    runGit,
    gitContext: after.gitContext,
    reviewedSha: after.reviewedSha,
    objectDirectory: after.objectDirectory
  });
  if (headTree !== after.reviewedTree || postIndexTree !== after.reviewedTree ||
      physicalAfter !== after.reviewedTree || physicalAfter !== physicalBefore) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED,
      "HEAD, ordinary index, and physical checkout are not the exact unchanged reviewed tree"
    );
  }
  for (const args of [
    ["--no-optional-locks", "diff", "--cached", "--quiet", "--exit-code", "HEAD", "--"],
    ["--no-optional-locks", "diff", "--quiet", "--exit-code", "--"]
  ]) {
    await gitResult(runGit, after.gitContext, args, {
      code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED,
      message: "cached or worktree diff remains after review-surface preparation"
    });
  }
  const status = await gitOutput(runGit, after.gitContext,
    ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all"], {
      code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED,
      message: "could not inspect post-preparation worktree status"
    });
  if (status.length > 0) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED,
      "retained slice review worktree is not clean after preparation",
      { status }
    );
  }
  const finalState = await resolveTrustedState({
    ...identity,
    resolveWorktreeBinding,
    digestWorktreeIdentity,
    runGit
  });
  assertSameTrustedState(before, finalState);
  return Object.freeze({
    schema_version: SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION,
    assigned_unit: assignedUnit,
    launch_ref: launchRef,
    run_id: runId,
    retry_id: retryId,
    worktree_identity_digest: finalState.worktreeIdentityDigest,
    worktree_path: finalState.canonicalWorktreePath,
    slice_ref: finalState.sliceRef,
    base_sha: finalState.binding.base_sha,
    reviewed_sha: finalState.reviewedSha,
    reviewed_tree: finalState.reviewedTree,
    verified_parts: Object.freeze([...SLICE_REVIEW_SURFACE_PREPARATION_VERIFIED_PARTS])
  });
}

export {
  projectAuthenticatedSliceReviewMaterializationFailure,
  SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_KIND,
  SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_SCHEMA_VERSION,
  SLICE_REVIEW_MATERIALIZATION_PROJECTION_KEYS,
  SLICE_REVIEW_MATERIALIZATION_PUBLIC_DETAIL_KEYS,
  SLICE_REVIEW_MATERIALIZATION_PUBLIC_MESSAGE,
  SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES
} from "./slice-review-materialization-failure-projection.mjs";
