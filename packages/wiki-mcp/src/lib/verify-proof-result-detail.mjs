import { projectDiagnostic, STRUCTURED_DIAGNOSTIC_SCHEMA_VERSION }
  from "../../../wiki-core/src/lib/diagnostic-projection.mjs";
import { classifyMutationOutcome, countMutationOutcomes } from
  "@agent-chassis/controlled-contract";
import { projectSelectedTestFailureDiagnostic } from
  "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-error-diagnostic.mjs";
import { fitWholePrefix, projectVerifyProofSummaryRow } from "./verify-proof-result-summary.mjs";
const VERIFY_PROOF_TOOL_NAME = "workspace_verify_proof";
const TEST_ID_RE = /^test-[a-f0-9]{64}$/u;
const STABLE_CODE_RE = /^[a-z0-9_.-]{1,160}$/u;

export const VERIFY_PROOF_EVIDENCE_MEANING = Object.freeze({
  proof_observation: "selected test outcome as observed (passed, failed, skipped or another reported status); not_observed when no selected-test event was recorded",
  mutation_evidence: "additional falsification evidence for the same proof, per member: detected, survived (counterevidence), unavailable (a capability limitation: no credit and no counterevidence) or unevaluable",
  evaluator_outcome: "proven or unproven for the requested proof and tested source only; not_executable when required evidence is incomplete or cannot be evaluated; never a verdict on the whole unit"
});

const PUBLIC_PROOF_STATUSES = Object.freeze({
  satisfied: "proven", unsatisfied: "unproven", not_executable: "not_executable"
});
export const PUBLIC_PROOF_STATUS_VALUES = Object.freeze(["proven", "unproven", "not_executable"]);

function publicProofStatus(status) {
  const projected = PUBLIC_PROOF_STATUSES[status];
  if (projected === undefined) throw new TypeError(`unknown proof verification status ${status}`);
  return projected;
}

export function projectProofEvidencePresentation(proof) {

  const selectedStatus = proof.observed_evidence?.selected_status ??
    proof.selected_observation?.status;
  const outcomes = countMutationOutcomes((proof.observed_evidence?.falsifier_outcomes ?? [])
    .map(classifyMutationOutcome));
  const falsifierLimitations = (proof.observed_evidence?.capability_limitations ?? [])
    .filter(({ check_kind: kind }) => kind === "falsifier");
  const unavailableCount = outcomes.unavailable +
    falsifierLimitations.filter(({ check_id: id }) => id === null).length;
  const mutationStatus = outcomes.survived > 0 ? "survived"
    : outcomes.unevaluable > 0 ? "unevaluable"
      : unavailableCount > 0 ? "unavailable"
        : outcomes.detected > 0 ? "detected" : "not_run";
  return Object.freeze({
    test_observation: Object.freeze({
      status: typeof selectedStatus === "string" ? selectedStatus : "not_observed",
      execution_status: proof.execution_status
    }),
    mutation_evidence: Object.freeze({
      status: mutationStatus,
      detected_count: outcomes.detected,
      survived_count: outcomes.survived,
      unavailable_count: unavailableCount,
      unevaluable_count: outcomes.unevaluable,
      limitation_codes: Object.freeze([...new Set(falsifierLimitations
        .map(({ reason_code: code }) => code))].sort())
    })
  });
}

function distinctDiagnosticCodes(relationships) {
  const codes = new Set();
  for (const relationship of relationships) {
    for (const entry of relationship.diagnostics ?? []) {
      const code = entry?.code ?? entry?.reason_code;
      if (typeof code === "string" && STABLE_CODE_RE.test(code)) codes.add(code);
    }
  }
  return [...codes].sort();
}

