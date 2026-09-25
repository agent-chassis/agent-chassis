

import {
  authoredDocumentDigest,
  buildRetainedDocumentRetrieval,
  isObjectRecord,
  objectCarrierStep,
  serializeRetainedObject
} from "./dispatch-run-status-retained-document-retrieval.mjs";
import { buildDispatchContinuation } from "./dispatch-tool-helpers.mjs";

export const RUN_STATUS_AUTHORED_CONTRACT_PROJECTION_SCHEMA_VERSION =
  "workspace-agent-run-status-authored-contract-projection.v1";

export const TERMINAL_CANDIDATE_AUTHORED_CONTRACT_MEMBERS = Object.freeze([
  Object.freeze({
    member: "canonical_parent_wk_contract",
    document: "canonical_parent_work_record_including_every_sibling_slice"
  }),
  Object.freeze({
    member: "review_unit_contract",
    document: "designated_terminal_review_slice_contract"
  })
]);

export function readTerminalCandidateAuthoredContracts(lifecycle) {
  if (!isObjectRecord(lifecycle)) return null;
  const terminalCandidate = lifecycle.terminal_candidate;
  if (!isObjectRecord(terminalCandidate)) return null;
  const reviewUnit = terminalCandidate.review_unit;
  if (!isObjectRecord(reviewUnit)) return null;
  const present = [];
  for (const { member, document } of TERMINAL_CANDIDATE_AUTHORED_CONTRACT_MEMBERS) {
    if (!Object.hasOwn(reviewUnit, member) || typeof reviewUnit[member] !== "string") continue;
    present.push({ member, document, text: reviewUnit[member] });
  }
  return present.length === 0 ? null : { reviewUnit, present };
}

const CANDIDATE_STATUS_ROUTE = "workspace_terminal_review_candidate_status";
const WK_ID_RE = /^WK-\d{4}$/u;

function currentCandidateStatusObservation({ recordId, repository }) {
  if (typeof recordId !== "string" || !WK_ID_RE.test(recordId)) return null;
  try {
    return buildDispatchContinuation({
      tool: CANDIDATE_STATUS_ROUTE,
      arguments: {
        ...(typeof repository === "string" && repository.length > 0 ? { repo: repository } : {}),
        wk_id: recordId
      },
      successPredicate: { fact: "terminal_candidate.current_status_read", operator: "is_true" }
    });
  } catch {
    return null;
  }
}

function authoredContractProjection({ reviewUnit, omitted, retention }) {
  const retrieval = buildRetainedDocumentRetrieval(retention, {
    carrierStep: "JSON.parse the verified bytes as UTF-8 and take carrier.<member> verbatim"
  });
  const repository = retention?.state === "retained" ? retention.repository : null;
  const currentObservation = currentCandidateStatusObservation({
    recordId: reviewUnit.record_id,
    repository
  });
  return Object.freeze({
    schema_version: RUN_STATUS_AUTHORED_CONTRACT_PROJECTION_SCHEMA_VERSION,
    projection_scope: "terminal_candidate_review_unit_authored_contracts",
    reason: "authored_contract_body_is_not_run_observation_state",
    grants_authority: false,
    evidence_class: "historical_attempt_snapshot",

    current_record_read_is_equivalent: false,
    source_member_count: TERMINAL_CANDIDATE_AUTHORED_CONTRACT_MEMBERS.length,
    returned_member_count: TERMINAL_CANDIDATE_AUTHORED_CONTRACT_MEMBERS.length - omitted.length,
    omitted_member_count: omitted.length,
    omitted: Object.freeze(omitted),
    retrieval: Object.freeze(retrieval),

    ...(currentObservation === null ? {} : {
      current_candidate_status_observation: Object.freeze({
        answers: "whether the live canonical contract still agrees with the current candidate",
        binds_historical_candidate: false,
        reconstructs_omitted_members: false,
        call: currentObservation
      })
    })
  });
}

function projectReviewUnit(reviewUnit, found, retention) {
  const projected = { ...reviewUnit };
  const omitted = found.present.map(({ member, document, text }) => {
    delete projected[member];
    return Object.freeze({
      member,
      document,
      digest: authoredDocumentDigest(text),
      utf8_bytes: Buffer.byteLength(text, "utf8")
    });
  });
  projected.authored_contracts = authoredContractProjection({ reviewUnit, omitted, retention });
  return Object.freeze(projected);
}

