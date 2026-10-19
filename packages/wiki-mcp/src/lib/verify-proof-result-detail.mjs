import { projectDiagnostic, STRUCTURED_DIAGNOSTIC_SCHEMA_VERSION }
  from "../../../wiki-core/src/lib/diagnostic-projection.mjs";
import { classifyMutationOutcome, countMutationOutcomes } from
  "@agent-chassis/controlled-contract/test-proof-mutation-outcome";
import { projectSelectedTestFailureDiagnostic, reportedTestFailureLocation } from
  "../../../agent-launch-cli/src/lib/workspace-agent-test-proof-error-diagnostic.mjs";
import { fitWholePrefix, projectVerifyProofSummaryRow } from "./verify-proof-result-summary.mjs";
const VERIFY_PROOF_TOOL_NAME = "workspace_verify_proof";
const TEST_ID_RE = /^test-[a-f0-9]{64}$/u;
const STABLE_CODE_RE = /^[a-z0-9_.-]{1,160}$/u;

export const VERIFY_PROOF_EVIDENCE_MEANING = Object.freeze({
  proof_observation: "selected test outcome as observed (passed, failed, skipped or another reported status); not_observed when no selected-test event was recorded",
  mutation_evidence: "additional falsification evidence for the same proof, per member: detected, survived (counterevidence), unavailable (a capability limitation: no credit and no counterevidence) or unevaluable",
  evaluator_outcome: "requirement relationship outcome for the tested source only; unproven includes behavioral coverage not established despite valid execution; not_executable means required evidence is incomplete or cannot be evaluated; native test outcomes remain separate"
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
    if (failed.length > 0 && failed.every(({ reason_code: code }) =>
      code === "verify_proof.behavioral_coverage_not_established.v1")) return Object.freeze({
      condition: "behavioral_coverage_not_established",
      diagnostic_codes: distinctDiagnosticCodes(failed),
      effect: "no requirement-satisfaction credit; the selected test's actual outcome and execution evaluation are preserved",
      responsible_actor: "verification_runtime_owner",
      next_step: "Read the recorded execution evidence and the linked requirements. This evaluator establishes no behavioral coverage; an unchanged-input retry is not implied."
    });
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

export const VERIFY_PROOF_TEST_FAILURE_DIAGNOSIS_SCHEMA_VERSION =
  "workspace-verify-proof-test-failure-diagnosis.v1";
const DIAGNOSIS_MESSAGE_INLINE_BYTES = 1024;
const DIAGNOSIS_RELATED_MESSAGE_INLINE_BYTES = 256;
const DIAGNOSIS_RELATED_ERROR_LIMIT = 3;
const DIAGNOSIS_IDENTITY_INLINE_BYTES = 160;
const DIAGNOSIS_RELATED_CODE_LIMIT = 16;
const DIAGNOSIS_ISSUE_LIMIT = 8;
const DIAGNOSIS_DETAIL_LIMIT = 8;
const utf8Bytes = (text) => Buffer.byteLength(text, "utf8");

export function distillSelectedTestFailure(selection, { complete = false } = {}) {
  const issues = Array.isArray(selection?.issues) ? selection.issues : [];
  const frame = {
    schema_version: VERIFY_PROOF_TEST_FAILURE_DIAGNOSIS_SCHEMA_VERSION,
    status: selection?.status ?? "invalid",
    ...(selection?.origin === undefined ? {} : { origin: { ...selection.origin } })
  };

  const issueFacts = { issues: issues.slice(0, complete ? issues.length : DIAGNOSIS_ISSUE_LIMIT).map(({ path, reason }) => ({ path, reason })),
    ...(complete || issues.length <= DIAGNOSIS_ISSUE_LIMIT ? {} : { issues_omitted: issues.length - DIAGNOSIS_ISSUE_LIMIT }) };
  const root = selection?.error;
  if (frame.status !== "captured" || root === null || typeof root !== "object") {
    return Object.freeze({ ...frame, ...issueFacts });
  }
  const retained = new Set();
  const related = [];
  const visit = (error, isRoot) => {
    if (error === null || typeof error !== "object" || error.ref !== undefined) return;
    if (!isRoot) related.push(error);
    if (error.stack !== undefined) retained.add("stack");
    if (!complete && error.native_details !== undefined) retained.add("native_details");
    if (error.cause !== undefined) visit(error.cause, false);
    for (const member of error.aggregate_errors ?? []) visit(member, false);
    for (const field of ["expected", "actual", "value"]) {
      if (error[field]?.type === "error") visit(error[field].error, false);
    }
  };
  visit(root, true);
  if (!complete && root.cause !== undefined) retained.add("cause");
  if (!complete && root.aggregate_errors !== undefined) retained.add("aggregate_errors");
  let remaining = complete ? Infinity : DIAGNOSIS_RELATED_ERROR_LIMIT;
  const projectError = (source, isRoot = false) => {
    if (source.ref !== undefined) return { ref: source.ref };
    if (!isRoot && remaining-- <= 0) return { deferred: true, ref: source.id,
      reason: "presentation_error_limit" };
    const error = complete && source.id !== undefined ? { id: source.id } : {};
    for (const field of ["name", "message", "code", "operator", "generated_message"]) {
      const value = source[field];
      if (value === undefined) continue;
      const limit = complete ? Infinity : field === "message" ? (isRoot ? DIAGNOSIS_MESSAGE_INLINE_BYTES
        : DIAGNOSIS_RELATED_MESSAGE_INLINE_BYTES) : DIAGNOSIS_IDENTITY_INLINE_BYTES;
      if (typeof value !== "string" || utf8Bytes(value) <= limit) error[field] = value;
      else if (field === "message") {

        let prefix = "";
        let bytes = 0;
        for (const character of value) {
          const size = utf8Bytes(character);
          if (bytes + size > limit) break;
          prefix += character;
          bytes += size;
        }
        error.message = prefix;
        error.message_presentation = { status: "partial", retained_utf8_bytes: utf8Bytes(value),
          returned_utf8_bytes: bytes, omitted_utf8_bytes: utf8Bytes(value) - bytes };
        retained.add(field);
      } else {
        error[`${field}_retained`] = { utf8_bytes: utf8Bytes(value) };
        retained.add(field);
      }
    }

    const location = source.location ?? (isRoot ? undefined
      : reportedTestFailureLocation(undefined, (source.stack ?? "").split("\n")));
    if (location !== undefined) {
      error.location = { ...location };
      if (source.location === undefined) error.location_source = "native_stack";
    }
    for (const field of ["expected", "actual", "value"]) {
      if (source[field] === undefined) continue;
      error[field] = source[field].type === "error" ? (complete ? { type: "error", error: projectError(source[field].error) } : { type: "error", deferred: true }) : { ...source[field] };
    }

    if (Array.isArray(source.native_details)) {
      error.native_details = source.native_details.slice(0, complete ? source.native_details.length : DIAGNOSIS_DETAIL_LIMIT)
        .filter(({ label }) => typeof label === "string" && (complete || utf8Bytes(label) <= DIAGNOSIS_IDENTITY_INLINE_BYTES))
        .map(({ label, text, utf8_bytes: bytes }) => complete ? { label, text, utf8_bytes: typeof text === "string" ? utf8Bytes(text) : bytes } : ({ label, deferred: true,
          utf8_bytes: typeof text === "string" ? utf8Bytes(text) : bytes }));
      const omitted = source.native_details.length - error.native_details.length;
      if (omitted > 0) error.native_details_omitted = omitted;
    }

    if (source.cause !== undefined && (complete || source.cause.value === undefined)) {
      error.cause = source.cause.value === undefined ? projectError(source.cause) : structuredClone(source.cause);
    }
    if (Array.isArray(source.aggregate_errors)) {
      error.aggregate_errors = [];
      for (const member of source.aggregate_errors) {
        if (remaining <= 0) break;
        error.aggregate_errors.push(projectError(member));
      }
      const omitted = source.aggregate_errors.length - error.aggregate_errors.length;
      if (omitted > 0) error.aggregate_errors_omitted = omitted;
    }
    return error;
  };
  const error = projectError(root, true);
  const codes = [...new Set(related.map(({ code }) => code).filter((code) =>
    typeof code === "string" && (complete || utf8Bytes(code) <= DIAGNOSIS_IDENTITY_INLINE_BYTES)))];
  return Object.freeze({
    ...frame,
    error,
    ...(related.length === 0 ? {} : { related_errors: {
      count: related.length,
      codes: complete ? codes : codes.slice(0, DIAGNOSIS_RELATED_CODE_LIMIT),
      codes_omitted: complete ? 0 : Math.max(0, codes.length - DIAGNOSIS_RELATED_CODE_LIMIT)
    } }),
    ...(retained.size === 0 ? {} : { retained_fields: [...retained].sort() }),
    ...issueFacts
  });
}

export function distillTestFailureDiagnostic(diagnostic, options) {
  return distillSelectedTestFailure(projectSelectedTestFailureDiagnostic(diagnostic), options);
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
    ...(result.proof_opt_outs === undefined ? {} : { proof_opt_outs: structuredClone(result.proof_opt_outs) }),

    ...(result.regression_results === undefined ? {} : {
      regression_results: structuredClone(result.regression_results) }),
    diagnostics: projectPublicDiagnostic(result.diagnostics ?? [], "diagnostics", redactions),
    diagnostic_redactions: redactions,

    ...(result.timing === undefined ? {} : { timing: structuredClone(result.timing) }),
    result_digest: result.result_digest,
    ...(result.reason_code === null ? {} : { reason_code: result.reason_code }),

    ...(result.reason_code === null || result.recovery === undefined ? {} : {
      recovery: structuredClone(result.recovery) })
  });
}

