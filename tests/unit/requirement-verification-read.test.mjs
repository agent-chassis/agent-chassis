import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { readRequirementModel } from '../../packages/wiki-mcp/src/lib/requirement-model-read.mjs';
import { createReadWikiInputSchema } from '../../packages/wiki-mcp/src/lib/task-read-wiki-schema.mjs';
import { createReadWikiGrants } from '../../packages/wiki-mcp/src/lib/task-read-wiki-selection.mjs';
import { SESSION_ROLE_TOOL_ACCESS_POLICY_PATH } from '../../packages/wiki-core/src/lib/tool-discovery/gating.mjs';

test('row verification selection retains owner meanings and only their reference closure', () => {
  const verification = { claim_id: 'check', method: 'test_execution', verifier: { select: 'verifier' },
    observes: { relation: 'reference:covers', objects: [{ referent: { select: 'subject' } }] },
    fails_when: { relation: 'boolean:fails_when', objects: [{ boolean: true }] },
    runtime_test: { boundary: { subjects: ['boundary'] }, falsifiers: { items: [{ strategy: 'dependency_failure' }] } } };
  const row = { row_id: 'row-selected', claim_ids: ['a', 'b'] };
  const draft = { row_id: 'row-draft', claim_ids: [] };
  const saved = { unit: 'WK-0001', authored_requirements: { rows: [row, draft] }, requirements: [
    ...['a', 'b'].map(claim_id => ({ claim_id, verification_claim_ids: ['check'], meaning: { verifications: [verification] } })),
    { claim_id: 'outside', verification_claim_ids: ['outside-check'], meaning: { verifications: [{ claim_id: 'outside-check', verifier: { select: 'private' } }] } }
  ], references: ['subject', 'verifier', 'boundary', 'private'].map(reference_id => ({ reference_id, identity: { value: reference_id } })) };
  const reference = { ref_id: 'returned' };
  const options = { refuseRow: id => Object.assign(new Error(`Unknown row ${id}`), { code: 'requirement_row_not_found' }) };
  const read = select => readRequirementModel(saved, { contract: 'requirements', ...select }, reference, options);
  const next = read({ view: 'row', row_id: row.row_id }).next_calls[0];
  assert.deepEqual(next, { tool: 'workspace_read_wiki', arguments: { reference,
    select: { contract: 'requirements', view: 'verifications', row_id: row.row_id } }, purpose: 'optional_verifications' });
  const result = read(next.arguments.select);
  assert.deepEqual(result.requirements, ['a', 'b'].map(claim_id => ({ claim_id, verification_claim_ids: ['check'] })));
  assert.deepEqual(result.verifications, [verification], 'shared verification is returned once without losing any owner fields');
  assert.equal(result.verifications[0], verification, 'the existing owner projection is selected intact');
  assert.deepEqual(result.references, saved.references.slice(0, 3));
  assert.doesNotMatch(JSON.stringify(result), /outside|private/u);
  assert.deepEqual(result.next_calls, [], 'verification meaning finishes without a row reread');
  const unfinished = read({ view: 'verifications', row_id: draft.row_id });
  assert.deepEqual([unfinished.requirements, unfinished.verifications, unfinished.references], [[], [], []]);
  assert.throws(() => read({ view: 'verifications', row_id: 'outside-assignment' }), { code: 'requirement_row_not_found' });
});

