

import path from "node:path";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync
} from "node:fs";

import {
  WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES,
  fail,
  assertAbsolutePath,
  assertOpaqueId,
  parseUnitAddress,
  worktreeIdentityStoreDir
} from "./worktree-substrate-primitives.mjs";

function bindingFileName(launchRef, runId, retryId) {
  const key = JSON.stringify(["worktree-identity-binding.v1", launchRef, runId, retryId]);
  const h = createHash("sha256").update(key).digest("hex");
  return `binding-${h}.json`;
}

export function bindingFilePath(mainRepo, launchRef, runId, retryId) {
  return path.join(worktreeIdentityStoreDir(mainRepo), bindingFileName(launchRef, runId, retryId));
}

export function defaultWriteBindingFile({ filePath, contents, onCreated }) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  let fd;
  try {
    fd = openSync(filePath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
  } catch (err) {
    if (err && err.code === "EEXIST") {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.STORE_COLLISION,
        `identity binding already exists (duplicate allocation of the same run identity): ${filePath}`,
        { errno: err.code },
        err
      );
    }
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.STORE_WRITE_FAILED,
      `failed to create identity binding file: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
  }
  onCreated?.();
  try {
    writeSync(fd, contents);
  } catch (err) {
    try { closeSync(fd); } catch {   }
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.STORE_WRITE_FAILED,
      `failed to write identity binding contents: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
  }
  try { closeSync(fd); } catch {   }
}

export function canonicalUnitScopes(mainRepo, wkId, sliceId) {
  const recordPath = path.join(mainRepo, "wiki", "work-records", `${wkId}.json`);
  let raw;
  try {
    raw = readFileSync(recordPath, "utf8");
  } catch (err) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.WRITE_SCOPE_UNRESOLVABLE,
      `canonical WK record not readable: ${recordPath}`,
      { errno: err?.code ?? null }
    );
  }
  let record;
  try {
    record = JSON.parse(raw);
  } catch (err) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.WRITE_SCOPE_UNRESOLVABLE,
      `canonical WK record is not valid JSON: ${recordPath}`,
      { message: err?.message ?? null }
    );
  }
  let writeScope;
  let readScope;
  let source = `wiki/work-records/${wkId}.json`;
  if (sliceId === null) {
    writeScope = record?.write_scope;
    readScope = record?.read_scope;
  } else {
    const slices = Array.isArray(record?.slices) ? record.slices : [];
    const slice = slices.find((s) => s && s.id === sliceId);
    if (!slice) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.WRITE_SCOPE_UNRESOLVABLE,
        `slice ${JSON.stringify(sliceId)} not found in ${recordPath}`,
        { wkId, sliceId }
      );
    }
    writeScope = slice.write_scope;
    readScope = slice.read_scope;
    source = `${source}#${sliceId}`;
  }
  if (!Array.isArray(writeScope) || writeScope.some((p) => typeof p !== "string" || p.length === 0)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.WRITE_SCOPE_UNRESOLVABLE,
      `write_scope for ${JSON.stringify(sliceId ?? wkId)} is not a non-empty-string array in ${recordPath}`,
      { wkId, sliceId }
    );
  }
  if (readScope === undefined) readScope = [];
  if (!Array.isArray(readScope) || readScope.some((p) => typeof p !== "string" || p.length === 0)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.WRITE_SCOPE_UNRESOLVABLE,
      `read_scope for ${JSON.stringify(sliceId ?? wkId)} is not a non-empty-string array in ${recordPath}`,
      { wkId, sliceId }
    );
  }

  return {
    readScope: Object.freeze([...readScope]),
    writeScope: Object.freeze([...writeScope]),
    source
  };
}

export function canonicalWriteScope(mainRepo, wkId, sliceId) {
  const { writeScope, source } = canonicalUnitScopes(mainRepo, wkId, sliceId);
  return { writeScope, source };
}

