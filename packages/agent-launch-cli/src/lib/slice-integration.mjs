

import { defaultRunGit } from "./worktree-substrate.mjs";

import {
  SLICE_INTEGRATION_SCHEMA_VERSION,
  SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
  SLICE_INTEGRATION_POLICY_POSTURES,
  SLICE_INTEGRATION_DIAGNOSTIC_CODES,
  SLICE_REF_RE,
  WK_REF_RE,
  fail,
  assertOid,
  normalizeRef,
  revParse,
  sliceHasNoRemainingDelta,
  assertExactWorktreeBinding,
  parseCanonicalRecord,
  resolveSliceMarkerCommit,
  buildCompleteWkReviewTarget
} from "./slice-integration-authorization.mjs";

import {
  advanceSliceRefCas,
  driveRecordCasWrite
} from "./slice-integration-delivery.mjs";

export {
  SLICE_INTEGRATION_SCHEMA_VERSION,
  SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
  SLICE_INTEGRATION_POLICY_POSTURES,
  SLICE_INTEGRATION_DIAGNOSTIC_CODES,
  SliceIntegrationError
} from "./slice-integration-authorization.mjs";
export {
  commitSliceRef,
  compensateCommittedSliceRef
} from "./slice-integration-delivery.mjs";

const BOUNDARY_TARGET_FIELDS = Object.freeze([
  "subject", "initiative", "slice_ref", "reviewed_sha", "diff_base_sha"
]);

function assertBoundaryObjectStoreProbes(runGit, mainRepo, target) {
  const probes = [
    { name: "slice_ref_resolves_to_reviewed_sha", rev: `${target.slice_ref}^{commit}`, expect: target.reviewed_sha },
    { name: "reviewed_commit_object_present", rev: `${target.reviewed_sha}^{commit}`, expect: target.reviewed_sha },
    { name: "slice_diff_base_object_present", rev: `${target.diff_base_sha}^{commit}`, expect: target.diff_base_sha }
  ];
  for (const probe of probes) {
    const result = runGit({ repo: mainRepo, args: ["rev-parse", "--verify", probe.rev] });
    const actual = result && result.ok === true ? String(result.stdout ?? "").trim() : null;
    if (actual !== probe.expect) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
        "boundary authorization no longer matches the exact slice target", {
        probe: probe.name,
        expected: probe.expect,
        actual
      });
    }
  }
}

