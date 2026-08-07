

import { spawnSync } from "node:child_process";
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

import {
  SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION,
  SLICE_REVIEW_SURFACE_PREPARATION_VERIFIED_PARTS
} from "./trusted-operation-contracts.mjs";
import {
  resolveCommitGitIdentity,
  verifyExactSliceCommitBinding
} from "./exact-slice-commit-binding.mjs";

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export const SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARGUMENT: "agent_launch.slice_review_materialization.invalid_argument.v1",
  BINDING_MISMATCH: "agent_launch.slice_review_materialization.binding_mismatch.v1",
  WORKTREE_MISMATCH: "agent_launch.slice_review_materialization.worktree_mismatch.v1",
  OBJECT_MISMATCH: "agent_launch.slice_review_materialization.object_mismatch.v1",
  INDEX_LOCKED: "agent_launch.slice_review_materialization.index_locked.v1",
  INDEX_STATE_REFUSED: "agent_launch.slice_review_materialization.index_state_refused.v1",
  PHYSICAL_TREE_REFUSED: "agent_launch.slice_review_materialization.physical_tree_refused.v1",
  SPARSE_OR_HIDDEN_INDEX: "agent_launch.slice_review_materialization.sparse_or_hidden_index.v1",
  PREPARE_FAILED: "agent_launch.slice_review_materialization.prepare_failed.v1",
  POSTCHECK_FAILED: "agent_launch.slice_review_materialization.postcheck_failed.v1"
});

export const SLICE_REVIEW_POSTCHECK_STATE_BUDGET = Object.freeze({
  schema_version: "slice-review-postcheck-state-budget.v1",
  bound_fields: Object.freeze([
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
  ]),

  bound_refs: Object.freeze([
    "the launcher-bound slice ref of the target worktree",
    "the target worktree HEAD (symbolic target and resolved commit)"
  ]),
  refused_pseudorefs: Object.freeze([
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "REBASE_HEAD",
    "BISECT_HEAD",
    "AUTO_MERGE"
  ]),
  unbound: Object.freeze([
    "ORIG_HEAD",
    "FETCH_HEAD",
    "every repository ref outside the closed bound-ref set",
    "the registration, HEAD, and branch of every non-target worktree"
  ])
});

export const SLICE_REVIEW_MATERIALIZATION_ERROR_NAME = "SliceReviewMaterializationError";

const MATERIALIZATION_MESSAGE_PREFIX = "agent-launch slice-review materialization: ";

const MATERIALIZATION_ERROR_BRAND = new WeakSet();

export class SliceReviewMaterializationError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = SLICE_REVIEW_MATERIALIZATION_ERROR_NAME;
    this.code = code ?? SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PREPARE_FAILED;
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
    MATERIALIZATION_ERROR_BRAND.add(this);
  }
}

function fail(code, message, detail = null, cause = null) {
  throw new SliceReviewMaterializationError(
    `${MATERIALIZATION_MESSAGE_PREFIX}${message}`,
    { code, detail, cause }
  );
}

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