export function projectPublishedSliceLifecycle(lifecycle, { retention = null } = {}) {
  const found = readTerminalCandidateAuthoredContracts(lifecycle);
  if (found === null) return lifecycle;
  const reviewUnit = projectReviewUnit(found.reviewUnit, found, retention);
  const terminalCandidate = Object.freeze({
    ...lifecycle.terminal_candidate,
    review_unit: reviewUnit
  });
  return Object.freeze({ ...lifecycle, terminal_candidate: terminalCandidate });
}

export const RUN_STATUS_CONTROLLED_GENERATION_PROJECTION_SCHEMA_VERSION =
  "workspace-agent-run-status-controlled-generation-projection.v1";
export const TERMINAL_CANDIDATE_CONTROLLED_GENERATION_MEMBER = "controlled_generation";
export const TERMINAL_CANDIDATE_CONTROLLED_GENERATION_CARRIER_MEMBER =
  "terminal_candidate_controlled_generation";
const CONTROLLED_GENERATION_IDENTITY_SOURCE =
  "terminal_candidate.binding.version_decision.controlled_generation";

export function readTerminalCandidateControlledGeneration(lifecycle) {
  if (!isObjectRecord(lifecycle)) return null;
  const terminalCandidate = lifecycle.terminal_candidate;
  if (!isObjectRecord(terminalCandidate)) return null;
  const binding = terminalCandidate.binding;
  if (!isObjectRecord(binding)) return null;
  const generation = binding[TERMINAL_CANDIDATE_CONTROLLED_GENERATION_MEMBER];
  if (!isObjectRecord(generation)) return null;
  const text = serializeRetainedObject(generation);
  if (text === null) return null;
  return { terminalCandidate, binding, generation, text };
}

function observedString(value) {
  return typeof value === "string" ? value : null;
}

function observedLength(value) {
  return Array.isArray(value) ? value.length : null;
}

function controlledGenerationSummary({ binding, generation, text, retention }) {
  const retrieval = buildRetainedDocumentRetrieval(retention, {
    carrierStep: objectCarrierStep(
      TERMINAL_CANDIDATE_CONTROLLED_GENERATION_CARRIER_MEMBER,
      "the exact observed controlled generation"
    )
  });
  return Object.freeze({
    schema_version: RUN_STATUS_CONTROLLED_GENERATION_PROJECTION_SCHEMA_VERSION,
    projection_scope: "terminal_candidate_controlled_generation",
    reason: "controlled_generation_carrier_bytes_are_not_run_observation_state",
    grants_authority: false,
    evidence_class: "historical_attempt_snapshot",
    current_record_read_is_equivalent: false,
    source_schema_version: observedString(generation.schema_version),

    identity_source: Object.freeze({
      path: CONTROLLED_GENERATION_IDENTITY_SOURCE,
      present: isObjectRecord(binding.version_decision) &&
        isObjectRecord(binding.version_decision.controlled_generation)
    }),

    source_facts: Object.freeze({
      repository: observedString(generation.repository),
      record_source_digest: observedString(generation.record_source_digest),
      wk_tip_sha: observedString(generation.wk_tip_sha)
    }),

    descriptor_count: observedLength(generation.descriptors),
    manifest_descriptor_count: observedLength(generation.manifest_descriptors),
    omitted: Object.freeze({
      member: TERMINAL_CANDIDATE_CONTROLLED_GENERATION_MEMBER,
      carrier_member: TERMINAL_CANDIDATE_CONTROLLED_GENERATION_CARRIER_MEMBER,
      digest: authoredDocumentDigest(text),
      utf8_bytes: Buffer.byteLength(text, "utf8")
    }),
    retrieval: Object.freeze(retrieval)
  });
}

export function projectPublishedControlledGeneration(lifecycle, { retention = null } = {}) {
  const found = readTerminalCandidateControlledGeneration(lifecycle);
  if (found === null) return lifecycle;
  const binding = { ...found.binding };
  delete binding[TERMINAL_CANDIDATE_CONTROLLED_GENERATION_MEMBER];
  binding.controlled_generation_summary = controlledGenerationSummary({ ...found, retention });
  return Object.freeze({
    ...lifecycle,
    terminal_candidate: Object.freeze({
      ...found.terminalCandidate,
      binding: Object.freeze(binding)
    })
  });
}

