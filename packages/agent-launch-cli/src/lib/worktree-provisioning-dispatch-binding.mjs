

import path from "node:path";
import { existsSync, lstatSync, realpathSync } from "node:fs";

import {
  deriveExactUnitName,
  WORKTREE_SUBSTRATE_SCHEMA_VERSION,
  defaultRunGit
} from "./worktree-substrate.mjs";
import {
  WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES,
  fail,
  parseSubject,
  assertAbsolutePath
} from "./worktree-provisioning-dispatch-constants.mjs";

export const MANAGED_WORKTREE_BINDING_SCHEMA_VERSION =
  "managed-worktree-binding.v1";

export const MANAGED_SLICE_CHECKOUT_MODE_FULL = "full";

const WORKTREE_SUBSTRATE_SCHEMA_VERSION_V2 = "worktree-identity-binding.v2";

function pathEntryExists(candidate) {
  try { lstatSync(candidate); return true; } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function canonicalizeOwnedPath(candidate, label, { mustExist = false } = {}) {
  const absolute = path.resolve(assertAbsolutePath(candidate, label));
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    if (!pathEntryExists(cursor)) break;
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      fail(
        WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.ROOT_REFUSED,
        `${label} contains a symlink component`,
        { label, path: absolute, component: cursor }
      );
    }
  }
  if (mustExist && !pathEntryExists(absolute)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.ROOT_REFUSED,
      `${label} does not exist`,
      { label, path: absolute }
    );
  }
  if (existsSync(absolute)) return realpathSync(absolute);
  let ancestor = path.dirname(absolute);
  const suffix = [path.basename(absolute)];
  while (!existsSync(ancestor)) {
    suffix.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return path.join(realpathSync(ancestor), ...suffix);
}

