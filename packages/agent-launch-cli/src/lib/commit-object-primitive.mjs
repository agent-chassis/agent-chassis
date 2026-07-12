

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const COMMIT_OBJECT_PRIMITIVE_SCHEMA_VERSION = "commit-object-primitive.v1";

export const COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.commit_object_primitive.invalid_arg.v1",
  INVALID_REF: "agent_launch.commit_object_primitive.invalid_ref.v1",
  INVALID_SHA: "agent_launch.commit_object_primitive.invalid_sha.v1",
  MATERIALIZE_FAILED: "agent_launch.commit_object_primitive.materialize_failed.v1",
  SPARSE_BINDING_REQUIRED: "agent_launch.commit_object_primitive.sparse_binding_required.v1",
  SPARSE_BINDING_INCOMPATIBLE: "agent_launch.commit_object_primitive.sparse_binding_incompatible.v1",
  CROSS_CONE_RENAME: "agent_launch.commit_object_primitive.cross_cone_rename.v1",
  REF_TIP_UNRESOLVABLE: "agent_launch.commit_object_primitive.ref_tip_unresolvable.v1",
  REF_ADVANCE_FAILED: "agent_launch.commit_object_primitive.ref_advance_failed.v1",

  REF_ADVANCE_CONFLICT: "agent_launch.commit_object_primitive.ref_advance_conflict.v1"
});

export class CommitObjectPrimitiveError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "CommitObjectPrimitiveError";
    this.code = code ?? "agent_launch.commit_object_primitive.error.v1";
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

function fail(code, message, detail = null, cause = null) {
  throw new CommitObjectPrimitiveError(`agent-launch commit-object-primitive: ${message}`, {
    code,
    detail,
    cause
  });
}

export const COMMIT_OBJECT_MATERIALIZE_CONFIG = Object.freeze([
  "-c", "core.autocrlf=false",
  "-c", "core.eol=lf",
  "-c", "core.symlinks=true",
  "-c", "core.hooksPath=",
  "-c", "core.fsmonitor="
]);

const WK_REF_ALLOWLIST_RE = /^refs\/heads\/wk\/IN-\d{4}\/WK-\d{4}$/;

const OID_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

function isZeroOid(sha) {
  return /^0+$/.test(sha);
}

function assertOid(value, label, code = COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.INVALID_SHA) {
  if (typeof value !== "string" || !OID_RE.test(value) || isZeroOid(value)) {
    fail(code, `${label} must be a non-zero 40- or 64-hex object name, got: ${JSON.stringify(value)}`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.INVALID_ARG, `${label} must be a non-empty string`);
  }
  return value;
}

function assertWkRef(ref) {
  if (typeof ref !== "string" || !WK_REF_ALLOWLIST_RE.test(ref)) {
    fail(
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.INVALID_REF,
      `ref must be an allowlisted per-WK ref (^refs/heads/wk/IN-\\d{4}/WK-\\d{4}$), got: ${JSON.stringify(ref)}`
    );
  }
  return ref;
}

function assertCommitter(committer) {
  if (
    typeof committer !== "object" ||
    committer === null ||
    typeof committer.name !== "string" ||
    committer.name.length === 0 ||
    typeof committer.email !== "string" ||
    committer.email.length === 0
  ) {
    fail(
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.INVALID_ARG,
      "committer must be { name: non-empty string, email: non-empty string }"
    );
  }

  if (/[\r\n]/.test(committer.name) || /[\r\n]/.test(committer.email)) {
    fail(
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.INVALID_ARG,
      "committer name/email must not contain newlines"
    );
  }
  return committer;
}

