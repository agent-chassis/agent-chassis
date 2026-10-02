import path from "node:path";
import { lstatSync, mkdirSync, readdirSync, realpathSync, rmdirSync } from "node:fs";
import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  fail,
  isNonEmptyString,
  isWithinRepo
} from "./launch-isolation-errors.mjs";
import { workerScopePreparationDefect } from "./worker-scope-preparation.mjs";

function relativeAuthorityPathToAbsolute(entry, label, repoReal) {
  if (!isNonEmptyString(entry) || path.isAbsolute(entry) || path.normalize(entry) !== entry ||
      entry === "." || entry.startsWith(`..${path.sep}`) || entry.includes("\\")) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      `${label} must be a normalized repo-relative path: ${String(entry)}`
    );
  }
  const absolute = path.join(repoReal, entry);
  if (!isWithinRepo(absolute, repoReal) || absolute === repoReal) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_OUTSIDE_REPO,
      `${label} escapes or aliases the canonical repository root: ${entry}`
    );
  }
  return absolute;
}

function scopeMemberDetail(scopeMember, repoReal, current) {
  if (scopeMember === null) return {};
  return {
    scope_member: Object.freeze({
      ...scopeMember,
      failed_component: path.relative(repoReal, current).split(path.sep).join("/")
    })
  };
}

function inspectAuthorityPath(absolute, label, repoReal, {
  allowMissingLeaf = false,
  scopeMember = null
} = {}) {
  const relative = path.relative(repoReal, absolute);
  const components = relative.split(path.sep);
  let current = repoReal;
  for (let i = 0; i < components.length; i += 1) {
    current = path.join(current, components[i]);
    let st;
    try {
      st = lstatSync(current);
    } catch (err) {
      if (allowMissingLeaf && i === components.length - 1 && err?.code === "ENOENT") {
        return Object.freeze({ absolute, kind: "missing_file" });
      }
      fail(
        i === components.length - 1
          ? BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_FILE
          : BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
        `${label} component could not be inspected: ${current}`,
        { errno: err?.code ?? null, ...scopeMemberDetail(scopeMember, repoReal, current) }
      );
    }
    if (st.isSymbolicLink()) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_OUTSIDE_REPO,
        `${label} refuses symlink component: ${current}`,
        { component: current, ...scopeMemberDetail(scopeMember, repoReal, current) }
      );
    }
    if (i < components.length - 1 && !st.isDirectory()) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
        `${label} has a non-directory parent component: ${current}`,
        scopeMemberDetail(scopeMember, repoReal, current)
      );
    }
    if (i === components.length - 1) {
      if (st.isDirectory()) return Object.freeze({ absolute, kind: "directory" });
      if (st.isFile()) return Object.freeze({ absolute, kind: "file" });
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
        `${label} must resolve to a regular file or directory: ${current}`
      );
    }
  }
  return null;
}