export function assertDistinctOwnedRoots(roots) {
  const entries = Object.entries(roots);
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [leftName, left] = entries[i];
      const [rightName, right] = entries[j];
      if (left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`)) {
        fail(
          WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.ROOT_REFUSED,
          "launcher-owned roots alias, collide, or contain one another",
          { left: { name: leftName, path: left }, right: { name: rightName, path: right } }
        );
      }
    }
  }
}

export function bindingIdentity(runId, kind) {
  return `${runId}.${kind}`;
}

const COMPLETE_EXACT_BINDING_FIELDS = Object.freeze([
  "schema_version", "launch_ref", "run_id", "retry_id", "unit_address",
  "initiative", "record_id", "slice_id", "base_ref", "base_sha",
  "output_branch", "worktree_path", "write_scope", "write_scope_source"
]);
const COMPLETE_SPARSE_BINDING_FIELDS = Object.freeze([
  ...COMPLETE_EXACT_BINDING_FIELDS, "cone_dirs", "index_sparse"
]);

const COMPLETE_WK_BINDING_FIELDS = Object.freeze([
  ...COMPLETE_EXACT_BINDING_FIELDS, "wk_tip_sha"
]);

const WK_COMMIT_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

const EXACT_NESTED_WK_BINDING_FIELDS = COMPLETE_WK_BINDING_FIELDS;
const EXACT_NESTED_SLICE_BINDING_FIELDS = Object.freeze([
  ...COMPLETE_EXACT_BINDING_FIELDS,
  "read_scope", "repo_paths", "selected_unit", "source_digest", "source_version",
  "cone_dirs", "index_sparse"
]);

const COMPLETE_FULL_SLICE_BINDING_FIELDS = Object.freeze([
  ...COMPLETE_EXACT_BINDING_FIELDS, "checkout_mode"
]);
const EXACT_NESTED_SLICE_BINDING_FIELDS_V2 = Object.freeze([
  ...COMPLETE_EXACT_BINDING_FIELDS,
  "read_scope", "repo_paths", "selected_unit", "source_digest", "source_version",
  "checkout_mode"
]);

function discriminateSliceCheckoutMode(binding, label) {
  const present = (field) => binding !== null && typeof binding === "object" &&
    Object.prototype.hasOwnProperty.call(binding, field);
  const hasCone = present("cone_dirs");
  const hasIndexSparse = present("index_sparse");
  const hasCheckoutMode = present("checkout_mode");
  if (hasCheckoutMode && !hasCone && !hasIndexSparse) {
    if (binding.checkout_mode !== MANAGED_SLICE_CHECKOUT_MODE_FULL) {
      fail(
        WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
        `${label} carries an unknown checkout_mode; only the v2 full mode is accepted`,
        { field: label, checkout_mode: binding.checkout_mode ?? null }
      );
    }
    return "full";
  }
  if (!hasCheckoutMode && hasCone && hasIndexSparse) {
    return "sparse";
  }
  fail(
    WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
    `${label} is neither an exact v1 sparse nor an exact v2 full binding (mixed or unknown checkout discriminant)`,
    {
      field: label,
      has_checkout_mode: hasCheckoutMode,
      has_cone_dirs: hasCone,
      has_index_sparse: hasIndexSparse
    }
  );
}

function assertExactNestedBindingFields(binding, expectedFields, label) {
  const actual = binding && typeof binding === "object" ? Object.keys(binding).sort() : [];
  const expected = [...expectedFields].sort();
  const exact = actual.length === expected.length &&
    actual.every((field, index) => field === expected[index]);
  if (!exact) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      `restored managed provisioning carrier nested ${label} does not carry exactly its declared field set`,
      { field: label, expected_fields: expected, actual_fields: actual }
    );
  }
}

function isPathWithinRoot(candidate, root) {
  return candidate !== root && candidate.startsWith(`${root}${path.sep}`);
}

function canonicalizeContainedPath(candidate, label, root, { mustExist = true } = {}) {
  const canonical = canonicalizeOwnedPath(candidate, label, { mustExist });
  if (!isPathWithinRoot(canonical, root)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      `${label} escapes its launcher-owned canonical root`,
      { label, path: canonical, root }
    );
  }
  return canonical;
}

export function assertCompleteManagedBinding({
  binding,
  repo,
  unitAddress,
  launchRef,
  runId,
  retryId,
  worktreeRoot,
  sparse,
  runGit = defaultRunGit,
  physical = true
}) {

  const sliceMode = sparse ? discriminateSliceCheckoutMode(binding, "slice binding") : null;
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
        WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
        `exact-unit binding is incomplete at ${field}`,
        { field, unitAddress }
      );
    }
  }

  if (!sparse && !WK_COMMIT_OID_RE.test(binding.wk_tip_sha ?? "")) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "WK binding wk_tip_sha is not a canonical commit id",
      { wk_tip_sha: binding.wk_tip_sha ?? null }
    );
  }
  const expectedName = deriveExactUnitName({ unitAddress, worktreeRoot });
  const expectedSliceId = expectedName.kind === "slice" ? expectedName.slice_id : null;
  const expectedBaseRef = expectedName.kind === "slice"
    ? `wk/${expectedName.initiative}/${expectedName.wk_id}`
    : "main";

  const expectedSchemaVersion = sliceMode === "full"
    ? WORKTREE_SUBSTRATE_SCHEMA_VERSION_V2
    : WORKTREE_SUBSTRATE_SCHEMA_VERSION;
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
    worktree_path: [path.resolve(binding.worktree_path), path.resolve(expectedName.worktree_path)],
    write_scope_source: [
      binding.write_scope_source,
      `wiki/work-records/${expectedName.wk_id}.json${expectedSliceId ? `#${expectedSliceId}` : ""}`
    ]
  };
  const mismatch = Object.entries(mismatches).find(([, [actual, expected]]) => actual !== expected);
  if (mismatch) {
    const [field, [actual, expected]] = mismatch;
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      `exact-unit binding does not match the selected unit at ${field}`,
      { field, expected, actual: actual ?? null }
    );
  }
  if (sliceMode === "sparse" && binding.index_sparse !== false) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "sparse binding must pin index_sparse=false",
      { actual: binding.index_sparse ?? null }
    );
  }
  if (!Number.isInteger(binding.retry_id) || binding.retry_id < 0 ||
      binding.write_scope.some((entry) => typeof entry !== "string" || entry.length === 0) ||
      (sliceMode === "sparse" && (binding.cone_dirs.length === 0 || binding.cone_dirs.some((entry) => typeof entry !== "string" || entry.length === 0)))) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE, "exact-unit binding carries invalid retry or scope fields");
  }
  let worktree;
  if (physical) {
    worktree = canonicalizeContainedPath(binding.worktree_path, "binding.worktree_path", worktreeRoot);
  } else {

    worktree = path.resolve(binding.worktree_path);
    if (!isPathWithinRoot(worktree, worktreeRoot)) {
      fail(
        WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
        "binding.worktree_path escapes its launcher-owned canonical root",
        { label: "binding.worktree_path", path: worktree, root: worktreeRoot }
      );
    }
  }
  if (worktree === repo || worktree.startsWith(`${repo}${path.sep}`)) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      "managed binding points at the main checkout",
      { repo, worktree }
    );
  }

  if (!physical) return;
  const head = runGit({ repo: worktree, args: ["rev-parse", "--verify", "HEAD^{commit}"] });
  const ref = runGit({ repo, args: ["rev-parse", "--verify", `${binding.output_branch}^{commit}`] });
  const headSha = head?.ok === true ? String(head.stdout ?? "").trim() : "";
  const refSha = ref?.ok === true ? String(ref.stdout ?? "").trim() : "";

  const expectedTip = sparse ? binding.base_sha : binding.wk_tip_sha;
  if (!headSha || headSha !== refSha || headSha !== expectedTip) {
    fail(
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      sparse
        ? "exact-unit worktree HEAD, bound ref, and commit base do not match"
        : "WK worktree HEAD, bound ref, and moving wk_tip_sha do not match",
      {
        head: headSha || null,
        ref: refSha || null,
        base_sha: binding.base_sha ?? null,
        wk_tip_sha: sparse ? undefined : (binding.wk_tip_sha ?? null)
      }
    );
  }

  if (!sparse) {
    const ancestor = runGit({
      repo,
      args: ["merge-base", "--is-ancestor", binding.base_sha, binding.wk_tip_sha]
    });
    if (!ancestor || ancestor.ok !== true) {
      fail(
        WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
        "WK binding fixed base_sha is not a retained ancestor of the moving wk_tip_sha",
        { base_sha: binding.base_sha ?? null, wk_tip_sha: binding.wk_tip_sha ?? null }
      );
    }
  }
}

const COMPLETE_MANAGED_PROVISIONING_FIELDS = Object.freeze([
  "schema_version", "complete", "main_repo", "initiative", "record_id", "slice_id",
  "unit_address", "retry_id", "wk_binding", "slice_binding",
  "worktree_path", "output_branch", "base_ref", "base_sha", "write_scope", "cone_dirs",
  "index_sparse", "validation_worktree_path", "shared_git_exposed"
]);

const COMPLETE_MANAGED_PROVISIONING_FIELDS_V2 = Object.freeze([
  ...COMPLETE_MANAGED_PROVISIONING_FIELDS.filter(
    (field) => field !== "cone_dirs" && field !== "index_sparse"
  ),
  "checkout_mode"
]);

export function freezeManagedResult({ mainRepo, initiative, wkId, sliceId, wkBinding, sliceBinding, retryId }) {

  const mode = discriminateSliceCheckoutMode(sliceBinding, "slice binding");
  const base = {
    schema_version: MANAGED_WORKTREE_BINDING_SCHEMA_VERSION,
    complete: true,
    main_repo: mainRepo,
    initiative,
    record_id: wkId,
    slice_id: sliceId,
    unit_address: `${initiative}/${wkId}/${sliceId}`,
    retry_id: retryId,
    wk_binding: Object.freeze({ ...wkBinding }),
    slice_binding: Object.freeze({ ...sliceBinding }),
    worktree_path: sliceBinding.worktree_path,
    output_branch: sliceBinding.output_branch,
    base_ref: sliceBinding.base_ref,
    base_sha: sliceBinding.base_sha,
    write_scope: Object.freeze([...(sliceBinding.write_scope ?? [])]),
    validation_worktree_path: wkBinding.worktree_path,
    shared_git_exposed: false
  };
  const carrier = mode === "full"
    ? { ...base, checkout_mode: MANAGED_SLICE_CHECKOUT_MODE_FULL }
    : {
        ...base,
        cone_dirs: Object.freeze([...(sliceBinding.cone_dirs ?? [])]),
        index_sparse: sliceBinding.index_sparse
      };
  return Object.freeze(carrier);
}

function assertManagedProvisioningResultShape({
  provisioning,
  mainRepo,
  initiative,
  subject,
  launchRef,
  runId,
  retryId,
  worktreeRoot,
  physical
}) {
  const repo = physical
    ? canonicalizeOwnedPath(mainRepo, "mainRepo", { mustExist: true })
    : path.resolve(assertAbsolutePath(mainRepo, "mainRepo"));
  const parsed = parseSubject(subject);
  if (parsed.sliceId === null) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE, "complete managed result requires an exact slice subject");
  }
  const roots = Object.freeze({
    worktreeRoot: physical
      ? canonicalizeOwnedPath(worktreeRoot, "worktreeRoot", { mustExist: true })
      : path.resolve(assertAbsolutePath(worktreeRoot, "worktreeRoot"))
  });
  assertDistinctOwnedRoots({ mainRepo: repo, ...roots });
  const unitAddress = `${initiative}/${parsed.wkId}/${parsed.sliceId}`;

  const carrierMode = (provisioning !== null && typeof provisioning === "object")
    ? discriminateSliceCheckoutMode(provisioning, "managed provisioning carrier")
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
      WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
      `managed provisioning result is partial or inexact${missing ? ` at ${missing}` : ""}`,
      { field: missing ?? "complete", expected_fields: expectedFields, actual_fields: actualFields }
    );
  }
  if (provisioning.schema_version !== MANAGED_WORKTREE_BINDING_SCHEMA_VERSION ||
      provisioning.main_repo !== repo ||
      provisioning.initiative !== initiative || provisioning.record_id !== parsed.wkId ||
      provisioning.slice_id !== parsed.sliceId || provisioning.unit_address !== unitAddress ||
      provisioning.retry_id !== retryId) {
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE, "managed provisioning result identity is mismatched");
  }

  if (physical === false) {

    assertExactNestedBindingFields(provisioning.wk_binding, EXACT_NESTED_WK_BINDING_FIELDS, "wk_binding");
    assertExactNestedBindingFields(
      provisioning.slice_binding,
      carrierMode === "full" ? EXACT_NESTED_SLICE_BINDING_FIELDS_V2 : EXACT_NESTED_SLICE_BINDING_FIELDS,
      "slice_binding"
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
          WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
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
        WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE,
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
  assertCompleteManagedBinding({
    binding: provisioning.wk_binding, repo, unitAddress: `${initiative}/${parsed.wkId}`,
    launchRef, runId: bindingIdentity(runId, "wk"), retryId,
    worktreeRoot: roots.worktreeRoot, sparse: false, physical
  });
  assertCompleteManagedBinding({
    binding: provisioning.slice_binding, repo, unitAddress, launchRef,
    runId: bindingIdentity(runId, "slice"), retryId,
    worktreeRoot: roots.worktreeRoot, sparse: true, physical
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
    fail(WORKTREE_PROVISIONING_DISPATCH_DIAGNOSTIC_CODES.BINDING_INCOMPLETE, "managed provisioning result aliases do not exactly mirror the selected slice binding");
  }
  return provisioning;
}

export function assertCompleteManagedProvisioningResult({
  provisioning,
  mainRepo,
  initiative,
  subject,
  launchRef,
  runId,
  retryId,
  worktreeRoot
} = {}) {
  return assertManagedProvisioningResultShape({
    provisioning, mainRepo, initiative, subject, launchRef, runId, retryId, worktreeRoot,
    physical: true
  });
}

export function assertStructuralManagedProvisioningResult({
  provisioning,
  mainRepo,
  initiative,
  subject,
  launchRef,
  runId,
  retryId,
  worktreeRoot
} = {}) {
  return assertManagedProvisioningResultShape({
    provisioning, mainRepo, initiative, subject, launchRef, runId, retryId, worktreeRoot,
    physical: false
  });
}