function normalizeSparseBinding(sparseBinding, baseSha) {
  if (!sparseBinding || typeof sparseBinding !== "object" || Array.isArray(sparseBinding)) {
    fail(
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.SPARSE_BINDING_REQUIRED,
      "a sparse worktree requires the server-resolved WK-1518 binding"
    );
  }
  if (sparseBinding.base_sha !== baseSha) {
    fail(
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.SPARSE_BINDING_INCOMPATIBLE,
      "sparse binding base_sha does not match the materialization base_sha",
      { expected: baseSha, actual: sparseBinding.base_sha ?? null }
    );
  }
  if (!Array.isArray(sparseBinding.cone_dirs) || sparseBinding.cone_dirs.length === 0 ||
      typeof sparseBinding.index_sparse !== "boolean") {
    fail(
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.SPARSE_BINDING_INCOMPATIBLE,
      "sparse binding must contain non-empty cone_dirs and boolean index_sparse"
    );
  }
  const cones = [];
  for (const cone of sparseBinding.cone_dirs) {
    if (typeof cone !== "string" || cone.length === 0 || cone.startsWith("/") || cone.startsWith("-") ||
        /[\\\x00-\x1f\x7f]/u.test(cone) || cone.split("/").some((part) => part === "" || part === "." || part === "..")) {
      fail(
        COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.SPARSE_BINDING_INCOMPATIBLE,
        `sparse binding contains an invalid cone directory: ${JSON.stringify(cone)}`
      );
    }
    cones.push(cone);
  }
  if (new Set(cones).size !== cones.length ||
      cones.some((cone, index) => cones.some((other, otherIndex) => otherIndex !== index && cone.startsWith(`${other}/`)))) {
    fail(
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.SPARSE_BINDING_INCOMPATIBLE,
      "sparse binding cone_dirs must be unique and ancestor-minimal"
    );
  }
  return Object.freeze({ cone_dirs: Object.freeze(cones), index_sparse: sparseBinding.index_sparse });
}

function querySparseCheckout(runGit, ctx) {
  const res = runGit({
    gitDir: ctx.gitDir,
    workTree: ctx.workTree,
    args: [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "config", "--bool", "core.sparseCheckout"],
    indexFile: ctx.indexFile
  });
  if (res?.ok === true) return res.stdout.trim() === "true";
  if (res?.status === 1) return false;
  fail(
    COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
    "failed to determine whether the worktree is sparse",
    { status: res?.status ?? null, stderr: res?.stderr ?? null, error: res?.error ?? null }
  );
}

function verifySparseBindingAgainstWorktree(runGit, ctx, binding) {
  const list = runGitOrThrow(
    runGit,
    ctx,
    [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "sparse-checkout", "list"],
    COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.SPARSE_BINDING_INCOMPATIBLE,
    "failed to read the configured sparse cone"
  ).stdout.split("\n").filter(Boolean);
  const sparseIndex = runGitOrThrow(
    runGit,
    ctx,
    [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "config", "--bool", "index.sparse"],
    COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.SPARSE_BINDING_INCOMPATIBLE,
    "failed to read index.sparse"
  ).stdout.trim() === "true";
  if (list.length !== binding.cone_dirs.length || list.some((cone, index) => cone !== binding.cone_dirs[index]) ||
      sparseIndex !== binding.index_sparse) {
    fail(
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.SPARSE_BINDING_INCOMPATIBLE,
      "live sparse configuration does not match the server-resolved binding",
      { expected_cone_dirs: binding.cone_dirs, actual_cone_dirs: list, expected_index_sparse: binding.index_sparse, actual_index_sparse: sparseIndex }
    );
  }
}

function pathIsInCone(repoPath, coneDirs) {
  const pathParts = repoPath.split("/");
  return coneDirs.some((cone) => {
    if (repoPath === cone || repoPath.startsWith(`${cone}/`)) return true;
    const coneParts = cone.split("/");
    return pathParts.length <= coneParts.length &&
      pathParts.slice(0, -1).every((part, index) => part === coneParts[index]);
  });
}

function nulPaths(stdout) {
  return stdout.split("\0").filter(Boolean);
}