function assertSliceIntegrationBoundaryAuthorization({
  runGit,
  mainRepo,
  sliceRef,
  wkId,
  sliceId,
  initiative,
  baseSha,
  commit,
  boundaryAuthorization
}) {
  const subject = `${wkId}#${sliceId}`;
  if (boundaryAuthorization === null || boundaryAuthorization === undefined) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BOUNDARY_AUTHORIZATION_MISSING,
      "integration requires a launcher-owned configured-policy disposition", { subject });
  }
  if (typeof boundaryAuthorization !== "object" || Array.isArray(boundaryAuthorization)) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BOUNDARY_AUTHORIZATION_MALFORMED,
      "integration boundary authorization must be an object", { subject });
  }
  const target = boundaryAuthorization.target;
  if (boundaryAuthorization.schema_version !==
        SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION ||
      boundaryAuthorization.operation !== "integrate_committed_slice" ||
      typeof target !== "object" || target === null || Array.isArray(target)) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BOUNDARY_AUTHORIZATION_MALFORMED,
      "integration boundary authorization has an invalid schema", { subject });
  }
  const missingField = BOUNDARY_TARGET_FIELDS.find(
    (field) => typeof target[field] !== "string" || target[field].length === 0
  );
  if (missingField !== undefined) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BOUNDARY_AUTHORIZATION_MALFORMED,
      "integration boundary authorization is missing an exact-target field", {
      subject,
      field: missingField
    });
  }
  if (target.subject !== subject || target.initiative !== initiative ||
      target.slice_ref !== sliceRef || target.reviewed_sha !== commit) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "integration boundary authorization identifies a different target", {
      expected: { subject, initiative, slice_ref: sliceRef, reviewed_sha: commit },
      actual: {
        subject: target.subject,
        initiative: target.initiative,
        slice_ref: target.slice_ref,
        reviewed_sha: target.reviewed_sha
      }
    });
  }
  const currentSliceSha = revParse(runGit, mainRepo, sliceRef);
  if (currentSliceSha !== target.reviewed_sha || target.diff_base_sha !== baseSha) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "integration boundary authorization is stale for the exact target", {
      subject,
      reviewed_sha: target.reviewed_sha,
      current_slice_sha: currentSliceSha,
      expected_diff_base_sha: baseSha,
      authorized_diff_base_sha: target.diff_base_sha
    });
  }
  if (boundaryAuthorization.policy_posture === SLICE_INTEGRATION_POLICY_POSTURES.CCE_POLICY) {
    if (boundaryAuthorization.authority !== "cce" ||
        boundaryAuthorization.policy_gate_configured !== true ||
        boundaryAuthorization.decision !== "allow" ||
        boundaryAuthorization.ratified !== true ||
        boundaryAuthorization.attestation_valid !== true ||
        boundaryAuthorization.audit_grade !== true) {
      const code = boundaryAuthorization.decision === "deny"
        ? SLICE_INTEGRATION_DIAGNOSTIC_CODES.CCE_POLICY_DENIED
        : SLICE_INTEGRATION_DIAGNOSTIC_CODES.CCE_POLICY_UNRATIFIED;
      fail(code, "configured CCE policy did not provide a ratified allow decision", { subject });
    }
  } else if (boundaryAuthorization.policy_posture ===
      SLICE_INTEGRATION_POLICY_POSTURES.FREE_SUBSTRATE) {
    if (boundaryAuthorization.authority !== "none" ||
        boundaryAuthorization.policy_gate_configured !== false ||
        boundaryAuthorization.decision !== "not_gated" ||
        boundaryAuthorization.ratified !== false ||
        boundaryAuthorization.attestation_valid !== false ||
        boundaryAuthorization.audit_grade !== false) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BOUNDARY_AUTHORIZATION_MALFORMED,
        "free-substrate posture must report that no CCE gate or audit verdict exists", { subject });
    }
  } else {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BOUNDARY_AUTHORIZATION_MALFORMED,
      "integration boundary authorization has an unknown policy posture", { subject });
  }
  assertBoundaryObjectStoreProbes(runGit, mainRepo, target);
  return Object.freeze({ ...boundaryAuthorization, target: Object.freeze({ ...target }) });
}

export async function integrateCommittedSlice({
  mainRepo,
  worktreePath,
  unitAddress,
  sliceRef,
  wkRef,
  baseSha,
  commit,
  workerTerminated,
  transitionToReview,
  markSliceComplete,

  boundaryAuthorization = null,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const coordinatorContinuation = boundaryAuthorization?.operation ===
    "integrate_committed_slice";
  if (workerTerminated !== true && !coordinatorContinuation) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.WORKER_NOT_TERMINATED, "trusted integration requires confirmed worker termination");
  }
  const slice = normalizeRef(sliceRef, SLICE_REF_RE, "sliceRef");
  const wk = normalizeRef(wkRef, WK_REF_RE, "wkRef");
  if (slice.match[1] !== wk.match[1] || slice.match[2] !== wk.match[2]) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH, "slice and WK refs do not identify the same WK");
  }
  const expectedUnit = `${slice.match[1]}/${slice.match[2]}/${slice.match[3]}`;
  if (unitAddress !== expectedUnit) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH, "unitAddress does not match the exact slice ref", { expected: expectedUnit, actual: unitAddress });
  }
  assertOid(baseSha, "baseSha");
  assertOid(commit, "commit");

  if (commit === baseSha) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "a committed delivery requires a server-minted child distinct from the authenticated base", {
        base_sha: baseSha,
        commit
      });
  }
  if (typeof transitionToReview !== "function") {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.REVIEW_FREEZE_FAILED, "canonical review transition callback is required");
  }
  const initialWkTip = revParse(runGit, mainRepo, wk.ref);
  const emptyDelivery = sliceHasNoRemainingDelta({
    runGit,
    mainRepo,
    baseSha,
    commit,
    wkTip: initialWkTip
  });

  if (!emptyDelivery) {
    if (!coordinatorContinuation) {
      assertExactWorktreeBinding(runGit, worktreePath, slice.ref, commit);
    }
  }
  const loadRecord = deps.loadCanonicalRecord ?? parseCanonicalRecord;

  const appliedBoundaryAuthorization = assertSliceIntegrationBoundaryAuthorization({
    runGit,
    mainRepo,
    sliceRef: slice.ref,
    wkId: slice.match[2],
    sliceId: slice.match[3],
    initiative: slice.match[1],
    baseSha,
    commit,
    boundaryAuthorization
  });

  const advance = advanceSliceRefCas({
    runGit,
    mainRepo,
    wkRef: wk.ref,
    wkId: slice.match[2],
    sliceId: slice.match[3],
    baseSha,
    commit
  });
  const integratedCommit = advance.integratedCommit;
  const wkOld = advance.previousWkSha;
  const rebased = advance.rebased;

  const write = await driveRecordCasWrite({
    runGit,
    mainRepo,
    wkRef: wk.ref,
    initiative: slice.match[1],
    wkId: slice.match[2],
    sliceId: slice.match[3],
    loadRecord,
    transitionToReview,
    markSliceComplete
  });

  return Object.freeze({
    schema_version: SLICE_INTEGRATION_SCHEMA_VERSION,
    integrated: true,
    rebased,
    previous_wk_sha: wkOld,
    slice_ref: slice.ref,
    slice_sha: integratedCommit,
    delivery_sha: advance.deliveryCommit,
    wk_ref: wk.ref,
    wk_sha: write.wkTip,
    empty_delivery: advance.empty_delivery,

    review_target: write.reviewTarget,
    transition: write.transition,
    boundary_authorization: appliedBoundaryAuthorization
  });
}

