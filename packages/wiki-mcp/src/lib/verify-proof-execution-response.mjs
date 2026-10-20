

import { projectVerifyProofSummary, isRoutineVerifyProofSuccess } from './verify-proof-result-summary.mjs';
import { classifyMutationOutcome } from '@agent-chassis/controlled-contract/test-proof-mutation-outcome';
import { projectPublicVerifyProofRefusal, verifyProofSourceAmbiguityChoices } from './dispatch-run-proof-verification.mjs';
import { projectVerifyProofRegressions } from './verify-proof-result-detail.mjs';
import { isDeepStrictEqual } from 'node:util';
import { publicProofRecoveryMeaning as recoveryMeaning, publicProofSelectedTest,
  publicProofFailureMeaning, publicProofRelationshipDiagnostic } from './verify-proof-agent-meaning.mjs';

export function projectVerifyProofTestedSource(binding) {
  if (binding == null) return undefined;
  const candidate = binding.candidate_identity;
  if (candidate == null || typeof candidate !== 'object') return undefined;
  if (candidate.commit === undefined && candidate.resolved_branch === undefined) return undefined;
  return { candidate_identity: {
    ...(candidate.commit === undefined ? {} : { commit: candidate.commit }),
    ...(candidate.resolved_branch === undefined ? {} : { resolved_branch: {
      selector: candidate.resolved_branch.selector,
      branch: candidate.resolved_branch.branch,
      commit: candidate.resolved_branch.commit
    } })
  } };
}

function compactRow(row) {
  const { verification_id: _verification, readiness_status: _ready, timing: _timing,
    capability_limitations: _limitations,
    declared_target: _target, environment: _environment, selected_test: selected,
    ...meaning } = row;
  return { ...meaning, ...(selected === undefined ? {} : { selected_test: publicProofSelectedTest(selected) }) };
}

function decidingChecks(proof) {
  return (proof.observed_evidence?.falsifier_outcomes ?? [])
    .filter(row => ['survived', 'unevaluable'].includes(classifyMutationOutcome(row)))
    .map(row => ({ falsifier_id: row.falsifier_id, outcome: classifyMutationOutcome(row),
      provider_support: row.provider_support, isolated: row.isolated,
      candidate_status: row.candidate_status, falsified_status: row.falsified_status,
      mutation_observed: row.mutation_observed, mutation: row.mutation }));
}

function diagnosisIncomplete(value) {
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, entry]) =>
    key === 'deferred' && entry === true || key === 'message_presentation' ||
    key.endsWith('_omitted') && typeof entry === 'number' && entry > 0 || diagnosisIncomplete(entry));
}

function compactAnswer(summary, evidence, population) {
  const originals = new Map(evidence.proof_results.map(proof => [proof.test_proof_id, proof]));
  const selected = new Map((summary.selected_detail?.proofs ?? [])
    .map(proof => [proof.test_proof_id, proof]));
  const reasons = {};
  const references = new Map();
  const reasonRef = meaning => {
    const key = JSON.stringify(meaning);
    if (!references.has(key)) {
      const id = `reason-${references.size + 1}`;
      references.set(key, id); reasons[id] = meaning;
    }
    return references.get(key);
  };
  const rows = new Map(summary.proofs.map(row => [row.test_proof_id, row]));
  for (const [id, row] of selected) rows.set(id, row);
  const proofs = [...rows.values()].map(row => {
    const original = originals.get(row.test_proof_id);
    const { reason: _reason, failure: _failure, check_limitations: _limitations, ...facts } = compactRow(row);
    const reason = original.status === 'proven' ? undefined : reasonRef({ reason_code: original.reason_code ?? null,
      ...(original.recovery === undefined ? {} : { recovery: recoveryMeaning(original.recovery, original.test_proof_id) }) });
    facts.obligations = facts.obligations.map(({ reason: old, diagnostics, ...obligation }) => {
      const entry = typeof old === 'string' ? summary.reasons[old] : old;
      return { ...obligation, ...(diagnostics === undefined ? {} : {
        diagnostics: diagnostics.map(publicProofRelationshipDiagnostic)
      }), ...(entry === undefined ? {} : { reason: reasonRef({
        reason_code: entry.reason_code,
        ...(entry.diagnostic_codes?.length ? { diagnostic_codes: entry.diagnostic_codes } : {})
      }) }) };
    });
    const detail = selected.get(row.test_proof_id);
    const checks = decidingChecks(original);
    return { ...facts, ...(reason === undefined ? {} : { reason }),
      ...(detail?.failure === undefined || isRoutineVerifyProofSuccess(original) ? {} : { failure: publicProofFailureMeaning(detail.failure) }),
      ...(detail?.check_limitations === undefined || !population ? {} : { check_limitations: detail.check_limitations }),
      ...(checks.length === 0 ? {} : { checks }) };
  });
  const binding = projectVerifyProofTestedSource(summary.subject_binding);
  const source = evidence.execution_source_binding;
  return {
    schema_version: 'verify-proof-execution-outcome.v1',
    subject: { requested: summary.subject.requested },
    ...(binding === undefined ? {} : { subject_binding: binding }),
    ...(typeof source?.wk_id !== 'string' ? {} : { authored_source: {
      unit: source.selected_unit == null ? source.wk_id : `${source.wk_id}#${source.selected_unit}`,
      ...(source.focus == null ? {} : { focus: source.focus })
    } }),
    status: summary.status,
    counts: {
      proofs: Object.fromEntries(['total', 'proven', 'unproven', 'not_executable']
        .map(key => [key, summary.counts.proofs[key]])),
      obligation_relationships: summary.counts.obligation_relationships
    },
    execution: summary.execution,
    ...(summary.limitations === undefined ? {} : { limitations: summary.limitations }),
    ...(evidence.execution_effects === undefined ? {} : { execution_effects: evidence.execution_effects }),
    ...(summary.reason_code === undefined ? {} : { reason_code: summary.reason_code }),
    ...(summary.recovery === undefined ? {} : { recovery: recoveryMeaning(evidence.recovery) }),
    ...(summary.proof_opt_outs === undefined ? {} : { proof_opt_outs: summary.proof_opt_outs }),
    ...(evidence.regression_results === undefined ? {} : { regressions: projectVerifyProofRegressions(evidence,
      { complete: true, problemsOnly: !population }) }),
    proofs,
    ...(summary.proofs_omitted === 0 ? {} : {
      proofs_omitted: summary.proofs_omitted,
      proofs_omitted_by_status: summary.proofs_omitted_by_status,
      limitation: 'Some proof outcomes are omitted; the returned proof_population read supplies the complete selected population.'
    }),
    ...(Object.keys(reasons).length === 0 ? {} : { reasons }),
    next_calls: summary.next_calls.filter(call => {
      if (call.purpose === 'proof_population' || call.purpose === 'proof_detail') return true;
      if (call.tool !== 'get_run_result' || call.arguments.proof?.subject === undefined) return true;
      const subject = call.arguments.proof.subject;
      const row = evidence.proof_results.find(proof => proof.test_proof_id === subject ||
        proof.relationship_results.some(relation => relation.obligation_id === subject));
      if (row === undefined) return true;
      const detail = selected.get(row.test_proof_id);
      if (detail?.failure !== undefined && !diagnosisIncomplete(detail.failure)) return false;
      return row.recovery?.condition !== 'behavioral_coverage_not_established';
    })
  };
}

