

import { WK_FORGE_HANDOFF_RESULT_KINDS } from
  "@agent-chassis/agent-launch-cli/src/lib/trusted-operation-contracts.mjs";
import { captureDiagnosticEvidence } from "@agent-chassis/agent-launch-cli/src/lib/diagnostic-evidence.mjs";
import {
  buildDispatchMechanicalRefusal,
  buildDispatchToolExceptionDetail,
  distillDispatchFailureDetail,
  mapBackendRefusalToDispatchCode,
  ownedNoRouteRecovery,
  producerEstablishedRecovery,
  projectDispatchFailureDetail
} from "./dispatch-tool-helpers.mjs";
import { acceptanceValidationDriftGuidance, sectionsDriftGuidance } from
  "./dispatch-tools/forge-handoff-drift-guidance.mjs";
import { buildCheckLandingRequest } from "./dispatch-tools/landing-status-route.mjs";
import { publicationDiagnosisFacts, publicationPreparation, publicationResult } from "./task-publish-work-projection.mjs";
import { activeMcpInlineByteLimit, describeRetentionFailure, jsonContent,
  measureMcpInlineResultBytes } from "./mcp-response.mjs";
import {
  readSelectedResponseFull,
  retainSelectedResponseSource
} from "./selected-response-snapshot.mjs";

export const PUBLISH_WORK_TOOL_NAME = "workspace_publish_work";
export const PUBLISH_WORK_SCHEMA_VERSION = "workspace-publish-work.v1";

function withoutRawCapture(failure) {
  return distillDispatchFailureDetail(failure, { nested: true }).detail;
}

function projectPublicationDiagnosis(detail, env) {
  const projected = projectDispatchFailureDetail(detail, { env, nested: true, operatorLocator: false });
  return publicationDiagnosisFacts(projected);
}

function publicationLanding(subject, selection, requestSchemaAuthority, env) {
  const stop = (reason, facts = {}) => ({ unavailable: { state: "unavailable", reason, ...facts,
    stopping_condition: "Cannot observe this exact publication through this session. Publication remains confirmed; do not republish to recover observation." } });
  if (selection == null) return stop("publication_selection_missing", {
    cause: "The confirmed publication returned no exact landing selection." });
  try {
    const call = buildCheckLandingRequest({ subject, selection }, { requestSchemaAuthority });
    return call.callable === false
      ? stop("landing_observer_unavailable", { selection: call.arguments.selection,
        cause: "This session cannot observe the returned exact publication selection." }) : { call };
  } catch (error) {
    return stop("publication_landing_continuation_invalid", { failed_operation: "build_exact_landing_call",
      cause: projectPublicationDiagnosis({ evidence: captureDiagnosticEvidence(error) }, env) });
  }
}

