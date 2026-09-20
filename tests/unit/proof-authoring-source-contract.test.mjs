import test from 'node:test';
import assert from 'node:assert/strict';
import { validateObligationCoverageDraft as draft, validateObligationCoverageCarrier as complete } from '@agent-chassis/controlled-contract';
const source = () => ({ schema_version: 'controlled-contract-obligation-coverage.v3', wk_id: 'WK-0001', selected_unit: null, focus: null, obligations: [{ obligation_id: 'OBL-ONE' }] });
test('draft and complete readers admit distinct current representations', () => {
  assert.equal(draft(source()).valid, true);
  assert.equal(complete(source()).diagnostics[0].code, 'obligation_coverage_resolution_required');
  assert.equal(draft({ ...source(), schema_version: 'controlled-contract-obligation-coverage.v2' }).valid, false);
  assert.equal(complete({ ...source(), schema_version: 'controlled-contract-obligation-coverage.v2' }).valid, false);
  assert.equal(complete({ ...source(), schema_version: 'resolved-obligation-coverage.v1' }).valid, false);
});
test('drafts enforce one identity, complete pins and bounded JSON without requiring proof inputs', () => {
  const s = source(); s.obligations.push({ obligation_id: 'OBL-ONE' }); assert.equal(draft(s).valid, false);
  for (const value of [undefined, NaN, Infinity, new Date(), () => {}, 1n]) {
    const s = source(); s.obligations[0].selection = { proof_name: null, proof_version: null, profile_digest: null,
      parameter_contract_digest: null, admission_digest: null, parameters: { value } };
    assert.equal(draft(s).valid, false);
  }
  const large = source(); large.obligations[0].statement = 'x'.repeat(1048576);
  assert.equal(draft(large).diagnostics.some(d => d.code === 'obligation_coverage_carrier_oversize'), true);
  const selected = source(); selected.selected_unit = 'SLICE-001'; selected.focus = 'independent-focus';
  assert.equal(draft(selected).valid, true);
});

test('complete definition identities cannot contain draft null pins', () => {
  const validation = complete({ schema_version: 'resolved-obligation-coverage.v1', wk_id: 'WK-0001',
    selected_unit: null, focus: null, source_digest: `sha256:${'a'.repeat(64)}`, context_digest: `sha256:${'b'.repeat(64)}`,
    obligations: [], definition_identities: [{ proof_name: null, proof_version: null, profile_digest: null,
      parameter_contract_digest: null, admission_digest: null }] });
  assert.equal(validation.valid, false);
});

test('WK-2567 complete carriers admit nonblocking context but reject contradictory route effects', () => {
  const exactPin = { proof_name: 'proof.example', proof_version: '1.0.0',
    profile_digest: 'c'.repeat(64),
    parameter_contract_digest: 'd'.repeat(64),
    admission_digest: 'e'.repeat(64) };
  const routeAssessment = { schema_version: 'selected-proof-diagnostic-route-assessment.v1',
    effect: 'nonblocking', stage: 'system_capability',
    selected_route: 'provider_bound_test_validity',
    owner_code: 'obligation_coverage_construction_unavailable',
    reason: 'The selected native test route does not require the generic constructor.',
    unavailable_operation: { kind: 'constructor', id: 'construction',
      identity: null, state: 'unavailable', description: 'No generic constructor' },
    responsible_owner: '@agent-chassis/controlled-contract', recovery: {
      status: 'not_required', supported_next_call: null, operator_action: null,
      explanation: 'The generic constructor is not required by the selected route.' } };
  const emptyStage = status => ({ status, diagnostic_codes: [],
    blocking_diagnostic_codes: [], nonblocking_diagnostic_codes: [],
    unresolved_diagnostic_codes: [] });
  const selectedAssessment = {
    schema_version: 'selected-proof-prerequisite-assessment.v1',
    definition: exactPin,
    assessment_status: 'resolved', execution_family: 'provider_bound_test_validity',
    semantic_inputs: [], canonical_inputs: [], required_observations: [],
    requirements: { authored_case: 'required', native_test_binding: 'required',
      declared_test_target: 'required', test_execution_evidence: 'required' },
    authored_case: { status: 'complete', case_id: 'case-complete' },
    native_test_binding: { status: 'complete', binding_count: 1,
      verification_id: 'claim-complete', test_proof_id: 'test-proof-complete',
      problem: null },
    declared_test_target: { status: 'complete', binding_count: 1,
      verification_id: 'claim-complete' },
    capability_contract: { construction: null, dependencies: {} },
    unresolved_diagnostic_codes: [],
    stages: {
      authored_inputs: emptyStage('complete'),
      canonical_sources: emptyStage('current'),
      system_capability: { ...emptyStage('available'),
        nonblocking_diagnostic_codes: [routeAssessment.owner_code],
        satisfied_by: 'native_provider_bound_test_binding', blockers: [] },
      execution_evidence: { status: 'not_started', credit_granted: 0,
        required_observations: [] }
    },
    prevents_selected_route: false, readiness_status: 'complete'
  };
  const carrier = { schema_version: 'resolved-obligation-coverage.v1',
    wk_id: 'WK-0001', selected_unit: null, focus: null,
    source_digest: `sha256:${'a'.repeat(64)}`,
    context_digest: `sha256:${'b'.repeat(64)}`,
    definition_identities: [exactPin], obligations: [{ obligation_id: 'OBL-ONE',
      selection: { ...exactPin, parameters: {} }, design_status: 'valid',
      resolved_identity: 'f'.repeat(64),
      selected_proof_assessment: selectedAssessment,
      diagnostics: [{ code: routeAssessment.owner_code, path: '/construction',
        reason: 'No generic constructor', owner: '@agent-chassis/controlled-contract',
        problem: { category: 'system_capability', severity: 'unspecified',
          cause: {}, route_assessment: routeAssessment } }] }] };
  assert.equal(complete(carrier).valid, true);
  const blocking = structuredClone(carrier);
  blocking.obligations[0].diagnostics[0].problem.route_assessment.effect = 'blocking';
  assert.equal(complete(blocking).valid, false);
  assert.ok(complete(blocking).diagnostics.some(diagnostic =>
    diagnostic.code === 'obligation_coverage_design_status_inconsistent'));
  const incomplete = structuredClone(carrier);
  incomplete.obligations[0].selected_proof_assessment.readiness_status = 'incomplete';
  assert.equal(complete(incomplete).valid, false);
  const missingAssessment = structuredClone(carrier);
  delete missingAssessment.obligations[0].diagnostics[0].problem.route_assessment;
  assert.equal(complete(missingAssessment).schema_valid, false);
});