export function projectVerifyProofExecutionResponse(evidence, {
  fits = () => true, selectedFits = fits, population = false, ...selection
} = {}) {
  return compactAnswer(projectVerifyProofSummary(evidence, {
    ...selection, population,
    fits: candidate => fits(compactAnswer(candidate, evidence, population)),
    selectedFits: candidate => selectedFits(compactAnswer(candidate, evidence, population))
  }), evidence, population);
}

export function projectVerifyProofExecutionRefusal(evidence, { executionCall, request }) {
  const choices = verifyProofSourceAmbiguityChoices(evidence);
  const { schema_version: _schema, counts: _counts, proof_results: _rows,
    subject_binding: _binding, diagnostic_redactions: _redactions, timing: _timing,
    refused_source: _refusedSource,
    authority_limb: _authority, ...meaning } = projectPublicVerifyProofRefusal(evidence,
    choices === null ? {} : { retentionFailed: true });
  const recovery = meaning.recovery;
  let recoveryFacts = recovery.facts;
  const nextCalls = [...meaning.next_calls];
  if (evidence.reason_code === 'verify_proof.source_subject_conflict.v1') {
    const { source: _source, ...corrected } = request;
    nextCalls.push(executionCall(corrected));
  }
  if (evidence.reason_code === 'verify_proof.environment_incompatible.v1') {
    for (const environment of recovery.facts.valid_choices) {
      nextCalls.push(executionCall({ ...request, environment }));
    }
    const { environment: _environment, ...independentRouting } = request;
    nextCalls.push(executionCall(independentRouting));
    const { prepared_environments: _inventory, valid_choices: _choices, ...problem } = recovery.facts;
    recoveryFacts = problem;
  }
  let stoppingCondition;
  if (evidence.reason_code === 'verify_proof.role_ineligible.v1') {
    stoppingCondition = 'This session has no eligible proof-execution authority. A separately authorized task/session is required.';
  } else if (['verify_proof.git_sha_role_forbidden.v1', 'verify_proof.branch_role_forbidden.v1']
    .includes(evidence.reason_code)) {
    stoppingCondition = 'This session cannot select replacement code. Use its authenticated bound source only if that is the intended task; otherwise a separately authorized session is required.';
  }
  return {
    ...meaning,
    diagnostics: meaning.diagnostics.map(({ owning_boundary: _owner, details, ...problem }) => {
      if (details === null || typeof details !== 'object') return { ...problem, details };
      const { authority_limb: _limb, admissibility_effect: _admissibility,
        recovery_call: _privateCall, authoring_source: _authoring, ...cause } = details;
      const unique = Object.fromEntries(Object.entries(cause).filter(([key, value]) =>
        !Object.hasOwn(recovery.facts ?? {}, key) || !isDeepStrictEqual(recovery.facts[key], value)));
      return { ...problem, ...(Object.keys(unique).length === 0 ? {} : { details: unique }) };
    }),
    recovery: { ...recovery,
      ...(recoveryFacts === undefined ? {} : { facts: recoveryFacts }),
      ...(choices !== null || recovery.retry_operation === undefined ? {} : { previous_execution: request }) },
    ...(stoppingCondition === undefined ? {} : { stopping_condition: stoppingCondition }),
    next_calls: nextCalls,
    ...(choices === null ? {} : { source_selection: { choice_count: choices.length },
      next_calls: choices.map(choice => executionCall(choice.arguments)) })
  };
}
