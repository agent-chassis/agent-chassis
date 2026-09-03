

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  assertManagedProvisioningResultShape,
  deriveManagedExactUnitName,
  discriminateManagedSliceCheckoutMode,
  isPathWithinRoot,
  MANAGED_PROVISIONING_SHAPE_DIAGNOSTIC_CODES as CODES,
  MANAGED_SLICE_CHECKOUT_MODE_FULL,
  MANAGED_WORKTREE_BINDING_SCHEMA_VERSION,
  ManagedProvisioningResultShapeError
} from "../../packages/agent-launch-core/src/lib/managed-provisioning-result-shape.mjs";

const INITIATIVE = "IN-0017";
const WK_ID = "WK-1469";
const SLICE_ID = "SLICE-002";
const SUBJECT = `${WK_ID}#${SLICE_ID}`;
const MAIN_REPO = path.resolve("/launcher/main-repo");
const WORKTREE_ROOT = path.resolve("/launcher/worktrees");
const LAUNCH_REF = "wkmh_shapekernel";
const RUN_ID = "wkdb_shapekernel";
const RETRY_ID = 0;
const WK_TIP = "a".repeat(40);
const WK_FORK = "b".repeat(40);
const SLICE_BASE = "c".repeat(40);
const WK_WORKTREE = path.join(WORKTREE_ROOT, `wk-${INITIATIVE}-${WK_ID}`);
const SLICE_WORKTREE = path.join(WORKTREE_ROOT, `slice-${INITIATIVE}-${WK_ID}-${SLICE_ID}`);
const WK_BRANCH = `wk/${INITIATIVE}/${WK_ID}`;
const SLICE_BRANCH = `slice/${INITIATIVE}/${WK_ID}/${SLICE_ID}`;

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function wkBinding(overrides = {}) {
  return {
    schema_version: "worktree-identity-binding.v1",
    launch_ref: LAUNCH_REF,
    run_id: `${RUN_ID}.wk`,
    retry_id: RETRY_ID,
    unit_address: `${INITIATIVE}/${WK_ID}`,
    initiative: INITIATIVE,
    record_id: WK_ID,
    slice_id: null,
    base_ref: "main",
    base_sha: WK_FORK,
    output_branch: WK_BRANCH,
    worktree_path: WK_WORKTREE,
    write_scope: ["packages/demo/source.mjs"],
    write_scope_source: `wiki/work-records/${WK_ID}.json`,
    wk_tip_sha: WK_TIP,
    ...overrides
  };
}

function sliceBinding(mode, overrides = {}) {
  const shared = {
    schema_version: mode === "full"
      ? "worktree-identity-binding.v2"
      : "worktree-identity-binding.v1",
    launch_ref: LAUNCH_REF,
    run_id: `${RUN_ID}.slice`,
    retry_id: RETRY_ID,
    unit_address: `${INITIATIVE}/${WK_ID}/${SLICE_ID}`,
    initiative: INITIATIVE,
    record_id: WK_ID,
    slice_id: SLICE_ID,
    base_ref: WK_BRANCH,
    base_sha: SLICE_BASE,
    output_branch: SLICE_BRANCH,
    worktree_path: SLICE_WORKTREE,
    write_scope: ["packages/demo/source.mjs"],
    write_scope_source: `wiki/work-records/${WK_ID}.json#${SLICE_ID}`,
    read_scope: ["packages/demo/source.mjs"],
    repo_paths: ["packages/demo/source.mjs"],
    selected_unit: { record_id: WK_ID, slice_id: SLICE_ID },
    source_digest: "sha256:deadbeef",
    source_version: 1
  };
  return mode === "full"
    ? { ...shared, checkout_mode: MANAGED_SLICE_CHECKOUT_MODE_FULL, ...overrides }
    : { ...shared, cone_dirs: ["packages/demo"], index_sparse: false, ...overrides };
}

