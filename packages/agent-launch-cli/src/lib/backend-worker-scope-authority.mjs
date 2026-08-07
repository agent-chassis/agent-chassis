

import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { computeWorkRecordSourceDigest } from "@agent-chassis/wiki-core";
import {
  WK_SUBJECT_RE,
  EXACT_IMPLEMENTATION_SLICE_RE,
  WORKSPACE_AGENT_FROZEN_SCOPE_AUTHORITY_SCHEMA_VERSION,
  WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V1,
  WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2,
  WORKTREE_CHECKOUT_MODE_FULL
} from "./backend-constants.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import { sameStringArray } from "./backend-scope-authority-shared.mjs";
import { SCOPE_TREE_PATH_KINDS, createWorkerScopeTreeReader } from "./backend-worker-scope-tree.mjs";

import { defaultRunGit } from "./worktree-substrate-primitives.mjs";

function normalizeCanonicalScope(entries, label, recordPath, { required = true } = {}) {
  if (!Array.isArray(entries)) {
    if (!required && entries === undefined) return Object.freeze([]);
    throw new Error(`${label} for the exact selected unit must be an array in ${recordPath}`);
  }
  const normalized = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.length === 0 || entry !== entry.trim() ||
        path.posix.isAbsolute(entry) || entry.startsWith("-") || entry.includes("\\") ||
        /[\x00-\x1f\x7f]/.test(entry) || path.posix.normalize(entry) !== entry ||
        entry === "." || entry.split("/").some((part) => part === "" || part === "." || part === "..")) {
      throw new Error(`${label} contains a non-canonical repository-relative path in ${recordPath}: ${JSON.stringify(entry)}`);
    }
    if (entry.split("/").includes(".git")) {
      throw new Error(`${label} contains a forbidden Git metadata path in ${recordPath}: ${JSON.stringify(entry)}`);
    }
    normalized.push(entry);
  }
  return Object.freeze([...new Set(normalized)].sort());
}

function assertPathWithin(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes or aliases the canonical repository root`);
  }
}

function splitValidatedScopeComponents(scopePath, label, writable) {
  const components = scopePath.split("/");
  const wildcardIndex = components.findIndex((part) => /[*?[]/.test(part));
  if (wildcardIndex === 0) {
    throw new Error(`${label} root-wide wildcard scope is unsupported: ${JSON.stringify(scopePath)}`);
  }
  if (writable && wildcardIndex !== -1) {
    throw new Error(`${label} wildcard write targets are unsupported: ${JSON.stringify(scopePath)}`);
  }
  return Object.freeze({
    wildcardIndex,
    parts: Object.freeze(wildcardIndex === -1 ? components : components.slice(0, wildcardIndex))
  });
}

function validateScopePathType(mainRepo, scopePath, label, { writable = false, allowMissingLeaf = false } = {}) {
  const { wildcardIndex, parts } = splitValidatedScopeComponents(scopePath, label, writable);
  let current = mainRepo;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const final = index === parts.length - 1;
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if ((writable || allowMissingLeaf) && final && wildcardIndex === -1) return;
      throw new Error(`${label} is incomplete at ${JSON.stringify(scopePath)}; missing ${JSON.stringify(current)}`);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} crosses a symlink at ${JSON.stringify(current)}`);
    }
    if (!final && !stat.isDirectory()) {
      throw new Error(`${label} has a path-type conflict at non-directory ${JSON.stringify(current)}`);
    }
  }
  if (parts.length > 0) {
    assertPathWithin(mainRepo, realpathSync(current), label);
  }
}

export const LANDING_AUTHORITY_WORK_RECORD_RE = /^wiki\/work-records\/[^/*?[]+\.json$/u;

function validateScopePathTypeInTree(reader, scopePath, label, { writable = false, allowMissingLeaf = false } = {}) {
  const { wildcardIndex, parts } = splitValidatedScopeComponents(scopePath, label, writable);
  if (parts.length === 0) return;
  const resolved = reader.resolve(parts);
  const at = JSON.stringify(parts.slice(0, resolved.index + 1).join("/"));
  const final = resolved.index === parts.length - 1;
  if (resolved.kind === SCOPE_TREE_PATH_KINDS.ABSENT) {
    if ((writable || allowMissingLeaf) && final && wildcardIndex === -1) return;
    throw new Error(`${label} is incomplete at ${JSON.stringify(scopePath)}; missing ${at}`);
  }
  if (resolved.kind === SCOPE_TREE_PATH_KINDS.SYMLINK) {
    throw new Error(`${label} crosses a symlink at ${at}`);
  }
  if (resolved.kind === SCOPE_TREE_PATH_KINDS.GITLINK) {
    throw new Error(`${label} crosses a gitlink at ${at}`);
  }
  if (!final) {
    throw new Error(`${label} has a path-type conflict at non-directory ${at}`);
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
  const readScope = normalizeCanonicalScope(slice.read_scope, "read_scope", recordPath, { required: false });
  const repoPaths = normalizeCanonicalScope(slice.repo_paths, "repo_paths", recordPath, { required: false });
  const writeScope = normalizeCanonicalScope(slice.write_scope, "write_scope", recordPath);
  const reader = openScopeExistenceBase({ mainRepo: repo, scopeBase, deps });

  const validateReadable = (entry, label, options) => (
    LANDING_AUTHORITY_WORK_RECORD_RE.test(entry)
      ? validateScopePathType(repo, entry, label, options)
      : validateScopePathTypeInTree(reader, entry, label, options)
  );
  for (const entry of readScope) {
    validateReadable(entry, "read_scope", { allowMissingLeaf: writeScope.includes(entry) });
  }
  for (const entry of repoPaths) {
    validateReadable(entry, "repo_paths", { allowMissingLeaf: writeScope.includes(entry) });
  }
  for (const entry of writeScope) validateScopePathTypeInTree(reader, entry, "write_scope", { writable: true });
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
    readable_scope: Object.freeze([...new Set([...readScope, ...repoPaths])].sort()),
    write_scope: writeScope
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

  if (binding.schema_version === WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V1) {
    if (binding.index_sparse !== false || !Array.isArray(binding.cone_dirs) || binding.cone_dirs.length === 0 ||
        Object.prototype.hasOwnProperty.call(binding, "checkout_mode")) {
      throw new Error("launcher-provisioned sparse (v1) authority binding is incomplete or carries a full-mode checkout_mode");
    }
  } else if (binding.schema_version === WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2) {
    if (binding.checkout_mode !== WORKTREE_CHECKOUT_MODE_FULL ||
        Object.prototype.hasOwnProperty.call(binding, "cone_dirs") ||
        Object.prototype.hasOwnProperty.call(binding, "index_sparse")) {
      throw new Error("launcher-provisioned full (v2) authority binding is incomplete or carries sparse cone facts");
    }
  } else {
    throw new Error("launcher-provisioned authority binding carries an unknown checkout-mode discriminant");
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
