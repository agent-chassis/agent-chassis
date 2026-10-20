import assert from 'node:assert/strict';
import test from 'node:test';
import { projectSaveRecordResponse } from '../../packages/wiki-mcp/src/lib/save-record-response.mjs';

test('save projection keeps only the write token and novel issued associations', () => {
  const bindings = { requirement: { behavior: { row_id: 'row-a', state: 'complete',
    constraint_ids: ['constraint-a', 'constraint-b'], claim_ids: ['claim-a', 'claim-b'] } },
  verification: { check: 'claim-private' }, requirement_collection: { group: 'collection-row-private' },
  criterion: { check: 'derived:private-criterion' }, obligation: { meaning: 'OBL-001' }, case: { example: 'case-001' } };
  const answer = projectSaveRecordResponse({ outcome: 'saved', unit: 'WK-0001', revision: 'current',
    prior_revision: 'old', record_source_digest: 'private', bindings,
    criterion_identity_changes: [{ prior: 'derived:old', current: 'derived:new' }],
    requirement_rows: { rows: [{ key: 'behavior', row_id: 'row-a', verification_claim_id: 'verify-a' },
      { row_id: 'row-unkeyed', claim_ids: ['claim-private'] }], collections: [{ collection_row_id: 'collection-row-unkeyed' }] },
    assessment: { private: true }, assessment_original: { private: true },
    maintenance: { applicable: true, members: [{ member: 'generate_and_lint', state: 'succeeded', check: { ok: true } }] },
    original: { private: true }, observation: { private: true } });
  assert.deepEqual(answer, { outcome: 'saved', unit: 'WK-0001', revision: 'current',
    bindings: { obligation: bindings.obligation, case: bindings.case } });
  assert.doesNotMatch(JSON.stringify(answer), /row-a|row-unkeyed|collection-row|claim-private|constraint-a|verify-a/u);
  assert.deepEqual(bindings.requirement.behavior.claim_ids, ['claim-a', 'claim-b'], 'projection does not mutate execution evidence');
  assert.equal(bindings.requirement.behavior.verification_claim_id, undefined);
});

test('recovery exposes the task boundary and cause without server capability or component labels', () => {
  const correction = 'The exact mutation outcome is unavailable. Do not repeat the save or reconstruct associations.';
  const carrier = { outcome: 'mutation_outcome_unavailable', unit: 'WK-0001', effects: { published: 'unknown' },
    cause: { code: 'mutation_recovery_not_recorded', message: 'No retained operation matches the original request.' },
    recovery: { missing_capability: 'exact_mutation_outcome', correction } };
  const answer = projectSaveRecordResponse(carrier);
  assert.deepEqual(answer.recovery, { correction });
  assert.deepEqual(answer.cause, carrier.cause);
  assert.equal(answer.effects.published, 'unknown');
  assert.equal(carrier.recovery.missing_capability, 'exact_mutation_outcome', 'retained evidence is unchanged');
  const uncertain = projectSaveRecordResponse({ outcome: 'failed', unit: 'WK-0001', effects: { published: 'unknown' },
    recovery: { responsible_owner: 'controlled_contract_authoring_settlement', missing_capability: correction } });
  assert.deepEqual(uncertain.recovery, { correction }, 'a producer boundary sentence stays public without its internal owner');
});

test('every distinct maintenance failure and known partial effect survives beside coordination uncertainty', () => {
  const projected = projectSaveRecordResponse({ outcome: 'saved', unit: 'WK-0001', revision: 'current',
    effects: { published: true }, maintenance: { state: 'maintenance_attempt_outcome_unknown',
      cause: { code: 'ECOORDINATION', message: 'Settled outcome not published' },
      effects: { checks_ran: true }, checked_source: { moved_since_save: true, checked_corpus: { digest: 'private' } },
      members: [{ member: 'first', state: 'failed', check: { ran: true, generated_views: 'regenerated',
        cause_code: 'EFIRST', cause_message: 'First member failed' } },
      { member: 'second', state: 'unknown', check: { ran: true, generated_views: 'unknown',
        cause_code: 'ESECOND', cause_message: 'Second member outcome unknown' } },
      { member: 'third', state: 'succeeded', check: { ran: true, generated_views: 'regenerated' } }] } });
  assert.deepEqual(projected.maintenance.failures.map(f => f.cause.code), ['EFIRST', 'ESECOND']);
  assert.equal(projected.maintenance.effects.third.generated_views, 'regenerated');
  assert.equal(projected.maintenance.checked_state, 'newer_than_save');
  assert.equal(projected.maintenance.checked_source, undefined);
  assert.equal(projected.maintenance.members, undefined);
  assert.equal(projected.effects.published, true);
});

