import { projectDiagnostic, isStructuredDiagnostic } from "../../../wiki-core/src/lib/diagnostic-projection.mjs";
const VERIFY_PROOF_TOOL_NAME = "workspace_verify_proof";
const TEST_ID_RE = /^test-[a-f0-9]{64}$/u;
const STABLE_CODE_RE = /^[a-z0-9_.-]{1,160}$/u;

export const VERIFY_PROOF_EVIDENCE_MEANING = Object.freeze({
  proof_observation: "selected test outcome",
  mutation_evidence: "additional falsification evidence for the same proof; unavailable does not erase the test observation",
  evaluator_outcome: "statuses are unchanged and missing evidence receives no credit"
});

function authoritativeMutationOutcomes(observedEvidence) {
  return (observedEvidence?.falsifier_outcomes ?? []).map((outcome) => ({
    status: outcome.status,
    survived: outcome.status === "not_detected" && outcome.provider_support === "supported" &&
      outcome.isolated === true && outcome.candidate_status === "passed" &&
      outcome.falsified_status === "passed" && outcome.mutation_observed === true
  }));
}

export function projectProofEvidencePresentation(proof) {
  const selectedStatus = proof.observed_evidence?.selected_status;
  const outcomes = authoritativeMutationOutcomes(proof.observed_evidence);
  const unavailableCount = (proof.observed_evidence?.capability_limitations ?? [])
    .filter(({ check_kind: kind }) => kind === "falsifier").length;
  const detectedCount = outcomes.filter(({ status }) => status === "detected").length;
  const survivedCount = outcomes.filter(({ survived }) => survived).length;
  const notDetectedCount = outcomes.filter(({ status, survived }) =>
    status === "not_detected" && !survived).length;
  const executionErrorCount = outcomes.filter(({ status }) => status === "execution_error").length;
  const mutationStatus = notDetectedCount > 0 ? "not_detected"
    : executionErrorCount > 0 ? "execution_error"
      : survivedCount > 0 ? "survived"
        : detectedCount > 0 ? "detected"
          : unavailableCount > 0 ? "unavailable" : "not_run";
  return Object.freeze({
    test_observation: Object.freeze({
      status: selectedStatus === "passed" || selectedStatus === "failed"
        ? selectedStatus : "not_observed",
      execution_status: proof.execution_status
    }),
    mutation_evidence: Object.freeze({
      status: mutationStatus,
      detected_count: detectedCount,
      survived_count: survivedCount,
      not_detected_count: notDetectedCount,
      execution_error_count: executionErrorCount,
      unavailable_count: unavailableCount
    })
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
  if (isStructuredDiagnostic(value) || value?.schema_version === "structured-diagnostic.v1") {
    const projected = projectDiagnostic(value, { fieldPrefix });
    redactions.push(...projected.redactions);
    return projected.value;
  }
  if (Array.isArray(value)) return value.map((entry, index) =>
    projectPublicDiagnostic(entry, `${fieldPrefix}.${index}`, redactions));
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([key, entry]) =>
      [key, projectPublicDiagnostic(entry, `${fieldPrefix}.${key}`, redactions)]));
  return projectDiagnostic(value, { fieldPrefix }).value;
}

function projectExecutionSourceBinding(result, redactions) {
  const binding = structuredClone(result.execution_source_binding ?? null);
  if (binding === null) return null;
  if (result.source_detail_entitlement === "selected_unit") {
    for (const [index, node] of (binding.dependencies ?? []).entries()) {
      for (const [offset, diagnostic] of (node.diagnostics ?? []).entries()) {
        if (!diagnostic.code.startsWith("obligation_coverage_construction_")) continue;
        if (diagnostic.source_failure === undefined) continue;
        const failure = diagnostic.source_failure;
        diagnostic.source_failure = { code: failure.code,
          details: "[redacted:launcher_private_state]" };
        redactions.push({ field: `execution_source_binding.dependencies.${index}.diagnostics.${offset}.source_failure`,
          reason: "launcher_private_state" });
      }
    }
  }
  return projectPublicDiagnostic(binding, "execution_source_binding", redactions);
}

export function projectPublicVerifyProofAggregate(result) {
  const redactions = [];
  const proofResults = result.proof_results.map((proof) => {
    const relationshipFailure = proof.relationship_results?.find(
      ({ status }) => status !== "satisfied");
    const reasonCode = proof.reason_code ?? relationshipFailure?.reason_code ?? null;
    const evidencePresentation = projectProofEvidencePresentation(proof);
    return Object.freeze({
      test_proof_id: proof.test_proof_id,
      verification_id: proof.verification_id,
      status: proof.status,
      readiness_status: proof.readiness_status,
      execution_status: proof.execution_status,
      ...evidencePresentation,
      subject_binding_ref: proof.subject_binding_ref,
      declared_target: proof.declared_target,
      ...(proof.selected_test === undefined ? {} : { selected_test: structuredClone(proof.selected_test) }),
      ...(proof.observed_evidence === undefined ? {} : {
        observed_evidence: projectPublicDiagnostic(proof.observed_evidence,
          `proof_results.${proof.test_proof_id}.observed_evidence`, redactions)
      }),
      relationship_results: proof.relationship_results.map((relationship) => ({
        ...relationship,
        ...(relationship.proof_instance === undefined ? {} : { proof_instance: projectPublicDiagnostic(relationship.proof_instance,
          `proof_results.${proof.test_proof_id}.relationships.${relationship.obligation_id}.proof_instance`, redactions) }),
        ...(relationship.diagnostics === undefined ? {} : {
          diagnostics: projectPublicDiagnostic(relationship.diagnostics,
            `proof_results.${proof.test_proof_id}.relationships.${relationship.obligation_id}.diagnostics`,
            redactions)
        })
      })),
      ...(reasonCode === null ? {} : { reason_code: reasonCode }),
      ...(proof.status === "not_executable" && proof.recovery !== undefined
        ? { recovery: structuredClone(proof.recovery) }
        : proof.status === "unsatisfied" ? { recovery: Object.freeze({
          action: proof.observed_evidence?.selected_status === "failed"
            ? "repair_or_reassess_the_failed_selected_assertion"
            : evidencePresentation.mutation_evidence.status === "unavailable"
              ? "use_the_observed_test_result_and_note_mutation_falsification_was_unavailable"
              : evidencePresentation.mutation_evidence.status === "survived"
                ? "inspect_the_surviving_mutation_and_evaluator_diagnostics"
              : "inspect_the_relationship_evaluator_diagnostics",
          retry_operation: VERIFY_PROOF_TOOL_NAME
        }) } : {})
    });
  });
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
    status: result.status,
    evidence_meaning: VERIFY_PROOF_EVIDENCE_MEANING,
    counts: structuredClone(result.counts),
    proof_results: Object.freeze(proofResults),
    diagnostics: projectPublicDiagnostic(result.diagnostics ?? [], "diagnostics", redactions),
    diagnostic_redactions: redactions,
    result_digest: result.result_digest,
    ...(result.reason_code === null ? {} : {
      reason_code: result.reason_code,
      ...(result.reason_code === "verify_proof.population_not_ready.v1" ? {} : {
      recovery: Object.freeze({
        action: typeof result.recovery?.action === "string" &&
          STABLE_CODE_RE.test(result.recovery.action)
          ? result.recovery.action : "repair_the_named_proof_prerequisite",
        retry_operation: VERIFY_PROOF_TOOL_NAME })
      })
    })
  });
}