function samePathSet(actual, expected) {
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

export function sparseNamespaceSkeleton(paths, repoReal) {
  const skeleton = new Set();
  for (const visible of paths) {
    let parent = path.dirname(visible);
    while (parent !== repoReal) {
      skeleton.add(parent);
      parent = path.dirname(parent);
    }
  }
  return [...skeleton].sort((a, b) => {
    const depth = a.split(path.sep).length - b.split(path.sep).length;
    return depth || a.localeCompare(b);
  });
}

function assertIsolationWorkerScopeAuthority(authority) {
  const frozenStringArray = (value) => Array.isArray(value) && Object.isFrozen(value) &&
    value.every((entry) => isNonEmptyString(entry));
  const selected = authority?.selected_unit;
  const resolved = authority?.resolved_scope;
  const frozenMembers = (value) => value !== null && typeof value === "object" && Object.isFrozen(value) &&
    frozenStringArray(value.files) && frozenStringArray(value.directories);
  if (
    authority === null || typeof authority !== "object" || Array.isArray(authority) ||
    !Object.isFrozen(authority) ||
    authority.schema_version !== "workspace-agent-frozen-scope-authority.v1" ||
    selected === null || typeof selected !== "object" || Array.isArray(selected) ||
    !Object.isFrozen(selected) || selected.kind !== "slice" ||
    !isNonEmptyString(selected.address) || !isNonEmptyString(selected.record_id) ||
    !isNonEmptyString(selected.slice_id) ||
    authority.source !== `wiki/work-records/${selected.record_id}.json#${selected.slice_id}` ||
    !isNonEmptyString(authority.unit_address) ||
    !authority.unit_address.endsWith(`/${selected.record_id}/${selected.slice_id}`) ||
    !isNonEmptyString(authority.source_digest) ||
    !frozenStringArray(authority.read_scope) ||
    !frozenStringArray(authority.repo_paths) ||
    !frozenStringArray(authority.readable_scope) ||
    !frozenStringArray(authority.write_scope) ||
    resolved === null || typeof resolved !== "object" || !Object.isFrozen(resolved) ||
    !frozenMembers(resolved.readable) || !frozenMembers(resolved.writable) ||
    (authority.scope_exclusions !== undefined && (
      !frozenStringArray(authority.scope_exclusions) ||
      authority.scope_exclusions.length !== 1 ||
      authority.scope_exclusions[0] !== "wiki/contracts"
    ))
  ) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "worker scope authority is incomplete, mutable, or malformed"
    );
  }
  for (const field of ["read_scope", "repo_paths", "readable_scope", "write_scope"]) {
    for (const [index, entry] of authority[field].entries()) {
      if (entry.split("/").includes(".git")) {
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
          `worker scope authority ${field}[${index}] must not name Git metadata: ${entry}`,
          { field, index, path: entry }
        );
      }
    }
  }
  const expectedReadable = [...new Set([...authority.read_scope, ...authority.repo_paths])].sort();
  if (!samePathSet(authority.readable_scope, expectedReadable)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "worker scope authority readable_scope mismatches frozen R"
    );
  }
  const preparationDefect = workerScopePreparationDefect(authority);
  if (preparationDefect !== null) {
    fail(BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID, preparationDefect);
  }
  return authority;
}

function directoryIdentity(stat) {
  return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino) });
}

function sameDirectoryIdentity(absolute, identity) {
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch {
    return false;
  }
  return stat.isDirectory() && !stat.isSymbolicLink() &&
    String(stat.dev) === identity.dev && String(stat.ino) === identity.ino;
}

const RMDIR_NOT_ELIGIBLE = new Set(["ENOENT", "ENOTEMPTY", "EEXIST", "ENOTDIR"]);

export function rollbackPreparedWorkerDirectories(entries) {
  const removed = [];
  const preserved = [];
  const failed = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!sameDirectoryIdentity(entry.real, entry.identity)) {
      preserved.push(entry.real);
      continue;
    }
    try {
      rmdirSync(entry.real);
      removed.push(entry.real);
    } catch (error) {
      if (RMDIR_NOT_ELIGIBLE.has(error?.code)) preserved.push(entry.real);
      else failed.push(Object.freeze({ real: entry.real, kind: "directory", errno: error?.code ?? null }));
    }
  }
  return Object.freeze({
    removed: Object.freeze(removed),
    preserved: Object.freeze(preserved),
    failed: Object.freeze(failed)
  });
}

function stillReleasableDirectory(entry) {
  try {
    const stat = lstatSync(entry.real);
    return stat.isDirectory() && !stat.isSymbolicLink() &&
      String(stat.dev) === entry.identity.dev && String(stat.ino) === entry.identity.ino &&
      readdirSync(entry.real).length === 0;
  } catch {
    return false;
  }
}