test('settlement failures preserve uncertain effects and nested specific causes without digest mechanics', () => {
  const answer = projectSaveRecordResponse({ outcome: 'failed', unit: 'WK-0001',
    effects: { published: 'unknown', retry_safe: false, commit_state: 'indeterminate' },
    failure: { committed_participants: ['root'], compensation_failures: [{ participant: 'root',
      cause_code: 'EACCES', message: 'Cannot compensate root', content_digest: 'private', stack: 'private' }] },
    maintenance: { members: [] } });
  assert.equal(answer.effects.published, 'unknown');
  assert.equal(answer.effects.retry_safe, false);
  assert.deepEqual(answer.failure.compensation_failures, [{ participant: 'root', cause_code: 'EACCES', message: 'Cannot compensate root' }]);
});

test('a joined result uses the result meaning and never exposes the attempt index', () => {
  const joined = projectSaveRecordResponse({ outcome: 'joined_attempt', unit: 'WK-0001', attempts: ['private'],
    attempt: { ordinal: 2, pending: ['generate_and_lint'] }, result: {
      members: [{ member: 'generate_and_lint', state: 'failed', check: { ran: true,
        cause_code: 'EJOINED', cause_message: 'Joined failure' } }] } });
  assert.equal(joined.outcome, 'maintenance_failed');
  assert.equal(joined.maintenance.failures[0].cause.code, 'EJOINED');
  assert.equal(joined.attempt, undefined);
  assert.equal(joined.attempts, undefined);
});

test('a successful lint verdict does not swallow a distinct cleanup failure', () => {
  const answer = projectSaveRecordResponse({ outcome: 'maintenance_succeeded', unit: 'WK-0001',
    result: { members: [{ member: 'generate_and_lint', state: 'succeeded', check: { ran: true,
      generated_views: 'regenerated', cause_code: 'ECLEANUP', cause_message: 'Cleanup failed after lint' } }] } });
  assert.equal(answer.maintenance.failures[0].cause.code, 'ECLEANUP');
  assert.equal(answer.maintenance.failures[0].effects.generated_views, 'regenerated');
  assert.equal(answer.outcome, 'maintenance_failed');
  assert.equal(answer.maintenance.failures[0].state, 'succeeded', 'the completed check verdict is preserved');
  assert.equal(answer.maintenance.failures[0].failure_stage, 'after_completed_checks');
  assert.deepEqual(answer.maintenance.failures[0].unavailable, {
    correction: 'Checks completed, but the executor then reported this failure. No supported call repairs that post-check failure; do not repeat the save or rerun successful checks.' });
});

test('successful maintenance warnings and unrelated negative effects are not save meaning', () => {
  const answer = projectSaveRecordResponse({ outcome: 'saved', unit: 'WK-0001', revision: 'current',
    maintenance: { members: [{ member: 'generate_and_lint', state: 'succeeded', check: {
      warnings: [{ code: 'unrelated', message: 'Another record has an advisory finding' }] } }] } });
  assert.deepEqual(answer, { outcome: 'saved', unit: 'WK-0001', revision: 'current' });
  assert.deepEqual(projectSaveRecordResponse({ outcome: 'refused', unit: 'WK-0001',
    effects: { published: false, proofs_executed: false, agent_started: false,
      delivery_integrated: false, landing_established: false } }).effects, { published: false });
});

