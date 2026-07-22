

import path from "node:path";
import { createHash } from "node:crypto";
import { computeWorkRecordSourceDigest } from "@agent-chassis/wiki-core";
import {
  closeSync,
  constants as fsConstants,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeSync
} from "node:fs";

import {
  WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES,
  WORKTREE_SUBSTRATE_SCHEMA_VERSION,
  fail,
  assertAbsolutePath,
  assertOpaqueId,
  parseUnitAddress,
  deriveCanonicalSparseConeDirs,
  defaultRunGit,
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

function normalizeCanonicalScope(entries, label, recordPath, { required = false } = {}) {
  if (entries === undefined && !required) return Object.freeze([]);
  if (!Array.isArray(entries)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.WRITE_SCOPE_UNRESOLVABLE,
      `${label} for the selected unit is not an array in ${recordPath}`
    );
  }
  const normalized = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.length === 0 || entry !== entry.trim() ||
        path.posix.isAbsolute(entry) || entry.startsWith("-") || entry.includes("\\") ||
        /[\x00-\x1f\x7f]/.test(entry) || path.posix.normalize(entry) !== entry ||
        entry === "." || entry.split("/").some((part) => part === "" || part === "." || part === "..")) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.WRITE_SCOPE_UNRESOLVABLE,
        `${label} contains a non-normalized repository-relative path in ${recordPath}: ${JSON.stringify(entry)}`
      );
    }
    normalized.push(entry);
  }
  return Object.freeze([...new Set(normalized)].sort());
}

function selectedUnitIdentity(record, wkId, sliceId) {
  return Object.freeze({
    kind: sliceId === null ? (record.record_kind ?? "work_item") : "slice",
    address: sliceId === null ? wkId : `${wkId}#${sliceId}`,
    record_id: wkId,
    slice_id: sliceId,
    repo: record.repo ?? null
  });
}