function carrier(mode = "sparse", { carrierOverrides = {}, sliceOverrides = {}, wkOverrides = {} } = {}) {
  const wk = wkBinding(wkOverrides);
  const slice = sliceBinding(mode, sliceOverrides);
  const base = {
    schema_version: MANAGED_WORKTREE_BINDING_SCHEMA_VERSION,
    complete: true,
    main_repo: MAIN_REPO,
    initiative: INITIATIVE,
    record_id: WK_ID,
    slice_id: SLICE_ID,
    unit_address: `${INITIATIVE}/${WK_ID}/${SLICE_ID}`,
    retry_id: RETRY_ID,
    wk_binding: wk,
    slice_binding: slice,
    worktree_path: slice.worktree_path,
    output_branch: slice.output_branch,
    base_ref: slice.base_ref,
    base_sha: slice.base_sha,
    write_scope: [...slice.write_scope],
    validation_worktree_path: wk.worktree_path,
    shared_git_exposed: false
  };
  const shaped = mode === "full"
    ? { ...base, checkout_mode: MANAGED_SLICE_CHECKOUT_MODE_FULL }
    : { ...base, cone_dirs: [...slice.cone_dirs], index_sparse: slice.index_sparse };
  return deepFreeze({ ...shaped, ...carrierOverrides });
}

function prove(provisioning, overrides = {}) {
  return assertManagedProvisioningResultShape({
    provisioning,
    mainRepo: MAIN_REPO,
    initiative: INITIATIVE,
    subject: SUBJECT,
    launchRef: LAUNCH_REF,
    runId: RUN_ID,
    retryId: RETRY_ID,
    worktreeRoot: WORKTREE_ROOT,
    ...overrides
  });
}

function refusal(fn, { code = CODES.BINDING_INCOMPLETE, message } = {}) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ManagedProvisioningResultShapeError,
      `expected a bounded shape refusal, got ${error?.name}: ${error?.message}`);
    assert.equal(error.code, code, error.message);
    if (message) assert.match(error.message, message);
    return true;
  });
}

test("WK-2352 the kernel accepts the exact v1 sparse and v2 full carriers by identity", () => {
  for (const mode of ["sparse", "full"]) {
    const value = carrier(mode);
    assert.equal(prove(value), value, `${mode} carrier must return by identity`);
  }
});

test("WK-2352 the kernel proves shape with the launcher-owned root unmounted", () => {

  assert.equal(isPathWithinRoot(SLICE_WORKTREE, WORKTREE_ROOT), true);
  assert.equal(isPathWithinRoot(WORKTREE_ROOT, WORKTREE_ROOT), false);
  assert.ok(prove(carrier("sparse")));
});

test("WK-2352 the pure unit-name derivation is deterministic for both unit kinds", () => {
  assert.deepEqual(
    { ...deriveManagedExactUnitName({ unitAddress: `${INITIATIVE}/${WK_ID}`,
      worktreeRoot: WORKTREE_ROOT }) },
    {
      kind: "wk", unit_address: `${INITIATIVE}/${WK_ID}`, initiative: INITIATIVE,
      wk_id: WK_ID, slice_id: null, output_branch: WK_BRANCH, worktree_path: WK_WORKTREE
    }
  );
  assert.deepEqual(
    { ...deriveManagedExactUnitName({ unitAddress: `${INITIATIVE}/${WK_ID}/${SLICE_ID}`,
      worktreeRoot: WORKTREE_ROOT }) },
    {
      kind: "slice", unit_address: `${INITIATIVE}/${WK_ID}/${SLICE_ID}`, initiative: INITIATIVE,
      wk_id: WK_ID, slice_id: SLICE_ID, output_branch: SLICE_BRANCH,
      worktree_path: SLICE_WORKTREE
    }
  );

  refusal(() => deriveManagedExactUnitName({
    unitAddress: `${INITIATIVE}/${WK_ID}/..`, worktreeRoot: WORKTREE_ROOT
  }), { code: CODES.SUBSTRATE_INVALID_SLICE_ID });
  refusal(() => deriveManagedExactUnitName({
    unitAddress: `${INITIATIVE}/${WK_ID}/${SLICE_ID}/extra`, worktreeRoot: WORKTREE_ROOT
  }), { code: CODES.SUBSTRATE_INVALID_UNIT_ADDRESS });
  refusal(() => deriveManagedExactUnitName({
    unitAddress: `IN-17/${WK_ID}`, worktreeRoot: WORKTREE_ROOT
  }), { code: CODES.SUBSTRATE_INVALID_INITIATIVE_ID });
  refusal(() => deriveManagedExactUnitName({
    unitAddress: `${INITIATIVE}/${WK_ID}`, worktreeRoot: "relative/root"
  }), { code: CODES.SUBSTRATE_INVALID_ARG });
});