test('verification view uses existing contract grants and requires its row selector', () => {
  const policy = JSON.parse(readFileSync(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH, 'utf8'));
  for (const role of ['orchestrator', 'operator', 'worker', 'reviewer', 'redteam']) {
    const schema = createReadWikiInputSchema(z, createReadWikiGrants(policy, role));
    const request = { reference: { ref_id: 'returned' },
      select: { contract: 'requirements', view: 'verifications', row_id: 'row-selected' } };
    assert.equal(schema.safeParse(request).success, true, role);
    const { row_id: _row, ...missing } = request.select;
    assert.equal(schema.safeParse({ ...request, select: missing }).success, false, role);
    assert.equal(schema.safeParse({ ...request, select: { ...request.select, contract: 'cases' } }).success, false, role);
    assert.equal(schema.safeParse({ ...request, select: { ...request.select, view: 'summary' } }).success, false, role);
    assert.equal(schema.safeParse({ ...request, select: { contract: 'requirements', view: 'identities' } }).success, true, role);
    assert.equal(schema.safeParse({ ...request, select: { ...request.select, view: 'identities' } }).success, false, role);
    const query = { reference: request.reference, select: { contract: 'requirements', view: 'choices', query: 'hierarchy jobs' } };
    assert.equal(schema.safeParse(query).success, true, role);
    for (const value of ['', ' \t ', null, 42, {}, []]) {
      assert.equal(schema.safeParse({ ...query, select: { ...query.select, query: value } }).success, false, role);
    }
    for (const view of ['summary', 'identities', 'row', 'dependencies']) {
      assert.equal(schema.safeParse({ ...query, select: { ...query.select, view } }).success, false, role);
    }
  }
});

test('identity selection preserves the complete authorized row/claim/verification inventory beyond the meaning preview', () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ row_id: `row-${i}`, state: 'complete',
    constraint_ids: [`constraint-${i}-a`, `constraint-${i}-b`], claim_ids: [`claim-${i}-a`, `claim-${i}-b`],
    input: { subject: { type_term: 'cc:runtime_component', identity: { kind: 'repository_path', repository: 'public', path: `component-${i}.mjs` } },
      modality: 'MUST', behavior: { relation: 'boolean:exists', objects: [{ boolean: true }] } },
    meaning: 'This full authored meaning is deliberately excluded from an identity inventory.', source: { state: 'current' } }));
  const collection = { collection_row_id: 'collection', members: rows.map(row => ({ row_id: row.row_id, constraint_ids: row.constraint_ids })) };
  const saved = { unit: 'WK-0001', source_identity: { commit: 'original' }, content_digest: 'content', contract_content_digest: 'contract',
    authored_requirements: { rows, collections: [collection], compiled: null, unresolved: [] },
    requirements: rows.flatMap(row => row.claim_ids.map(claim_id => ({ claim_id, verification_claim_ids: [`check-${row.row_id}`] }))) };
  const reference = { ref_id: 'authorized' };
  const read = select => readRequirementModel(saved, select, reference, {});
  const summary = read({ view: 'summary' });
  assert.equal(summary.meaning_extent, 'summary_only');
  assert.equal(summary.row_count, 80);
  assert.equal(summary.rows, undefined, 'summary never fills its allowance with arbitrary preview rows');
  const next = summary.next_calls.find(call => call.purpose === 'requirement_identities');
  assert.deepEqual(next.arguments, { reference, select: { contract: 'requirements', view: 'identities' } });
  const result = read(next.arguments.select);
  assert.equal(result.rows.length, 80);
  result.rows.forEach((row, i) => {
    assert.deepEqual(row, { row_id: rows[i].row_id, state: rows[i].state, constraint_ids: rows[i].constraint_ids,
      claim_ids: rows[i].claim_ids, verifications: saved.requirements.slice(i * 2, i * 2 + 2) });
  });
  assert.deepEqual(result.collections, [collection]);
  assert.equal(result.source_identity, undefined, 'source authentication remains server-owned');
  assert.equal(result.revision, undefined, 'historical identity inventory does not grant a write revision');
  assert.deepEqual(result.next_calls, [], 'identity recovery needs no unrelated write-context read');
  assert.equal(result.selection_context.reference, reference);
  assert.deepEqual(result.selection_context.views, ['row', 'verifications', 'dependencies']);
  const meanings = read(summary.next_calls.find(call => call.purpose === 'requirement_choices').arguments.select);
  assert.deepEqual(meanings.rows.map(row => row.authored_statement), rows.map(row => row.input));
  assert.ok(meanings.rows.every(row => row.meaning === undefined), 'choices do not repeat full rendered definitions');
  const selected = read({ contract: 'requirements', view: meanings.selection_context.views[0], row_id: meanings.rows[79].row_id });
  assert.deepEqual(selected.row, rows[79], 'selected authored meaning and all association identities survive');
  assert.doesNotMatch(JSON.stringify(result), /full authored meaning/u);
});
