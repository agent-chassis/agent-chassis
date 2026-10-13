

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
import { activeMcpInlineByteLimit, describeRetentionFailure, jsonContent,
  measureMcpInlineResultBytes } from "./mcp-response.mjs";
import {
  readSelectedResponseFull,
  retainSelectedResponseSource
} from "./selected-response-snapshot.mjs";

export const PUBLISH_WORK_TOOL_NAME = "workspace_publish_work";
export const PUBLISH_WORK_SCHEMA_VERSION = "workspace-publish-work.v1";

function originatingFailure(detail) {
  const origin = detail?.evidence?.cause_chain?.[0];
  if (origin === null || typeof origin !== "object") return null;
  const stated = [origin.name, origin.code, origin.message ?? origin.value]
    .filter((fact) => typeof fact === "string" && fact.length > 0);
  return stated.length === 0 ? null : stated.join(": ");
}

function withoutRawCapture(failure) {
  return distillDispatchFailureDetail(failure, { nested: true }).detail;
}

function projectPublicationDiagnosis(detail, env) {
  const projected = projectDispatchFailureDetail(detail, { env, nested: true, operatorLocator: false });
  return projected?.retained_evidence?.retained === false
    ? { ...projected, retained_evidence: withoutRawCapture(projected.retained_evidence) } : projected;
}

export function publicationCarrier(subject, outcome, env, requestSchemaAuthority = null) {
  if (outcome.accepted === true) {
    const original = outcome.forge_handoff;
    const result = original?.diagnostic == null ? original : {
      ...original,
      diagnostic: projectPublicationDiagnosis(original.diagnostic, env)
    };
    return { schema_version: PUBLISH_WORK_SCHEMA_VERSION, subject,
      producer: { ...outcome, forge_handoff: result }, blocker: null };
  }
  const refusal = outcome.refusal;
  const { detail: _detail, ...refusalIdentity } = refusal;
  const detail = projectPublicationDiagnosis(refusal.detail, env);
  const code = mapBackendRefusalToDispatchCode(refusal.code);
  const decidingFacts = [{ field: "forge_handoff.executor_accepted", value: false }];
  const observedFacts = { "forge_handoff.executor_accepted": false };
  const carried = { forge_executor_refusal: refusalIdentity };
  const driftInput = { refusal, detail, assignedUnit: subject,
    code, decidingFacts, observedFacts, carried, requestSchemaAuthority };
  const drift = acceptanceValidationDriftGuidance(driftInput) ?? sectionsDriftGuidance(driftInput);
  const originating = originatingFailure(detail);
  const recovery = drift?.recovery ?? producerEstablishedRecovery(detail, {
    unchanged: originating === null ? `the producer's ${refusal.reason} condition no longer holds`
      : `the failure ${subject} publication stopped on no longer occurs: ${originating}`,
    retryCondition: "make a new subject-only publication request after that prerequisite holds",
    unestablished: "the producer established no correction owner; an unchanged retry refuses again"
  });
  return {
    schema_version: PUBLISH_WORK_SCHEMA_VERSION, subject,
    producer: { ...outcome, refusal: { ...refusal, detail } },
    blocker: { code, reason: refusal.reason, detail },
    refusal: drift?.refusal ?? buildDispatchMechanicalRefusal({ code, decidingFacts, observedFacts,
      noSupportedRoute: true, recovery, route: PUBLISH_WORK_TOOL_NAME,
      carried: { ...carried, ...(drift?.unavailable ? { guidance_unavailable: drift.unavailable } : {}) }
    })
  };
}

export function publicationRepoResolutionRefusal(subject, resolution) {
  return { schema_version: PUBLISH_WORK_SCHEMA_VERSION, subject, producer: null,
    blocker: { code: resolution.blockerCode, reason: resolution.reason, detail: resolution.detail },
    refusal: buildDispatchMechanicalRefusal({ code: resolution.blockerCode,
      decidingFacts: resolution.refusal.deciding_facts,
      observedFacts: resolution.refusal.observed_facts,
      carried: resolution.refusal.carried,
      noSupportedRoute: true, route: PUBLISH_WORK_TOOL_NAME,
      recovery: ownedNoRouteRecovery({ responsibleActor: "operator",
        prerequisite: "the launcher binds this session to a configured current workspace repository",
        operatorAction: "correct the launcher workspace configuration and start a repo-attached session " +
          "with WIKI_MCP_WORKSPACE_DIR and its configured WIKI_MCP_WORKSPACE_ALIAS",
        retryCondition: "submit the same subject-only request in the corrected session" }) }) };
}

