

import { defaultRunGitAsync } from "./worktree-substrate.mjs";
import {
  computeWorkRecordSourceDigest
} from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";
import {
  withControlledContractAuthorityExclusion
} from "@agent-chassis/wiki-core/src/lib/controlled-contract-carrier-set-publication.mjs";

import {
  SLICE_INTEGRATION_SCHEMA_VERSION,
  SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
  SLICE_INTEGRATION_POLICY_POSTURES,
  SLICE_INTEGRATION_DIAGNOSTIC_CODES,
  SLICE_REF_RE,
  WK_REF_RE,
  SliceIntegrationError,
  fail,
  assertOid,
  normalizeRef,
  revParse,
  assertExactWorktreeBinding,
  assertWkLifecycleObservationCurrent,
  parseCanonicalRecord,
  resolveSliceMarkerCommit,
  resolveSliceMarkerEvidence,
  SLICE_MARKER_EVIDENCE_STATES,
  buildCompleteWkReviewTarget,
  resolveTree,
  resolveAuthenticatedExactSliceDeliveryBase,
  isLastIncompleteImplementationSlice,
  boundedWkLifecycleObservation,
  resolveZeroDeltaIntegrationEvidenceFromObservation
} from "./slice-integration-authorization.mjs";

import {
  advanceSliceRefCas,
  driveRecordCasWrite,
  resolveExactDeliveryMarkerFromObservation
} from "./slice-integration-delivery.mjs";
import { captureDiagnosticEvidence } from "./diagnostic-evidence.mjs";

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