export function publicationCarrier(subject, outcome, env, requestSchemaAuthority = null) {
  if (outcome.accepted === true) {
    const original = outcome.forge_handoff;
    const result = publicationResult(original, original?.diagnostic == null ? null
      : projectPublicationDiagnosis(original.diagnostic, env));
    const observation = original?.kind === WK_FORGE_HANDOFF_RESULT_KINDS.HANDED_OFF
      ? publicationLanding(subject, outcome.publication_selection, requestSchemaAuthority, env) : {};
    if (observation.call != null && result.next_action?.actor === "human") {
      result.next_action.observe_with = observation.call;
    }
    return { schema_version: PUBLISH_WORK_SCHEMA_VERSION, subject,
      producer: { accepted: true, forge_handoff: result }, blocker: null,
      observed_facts: { "publication.confirmed": original?.kind === WK_FORGE_HANDOFF_RESULT_KINDS.HANDED_OFF },
      ...(observation.unavailable == null ? {} : { landing_observation: observation.unavailable }),
      next_calls: observation.call != null && result.next_action?.observe_with == null ? [observation.call] : [] };
  }
  const refusal = outcome.refusal;
  const { detail: _detail, ...refusalIdentity } = refusal;
  const projected = projectPublicationDiagnosis(refusal.detail, env);
  const preparation = projected?.synchronization == null ? projected : {
    ...projected, synchronization: publicationPreparation(projected.synchronization)
  };
  const detail = preparation != null && preparation.effects == null && preparation.synchronization == null &&
      preparation.uncertain_effect == null && preparation.effects_observed === undefined
    ? { ...preparation, effects_observed: false } : preparation;
  const code = mapBackendRefusalToDispatchCode(refusal.code);
  const decidingFacts = [{ field: "forge_handoff.executor_accepted", value: false }];
  const observedFacts = { "forge_handoff.executor_accepted": false };
  const carried = {};
  const driftInput = { refusal, detail, assignedUnit: subject,
    code, decidingFacts, observedFacts, carried, requestSchemaAuthority };
  const drift = acceptanceValidationDriftGuidance(driftInput) ?? sectionsDriftGuidance(driftInput);
  const recovery = drift?.recovery ?? producerEstablishedRecovery(detail, {
    unchanged: `the reported publication failure for ${subject} is corrected`,
    retryCondition: "make a new subject-only publication request after that prerequisite holds",
    unestablished: "the producer established no correction owner; an unchanged retry refuses again"
  });
  return {
    schema_version: PUBLISH_WORK_SCHEMA_VERSION, subject,
    producer: { accepted: false, refusal: { ...refusalIdentity, detail } },
    blocker: { code, reason: refusal.reason, detail: { category: detail?.category ?? refusal.category } },
    observed_facts: { "publication.confirmed": false },
    refusal: drift?.refusal ?? buildDispatchMechanicalRefusal({ code, decidingFacts, observedFacts,
      noSupportedRoute: true, recovery, route: PUBLISH_WORK_TOOL_NAME,
      carried: { ...carried, ...(drift?.unavailable ? { guidance_unavailable: drift.unavailable } : {}) }
    })
  };
}

export function publicationRepoResolutionRefusal(subject, resolution) {
  return { schema_version: PUBLISH_WORK_SCHEMA_VERSION, subject, producer: null,
    effects: { publication: "not_attempted" },
    blocker: { code: resolution.blockerCode, reason: resolution.reason, detail: resolution.detail },
    refusal: buildDispatchMechanicalRefusal({ code: resolution.blockerCode,
      decidingFacts: resolution.refusal.deciding_facts,
      observedFacts: resolution.refusal.observed_facts,
      carried: resolution.refusal.carried,
      noSupportedRoute: true, route: PUBLISH_WORK_TOOL_NAME,
      recovery: ownedNoRouteRecovery({ responsibleActor: "operator",
        prerequisite: "the launcher binds this session to a configured current workspace repository",
        operatorAction: "provide a session bound to the intended configured repository; this request cannot select a repository",
        retryCondition: "submit the same subject-only request in the corrected session" }) }) };
}

export function publicationException(subject, error, env) {
  return publicationCarrier(subject, { accepted: false, refusal: {
    ...(typeof error?.code === "string" ? { code: error.code } : {}),
    category: "exception",
    reason: "publication_adapter_threw",
    detail: { ...buildDispatchToolExceptionDetail(PUBLISH_WORK_TOOL_NAME, error, { env, operatorLocator: false }),
      effects_observed: false, uncertain_effect: "publication" }
  } }, env);
}

export function publicationEntitlementRefusal(subject, role, code) {
  return { schema_version: PUBLISH_WORK_SCHEMA_VERSION, subject, producer: null,
    effects: { publication: "not_attempted" },
    blocker: { code, reason: "publication_entitlement_denied", detail: { role } },
    refusal: buildDispatchMechanicalRefusal({ code,
      decidingFacts: [{ field: "publication.session_entitled", value: false }],
      observedFacts: { "publication.session_entitled": false },
      noSupportedRoute: true, route: PUBLISH_WORK_TOOL_NAME,
      recovery: ownedNoRouteRecovery({ responsibleActor: "operator",
        prerequisite: "the session has the incumbent publication entitlement",
        operatorAction: "use an already entitled session only when the applicable lifecycle authorizes publication; tool availability grants no permission",
        retryCondition: "submit the subject in that authorized session" }) }) };
}

function publicationDiagnosis(carrier) {
  const producer = carrier.producer;
  const diagnosis = producer?.accepted === true ? producer.forge_handoff?.diagnostic : producer?.refusal?.detail;
  return diagnosis !== null && typeof diagnosis === "object" && !Array.isArray(diagnosis) ? diagnosis : null;
}