export function publicationException(subject, error, env) {
  return publicationCarrier(subject, { accepted: false, refusal: {
    ...(typeof error?.code === "string" ? { code: error.code } : {}),
    category: "exception",
    reason: "publication_adapter_threw",
    detail: buildDispatchToolExceptionDetail(PUBLISH_WORK_TOOL_NAME, error, { env, operatorLocator: false })
  } }, env);
}

export function publicationEntitlementRefusal(subject, role, code) {
  return { schema_version: PUBLISH_WORK_SCHEMA_VERSION, subject, producer: null,
    blocker: { code, reason: "publication_entitlement_denied", detail: { role } },
    refusal: buildDispatchMechanicalRefusal({ code,
      decidingFacts: [{ field: "publication.session_entitled", value: false }],
      observedFacts: { "publication.session_entitled": false },
      noSupportedRoute: true, route: PUBLISH_WORK_TOOL_NAME,
      recovery: ownedNoRouteRecovery({ responsibleActor: "operator",
        prerequisite: "the session has the incumbent publication entitlement",
        operatorAction: "start a session with the centrally granted publication role",
        retryCondition: "submit the subject in that session" }) }) };
}

export function publicationOriginalRequest(subject, source) {
  return Object.freeze({ subject, source: Object.freeze({ ref_id: source.ref_id }) });
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
      blocker: { ...carrier.blocker, detail: diagnosis } };
}

function memberOrigin(value) {
  const origin = value?.cause_chain?.[0];
  if (origin === null || typeof origin !== "object") return null;
  const stated = Object.fromEntries(["name", "code", "message"]
    .filter((fact) => typeof origin[fact] === "string").map((fact) => [fact, origin[fact]]));
  return Object.keys(stated).length === 0 ? null : stated;
}

function boundedPublicationAnswer(carrier, frame, limit) {
  const complete = frame(carrier, []);
  const diagnosis = publicationDiagnosis(carrier);
  if (diagnosis === null || measureMcpInlineResultBytes(complete) <= limit) return complete;
  const omission = (member, withMessage) => {
    const origin = memberOrigin(diagnosis[member]);
    if (origin === null) return { member };
    const { message, ...identity } = origin;
    return { member, originating_failure: withMessage ? origin : identity };
  };
  const members = Object.keys(diagnosis).sort((left, right) =>
    JSON.stringify(diagnosis[left] ?? null).length - JSON.stringify(diagnosis[right] ?? null).length);
  const kept = new Set();
  const answer = (messages = new Set()) => frame(
    withPublicationDiagnosis(carrier, Object.fromEntries(Object.entries(diagnosis).filter(([key]) => kept.has(key)))),
    Object.keys(diagnosis).filter((key) => !kept.has(key)).map((key) => omission(key, messages.has(key))));
  for (const member of members) {
    kept.add(member);
    if (measureMcpInlineResultBytes(answer()) > limit) kept.delete(member);
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
  let source;
  try {
    source = retainSelectedResponseSource({ binding, carrier, ownerCall, ownerRequestSchema }, { env });
  } catch (error) {

    const failure = publicationRetentionFailure(error, carrier.subject);
    return jsonContent(boundedPublicationAnswer(carrier, (answer, omitted) => ({ ...answer,
      delivery: { retained: false, failure, ...(omitted.length === 0 ? {} : {
        complete_diagnosis_delivered: false,
        diagnosis_fields_not_delivered: omitted.map(({ member }) => member), omitted_diagnosis: omitted }) }
    }), limit), { env });
  }

  const originalRequest = publicationOriginalRequest(carrier.subject, source);
  const read = ownerCall === null ? [] : [ownerCall(source)];
  return jsonContent(boundedPublicationAnswer(carrier, (answer, omitted) => ({ ...answer,
    delivery: { retained: true, original_request: originalRequest, ...(omitted.length === 0 ? {} : {
      complete_diagnosis_delivered: false, omitted_diagnosis: omitted,
      ...(read.length === 0 ? {} : { read_by: read[0] }) }) },
    original: { source }, next_calls: [...(answer.next_calls ?? []), ...read]
  }), limit), { env });
}

export function readPublicationOriginal({ subject, source, binding, env }) {

  if (subject !== binding.unit) throw new TypeError("original subject must match the session binding");
  return readSelectedResponseFull(source, { env, expected: binding });
}
