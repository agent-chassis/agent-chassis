

import { AGENT_DISPATCH_SUBJECT_KIND_INITIATIVE } from
  "../dispatch-tool-constants.mjs";
import {
  WORKSPACE_WORK_RECORD_READY_SLICE_TOOL_NAME
} from "../work-record-write-tools.mjs";
import {
  nextActionForDecisionCode,
  nextActionForFreeLocalDecisionCode
} from "../work-record-write-route-helpers.mjs";
import {
  graphBlockerCodeForReadiness,
  graphDerivationRequiredForDispatch
} from "./dispatch-admission-policy.mjs";
import { refuseFindingsOnlyAdmission } from "./findings-only-admission.mjs";
import {
  boundedRecoveryDetail,
  continuationOrNull,
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
  generateGraphImpactEvidence,
  refreshAdmissionEvidence,
  loadReviewerSubjectAdmissionContext,
  buildTransitionRefusal,
  readinessFailure,
  launcherTransitionFailures,
  jsonContent
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
        const graphCode = graphBlockerCodeForReadiness(readiness);
        const classification = graphCode
          ? null
          : namedAuthoredReadinessClassification(readiness);
        const readinessDecisionCode = readiness.decision_code;
        const nextAction = isPaidTier
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
        return {
          response: refuse({
            failure: readinessFailure(readiness),
            blockerCode: graphCode ?? classification.code,
            reason: graphCode ?? "work_record_not_dispatchable",
            detail: boundedRecoveryDetail(readiness, {
              readiness_reasons: readiness.reasons ?? [],
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
            continuation: graphCode ? null : continuationOrNull({
              tool: WORKSPACE_WORK_RECORD_READY_SLICE_TOOL_NAME,
              arguments: { unit: args.subject },
              predicate: { fact: "wk.dispatchable", operator: "is_true" },
              prerequisite: "the selected unit is not dispatchable under its authored contract",
              successCondition:
                "workspace_agent_dispatch reports the same unit dispatchable once the authored contract is corrected"
            })
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
        generateGraphImpactEvidence,
        refreshAdmissionEvidence,
        buildTransitionRefusal,
        readinessFailure,
        jsonContent
      });
      readiness = workerResult.readiness;
      if (workerResult.response) return workerResult;
    }

    if (!readiness.dispatchable) {
      const graphCode = graphBlockerCodeForReadiness(readiness);
      const classification = graphCode ? null : namedAuthoredReadinessClassification(readiness);
      const readinessDecisionCode = readiness.decision_code;
      const nextAction = isPaidTier
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
      return {
        response: refuse({
          failure: readinessFailure(readiness),
          blockerCode: graphCode ?? classification.code,
          reason: graphCode ?? "work_record_not_dispatchable",
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