export const RUN_STATUS_COMPACT_LIFECYCLE_SCHEMA_VERSION =
  "workspace-agent-run-status-compact-lifecycle.v1";

const LIFECYCLE_STATE_OBJECTS = Object.freeze(["cleanup", "failure_cause"]);
const INTEGRATION_SCALAR_OBJECTS = Object.freeze([
  "review_target", "transition", "record_reconciliation", "cleanup"
]);
const CANDIDATE_BINDING_IDENTITY = Object.freeze([
  "canonical_wk_id", "base_ref", "base", "wk_ref", "wk_tip", "candidate", "candidate_tree",
  "candidate_ref", "version_identity", "version_ref"
]);
const CANDIDATE_REVIEW_UNIT_IDENTITY = Object.freeze(["record_id", "slice_id", "subject"]);

const isScalar = (value) => value === null || typeof value !== "object";

function scalarMembers(value, at, omitted) {
  const view = {};
  for (const [key, member] of Object.entries(value)) {
    if (isScalar(member)) view[key] = member;
    else omitted.push(`${at}${key}`);
  }
  return view;
}

function pickMembers(value, keys) {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key))
    .map((key) => [key, value[key]]));
}

function compactIntegration(integration, omitted) {
  const view = {};
  for (const [key, member] of Object.entries(integration)) {
    if (isScalar(member)) view[key] = member;
    else if (INTEGRATION_SCALAR_OBJECTS.includes(key) && isObjectRecord(member)) {
      view[key] = scalarMembers(member, `integration.${key}.`, omitted);
    } else omitted.push(`integration.${key}`);
  }
  return view;
}

function compactTerminalCandidate(candidate, omitted) {
  const binding = isObjectRecord(candidate.binding) ? candidate.binding : {};
  for (const key of Object.keys(candidate)) omitted.push(`terminal_candidate.${key}`);
  const view = pickMembers(binding, CANDIDATE_BINDING_IDENTITY);
  if (isObjectRecord(candidate.materialization) &&
      typeof candidate.materialization.verified === "boolean") {
    view.materialization_verified = candidate.materialization.verified;
  }
  if (Object.hasOwn(candidate, "review_unit")) {
    view.review_unit = isObjectRecord(candidate.review_unit)
      ? pickMembers(candidate.review_unit, CANDIDATE_REVIEW_UNIT_IDENTITY)
      : candidate.review_unit;
  }
  return view;
}

function completeLifecycleCall({ subject, attemptId }) {
  try {
    return buildDispatchContinuation({
      tool: "workspace_agent_run_status",
      arguments: { subject, ...(attemptId === null ? {} : { attempt_id: attemptId }),
        include_final_result: true },
      successPredicate: { fact: "monitor.complete_slice_lifecycle_read", operator: "is_true" }
    });
  } catch {
    return null;
  }
}

export function projectCompactSliceLifecycle(lifecycle, { subject, attemptId = null }) {
  if (!isObjectRecord(lifecycle)) return lifecycle;
  const omitted = [];
  const view = { view: RUN_STATUS_COMPACT_LIFECYCLE_SCHEMA_VERSION };
  for (const [key, member] of Object.entries(lifecycle)) {
    if (isScalar(member)) view[key] = member;
    else if (LIFECYCLE_STATE_OBJECTS.includes(key)) view[key] = member;
    else if (key === "integration" && isObjectRecord(member)) {
      view.integration = compactIntegration(member, omitted);
    } else if (key === "terminal_candidate" && isObjectRecord(member)) {
      view.terminal_candidate = compactTerminalCandidate(member, omitted);
    } else omitted.push(key);
  }
  view.omitted_members = omitted;
  const call = completeLifecycleCall({ subject, attemptId });
  view.complete = Object.freeze({
    complete_mode: Object.freeze({ include_final_result: true }),
    meaning: "the same observation's complete lifecycle envelope, including every omitted member",
    ...(call === null ? {} : { call })
  });
  return Object.freeze(view);
}
