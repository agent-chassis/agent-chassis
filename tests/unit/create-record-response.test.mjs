import assert from 'node:assert/strict';
import test from 'node:test';
import { creationConflictSubject, creationFacts, creationMaintenance, creationRecovery } from '../../packages/wiki-mcp/src/lib/create-record-response.mjs';

test('published creation preserves identity after persistence failure without exposing its carrier', () => {
  const body = { outcome: 'failed', unit: 'DEC-0042', revision: 'current-write-revision', effects: { published: true },
    record: { title: 'Private authored content' }, allocation: { consumed_id: 'DEC-0042' },
    cause: { code: 'kind_record_write_failed', message: 'Published decision; projection failed', stack: 'private stack',
      details: { persistence: { participants: { canonical_json: { written: true, publication_state: 'published' },
        generated_markdown: { written: null, publication_state: 'unknown' } } } } } };
  const answer = creationFacts(body);
  assert.equal(answer.outcome, 'created');
  assert.equal(answer.unit, body.unit);
  assert.equal(answer.revision, body.revision);
  assert.equal(answer.effects.participants.generated_markdown.publication_state, 'unknown');
  assert.deepEqual(answer.cause, { code: 'kind_record_write_failed', message: 'Published decision; projection failed' });
  assert.equal(answer.record, undefined);
  assert.equal(answer.allocation, undefined);
});

test('unknown publication keeps an explicitly unconfirmed recovery target rather than a created identity', () => {
  const body = { outcome: 'failed', unit: 'WK-0042', effects: { published: 'unknown' } };
  assert.deepEqual(creationFacts(body), { outcome: 'unknown', effects: { published: 'unknown' } });
  const recovery = creationRecovery(body, null);
  assert.equal(recovery.candidate, body.unit);
  assert.match(recovery.stopping_condition, /Do not repeat creation/u);
});

test('known record movement withholds an obsolete write revision without exposing clean checks', () => {
  const body = { outcome: 'created', unit: 'WK-0042', revision: 'obsolete-revision', effects: { published: true },
    maintenance: { checked_source: { moved_since_save: true }, members: [{ member: 'check', state: 'succeeded' }] } };
  const answer = creationFacts(body);
  assert.equal(answer.revision, undefined);
  assert.equal(answer.unit, body.unit);
  assert.equal(answer.continuation.state, 'current_context_required');
  assert.equal(creationMaintenance(body), null);
});

test('maintenance exposes deciding failures but omits successful checks and clean inventories', () => {
  const body = { effects: { published: true }, original: { available: false, retention_failure: {
    cause: { code: 'ENOSPC', message: 'No space for receipt', stack: 'private stack' } } },
    maintenance: { attempt: 4, checked_source: { internal: true }, members: [
      { member: 'clean', state: 'succeeded', check: { top_findings: [], lint_scope: 'repository' } },
      { member: 'generate_and_lint', state: 'failed', check: { generated_views: 'regenerated',
        top_findings: [{ path: 'wiki/areas/broken.md', code: 'invalid_owners', message: 'owners must be an array' }],
        warnings: [{ code: 'optional_metadata', message: 'Nonblocking warning' }] } }
    ] } };
  const maintenance = creationMaintenance(body);
  assert.equal(maintenance.members.length, 1);
  assert.equal(maintenance.members[0].check.findings[0].path, 'wiki/areas/broken.md');
  assert.equal(maintenance.members[0].check.warnings, undefined);
  const growth = structuredClone(body);
  growth.maintenance.members.push(...Array.from({ length: 100 }, () => ({ member: 'unrelated_clean', state: 'succeeded' })));
  growth.maintenance.members[1].check.warnings.push(...Array.from({ length: 100 }, () => ({ message: 'Unrelated' })));
  assert.deepEqual(creationMaintenance(growth), maintenance);
  assert.equal(maintenance.checked_source, undefined);
  assert.equal(maintenance.attempt, undefined);
  const recovery = creationRecovery(body, maintenance);
  assert.equal(recovery.code, 'creation_maintenance_receipt_unavailable');
  assert.deepEqual(recovery.cause, { code: 'ENOSPC', message: 'No space for receipt' });
});