test('advisory warnings neither inflate a failed check nor substitute for its missing diagnosis', () => {
  const body = { outcome: 'saved', unit: 'WK-0001', maintenance: { members: [{ member: 'generate_and_lint', state: 'failed',
    check: { ran: true, lint_scope: 'repository', top_findings: [{ code: 'EDECIDING', path: 'wiki/areas/affected.md', message: 'Deciding error' }],
      warnings: [] } }] } };
  const failed = projectSaveRecordResponse(body);
  const grown = structuredClone(body);
  grown.maintenance.members[0].check.warnings = Array.from({ length: 200 }, () => ({ code: 'advisory', message: 'Unrelated advisory' }));
  assert.deepEqual(projectSaveRecordResponse(grown), failed);
  assert.equal(failed.maintenance.failures[0].scope, 'repository');
  assert.deepEqual(failed.maintenance.failures[0].findings, body.maintenance.members[0].check.top_findings);
  grown.maintenance.members[0].check.top_findings = [];
  grown.maintenance.members[0].check.next_action = 'fix the listed errors and rerun lint';
  const unknown = projectSaveRecordResponse(grown).maintenance.failures[0];
  assert.equal(unknown.state, 'failed');
  const diagnosisStop = { correction: 'The generate_and_lint owner reported failed without a specific cause. Stop this recovery; do not retry unchanged to discover the diagnosis.' };
  assert.deepEqual(unknown.unavailable, diagnosisStop);
  assert.equal(unknown.warnings, undefined);
  assert.equal(unknown.correction, undefined, 'generic retry advice cannot replace missing deciding errors');
  delete grown.maintenance.members[0].check;
  assert.deepEqual(projectSaveRecordResponse(grown).maintenance.failures[0].unavailable, diagnosisStop);
  grown.maintenance.cause = { code: 'ECOORDINATION', message: 'Attempt coordination could not settle.' };
  assert.deepEqual(projectSaveRecordResponse(grown).maintenance.failures[0].unavailable, diagnosisStop,
    'a coordination cause cannot substitute for a distinct member failure');
  grown.maintenance.members[0].state = 'not_run';
  assert.equal(projectSaveRecordResponse(grown).maintenance.failures[0].unavailable, undefined,
    'known nonexecution can be diagnosed by the operation that prevented it');
});

test('a failed cleanup remainder preserves its actual removals without exposing the retention census', () => {
  const answer = projectSaveRecordResponse({ outcome: 'maintenance_failed', unit: 'WK-0001', result: { members: [
    { member: 'admission_artifact_cleanup', state: 'failed', check: { ran: true, cause_code: 'EACCES', cause_message: 'One unlink failed',
      removed: ['evidence/removed.json'], retained: ['private-current-reference.json'],
      top_findings: [{ sidecar_path: 'evidence/failed.json', cause_code: 'EACCES' }], write_effects_retained: true } }
  ] } });
  const failure = answer.maintenance.failures[0];
  assert.deepEqual(failure.effects.removed, ['evidence/removed.json']);
  assert.deepEqual(failure.findings, [{ sidecar_path: 'evidence/failed.json', cause_code: 'EACCES' }]);
  assert.equal(failure.retained, undefined);
  assert.equal(failure.effects.retained, undefined);
});

test('persistence exposes failures and actual partial effects without snapshots or artifact census', () => {
  const cause = { code: 'sidecar_cleanup_failed', sidecar_path: 'evidence/failed.json', cause_code: 'EACCES' };
  const answer = projectSaveRecordResponse({ outcome: 'saved', unit: 'WK-0001', revision: 'current',
    effects: { published: true }, persistence: { ok: false, written: true, record: { notes: 'Whole unrelated record' },
      canonical_record_path: '/internal/record', diagnostic_count: 1,
      diagnostics: [{ code: 'work_record_write_failed', phase: 'cleanup', cause, producer_diagnostic: cause,
        effect_trace: [{ private: true }], failed_fault: 'internal', authority_limb: 'mechanical' }],
      admission_sidecar_publications: [{ created: true, sidecar_path: 'evidence/new.json', sidecar_digest: 'private' },
        { created: false, sidecar_path: 'evidence/existing.json' }],
      admission_sidecar_cleanup: { removed: ['evidence/removed.json'], failed: ['evidence/failed.json'],
        retained: ['unrelated.json'], immutable: ['unrelated.json'], canonical_records_scanned: 400 } } });
  assert.deepEqual(answer.persistence, {
    diagnostics: [{ code: 'work_record_write_failed', phase: 'cleanup', cause }],
    admission_sidecar_publications: [{ sidecar_path: 'evidence/new.json' }],
    admission_sidecar_cleanup: { removed: ['evidence/removed.json'], failed: ['evidence/failed.json'] },
    recovery: {
      correction: 'No supported call repairs or reconciles this persistence failure. Preserve the reported effects; do not replay the canonical mutation.' } });
  assert.equal(answer.effects.published, true);
});
