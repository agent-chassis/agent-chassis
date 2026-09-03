

import path from "node:path";

import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

if (typeof RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE !== "string") {
  throw new Error(
    "WK-2352 managed_worktree_provisioning_unavailable capability interface is absent or incompatible"
  );
}

export const MANAGED_WORKTREE_BINDING_SCHEMA_VERSION = "managed-worktree-binding.v1";
export const MANAGED_SLICE_CHECKOUT_MODE_FULL = "full";
export const WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION = "worktree-identity-binding.v1";
export const WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2 = "worktree-identity-binding.v2";

export const MANAGED_PROVISIONING_SHAPE_DIAGNOSTIC_CODES = Object.freeze({
  INVALID_ARG: "agent_launch.worktree_provisioning_dispatch.invalid_arg.v1",
  INVALID_SUBJECT: "agent_launch.worktree_provisioning_dispatch.invalid_subject.v1",
  ROOT_REFUSED: "agent_launch.worktree_provisioning_dispatch.root_refused.v1",
  BINDING_INCOMPLETE: RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE,
  SUBSTRATE_INVALID_ARG: "agent_launch.worktree_substrate.invalid_arg.v1",
  SUBSTRATE_INVALID_INITIATIVE_ID: "agent_launch.worktree_substrate.invalid_initiative_id.v1",
  SUBSTRATE_INVALID_SUBJECT: "agent_launch.worktree_substrate.invalid_subject.v1",
  SUBSTRATE_INVALID_UNIT_ADDRESS: "agent_launch.worktree_substrate.invalid_unit_address.v1",
  SUBSTRATE_INVALID_SLICE_ID: "agent_launch.worktree_substrate.invalid_slice_id.v1"
});

export class ManagedProvisioningResultShapeError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "ManagedProvisioningResultShapeError";
    this.code = code ?? "agent_launch.worktree_provisioning_dispatch.error.v1";
    if (detail !== null) this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

export function failManagedProvisioningShape(code, message, detail = null, cause = null) {
  throw new ManagedProvisioningResultShapeError(
    `agent-launch worktree-provisioning-dispatch: ${message}`,
    { code, detail, cause }
  );
}

function failManagedSubstrateIdentity(code, message, detail = null) {
  throw new ManagedProvisioningResultShapeError(
    `agent-launch worktree-substrate: ${message}`,
    { code, detail }
  );
}

const CODES = MANAGED_PROVISIONING_SHAPE_DIAGNOSTIC_CODES;