async function assertBoundaryObjectStoreProbes(runGit, mainRepo, target) {
  const probes = [
    { name: "slice_ref_resolves_to_reviewed_sha", rev: `${target.slice_ref}^{commit}`, expect: target.reviewed_sha },
    { name: "reviewed_commit_object_present", rev: `${target.reviewed_sha}^{commit}`, expect: target.reviewed_sha },
    { name: "slice_diff_base_object_present", rev: `${target.diff_base_sha}^{commit}`, expect: target.diff_base_sha }
  ];
  for (const probe of probes) {
    const result = await runGit({ repo: mainRepo, args: ["rev-parse", "--verify", probe.rev] });
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

async function assertSliceIntegrationBoundaryAuthorization({
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
  const currentSliceSha = await revParse(runGit, mainRepo, sliceRef);
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
  await assertBoundaryObjectStoreProbes(runGit, mainRepo, target);
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
  const runGit = deps.runGit ?? defaultRunGitAsync;
  const resolveCapturedBase = deps.resolveCapturedWkBase;
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
  return withControlledContractAuthorityExclusion({
    repoRoot: mainRepo,
    wkId: slice.match[2],
    run: async () => {
  const initialWkTip = await revParse(runGit, mainRepo, wk.ref);

  if (!coordinatorContinuation) {
    await assertExactWorktreeBinding(runGit, worktreePath, slice.ref, commit);
  }
  const loadRecord = deps.loadCanonicalRecord ?? parseCanonicalRecord;
  const initialRecord = loadRecord(mainRepo, slice.match[2]);
  const initialRecordDigest = computeWorkRecordSourceDigest(initialRecord);

  const appliedBoundaryAuthorization = await assertSliceIntegrationBoundaryAuthorization({
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

  const advance = await advanceSliceRefCas({
    runGit,
    runGitRefTransaction: deps.runGitRefTransaction,
    mainRepo,
    sliceRef: slice.ref,
    wkRef: wk.ref,
    wkId: slice.match[2],
    sliceId: slice.match[3],
    baseSha,
    commit,
    expectedWkTip: initialWkTip,
    initiative: slice.match[1],
    recordSourceDigest: initialRecordDigest,
    readRecordSourceDigest: () => computeWorkRecordSourceDigest(
      loadRecord(mainRepo, slice.match[2])
    )
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
  const observedPostHelperWkTip = await revParse(runGit, mainRepo, wk.ref);
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

  const integratedFact = {
    schema_version: SLICE_INTEGRATION_SCHEMA_VERSION,
    integrated: true,
    rebased,
    previous_wk_sha: wkOld,
    slice_ref: slice.ref,
    slice_sha: integratedCommit,
    delivery_sha: advance.deliveryCommit,
    wk_ref: wk.ref,
    wk_sha: expectedPostHelperWkTip,
    empty_delivery: advance.empty_delivery,
    boundary_authorization: appliedBoundaryAuthorization
  };
  let write;
  try {
    write = await driveRecordCasWrite({
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
      integratedCommit,
      resolveCapturedBase,
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
  } catch (error) {

    let retained = false;
    try {
      const liveTip = await revParse(runGit, mainRepo, wk.ref);
      const ancestry = await runGit({
        repo: mainRepo,
        args: ["merge-base", "--is-ancestor", integratedCommit, liveTip]
      });
      retained = ancestry?.ok === true;
    } catch {
      retained = false;
    }
    if (!retained) throw error;
    return outstandingIntegration(integratedFact, outstandingRecordReconciliation(error));
  }

  return Object.freeze({
    ...integratedFact,
    wk_sha: write.wkTip,

    review_target: write.reviewTarget,
    transition: write.transition,

    integrated_state: write.finalSlice && integratedCommit === write.wkTip
      ? "final"
      : "non_final"
  });
    }
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

async function authenticateExactDirectCommitRef(runGit, mainRepo, requestedRef, targetKind) {
  let result;
  try {
    result = await runGit({
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

export const INTEGRATED_RECORD_RECONCILIATION_STATES = Object.freeze({
  PENDING: "pending",
  RECONCILED: "reconciled",
  BLOCKED: "blocked"
});

const RECONCILED_RECORD = Object.freeze({
  state: INTEGRATED_RECORD_RECONCILIATION_STATES.RECONCILED
});

const RECORD_RECONCILIATION_REFUSAL_CODES = new Set([
  SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_LIFECYCLE_CONTRADICTION,
  SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
  SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT
]);

function lifecycleContradiction(code, message, detail) {
  return new SliceIntegrationError(`agent-launch slice-integration: ${message}`, { code, detail });
}

function withRecordReconciliation(result, recordReconciliation) {
  return Object.freeze({ ...result, record_reconciliation: recordReconciliation });
}

export function outstandingRecordReconciliation(error, { state = null, reason = null } = {}) {
  const refused = error?.refusal !== undefined ||
    RECORD_RECONCILIATION_REFUSAL_CODES.has(error?.code);
  return Object.freeze({
    state: state ?? (refused
      ? INTEGRATED_RECORD_RECONCILIATION_STATES.BLOCKED
      : INTEGRATED_RECORD_RECONCILIATION_STATES.PENDING),
    reason: reason ?? (typeof error?.detail?.reason === "string"
      ? error.detail.reason
      : refused ? "record_reconciliation_refused" : "record_write_not_confirmed"),
    code: typeof error?.code === "string" ? error.code : null,
    ...(error?.refusal === undefined ? {} : { refusal: error.refusal }),
    evidence: captureDiagnosticEvidence(error)
  });
}

function outstandingIntegration(result, recordReconciliation) {
  return Object.freeze({
    ...result,
    review_target: null,
    transition: null,
    integrated_state: null,
    record_reconciliation: recordReconciliation
  });
}

function normalizeIntegrationTarget({ unitAddress, sliceRef, wkRef }) {
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
  return { slice, wk, subject: `${slice.match[2]}#${slice.match[3]}` };
}

async function classifyZeroDeltaIntegration({ runGit, mainRepo, slice, wk, subject, loadRecord,
  freshAdmission, resolveCapturedBase }) {
  const sliceTip = await authenticateExactDirectCommitRef(runGit, mainRepo, slice.ref, "slice");
  const wkTip = await authenticateExactDirectCommitRef(runGit, mainRepo, wk.ref, "wk");
  const record = loadRecord(mainRepo, slice.match[2]);
  const recordSourceDigest = computeWorkRecordSourceDigest(record);
  let recoveryObservation;
  let evidenceSet;
  try {
    recoveryObservation = await boundedWkLifecycleObservation({
      runGit,
      mainRepo,
      initiative: slice.match[1],
      wkId: slice.match[2],
      wkTipSha: wkTip,
      recordSourceDigest
    });
    evidenceSet = await resolveZeroDeltaIntegrationEvidenceFromObservation({
      runGit,
      mainRepo,
      observation: recoveryObservation,
      subject,
      deliverySha: sliceTip
    });
  } catch (error) {
    zeroDeltaLifecycleRefusal(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_INDETERMINATE,
      "zero-delta recovery history is indeterminate",
      { subject, reason: error?.detail?.reason ?? "history_observation_indeterminate" }
    );
  }
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
    if (!freshAdmission) return null;

    const directBase = await resolveAuthenticatedExactSliceDeliveryBase({
      runGit,
      mainRepo,
      subject,
      deliverySha: sliceTip
    });
    const genuineZeroDelta = directBase !== null &&
      await resolveTree(runGit, mainRepo, directBase) === await resolveTree(runGit, mainRepo, sliceTip);
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
  const integrated = recoveredZeroDeltaResult({
    slice, wk, evidence, wkTip, reviewTarget: null, transition: null, integratedState: null
  });
  const outstanding = (state, reason, refusal = null) => ({
    state,
    evidence,
    integration: outstandingIntegration(integrated, Object.freeze({
      state,
      reason,
      slice_status: sliceStatus,
      parent_status: parentStatus,
      ...(refusal === null ? {} : {
        code: refusal.code,
        evidence: captureDiagnosticEvidence(refusal)
      })
    })),
    refusal
  });
  const blocked = (code, message, reason) => outstanding(
    INTEGRATED_RECORD_RECONCILIATION_STATES.BLOCKED,
    reason,
    lifecycleContradiction(code, message, {
      subject, reason, slice_status: sliceStatus, parent_status: parentStatus
    })
  );
  const evidenceAtCurrentTip = evidence.evidence_sha === wkTip;
  const parentTerminal = parentStatus === "review" || parentStatus === "done";
  if (sliceStatus !== "done" && parentTerminal) {
    return blocked(SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_LIFECYCLE_CONTRADICTION,
      "non-done slice contradicts terminal parent after zero-delta integration",
      "non_done_slice_with_terminal_parent");
  }
  if (sliceStatus === "review" && isParentPreterminal(parentStatus)) {
    return outstanding(INTEGRATED_RECORD_RECONCILIATION_STATES.PENDING,
      "canonical_record_not_reconciled");
  }
  if (sliceStatus !== "done") {
    return blocked(SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_LIFECYCLE_CONTRADICTION,
      "durable zero-delta evidence is incompatible with slice lifecycle status",
      "evidence_status_inadmissible");
  }

  const finalSlice = await isLastIncompleteImplementationSlice(
    record,
    slice.match[3],
    runGit,
    mainRepo,
    wkTip,
    slice.match[2],
    { observation: recoveryObservation, recordSourceDigest }
  );
  if (isParentPreterminal(parentStatus) && finalSlice) {
    return blocked(SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_LIFECYCLE_CONTRADICTION,
      "done zero-delta slice leaves a contradictory preterminal parent",
      "done_slice_preterminal_parent_without_remaining_implementation");
  }
  const reviewTarget = parentStatus === "review" && evidenceAtCurrentTip
    ? await buildCompleteWkReviewTarget({
        runGit,
        mainRepo,
        initiative: slice.match[1],
        wkId: slice.match[2],
        wkRef: wk.ref,
        wkTip,
        resolveCapturedBase
      })
    : null;
  const integratedState = parentStatus === "done" ||
      (parentStatus === "review" && evidenceAtCurrentTip)
    ? "final"
    : "non_final";
  return {
    state: INTEGRATED_RECORD_RECONCILIATION_STATES.RECONCILED,
    evidence,
    integration: recoveredZeroDeltaResult({
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
    }),
    refusal: null
  };
}

function zeroDeltaRecordRepairValidator({ runGit, mainRepo, slice, subject, evidence }) {
  return async ({ record: currentRecord, wkTip: currentTip, finalSlice, observation }) => {
    const currentSlice = currentRecord.slices.find((entry) => entry?.id === slice.match[3]);
    if (currentSlice?.status !== "review" || !isParentPreterminal(currentRecord.status)) {
      zeroDeltaLifecycleRefusal(
        SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_LIFECYCLE_CONTRADICTION,
        "zero-delta record CAS source state changed incompatibly",
        { subject, reason: "record_cas_source_inadmissible" }
      );
    }
    const liveEvidenceSet = await resolveZeroDeltaIntegrationEvidenceFromObservation({
      runGit,
      mainRepo,
      observation,
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
  };
}

function ordinaryRecordRepairValidator({ runGit, mainRepo, slice, subject, markerSha, deliverySha }) {
  return async ({ record: currentRecord, wkTip: currentTip, finalSlice, observation }) => {
    const currentSlice = currentRecord.slices.find((entry) => entry?.id === slice.match[3]);
    if (!currentSlice || currentSlice.status === "cancelled" ||
        (currentSlice.status !== "done" && !isParentPreterminal(currentRecord.status))) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
        "integrated slice record CAS source state changed incompatibly",
        { subject, reason: "record_cas_source_inadmissible", slice_status: currentSlice?.status ?? null,
          parent_status: currentRecord.status ?? null });
    }
    const liveMarker = await resolveExactDeliveryMarkerFromObservation({
      runGit,
      mainRepo,
      observation,
      wkId: slice.match[2],
      sliceId: slice.match[3],
      commit: deliverySha
    });
    const liveSliceTip = await revParse(runGit, mainRepo, slice.ref);
    if (liveMarker !== markerSha || liveSliceTip !== deliverySha) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
        "the live WK tip does not retain the exact authenticated delivery marker",
        { subject, reason: "live_marker_mismatch", marker_sha: markerSha, live_marker_sha: liveMarker,
          delivery_sha: deliverySha, live_slice_tip: liveSliceTip });
    }
    if (finalSlice && currentTip !== markerSha) {
      fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT,
        "a historical delivery marker cannot own the final parent transition",
        { subject, reason: "historical_marker_cannot_finalize", marker_sha: markerSha,
          wk_sha: currentTip });
    }
  };
}

function mapZeroDeltaRepairError(error, subject, slice) {
  const fixedForkRef = `refs/agent-launch/wk-forks/${slice.match[1]}/${slice.match[2]}`;
  const fixedForkResolutionFailure = error?.detail?.fork_ref === fixedForkRef &&
    (error?.code === SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH ||
      error?.code === SLICE_INTEGRATION_DIAGNOSTIC_CODES.GIT_FAILED);
  if (error?.detail?.history_observation === true || fixedForkResolutionFailure) {
    return lifecycleContradiction(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_INDETERMINATE,
      "zero-delta live recovery history is indeterminate",
      { subject, reason: error.detail.reason ?? "history_observation_indeterminate" }
    );
  }
  return error;
}

async function driveIntegratedRecordRepair({ runGit, mainRepo, slice, wk, subject, loadRecord,
  writeRecordCas, integration, evidence = null, resolveCapturedBase }) {
  try {
    return await driveRecordCasWrite({
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
      integratedCommit: integration.slice_sha,
      resolveCapturedBase,
      validateRecord: integration.empty_delivery === true
        ? zeroDeltaRecordRepairValidator({ runGit, mainRepo, slice, subject, evidence })
        : ordinaryRecordRepairValidator({
            runGit,
            mainRepo,
            slice,
            subject,
            markerSha: integration.slice_sha,
            deliverySha: integration.delivery_sha
          })
    });
  } catch (error) {
    throw integration.empty_delivery === true ? mapZeroDeltaRepairError(error, subject, slice) : error;
  }
}

export async function recoverZeroDeltaIntegratedSlice({
  mainRepo,
  unitAddress,
  sliceRef,
  wkRef,
  writeRecordCas = null,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGitAsync;
  const { slice, wk, subject } = normalizeIntegrationTarget({ unitAddress, sliceRef, wkRef });
  const loadRecord = deps.loadCanonicalRecord ?? parseCanonicalRecord;
  const resolveCapturedBase = deps.resolveCapturedWkBase;
  const classified = await classifyZeroDeltaIntegration({
    runGit, mainRepo, slice, wk, subject, loadRecord, freshAdmission: true, resolveCapturedBase
  });
  if (classified === null) return null;
  if (classified.state === INTEGRATED_RECORD_RECONCILIATION_STATES.BLOCKED) {
    throw classified.refusal;
  }
  if (classified.state === INTEGRATED_RECORD_RECONCILIATION_STATES.RECONCILED) {
    return classified.integration;
  }
  const write = await driveIntegratedRecordRepair({
    runGit, mainRepo, slice, wk, subject, loadRecord, writeRecordCas,
    integration: classified.integration, evidence: classified.evidence, resolveCapturedBase
  });
  return recoveredZeroDeltaResult({
    slice,
    wk,
    evidence: classified.evidence,
    wkTip: write.wkTip,
    reviewTarget: write.reviewTarget,
    transition: Object.freeze({ ...write.transition, recovered: true }),
    integratedState: write.finalSlice ? "final" : "non_final"
  });
}

async function reconciledOrdinaryResult({ runGit, mainRepo, slice, wk, markerSha, sliceTip, wkTip,
  record, resolveCapturedBase }) {
  const wkInReview = record?.status === "review";
  const wkInTerminalRecoveryPosture = wkInReview || record?.status === "done";
  const ownsCurrentWkTip = markerSha === wkTip;
  const reviewTarget = wkInReview && ownsCurrentWkTip
    ? await buildCompleteWkReviewTarget({
        runGit, mainRepo, initiative: slice.match[1], wkId: slice.match[2], wkRef: wk.ref, wkTip,
        resolveCapturedBase
      })
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

function recordReflectsIntegration(record, sliceId) {
  const sliceEntry = Array.isArray(record?.slices)
    ? record.slices.find((entry) => entry?.id === sliceId)
    : null;
  const sliceComplete = sliceEntry ? (sliceEntry.status === "done" || sliceEntry.status === "cancelled") : false;
  return sliceComplete || record?.status === "review" || record?.status === "done";
}

export async function reconcileIntegratedSliceRecord({
  mainRepo,
  unitAddress,
  sliceRef,
  wkRef,
  baseSha = null,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGitAsync;
  const { slice, wk } = normalizeIntegrationTarget({ unitAddress, sliceRef, wkRef });
  const wkTip = await revParse(runGit, mainRepo, wk.ref);
  const markerSha = await resolveSliceMarkerCommit(runGit, mainRepo, wkTip, slice.match[2], slice.match[3]);
  const loadRecord = deps.loadCanonicalRecord ?? parseCanonicalRecord;
  const record = loadRecord(mainRepo, slice.match[2]);
  if (markerSha === null) {

    return null;
  }
  const sliceTip = await revParse(runGit, mainRepo, slice.ref);
  if (sliceTip !== markerSha) {

    const retained = await resolveSliceMarkerEvidence(
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

  if (!recordReflectsIntegration(record, slice.match[3])) return null;

  return reconciledOrdinaryResult({
    runGit, mainRepo, slice, wk, markerSha, sliceTip, wkTip, record,
    resolveCapturedBase: deps.resolveCapturedWkBase
  });
}

async function classifyOrdinaryIntegration({ runGit, mainRepo, slice, wk, subject, loadRecord,
  resolveCapturedBase }) {
  const wkTip = await authenticateExactDirectCommitRef(runGit, mainRepo, wk.ref, "wk");
  const sliceTip = await authenticateExactDirectCommitRef(runGit, mainRepo, slice.ref, "slice");
  const record = loadRecord(mainRepo, slice.match[2]);
  const recordSourceDigest = computeWorkRecordSourceDigest(record);
  let observation;
  try {
    observation = await boundedWkLifecycleObservation({
      runGit,
      mainRepo,
      initiative: slice.match[1],
      wkId: slice.match[2],
      wkTipSha: wkTip,
      recordSourceDigest
    });
  } catch (error) {
    fail(
      SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_INDETERMINATE,
      "same-slice bounded history could not be authenticated",
      { subject, reason: error?.detail?.reason ?? "history_observation_indeterminate" },
      error
    );
  }
  const markerSha = await resolveExactDeliveryMarkerFromObservation({
    runGit,
    mainRepo,
    observation,
    wkId: slice.match[2],
    sliceId: slice.match[3],
    commit: sliceTip
  });
  if (markerSha === null) return null;
  const current = await assertWkLifecycleObservationCurrent({
    observation,
    runGit,
    mainRepo,
    wkTipSha: await revParse(runGit, mainRepo, wk.ref),
    recordSourceDigest: computeWorkRecordSourceDigest(loadRecord(mainRepo, slice.match[2]))
  });
  if (current.current !== true) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.WK_ADVANCE_CONFLICT,
      "WK observation moved during integrated-delivery classification",
      { subject, reason: current.reason ?? "observation_not_current", wk_sha: wkTip });
  }
  const sliceEntry = record?.slices?.find((entry) => entry?.id === slice.match[3]) ?? null;
  if (sliceEntry === null) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
      "canonical integration slice is absent", { subject });
  }
  const reconciled = await reconciledOrdinaryResult({
    runGit, mainRepo, slice, wk, markerSha, sliceTip, wkTip, record, resolveCapturedBase
  });
  if (recordReflectsIntegration(record, slice.match[3])) {
    return withRecordReconciliation(reconciled, RECONCILED_RECORD);
  }
  return outstandingIntegration(reconciled, Object.freeze({
    state: INTEGRATED_RECORD_RECONCILIATION_STATES.PENDING,
    reason: "canonical_record_not_reconciled",
    slice_status: sliceEntry.status ?? null,
    parent_status: record.status ?? null
  }));
}

async function isZeroDeltaEvidenceCommit(runGit, mainRepo, oid, subject) {
  const result = await runGit({
    repo: mainRepo,
    args: ["--no-replace-objects", "show", "-s", "--format=%s", oid]
  });
  if (result?.ok !== true) {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_EVIDENCE_INDETERMINATE,
      "integrated marker commit could not be classified", { subject, marker_sha: oid });
  }
  return String(result.stdout ?? "").trim() ===
    `agent-launch zero-delta integration evidence: ${subject}`;
}

export async function observeIntegratedSliceDelivery({
  mainRepo,
  unitAddress,
  sliceRef,
  wkRef,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGitAsync;
  const { slice, wk, subject } = normalizeIntegrationTarget({ unitAddress, sliceRef, wkRef });
  const loadRecord = deps.loadCanonicalRecord ?? parseCanonicalRecord;

  const reconciled = await reconcileIntegratedSliceRecord({
    mainRepo, unitAddress, sliceRef, wkRef, deps: { ...deps, runGit }
  });
  if (reconciled !== null &&
      !await isZeroDeltaEvidenceCommit(runGit, mainRepo, reconciled.slice_sha, subject)) {
    return withRecordReconciliation(reconciled, RECONCILED_RECORD);
  }

  const resolveCapturedBase = deps.resolveCapturedWkBase;
  const zeroDelta = await classifyZeroDeltaIntegration({
    runGit, mainRepo, slice, wk, subject, loadRecord, freshAdmission: true, resolveCapturedBase
  });
  if (zeroDelta !== null) {
    return zeroDelta.state === INTEGRATED_RECORD_RECONCILIATION_STATES.RECONCILED
      ? withRecordReconciliation(zeroDelta.integration, RECONCILED_RECORD)
      : zeroDelta.integration;
  }
  return classifyOrdinaryIntegration({
    runGit, mainRepo, slice, wk, subject, loadRecord, resolveCapturedBase
  });
}

export async function reconcileIntegratedSliceRecordOnly({
  mainRepo,
  unitAddress,
  sliceRef,
  wkRef,
  writeRecordCas,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGitAsync;
  const { slice, wk, subject } = normalizeIntegrationTarget({ unitAddress, sliceRef, wkRef });
  const loadRecord = deps.loadCanonicalRecord ?? parseCanonicalRecord;
  const observe = () => observeIntegratedSliceDelivery({
    mainRepo, unitAddress, sliceRef, wkRef, deps: { ...deps, runGit }
  });
  const observed = await observe();
  if (observed === null ||
      observed.record_reconciliation.state !== INTEGRATED_RECORD_RECONCILIATION_STATES.PENDING) {
    return observed;
  }
  if (typeof writeRecordCas !== "function") {
    fail(SLICE_INTEGRATION_DIAGNOSTIC_CODES.INVALID_ARG,
      "record-only reconciliation requires the validated canonical record writer", { subject });
  }
  let evidence = null;
  if (observed.empty_delivery === true) {
    evidence = (await classifyZeroDeltaIntegration({
      runGit, mainRepo, slice, wk, subject, loadRecord, freshAdmission: false,
      resolveCapturedBase: deps.resolveCapturedWkBase
    }))?.evidence ?? null;
    if (evidence === null || evidence.evidence_sha !== observed.slice_sha) {
      return outstandingIntegration(observed, outstandingRecordReconciliation(
        lifecycleContradiction(SLICE_INTEGRATION_DIAGNOSTIC_CODES.ZERO_DELTA_LIFECYCLE_CONTRADICTION,
          "zero-delta evidence changed before record reconciliation",
          { subject, reason: "evidence_changed_before_record_reconciliation" })));
    }
  }
  let write;
  try {
    write = await driveIntegratedRecordRepair({
      runGit, mainRepo, slice, wk, subject, loadRecord, writeRecordCas,
      integration: observed, evidence, resolveCapturedBase: deps.resolveCapturedWkBase
    });
  } catch (error) {
    return outstandingIntegration(observed, outstandingRecordReconciliation(error));
  }
  let reobserved;
  try {
    reobserved = await observe();
  } catch (error) {
    return outstandingIntegration(observed, outstandingRecordReconciliation(error, {
      state: INTEGRATED_RECORD_RECONCILIATION_STATES.BLOCKED,
      reason: "post_repair_observation_failed"
    }));
  }
  if (reobserved === null || reobserved.slice_sha !== observed.slice_sha ||
      reobserved.delivery_sha !== observed.delivery_sha) {
    return outstandingIntegration(observed, outstandingRecordReconciliation(
      lifecycleContradiction(SLICE_INTEGRATION_DIAGNOSTIC_CODES.BINDING_MISMATCH,
        "the repaired record no longer observes the exact integrated delivery",
        { subject, reason: "post_repair_observation_mismatch" })));
  }
  if (reobserved.record_reconciliation.state !== INTEGRATED_RECORD_RECONCILIATION_STATES.RECONCILED) {
    return reobserved;
  }
  return Object.freeze({
    ...reobserved,
    transition: Object.freeze({ ...write.transition, recovered: true }),
    record_reconciliation: Object.freeze({
      state: INTEGRATED_RECORD_RECONCILIATION_STATES.RECONCILED,
      repaired: true
    })
  });
}