export const VERIFY_PROOF_REGRESSION_ROW_LIMIT = 8;

export const VERIFY_PROOF_REGRESSION_FACT_MAX_BYTES = 512;

const REGRESSION_DIAGNOSTIC_FACTS = Object.freeze(["runner_selection", "failure", "source_movement",
  "native_result_retention"]);

function boundedRegressionFact(fact) {
  return Object.fromEntries(Object.entries(fact).flatMap(([name, value]) => {
    if (typeof value !== "string") return [[name, structuredClone(value)]];
    const bytes = Buffer.byteLength(value, "utf8");
    return bytes <= VERIFY_PROOF_REGRESSION_FACT_MAX_BYTES ? [[name, value]]
      : [[`${name}_omitted`, { utf8_bytes: bytes }]];
  }));
}

function regressionDiagnosticMeaning(name, fact) {
  if (name !== 'runner_selection') return fact;
  const { file: _file, configuration: _configuration, correction: _setup, ...meaning } = fact;
  return { ...meaning,
    stopping_condition: "No MCP call can choose this file's runner. The configuration owner must resolve this selection before this file can execute." };
}

export function projectVerifyProofRegressions(evidence, { complete = false, problemsOnly = false } = {}) {
  const regressions = evidence?.regression_results;
  if (regressions === undefined || regressions === null) return undefined;
  const ordered = regressions.results.filter(row => !problemsOnly || row.status !== "passed")
    .map((row, index) => ({ row, index }))
    .sort((left, right) => Number(left.row.status === "passed") - Number(right.row.status === "passed") ||
      left.index - right.index);
  const kept = ordered.slice(0, complete ? ordered.length : VERIFY_PROOF_REGRESSION_ROW_LIMIT);
  return {
    source_unit: regressions.source_unit,
    proof_credit_granted: regressions.proof_credit_granted,
    counts: structuredClone(regressions.counts),
    results: kept.map(({ row }) => ({
      file: row.file,
      status: row.status,
      ...(row.reason_code === null || row.reason_code === undefined ? {} : { reason_code: row.reason_code }),
      ...(row.runner === undefined ? {} : { runner: row.runner.runner }),
      ...(row.execution === undefined ? {} : { exit_code: row.execution.exit_code }),
      ...(row.status === 'passed' || row.execution === undefined ? {} : { execution: {
        executed: row.execution.executed,
        ...(row.execution.signal == null ? {} : { signal: row.execution.signal }),
        ...Object.fromEntries(['timed_out', 'cancelled', 'cleanup_failed', 'output_lost']
          .filter(key => row.execution[key] === true).map(key => [key, true]))
      } }),
      ...(row.status === 'passed' || row.diagnosis === undefined ? {} : { diagnosis: structuredClone(row.diagnosis) }),

      ...(row.status === "passed" ? {} : Object.fromEntries(REGRESSION_DIAGNOSTIC_FACTS
        .filter((name) => row[name] !== null && typeof row[name] === "object")
        .map((name) => {
          const meaning = regressionDiagnosticMeaning(name, row[name]);
          return [name, complete ? structuredClone(meaning) : boundedRegressionFact(meaning)];
        }))),
      ...(row.native_read === undefined ? {} : { native_read: structuredClone(row.native_read) }),
      ...(row.native_diagnosis === undefined ? {} : { native_diagnosis: structuredClone(row.native_diagnosis) })
    })),
    ...(ordered.length === kept.length ? {} : { results_omitted: ordered.length - kept.length })
  };
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
  "case_id"]);