test('collision subject requires the actual confirmed area collision, never message matching', () => {
  const body = { kind: 'area', effects: { published: false }, cause: { code: 'create_record_target_exists',
    message: 'Target exists', details: { path: 'wiki/areas/existing.md' } } };
  assert.equal(creationConflictSubject(body), 'wiki/areas/existing.md');
  assert.equal(creationRecovery(body, null).subject, 'wiki/areas/existing.md');
  for (const change of [{ kind: 'source' }, { effects: { published: 'unknown' } },
    { cause: { ...body.cause, code: 'EOTHER' } }, { cause: { code: 'EEXIST', message: 'wiki/areas/guessed.md' } }]) {
    assert.equal(creationConflictSubject({ ...body, ...change }), null);
  }
  const race = { ...body, cause: { code: 'EEXIST', message: 'Race' }, allocation: { relativeFile: 'wiki/areas/race.md' } };
  assert.equal(creationConflictSubject(race), race.allocation.relativeFile);
});

test('failures preserve separate cleanup causes and addressed diagnostics without duplicate generic diagnostics', () => {
  const cause = { code: 'EWRITE', message: 'Write failed', cleanup_failures: [
    { step: 'source_stage_cleanup', code: 'ECLEANUP', message: 'Cleanup failed', error: { stack: 'private stack' } } ] };
  const body = { effects: { published: false }, cause, diagnostics: [
    { code: 'EWRITE', path: '$', severity: 'error', message: 'Write failed' },
    { code: 'invalid_value', path: 'initial.notes', message: 'Supply text' },
    { code: 'EWRITE', path: '$', severity: 'error', message: 'Write failed', cause_code: 'ENOSPC' }
  ] };
  const result = creationFacts(body);
  assert.deepEqual(result.cause.cleanup_failures, [{ step: 'source_stage_cleanup', code: 'ECLEANUP', message: 'Cleanup failed' }]);
  assert.deepEqual(result.diagnostics, body.diagnostics.slice(1));
});

test('cleanup failure after successful checks does not advertise an unchanged maintenance retry', () => {
  const body = { effects: { published: true }, original: { available: true }, maintenance: { members: [
    { member: 'generate_and_lint', state: 'succeeded', check: { cause_code: 'ECLEANUP', cause_message: 'cleanup failed' } }
  ] } };
  const maintenance = creationMaintenance(body);
  assert.equal(maintenance.members[0].check.cause_code, 'ECLEANUP');
  assert.equal(creationRecovery(body, maintenance).code, 'creation_maintenance_cleanup_incomplete');
  assert.equal(creationMaintenance({ maintenance: { members: [{ member: 'check', state: 'succeeded' }] } }), null);
});

test('unavailable forward observation and message-only post-check failures retain their actual stopping causes', () => {
  const unavailable = { effects: { published: true }, original: { available: true },
    maintenance: { state: 'maintenance_outcome_unavailable', cause: { code: 'maintenance_completion_not_recorded',
      message: 'Maintenance settled, but its detailed outcome is unavailable.' } },
    recovery: { missing_capability: 'retained_maintenance_outcome', correction: 'Stop; completed checks must not be rerun.' } };
  assert.equal(creationMaintenance(unavailable).cause.code, 'maintenance_completion_not_recorded');
  assert.deepEqual(creationRecovery(unavailable, creationMaintenance(unavailable)), unavailable.recovery);
  const completed = { effects: { published: true }, original: { available: true }, maintenance: { members: [
    { member: 'generate_and_lint', state: 'succeeded', check: { cause_message: 'Native post-check failure without a code' } }
  ] } };
  const meaning = creationMaintenance(completed);
  assert.equal(meaning.members[0].check.cause_message, completed.maintenance.members[0].check.cause_message);
  assert.equal(creationRecovery(completed, meaning).code, 'creation_maintenance_cleanup_incomplete');
});
