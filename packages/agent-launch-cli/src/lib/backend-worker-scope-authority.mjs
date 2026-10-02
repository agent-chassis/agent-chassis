

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT,
  collectControlledContractPrivateScopeIntersections
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-private-path-policy.mjs";
import {
  computeWorkRecordSourceDigest
} from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";
import {
  REPOSITORY_SCOPE_SELECTOR_KINDS,
  UNSUPPORTED_REPOSITORY_SCOPE_SELECTOR,
  parseRepositoryScopeFileSelector,
  repositoryScopeSelectorRefusalMessage
} from "@agent-chassis/wiki-core/src/lib/work-record-repository-path.mjs";
import {
  WK_SUBJECT_RE,
  EXACT_IMPLEMENTATION_SLICE_RE,
  WORKSPACE_AGENT_FROZEN_SCOPE_AUTHORITY_SCHEMA_VERSION,
  WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2,
  WORKTREE_CHECKOUT_MODE_FULL
} from "./backend-constants.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import { sameStringArray } from "./backend-scope-authority-shared.mjs";

import {
  SCOPE_TREE_PATH_KINDS,
  createWorkerScopeTreeReader,
  resolveWritableScopeCoverage
} from "./backend-worker-scope-tree.mjs";

import { defaultRunGit } from "./worktree-substrate-primitives.mjs";

import {
  deriveCanonicalReadableScope,
  deriveCanonicalUnitScope
} from "./canonical-unit-scope.mjs";

export const WORKER_SCOPE_PATH_REFUSED = "worker_scope_path_refused";
export const WORKER_SCOPE_PATH_REFUSAL_CAUSES = Object.freeze({
  NON_CANONICAL: "non_canonical_path",
  GIT_METADATA: "git_metadata_path",
  MISSING_LEAF: "missing_leaf",
  MISSING_INTERMEDIATE: "missing_intermediate",
  SYMLINK: "symlink",
  GITLINK: "gitlink",
  TYPE_CONFLICT: "type_conflict",
  ESCAPES_REPOSITORY: "escapes_repository",

  GLOB_SELECTOR: REPOSITORY_SCOPE_SELECTOR_KINDS.GLOB,
  DIRECTORY_SCOPE: REPOSITORY_SCOPE_SELECTOR_KINDS.DIRECTORY
});
const CAUSES = WORKER_SCOPE_PATH_REFUSAL_CAUSES;
const CAUSE_VALUES = new Set(Object.values(CAUSES));
const SCOPE_FIELDS = new Set(["read_scope", "repo_paths", "write_scope"]);
const SCOPE_PATH_FACT_LIMIT = 1024;

const mintedScopePathRefusals = new WeakSet();

function scopePathRefusal(message, { field, path: entry, component = null, cause }) {
  const error = new Error(message);
  error.code = WORKER_SCOPE_PATH_REFUSED;
  error.detail = Object.freeze({ field, path: entry, component, cause });
  mintedScopePathRefusals.add(error);
  return error;
}

const boundedScopeFact = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= SCOPE_PATH_FACT_LIMIT ? value : null;

export function readWorkerScopePathRefusal(error) {
  if (!mintedScopePathRefusals.has(error)) return null;
  const { field, path: entry, component, cause } = error.detail;
  if (!SCOPE_FIELDS.has(field) || !CAUSE_VALUES.has(cause) || boundedScopeFact(entry) === null) return null;
  return Object.freeze({
    code: WORKER_SCOPE_PATH_REFUSED,
    field,
    path: entry,
    component: boundedScopeFact(component),
    cause
  });
}

function unsupportedScopeSelectorRefusal(field, entry, cause, component = null) {
  return scopePathRefusal(repositoryScopeSelectorRefusalMessage(field, entry),
    { field, path: entry, component, cause });
}

export const scopeInvalid = (message, facts = null) => {
  if (facts === null) throw new Error(message);
  if (facts.kind === "unsupported_selector") {
    throw unsupportedScopeSelectorRefusal(facts.field, facts.path, facts.selector_kind);
  }
  const kind = facts.kind === "git_metadata" ? "forbidden Git metadata" : "non-canonical repository-relative";
  throw scopePathRefusal(`${facts.field} contains a ${kind} path: ${JSON.stringify(facts.path)}`, {
    field: facts.field,
    path: facts.path,
    cause: facts.kind === "git_metadata" ? CAUSES.GIT_METADATA : CAUSES.NON_CANONICAL
  });
};