function withPublicationDiagnosis(carrier, diagnosis) {
  const producer = carrier.producer;
  return producer.accepted === true
    ? { ...carrier, producer: { ...producer, forge_handoff: { ...producer.forge_handoff, diagnostic: diagnosis } } }
    : { ...carrier, producer: { ...producer, refusal: { ...producer.refusal, detail: diagnosis } },
      blocker: carrier.blocker };
}

function memberOrigin(value, member) {
  const origin = member === "cause_chain" && Array.isArray(value) ? value[0] : value?.cause_chain?.[0];
  if (origin === null || typeof origin !== "object") return null;
  const stated = Object.fromEntries(["name", "code", "message"]
    .filter((fact) => typeof origin[fact] === "string").map((fact) => [fact, origin[fact]]));
  return Object.keys(stated).length === 0 ? null : stated;
}

function boundedPublicationAnswer(carrier, frame, limit) {
  const complete = frame(carrier, []);
  const diagnosis = publicationDiagnosis(carrier);
  if (diagnosis === null) return complete;
  const omission = (member, withMessage) => {
    const origin = memberOrigin(diagnosis[member], member);
    if (origin === null) return { member };
    const { message, ...identity } = origin;
    return { member, originating_failure: withMessage ? origin : identity };
  };

  const members = Object.keys(diagnosis);
  const kept = new Set(members.filter(member => member !== "findings"));
  const answer = (messages = new Set()) => frame(
    withPublicationDiagnosis(carrier, Object.fromEntries(Object.entries(diagnosis).filter(([key]) => kept.has(key)))),
    Object.keys(diagnosis).filter((key) => !kept.has(key)).map((key) => omission(key, messages.has(key))));

  for (const member of [...kept].sort((a, b) =>
    JSON.stringify(diagnosis[b] ?? null).length - JSON.stringify(diagnosis[a] ?? null).length)) {
    if (measureMcpInlineResultBytes(answer()) <= limit) break;
    if (!["reason", "stage", "subject", "effects", "uncertain_effect", "synchronization"].includes(member)) kept.delete(member);
  }
  const messages = new Set();
  for (const member of members.filter((key) => !kept.has(key))) {
    messages.add(member);
    if (measureMcpInlineResultBytes(answer(messages)) > limit) messages.delete(member);
  }
  return answer(messages);
}

function publicationRetentionFailure(error, subject) {
  return withoutRawCapture(describeRetentionFailure(error,
    { operation: "retain_publish_work_original", subject: { subject } }));
}

export async function deliverPublication({ carrier, binding, env, ownerCall = null, ownerRequestSchema = null }) {
  const limit = activeMcpInlineByteLimit(env);

  const diagnosis = publicationDiagnosis(carrier);
  if (diagnosis === null || (diagnosis.findings === undefined &&
      measureMcpInlineResultBytes(carrier) <= limit)) return jsonContent(carrier, { env });
  const disclose = read => (answer, omitted) => ({ ...answer,
    ...(omitted.length === 0 ? {} : { delivery: {
      complete_diagnosis_delivered: false, omitted_diagnosis: omitted,
      ...(read === null ? { detail_unavailable: { code: "publication_detail_reader_unavailable",
        stopping_condition: "The omitted publication diagnosis cannot be read through this session. Preserve the stated effects; do not repeat publication to recover detail." } }
        : { read_by: read }) } })
  });
  if (ownerCall === null) return jsonContent(boundedPublicationAnswer(carrier, disclose(null), limit), { env });
  let source;
  try {
    source = retainSelectedResponseSource({ binding, carrier, ownerCall, ownerRequestSchema }, { env });
  } catch (error) {

    const failure = publicationRetentionFailure(error, carrier.subject);
    return jsonContent(boundedPublicationAnswer(carrier, (answer, omitted) => ({ ...answer,
      delivery: { retained: false, failure, ...(omitted.length === 0 ? {} : {
        complete_diagnosis_delivered: false,
        omitted_diagnosis: omitted }) }
    }), limit), { env });
  }

  return jsonContent(boundedPublicationAnswer(carrier,
    disclose(ownerCall({ ref_id: source.ref_id })), limit), { env });
}

export function readPublicationOriginal({ subject, source, binding, env }) {

  if (subject !== binding.unit) throw new TypeError("original subject must match the session binding");
  return readSelectedResponseFull(source, { env, expected: binding });
}
