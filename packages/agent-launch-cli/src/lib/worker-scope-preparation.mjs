

import { compareShallowestFirst } from "./backend-worker-scope-tree.mjs";

const EXACT_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const ZERO_OID_RE = /^0+$/u;

function isRepositoryRelativeDirectory(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") &&
    !value.endsWith("/") && !value.includes("\\") && !value.includes("\0") &&
    value.split("/").every((component) =>
      component.length > 0 && component !== "." && component !== ".." && component !== ".git");
}

const excludedBy = (exclusions, candidate) =>
  exclusions.some((root) => candidate === root || candidate.startsWith(`${root}/`));

export function workerScopePreparationDefect(authority) {
  const preparation = authority?.scope_preparation;
  if (preparation === null || typeof preparation !== "object" || Array.isArray(preparation) ||
      !Object.isFrozen(preparation) ||
      Object.keys(preparation).sort().join(",") !== "base_sha,directories") {
    return "worker scope authority scope_preparation is absent, mutable, or malformed";
  }
  if (typeof preparation.base_sha !== "string" || !EXACT_OID_RE.test(preparation.base_sha) ||
      ZERO_OID_RE.test(preparation.base_sha)) {
    return "worker scope authority scope_preparation.base_sha is not an exact object id";
  }
  const directories = preparation.directories;
  if (!Array.isArray(directories) || !Object.isFrozen(directories) ||
      !directories.every(isRepositoryRelativeDirectory)) {
    return "worker scope authority scope_preparation.directories is mutable or names a non-canonical path";
  }
  for (let index = 1; index < directories.length; index += 1) {
    if (compareShallowestFirst(directories[index - 1], directories[index]) >= 0) {
      return "worker scope authority scope_preparation.directories is not unique and shallowest-first ordered";
    }
  }
  const readable = authority.resolved_scope?.readable;
  const writable = authority.resolved_scope?.writable;
  if (!Array.isArray(readable?.files) || !Array.isArray(writable?.files)) {
    return "worker scope authority resolved_scope is malformed";
  }
  const members = new Set([...readable.files, ...writable.files]);
  const exclusions = authority.scope_exclusions ?? [];
  for (const directory of directories) {
    if (members.has(directory)) {
      return `worker scope authority scope_preparation names a scope file as a directory: ${directory}`;
    }
    if (excludedBy(exclusions, directory)) {
      return `worker scope authority scope_preparation lies inside a launcher-excluded family: ${directory}`;
    }
    if (!writable.files.some((file) => file.startsWith(`${directory}/`))) {
      return `worker scope authority scope_preparation is not a parent of any writable file: ${directory}`;
    }
  }
  return null;
}

export function projectWorkerScopePreparation(authority) {
  const files = authority.resolved_scope.writable.files;
  return Object.freeze(authority.scope_preparation.directories.map((directory) => Object.freeze({
    scope_entry: files.find((file) => file.startsWith(`${directory}/`)),
    directory
  })));
}