const SUBJECT_RE = /^WK-\d{4}(#[A-Za-z0-9._-]+)?$/;
const INITIATIVE_ID_RE = /^IN-\d{4}$/;
const WK_ID_RE = /^WK-\d{4}$/;
const SLICE_ID_RE = /^SLICE-\d{3}$/;

const WK_COMMIT_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

const COMPLETE_EXACT_BINDING_FIELDS = Object.freeze([
  "schema_version", "launch_ref", "run_id", "retry_id", "unit_address",
  "initiative", "record_id", "slice_id", "base_ref", "base_sha",
  "output_branch", "worktree_path", "write_scope", "write_scope_source"
]);
export const COMPLETE_SPARSE_BINDING_FIELDS = Object.freeze([
  ...COMPLETE_EXACT_BINDING_FIELDS, "cone_dirs", "index_sparse"
]);

export const COMPLETE_WK_BINDING_FIELDS = Object.freeze([
  ...COMPLETE_EXACT_BINDING_FIELDS, "wk_tip_sha"
]);
export const COMPLETE_FULL_SLICE_BINDING_FIELDS = Object.freeze([
  ...COMPLETE_EXACT_BINDING_FIELDS, "checkout_mode"
]);
export const EXACT_NESTED_WK_BINDING_FIELDS = COMPLETE_WK_BINDING_FIELDS;
export const EXACT_NESTED_SLICE_BINDING_FIELDS = Object.freeze([
  ...COMPLETE_EXACT_BINDING_FIELDS,
  "read_scope", "repo_paths", "selected_unit", "source_digest", "source_version",
  "cone_dirs", "index_sparse"
]);
export const EXACT_NESTED_SLICE_BINDING_FIELDS_V2 = Object.freeze([
  ...COMPLETE_EXACT_BINDING_FIELDS,
  "read_scope", "repo_paths", "selected_unit", "source_digest", "source_version",
  "checkout_mode"
]);
export const COMPLETE_MANAGED_PROVISIONING_FIELDS = Object.freeze([
  "schema_version", "complete", "main_repo", "initiative", "record_id", "slice_id",
  "unit_address", "retry_id", "wk_binding", "slice_binding",
  "worktree_path", "output_branch", "base_ref", "base_sha", "write_scope", "cone_dirs",
  "index_sparse", "validation_worktree_path", "shared_git_exposed"
]);
export const COMPLETE_MANAGED_PROVISIONING_FIELDS_V2 = Object.freeze([
  ...COMPLETE_MANAGED_PROVISIONING_FIELDS.filter(
    (field) => field !== "cone_dirs" && field !== "index_sparse"
  ),
  "checkout_mode"
]);

export function assertManagedAbsolutePath(candidate, label, fail = failManagedProvisioningShape) {
  if (typeof candidate !== "string" || candidate.length === 0 || !path.isAbsolute(candidate)) {
    fail(
      CODES.INVALID_ARG,
      `${label} must be a non-empty absolute path, got: ${JSON.stringify(candidate)}`
    );
  }
  return candidate;
}

export function parseManagedSubject(subject, fail = failManagedProvisioningShape) {
  if (typeof subject !== "string" || !SUBJECT_RE.test(subject)) {
    fail(
      CODES.INVALID_SUBJECT,
      `subject must match ^WK-\\d{4}(#<slice>)?$, got: ${JSON.stringify(subject)}`
    );
  }
  const hashIdx = subject.indexOf("#");
  if (hashIdx === -1) return { wkId: subject, sliceId: null };
  return { wkId: subject.slice(0, hashIdx), sliceId: subject.slice(hashIdx + 1) };
}

export function bindingIdentity(runId, kind) {
  return `${runId}.${kind}`;
}

export function isPathWithinRoot(candidate, root) {
  return candidate !== root && candidate.startsWith(`${root}${path.sep}`);
}

export function assertDistinctManagedRoots(roots, fail = failManagedProvisioningShape) {
  const entries = Object.entries(roots);
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [leftName, left] = entries[i];
      const [rightName, right] = entries[j];
      if (left === right || left.startsWith(`${right}${path.sep}`) ||
          right.startsWith(`${left}${path.sep}`)) {
        fail(
          CODES.ROOT_REFUSED,
          "launcher-owned roots alias, collide, or contain one another",
          { left: { name: leftName, path: left }, right: { name: rightName, path: right } }
        );
      }
    }
  }
}

function assertSubstrateAbsolutePath(candidate, label) {
  if (typeof candidate !== "string" || candidate.length === 0) {
    failManagedSubstrateIdentity(CODES.SUBSTRATE_INVALID_ARG, `${label} must be a non-empty string`);
  }
  if (!path.isAbsolute(candidate)) {
    failManagedSubstrateIdentity(CODES.SUBSTRATE_INVALID_ARG, `${label} must be absolute: ${candidate}`);
  }
  if (/[*?[\]{}]/.test(candidate)) {
    failManagedSubstrateIdentity(
      CODES.SUBSTRATE_INVALID_ARG, `${label} must not contain glob chars: ${candidate}`);
  }
  for (const segment of candidate.split(path.sep)) {
    if (segment === "..") {
      failManagedSubstrateIdentity(
        CODES.SUBSTRATE_INVALID_ARG, `${label} must not contain ".." segments: ${candidate}`);
    }
  }
  return path.normalize(candidate);
}

function assertSubstrateInitiativeId(initiative) {
  if (typeof initiative !== "string" || !INITIATIVE_ID_RE.test(initiative)) {
    failManagedSubstrateIdentity(
      CODES.SUBSTRATE_INVALID_INITIATIVE_ID,
      `initiative must match ^IN-\\d{4}$, got: ${JSON.stringify(initiative)}`
    );
  }
  return initiative;
}

function assertSubstrateWkId(wkId) {
  if (typeof wkId !== "string" || !WK_ID_RE.test(wkId)) {
    failManagedSubstrateIdentity(
      CODES.SUBSTRATE_INVALID_SUBJECT,
      `wk id must match ^WK-\\d{4}$, got: ${JSON.stringify(wkId)}`
    );
  }
  return wkId;
}