const isScalar = (value) => value === null || ["string", "number", "boolean"].includes(typeof value);

const MISSING_SELECTION_IDENTITY = Object.freeze(["code", "obligation_id", "field"]);
function missingSelectionFact(details) {
  const fact = details?.missing_selection;
  return fact !== null && typeof fact === "object" && !Array.isArray(fact) &&
    MISSING_SELECTION_IDENTITY.every((key) => typeof fact[key] === "string")
    ? Object.fromEntries(MISSING_SELECTION_IDENTITY.map((key) => [key, fact[key]])) : null;
}

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
    const missingSelection = missingSelectionFact(details);
    if (missingSelection !== null) {
      facts.missing_selection = missingSelection;
      published.add("missing_selection");
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

function selectedTestFailure(proof, complete) {
  const observed = proof.observed_evidence;
  if ((observed === undefined || observed === null) && proof.selected_observation !== undefined) {
    const { test_id: testId, file, name, status, skip_phase: skipPhase,
      skip_reason: skipReason } = proof.selected_observation;

    return { state: "observed", test_id: testId, file, name, status,
      ...(skipPhase === undefined ? {} : { skip_phase: skipPhase }),
      ...(skipReason === undefined ? {} : { skip_reason: skipReason }) };
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
        : distillTestFailureDiagnostic(event.failure_diagnostic, { complete })
    })
  };
}

