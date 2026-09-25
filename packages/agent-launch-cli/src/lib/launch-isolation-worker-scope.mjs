import path from "node:path";
import { lstatSync, mkdirSync, realpathSync, rmdirSync } from "node:fs";
import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  fail,
  isNonEmptyString,
  isWithinRepo
} from "./launch-isolation-errors.mjs";

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

export function rollbackPreparedWorkerDirectories(entries) {
  const removed = [];
  const preserved = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    try {
      if (!sameDirectoryIdentity(entry.real, entry.identity)) {
        preserved.push(entry.real);
        continue;
      }
      rmdirSync(entry.real);
      removed.push(entry.real);
    } catch {
      preserved.push(entry.real);
    }
  }
  return Object.freeze({ removed: Object.freeze(removed), preserved: Object.freeze(preserved) });
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

export function prepareSparseWorkerWritableDirectories({ authority = null, repo } = {}) {
  const none = Object.freeze({ entries: Object.freeze([]), rollback: () => rollbackPreparedWorkerDirectories([]) });
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
  const exclusions = frozenAuthority.scope_exclusions ?? [];
  const created = [];
  try {
    for (const [index, entry] of frozenAuthority.resolved_scope.writable.directories.entries()) {
      const label = `workerScopeAuthority.resolved_scope.writable.directories[${index}]`;
      if (exclusions.some((root) => entry === root || entry.startsWith(`${root}/`))) {
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
          `${label} lies inside a launcher-excluded family: ${entry}`,
          { field: "writable.directories", index, path: entry }
        );
      }
      const prepared = createMissingDirectoryLeaf(
        relativeAuthorityPathToAbsolute(entry, label, repoReal), label, repoReal,
        Object.freeze({ access: "writable", member_kind: "directories", index, path: entry })
      );
      if (prepared !== null) created.push(prepared);
    }
  } catch (error) {
    rollbackPreparedWorkerDirectories(created);
    throw error;
  }
  const entries = Object.freeze(created);
  return Object.freeze({ entries, rollback: () => rollbackPreparedWorkerDirectories(entries) });
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
