

import { AGENT_DISPATCH_SUBJECT_KIND_INITIATIVE } from
  "../dispatch-tool-constants.mjs";
import {
  nextActionForControlledAcceptanceRecovery,
  nextActionForDecisionCode,
  nextActionForFreeLocalDecisionCode
} from "../work-record-write-route-helpers.mjs";
import { graphDerivationRequiredForDispatch } from "./dispatch-admission-policy.mjs";
import { refuseFindingsOnlyAdmission } from "./findings-only-admission.mjs";
import { MISSING_INITIATIVE_REF_NAMESPACE_DECISION_CODE } from
  "@agent-chassis/wiki-core/src/lib/work-record-dispatch.mjs";
import {
  boundedRecoveryDetail,
  authoredReadinessGuidance,
  missingInitiativeAuthoring,
  namedAuthoredReadinessClassification
} from "./agent-dispatch-refusal-projection.mjs";
import { orchestrateWorkerReadiness } from "./agent-dispatch-worker-readiness.mjs";

const DECISIONS_WRITE_SCOPE_FORBIDDEN_DECISION_CODE =
  "decisions_write_scope_forbidden";

export async function orchestrateAgentDispatchReadiness({
  args,
  subjectKind,
  workspace,
  dispatchBackend,
  launcherConfirmedNoCceAuthority,
  isPaidTier,
  validateDispatch,
  validateLaunchIntent,
  revalidatePrivateHandoff,
  refreshAdmissionEvidence,
  loadReviewerSubjectAdmissionContext,
  buildTransitionRefusal,
  readinessFailure,
  launcherTransitionFailures,
  jsonContent,
  requestSchemaAuthority = null,
  requestContracts = null
}) {
  const readinessDispatchRole = args.role === "worker" ? "implementation" : "read_only";
  let readiness = null;
  const refuse = (input) => jsonContent(buildTransitionRefusal({
    readinessSource: readiness,
    ...input
  }));

  if (subjectKind !== AGENT_DISPATCH_SUBJECT_KIND_INITIATIVE) {
    readiness = await validateDispatch({
      dir: workspace.dir,
      unitAddress: args.subject,
      dispatch_role: readinessDispatchRole,
      mode: "strict",
      suppress_live_graph_resolution: args.role === "worker"
    });

    if (readiness?.decision_code === DECISIONS_WRITE_SCOPE_FORBIDDEN_DECISION_CODE) {
      const classification = namedAuthoredReadinessClassification(readiness, {
        check: DECISIONS_WRITE_SCOPE_FORBIDDEN_DECISION_CODE,
        status: "forbidden",
        path: "write_scope"
      });
      return {
        response: refuse({
          failure: readinessFailure(readiness),
          blockerCode: classification.code,
          reason: DECISIONS_WRITE_SCOPE_FORBIDDEN_DECISION_CODE,
          detail: boundedRecoveryDetail(readiness, { readiness_reasons: readiness.reasons ?? [] })
        }),
        readiness
      };
    }

    if (args.role === "worker") {
      if (!graphDerivationRequiredForDispatch(readiness.recovery?.graph_impact) &&
          !readiness.dispatchable) {
        const classification = namedAuthoredReadinessClassification(readiness);
        const readinessDecisionCode = readiness.decision_code;
        const controlledAcceptanceBlocked = [
          "controlled_acceptance_disposition_missing",
          "controlled_acceptance_incomplete",
          "controlled_acceptance_proof_posture_invalid"
        ].includes(readinessDecisionCode);
        const fallbackNextAction = isPaidTier
          ? nextActionForDecisionCode(
              readinessDecisionCode,
              readiness.dispatch_role ?? readinessDispatchRole,
              false,
              readiness.admissibility ?? null
            )
          : nextActionForFreeLocalDecisionCode(
              readinessDecisionCode,
              readiness.dispatch_role ?? readinessDispatchRole,
              false
            );
        const nextAction = readiness.controlled_acceptance_failure?.explanation ?? nextActionForControlledAcceptanceRecovery(
          readiness, fallbackNextAction);
        const initiativeAuthoring = readinessDecisionCode === MISSING_INITIATIVE_REF_NAMESPACE_DECISION_CODE
          ? missingInitiativeAuthoring(readiness) : null;
        const guidance = await authoredReadinessGuidance({ subject: initiativeAuthoring?.unit ?? args.subject,
          readiness, code: classification.code, requestSchemaAuthority, requestContracts,
          initiative: initiativeAuthoring });
        return {
          response: refuse({
            failure: readinessFailure(readiness),
            blockerCode: classification.code,
            reason: "work_record_not_dispatchable",
            detail: boundedRecoveryDetail(readiness, {
              readiness_reasons: readiness.reasons ?? [],
              ...(initiativeAuthoring === null ? {} : { initiative_authoring: initiativeAuthoring }),
              ...(guidance.limitation === undefined ? {} : {
                readiness_guidance_limitation: guidance.limitation
              }),
              ...(isPaidTier && Array.isArray(readiness.validation_hints) &&
              readiness.validation_hints.length > 0
                ? { readiness_validation_hints: readiness.validation_hints }
                : {})
            }),
            nextAction,
            decidingFacts: [
              { field: "wk.dispatchable", value: false },
              { field: "wk.decision_code", value: readiness.decision_code ?? null }
            ],
            observedFacts: {
              "wk.dispatchable": false,
              "wk.decision_code": readiness.decision_code ?? null
            },
            carried: controlledAcceptanceBlocked ? {
              controlled_acceptance_recovery: readiness.controlled_acceptance_recovery
            } : null,
            refusal: guidance.refusal ?? null
          }),
          readiness
        };
      }
      const workerResult = await orchestrateWorkerReadiness({
        args,
        workspace,
        readiness,
        readinessDispatchRole,
        launcherConfirmedNoCceAuthority,
        validateDispatch,
        validateLaunchIntent,
        revalidatePrivateHandoff,
        refreshAdmissionEvidence,
        buildTransitionRefusal,
        readinessFailure,
        jsonContent
      });
      readiness = workerResult.readiness;
      if (workerResult.response) return workerResult;
    }

    if (!readiness.dispatchable) {
      const classification = namedAuthoredReadinessClassification(readiness);
      const readinessDecisionCode = readiness.decision_code;
      const fallbackNextAction = isPaidTier
        ? nextActionForDecisionCode(
            readinessDecisionCode,
            readiness.dispatch_role ?? readinessDispatchRole,
            false,
            readiness.admissibility ?? null
          )
        : nextActionForFreeLocalDecisionCode(
            readinessDecisionCode,
            readiness.dispatch_role ?? readinessDispatchRole,
            false
          );
      const nextAction = nextActionForControlledAcceptanceRecovery(
        readiness, fallbackNextAction);
      return {
        response: refuse({
          failure: readinessFailure(readiness),
          blockerCode: classification.code,
          reason: "work_record_not_dispatchable",
          detail: boundedRecoveryDetail(readiness, {
            readiness_reasons: readiness.reasons ?? [],
            ...(isPaidTier && Array.isArray(readiness.validation_hints) &&
            readiness.validation_hints.length > 0
              ? { readiness_validation_hints: readiness.validation_hints }
              : {})
          }),
          nextAction
        }),
        readiness
      };
    }
  }

  const findingsOnlyRefusal = await refuseFindingsOnlyAdmission({
    args,
    subjectKind,
    initiativeSubjectKind: AGENT_DISPATCH_SUBJECT_KIND_INITIATIVE,
    workspace,
    dispatchBackend,
    loadSubject: loadReviewerSubjectAdmissionContext,
    buildBlocked: (input) => buildTransitionRefusal({
      ...input,
      readinessSource: readiness,
      failure: launcherTransitionFailures.FINDINGS_ROUTE_AUTHENTICATION_FAILED
    }),
    jsonContent
  });
  return { response: findingsOnlyRefusal, readiness };
}