function assertPathWithin(root, candidate, label, scopePath = null) {
  const relative = path.relative(root, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    const message = `${label} escapes or aliases the canonical repository root`;
    if (scopePath === null) throw new Error(message);
    throw scopePathRefusal(message, { field: label, path: scopePath, cause: CAUSES.ESCAPES_REPOSITORY });
  }
}

function splitValidatedScopeComponents(scopePath, label) {
  const parsed = parseRepositoryScopeFileSelector(scopePath);
  if (!parsed.ok && parsed.diagnostic.code === UNSUPPORTED_REPOSITORY_SCOPE_SELECTOR) {
    throw unsupportedScopeSelectorRefusal(label, scopePath, parsed.diagnostic.selector_kind);
  }
  if (!parsed.ok) {
    throw scopePathRefusal(
      `${label} contains a non-canonical repository-relative path: ${JSON.stringify(scopePath)}`,
      { field: label, path: scopePath, cause: CAUSES.NON_CANONICAL }
    );
  }
  return parsed.value.components;
}

function validateScopePathType(mainRepo, scopePath, label, { writable = false, allowMissingLeaf = false } = {}) {
  const parts = splitValidatedScopeComponents(scopePath, label);
  const componentAt = (index) => parts.slice(0, index + 1).join("/");
  const refuse = (message, index, cause) => scopePathRefusal(message, {
    field: label, path: scopePath, component: componentAt(index), cause
  });
  let current = mainRepo;
  let finalStat = null;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const final = index === parts.length - 1;
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if ((writable || allowMissingLeaf) && final) return;
      throw refuse(
        `${label} is incomplete at ${JSON.stringify(scopePath)}; missing ${JSON.stringify(componentAt(index))}`,
        index, final ? CAUSES.MISSING_LEAF : CAUSES.MISSING_INTERMEDIATE
      );
    }
    if (stat.isSymbolicLink()) {
      throw refuse(`${label} crosses a symlink at ${JSON.stringify(componentAt(index))}`, index, CAUSES.SYMLINK);
    }
    if (!final && !stat.isDirectory()) {
      throw refuse(
        `${label} has a path-type conflict at non-directory ${JSON.stringify(componentAt(index))}`, index, CAUSES.TYPE_CONFLICT
      );
    }
    if (final) finalStat = stat;
  }
  if (finalStat !== null && finalStat.isDirectory()) {
    throw unsupportedScopeSelectorRefusal(label, scopePath, CAUSES.DIRECTORY_SCOPE, componentAt(parts.length - 1));
  }
  if (parts.length > 0) {
    assertPathWithin(mainRepo, realpathSync(current), label, scopePath);
  }
}