function treeEntries(runGit, ctx, treeish) {
  const records = nulPaths(runGitOrThrow(
    runGit,
    ctx,
    [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "ls-tree", "-r", "-z", treeish],
    COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
    `failed to enumerate tree entries for ${treeish}`
  ).stdout);
  return records.map((record) => {
    const tab = record.indexOf("\t");
    const [mode, type, oid] = record.slice(0, tab).split(" ");
    return Object.freeze({ mode, type, oid, path: record.slice(tab + 1) });
  });
}

function deterministicTreeChanges(runGit, ctx, baseSha, candidateTree) {
  const fields = nulPaths(runGitOrThrow(
    runGit,
    ctx,
    [
      ...COMMIT_OBJECT_MATERIALIZE_CONFIG,
      "diff-tree", "-r", "--no-renames", "--name-status", "-z", baseSha, candidateTree
    ],
    COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
    "failed to inspect sparse boundary changes"
  ).stdout);
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    const path = fields[index++];
    if (!/^[ADMTUXB]$/u.test(status ?? "") || path === undefined) {
      fail(
        COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
        "sparse boundary change output was malformed"
      );
    }
    changes.push(Object.freeze({ status, path }));
  }
  return changes;
}

function blobsShareCopyEvidence(runGit, ctx, leftOid, rightOid) {
  if (leftOid === rightOid) return true;
  const left = runGitOrThrow(
    runGit,
    ctx,
    [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "cat-file", "blob", leftOid],
    COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
    `failed to read sparse boundary blob ${leftOid}`
  ).stdout;
  const right = runGitOrThrow(
    runGit,
    ctx,
    [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "cat-file", "blob", rightOid],
    COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
    `failed to read sparse boundary blob ${rightOid}`
  ).stdout;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length < 16) return false;
  for (let index = 0; index <= shorter.length - 16; index += 1) {
    if (longer.includes(shorter.slice(index, index + 16))) return true;
  }
  return false;
}

function sparseCandidatePaths(runGit, ctx, baseSha, coneDirs) {
  const tracked = nulPaths(runGitOrThrow(
    runGit,
    ctx,
    [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "ls-tree", "-r", "--name-only", "-z", baseSha],
    COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
    "failed to enumerate base_sha paths"
  ).stdout);
  const untracked = nulPaths(runGitOrThrow(
    runGit,
    ctx,
    [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "ls-files", "--others", "--exclude-standard", "-z"],
    COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
    "failed to enumerate untracked worktree paths"
  ).stdout);
  return [...new Set([...tracked, ...untracked].filter((repoPath) => pathIsInCone(repoPath, coneDirs)))].sort();
}