function projectProofRecovery(proof) {
  if (proof.status === "unsatisfied") {
    const failed = proof.relationship_results.filter(({ status }) => status === "unsatisfied");
    return Object.freeze({
      condition: "evaluated_counterevidence",
      diagnostic_codes: distinctDiagnosticCodes(failed),
      subject: Object.freeze({ test_proof_id: proof.test_proof_id,
        verification_id: proof.verification_id }),
      effect: "this proof is unproven for the tested source only; other proofs and later revisions are unaffected",
      responsible_actor: "implementation_owner",
      next_step: "Correct the implementation or the selected assertion so that no diagnosed condition holds, then verify the corrected source.",
      follow_up_call: Object.freeze({ tool: VERIFY_PROOF_TOOL_NAME,
        arguments: Object.freeze({ subject: proof.test_proof_id }) })
    });
  }
  if (proof.status !== "not_executable") return undefined;
  if (proof.recovery !== undefined) return structuredClone(proof.recovery);
  const unevaluated = proof.relationship_results.filter(({ status }) => status === "not_executable");
  if (proof.execution_status !== "completed" || unevaluated.length === 0) return undefined;
  return Object.freeze({
    condition: "evidence_not_evaluable",
    reason_codes: [...new Set(unevaluated.map(({ reason_code: code }) => code))].sort(),
    diagnostic_codes: distinctDiagnosticCodes(unevaluated),
    subject: Object.freeze({ test_proof_id: proof.test_proof_id,
      verification_id: proof.verification_id }),
    effect: "no proof verdict for these relationships; the selected test observation is preserved and nothing is credited",
    uncertainty: "whether the selected assertion discriminates the declared falsifier is unknown",
    responsible_actor: "verification_runtime_owner",
    next_step: "Read this proof's selected detail for its recorded falsifier facts; an unchanged-input retry is not implied."
  });
}
export function projectObservedIdentity(event) {
  if (!event || !TEST_ID_RE.test(event.test_id) ||
      (event.file !== null && typeof event.file !== "string") ||
      (event.name !== null && typeof event.name !== "string") ||
      (event.nesting !== null && !Number.isSafeInteger(event.nesting))) {
    throw new TypeError("authenticated observed test identity is malformed");
  }
  return { test_id: event.test_id, file: event.file, name: event.name,
    nesting: event.nesting,
    ...(event.status === undefined ? {} : { status: event.status }),
    ...(event.error_codes === undefined ? {} : { error_codes: structuredClone(event.error_codes) }),
    ...(event.failure_diagnostic === undefined ? {} : {
      failure_diagnostic: structuredClone(event.failure_diagnostic)
    }) };
}

export function projectPublicDiagnostic(value, fieldPrefix, redactions) {
  if (value?.schema_version === STRUCTURED_DIAGNOSTIC_SCHEMA_VERSION) return projectDiagnostic(value).value;
  if (Array.isArray(value)) return value.map((entry, index) =>
    projectPublicDiagnostic(entry, `${fieldPrefix}.${index}`, redactions));
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([key, entry]) =>
      [key, projectPublicDiagnostic(entry, `${fieldPrefix}.${key}`, redactions)]));
  return projectDiagnostic(value).value;
}

function projectExecutionSourceBinding(result, redactions) {
  const binding = structuredClone(result.execution_source_binding ?? null);
  if (binding === null) return null;
  return projectPublicDiagnostic(binding, "execution_source_binding", redactions);
}