export function defaultSliceReviewRunGit({
  repo = null,
  gitDir = null,
  workTree = null,
  args,
  indexFile = null,
  objectDirectory = null,
  alternates = null
}) {
  const prefix = repo !== null
    ? ["-C", repo]
    : ["--git-dir", gitDir, "--work-tree", workTree];
  const result = spawnSync("git", [...prefix, ...args], {
    encoding: "utf8",
    env: gitEnvironment({ indexFile, objectDirectory, alternates }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error) {
    return { ok: false, status: null, stdout: "", stderr: "", error: result.error.message };
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

function gitResult(runGit, context, args, { code, message, allow = [] } = {}) {
  const result = runGit({ ...context, args });
  if (result?.ok === true || allow.includes(result?.status)) return result;
  fail(code, message, {
    args,
    status: result?.status ?? null,
    stderr: result?.stderr ?? result?.error ?? null
  });
}

function gitOutput(runGit, context, args, options) {
  return String(gitResult(runGit, context, args, options).stdout ?? "").trim();
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

function worktreeRegistrationSnapshot(runGit, mainRepo) {
  const result = gitResult(runGit, { repo: mainRepo }, ["worktree", "list", "--porcelain", "-z"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
    message: "could not enumerate registered Git worktrees"
  });

  return { records: parseWorktreeRegistrations(result.stdout) };
}

export const FULL_INDEX_CONFIG_KEYS = Object.freeze([
  "core.sparseCheckout",
  "core.sparseCheckoutCone",
  "index.sparse"
]);
export const FULL_INDEX_CONFIG_SCOPES = Object.freeze(["--local", "--worktree"]);

function assertFullIndexShape(runGit, gitContext) {
  for (const key of FULL_INDEX_CONFIG_KEYS) {
    for (const scope of FULL_INDEX_CONFIG_SCOPES) {
      const raw = runGit({
        ...gitContext,
        args: ["config", scope, "--bool", "--get", key]
      });
      const unsupportedWorktreeScope = scope === "--worktree" && raw?.status === 128 &&
        String(raw.stderr ?? "").includes("extension worktreeConfig is enabled");
      if (!unsupportedWorktreeScope && raw?.ok !== true && raw?.status !== 1) {
        fail(
          SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.SPARSE_OR_HIDDEN_INDEX,
          "could not verify full-checkout configuration",
          {
            key,
            scope,
            status: raw?.status ?? null,
            stderr: raw?.stderr ?? raw?.error ?? null
          }
        );
      }
      const result = raw;
      if (result.ok === true && String(result.stdout ?? "").trim() === "true") {
        fail(
          SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.SPARSE_OR_HIDDEN_INDEX,
          "retained slice worktree has sparse checkout enabled",
          { key, scope }
        );
      }
    }
  }
  const staged = gitOutput(runGit, gitContext, ["ls-files", "--sparse", "--stage"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.SPARSE_OR_HIDDEN_INDEX,
    message: "could not inspect the ordinary index shape"
  });
  const sparseEntry = staged.split("\n").find((line) => line.startsWith("040000 "));
  if (sparseEntry) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.SPARSE_OR_HIDDEN_INDEX,
      "ordinary index contains a sparse-directory entry",
      { entry: sparseEntry }
    );
  }
  const tagged = gitOutput(runGit, gitContext, ["ls-files", "--sparse", "-v"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.SPARSE_OR_HIDDEN_INDEX,
    message: "could not inspect ordinary index flags"
  });
  const hidden = tagged.split("\n").find((line) => line.startsWith("S ") || /^[a-z] /u.test(line));
  if (hidden) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.SPARSE_OR_HIDDEN_INDEX,
      "ordinary index contains skip-worktree or assume-unchanged state",
      { entry: hidden }
    );
  }
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

function classifySequencerState(runGit, gitContext) {
  for (const pseudoref of SLICE_REVIEW_POSTCHECK_STATE_BUDGET.refused_pseudorefs) {
    if (typeof gitContext?.gitDir !== "string" || !path.isAbsolute(gitContext.gitDir)) {
      fail(
        SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
        "could not resolve the retained slice worktree operation-state path",
        { pseudoref }
      );
    }
    const located = runGit({
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
      const resolved = runGit({ ...gitContext, args: ["rev-parse", "--verify", "--quiet", pseudoref] });
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

function resolveObjectStoreIdentity(runGit, gitContext) {
  const objectPath = gitOutput(runGit, gitContext, ["rev-parse", "--path-format=absolute", "--git-path", "objects"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
    message: "could not resolve the canonical Git object directory"
  });
  const commonPath = gitOutput(runGit, gitContext, ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
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

function physicalTreeFromIsolatedIndex({ runGit, gitContext, reviewedSha, objectDirectory }) {
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
    gitResult(runGit, isolated, ["read-tree", reviewedSha], {
      code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PHYSICAL_TREE_REFUSED,
      message: "could not seed the isolated physical-tree index"
    });
    for (const args of [
      ["ls-files", "--others", "--exclude-standard", "--directory", "--no-empty-directory"],
      ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory"]
    ]) {
      const unexpected = gitOutput(runGit, isolated, args, {
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
    gitResult(runGit, isolated, ["add", "-A", "--"], {
      code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PHYSICAL_TREE_REFUSED,
      message: "could not measure the physical checkout through the isolated index"
    });
    return assertOid(gitOutput(runGit, isolated, ["write-tree"], {
      code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.PHYSICAL_TREE_REFUSED,
      message: "could not write the isolated physical checkout tree"
    }), "physical checkout tree");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function resolveTrustedState({
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
  const registration = worktreeRegistrationSnapshot(runGit, mainRepo);
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
  const actualGitDir = gitOutput(runGit, { repo: canonicalWorktreePath }, ["rev-parse", "--absolute-git-dir"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
    message: "could not resolve the retained linked-worktree Git directory"
  });
  const topLevel = gitOutput(runGit, { repo: canonicalWorktreePath }, ["rev-parse", "--show-toplevel"], {
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
  const symbolicHead = gitOutput(runGit, gitContext, ["symbolic-ref", "-q", "HEAD"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.WORKTREE_MISMATCH,
    message: "retained slice worktree HEAD is detached or unreadable"
  });
  const reviewedSha = assertOid(gitOutput(runGit, gitContext, ["rev-parse", "--verify", `${sliceRef}^{commit}`], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
    message: "could not resolve the exact reviewed slice ref"
  }), "reviewed slice SHA");
  const headSha = assertOid(gitOutput(runGit, gitContext, ["rev-parse", "--verify", "HEAD^{commit}"], {
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
    const actualType = gitOutput(runGit, gitContext, ["cat-file", "-t", object], {
      code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
      message: "required slice object is missing or unreadable"
    });
    if (actualType !== type) {
      fail(SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
        "required slice object has the wrong Git type", { object, expected: type, actual: actualType });
    }
  }
  const parents = gitOutput(runGit, gitContext, ["rev-list", "--parents", "-n", "1", reviewedSha], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
    message: "could not resolve the reviewed slice parent"
  }).split(/\s+/u);
  if (parents.length !== 2 || parents[0] !== reviewedSha || parents[1] !== binding.base_sha) {
    fail(
      SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
      "reviewed slice commit does not have the exact launcher-bound base parent"
    );
  }
  const baseTree = assertOid(gitOutput(runGit, gitContext, ["rev-parse", "--verify", `${binding.base_sha}^{tree}`], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
    message: "could not resolve the exact base tree"
  }), "base tree");
  const reviewedTree = assertOid(gitOutput(runGit, gitContext, ["rev-parse", "--verify", `${reviewedSha}^{tree}`], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
    message: "could not resolve the reviewed tree"
  }), "reviewed tree");
  if (gitOutput(runGit, gitContext, ["cat-file", "-t", reviewedTree], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
    message: "reviewed tree object is missing"
  }) !== "tree") {
    fail(SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.OBJECT_MISMATCH,
      "reviewed tree object has the wrong Git type");
  }
  const { objectDirectory, commonDirectory, objectAlternates } =
    resolveObjectStoreIdentity(runGit, gitContext);
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
    sequencerState: classifySequencerState(runGit, gitContext)
  });
}

export const HISTORICAL_DELIVERY_INDEX_RECOVERY = Object.freeze({
  schema_version: "slice-review-historical-delivery-index-recovery.v1",

  max_suffix_commits: 64,

  literal_object_read_options: Object.freeze(["--no-replace-objects"])
});

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

function literalObjectType(runGit, gitContext, oid, cache) {
  if (cache.has(oid)) return cache.get(oid);
  const result = runGit({
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

async function authenticateHistoricalDeliveryIndexTree({
  runGit,
  gitContext,
  subject,
  reviewedSha,
  reviewedTree,
  baseSha,
  baseTree,
  ordinaryIndexTree
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
  const types = new Map();
  const commits = new Map();
  const visited = new Set();
  let cursor = reviewedSha;
  for (let depth = 0; depth < HISTORICAL_DELIVERY_INDEX_RECOVERY.max_suffix_commits; depth += 1) {
    if (visited.has(cursor)) {
      refuseIndexState("historical delivery suffix is cyclic", { object: cursor, depth });
    }
    visited.add(cursor);
    if (literalObjectType(runGit, gitContext, cursor, types) !== "commit") {
      refuseIndexState("historical delivery suffix object is missing or is not a commit", {
        object: cursor,
        depth
      });
    }
    let commit = commits.get(cursor);
    if (commit === undefined) {
      const read = runGit({
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
      if (literalObjectType(runGit, gitContext, commit.tree, types) !== "tree") {
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

function assertHistoricalRecoveryStillBound(runGit, before, ordinaryIndexTree) {
  const options = {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INDEX_STATE_REFUSED,
    message: "could not re-prove the bound review surface before historical index reconciliation"
  };
  const symbolicHead = gitOutput(runGit, before.gitContext, ["symbolic-ref", "-q", "HEAD"], options);
  const sliceSha = gitOutput(runGit, before.gitContext,
    ["rev-parse", "--verify", `${before.sliceRef}^{commit}`], options);
  const headSha = gitOutput(runGit, before.gitContext, ["rev-parse", "--verify", "HEAD^{commit}"], options);
  const indexTree = gitOutput(runGit, before.gitContext, ["write-tree"], options);
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
  const before = resolveTrustedState({
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
  assertFullIndexShape(runGit, before.gitContext);
  const physicalBefore = physicalTreeFromIsolatedIndex({
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
  const ordinaryIndexTree = assertOid(gitOutput(runGit, before.gitContext, ["write-tree"], {
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
      ordinaryIndexTree
    });
    assertHistoricalRecoveryStillBound(runGit, before, ordinaryIndexTree);
  }
  if (ordinaryIndexTree !== before.reviewedTree) {
    if (existsSync(indexLock)) {
      fail(
        SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.INDEX_LOCKED,
        "ordinary linked-worktree index became locked before preparation"
      );
    }
    gitResult(runGit, before.gitContext, ["read-tree", before.reviewedSha], {
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
  const after = resolveTrustedState({
    ...identity,
    resolveWorktreeBinding,
    digestWorktreeIdentity,
    runGit
  });
  assertSameTrustedState(before, after);
  assertFullIndexShape(runGit, after.gitContext);
  const headTree = assertOid(gitOutput(runGit, after.gitContext, ["rev-parse", "--verify", "HEAD^{tree}"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED,
    message: "could not resolve the post-preparation HEAD tree"
  }), "post-preparation HEAD tree");
  const postIndexTree = assertOid(gitOutput(runGit, after.gitContext, ["write-tree"], {
    code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED,
    message: "could not resolve the post-preparation ordinary index tree"
  }), "post-preparation ordinary index tree");
  const physicalAfter = physicalTreeFromIsolatedIndex({
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
    gitResult(runGit, after.gitContext, args, {
      code: SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.POSTCHECK_FAILED,
      message: "cached or worktree diff remains after review-surface preparation"
    });
  }
  const status = gitOutput(runGit, after.gitContext,
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
  const finalState = resolveTrustedState({
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

export const SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_SCHEMA_VERSION =
  "agent_launch.slice_review_materialization_failure_projection.v1";

export const SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_KIND =
  "slice_review_materialization_failure";

export const SLICE_REVIEW_MATERIALIZATION_PUBLIC_MESSAGE =
  "exact-slice review materialization refused";

export const SLICE_REVIEW_MATERIALIZATION_PROJECTION_KEYS = Object.freeze([
  "schema_version",
  "kind",
  "code",
  "message",
  "detail"
]);

export const SLICE_REVIEW_MATERIALIZATION_PUBLIC_DETAIL_KEYS = Object.freeze([
  "predicate",
  "field",
  "pseudoref",
  "config_key",
  "config_scope",
  "suffix_depth",
  "traversal_bound",
  "git_exit_status"
]);

const OID_ASSERTION_SUFFIX = " is not a canonical Git object id";

const OID_ASSERTION_LABELS = Object.freeze([
  "physical checkout tree",
  "reviewed slice SHA",
  "slice HEAD SHA",
  "base tree",
  "reviewed tree",
  "ordinary index tree",
  "post-preparation HEAD tree",
  "post-preparation ordinary index tree",
  "historical commit tree",
  "historical commit parent"
]);

export const SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES = Object.freeze([

  "preparation requires the canonical main repo and exact base launcher tuple",
  "trusted binding, digest, and Git dependencies are required",

  "could not resolve and verify the exact launcher-bound slice identity",
  "slice review preparation requires the retained v2/full worktree binding",
  "could not derive the exact worktree identity digest",
  "worktree identity digest is unavailable or malformed",
  "retained slice worktree path is missing or unreadable",
  "retained slice worktree path moved or is not canonical",
  "could not enumerate registered Git worktrees",
  "Git worktree registration contains a duplicate field",
  "retained slice worktree registration is missing, moved, detached, locked, or mismatched",
  "could not resolve the retained linked-worktree Git directory",
  "could not resolve the retained linked-worktree top level",
  "retained linked-worktree Git association is missing or unreadable",
  "retained path is not the registered exact linked worktree",
  "retained slice worktree HEAD is detached or unreadable",
  "symbolic HEAD, slice ref, registration, and reviewed SHA do not agree",

  "could not resolve the retained slice worktree operation-state path",
  "could not classify retained slice worktree operation state",
  "retained slice worktree has in-progress Git operation state",

  "could not resolve the canonical Git object directory",
  "could not resolve the canonical Git common directory",
  "canonical Git object or common directory is missing or unreadable",
  "could not classify the canonical Git object alternates",
  "could not resolve the exact reviewed slice ref",
  "could not resolve retained slice HEAD",
  "required slice object is missing or unreadable",
  "required slice object has the wrong Git type",
  "could not resolve the reviewed slice parent",
  "reviewed slice commit does not have the exact launcher-bound base parent",
  "could not resolve the exact base tree",
  "could not resolve the reviewed tree",
  "reviewed tree object is missing",
  "reviewed tree object has the wrong Git type",

  "could not verify full-checkout configuration",
  "retained slice worktree has sparse checkout enabled",
  "could not inspect the ordinary index shape",
  "ordinary index contains a sparse-directory entry",
  "could not inspect ordinary index flags",
  "ordinary index contains skip-worktree or assume-unchanged state",

  "could not seed the isolated physical-tree index",
  "could not inspect unexpected worktree content",
  "retained slice worktree contains unexpected untracked content",
  "could not measure the physical checkout through the isolated index",
  "could not write the isolated physical checkout tree",
  "physical checkout does not exactly materialize the reviewed commit tree",

  "could not compute the ordinary linked-worktree index tree",
  "ordinary linked-worktree index is locked; refusing without deleting the lock",
  "ordinary linked-worktree index became locked before preparation",
  "the canonical delivery mint point is unavailable",
  "historical index authentication requires a canonical managed slice subject",
  "historical delivery suffix is cyclic",
  "historical delivery suffix object is missing or is not a commit",
  "could not read the literal historical delivery commit object",
  "historical commit object has no literal header/message boundary",
  "historical commit is not a literal single-parent commit object",
  "historical commit carries extra literal tree/parent headers",
  "commit is not an exact canonical server-minted delivery for this slice",
  "the reviewed delivery does not literally head the authenticated suffix",
  "the authenticated binding base does not literally follow the reviewed delivery",
  "historical delivery tree is missing or is not a tree object",
  "no authenticated historical launcher delivery within the fixed traversal bound",
  "could not re-prove the bound review surface before historical index reconciliation",
  "the bound slice ref, HEAD, or ordinary index moved during historical index authentication",
  "git read-tree could not align the ordinary index with the reviewed commit",

  "ordinary linked-worktree index lock remained after preparation",
  "declared bound review-surface state was not produced for comparison",
  "trusted slice/worktree/ref state changed during review-surface preparation",
  "could not resolve the post-preparation HEAD tree",
  "could not resolve the post-preparation ordinary index tree",
  "HEAD, ordinary index, and physical checkout are not the exact unchanged reviewed tree",
  "cached or worktree diff remains after review-surface preparation",
  "could not inspect post-preparation worktree status",
  "retained slice review worktree is not clean after preparation",

  ...OID_ASSERTION_LABELS.map((label) => `${label}${OID_ASSERTION_SUFFIX}`)
]);

const PUBLIC_PREDICATE_SET = new Set(SLICE_REVIEW_MATERIALIZATION_PUBLIC_PREDICATES);
const PUBLIC_CODE_SET = new Set(Object.values(SLICE_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES));
const PUBLIC_BOUND_FIELD_SET = new Set(SLICE_REVIEW_POSTCHECK_STATE_BUDGET.bound_fields);
const PUBLIC_PSEUDOREF_SET = new Set(SLICE_REVIEW_POSTCHECK_STATE_BUDGET.refused_pseudorefs);
const PUBLIC_CONFIG_KEY_SET = new Set(FULL_INDEX_CONFIG_KEYS);
const PUBLIC_CONFIG_SCOPE_SET = new Set(FULL_INDEX_CONFIG_SCOPES);

function ownDataValue(target, key) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) return undefined;
  return descriptor.value;
}

function boundedEnumValue(detail, key, allowed) {
  const value = ownDataValue(detail, key);
  return typeof value === "string" && allowed.has(value) ? value : null;
}

function boundedIntegerValue(detail, key, minimum, maximum) {
  const value = ownDataValue(detail, key);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function boundedMaterializationDetail(predicate, detail) {
  const source = detail === null ? null : detail;
  return Object.freeze({
    predicate,
    field: source === null
      ? null
      : boundedEnumValue(source, "field", PUBLIC_BOUND_FIELD_SET),
    pseudoref: source === null
      ? null
      : boundedEnumValue(source, "pseudoref", PUBLIC_PSEUDOREF_SET),
    config_key: source === null
      ? null
      : boundedEnumValue(source, "key", PUBLIC_CONFIG_KEY_SET),
    config_scope: source === null
      ? null
      : boundedEnumValue(source, "scope", PUBLIC_CONFIG_SCOPE_SET),
    suffix_depth: source === null
      ? null
      : boundedIntegerValue(source, "depth", 0,
          HISTORICAL_DELIVERY_INDEX_RECOVERY.max_suffix_commits),
    traversal_bound: source === null
      ? null
      : boundedIntegerValue(source, "bound",
          HISTORICAL_DELIVERY_INDEX_RECOVERY.max_suffix_commits,
          HISTORICAL_DELIVERY_INDEX_RECOVERY.max_suffix_commits),
    git_exit_status: source === null
      ? null
      : boundedIntegerValue(source, "status", 0, 255)
  });
}

export function isSliceReviewMaterializationError(value) {
  return MATERIALIZATION_ERROR_BRAND.has(value);
}

export function projectAuthenticatedSliceReviewMaterializationFailure(error) {
  if (!isSliceReviewMaterializationError(error)) return null;
  if (!(error instanceof SliceReviewMaterializationError)) return null;
  if (ownDataValue(error, "name") !== SLICE_REVIEW_MATERIALIZATION_ERROR_NAME) return null;
  const message = ownDataValue(error, "message");
  if (typeof message !== "string" || !message.startsWith(MATERIALIZATION_MESSAGE_PREFIX)) {
    return null;
  }
  const code = ownDataValue(error, "code");
  if (typeof code !== "string" || !PUBLIC_CODE_SET.has(code)) return null;
  let detail = null;
  if (Object.hasOwn(error, "detail")) {
    detail = ownDataValue(error, "detail");

    if (detail === null || typeof detail !== "object" || Array.isArray(detail) ||
        Object.getPrototypeOf(detail) !== Object.prototype) {
      return null;
    }
  }
  const reason = message.slice(MATERIALIZATION_MESSAGE_PREFIX.length);
  return Object.freeze({
    schema_version: SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_SCHEMA_VERSION,
    kind: SLICE_REVIEW_MATERIALIZATION_FAILURE_PROJECTION_KIND,
    code,
    message: SLICE_REVIEW_MATERIALIZATION_PUBLIC_MESSAGE,
    detail: boundedMaterializationDetail(
      PUBLIC_PREDICATE_SET.has(reason) ? reason : null,
      detail
    )
  });
}
