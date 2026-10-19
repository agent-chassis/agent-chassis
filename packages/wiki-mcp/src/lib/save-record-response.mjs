

const present = value => value !== undefined && value !== null;
const nonempty = value => Array.isArray(value) ? value.length > 0
  : value !== null && typeof value === 'object' ? Object.keys(value).length > 0 : present(value);
const pick = (value, names) => Object.fromEntries(names.filter(name => present(value?.[name]))
  .map(name => [name, value[name]]));
const saveEffects = value => pick(value, ['published', 'record_written', 'semantic_sources_written',
  'contract_written', 'retry_safe', 'compensated', 'publication_phase', 'commit_state',
  'canonical_mutation_repeated', 'checks_ran']);

const INTERNAL_FAILURE_MEMBERS = new Set(['stack', 'schema_version', 'checked_corpus', 'checked_source',
  'record_source_digest', 'content_digest', 'source_digest', 'source_generation', 'authority_identity',
  'query_identity', 'observation_identity', 'retention_failure', 'guidance_path', 'stdout', 'stderr', 'raw_output',
  'effect_trace', 'failed_fault', 'authority_limb', 'diagnostic_count']);
export function saveRecordFailureMeaning(value) {
  if (Array.isArray(value)) return value.map(saveRecordFailureMeaning);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !INTERNAL_FAILURE_MEMBERS.has(key) && !key.endsWith('_digest'))
    .map(([key, member]) => [key, saveRecordFailureMeaning(member)]));
}

function persistenceMeaning(value, cleanupRecoverable) {
  const coveredCleanup = cleanupRecoverable && value.diagnostics?.every(entry => entry.phase === 'cleanup');
  const diagnostics = (coveredCleanup ? [] : value.diagnostics ?? []).map(({ category, operation, producer_diagnostic, ...diagnostic }) => ({
    ...diagnostic,
    ...(producer_diagnostic === undefined || JSON.stringify(producer_diagnostic) === JSON.stringify(diagnostic.cause)
      ? {} : { producer_diagnostic }) }));
  const participants = Object.fromEntries(Object.entries(value.participants ?? {})
    .map(([subject, result]) => [subject, pick(result, ['publication_state'])]));
  const publications = (value.admission_sidecar_publications ?? []).filter(entry => entry.created === true)
    .map(entry => pick(entry, ['sidecar_path']));
  const cleanup = Object.fromEntries(Object.entries(pick(value.admission_sidecar_cleanup, coveredCleanup ? ['removed'] : ['removed', 'failed']))
    .filter(([, members]) => nonempty(members)));
  return saveRecordFailureMeaning({ ...(diagnostics.length ? { diagnostics } : {}),
    ...(nonempty(participants) ? { participants } : {}),
    ...(publications.length ? { admission_sidecar_publications: publications } : {}),
    ...(nonempty(cleanup) ? { admission_sidecar_cleanup: cleanup } : {}),
    ...(coveredCleanup ? {} : { recovery: cleanupRecoverable ? {
      correction: 'Canonical publication stands. Use the returned maintenance_retry call to finish unresolved artifact cleanup; successful checks are preserved.' }
      : { missing_capability: 'save_persistence_recovery',
        correction: 'No supported call repairs or reconciles this persistence failure. Preserve the reported effects; do not replay the canonical mutation.' } }) });
}

export function saveRecordIdentityBindings(body) {
  const bindings = Object.fromEntries(Object.entries(body.bindings ?? {}).filter(([, rows]) => nonempty(rows)));

  if (bindings.requirement !== undefined) bindings.requirement = Object.fromEntries(
    Object.entries(bindings.requirement).map(([key, identity]) => {
      const row = body.requirement_rows?.rows.find(row => row.key === key);
      return [key, { ...identity, ...(row?.verification_claim_id !== undefined && row.verification_key === undefined
        ? { verification_claim_id: row.verification_claim_id } : {}) }];
    }));
  return bindings;
}