function assertSubstrateSliceId(sliceId) {
  if (typeof sliceId !== "string" || !SLICE_ID_RE.test(sliceId)) {
    failManagedSubstrateIdentity(
      CODES.SUBSTRATE_INVALID_SLICE_ID,
      `slice id must match ^SLICE-\\d{3}$ (normalized upper-case), got: ${JSON.stringify(sliceId)}`
    );
  }
  return sliceId;
}

function parseManagedUnitAddress(unitAddress) {
  if (typeof unitAddress !== "string" || unitAddress.length === 0) {
    failManagedSubstrateIdentity(
      CODES.SUBSTRATE_INVALID_UNIT_ADDRESS,
      `unit_address must be a non-empty string, got: ${JSON.stringify(unitAddress)}`
    );
  }
  const parts = unitAddress.split("/");
  if (parts.length !== 2 && parts.length !== 3) {
    failManagedSubstrateIdentity(
      CODES.SUBSTRATE_INVALID_UNIT_ADDRESS,
      `unit_address must be IN-XXXX/WK-YYYY or IN-XXXX/WK-YYYY/SLICE-ZZZ, got: ${JSON.stringify(unitAddress)}`
    );
  }
  const [initiative, wkId, rawSliceId] = parts;
  assertSubstrateInitiativeId(initiative);
  if (typeof wkId !== "string" || !WK_ID_RE.test(wkId)) {
    failManagedSubstrateIdentity(
      CODES.SUBSTRATE_INVALID_UNIT_ADDRESS,
      `unit_address WK segment must match ^WK-\\d{4}$, got: ${JSON.stringify(wkId)}`
    );
  }
  if (parts.length === 2) {
    return Object.freeze({ kind: "wk", initiative, wkId, sliceId: null, unitAddress });
  }
  const sliceId = typeof rawSliceId === "string" ? rawSliceId.toUpperCase() : rawSliceId;
  assertSubstrateSliceId(sliceId);
  return Object.freeze({
    kind: "slice", initiative, wkId, sliceId,
    unitAddress: `${initiative}/${wkId}/${sliceId}`
  });
}

export function deriveManagedExactUnitName({ unitAddress, worktreeRoot }) {
  const parsed = parseManagedUnitAddress(unitAddress);
  assertSubstrateInitiativeId(parsed.initiative);
  assertSubstrateWkId(parsed.wkId);
  const root = assertSubstrateAbsolutePath(worktreeRoot, "worktreeRoot");
  const outputBranch = parsed.kind === "wk"
    ? `wk/${parsed.initiative}/${parsed.wkId}`
    : `slice/${parsed.initiative}/${parsed.wkId}/${parsed.sliceId}`;
  const worktreePath = parsed.kind === "wk"
    ? path.join(root, `wk-${parsed.initiative}-${parsed.wkId}`)
    : path.join(root, `slice-${parsed.initiative}-${parsed.wkId}-${parsed.sliceId}`);
  return Object.freeze({
    kind: parsed.kind,
    unit_address: parsed.unitAddress,
    initiative: parsed.initiative,
    wk_id: parsed.wkId,
    slice_id: parsed.sliceId,
    output_branch: outputBranch,
    worktree_path: worktreePath
  });
}

export function discriminateManagedSliceCheckoutMode(
  binding, label, fail = failManagedProvisioningShape
) {
  const present = (field) => binding !== null && typeof binding === "object" &&
    Object.prototype.hasOwnProperty.call(binding, field);
  const hasCone = present("cone_dirs");
  const hasIndexSparse = present("index_sparse");
  const hasCheckoutMode = present("checkout_mode");
  if (hasCheckoutMode && !hasCone && !hasIndexSparse) {
    if (binding.checkout_mode !== MANAGED_SLICE_CHECKOUT_MODE_FULL) {
      fail(
        CODES.BINDING_INCOMPLETE,
        `${label} carries an unknown checkout_mode; only the v2 full mode is accepted`,
        { field: label, checkout_mode: binding.checkout_mode ?? null }
      );
    }
    return "full";
  }
  if (!hasCheckoutMode && hasCone && hasIndexSparse) return "sparse";
  fail(
    CODES.BINDING_INCOMPLETE,
    `${label} is neither an exact v1 sparse nor an exact v2 full binding (mixed or unknown checkout discriminant)`,
    {
      field: label,
      has_checkout_mode: hasCheckoutMode,
      has_cone_dirs: hasCone,
      has_index_sparse: hasIndexSparse
    }
  );
}

