

import { saveRecordIdentityBindings, saveRecordMaintenanceMeaning } from './save-record-response.mjs';
export function creationFacts(body) {
  const published = body.effects?.published;
  const result = { outcome: published === true ? 'created' : published === 'unknown' ? 'unknown' : body.outcome,
    effects: { published } };
  if (published === true) {
    result.unit = body.unit;
    if (body.maintenance?.checked_source?.moved_since_save === true) {
      result.continuation = { state: 'current_context_required',
        cause: 'The created record changed. Acquire its current context before a dependent edit.' };
    } else if (body.revision !== undefined) result.revision = body.revision;
    else if (['work_item', 'initiative', 'decision'].includes(body.kind)) result.continuation = {
      state: 'current_context_required', cause: 'Publication is established, but its write revision is unavailable. Acquire current context before a dependent edit.' };
    const bindings = saveRecordIdentityBindings(body);
    if (Object.keys(bindings).length > 0) result.bindings = bindings;
  }
  const diagnostics = body.diagnostics?.filter(row => !(row.path === '$' && row.code === body.cause?.code &&
    row.message === body.cause?.message && Object.keys(row).every(key => ['path', 'code', 'message', 'severity'].includes(key))));
  if (diagnostics?.length) result.diagnostics = diagnostics;
  if (body.cause) result.cause = creationCause(body.cause);
  const participants = body.cause?.details?.persistence?.participants;
  if (participants !== undefined) result.effects.participants = Object.fromEntries(Object.entries(participants)
    .map(([name, effect]) => [name, { publication_state: effect.publication_state, written: effect.written }]));
  return result;
}

export function creationCause(cause) {
  if (!cause || typeof cause !== 'object') return cause;
  return { code: cause.code ?? null, message: cause.message ?? null,
    ...(cause.cause === undefined ? {} : { cause: creationCause(cause.cause) }),
    ...(cause.errors === undefined ? {} : { errors: cause.errors.map(creationCause) }),
    ...(cause.cleanup_failures === undefined ? {} : { cleanup_failures: cause.cleanup_failures.map(failure => ({
      ...(failure.step === undefined ? {} : { step: failure.step }), ...creationCause(failure) })) }) };
}

export function creationConflictSubject(body) {
  if (body.kind !== 'area' || body.effects?.published !== false ||
    !['create_record_target_exists', 'EEXIST'].includes(body.cause?.code)) return null;
  const subject = body.cause.details?.path ?? body.allocation?.relativeFile;
  return typeof subject === 'string' ? subject : null;
}

export function creationMaintenance(body) {
  return saveRecordMaintenanceMeaning(body);
}

export function creationRecovery(body, maintenance) {
  if (body.outcome?.startsWith('mutation_')) return body.recovery ?? {
    state: 'no_supported_route', stopping_condition: 'The exact mutation outcome is unavailable; do not repeat creation.' };
  if (body.recovery !== undefined) return body.recovery;
  if (body.maintenance?.state === 'maintenance_attempt_in_progress') return {
    state: 'observation_pending', correction: 'Completion is not recorded. Observe this original after progress; do not repeat creation or run checks to discover the outcome.' };
  const conflict = creationConflictSubject(body);
  if (conflict !== null) return {
    state: 'caller_choice_required', subject: conflict,
    correction: 'This call published no record. Inspect the existing area if needed; use it if it meets the request, or choose a distinct title for a new area.'
  };
  if (body.effects?.published === 'unknown') return {
    state: 'publication_unknown',
    ...(body.unit == null ? {} : { candidate: body.unit }),
    stopping_condition: 'Do not repeat creation. The retained outcome does not establish publication. A current-subject read cannot reconcile this operation or repair its participants.'
  };
  if (maintenance !== null && body.maintenance?.members?.length > 0 && body.maintenance.members.every(row => row.state === 'succeeded')) return {
    state: 'no_supported_route', code: 'creation_post_check_failure',
    stopping_condition: 'Creation and checks completed, but the executor then reported this failure. No recorded remaining action is available; do not repeat creation or completed checks.'
  };
  if (maintenance !== null && body.original?.available !== true) return {
    state: 'no_supported_route', code: 'creation_maintenance_receipt_unavailable',
    stopping_condition: 'Creation stands. No authenticated creation receipt is available for maintenance_retry; neither a subject read nor another creation repairs that missing recovery capability.',
    ...(body.original?.retention_failure === undefined ? {} : { cause: creationCause(body.original.retention_failure.cause) })
  };
  if (maintenance !== null) return {
    state: 'correction_required',
    correction: 'Creation stands. Resolve the reported maintenance cause before using the returned maintenance_retry call; it repeats only pending checks, never creation.'
  };
  if (body.effects?.published === false) return {
    state: 'not_created', correction: 'Correct the reported cause and supply missing caller choices before creating. No record was published by this call.'
  };
  return null;
}