export function saveRecordMaintenanceMeaning(body) {
  const maintenance = body.maintenance ?? body.result ?? (body.members === undefined ? null : body);
  if (maintenance === null) return null;
  const failures = (maintenance.members ?? []).flatMap(({ member, state, check }) => {
    const actionable = state !== 'succeeded' || check?.cause_code != null || check?.cause_message != null;
    if (!actionable) return [];

    const afterChecks = state === 'succeeded';
    return [{ member, state,
      ...(afterChecks ? { failure_stage: 'after_completed_checks', unavailable: {
        missing_capability: 'maintenance_post_check_recovery',
        correction: 'Checks completed, but the executor then reported this failure. No supported call repairs that post-check failure; do not repeat the save or rerun successful checks.' } } : {}),
      ...(check?.cause_code == null && check?.cause_message == null ? {} : {
        cause: { code: check.cause_code, message: check.cause_message } }),
      ...(nonempty(check?.top_findings) ? { findings: saveRecordFailureMeaning(check.top_findings) } : {}),
      ...(nonempty(check?.warnings) ? { warnings: saveRecordFailureMeaning(check.warnings) } : {}),
      ...(state !== 'succeeded' && check !== undefined && check.cause_code == null && check.cause_message == null &&
        !nonempty(check.top_findings) && !nonempty(check.warnings) ? {
          unavailable: { missing_capability: 'maintenance_member_failure_diagnosis',
            correction: `The ${member} owner reported ${state} without a specific cause. Stop this recovery; do not retry unchanged to discover the diagnosis.` }
        } : {}),
      ...(check === undefined ? {} : { effects: pick(check, ['ran', 'generated_views', 'write_effects_retained']),
        ...(check.next_action == null ? {} : { correction: check.next_action }) }) }];
  });
  const coordinationOnly = (maintenance.coordination ?? body.coordination)?.stage === 'settled_attempt' &&
    (maintenance.members ?? []).length > 0 && failures.length === 0;
  const cause = coordinationOnly ? undefined : maintenance.cause ?? body.coordination?.cause;
  const state = coordinationOnly ? undefined : maintenance.state ?? (['maintenance_attempt_in_progress', 'maintenance_attempt_outcome_unknown']
    .includes(body.outcome) ? body.outcome : undefined);
  if (failures.length === 0 && cause === undefined && state === undefined) return null;
  return { ...(state === undefined ? {} : { state }),
    ...(failures.length === 0 ? {} : { failures }),
    ...(cause === undefined ? {} : { cause: saveRecordFailureMeaning(cause) }),
    ...(state === undefined && cause === undefined ? {} : { effects: {
      ...pick(maintenance.effects, ['checks_ran']),

      ...Object.fromEntries((maintenance.members ?? []).filter(member => member.check !== undefined)
        .map(member => [member.member, pick(member.check, ['ran', 'generated_views', 'write_effects_retained'])])) } }),
    ...(maintenance.checked_source?.moved_since_save === true ? { checked_state: 'newer_than_save' } : {}) };
}

export function projectSaveRecordResponse(body) {
  const response = pick(body, ['outcome', 'unit', 'revision']);
  const bindings = saveRecordIdentityBindings(body);
  if (nonempty(bindings)) response.bindings = bindings;

  const rows = body.requirement_rows?.rows.filter(row => row.key === undefined) ?? [];
  const collections = body.requirement_rows?.collections.filter(row => row.key === undefined) ?? [];
  if (rows.length > 0 || collections.length > 0) response.requirement_rows = {
    ...(rows.length === 0 ? {} : { rows }), ...(collections.length === 0 ? {} : { collections }) };
  const versions = (body.entries ?? []).filter(entry => entry.version_id !== undefined)
    .map(entry => pick(entry, ['entry_id', 'version_id']));
  if (versions.length > 0) response.entries = versions;
  if (nonempty(body.criterion_identity_changes)) response.criterion_identity_changes = body.criterion_identity_changes;
  if (body.exception !== undefined) response.exception = pick(body.exception,
    ['kind', 'action', 'subject', 'consequence', 'enforcement']);
  for (const name of ['diagnostics', 'cause', 'failure', 'recovery']) {
    if (nonempty(body[name])) response[name] = saveRecordFailureMeaning(body[name]);
  }
  const persistenceFailed = nonempty(body.persistence) && !(body.cleanup_resolved === true && body.persistence.diagnostics?.every(entry => entry.phase === 'cleanup'));
  if (persistenceFailed) {
    response.persistence = persistenceMeaning(body.persistence,
      (body.maintenance?.members ?? body.result?.members ?? []).some(member => member.member === 'admission_artifact_cleanup'));
  }
  if (['refused', 'failed'].includes(body.outcome) || body.outcome?.startsWith('mutation_') || persistenceFailed) {
    response.effects = saveEffects(body.effects);
  }
  const maintenance = saveRecordMaintenanceMeaning(body);
  if (maintenance !== null) {
    response.maintenance = maintenance;
    response.effects = { ...response.effects,
      ...pick(body.effects ?? body.original?.effects, ['published', 'canonical_mutation_repeated', 'checks_ran']) };
  }
  if (body.outcome === 'joined_attempt') response.outcome = body.result === undefined
    ? 'maintenance_outcome_unavailable'
    : (maintenance?.failures?.length > 0 ? 'maintenance_failed' : 'maintenance_succeeded');
  if (body.outcome === undefined && body.operation !== undefined && body.members !== undefined) {
    response.outcome = maintenance?.failures?.length > 0 ? 'maintenance_failed' : 'maintenance_succeeded';
  }
  if (body.outcome === 'maintenance_succeeded' && maintenance?.failures?.length > 0) response.outcome = 'maintenance_failed';
  if (body.outcome === 'maintenance_attempt_outcome_unknown' && body.result?.members?.length > 0 && maintenance === null) {
    response.outcome = 'maintenance_succeeded';
  }
  return response;
}