export function canonicalUnitScopes(mainRepo, wkId, sliceId, { expectedInitiative = null } = {}) {
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
  if (record?.id !== wkId) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.WRITE_SCOPE_UNRESOLVABLE,
      `canonical WK record id ${JSON.stringify(record?.id ?? null)} does not match selected record ${wkId}`,
      { wkId, actual: record?.id ?? null }
    );
  }
  if (expectedInitiative !== null && typeof record?.initiative === "string" &&
      record.initiative !== expectedInitiative) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.WRITE_SCOPE_UNRESOLVABLE,
      `canonical WK initiative ${JSON.stringify(record.initiative)} does not match selected unit ${expectedInitiative}`,
      { wkId, expectedInitiative, actual: record.initiative }
    );
  }
  let writeScope;
  let readScope;
  let repoPaths;
  let source = `wiki/work-records/${wkId}.json`;
  if (sliceId === null) {
    writeScope = record?.write_scope;
    readScope = record?.read_scope;
    repoPaths = record?.repo_paths;
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
    repoPaths = slice.repo_paths;
    source = `${source}#${sliceId}`;
  }
  const normalizedReadScope = normalizeCanonicalScope(readScope, "read_scope", recordPath);
  const normalizedRepoPaths = normalizeCanonicalScope(repoPaths, "repo_paths", recordPath);
  const normalizedWriteScope = normalizeCanonicalScope(writeScope, "write_scope", recordPath, { required: true });

  return {
    readScope: normalizedReadScope,
    repoPaths: normalizedRepoPaths,
    readableScope: Object.freeze([...new Set([...normalizedReadScope, ...normalizedRepoPaths])].sort()),
    writeScope: normalizedWriteScope,
    selectedUnit: selectedUnitIdentity(record, wkId, sliceId),
    source,
    sourceDigest: computeWorkRecordSourceDigest(record),
    sourceVersion: record.schema_version ?? null
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

const EXACT_RECOVERY_BINDING_PAIR_SIZE = 2;
const RECOVERY_BINDING_FILE_RE = /^binding-[0-9a-f]{64}\.json$/u;
const RECOVERY_SUBJECT_RE = /^(WK-\d{4})#(SLICE-\d{3})$/u;
const RECOVERY_COMMIT_ID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const RECOVERY_SOURCE_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const FULL_WK_BINDING_FIELDS = Object.freeze([
  "schema_version", "launch_ref", "run_id", "retry_id", "unit_address",
  "initiative", "record_id", "slice_id", "base_ref", "base_sha",
  "output_branch", "worktree_path", "write_scope", "write_scope_source"
]);
const SPARSE_BINDING_SCALAR_FIELDS = Object.freeze([
  "schema_version", "launch_ref", "run_id", "retry_id", "unit_address",
  "initiative", "record_id", "slice_id", "base_ref", "base_sha",
  "output_branch", "worktree_path", "write_scope_source", "source_digest",
  "source_version", "index_sparse"
]);
const SPARSE_BINDING_ARRAY_FIELDS = Object.freeze([
  "read_scope", "repo_paths", "write_scope", "cone_dirs"
]);
const SPARSE_BINDING_FIELDS = Object.freeze([
  ...SPARSE_BINDING_SCALAR_FIELDS,
  ...SPARSE_BINDING_ARRAY_FIELDS,
  "selected_unit"
]);

const WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V1 = WORKTREE_SUBSTRATE_SCHEMA_VERSION;
const WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2 = "worktree-identity-binding.v2";
const WORKTREE_SLICE_CHECKOUT_MODE_FULL = "full";
const FULL_CHECKOUT_SLICE_BINDING_SCALAR_FIELDS = Object.freeze([
  "schema_version", "launch_ref", "run_id", "retry_id", "unit_address",
  "initiative", "record_id", "slice_id", "base_ref", "base_sha",
  "output_branch", "worktree_path", "write_scope_source", "source_digest",
  "source_version", "checkout_mode"
]);
const FULL_CHECKOUT_SLICE_BINDING_ARRAY_FIELDS = Object.freeze([
  "read_scope", "repo_paths", "write_scope"
]);
const FULL_CHECKOUT_SLICE_BINDING_FIELDS = Object.freeze([
  ...FULL_CHECKOUT_SLICE_BINDING_SCALAR_FIELDS,
  ...FULL_CHECKOUT_SLICE_BINDING_ARRAY_FIELDS,
  "selected_unit"
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function classifySliceCheckoutMode(binding) {
  const hasCone = hasOwn(binding, "cone_dirs");
  const hasIndexSparse = hasOwn(binding, "index_sparse");
  const hasCheckoutMode = hasOwn(binding, "checkout_mode");
  if (binding.schema_version === WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V1 &&
      hasCone && hasIndexSparse && !hasCheckoutMode) {
    return "v1-sparse";
  }
  if (binding.schema_version === WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2 &&
      hasCheckoutMode && binding.checkout_mode === WORKTREE_SLICE_CHECKOUT_MODE_FULL &&
      !hasCone && !hasIndexSparse) {
    return "v2-full";
  }
  return null;
}

function isNormalizedRepoPath(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim() &&
    !path.posix.isAbsolute(value) && !value.startsWith("-") && !value.includes("\\") &&
    !/[\x00-\x1f\x7f]/u.test(value) && path.posix.normalize(value) === value && value !== "." &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function isCanonicalRepoPathArray(value, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) ||
      value.some((entry) => !isNormalizedRepoPath(entry))) {
    return false;
  }
  return value.every((entry, index) => index === 0 || value[index - 1] < entry);
}

function recoveryBindingFailure(filePath, message, detail = null) {
  fail(
    WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.BINDING_NOT_FOUND,
    `identity binding evidence is invalid during recovery: ${filePath}: ${message}`,
    detail
  );
}

function failRecoveryPairSelection(detail) {
  fail(
    WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.VERIFIED_BINDING_UNIT_MISMATCH,
    "integrated-state recovery requires one unique exact launcher WK/slice binding pair",
    detail
  );
}

function assertRecoveryBindingContract(binding, { filePath, mainRepo, allowMissingSliceWorktree = false }) {
  if (!isPlainObject(binding)) {
    recoveryBindingFailure(filePath, "binding must be an object");
  }
  const unitIsSlice = typeof binding.unit_address === "string" && binding.unit_address.split("/").length === 3;

  let sliceMode = null;
  let requiredFields;
  if (unitIsSlice) {
    sliceMode = classifySliceCheckoutMode(binding);
    if (sliceMode === null) {
      recoveryBindingFailure(filePath, "slice checkout-mode discriminant is not an exact v1-sparse or v2-full shape", {
        schema_version: binding.schema_version ?? null,
        has_cone_dirs: hasOwn(binding, "cone_dirs"),
        has_index_sparse: hasOwn(binding, "index_sparse"),
        has_checkout_mode: hasOwn(binding, "checkout_mode")
      });
    }
    requiredFields = sliceMode === "v1-sparse" ? SPARSE_BINDING_FIELDS : FULL_CHECKOUT_SLICE_BINDING_FIELDS;
  } else {
    requiredFields = FULL_WK_BINDING_FIELDS;
  }
  const missing = requiredFields.find((field) => !hasOwn(binding, field));
  if (missing) {
    recoveryBindingFailure(filePath, `required authority field ${missing} is missing`, { field: missing });
  }
  if (!unitIsSlice && binding.schema_version !== WORKTREE_SUBSTRATE_SCHEMA_VERSION) {
    recoveryBindingFailure(filePath, "schema_version is not the canonical worktree identity schema", {
      expected: WORKTREE_SUBSTRATE_SCHEMA_VERSION,
      actual: binding.schema_version ?? null
    });
  }
  try {
    assertOpaqueId(binding.launch_ref, "launch_ref");
    assertOpaqueId(binding.run_id, "run_id");
  } catch (error) {
    recoveryBindingFailure(filePath, "launch/run identity is noncanonical", { message: error?.message ?? String(error) });
  }
  if (!Number.isInteger(binding.retry_id) || binding.retry_id < 0) {
    recoveryBindingFailure(filePath, "retry_id must be a non-negative integer");
  }
  let unit;
  try {
    unit = parseUnitAddress(binding.unit_address);
  } catch (error) {
    recoveryBindingFailure(filePath, "unit_address is noncanonical", { message: error?.message ?? String(error) });
  }
  if (binding.initiative !== unit.initiative || binding.record_id !== unit.wkId ||
      binding.slice_id !== unit.sliceId) {
    recoveryBindingFailure(filePath, "unit identity fields do not agree", {
      unit_address: binding.unit_address,
      initiative: binding.initiative ?? null,
      record_id: binding.record_id ?? null,
      slice_id: binding.slice_id ?? null
    });
  }
  const expectedBranch = unit.kind === "slice"
    ? `slice/${unit.initiative}/${unit.wkId}/${unit.sliceId}`
    : `wk/${unit.initiative}/${unit.wkId}`;
  const expectedBaseRef = unit.kind === "slice"
    ? `wk/${unit.initiative}/${unit.wkId}`
    : "main";
  if (binding.output_branch !== expectedBranch || binding.base_ref !== expectedBaseRef ||
      typeof binding.base_sha !== "string" || !RECOVERY_COMMIT_ID_RE.test(binding.base_sha)) {
    recoveryBindingFailure(filePath, "branch or base identity is noncanonical", {
      expected_output_branch: expectedBranch,
      expected_base_ref: expectedBaseRef
    });
  }
  if (typeof binding.worktree_path !== "string" || !path.isAbsolute(binding.worktree_path) ||
      path.normalize(binding.worktree_path) !== binding.worktree_path ||
      /[*?[\]{}]/u.test(binding.worktree_path)) {
    recoveryBindingFailure(filePath, "worktree_path is not a normalized absolute path");
  }
  let resolvedWorktreePath = null;
  try {
    resolvedWorktreePath = realpathSync(binding.worktree_path);
  } catch (error) {
    if (unitIsSlice && allowMissingSliceWorktree === true && error?.code === "ENOENT") {

    } else {
      recoveryBindingFailure(filePath, "worktree_path is not readable", { message: error?.message ?? String(error) });
    }
  }
  if (resolvedWorktreePath !== null && resolvedWorktreePath !== binding.worktree_path) {
    recoveryBindingFailure(filePath, "worktree_path is not canonical");
  }
  if (!isCanonicalRepoPathArray(binding.write_scope)) {
    recoveryBindingFailure(filePath, "write_scope is not a canonical repository-path array");
  }
  const expectedScopeSource = `wiki/work-records/${unit.wkId}.json${unit.sliceId ? `#${unit.sliceId}` : ""}`;
  if (binding.write_scope_source !== expectedScopeSource) {
    recoveryBindingFailure(filePath, "write_scope_source does not match the selected unit", {
      expected: expectedScopeSource,
      actual: binding.write_scope_source ?? null
    });
  }
  if (bindingFilePath(mainRepo, binding.launch_ref, binding.run_id, binding.retry_id) !== filePath) {
    recoveryBindingFailure(filePath, "binding filename does not match the exact launch/run/retry tuple");
  }
  if (unit.kind === "slice") {

    const arrayFields = sliceMode === "v1-sparse"
      ? SPARSE_BINDING_ARRAY_FIELDS
      : FULL_CHECKOUT_SLICE_BINDING_ARRAY_FIELDS;
    for (const field of arrayFields) {
      if (!isCanonicalRepoPathArray(binding[field], { nonEmpty: field === "cone_dirs" })) {
        recoveryBindingFailure(filePath, `${field} is not a canonical repository-path array`, { field });
      }
    }
    const selected = binding.selected_unit;
    if (!isPlainObject(selected) || selected.kind !== "slice" ||
        selected.address !== `${unit.wkId}#${unit.sliceId}` || selected.record_id !== unit.wkId ||
        selected.slice_id !== unit.sliceId ||
        !(selected.repo === null || typeof selected.repo === "string" && selected.repo.length > 0)) {
      recoveryBindingFailure(filePath, "selected_unit does not match the exact slice unit");
    }

    if (typeof binding.source_digest !== "string" || !RECOVERY_SOURCE_DIGEST_RE.test(binding.source_digest) ||
        !(binding.source_version === null || typeof binding.source_version === "string" && binding.source_version.length > 0)) {
      recoveryBindingFailure(filePath, "slice source authority is incomplete or invalid");
    }
    if (sliceMode === "v1-sparse") {

      if (binding.index_sparse !== false) {
        recoveryBindingFailure(filePath, "sparse index authority must pin index_sparse=false", {
          actual: binding.index_sparse ?? null
        });
      }
      let expectedConeDirs;
      try {
        expectedConeDirs = deriveCanonicalSparseConeDirs(
          defaultRunGit,
          mainRepo,
          binding.base_sha,
          [...binding.read_scope, ...binding.repo_paths, ...binding.write_scope]
        );
      } catch (error) {
        recoveryBindingFailure(filePath, "canonical sparse cone authority cannot be derived from the historical base tree", {
          base_sha: binding.base_sha,
          code: error?.code ?? null,
          message: error?.message ?? String(error)
        });
      }
      if (!sameStringArray(binding.cone_dirs, expectedConeDirs)) {
        recoveryBindingFailure(filePath, "cone_dirs does not exactly match the canonical historical sparse cone authority", {
          expected: expectedConeDirs,
          actual: binding.cone_dirs
        });
      }
    }

  }
  return binding;
}

export function resolveUniqueManagedLifecycleBindingPairForRecovery({
  mainRepo,
  launchRef,
  expectedSubject,
  allowMissingSliceWorktree = false
} = {}) {
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  assertOpaqueId(launchRef, "launch_ref");
  const subject = typeof expectedSubject === "string" ? expectedSubject.match(RECOVERY_SUBJECT_RE) : null;
  if (!subject) {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG, "recovery requires an exact WK#SLICE subject");
  }
  const storeDir = worktreeIdentityStoreDir(repo);
  let entries;
  try {
    entries = readdirSync(storeDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && RECOVERY_BINDING_FILE_RE.test(entry.name));
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.BINDING_NOT_FOUND,
      `identity binding store is not readable during recovery: ${storeDir}`,
      { errno: err?.code ?? null }
    );
  }

  const [expectedWkId, expectedSliceId] = subject.slice(1);
  const candidates = [];
  for (const entry of entries) {
    const filePath = path.join(storeDir, entry.name);
    let raw;
    try {
      raw = readFileSync(filePath, "utf8");
    } catch (err) {
      recoveryBindingFailure(filePath, "binding file is not readable", { errno: err?.code ?? null });
    }
    let binding;
    try {
      binding = JSON.parse(raw);
    } catch (err) {
      recoveryBindingFailure(filePath, "binding file is not valid JSON", { message: err?.message ?? null });
    }
    if (!isPlainObject(binding)) {
      recoveryBindingFailure(filePath, "binding must be an object");
    }
    try {
      assertOpaqueId(binding.launch_ref, "launch_ref");
    } catch (error) {
      recoveryBindingFailure(filePath, "launch_ref is absent or noncanonical", {
        message: error?.message ?? String(error)
      });
    }

    if (binding.launch_ref !== launchRef) continue;
    candidates.push({ filePath, binding });
  }
  if (candidates.length === 0) return null;

  if (candidates.length !== EXACT_RECOVERY_BINDING_PAIR_SIZE) {
    failRecoveryPairSelection({ matching_binding_count: candidates.length });
  }

  const matching = candidates.map(({ filePath, binding }) => {
    assertRecoveryBindingContract(binding, {
      filePath,
      mainRepo: repo,
      allowMissingSliceWorktree:
        allowMissingSliceWorktree === true &&
        binding.record_id === expectedWkId &&
        binding.slice_id === expectedSliceId
    });
    return binding;
  });

  const [wkId, sliceId] = [expectedWkId, expectedSliceId];
  const sliceCandidates = matching.filter((binding) =>
    binding.record_id === wkId && binding.slice_id === sliceId &&
    binding.unit_address === `${binding.initiative}/${wkId}/${sliceId}` &&
    binding.run_id.endsWith(".slice")
  );
  const pairs = [];
  for (const slice of sliceCandidates) {
    const baseRunId = slice.run_id.slice(0, -".slice".length);
    if (baseRunId.length === 0) continue;
    const wkCandidates = matching.filter((binding) =>
      binding.run_id === `${baseRunId}.wk` && binding.retry_id === slice.retry_id &&
      binding.record_id === wkId && binding.slice_id === null &&
      binding.initiative === slice.initiative &&
      binding.unit_address === `${slice.initiative}/${wkId}` &&
      binding.base_sha === slice.base_sha
    );
    for (const wk of wkCandidates) pairs.push({ runId: baseRunId, retryId: slice.retry_id, slice, wk });
  }
  if (pairs.length !== 1) {
    failRecoveryPairSelection({
      matching_binding_count: matching.length,
      matching_pair_count: pairs.length
    });
  }
  const pair = pairs[0];
  if (pair.slice.worktree_path === pair.wk.worktree_path) {
    fail(WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.VERIFIED_BINDING_UNIT_MISMATCH,
      "recovery WK and slice bindings must identify distinct worktrees");
  }
  const sliceBinding = Object.freeze({ ...pair.slice });
  const wkBinding = Object.freeze({ ...pair.wk });
  return Object.freeze({
    run_id: pair.runId,
    retry_id: pair.retryId,
    slice_binding: sliceBinding,
    wk_binding: wkBinding,
    provisioning: Object.freeze({
      record_id: wkId,
      slice_id: sliceId,
      unit_address: pair.slice.unit_address,
      retry_id: pair.retryId,
      slice_binding: sliceBinding,
      wk_binding: wkBinding,
      validation_worktree_path: pair.wk.worktree_path
    })
  });
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

function sameStringArray(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) &&
    actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function sameSelectedUnit(actual, expected) {
  return actual && expected && typeof actual === "object" && typeof expected === "object" &&
    ["kind", "address", "record_id", "slice_id", "repo"].every((field) => actual[field] === expected[field]);
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
  const expectedMode = classifySliceCheckoutMode(expectedBinding);
  if (expectedMode === null) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.INVALID_ARG,
      "expectedBinding is not an exact v1-sparse or v2-full slice binding"
    );
  }
  const binding = resolveWorktreeBinding({ mainRepo, launchRef, runId, retryId });
  if (classifySliceCheckoutMode(binding) !== expectedMode) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.VERIFIED_BINDING_UNIT_MISMATCH,
      "persisted identity binding checkout mode does not match the server-minted mode",
      { expected_mode: expectedMode }
    );
  }
  const scalarFields = expectedMode === "v1-sparse"
    ? SPARSE_BINDING_SCALAR_FIELDS
    : FULL_CHECKOUT_SLICE_BINDING_SCALAR_FIELDS;
  const arrayFields = expectedMode === "v1-sparse"
    ? SPARSE_BINDING_ARRAY_FIELDS
    : FULL_CHECKOUT_SLICE_BINDING_ARRAY_FIELDS;
  for (const field of scalarFields) {
    if (binding[field] !== expectedBinding[field]) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.VERIFIED_BINDING_UNIT_MISMATCH,
        `exact-slice identity binding field ${field} does not match the server-minted value`,
        { field, expected: expectedBinding[field] ?? null, actual: binding[field] ?? null }
      );
    }
  }
  for (const field of arrayFields) {
    if (!sameStringArray(binding[field], expectedBinding[field])) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.VERIFIED_BINDING_UNIT_MISMATCH,
        `exact-slice identity binding field ${field} does not match the server-minted value`,
        { field, expected: expectedBinding[field] ?? null, actual: binding[field] ?? null }
      );
    }
  }
  if (!sameSelectedUnit(binding.selected_unit, expectedBinding.selected_unit)) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.VERIFIED_BINDING_UNIT_MISMATCH,
      "exact-slice identity binding selected_unit does not match the server-minted value",
      { expected: expectedBinding.selected_unit ?? null, actual: binding.selected_unit ?? null }
    );
  }
  if (expectedMode === "v1-sparse") {

    if (binding.index_sparse !== false) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.VERIFIED_BINDING_UNIT_MISMATCH,
        "sparse identity binding must pin index_sparse=false",
        { actual: binding.index_sparse ?? null }
      );
    }
  }

  const parsed = parseUnitAddress(binding.unit_address);
  const current = canonicalUnitScopes(mainRepo, parsed.wkId, parsed.sliceId, {
    expectedInitiative: parsed.initiative
  });
  const currentFields = {
    read_scope: current.readScope,
    repo_paths: current.repoPaths,
    write_scope: current.writeScope
  };
  for (const [field, value] of Object.entries(currentFields)) {
    if (!sameStringArray(binding[field], value)) {
      fail(
        WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.VERIFIED_BINDING_UNIT_MISMATCH,
        `exact-slice identity binding ${field} is stale against the canonical selected unit`,
        { field, expected: value, actual: binding[field] ?? null }
      );
    }
  }
  if (!sameSelectedUnit(binding.selected_unit, current.selectedUnit) ||
      binding.source_digest !== current.sourceDigest || binding.source_version !== current.sourceVersion) {
    fail(
      WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.VERIFIED_BINDING_UNIT_MISMATCH,
      "exact-slice identity binding selected-unit/source authority is stale against the canonical record",
      {
        expected_selected_unit: current.selectedUnit,
        actual_selected_unit: binding.selected_unit ?? null,
        expected_source_digest: current.sourceDigest,
        actual_source_digest: binding.source_digest ?? null,
        expected_source_version: current.sourceVersion,
        actual_source_version: binding.source_version ?? null
      }
    );
  }
  return binding;
}