export function reconcileIntegratedSliceRecord({
  mainRepo,
  unitAddress,
  sliceRef,
  wkRef,
  baseSha = null,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const slice = normalizeRef(sliceRef, SLICE_REF_RE, "sliceRef");
  const wk = normalizeRef(wkRef, WK_REF_RE, "wkRef");
  if (slice.match[1] !== wk.match[1] || slice.match[2] !== wk.match[2]) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH, "slice and WK refs do not identify the same WK");
  }
  const expectedUnit = `${slice.match[1]}/${slice.match[2]}/${slice.match[3]}`;
  if (unitAddress !== expectedUnit) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH, "unitAddress does not match the exact slice ref", { expected: expectedUnit, actual: unitAddress });
  }
  const wkTip = revParse(runGit, mainRepo, wk.ref);
  const markerSha = resolveSliceMarkerCommit(runGit, mainRepo, wkTip, slice.match[2], slice.match[3]);
  const loadRecord = deps.loadCanonicalRecord ?? parseCanonicalRecord;
  const record = loadRecord(mainRepo, slice.match[2]);
  const sliceEntry = Array.isArray(record?.slices)
    ? record.slices.find((entry) => entry?.id === slice.match[3])
    : null;
  const sliceComplete = sliceEntry ? (sliceEntry.status === "done" || sliceEntry.status === "cancelled") : false;
  const wkInReview = record?.status === "review";
  const wkInTerminalRecoveryPosture = wkInReview || record?.status === "done";
  if (markerSha === null) {

    return null;
  }
  const sliceTip = revParse(runGit, mainRepo, slice.ref);
  if (sliceTip !== markerSha) {

    const retainedMarker = resolveSliceMarkerCommit(
      runGit,
      mainRepo,
      sliceTip,
      slice.match[2],
      slice.match[3]
    );
    if (retainedMarker !== sliceTip) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
        "integrated slice marker does not match the retained slice delivery", {
          slice_ref: slice.ref,
          slice_tip: sliceTip,
          marker_sha: markerSha,
          retained_marker_sha: retainedMarker
        });
    }
  }
  if (!sliceComplete && !wkInTerminalRecoveryPosture) {

    return null;
  }

  const ownsCurrentWkTip = markerSha === wkTip;
  const reviewTarget = wkInReview && ownsCurrentWkTip
    ? buildCompleteWkReviewTarget({ runGit, mainRepo, initiative: slice.match[1], wkId: slice.match[2], wkRef: wk.ref, wkTip })
    : null;
  return Object.freeze({
    schema_version: SLICE_INTEGRATION_SCHEMA_VERSION,
    integrated: true,
    recovered: true,
    rebased: false,
    previous_wk_sha: null,
    slice_ref: slice.ref,
    slice_sha: markerSha,
    delivery_sha: sliceTip,
    wk_ref: wk.ref,
    wk_sha: wkTip,
    empty_delivery: false,
    review_target: reviewTarget,
    transition: Object.freeze({
      valid: true,
      written: false,
      no_op: true,
      status: wkInReview && ownsCurrentWkTip ? "review" : "done",
      recovered: true
    }),
    integrated_state: wkInTerminalRecoveryPosture && ownsCurrentWkTip ? "final" : "non_final"
  });
}