function selectedFailedRelationships(proof, subject) {
  const byObligation = subject !== proof.test_proof_id;
  return (proof.relationship_results ?? []).filter(({ obligation_id: id, status }) =>
    (!byObligation || id === subject) && status !== "proven");
}

const CHECK_LIMITATION_PROPERTIES = Object.freeze({
  body_not_single_scalar_return: 'The function body is not exactly one scalar literal return.',
  return_not_scalar: 'The return is not a supported scalar literal.',
  return_literal_unsupported: 'The returned expression is not a supported scalar literal.',
  async_function_unsupported: 'The function is asynchronous.',
  function_not_synchronous: 'The function is not synchronous.',
  decorated_function_unsupported: 'The function is decorated.',
  function_generic: 'The function is generic.'
});

export function projectProofCheckLimitations(proof) {
  return (proof.observed_evidence?.capability_limitations ?? []).map(limitation => {
    const member = limitation.check_kind === 'falsifier'
      ? proof.observed_evidence?.falsifier_outcomes?.find(row => row.falsifier_id === limitation.check_id)
      : undefined;
    const mutation = member?.mutation;
    const reason = limitation.detail?.reason;
    return {
      ...structuredClone(limitation),
      ...(mutation?.strategy === undefined ? {} : { strategy: mutation.strategy }),
      ...(mutation?.module_path === undefined ? {} : { module_path: mutation.module_path }),
      ...(mutation?.function_name === undefined ? {} : { function_name: mutation.function_name }),
      ...(CHECK_LIMITATION_PROPERTIES[reason] === undefined ? {} : {
        explanation: CHECK_LIMITATION_PROPERTIES[reason] }),
      next_step: 'Report this check’s capability limitation alongside the candidate outcome. ' +
        'This result establishes no retry, waiver or production-code repair.'
    };
  });
}

export function projectProofTraversal(proof, { complete = false, problemsOnly = false } = {}) {
  const observations = (proof.observed_evidence?.traversal_observations ?? [])
    .filter(row => !problemsOnly || !row.observed || !row.target_pass_observed);
  if (observations.length === 0) return undefined;
  const kept = complete ? observations : observations.slice(0, 8);
  return { total: observations.length, omitted: observations.length - kept.length,
    observations: kept.map((entry) => ({ ...entry,
      meaning: entry.observed
        ? entry.target_pass_observed ? "implementation reached; selected test passed"
          : "implementation reached; selected test failed"
        : "required reach not observed" })) };
}

function projectSelectedProof(proof, subject, ids, complete) {
  const row = projectVerifyProofSummaryRow(proof, { complete });
  const byObligation = subject !== proof.test_proof_id;
  return {
    ...row,
    ...(proof.observed_evidence?.capability_limitations?.length ? {
      check_limitations: projectProofCheckLimitations(proof) } : {}),

    ...(proof.timing === undefined ? {} : { timing: structuredClone(proof.timing) }),
    obligations: row.obligations.filter(({ obligation_id: id }) => !byObligation || id === subject),
    ...(proof.status === "proven" ? {} : {
      failure: {
        ...(proof.reason_code === undefined ? {} : { reason_code: proof.reason_code }),
        selected_test: selectedTestFailure(proof, complete),
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

export function projectVerifyProofSelectedDetail(evidence, subject, { fits = () => true, completeDiagnosis = false } = {}) {
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
      proofs: proofs.map((proof) => projectSelectedProof(proof, subject, ids, completeDiagnosis)),

      ...(projectVerifyProofRegressions(evidence) === undefined ? {}
        : { regressions: projectVerifyProofRegressions(evidence, { complete: completeDiagnosis, problemsOnly: true }) })
    };
  };
  return fitWholePrefix(total, build, fits);
}
