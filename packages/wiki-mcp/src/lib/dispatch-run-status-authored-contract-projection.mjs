

import {
  authoredDocumentDigest,
  buildRetainedDocumentRetrieval,
  isObjectRecord
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