function assertNoCrossConeRename(runGit, ctx, baseSha, candidateTree, coneDirs) {
  const probePaths = [
    ...treeEntries(runGit, ctx, baseSha),
    ...treeEntries(runGit, ctx, candidateTree)
  ].map(({ path }) => path).filter((repoPath) => pathIsInCone(repoPath, coneDirs));
  const outsideUntracked = nulPaths(runGitOrThrow(
    runGit,
    ctx,
    [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "ls-files", "--others", "--exclude-standard", "-z"],
    COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
    "failed to enumerate sparse boundary additions"
  ).stdout).filter((repoPath) => !pathIsInCone(repoPath, coneDirs));
  const boundaryProbePaths = [...new Set([...probePaths, ...outsideUntracked])].sort();
  runGitOrThrow(
    runGit,
    ctx,
    [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "read-tree", baseSha],
    COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
    "failed to seed cross-cone probe index"
  );
  if (boundaryProbePaths.length > 0) {
    runGitOrThrow(
      runGit,
      { ...ctx, stdin: `${boundaryProbePaths.join("\0")}\0` },
      [
        ...COMMIT_OBJECT_MATERIALIZE_CONFIG,
        "--literal-pathspecs",
        "add", "-A", "--sparse", "--pathspec-from-file=-", "--pathspec-file-nul"
      ],
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
      "failed to build cross-cone probe"
    );
  }
  const probeTree = runGitOrThrow(
    runGit,
    ctx,
    [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "write-tree"],
    COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
    "failed to write cross-cone probe tree"
  ).stdout.trim();
  assertOid(probeTree, "cross-cone probe tree", COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED);
  const changes = deterministicTreeChanges(runGit, ctx, baseSha, probeTree);
  const baseEntries = treeEntries(runGit, ctx, baseSha);
  const probeEntries = treeEntries(runGit, ctx, probeTree);
  const probeByPath = new Map(probeEntries.map((entry) => [entry.path, entry]));
  const deletions = changes.filter(({ status }) => status === "D");
  const additions = changes.filter(({ status }) => status === "A");
  const crossings = [];
  for (const source of deletions) {
    for (const destination of additions) {
      if (pathIsInCone(source.path, coneDirs) !== pathIsInCone(destination.path, coneDirs)) {
        crossings.push(Object.freeze({ status: "R?", source: source.path, destination: destination.path }));
      }
    }
  }
  for (const destination of additions) {
    const destinationEntry = probeByPath.get(destination.path);
    if (destinationEntry?.type !== "blob") continue;
    for (const sourceEntry of baseEntries) {
      if (sourceEntry.type !== "blob" ||
          pathIsInCone(sourceEntry.path, coneDirs) === pathIsInCone(destination.path, coneDirs)) continue;
      if (blobsShareCopyEvidence(runGit, ctx, sourceEntry.oid, destinationEntry.oid)) {
        crossings.push(Object.freeze({ status: "C?", source: sourceEntry.path, destination: destination.path }));
      }
    }
  }
  if (crossings.length > 0) {
    fail(
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.CROSS_CONE_RENAME,
      "rename/copy crosses the server-resolved sparse cone boundary",
      { crossings: Object.freeze(crossings) }
    );
  }
}