export const LANDING_AUTHORITY_WORK_RECORD_RE = /^wiki\/work-records\/[^/*?[]+\.json$/u;

function validateScopePathTypeInTree(reader, scopePath, label, { output = false } = {}) {
  const parts = splitValidatedScopeComponents(scopePath, label);
  const resolved = reader.resolve(parts);
  const component = parts.slice(0, resolved.index + 1).join("/");
  const at = JSON.stringify(component);
  const final = resolved.index === parts.length - 1;
  const refuse = (message, cause) => scopePathRefusal(message, { field: label, path: scopePath, component, cause });
  if (resolved.kind === SCOPE_TREE_PATH_KINDS.ABSENT) {
    if (output) return;
    throw refuse(
      `${label} is incomplete at ${JSON.stringify(scopePath)}; missing ${at}`,
      final ? CAUSES.MISSING_LEAF : CAUSES.MISSING_INTERMEDIATE
    );
  }
  if (resolved.kind === SCOPE_TREE_PATH_KINDS.SYMLINK) {
    throw refuse(`${label} crosses a symlink at ${at}`, CAUSES.SYMLINK);
  }
  if (resolved.kind === SCOPE_TREE_PATH_KINDS.GITLINK) {
    throw refuse(`${label} crosses a gitlink at ${at}`, CAUSES.GITLINK);
  }
  if (!final) {
    throw refuse(`${label} has a path-type conflict at non-directory ${at}`, CAUSES.TYPE_CONFLICT);
  }

  if (resolved.kind === SCOPE_TREE_PATH_KINDS.DIRECTORY) {
    throw unsupportedScopeSelectorRefusal(label, scopePath, CAUSES.DIRECTORY_SCOPE, component);
  }
}

function openScopeExistenceBase({ mainRepo, scopeBase, deps }) {
  if (!isPlainObject(scopeBase) || typeof scopeBase.base_ref !== "string" ||
      scopeBase.base_ref.length === 0 || typeof scopeBase.base_sha !== "string") {
    throw new Error(
      "launcher-resolved scope-path existence base is absent; managed worker scope does not fall back to the live working directory"
    );
  }
  return createWorkerScopeTreeReader({
    runGit: deps?.runGit ?? defaultRunGit,
    mainRepo,
    baseSha: scopeBase.base_sha
  });
}

export function resolveFrozenWorkerScopeAuthority({ mainRepo, subject, record, slice, scopeBase, deps = {} }) {
  const match = typeof subject === "string" ? subject.match(EXACT_IMPLEMENTATION_SLICE_RE) : null;
  if (!match || record?.id !== match[1] || slice?.id !== match[2] || slice.work_kind !== "implementation") {
    throw new Error("exact canonical implementation slice identity is unresolved or mismatched");
  }
  const requestedRepo = path.resolve(mainRepo);
  const repo = realpathSync(requestedRepo);
  if (requestedRepo !== repo) {
    throw new Error("launcher-provisioned mainRepo must not contain a symlink or path alias");
  }
  const recordPath = path.join(repo, "wiki", "work-records", `${match[1]}.json`);
  validateScopePathType(repo, `wiki/work-records/${match[1]}.json`, "canonical work-record source");
  const recordRealPath = realpathSync(recordPath);
  assertPathWithin(repo, recordRealPath, "canonical work-record source");
  const privateScopePolicyFacts = collectControlledContractPrivateScopeIntersections(slice, {
    unitAddress: subject,
    status: slice.status ?? null
  });
  const scopeOptions = { invalid: scopeInvalid, forbidGitMetadata: true };
  const readScope = deriveCanonicalUnitScope(
    slice.read_scope, "read_scope", recordPath, { ...scopeOptions, required: false });
  const repoPaths = deriveCanonicalUnitScope(
    slice.repo_paths, "repo_paths", recordPath, { ...scopeOptions, required: false });
  const writeScope = deriveCanonicalUnitScope(
    slice.write_scope, "write_scope", recordPath, scopeOptions);
  const reader = openScopeExistenceBase({ mainRepo: repo, scopeBase, deps });

  const validateReadable = (entry, label, coveredOutput) => (
    LANDING_AUTHORITY_WORK_RECORD_RE.test(entry)
      ? validateScopePathType(repo, entry, label, { allowMissingLeaf: coveredOutput })
      : validateScopePathTypeInTree(reader, entry, label, { output: coveredOutput })
  );
  for (const entry of writeScope) validateScopePathTypeInTree(reader, entry, "write_scope", { output: true });

  const exclusions = Object.freeze([CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT]);
  const writable = resolveWritableScopeCoverage(reader, writeScope, { exclusions });

  const [conflict] = writable.conflicts;
  if (conflict !== undefined) {
    throw scopePathRefusal(
      `write_scope has a path-type conflict at ${JSON.stringify(conflict.component)}: it is declared as an output file and as a parent of ${JSON.stringify(conflict.path)}`,
      { field: "write_scope", path: conflict.path, component: conflict.component, cause: CAUSES.TYPE_CONFLICT }
    );
  }
  const writableCovers = writable.covers;

  for (const [label, entries] of [["read_scope", readScope], ["repo_paths", repoPaths]]) {
    for (const entry of entries) {
      validateReadable(entry, label, writableCovers(entry));
    }
  }
  const readableScope = deriveCanonicalReadableScope(readScope, repoPaths);
  const readable = reader.resolveMembership(
    readableScope.filter((entry) => !LANDING_AUTHORITY_WORK_RECORD_RE.test(entry)), { exclusions });
  const readableFiles = [
    ...readable.files, ...readableScope.filter((entry) => LANDING_AUTHORITY_WORK_RECORD_RE.test(entry))
  ];
  const resolvedScope = Object.freeze({
    readable: Object.freeze({
      files: Object.freeze([...new Set(readableFiles)].filter((file) => !writableCovers(file)).sort()),
      directories: Object.freeze(readable.directories.filter((directory) => !writableCovers(directory)))
    }),
    writable: Object.freeze({
      files: writable.files,
      directories: writable.directories
    })
  });
  if (record.schema_version !== undefined &&
      (typeof record.schema_version !== "string" || record.schema_version.length === 0)) {
    throw new Error("canonical work-record schema_version is incompatible");
  }
  const selectedUnit = Object.freeze({
    kind: "slice",
    address: subject,
    record_id: match[1],
    slice_id: match[2],
    repo: record.repo ?? null
  });
  return Object.freeze({
    schema_version: WORKSPACE_AGENT_FROZEN_SCOPE_AUTHORITY_SCHEMA_VERSION,
    unit_address: `${record.initiative}/${match[1]}/${match[2]}`,
    selected_unit: selectedUnit,
    source: `wiki/work-records/${match[1]}.json#${match[2]}`,
    source_digest: computeWorkRecordSourceDigest(record),
    source_version: record.schema_version ?? null,
    read_scope: readScope,
    repo_paths: repoPaths,
    readable_scope: readableScope,
    write_scope: writeScope,

    scope_exclusions: exclusions,

    resolved_scope: resolvedScope,

    scope_preparation: Object.freeze({
      base_sha: reader.base_sha,
      directories: writable.preparation_directories
    }),
    private_scope_policy_facts: privateScopePolicyFacts
  });
}

export function assertProvisionedScopeAuthority(binding, authority) {
  if (!isPlainObject(binding)) throw new Error("launcher-provisioned exact-unit binding is absent");
  const selected = binding.selected_unit;
  const expectedSelected = authority.selected_unit;
  const scalarMismatch = [
    ["unit_address", binding.unit_address, authority.unit_address],
    ["write_scope_source", binding.write_scope_source, authority.source],
    ["source_digest", binding.source_digest, authority.source_digest],
    ["source_version", binding.source_version, authority.source_version]
  ].find(([, actual, expected]) => actual !== expected);
  if (scalarMismatch) {
    throw new Error(`launcher-provisioned authority mismatch at ${scalarMismatch[0]}`);
  }
  for (const [field, expected] of [
    ["read_scope", authority.read_scope],
    ["repo_paths", authority.repo_paths],
    ["write_scope", authority.write_scope]
  ]) {
    if (!sameStringArray(binding[field], expected)) {
      throw new Error(`launcher-provisioned authority mismatch at ${field}`);
    }
  }
  if (!isPlainObject(selected) || ["kind", "address", "record_id", "slice_id", "repo"]
    .some((field) => selected[field] !== expectedSelected[field])) {
    throw new Error("launcher-provisioned authority selected-unit identity mismatch");
  }

  if (binding.schema_version !== WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2) {
    throw new Error("launcher-provisioned authority binding is not a full-checkout v2 binding");
  }
  if (binding.checkout_mode !== WORKTREE_CHECKOUT_MODE_FULL ||
      Object.prototype.hasOwnProperty.call(binding, "cone_dirs") ||
      Object.prototype.hasOwnProperty.call(binding, "index_sparse")) {
    throw new Error("launcher-provisioned full (v2) authority binding is incomplete or carries sparse cone facts");
  }
  return binding;
}

export function readCanonicalWorkRecord(mainRepo, subject) {
  const match = typeof subject === "string" ? subject.match(WK_SUBJECT_RE) : null;
  if (!match) return null;
  try {
    const requestedRepo = path.resolve(mainRepo);
    const repo = realpathSync(requestedRepo);
    if (requestedRepo !== repo) return null;
    const relativeRecordPath = `wiki/work-records/${match[1]}.json`;
    validateScopePathType(repo, relativeRecordPath, "canonical work-record source");
    return JSON.parse(readFileSync(path.join(repo, relativeRecordPath), "utf8"));
  } catch {
    return null;
  }
}
