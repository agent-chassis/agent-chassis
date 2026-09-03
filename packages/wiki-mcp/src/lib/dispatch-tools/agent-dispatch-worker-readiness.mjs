

import { RUNTIME_BLOCKER_CODES } from
  "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  EXACT_RETURNED_POLICY_AUTHORITY_LIMB,
  MECHANICAL_FAILURE_AUTHORITY_LIMB,
  classifyMechanicalRuntimeBlocker
} from "./runtime-blocker-classifier.mjs";
import {
  foldLauncherConfirmedNoCceAuthority,
  nodeEngineRefusal
} from "./agent-dispatch-cce-admission.mjs";
import {
  boundedRecoveryDetail,
  evidenceFailureClassification,
  hasValidPrivateHandoff,
  namedAuthoredReadinessClassification,
  strictAdmissionComponentIssue
} from "./agent-dispatch-refusal-projection.mjs";
import {
  graphBlockerCodeForReadiness,
  graphDerivationRequiredForDispatch,
  RECOVERABLE_DISPATCH_STATES
} from "./dispatch-admission-policy.mjs";
import { prepareCommittedHeadGraphAdmission } from "./graph-admission.mjs";

export async function orchestrateWorkerReadiness({
  args,
  workspace,
  readiness: initialReadiness,
  readinessDispatchRole,
  launcherConfirmedNoCceAuthority,
  validateDispatch,
  validateLaunchIntent,
  revalidatePrivateHandoff,
  generateGraphImpactEvidence,
  refreshAdmissionEvidence,
  buildTransitionRefusal,
  readinessFailure,
  jsonContent
}) {
  let readiness = initialReadiness;
  const refuse = (input) => jsonContent(buildTransitionRefusal({
    readinessSource: readiness,
    ...input
  }));

  if (Object.values(readiness.recovery ?? {}).includes("nonrecoverable_integrity_failure")) {
    return {
      response: refuse({
        failure: readinessFailure(readiness),
        blockerCode: RUNTIME_BLOCKER_CODES.WORKER_ADMISSION_CARRIER_INVALID,
        reason: "canonical_carrier_revalidation_failed",
        detail: boundedRecoveryDetail(readiness, {
          issue: "admission_sidecar_integrity_failure"
        })
      }),
      readiness
    };
  }

  const initialNonrecoverableAdmissionState = [
    readiness.recovery?.admission_metrics,
    readiness.recovery?.target_resolution
  ].find((state) => typeof state === "string" && state.startsWith("nonrecoverable_"));
  if (initialNonrecoverableAdmissionState) {
    const classification = evidenceFailureClassification(
      "nonrecoverable",
      initialNonrecoverableAdmissionState
    );
    return {
      response: refuse({
        failure: readinessFailure(readiness),
        blockerCode: classification.code,
        reason: "admission_evidence_nonrecoverable",
        detail: boundedRecoveryDetail(readiness, { issue: initialNonrecoverableAdmissionState })
      }),
      readiness
    };
  }

  const prepared = await prepareCommittedHeadGraphAdmission({
    readiness,
    dir: workspace.dir,
    unitAddress: args.subject,
    readinessDispatchRole,
    graphDerivationRequiredForDispatch,
    generateGraphImpactEvidence,
    validateDispatch,
    boundedRecoveryDetail
  });
  readiness = prepared.readiness;
  if (prepared.refusal) {
    if (typeof prepared.refusal.blocker?.code !== "string") {
      throw new Error("graph admission refusal is missing its classified blocker code");
    }
    return {
      response: refuse({
        failure: readinessFailure(readiness),
        blockerCode: prepared.refusal.blocker.code,
        reason: prepared.refusal.blocker?.reason ?? "work_record_not_dispatchable",
        detail: prepared.refusal.blocker?.detail ?? null,
        nextAction: prepared.refusal.next_action ?? null,
        refusal: prepared.refusal.refusal ?? null
      }),
      readiness
    };
  }
  const recoveredGraphImpact = prepared.recoveredGraphImpact;

  if (Object.values(readiness.recovery ?? {}).includes("nonrecoverable_integrity_failure")) {
    return {
      response: refuse({
        failure: readinessFailure(readiness),
        blockerCode: RUNTIME_BLOCKER_CODES.WORKER_ADMISSION_CARRIER_INVALID,
        reason: "canonical_carrier_revalidation_failed",
        detail: boundedRecoveryDetail(readiness, {
          issue: "admission_sidecar_integrity_failure"
        })
      }),
      readiness
    };
  }
  if (!readiness.dispatchable) {
    const graphCode = graphBlockerCodeForReadiness(readiness);
    const classification = graphCode ? null : namedAuthoredReadinessClassification(readiness);
    return {
      response: refuse({
        failure: readinessFailure(readiness),
        blockerCode: graphCode ?? classification.code,
        reason: graphCode ?? "work_record_not_dispatchable",
        detail: boundedRecoveryDetail(readiness, { readiness_reasons: readiness.reasons ?? [] })
      }),
      readiness
    };
  }

  const admissionStates = [
    readiness.recovery?.admission_metrics,
    readiness.recovery?.target_resolution
  ];
  const nonrecoverableAdmissionState = admissionStates.find((state) =>
    typeof state === "string" && state.startsWith("nonrecoverable_"));
  if (nonrecoverableAdmissionState) {
    const classification = nonrecoverableAdmissionState === "nonrecoverable_integrity_failure"
      ? classifyMechanicalRuntimeBlocker({
          producer: "carrier",
          condition: "integrity_failure",
          detail: { issue: nonrecoverableAdmissionState }
        })
      : evidenceFailureClassification("nonrecoverable", nonrecoverableAdmissionState);
    return {
      response: refuse({
        failure: readinessFailure(readiness),
        blockerCode: classification.code,
        reason: nonrecoverableAdmissionState === "nonrecoverable_integrity_failure"
          ? "canonical_carrier_revalidation_failed"
          : "admission_evidence_nonrecoverable",
        detail: boundedRecoveryDetail(readiness, { issue: nonrecoverableAdmissionState })
      }),
      readiness
    };
  }

  const admissionRecoverable =
    RECOVERABLE_DISPATCH_STATES.has(readiness.recovery?.admission_metrics) ||
    RECOVERABLE_DISPATCH_STATES.has(readiness.recovery?.target_resolution);
  if (admissionRecoverable) {
    let refreshed;
    try {
      refreshed = await refreshAdmissionEvidence({
        dir: workspace.dir,
        id: args.subject,
        unitAddress: args.subject
      });
    } catch (error) {
      const integrityFailure = typeof error?.code === "string" && error.code.startsWith("sidecar_");
      const classification = integrityFailure
        ? classifyMechanicalRuntimeBlocker({
            producer: "carrier",
            condition: "integrity_failure",
            detail: { issue: error?.code ?? "admission_refresh_failed" }
          })
        : evidenceFailureClassification("refresh_failed", error?.code ?? "admission_refresh_failed");
      return {
        response: refuse({
          failure: readinessFailure(readiness),
          blockerCode: classification.code,
          reason: integrityFailure
            ? "canonical_carrier_revalidation_failed"
            : "admission_evidence_recovery_failed",
          detail: boundedRecoveryDetail(readiness, {
            issue: error?.code ?? "admission_refresh_failed"
          })
        }),
        readiness
      };
    }
    if (refreshed?.written !== true) {
      const classification = evidenceFailureClassification(
        "refresh_not_written",
        refreshed?.diagnostics?.[0]?.code ?? "admission_refresh_not_written"
      );
      return {
        response: refuse({
          failure: readinessFailure(readiness),
          blockerCode: classification.code,
          reason: "admission_evidence_recovery_failed",
          detail: boundedRecoveryDetail(readiness, {
            issue: refreshed?.diagnostics?.[0]?.code ?? "admission_refresh_not_written"
          })
        }),
        readiness
      };
    }
  }

  const launchIntent = await validateLaunchIntent({
    dir: workspace.dir,
    unitAddress: args.subject,
    dispatch_role: readinessDispatchRole,
    mode: "strict",
    graph_impact: recoveredGraphImpact
  });
  readiness = launchIntent.readiness;
  let privateHandoff = launchIntent.private_handoff;
  const preNodeEngineAdmissionIssue = strictAdmissionComponentIssue(readiness);
  if (preNodeEngineAdmissionIssue === "nonrecoverable_integrity_failure") {
    privateHandoff = null;
    return {
      response: refuse({
        failure: readinessFailure(readiness),
        blockerCode: RUNTIME_BLOCKER_CODES.WORKER_ADMISSION_CARRIER_INVALID,
        reason: "canonical_carrier_revalidation_failed",
        detail: boundedRecoveryDetail(readiness, { issue: preNodeEngineAdmissionIssue })
      }),
      readiness
    };
  }
  if (!readiness.dispatchable) {
    const graphCode = graphBlockerCodeForReadiness(readiness);
    const classification = graphCode ? null : namedAuthoredReadinessClassification(readiness);
    return {
      response: refuse({
        failure: readinessFailure(readiness),
        blockerCode: graphCode ?? classification.code,
        reason: graphCode ?? "work_record_not_dispatchable",
        detail: boundedRecoveryDetail(readiness)
      }),
      readiness
    };
  }
  if (!hasValidPrivateHandoff(privateHandoff)) {
    privateHandoff = null;
    return {
      response: refuse({
        failure: readinessFailure(readiness),
        blockerCode: RUNTIME_BLOCKER_CODES.WORKER_ADMISSION_CARRIER_INVALID,
        reason: "canonical_carrier_revalidation_failed",
        detail: { issue: "private_handoff_invalid" }
      }),
      readiness
    };
  }
  if (preNodeEngineAdmissionIssue) {
    const stillRecoverable = RECOVERABLE_DISPATCH_STATES.has(preNodeEngineAdmissionIssue);
    const classification = evidenceFailureClassification(
      stillRecoverable ? "post_refresh_not_fresh" : "nonrecoverable",
      preNodeEngineAdmissionIssue
    );
    privateHandoff = null;
    return {
      response: refuse({
        failure: readinessFailure(readiness),
        blockerCode: classification.code,
        reason: stillRecoverable
          ? "admission_evidence_recovery_failed"
          : "admission_evidence_nonrecoverable",
        detail: boundedRecoveryDetail(readiness, { issue: preNodeEngineAdmissionIssue })
      }),
      readiness
    };
  }

  readiness = await validateDispatch({
    dir: workspace.dir,
    unitAddress: args.subject,
    dispatch_role: readinessDispatchRole,
    mode: "strict",
    node_engine_admissibility: launcherConfirmedNoCceAuthority ? false : true,
    graph_impact: recoveredGraphImpact
  });
  if (launcherConfirmedNoCceAuthority) {
    readiness = foldLauncherConfirmedNoCceAuthority(readiness);
  }
  const neRefusal = nodeEngineRefusal(readiness);
  if (neRefusal) {
    privateHandoff = null;
    if (neRefusal.limb === EXACT_RETURNED_POLICY_AUTHORITY_LIMB) {
      return {
        response: jsonContent({
          ...buildTransitionRefusal({
            readinessSource: readiness,
            failure: readinessFailure(readiness),
            blockerCode: neRefusal.code,
            reason: neRefusal.reason,
            detail: {
              authority_limb: EXACT_RETURNED_POLICY_AUTHORITY_LIMB,
              policy_result: neRefusal.policyResult
            },
            decidingFacts: [
              { field: "cce.authenticated_decision_present", value: true },
              { field: "cce.admissible", value: false }
            ],
            observedFacts: {
              "cce.authenticated_decision_present": true,
              "cce.admissible": false
            },
            carried: { exact_returned_policy: neRefusal.policyResult },
            continuation: null
          }),
          authority_limb: EXACT_RETURNED_POLICY_AUTHORITY_LIMB,
          policy_result: neRefusal.policyResult
        }),
        readiness
      };
    }
    const classification = neRefusal.classification;
    return {
      response: jsonContent({
        ...buildTransitionRefusal({
          readinessSource: readiness,
          failure: readinessFailure(readiness),
          blockerCode: classification.code,
          reason: neRefusal.reason,
          detail: {
            authority_limb: MECHANICAL_FAILURE_AUTHORITY_LIMB,
            cause: classification.cause,
            actor_recovery: classification.actor_recovery,
            ...(classification.detail ?? {})
          }
        }),
        authority_limb: MECHANICAL_FAILURE_AUTHORITY_LIMB
      }),
      readiness
    };
  }

  const finalRevalidation = await revalidatePrivateHandoff({
    dir: workspace.dir,
    unitAddress: args.subject,
    private_handoff: privateHandoff
  });
  privateHandoff = null;
  if (!finalRevalidation.valid) {
    return {
      response: refuse({
        failure: readinessFailure(readiness),
        blockerCode: RUNTIME_BLOCKER_CODES.WORKER_ADMISSION_CARRIER_INVALID,
        reason: finalRevalidation.reason,
        detail: { issue: finalRevalidation.issue }
      }),
      readiness
    };
  }
  return { response: null, readiness };
}
