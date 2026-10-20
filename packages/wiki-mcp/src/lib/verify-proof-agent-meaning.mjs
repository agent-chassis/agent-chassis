

function publicDiagnosticMeaning(value) {
  if (Array.isArray(value)) return value.map(publicDiagnosticMeaning);
  if (value === null || typeof value !== 'object') return value;
  const diagnosis = value.schema_version === 'workspace-verify-proof-test-failure-diagnosis.v1';
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !diagnosis || !['schema_version', 'retained_fields', 'related_errors'].includes(key))
    .filter(([key, entry]) => !diagnosis || key !== 'issues' || entry.length > 0)
    .map(([key, entry]) => [key, publicDiagnosticMeaning(entry)]));
}

export function publicProofRelationshipDiagnostic(value) {
  if (value.reason_code !== 'verify_proof.qualifying_verification_ambiguous.v1' ||
      !Array.isArray(value.verification_ids)) return publicDiagnosticMeaning(value);
  return { obligation_id: value.obligation_id, reason_code: value.reason_code,
    field: 'obligations[].claims',
    cause: 'Several saved verifications qualify for this obligation; its intended verification association is unresolved.',
    ...(value.verification_ids_total === undefined ? {} : { competing_verification_count: value.verification_ids_total }) };
}

export function publicProofFailureMeaning(failure) {
  const meaning = publicDiagnosticMeaning(failure);
  return { ...meaning, ...(meaning.relationships === undefined ? {} : {
    relationships: meaning.relationships.map(row => ({ ...row,
      diagnostics: row.diagnostics.map(publicProofRelationshipDiagnostic) }))
  }) };
}

export function publicProofRecoveryMeaning(recovery, proofSubject = undefined) {
  if (recovery === undefined) return undefined;
  if (recovery.condition === 'behavioral_coverage_not_established') return {
    condition: recovery.condition,
    effect: 'No requirement-satisfaction credit; the selected test outcome stands.',
    next_step: 'Report this limit; no unchanged-input retry is indicated.'
  };
  const { authoring_source: _source, recovery_call: _call, subject,
    repair, acquisition, ...meaning } = recovery;
  return { ...publicDiagnosticMeaning(meaning),
    ...(subject === undefined || subject.test_proof_id === proofSubject &&
      Object.keys(subject).every(key => ['test_proof_id', 'verification_id'].includes(key)) ? {} : { subject }),
    ...(repair === undefined ? {} : { repair: {
      required_meaning: repair.required_meaning, next_step: repair.next_step
    } }),
    ...(acquisition === undefined ? {} : { acquisition: {
      state: acquisition.state,
      missing_capability: acquisition.missing_capability, reason: acquisition.reason,
      source: { unit: acquisition.source.unit,
        ...(acquisition.source.focus_status === 'unknown' ? { focus_status: 'unknown' }
          : { focus: acquisition.source.focus }) },
      obligation_ids: acquisition.obligation_ids,
      ...(acquisition.cause === undefined ? {} : { cause: acquisition.cause }),
      correction_boundary: acquisition.correction_boundary
    } }) };
}

export function publicProofSelectedTest(selected) {
  if (selected === undefined) return undefined;
  return Object.fromEntries(['file', 'name', 'node_id', 'nesting']
    .filter(key => selected[key] !== undefined).map(key => [key, selected[key]]));
}

export function publicProofSelectedRow(proof) {
  const { timing: _timing, readiness_status: _readiness, verification_id: _verification,
    capability_limitations: _codes, declared_target: target, selected_test: selected,
    reason, failure, obligations, ...facts } = proof;
  const failures = new Map((failure?.relationships ?? []).map(row => [row.obligation_id, row]));
  const selectedTest = publicProofSelectedTest(selected);
  let selectedFailure;
  const failedTest = failure?.selected_test;
  if (failedTest !== undefined && (failedTest.diagnostic !== undefined ||
      failedTest.skip_phase !== undefined || failedTest.skip_reason !== undefined)) {
    const { test_id: _testIdentity, selected_test_id: _expectedIdentity, status: _status,
      file, name, ...cause } = failure.selected_test;
    selectedFailure = { ...publicDiagnosticMeaning(cause),
      ...(file === undefined || file === selectedTest?.file ? {} : { file }),
      ...(name === undefined || name === selectedTest?.name ? {} : { name }) };
  }
  return { ...facts,
    ...(target === undefined || target === selectedTest?.file ? {} : { declared_target: target }),
    ...(selectedTest === undefined ? {} : { selected_test: selectedTest }),
    ...(reason === undefined ? {} : { reason: { reason_code: reason.reason_code,
      ...(reason.recovery === undefined ? {} : { recovery: publicProofRecoveryMeaning(reason.recovery, proof.test_proof_id) }) } }),
    obligations: obligations.map(({ reason: relationshipReason, ...relationship }) => ({
      ...relationship,
      ...(relationshipReason?.reason_code == null ? {} : { reason_code: relationshipReason.reason_code }),
      ...(failures.get(relationship.obligation_id)?.diagnostics.length
        ? { diagnostics: failures.get(relationship.obligation_id).diagnostics.map(publicProofRelationshipDiagnostic) } : {})
    })),
    ...(selectedFailure === undefined ? {} : { failure: { selected_test: selectedFailure } }) };
}
