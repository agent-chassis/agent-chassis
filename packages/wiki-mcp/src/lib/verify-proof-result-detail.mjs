import { projectDiagnostic, isStructuredDiagnostic } from "../../../wiki-core/src/lib/diagnostic-projection.mjs";
import { classifyMutationOutcome, countMutationOutcomes } from
  "../../../controlled-contract/lib/test-proof-mutation-outcome.mjs";
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
  const selectedStatus = proof.observed_evidence?.selected_status;
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
    next_step: "Inspect the recorded falsifier facts in the complete evidence; an unchanged-input retry is not implied."
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
      ...(proof.observed_evidence === undefined ? {} : {
        observed_evidence: projectPublicDiagnostic(proof.observed_evidence,
          `proof_results.${proof.test_proof_id}.observed_evidence`, redactions)
      }),
      ...(proof.runtime_environment === undefined ? {} : {
        runtime_environment: structuredClone(proof.runtime_environment)
      }),
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
    result_digest: result.result_digest,
    ...(result.reason_code === null ? {} : { reason_code: result.reason_code }),

    ...(result.reason_code === null || result.recovery === undefined ? {} : {
      recovery: structuredClone(result.recovery) })
  });
}