export function projectPublicVerifyProofAggregate(result) {
  const redactions = [];
  const proofResults = result.proof_results.map((proof) => {
    const relationshipFailure = proof.relationship_results?.find(
      ({ status }) => status !== "satisfied");
    const reasonCode = proof.reason_code ?? relationshipFailure?.reason_code ?? null;
    const evidencePresentation = projectProofEvidencePresentation(proof);
    const recovery = projectProofRecovery(proof);
    return Object.freeze({
      test_proof_id: proof.test_proof_id,
      verification_id: proof.verification_id,
      status: publicProofStatus(proof.status),
      readiness_status: proof.readiness_status,
      execution_status: proof.execution_status,
      ...evidencePresentation,
      subject_binding_ref: proof.subject_binding_ref,
      declared_target: proof.declared_target,
      ...(proof.selected_test === undefined ? {} : { selected_test: structuredClone(proof.selected_test) }),
      ...(proof.selected_observation === undefined ? {} : {
        selected_observation: structuredClone(proof.selected_observation) }),
      ...(proof.observed_evidence === undefined ? {} : {
        observed_evidence: projectPublicDiagnostic(proof.observed_evidence,
          `proof_results.${proof.test_proof_id}.observed_evidence`, redactions)
      }),
      ...(proof.runtime_environment === undefined ? {} : {
        runtime_environment: structuredClone(proof.runtime_environment)
      }),

      ...(proof.attempt_diagnostics === undefined ? {} : {
        attempt_diagnostics: projectPublicDiagnostic(proof.attempt_diagnostics,
          `proof_results.${proof.test_proof_id}.attempt_diagnostics`, redactions)
      }),

      ...(proof.timing === undefined ? {} : { timing: structuredClone(proof.timing) }),
      relationship_results: proof.relationship_results.map((relationship) => ({
        ...relationship,
        status: publicProofStatus(relationship.status),
        ...(relationship.proof_instance === undefined ? {} : { proof_instance: projectPublicDiagnostic(relationship.proof_instance,
          `proof_results.${proof.test_proof_id}.relationships.${relationship.obligation_id}.proof_instance`, redactions) }),
        ...(relationship.diagnostics === undefined ? {} : {
          diagnostics: projectPublicDiagnostic(relationship.diagnostics,
            `proof_results.${proof.test_proof_id}.relationships.${relationship.obligation_id}.diagnostics`,
            redactions)
        })
      })),
      ...(reasonCode === null ? {} : { reason_code: reasonCode }),
      ...(recovery === undefined ? {} : { recovery })
    });
  });
  const { satisfied, unsatisfied, ...counts } = result.counts;
  return Object.freeze({
    schema_version: result.schema_version,
    ...(result.authority_limb === undefined ? {} : { authority_limb: result.authority_limb }),
    execution_source_binding: projectExecutionSourceBinding(result, redactions),
    subject: structuredClone(result.subject),
    subject_binding: Object.freeze({
      wk_id: result.resolved_unit,
      contract_generation: result.contract_generation,
      ...(result.contract_digest === null ? {} : {
        contract_content_digest: result.contract_digest
      }),
      candidate_identity: result.subject_binding
    }),
    status: publicProofStatus(result.status),
    requested_environment: result.requested_environment ?? null,
    evidence_meaning: VERIFY_PROOF_EVIDENCE_MEANING,
    counts: { proofs: counts.proofs, relationships: counts.relationships, proven: satisfied,
      unproven: unsatisfied, not_executable: counts.not_executable, ready: counts.ready,
      nonready: counts.nonready, execution_not_started: counts.execution_not_started },
    proof_results: Object.freeze(proofResults),
    diagnostics: projectPublicDiagnostic(result.diagnostics ?? [], "diagnostics", redactions),
    diagnostic_redactions: redactions,

    ...(result.timing === undefined ? {} : { timing: structuredClone(result.timing) }),
    result_digest: result.result_digest,
    ...(result.reason_code === null ? {} : { reason_code: result.reason_code }),

    ...(result.reason_code === null || result.recovery === undefined ? {} : {
      recovery: structuredClone(result.recovery) })
  });
}

export const VERIFY_PROOF_SELECTED_DETAIL_SCHEMA_VERSION = "workspace-verify-proof-selected-detail.v1";
const POPULATION_SUBJECT_RE = /^WK-[0-9]+(?:#SLICE-[0-9]+)?$/u;

export function isVerifyProofPopulationSubject(subject) {
  return typeof subject === "string" && POPULATION_SUBJECT_RE.test(subject);
}

export function selectVerifyProofRows(evidence, subject) {
  return (evidence?.proof_results ?? []).filter((proof) => proof.test_proof_id === subject ||
    (proof.relationship_results ?? []).some(({ obligation_id: id }) => id === subject));
}

const SELECTED_JOIN_FACTS = Object.freeze(["join_kind", "arity", "owner_code", "path",
  "resolved_node_identity", "case_id"]);
const isScalar = (value) => value === null || ["string", "number", "boolean"].includes(typeof value);

function competingVerificationIds(entry) {
  const ids = entry?.details?.verification_ids;
  return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? ids : null;
}

function selectedDiagnostic(entry, idLimit) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return { value: entry };
  const facts = {};
  const retained = [];
  for (const [key, value] of Object.entries(entry)) {
    if (isScalar(value)) facts[key] = value;
    else if (key !== "details") retained.push(key);
  }
  const details = entry.details !== null && typeof entry.details === "object" &&
    !Array.isArray(entry.details) ? entry.details : null;
  const ids = competingVerificationIds(entry);
  if (details !== null) {
    const published = new Set(ids === null ? [] : ["verification_ids"]);
    for (const key of SELECTED_JOIN_FACTS) {
      if (!Object.hasOwn(details, key) || !isScalar(details[key]) || Object.hasOwn(facts, key)) continue;
      facts[key] = details[key];
      published.add(key);
    }
    if (Object.keys(details).some((key) => !published.has(key))) retained.push("details");
  } else if (Object.hasOwn(entry, "details") && !isScalar(entry.details)) retained.push("details");
  const returned = ids === null ? [] : ids.slice(0, idLimit);
  return {
    ...facts,
    ...(ids === null ? {} : {
      verification_ids: [...returned],
      verification_ids_total: ids.length,
      verification_ids_returned: returned.length,
      verification_ids_omitted: ids.length - returned.length
    }),
    ...(retained.length === 0 ? {} : { retained_fields: retained.sort() })
  };
}