export function defaultRunGit({ gitDir, workTree, args, stdin = null, indexFile = null }) {
  const fullArgs = [];
  if (typeof gitDir === "string" && gitDir.length > 0) fullArgs.push(`--git-dir=${gitDir}`);
  if (typeof workTree === "string" && workTree.length > 0) fullArgs.push(`--work-tree=${workTree}`);

  fullArgs.push("-c", "core.quotePath=false", ...args);
  const env =
    typeof indexFile === "string" && indexFile.length > 0
      ? { ...process.env, GIT_INDEX_FILE: indexFile }
      : undefined;
  let res;
  try {
    res = spawnSync("git", fullArgs, {
      cwd: typeof workTree === "string" && workTree.length > 0 ? workTree : undefined,
      input: typeof stdin === "string" ? stdin : undefined,
      env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  if (res.error) {
    return { ok: false, error: res.error.message ?? String(res.error) };
  }
  if (typeof res.status !== "number" || res.status !== 0) {
    return {
      ok: false,
      status: res.status ?? null,
      signal: res.signal ?? null,
      stdout: typeof res.stdout === "string" ? res.stdout : "",
      stderr: typeof res.stderr === "string" ? res.stderr.slice(0, 2048) : null
    };
  }
  return { ok: true, stdout: typeof res.stdout === "string" ? res.stdout : "" };
}

function runGitOrThrow(runGit, ctx, args, code, whatFailed) {
  const res = runGit({
    gitDir: ctx.gitDir,
    workTree: ctx.workTree,
    args,
    stdin: ctx.stdin ?? null,
    indexFile: ctx.indexFile ?? null
  });
  if (!res || res.ok !== true) {
    fail(code, `${whatFailed} (git ${args.join(" ")})`, {
      status: res?.status ?? null,
      signal: res?.signal ?? null,
      error: res?.error ?? null,
      stderr: res?.stderr ?? null
    });
  }
  return res;
}

export function materializeCommitObject({
  gitDir,
  workTree,
  baseSha,
  message,
  sparseBinding = null,
  committer = {
    name: "agent-launch commit primitive",
    email: "commit-primitive@agent-launch.local"
  },
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  assertNonEmptyString(gitDir, "gitDir");
  assertNonEmptyString(workTree, "workTree");
  assertOid(baseSha, "baseSha");
  assertNonEmptyString(message, "message");
  assertCommitter(committer);

  const indexDir = mkdtempSync(join(tmpdir(), "commit-object-index-"));
  const ctx = { gitDir, workTree, indexFile: join(indexDir, "index") };

  try {
    const sparseCheckout = querySparseCheckout(runGit, ctx);
    const binding = sparseCheckout ? normalizeSparseBinding(sparseBinding, baseSha) : null;
    if (!sparseCheckout && sparseBinding !== null) {
      fail(
        COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.SPARSE_BINDING_INCOMPATIBLE,
        "a sparse binding was supplied for a non-sparse worktree"
      );
    }
    if (binding) verifySparseBindingAgainstWorktree(runGit, ctx, binding);

    runGitOrThrow(
      runGit,
      ctx,
      [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "read-tree", baseSha],
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
      "failed to seed the index from base_sha"
    );

    if (binding) {
      const candidatePaths = sparseCandidatePaths(runGit, ctx, baseSha, binding.cone_dirs);
      if (candidatePaths.length > 0) {
        runGitOrThrow(
          runGit,
          { ...ctx, stdin: `${candidatePaths.join("\0")}\0` },
          [
            ...COMMIT_OBJECT_MATERIALIZE_CONFIG,
            "--literal-pathspecs",
            "add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"
          ],
          COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
          "failed to stage the complete sparse-cone delta"
        );
      }
    } else {
      runGitOrThrow(
        runGit,
        ctx,
        [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "add", "-A"],
        COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
        "failed to stage the complete worktree delta"
      );
    }
    const treeRes = runGitOrThrow(
      runGit,
      ctx,
      [...COMMIT_OBJECT_MATERIALIZE_CONFIG, "write-tree"],
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
      "failed to write the tree object"
    );
    const tree = treeRes.stdout.trim();
    assertOid(tree, "materialized tree", COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED);

    if (binding) assertNoCrossConeRename(runGit, ctx, baseSha, tree, binding.cone_dirs);

    const commitRes = runGitOrThrow(
      runGit,
      ctx,
      [
        ...COMMIT_OBJECT_MATERIALIZE_CONFIG,
        "-c", `user.name=${committer.name}`,
        "-c", `user.email=${committer.email}`,
        "commit-tree", tree,
        "-p", baseSha,
        "-m", message
      ],
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED,
      "failed to write the commit object"
    );
    const commit = commitRes.stdout.trim();
    assertOid(commit, "materialized commit", COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.MATERIALIZE_FAILED);

    return Object.freeze({
      schema_version: COMMIT_OBJECT_PRIMITIVE_SCHEMA_VERSION,
      tree,
      commit,
      base_sha: baseSha
    });
  } finally {

    try {
      rmSync(indexDir, { recursive: true, force: true });
    } catch {

    }
  }
}

function resolveCommitMeta(runGit, ctx, sha) {
  const treeRes = runGitOrThrow(
    runGit,
    ctx,
    ["rev-parse", "--verify", `${sha}^{tree}`],
    COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.REF_TIP_UNRESOLVABLE,
    `failed to resolve tree of ${sha}`
  );
  const parentsRes = runGitOrThrow(
    runGit,
    ctx,
    ["rev-list", "-n", "1", "--parents", sha],
    COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.REF_TIP_UNRESOLVABLE,
    `failed to resolve parents of ${sha}`
  );

  const parts = parentsRes.stdout.trim().split(/\s+/).filter((p) => p.length > 0);
  return { tree: treeRes.stdout.trim(), parents: parts.slice(1) };
}

function resolveRefTip(runGit, ctx, ref) {
  const res = runGit({ gitDir: ctx.gitDir, workTree: ctx.workTree, args: ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`] });
  const sha = res && res.ok === true ? res.stdout.trim() : "";
  if (!OID_RE.test(sha) || isZeroOid(sha)) {
    fail(
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.REF_TIP_UNRESOLVABLE,
      `per-WK ref ${JSON.stringify(ref)} does not resolve to a commit; the launcher must have allocated it before commit`,
      { ref, stderr: res?.stderr ?? null, status: res?.status ?? null }
    );
  }
  return sha;
}

function tipMatchesDelivery(tipMeta, tree, baseSha) {
  return tipMeta.parents.length === 1 && tipMeta.parents[0] === baseSha && tipMeta.tree === tree;
}

function tipIsSiblingConflict(tipMeta, tree, baseSha) {
  return tipMeta.parents.length === 1 && tipMeta.parents[0] === baseSha && tipMeta.tree !== tree;
}

export function advanceWkRef({
  gitDir,
  ref,
  baseSha,
  tree,
  commit,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  assertNonEmptyString(gitDir, "gitDir");
  assertWkRef(ref);
  assertOid(baseSha, "baseSha");
  assertOid(tree, "tree");
  assertOid(commit, "commit");

  const ctx = { gitDir };

  const decide = (tipSha) => {
    const tipMeta = resolveCommitMeta(runGit, ctx, tipSha);
    if (tipMatchesDelivery(tipMeta, tree, baseSha)) {

      return { kind: "idempotent", commit: tipSha };
    }
    if (tipIsSiblingConflict(tipMeta, tree, baseSha)) {
      return { kind: "conflict", tipMeta };
    }
    return { kind: "advance", tipMeta };
  };

  const oldSha = resolveRefTip(runGit, ctx, ref);
  const first = decide(oldSha);
  if (first.kind === "idempotent") {
    return Object.freeze({
      schema_version: COMMIT_OBJECT_PRIMITIVE_SCHEMA_VERSION,
      ref,
      base_sha: baseSha,
      tree,
      commit: first.commit,
      idempotent: true
    });
  }
  if (first.kind === "conflict") {
    fail(
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.REF_ADVANCE_CONFLICT,
      `per-WK ref tip is a different delivery from the same base_sha (structured conflict, never a clobber): ref ${ref}`,
      { ref, base_sha: baseSha, tree, ref_tip: oldSha, ref_tip_tree: first.tipMeta.tree }
    );
  }

  const casRes = runGit({
    gitDir,
    args: ["update-ref", ref, commit, oldSha]
  });
  if (casRes && casRes.ok === true) {
    return Object.freeze({
      schema_version: COMMIT_OBJECT_PRIMITIVE_SCHEMA_VERSION,
      ref,
      base_sha: baseSha,
      tree,
      commit,
      idempotent: false
    });
  }

  const newTip = resolveRefTip(runGit, ctx, ref);
  const second = decide(newTip);
  if (second.kind === "idempotent") {
    return Object.freeze({
      schema_version: COMMIT_OBJECT_PRIMITIVE_SCHEMA_VERSION,
      ref,
      base_sha: baseSha,
      tree,
      commit: second.commit,
      idempotent: true
    });
  }
  if (second.kind === "conflict") {
    fail(
      COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.REF_ADVANCE_CONFLICT,
      `per-WK ref advanced concurrently to a different delivery from the same base_sha (structured conflict): ref ${ref}`,
      { ref, base_sha: baseSha, tree, ref_tip: newTip, ref_tip_tree: second.tipMeta.tree }
    );
  }

  fail(
    COMMIT_OBJECT_PRIMITIVE_DIAGNOSTIC_CODES.REF_ADVANCE_FAILED,
    `compare-and-swap on ${ref} failed: the ref tip moved concurrently`,
    {
      ref,
      expected_old: oldSha,
      observed_tip: newTip,
      status: casRes?.status ?? null,
      stderr: casRes?.stderr ?? null
    }
  );
}
