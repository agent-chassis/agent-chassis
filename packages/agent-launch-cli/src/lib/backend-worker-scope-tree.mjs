

import path from "node:path";

const EXACT_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ZERO_OID_RE = /^0+$/u;

const TREE_MODE = "040000";
const SYMLINK_MODE = "120000";
const GITLINK_MODE = "160000";
const REGULAR_BLOB_MODES = Object.freeze(["100644", "100755"]);

const LS_TREE_RECORD_RE =
  /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64})\t([\s\S]+)$/u;

export const SCOPE_TREE_PATH_KINDS = Object.freeze({
  FILE: "file",
  DIRECTORY: "directory",
  SYMLINK: "symlink",
  GITLINK: "gitlink",
  ABSENT: "absent"
});

function probeOrThrow(runGit, repo, args, what) {
  let result;
  try {
    result = runGit({ repo, args: ["--no-replace-objects", ...args] });
  } catch (error) {
    throw new Error(`${what} faulted: ${error?.message ?? String(error)}`);
  }
  if (!result || typeof result !== "object" || result.ok !== true || typeof result.stdout !== "string") {
    throw new Error(`${what} is indeterminate`);
  }
  return result.stdout;
}

function parseTreeListing(stdout, treeOid) {
  const entries = new Map();
  if (stdout.length === 0) return entries;
  if (!stdout.endsWith("\0")) {
    throw new Error(`scope-path tree listing of ${treeOid} is malformed`);
  }
  for (const record of stdout.slice(0, -1).split("\0")) {
    const match = record.match(LS_TREE_RECORD_RE);
    if (match === null) {
      throw new Error(`scope-path tree listing of ${treeOid} carries an unparsable entry`);
    }
    const [, mode, type, oid, name] = match;
    if (name.length === 0 || name.includes("/") || entries.has(name)) {
      throw new Error(`scope-path tree listing of ${treeOid} carries an ambiguous entry name`);
    }
    entries.set(name, Object.freeze({ mode, type, oid }));
  }
  return entries;
}

export function createWorkerScopeTreeReader({ runGit, mainRepo, baseSha } = {}) {
  if (typeof runGit !== "function") {
    throw new Error("scope-path existence resolution requires the launcher-owned git probe");
  }
  if (typeof mainRepo !== "string" || mainRepo.length === 0 || !path.isAbsolute(mainRepo)) {
    throw new Error("scope-path existence resolution requires the canonical absolute repository path");
  }
  if (typeof baseSha !== "string" || !EXACT_OID_RE.test(baseSha) || ZERO_OID_RE.test(baseSha)) {
    throw new Error(
      `scope-path existence base is not an exact object id: ${JSON.stringify(baseSha ?? null)}`
    );
  }

  const objectType = probeOrThrow(
    runGit, mainRepo, ["cat-file", "-t", baseSha], `scope-path existence base type probe for ${baseSha}`
  ).trim();
  if (objectType !== "commit") {
    throw new Error(
      `scope-path existence base ${baseSha} is a ${objectType.length === 0 ? "unknown" : objectType} object, not a commit`
    );
  }
  const rootTree = probeOrThrow(
    runGit, mainRepo, ["rev-parse", "--verify", `${baseSha}^{tree}`],
    `scope-path existence base tree probe for ${baseSha}`
  ).trim();
  if (!EXACT_OID_RE.test(rootTree) || ZERO_OID_RE.test(rootTree)) {
    throw new Error(`scope-path existence base ${baseSha} resolved no exact root tree`);
  }

  const listings = new Map();
  function listing(treeOid) {
    const cached = listings.get(treeOid);
    if (cached !== undefined) return cached;
    const entries = parseTreeListing(
      probeOrThrow(
        runGit, mainRepo, ["ls-tree", "-z", "--full-tree", treeOid],
        `scope-path tree listing probe for ${treeOid}`
      ),
      treeOid
    );
    listings.set(treeOid, entries);
    return entries;
  }

  function resolve(components) {
    if (!Array.isArray(components) || components.length === 0) {
      throw new Error("scope-path existence resolution requires at least one normalized path component");
    }
    let tree = rootTree;
    for (let index = 0; index < components.length; index += 1) {
      const name = components[index];
      if (typeof name !== "string" || name.length === 0 || name.includes("/")) {
        throw new Error(`scope-path component ${JSON.stringify(name ?? null)} is not normalized`);
      }
      const entry = listing(tree).get(name);
      const at = (kind) => Object.freeze({ kind, index, mode: entry?.mode ?? null });
      if (entry === undefined) return at(SCOPE_TREE_PATH_KINDS.ABSENT);
      if (entry.mode === SYMLINK_MODE) return at(SCOPE_TREE_PATH_KINDS.SYMLINK);
      if (entry.mode === GITLINK_MODE || entry.type === "commit") {
        return at(SCOPE_TREE_PATH_KINDS.GITLINK);
      }
      if (entry.type === "tree" && entry.mode === TREE_MODE) {
        if (index === components.length - 1) return at(SCOPE_TREE_PATH_KINDS.DIRECTORY);
        tree = entry.oid;
        continue;
      }
      if (entry.type === "blob" && REGULAR_BLOB_MODES.includes(entry.mode)) {
        return at(SCOPE_TREE_PATH_KINDS.FILE);
      }
      throw new Error(
        `scope-path component ${JSON.stringify(name)} carries an unsupported tree entry ${entry.mode} ${entry.type}`
      );
    }
    throw new Error("scope-path existence resolution did not classify a terminal component");
  }

  return Object.freeze({ base_sha: baseSha, root_tree: rootTree, resolve });
}