function selectedTestFailure(proof) {
  const observed = proof.observed_evidence;
  if ((observed === undefined || observed === null) && proof.selected_observation !== undefined) {
    const { test_id: testId, file, name, status } = proof.selected_observation;
    return { state: "observed", test_id: testId, file, name, status };
  }
  if (observed === undefined || observed === null) return { state: "not_observed" };
  const event = (observed.observed_identity_candidates ?? [])
    .find(({ test_id: id }) => id === observed.selected_test_id);
  if (event === undefined) return { state: "not_observed", selected_test_id: observed.selected_test_id };
  return {
    state: "observed",
    test_id: event.test_id,
    file: event.file,
    name: event.name,
    status: event.status ?? null,
    ...(event.error_codes === undefined ? {} : { error_codes: structuredClone(event.error_codes) }),

    ...(event.status !== "failed" ? {} : {
      diagnostic: event.failure_diagnostic === undefined
        ? { status: "not_captured",
          meaning: "the provider recorded no structured failure diagnostic for this test" }
        : projectSelectedTestFailureDiagnostic(event.failure_diagnostic)
    })
  };
}

function selectedFailedRelationships(proof, subject) {
  const byObligation = subject !== proof.test_proof_id;
  return (proof.relationship_results ?? []).filter(({ obligation_id: id, status }) =>
    (!byObligation || id === subject) && status !== "proven");
}

function projectSelectedProof(proof, subject, ids) {
  const row = projectVerifyProofSummaryRow(proof);
  const byObligation = subject !== proof.test_proof_id;
  return {
    ...row,

    ...(proof.timing === undefined ? {} : { timing: structuredClone(proof.timing) }),
    obligations: row.obligations.filter(({ obligation_id: id }) => !byObligation || id === subject),
    ...(proof.status === "proven" ? {} : {
      failure: {
        ...(proof.reason_code === undefined ? {} : { reason_code: proof.reason_code }),
        selected_test: selectedTestFailure(proof),
        relationships: selectedFailedRelationships(proof, subject).map((relationship) => ({
          obligation_id: relationship.obligation_id,
          status: relationship.status,
          reason_code: relationship.reason_code ?? null,
          diagnostics: (relationship.diagnostics ?? []).map((entry) => selectedDiagnostic(entry, ids.take(entry)))
        })),
        ...(proof.recovery === undefined ? {} : { recovery: structuredClone(proof.recovery) })
      }
    })
  };
}

export function projectVerifyProofSelectedDetail(evidence, subject, { fits = () => true } = {}) {
  const proofs = selectVerifyProofRows(evidence, subject);
  if (proofs.length === 0) return null;
  const total = proofs.flatMap((proof) => selectedFailedRelationships(proof, subject))
    .flatMap(({ diagnostics }) => diagnostics ?? [])
    .reduce((sum, entry) => sum + (competingVerificationIds(entry)?.length ?? 0), 0);
  const build = (budget) => {
    let remaining = budget;
    const ids = { take(entry) {
      const count = Math.min(remaining, competingVerificationIds(entry)?.length ?? 0);
      remaining -= count;
      return count;
    } };
    return {
      schema_version: VERIFY_PROOF_SELECTED_DETAIL_SCHEMA_VERSION,
      selected_subject: subject,
      result_digest: evidence.result_digest,
      result_status: evidence.status,
      subject: structuredClone(evidence.subject),
      subject_binding: structuredClone(evidence.subject_binding),
      evidence_meaning: VERIFY_PROOF_EVIDENCE_MEANING,
      proofs: proofs.map((proof) => projectSelectedProof(proof, subject, ids))
    };
  };
  return fitWholePrefix(total, build, fits);
}