test("WK-2352 the checkout-mode discriminant fails closed on mixed and unknown carriers", () => {
  assert.equal(discriminateManagedSliceCheckoutMode(
    { cone_dirs: [], index_sparse: false }, "slice binding"), "sparse");
  assert.equal(discriminateManagedSliceCheckoutMode(
    { checkout_mode: "full" }, "slice binding"), "full");
  refusal(() => discriminateManagedSliceCheckoutMode(
    { checkout_mode: "full", cone_dirs: [], index_sparse: false }, "slice binding"),
  { message: /neither an exact v1 sparse nor an exact v2 full/ });
  refusal(() => discriminateManagedSliceCheckoutMode({}, "slice binding"),
    { message: /neither an exact v1 sparse nor an exact v2 full/ });
  refusal(() => discriminateManagedSliceCheckoutMode(
    { checkout_mode: "sparse" }, "slice binding"), { message: /unknown checkout_mode/ });
});

test("WK-2352 an extended or truncated carrier field set fails closed", () => {
  refusal(() => prove(deepFreeze({ ...carrier("sparse"), extra_authority: true })),
    { message: /partial or inexact/ });
  const { shared_git_exposed: _dropped, ...truncated } = carrier("sparse");
  refusal(() => prove(deepFreeze(truncated)), { message: /partial or inexact/ });
  refusal(() => prove(deepFreeze({ ...carrier("sparse"), complete: false })),
    { message: /partial or inexact/ });
  refusal(() => prove(null), { message: /partial or inexact/ });
});

test("WK-2352 an extended or truncated NESTED binding fails closed with a precise field", () => {
  refusal(() => prove(carrier("sparse", {
    wkOverrides: { authority: "coordinator" }
  })), { message: /nested wk_binding does not carry exactly/ });
  refusal(() => prove(carrier("sparse", {
    sliceOverrides: { authority: "coordinator" }
  })), { message: /nested slice_binding does not carry exactly/ });
});

test("WK-2352 subject and current-attempt identity are proven exactly", () => {
  refusal(() => prove(carrier("sparse"), { subject: WK_ID }),
    { message: /requires an exact slice subject/ });
  refusal(() => prove(carrier("sparse"), { subject: "not-a-subject" }),
    { code: CODES.INVALID_SUBJECT });
  refusal(() => prove(carrier("sparse"), { retryId: 1 }),
    { message: /identity is mismatched/ });
  refusal(() => prove(carrier("sparse"), { initiative: "IN-0099" }),
    { message: /identity is mismatched/ });

  refusal(() => prove(carrier("sparse"), { runId: "wkdb_other" }),
    { message: /does not match the selected unit at run_id/ });
  refusal(() => prove(carrier("sparse"), { launchRef: "wkmh_other" }),
    { message: /does not match the selected unit at launch_ref/ });
});

