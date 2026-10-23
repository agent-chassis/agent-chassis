import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { createToolInputValidationError, projectToolInputValidationFailure } from '../../packages/wiki-mcp/src/lib/register-tool.mjs';

const schema = z.object({ unit: z.string(), git_sha: z.string().regex(/^[0-9a-f]{40}$/u),
  original: z.object({ view: z.enum(['summary', 'full']), diagnoses: z.array(z.object({ diagnosis_id: z.string() }).strict()) }).strict() }).strict();
const valid = { unit: 'WK-0001', git_sha: 'a'.repeat(40), original: { view: 'full', diagnoses: [{ diagnosis_id: 'held' }] } };
const project = (inputSchema, args, extra = {}) => projectToolInputValidationFailure({ tool: 'fixture', args,
  inputSchema, validationError: inputSchema.safeParse(args).error, ...extra });

test('shared projection supplies the enforced pattern and same-schema key locations without relocating values', async () => {
  const args = { ...valid, git_sha: 'HEAD', view: 'full', diagnosis_id: 'held' }, before = structuredClone(args);
  const body = await project(schema, args);
  assert.equal(body.invalid_fields.find(issue => issue.path[0] === 'git_sha').constraint.pattern, '^[0-9a-f]{40}$');
  const unknown = body.invalid_fields.find(issue => issue.code === 'unrecognized_keys');
  assert.deepEqual(unknown.constraint.accepted_members, ['unit', 'git_sha', 'original']);
  assert.deepEqual(unknown.constraint.accepted_key_paths, { view: ['original.view'], diagnosis_id: ['original.diagnoses[].diagnosis_id'] });
  assert.deepEqual(args, before); assert.deepEqual(body.next_calls, []);

  const corrected = structuredClone(args);
  for (const key of unknown.keys) {
    const at = unknown.constraint.accepted_key_paths[key][0];
    if (at === 'original.view') corrected.original.view = corrected[key];
    else if (at === 'original.diagnoses[].diagnosis_id') corrected.original.diagnoses[0].diagnosis_id = corrected[key];
    else assert.fail('unknown correction location');
    delete corrected[key];
  }
  assert.equal(schema.safeParse(corrected).success, false, 'moving keys alone cannot repair a bad revision selection');
  corrected.git_sha = valid.git_sha;
  assert.equal(schema.safeParse(corrected).success, true);
  assert.equal(schema.safeParse({ ...corrected, git_sha: 'HEAD' }).success, false);
});

test('shared projection does not echo rejected subject fields and reports unevaluated content explicitly', async () => {
  const args = { ...valid, subject: 'WK-elsewhere' }; delete args.unit;
  const body = await project(schema, args, { notEvaluated: [{ path: ['changes'], cause: 'Unit kind is unresolved.' }] });
  assert.equal(body.subject, undefined);
  assert.deepEqual(body.not_evaluated, [{ path: ['changes'], cause: 'Unit kind is unresolved.' }]);
  assert.ok(body.required_inputs.some(issue => issue.path[0] === 'unit'));
});

test('default refusal shares the same constraint facts without stringified validator JSON in its message', () => {
  const args = { ...valid, git_sha: 'HEAD', view: 'summary' };
  const error = createToolInputValidationError({ tool: 'fixture', args, inputSchema: schema, validationError: schema.safeParse(args).error });
  assert.doesNotMatch(error.message, /invalid_string|\[|\{/u);
  const issues = error.envelope.diagnostic.validator_diagnostics;
  assert.equal(issues.find(issue => issue.path[0] === 'git_sha').constraint.pattern, '^[0-9a-f]{40}$');
  assert.deepEqual(issues.find(issue => issue.code === 'unrecognized_keys').constraint.accepted_key_paths.view, ['original.view']);
});

test('union diagnostics retain all alternatives, rank supplied types first and count missing literals', async () => {
  const selection = z.object({ detail: z.union([z.string(),
    z.object({ member: z.literal('proof_verifications'), ids: z.array(z.string()) }).strict(),
    z.object({ member: z.literal('final_result'), result: z.string() }).strict()]) }).strict();
  const args = { detail: { member: 'final_result' } };
  const issue = (await project(selection, args)).invalid_fields[0];
  assert.equal(issue.union_errors.length, 3);
  assert.deepEqual(issue.union_errors[0].issues[0].path, ['detail', 'result']);
  assert.equal(issue.alternatives.length, 3);
  assert.ok(issue.alternatives.some(arm => arm.required?.includes('result')));
  assert.equal(selection.safeParse({ detail: { member: 'final_result', result: 'held-result' } }).success, true);
  assert.equal(selection.safeParse({ detail: { member: 'final_result', ids: [] } }).success, false);
});

test('constraint lookup respects established discriminators without guessing missing or invalid ones', async () => {
  const source = z.object({ source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('exact_sha'), value: z.string().regex(/^[0-9a-f]{40}$/u) }).strict(),
    z.object({ kind: z.literal('branch'), value: z.string().min(1).describe('An explicitly selected branch name.') }).strict()
  ]) }).strict();
  const exact = await project(source, { source: { kind: 'exact_sha', value: 'HEAD' } });
  assert.equal(exact.invalid_fields[0].constraint.pattern, '^[0-9a-f]{40}$');
  assert.doesNotMatch(JSON.stringify(exact.invalid_fields[0].constraint), /branch/u);
  assert.equal(source.safeParse({ source: { kind: 'branch', value: 'HEAD' } }).success, true);
  const contextSchema = z.object({ source: z.union(source.shape.source.options) }).strict();
  const branch = await project(contextSchema, { source: { kind: 'branch', value: 7 } });
  const matching = branch.invalid_fields[0].alternatives;
  assert.equal(matching.length, 1); assert.equal(matching[0].selectors.kind.const, 'branch');
  for (const kind of [undefined, 'unknown']) {
    const args = { source: { ...(kind === undefined ? {} : { kind }), value: false } };
    const issue = (await project(contextSchema, args)).invalid_fields[0];
    assert.deepEqual(issue.alternatives.map(arm => arm.selectors.kind.const), ['exact_sha', 'branch']);
    assert.equal(issue.union_errors.length, 2);
  }
});