function assertExactNestedBindingFields(binding, expectedFields, label, fail) {
  const actual = binding && typeof binding === "object" ? Object.keys(binding).sort() : [];
  const expected = [...expectedFields].sort();
  const exact = actual.length === expected.length &&
    actual.every((field, index) => field === expected[index]);
  if (!exact) {
    fail(
      CODES.BINDING_INCOMPLETE,
      `restored managed provisioning carrier nested ${label} does not carry exactly its declared field set`,
      { field: label, expected_fields: expected, actual_fields: actual }
    );
  }
}

function defaultCanonicalizeRoot(candidate, label, fail) {
  return path.resolve(assertManagedAbsolutePath(candidate, label, fail));
}

function defaultCanonicalizeBindingWorktreePath(candidate, label, root, fail) {
  const worktree = path.resolve(candidate);
  if (!isPathWithinRoot(worktree, root)) {
    fail(
      CODES.BINDING_INCOMPLETE,
      `${label} escapes its launcher-owned canonical root`,
      { label, path: worktree, root }
    );
  }
  return worktree;
}

export function assertManagedBindingShape({
  binding,
  repo,
  unitAddress,
  launchRef,
  runId,
  retryId,
  worktreeRoot,
  sparse,
  canonicalizeBindingWorktreePath = defaultCanonicalizeBindingWorktreePath,
  verifyBindingPhysicalCoherence = null,
  fail = failManagedProvisioningShape
}) {
  const sliceMode = sparse
    ? discriminateManagedSliceCheckoutMode(binding, "slice binding", fail)
    : null;
  const required = !sparse
    ? COMPLETE_WK_BINDING_FIELDS
    : sliceMode === "full"
      ? COMPLETE_FULL_SLICE_BINDING_FIELDS
      : COMPLETE_SPARSE_BINDING_FIELDS;
  for (const field of required) {
    const nullableFullWkSliceId = !sparse && field === "slice_id";
    if ((!nullableFullWkSliceId && binding?.[field] === null) || binding?.[field] === undefined ||
        (typeof binding[field] === "string" && binding[field].length === 0) ||
        ((field === "write_scope" || field === "cone_dirs") && !Array.isArray(binding[field]))) {
      fail(
        CODES.BINDING_INCOMPLETE,
        `exact-unit binding is incomplete at ${field}`,
        { field, unitAddress }
      );
    }
  }

  if (!sparse && !WK_COMMIT_OID_RE.test(binding.wk_tip_sha ?? "")) {
    fail(
      CODES.BINDING_INCOMPLETE,
      "WK binding wk_tip_sha is not a canonical commit id",
      { wk_tip_sha: binding.wk_tip_sha ?? null }
    );
  }
  const expectedName = deriveManagedExactUnitName({ unitAddress, worktreeRoot });
  const expectedSliceId = expectedName.kind === "slice" ? expectedName.slice_id : null;
  const expectedBaseRef = expectedName.kind === "slice"
    ? `wk/${expectedName.initiative}/${expectedName.wk_id}`
    : "main";

  const expectedSchemaVersion = sliceMode === "full"
    ? WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION_V2
    : WORKTREE_IDENTITY_BINDING_SCHEMA_VERSION;
  const mismatches = {
    schema_version: [binding.schema_version, expectedSchemaVersion],
    unit_address: [binding.unit_address, unitAddress],
    launch_ref: [binding.launch_ref, launchRef],
    run_id: [binding.run_id, runId],
    retry_id: [binding.retry_id, retryId],
    initiative: [binding.initiative, expectedName.initiative],
    record_id: [binding.record_id, expectedName.wk_id],
    slice_id: [binding.slice_id ?? null, expectedSliceId],
    base_ref: [binding.base_ref, expectedBaseRef],
    output_branch: [binding.output_branch, expectedName.output_branch],
    worktree_path: [
      path.resolve(binding.worktree_path), path.resolve(expectedName.worktree_path)
    ],
    write_scope_source: [
      binding.write_scope_source,
      `wiki/work-records/${expectedName.wk_id}.json${expectedSliceId ? `#${expectedSliceId}` : ""}`
    ]
  };
  const mismatch = Object.entries(mismatches).find(([, [actual, expected]]) => actual !== expected);
  if (mismatch) {
    const [field, [actual, expected]] = mismatch;
    fail(
      CODES.BINDING_INCOMPLETE,
      `exact-unit binding does not match the selected unit at ${field}`,
      { field, expected, actual: actual ?? null }
    );
  }
  if (sliceMode === "sparse" && binding.index_sparse !== false) {
    fail(
      CODES.BINDING_INCOMPLETE,
      "sparse binding must pin index_sparse=false",
      { actual: binding.index_sparse ?? null }
    );
  }
  if (!Number.isInteger(binding.retry_id) || binding.retry_id < 0 ||
      binding.write_scope.some((entry) => typeof entry !== "string" || entry.length === 0) ||
      (sliceMode === "sparse" && (binding.cone_dirs.length === 0 ||
        binding.cone_dirs.some((entry) => typeof entry !== "string" || entry.length === 0)))) {
    fail(CODES.BINDING_INCOMPLETE, "exact-unit binding carries invalid retry or scope fields");
  }
  const worktree = canonicalizeBindingWorktreePath(
    binding.worktree_path, "binding.worktree_path", worktreeRoot, fail
  );
  if (worktree === repo || worktree.startsWith(`${repo}${path.sep}`)) {
    fail(
      CODES.BINDING_INCOMPLETE,
      "managed binding points at the main checkout",
      { repo, worktree }
    );
  }

  if (typeof verifyBindingPhysicalCoherence === "function") {
    verifyBindingPhysicalCoherence({ binding, repo, worktree, sparse, unitAddress, fail });
  }
  return worktree;
}

