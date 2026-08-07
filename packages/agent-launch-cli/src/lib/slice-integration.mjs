

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
  assertExactWorktreeBinding,
  parseCanonicalRecord,
  resolveSliceMarkerCommit,
  resolveSliceMarkerEvidence,
  SLICE_MARKER_EVIDENCE_STATES,
  buildCompleteWkReviewTarget,
  resolveTree,
  resolveAuthenticatedExactSliceDeliveryBase,
  isLastIncompleteImplementationSlice,
  resolveFixedWkForkCommit,
  resolveZeroDeltaIntegrationEvidence
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
  SliceIntegrationError,
  buildZeroDeltaIntegrationEvidenceMessage,
  authenticateZeroDeltaIntegrationEvidenceCommit,
  resolveAuthenticatedExactSliceDeliveryBase,
  resolveZeroDeltaIntegrationEvidence
} from "./slice-integration-authorization.mjs";
export {
  commitSliceRef,
  compensateCommittedSliceRef,
  advanceZeroDeltaEvidenceRefTransaction
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
  writeRecordCas = null,

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

  if (!coordinatorContinuation) {
    assertExactWorktreeBinding(runGit, worktreePath, slice.ref, commit);
  }
  const loadRecord = deps.loadCanonicalRecord ?? parseCanonicalRecord;

  resolveFixedWkForkCommit({
    runGit,
    mainRepo,
    initiative: slice.match[1],
    wkId: slice.match[2]
  });

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
    runGitRefTransaction: deps.runGitRefTransaction,
    mainRepo,
    sliceRef: slice.ref,
    wkRef: wk.ref,
    wkId: slice.match[2],
    sliceId: slice.match[3],
    baseSha,
    commit,
    expectedWkTip: initialWkTip
  });
  const integratedCommit = advance.integratedCommit;
  const wkOld = advance.previousWkSha;
  const rebased = advance.rebased;

  const concurrentZeroDeltaWinner = advance.empty_delivery &&
    advance.already_present &&
    advance.previousWkSha === initialWkTip;
  const expectedPostHelperWkTip = advance.already_present && !concurrentZeroDeltaWinner
    ? initialWkTip
    : integratedCommit;
  const observedPostHelperWkTip = revParse(runGit, mainRepo, wk.ref);
  if (observedPostHelperWkTip !== expectedPostHelperWkTip) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT,
      "WK ref moved after same-slice marker authentication",
      {
        wk_ref: wk.ref,
        expected_wk_sha: expectedPostHelperWkTip,
        observed_wk_sha: observedPostHelperWkTip
      }
    );
  }

  const write = await driveRecordCasWrite({
    runGit,
    mainRepo,
    wkRef: wk.ref,
    initiative: slice.match[1],
    wkId: slice.match[2],
    sliceId: slice.match[3],
    loadRecord,
    writeRecordCas,
    transitionToReview,
    markSliceComplete,
    validateRecord: ({ wkTip }) => {
      if (wkTip !== expectedPostHelperWkTip) {
        fail(
          SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT,
          "WK ref moved before canonical record mutation",
          {
            wk_ref: wk.ref,
            expected_wk_sha: expectedPostHelperWkTip,
            observed_wk_sha: wkTip
          }
        );
      }
    }
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

function zeroDeltaLifecycleRefusal(code, message, detail) {
  fail(code, message, detail);
}

function isParentPreterminal(status) {
  return status !== "review" && status !== "done";
}

const EXACT_RAW_REF_FORMAT = "%(refname)%00%(objectname)%00%(objecttype)%00%(symref)";
const EXACT_RAW_REF_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function authenticateExactDirectCommitRef(runGit, mainRepo, requestedRef, targetKind) {
  let result;
  try {
    result = runGit({
      repo: mainRepo,
      args: [
        "--no-replace-objects",
        "for-each-ref",
        `--format=${EXACT_RAW_REF_FORMAT}`,
        requestedRef
      ]
    });
  } catch {
    result = null;
  }

  let refusal = "indeterminate";
  if (result?.ok === true && typeof result.stdout === "string") {
    if (result.stdout === "") {
      refusal = "missing";
    } else if (!result.stdout.endsWith("\n") || result.stdout.includes("\r") ||
        result.stdout.includes("\uFFFD")) {
      refusal = "malformed";
    } else {
      const records = result.stdout.slice(0, -1).split("\n");
      if (records.length !== 1) {
        refusal = "ambiguous";
      } else {
        const fields = records[0].split("\0");
        if (fields.length !== 4) {
          refusal = "malformed";
        } else {
          const [refName, oid, objectType, symbolicTarget] = fields;
          if (refName !== requestedRef) {
            refusal = "wrong_ref";
          } else if (symbolicTarget !== "") {
            refusal = "symbolic";
          } else if (!EXACT_RAW_REF_OID_RE.test(oid) || /^0+$/u.test(oid)) {
            refusal = "malformed_oid";
          } else if (objectType !== "commit") {
            refusal = "non_commit";
          } else {
            return oid;
          }
        }
      }
    }
  }

  fail(
    SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
    `zero-delta recovery could not authenticate the exact ${targetKind} ref`,
    { reason: `${targetKind}_target_${refusal}`, [`${targetKind}_ref`]: requestedRef }
  );
}

function recoveredZeroDeltaResult({
  slice,
  wk,
  evidence,
  wkTip,
  reviewTarget,
  transition,
  integratedState
}) {
  return Object.freeze({
    schema_version: SLICE_INTEGRATION_SCHEMA_VERSION,
    integrated: true,
    recovered: true,
    rebased: false,
    previous_wk_sha: evidence.wk_parent_sha,
    slice_ref: slice.ref,
    slice_sha: evidence.evidence_sha,
    delivery_sha: evidence.delivery_sha,
    wk_ref: wk.ref,
    wk_sha: wkTip,
    empty_delivery: true,
    review_target: reviewTarget,
    transition,
    integrated_state: integratedState
  });
}

export async function recoverZeroDeltaIntegratedSlice({
  mainRepo,
  unitAddress,
  sliceRef,
  wkRef,
  writeRecordCas = null,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const slice = normalizeRef(sliceRef, SLICE_REF_RE, "sliceRef");
  const wk = normalizeRef(wkRef, WK_REF_RE, "wkRef");
  if (slice.match[1] !== wk.match[1] || slice.match[2] !== wk.match[2]) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "slice and WK refs do not identify the same WK");
  }
  const expectedUnit = `${slice.match[1]}/${slice.match[2]}/${slice.match[3]}`;
  if (unitAddress !== expectedUnit) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "unitAddress does not match the exact slice ref", { expected: expectedUnit, actual: unitAddress });
  }
  const subject = `${slice.match[2]}#${slice.match[3]}`;

  const fixedFork = resolveFixedWkForkCommit({
    runGit,
    mainRepo,
    initiative: slice.match[1],
    wkId: slice.match[2]
  });
  const sliceTip = authenticateExactDirectCommitRef(runGit, mainRepo, slice.ref, "slice");
  const wkTip = authenticateExactDirectCommitRef(runGit, mainRepo, wk.ref, "wk");
  const evidenceSet = resolveZeroDeltaIntegrationEvidence({
    runGit,
    mainRepo,
    wkTip,
    subject,
    deliverySha: sliceTip
  });
  const loadRecord = deps.loadCanonicalRecord ?? parseCanonicalRecord;
  const record = loadRecord(mainRepo, slice.match[2]);
  const sliceEntry = record?.slices?.find((entry) => entry?.id === slice.match[3]) ?? null;
  if (sliceEntry === null) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "canonical integration slice is absent", { subject });
  }
  const parentStatus = record.status;
  const sliceStatus = sliceEntry.status;

  if (evidenceSet.count > 1) {
    zeroDeltaLifecycleRefusal(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_AMBIGUOUS,
      "multiple exact zero-delta integration evidence commits are reachable",
      { subject, match_count: evidenceSet.count }
    );
  }
  if (evidenceSet.count === 0) {

    const directBase = resolveAuthenticatedExactSliceDeliveryBase({
      runGit,
      mainRepo,
      subject,
      deliverySha: sliceTip
    });
    const genuineZeroDelta = directBase !== null &&
      resolveTree(runGit, mainRepo, directBase) === resolveTree(runGit, mainRepo, sliceTip);
    if (!genuineZeroDelta) return null;
    if (sliceStatus === "done" || sliceStatus === "cancelled" ||
        parentStatus === "review" || parentStatus === "done") {
      zeroDeltaLifecycleRefusal(
        SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_STATUS_WITHOUT_EVIDENCE,
        "zero-delta lifecycle status has no durable integration evidence",
        { subject, reason: "status_without_evidence", slice_status: sliceStatus, parent_status: parentStatus }
      );
    }
    if (sliceStatus === "review" && isParentPreterminal(parentStatus)) return null;
    zeroDeltaLifecycleRefusal(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_LIFECYCLE_CONTRADICTION,
      "zero-delta fresh admission is not permitted from this lifecycle state",
      { subject, reason: "fresh_status_inadmissible", slice_status: sliceStatus, parent_status: parentStatus }
    );
  }

  const evidence = evidenceSet.match;
  const evidenceAtCurrentTip = evidence.evidence_sha === wkTip;
  const parentTerminal = parentStatus === "review" || parentStatus === "done";
  if (sliceStatus !== "done" && parentTerminal) {
    zeroDeltaLifecycleRefusal(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_LIFECYCLE_CONTRADICTION,
      "non-done slice contradicts terminal parent after zero-delta integration",
      { subject, reason: "non_done_slice_with_terminal_parent", slice_status: sliceStatus, parent_status: parentStatus }
    );
  }
  if (sliceStatus === "review" && isParentPreterminal(parentStatus)) {
    const write = await driveRecordCasWrite({
      runGit,
      mainRepo,
      wkRef: wk.ref,
      initiative: slice.match[1],
      wkId: slice.match[2],
      sliceId: slice.match[3],
      loadRecord,
      writeRecordCas,
      transitionToReview: null,
      markSliceComplete: null,
      validateRecord: ({ record: currentRecord, wkTip: currentTip, finalSlice }) => {
        const currentSlice = currentRecord.slices.find((entry) => entry?.id === slice.match[3]);
        if (currentSlice?.status !== "review" || !isParentPreterminal(currentRecord.status)) {
          zeroDeltaLifecycleRefusal(
            SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_LIFECYCLE_CONTRADICTION,
            "zero-delta record CAS source state changed incompatibly",
            { subject, reason: "record_cas_source_inadmissible" }
          );
        }
        const liveEvidenceSet = resolveZeroDeltaIntegrationEvidence({
          runGit,
          mainRepo,
          wkTip: currentTip,
          subject,
          deliverySha: evidence.delivery_sha,
          baseSha: evidence.base_sha
        });
        if (liveEvidenceSet.count > 1) {
          zeroDeltaLifecycleRefusal(
            SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_AMBIGUOUS,
            "multiple exact zero-delta integration evidence commits are reachable from the live WK tip",
            { subject, reason: "live_evidence_ambiguous", match_count: liveEvidenceSet.count }
          );
        }
        const liveEvidence = liveEvidenceSet.match;
        if (liveEvidenceSet.count !== 1 ||
            liveEvidence.evidence_sha !== evidence.evidence_sha ||
            liveEvidence.delivery_sha !== evidence.delivery_sha ||
            liveEvidence.base_sha !== evidence.base_sha ||
            liveEvidence.wk_parent_sha !== evidence.wk_parent_sha ||
            liveEvidence.tree !== evidence.tree) {
          zeroDeltaLifecycleRefusal(
            SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_LIFECYCLE_CONTRADICTION,
            "the live WK tip does not retain the exact authenticated zero-delta evidence",
            { subject, reason: "live_evidence_mismatch" }
          );
        }
        if (finalSlice && currentTip !== evidence.evidence_sha) {
          zeroDeltaLifecycleRefusal(
            SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_LIFECYCLE_CONTRADICTION,
            "historical zero-delta evidence cannot own the final parent transition",
            { subject, reason: "historical_evidence_cannot_finalize" }
          );
        }
      }
    });
    return recoveredZeroDeltaResult({
      slice,
      wk,
      evidence,
      wkTip: write.wkTip,
      reviewTarget: write.reviewTarget,
      transition: Object.freeze({ ...write.transition, recovered: true }),
      integratedState: write.finalSlice ? "final" : "non_final"
    });
  }
  if (sliceStatus !== "done") {
    zeroDeltaLifecycleRefusal(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_LIFECYCLE_CONTRADICTION,
      "durable zero-delta evidence is incompatible with slice lifecycle status",
      { subject, reason: "evidence_status_inadmissible", slice_status: sliceStatus, parent_status: parentStatus }
    );
  }

  const finalSlice = isLastIncompleteImplementationSlice(
    record,
    slice.match[3],
    runGit,
    mainRepo,
    wkTip,
    slice.match[2],
    { fixedForkSha: fixedFork.sha }
  );
  if (isParentPreterminal(parentStatus) && finalSlice) {
    zeroDeltaLifecycleRefusal(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_LIFECYCLE_CONTRADICTION,
      "done zero-delta slice leaves a contradictory preterminal parent",
      { subject, reason: "done_slice_preterminal_parent_without_remaining_implementation" }
    );
  }
  const reviewTarget = parentStatus === "review" && evidenceAtCurrentTip
    ? buildCompleteWkReviewTarget({
        runGit,
        mainRepo,
        initiative: slice.match[1],
        wkId: slice.match[2],
        wkRef: wk.ref,
        wkTip
      })
    : null;
  const integratedState = parentStatus === "done" ||
      (parentStatus === "review" && evidenceAtCurrentTip)
    ? "final"
    : "non_final";
  return recoveredZeroDeltaResult({
    slice,
    wk,
    evidence,
    wkTip,
    reviewTarget,
    transition: Object.freeze({
      valid: true,
      written: false,
      no_op: true,
      status: integratedState === "final" && parentStatus === "review" ? "review" : "done",
      recovered: true
    }),
    integratedState
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

    const retained = resolveSliceMarkerEvidence(
      runGit,
      mainRepo,
      sliceTip,
      slice.match[2],
      slice.match[3]
    );
    if (retained.state !== SLICE_MARKER_EVIDENCE_STATES.FOUND ||
        !retained.candidates.includes(sliceTip)) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
        "integrated slice marker does not match the retained slice delivery", {
          slice_ref: slice.ref,
          slice_tip: sliceTip,
          marker_sha: markerSha,

          retained_marker_state: retained.state,
          retained_marker_reason: retained.reason,
          retained_marker_candidate_count: retained.candidates.length
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
