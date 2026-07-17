import path from "node:path";
import { lstatSync, realpathSync } from "node:fs";
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

function inspectAuthorityPath(absolute, label, repoReal, { allowMissingLeaf = false } = {}) {
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
        { errno: err?.code ?? null }
      );
    }
    if (st.isSymbolicLink()) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_OUTSIDE_REPO,
        `${label} refuses symlink component: ${current}`,
        { component: current }
      );
    }
    if (i < components.length - 1 && !st.isDirectory()) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_MISSING_PARENT,
        `${label} has a non-directory parent component: ${current}`
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
    !frozenStringArray(authority.write_scope)
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
  const readable = frozenAuthority.readable_scope.map((entry, index) =>
    inspectAuthorityPath(
      relativeAuthorityPathToAbsolute(entry, `workerScopeAuthority.readable_scope[${index}]`, repoReal),
      `workerScopeAuthority.readable_scope[${index}]`,
      repoReal
    )
  );
  const writable = frozenAuthority.write_scope.map((entry, index) =>
    inspectAuthorityPath(
      relativeAuthorityPathToAbsolute(entry, `workerScopeAuthority.write_scope[${index}]`, repoReal),
      `workerScopeAuthority.write_scope[${index}]`,
      repoReal,
      { allowMissingLeaf: true }
    )
  );
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
    skeleton: Object.freeze(sparseNamespaceSkeleton(visible.map((entry) => entry.absolute), repoReal))
  });
}