export function resolveWorktreeBinding({ mainRepo, launchRef, runId, retryId = 0 } = {}) {
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  assertOpaqueId(launchRef, "launch_ref");
  assertOpaqueId(runId, "run_id");
  if (!Number.isInteger(retryId) || retryId < 0) {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, `retry_id must be a non-negative integer`);
  }
  const filePath = bindingFilePath(repo, launchRef, runId, retryId);
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.BINDING_NOT_FOUND,
      `no identity binding for (launch_ref,run_id,retry_id)=(${launchRef},${runId},${retryId}) at ${filePath}`,
      { errno: err?.code ?? null }
    );
  }
  let binding;
  try {
    binding = JSON.parse(raw);
  } catch (err) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.BINDING_NOT_FOUND,
      `identity binding is not valid JSON: ${filePath}`,
      { message: err?.message ?? null }
    );
  }
  return binding;
}

export function resolveWorktreePath(args) {
  const binding = resolveWorktreeBinding(args);
  return Object.freeze({
    output_branch: binding.output_branch,
    worktree_path: binding.worktree_path,
    write_scope: Object.freeze([...(binding.write_scope ?? [])]),
    base_ref: binding.base_ref,
    base_sha: binding.base_sha,
    subject: binding.subject,
    initiative: binding.initiative
  });
}

export function resolveVerifiedWorktreeBinding({
  mainRepo,
  launchRef,
  runId,
  retryId = 0,
  expectedUnitAddress
} = {}) {
  const expected = parseUnitAddress(expectedUnitAddress);
  const binding = resolveWorktreeBinding({ mainRepo, launchRef, runId, retryId });
  if (binding.unit_address !== expected.unitAddress) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.VERIFIED_BINDING_UNIT_MISMATCH,
      `identity binding unit_address ${JSON.stringify(binding.unit_address ?? null)} does not match expected ` +
        `${JSON.stringify(expected.unitAddress)} (launch_ref=${launchRef}, run_id=${runId}, retry_id=${retryId})`,
      { expected: expected.unitAddress, actual: binding.unit_address ?? null, launchRef, runId, retryId }
    );
  }
  return binding;
}

const SPARSE_BINDING_FIELDS = Object.freeze([
  "schema_version",
  "launch_ref",
  "run_id",
  "retry_id",
  "unit_address",
  "initiative",
  "record_id",
  "slice_id",
  "base_ref",
  "base_sha",
  "output_branch",
  "worktree_path",
  "write_scope_source",
  "index_sparse"
]);

function sameStringArray(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) &&
    actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

export function resolveVerifiedSparseExactUnitBinding({
  mainRepo,
  launchRef,
  runId,
  retryId = 0,
  expectedBinding
} = {}) {
  if (!expectedBinding || typeof expectedBinding !== "object" || Array.isArray(expectedBinding)) {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, "expectedBinding must be an object");
  }
  const binding = resolveWorktreeBinding({ mainRepo, launchRef, runId, retryId });
  for (const field of SPARSE_BINDING_FIELDS) {
    if (binding[field] !== expectedBinding[field]) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.VERIFIED_BINDING_UNIT_MISMATCH,
        `sparse identity binding field ${field} does not match the server-minted value`,
        { field, expected: expectedBinding[field] ?? null, actual: binding[field] ?? null }
      );
    }
  }
  for (const field of ["write_scope", "cone_dirs"]) {
    if (!sameStringArray(binding[field], expectedBinding[field])) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.VERIFIED_BINDING_UNIT_MISMATCH,
        `sparse identity binding field ${field} does not match the server-minted value`,
        { field, expected: expectedBinding[field] ?? null, actual: binding[field] ?? null }
      );
    }
  }
  if (binding.index_sparse !== false) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.VERIFIED_BINDING_UNIT_MISMATCH,
      "sparse identity binding must pin index_sparse=false",
      { actual: binding.index_sparse ?? null }
    );
  }
  return binding;
}