export function retainedPrecreatedResourceFailure({ directories = [], outcome = null, repo = null } = {}) {
  const where = (real) => typeof repo === "string" ? path.relative(repo, real) : "<host-path>";
  const files = (outcome?.failed ?? []).filter((entry) => entry.kind !== "directory")
    .map((entry) => Object.freeze({
      code: "attempt_owned_file_retained",
      message: `retained ${where(entry.real)}${entry.errno ? ` (${entry.errno})` : ""}`
    }));
  const retained = directories.filter(stillReleasableDirectory).map((entry) => Object.freeze({
    code: "attempt_owned_directory_retained",
    message: `retained ${where(entry.real)}`
  }));
  const failures = [...files, ...retained];
  if (failures.length === 0) return null;
  const directoriesOnly = files.length === 0;
  const error = new Error(directoriesOnly
    ? `${retained.length} attempt-owned empty directories could not be removed`
    : `${failures.length} attempt-owned precreated resources could not be removed`);
  error.code = directoriesOnly ? "attempt_owned_directory_retained" : "attempt_owned_resource_retained";
  error.detail = Object.freeze({ failures: Object.freeze(failures) });
  return error;
}

const CLEANUP_FAILURE_LIMIT = 8;

export function withPreparationRollback(error, outcome, { directories = [], repo = null } = {}) {
  const failure = retainedPrecreatedResourceFailure({ directories, outcome, repo });
  if (failure === null || error === null || typeof error !== "object") return error;
  const failures = failure.detail.failures;
  const evidence = Object.freeze({
    reason: "writable_file_precreation_cleanup_failed",
    code: failure.code,
    message: failure.message,
    failures: Object.freeze(failures.slice(0, CLEANUP_FAILURE_LIMIT)),
    failure_count: failures.length
  });
  const detail = error.detail;
  error.detail = Object.freeze({
    ...(detail !== null && typeof detail === "object" && !Array.isArray(detail)
      ? detail
      : detail === undefined ? {} : { primary_detail: detail }),
    precreation_cleanup_failure: evidence
  });
  return error;
}

export function releasePreparedDirectoriesOnRefusal(error, entries, repo) {
  return withPreparationRollback(error, rollbackPreparedWorkerDirectories(entries),
    { directories: entries, repo });
}

export function createMissingDirectoryLeaf(absolute, label, repoReal, scopeMember) {
  const memberAt = (component) => scopeMemberDetail(scopeMember, repoReal, component);
  const components = path.relative(repoReal, absolute).split(path.sep);
  let current = repoReal;
  for (let i = 0; i < components.length - 1; i += 1) {
    current = path.join(current, components[i]);
    let st;
    try {
      st = lstatSync(current);
    } catch (err) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
        `${label} parent component is missing: ${current}`,
        { errno: err?.code ?? null, ...memberAt(current) }
      );
    }
    if (st.isSymbolicLink()) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_OUTSIDE_REPO,
        `${label} refuses symlink component: ${current}`,
        memberAt(current)
      );
    }
    if (!st.isDirectory()) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
        `${label} has a non-directory parent component: ${current}`,
        memberAt(current)
      );
    }
  }
  try {
    lstatSync(absolute);

    return null;
  } catch (err) {
    if (err?.code !== "ENOENT") {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
        `${label} could not be inspected: ${absolute}`,
        { errno: err?.code ?? null, ...memberAt(absolute) }
      );
    }
  }
  try {
    mkdirSync(absolute);
  } catch (err) {

    if (err?.code === "EEXIST") return null;
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
      `${label} could not be prepared: ${absolute}`,
      { errno: err?.code ?? null, ...memberAt(absolute) }
    );
  }
  const st = lstatSync(absolute);
  if (!st.isDirectory() || st.isSymbolicLink()) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
      `${label} changed type during preparation: ${absolute}`,
      memberAt(absolute)
    );
  }
  return Object.freeze({ real: absolute, kind: "directory", identity: directoryIdentity(st) });
}

