

import {
  classifyMechanicalRuntimeBlocker
} from "./runtime-blocker-classifier.mjs";
import {
  buildDispatchMechanicalRefusal,
  NO_SUPPORTED_ROUTE_RECOVERY
} from "../dispatch-tool-helpers.mjs";

function canonicalRecordPath(subject) {
  const recordId = String(subject ?? "").split("#")[0];
  return `wiki/work-records/${recordId}.json`;
}

function findingsRefusalCarrier({ classification, decidingFacts, observedFacts }) {
  return buildDispatchMechanicalRefusal({
    code: classification.code,
    decidingFacts,
    observedFacts,
    route: "start_agent",
    carried: { mechanical_classification: classification },
    noSupportedRoute: true,
    recovery: NO_SUPPORTED_ROUTE_RECOVERY
  });
}

function classifiedDetail(classification, detail) {
  return {
    ...detail,
    authority_limb: classification.authority_limb,
    cause: classification.cause,
    actor_recovery: classification.actor_recovery,
    ...(classification.named_defect ? { named_defect: classification.named_defect } : {})
  };
}

export async function refuseFindingsOnlyAdmission({
  args, subjectKind, initiativeSubjectKind, workspace, dispatchBackend,
  loadSubject, buildBlocked, jsonContent
}) {
  if ((args.role !== "reviewer" && args.role !== "redteam") || subjectKind === initiativeSubjectKind) return null;
  const subject = await loadSubject({ dir: workspace.dir, unitAddress: args.subject });
  if (subject == null) {

    const classification = classifyMechanicalRuntimeBlocker({
      producer: "authored_readiness",
      condition: "named_contract_defect",
      named_defect: {
        check: args.role === "reviewer" ? "reviewer_subject_resolution" : "redteam_subject_resolution",
        status: "unresolved",
        path: canonicalRecordPath(args.subject)
      },
      detail: { subject: args.subject, role: args.role }
    });
    const observedFacts = {
      "findings_unit.resolved": false,
      "findings_unit.write_scope_size": null
    };
    return jsonContent(buildBlocked({
      blockerCode: classification.code,
      reason: args.role === "reviewer" ? "reviewer_subject_unreadable" : "redteam_subject_unreadable",
      detail: classifiedDetail(classification, { subject: args.subject }),

      refusal: findingsRefusalCarrier({
        classification,
        decidingFacts: [
          { field: "findings_unit.resolved", value: false },
          { field: "findings_unit.address", value: args.subject }
        ],
        observedFacts: { ...observedFacts, "findings_unit.address": args.subject }
      })
    }));
  }
  if (subject.write_scope.length === 0) {

    return null;
  }

  return null;
}