export function assertManagedProvisioningResultShape({
  provisioning,
  mainRepo,
  initiative,
  subject,
  launchRef,
  runId,
  retryId,
  worktreeRoot,
  requireRestoredCarrierImmutability = true,
  canonicalizeRoot = defaultCanonicalizeRoot,
  canonicalizeBindingWorktreePath = defaultCanonicalizeBindingWorktreePath,
  verifyBindingPhysicalCoherence = null,
  fail = failManagedProvisioningShape
} = {}) {
  const repo = canonicalizeRoot(mainRepo, "mainRepo", fail);
  const parsed = parseManagedSubject(subject, fail);
  if (parsed.sliceId === null) {
    fail(CODES.BINDING_INCOMPLETE, "complete managed result requires an exact slice subject");
  }
  const roots = Object.freeze({ worktreeRoot: canonicalizeRoot(worktreeRoot, "worktreeRoot", fail) });
  assertDistinctManagedRoots({ mainRepo: repo, ...roots }, fail);
  const unitAddress = `${initiative}/${parsed.wkId}/${parsed.sliceId}`;

  const carrierMode = (provisioning !== null && typeof provisioning === "object")
    ? discriminateManagedSliceCheckoutMode(provisioning, "managed provisioning carrier", fail)
    : null;
  const expectedFieldSet = carrierMode === "full"
    ? COMPLETE_MANAGED_PROVISIONING_FIELDS_V2
    : COMPLETE_MANAGED_PROVISIONING_FIELDS;
  const actualFields = provisioning && typeof provisioning === "object"
    ? Object.keys(provisioning).sort()
    : [];
  const expectedFields = [...expectedFieldSet].sort();
  const exactFields = actualFields.length === expectedFields.length &&
    actualFields.every((field, index) => field === expectedFields[index]);
  const missing = expectedFieldSet.find(
    (field) => provisioning?.[field] === null || provisioning?.[field] === undefined
  );
  if (provisioning?.complete !== true || missing || !exactFields) {
    fail(
      CODES.BINDING_INCOMPLETE,
      `managed provisioning result is partial or inexact${missing ? ` at ${missing}` : ""}`,
      { field: missing ?? "complete", expected_fields: expectedFields, actual_fields: actualFields }
    );
  }
  if (provisioning.schema_version !== MANAGED_WORKTREE_BINDING_SCHEMA_VERSION ||
      provisioning.main_repo !== repo ||
      provisioning.initiative !== initiative || provisioning.record_id !== parsed.wkId ||
      provisioning.slice_id !== parsed.sliceId || provisioning.unit_address !== unitAddress ||
      provisioning.retry_id !== retryId) {
    fail(CODES.BINDING_INCOMPLETE, "managed provisioning result identity is mismatched");
  }

  if (requireRestoredCarrierImmutability) {

    assertExactNestedBindingFields(
      provisioning.wk_binding, EXACT_NESTED_WK_BINDING_FIELDS, "wk_binding", fail);
    assertExactNestedBindingFields(
      provisioning.slice_binding,
      carrierMode === "full" ? EXACT_NESTED_SLICE_BINDING_FIELDS_V2 : EXACT_NESTED_SLICE_BINDING_FIELDS,
      "slice_binding",
      fail
    );

    const frozenTargets = [
      ["result", provisioning],
      ["wk_binding", provisioning.wk_binding],
      ["slice_binding", provisioning.slice_binding],
      ["write_scope", provisioning.write_scope]
    ];
    if (carrierMode !== "full") frozenTargets.push(["cone_dirs", provisioning.cone_dirs]);
    for (const nested of ["wk_binding", "slice_binding"]) {
      const nestedBinding = provisioning[nested];
      if (nestedBinding && typeof nestedBinding === "object") {
        for (const [key, value] of Object.entries(nestedBinding)) {
          if (Array.isArray(value)) frozenTargets.push([`${nested}.${key}`, value]);
        }
      }
    }
    for (const [label, value] of frozenTargets) {
      if (!Object.isFrozen(value)) {
        fail(
          CODES.BINDING_INCOMPLETE,
          `restored managed provisioning carrier is not deeply frozen at ${label}`,
          { field: label }
        );
      }
    }

    const wkBinding = provisioning.wk_binding;
    const sliceBinding = provisioning.slice_binding;
    if (wkBinding.output_branch === sliceBinding.output_branch ||
        wkBinding.worktree_path === sliceBinding.worktree_path) {
      fail(
        CODES.BINDING_INCOMPLETE,
        "structural carrier persistent WK and slice resources collide",
        {
          wk_base_sha: wkBinding.base_sha ?? null,
          slice_base_sha: sliceBinding.base_sha ?? null,
          wk_output_branch: wkBinding.output_branch ?? null,
          slice_output_branch: sliceBinding.output_branch ?? null
        }
      );
    }
  }
  const bindingOptions = {
    repo,
    launchRef,
    retryId,
    worktreeRoot: roots.worktreeRoot,
    canonicalizeBindingWorktreePath,
    verifyBindingPhysicalCoherence,
    fail
  };
  assertManagedBindingShape({
    ...bindingOptions,
    binding: provisioning.wk_binding,
    unitAddress: `${initiative}/${parsed.wkId}`,
    runId: bindingIdentity(runId, "wk"),
    sparse: false
  });
  assertManagedBindingShape({
    ...bindingOptions,
    binding: provisioning.slice_binding,
    unitAddress,
    runId: bindingIdentity(runId, "slice"),
    sparse: true
  });
  const slice = provisioning.slice_binding;

  const mirroredFields = carrierMode === "full"
    ? ["worktree_path", "output_branch", "base_ref", "base_sha", "checkout_mode"]
    : ["worktree_path", "output_branch", "base_ref", "base_sha", "index_sparse"];
  const mirroredMismatch = mirroredFields.find((field) => provisioning[field] !== slice[field]);
  const coneMirrorMismatch = carrierMode !== "full" &&
    JSON.stringify(provisioning.cone_dirs) !== JSON.stringify(slice.cone_dirs);
  if (mirroredMismatch || coneMirrorMismatch ||
      JSON.stringify(provisioning.write_scope) !== JSON.stringify(slice.write_scope) ||
      provisioning.validation_worktree_path !== provisioning.wk_binding.worktree_path ||
      provisioning.shared_git_exposed !== false) {
    fail(
      CODES.BINDING_INCOMPLETE,
      "managed provisioning result aliases do not exactly mirror the selected slice binding"
    );
  }
  return provisioning;
}