test("WK-2352 containment is proven by pure path math", () => {

  refusal(() => prove(carrier("sparse", {
    sliceOverrides: { worktree_path: "/elsewhere/slice" },
    carrierOverrides: { worktree_path: "/elsewhere/slice" }
  })), { message: /does not match the selected unit at worktree_path/ });
  assert.equal(isPathWithinRoot("/elsewhere/slice", WORKTREE_ROOT), false);
  assert.equal(isPathWithinRoot(`${WORKTREE_ROOT}-sibling/x`, WORKTREE_ROOT), false);

  refusal(() => prove(carrier("sparse"), { mainRepo: WORKTREE_ROOT }),
    { code: CODES.ROOT_REFUSED, message: /alias, collide, or contain one another/ });
  refusal(() => prove(carrier("sparse"), { worktreeRoot: "worktrees" }),
    { code: CODES.INVALID_ARG });
  refusal(() => prove(carrier("sparse"), { mainRepo: "main-repo" }),
    { code: CODES.INVALID_ARG });
});

test("WK-2352 independent WK and slice resources may differ but must not collide", () => {

  assert.ok(prove(carrier("sparse", { sliceOverrides: { base_sha: "d".repeat(40) },
    carrierOverrides: { base_sha: "d".repeat(40) } })));
  refusal(() => prove(carrier("sparse", {
    sliceOverrides: { output_branch: WK_BRANCH },
    carrierOverrides: { output_branch: WK_BRANCH }
  })), { message: /persistent WK and slice resources collide/ });
  refusal(() => prove(carrier("sparse", {
    sliceOverrides: { worktree_path: WK_WORKTREE },
    carrierOverrides: { worktree_path: WK_WORKTREE, validation_worktree_path: WK_WORKTREE }
  })), { message: /persistent WK and slice resources collide/ });
});

test("WK-2352 the carrier must mirror its selected slice binding exactly", () => {
  for (const carrierOverrides of [
    { base_ref: "main" },
    { write_scope: ["packages/other.mjs"] },
    { cone_dirs: ["packages/other"] },
    { index_sparse: true },
    { validation_worktree_path: SLICE_WORKTREE },
    { shared_git_exposed: true }
  ]) {
    refusal(() => prove(carrier("sparse", { carrierOverrides })),
      { message: /do not exactly mirror the selected slice binding|partial or inexact/ });
  }

  refusal(() => prove(carrier("full", {
    sliceOverrides: { schema_version: "worktree-identity-binding.v1" }
  })), { message: /does not match the selected unit at schema_version/ });
});

test("WK-2352 the WK binding's moving tip must be a canonical commit id", () => {
  refusal(() => prove(carrier("sparse", { wkOverrides: { wk_tip_sha: "not-an-oid" } })),
    { message: /wk_tip_sha is not a canonical commit id/ });
});

test("WK-2352 deep-freeze enforcement is an explicit structural option", () => {
  const mutable = { ...carrier("sparse") };
  mutable.write_scope = [...mutable.write_scope];

  refusal(() => prove(mutable), { message: /not deeply frozen at result/ });

  assert.equal(prove(mutable, { requireRestoredCarrierImmutability: false }), mutable);

  const shallow = Object.freeze({ ...carrier("sparse"), write_scope: ["packages/demo/source.mjs"] });
  refusal(() => prove(shallow), { message: /not deeply frozen at write_scope/ });
});

test("WK-2352 the kernel raises through an injected raiser without changing the contract", () => {
  class HostError extends Error {}
  const hostFail = (code, message, detail = null) => {
    const error = new HostError(`agent-launch worktree-provisioning-dispatch: ${message}`);
    error.code = code;
    error.detail = detail;
    throw error;
  };
  assert.throws(() => prove(deepFreeze({ ...carrier("sparse"), complete: false }),
    { fail: hostFail }), (error) => {
    assert.ok(error instanceof HostError);
    assert.equal(error.code, CODES.BINDING_INCOMPLETE);
    assert.match(error.message, /managed provisioning result is partial or inexact/);
    return true;
  });
});