export function prepareWorkerStructuralParents({ authority = null, repo } = {}) {
  const none = Object.freeze({
    entries: Object.freeze([]),
    repo: null,
    rollback: () => rollbackPreparedWorkerDirectories([])
  });
  if (authority === null || authority === undefined) return none;
  const frozenAuthority = assertIsolationWorkerScopeAuthority(authority);
  if (!isNonEmptyString(repo) || !path.isAbsolute(repo)) {
    fail(BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.REPO_INVALID, `repo must be an absolute path: ${String(repo)}`);
  }
  let repoReal;
  try {
    repoReal = realpathSync(repo);
  } catch (err) {
    fail(BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.REPO_INVALID, `repo realpath failed: ${repo}`, { errno: err?.code ?? null });
  }
  const files = frozenAuthority.resolved_scope.writable.files;
  const created = [];
  try {
    for (const [position, entry] of frozenAuthority.scope_preparation.directories.entries()) {
      const label = `workerScopeAuthority.scope_preparation.directories[${position}]`;

      const index = files.findIndex((file) => file.startsWith(`${entry}/`));
      const prepared = createMissingDirectoryLeaf(
        relativeAuthorityPathToAbsolute(entry, label, repoReal), label, repoReal,
        Object.freeze({ access: "writable", member_kind: "files", index, path: files[index] })
      );
      if (prepared !== null) created.push(prepared);
    }
  } catch (error) {
    throw releasePreparedDirectoriesOnRefusal(error, created, repoReal);
  }
  const entries = Object.freeze(created);
  return Object.freeze({ entries, repo: repoReal, rollback: () => rollbackPreparedWorkerDirectories(entries) });
}

export function buildSparseWorkerNamespace({
  authority,
  repoReal,
  writableRoots,
  writableFiles
}) {
  if (!Array.isArray(writableRoots) || !Array.isArray(writableFiles)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "sparse worker writableRoots and writableFiles must be arrays"
    );
  }
  const frozenAuthority = assertIsolationWorkerScopeAuthority(authority);

  const project = (entries, field, kinds, options) => entries.map((entry, index) => {
    const label = `workerScopeAuthority.resolved_scope.${field}[${index}]`;
    const [access, memberKind] = field.split(".");
    const inspected = inspectAuthorityPath(
      relativeAuthorityPathToAbsolute(entry, label, repoReal), label, repoReal, {
        ...options,
        scopeMember: Object.freeze({ access, member_kind: memberKind, index, path: entry })
      }
    );
    if (!kinds.includes(inspected.kind)) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
        `${label} no longer has its resolved source type: ${entry}`
      );
    }
    return inspected;
  });
  const { readable: readableScope, writable: writableScope } = frozenAuthority.resolved_scope;
  const readable = [
    ...project(readableScope.files, "readable.files", ["file"]),
    ...project(readableScope.directories, "readable.directories", ["directory"])
  ];
  const writable = [
    ...project(writableScope.files, "writable.files", ["file", "missing_file"], { allowMissingLeaf: true }),
    ...project(writableScope.directories, "writable.directories", ["directory"])
  ];
  const expectedRoots = writable.filter((entry) => entry.kind === "directory").map((entry) => entry.absolute);
  const expectedFiles = writable.filter((entry) => entry.kind !== "directory").map((entry) => entry.absolute);
  if (!samePathSet(writableRoots, expectedRoots) || !samePathSet(writableFiles, expectedFiles)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "worker writable mounts must exactly match immutable worker scope authority",
      { expectedRoots, expectedFiles, writableRoots, writableFiles }
    );
  }
  const visible = [...readable, ...writable];
  const aliases = new Map();
  for (const entry of visible) {
    const real = entry.kind === "missing_file" ? entry.absolute : realpathSync(entry.absolute);
    const prior = aliases.get(real);
    if (prior && prior !== entry.absolute) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
        `worker scope contains canonical-path aliases: ${prior} and ${entry.absolute}`
      );
    }
    aliases.set(real, entry.absolute);
  }
  return Object.freeze({
    authority: frozenAuthority,
    readable: Object.freeze(readable),
    writable: Object.freeze(writable),
    exclusions: Object.freeze((frozenAuthority.scope_exclusions ?? []).map((entry, index) =>
      Object.freeze({
        relative: entry,
        absolute: relativeAuthorityPathToAbsolute(
          entry, `workerScopeAuthority.scope_exclusions[${index}]`, repoReal
        )
      }))),
    skeleton: Object.freeze(sparseNamespaceSkeleton(visible.map((entry) => entry.absolute), repoReal))
  });
}
