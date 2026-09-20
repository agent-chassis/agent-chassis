import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadCurrentParameterPopulation } from '../../packages/controlled-contract/lib/pack-parameter-loader.mjs';
import { renderParameterDocumentationSet, renderPackParameterDocumentation,
  checkParameterDocumentation, writeParameterDocumentation } from
  '../../packages/controlled-contract/lib/pack-parameter-documentation.mjs';

test('P9 deterministic complete documentation detects missing, extra and edited output without writing', async () => {
  const population = await loadCurrentParameterPopulation();
  const expected = renderParameterDocumentationSet(population);
  assert.deepEqual(expected, renderParameterDocumentationSet([...population].reverse()));
  assert.equal(expected.size, population.length + 1);
  const catalog = JSON.parse(await readFile(new URL(
    '../../packages/controlled-contract/profiles/catalog.json', import.meta.url), 'utf8'));
  assert.deepEqual([...expected.keys()].sort(), ['index.md', ...catalog.packs.map(
    p => `${p.profile_id}@${p.profile_version}.md`)].sort());
  const retiredPage = 'proof.verification.test-validity@7.0.0.md';
  assert.equal(expected.has(retiredPage), false);
  assert.equal(expected.has('proof.verification.test-validity@8.0.0.md'), false);
  assert.equal(expected.has('proof.verification.test-validity@9.0.0.md'), false);
  assert.equal(expected.has('proof.verification.test-validity@10.0.0.md'), true);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pack-parameter-docs-'));
  try {
    assert.equal((await checkParameterDocumentation(directory, expected)).missing.length, expected.size);
    assert.equal((await writeParameterDocumentation(directory, expected)).passed, true);
    await writeFile(path.join(directory, retiredPage), 'obsolete current page');
    assert.deepEqual((await checkParameterDocumentation(directory, expected)).extra, [retiredPage]);
    await assert.rejects(writeParameterDocumentation(directory, expected),
      { code: 'pack_parameter_documentation_extra' });
    await unlink(path.join(directory, retiredPage));
    const name = [...expected.keys()][0];
    const file = path.join(directory, name);
    await writeFile(file, 'edited');
    await writeFile(path.join(directory, 'extra.md'), 'extra');
    await unlink(path.join(directory, 'index.md'));
    const result = await checkParameterDocumentation(directory, expected);
    assert.deepEqual(result.edited, [name]);
    assert.deepEqual(result.extra, ['extra.md']);
    assert.deepEqual(result.missing, ['index.md']);
    assert.equal(await readFile(file, 'utf8'), 'edited');
    const { pack, contract } = population[0];
    assert.throws(() => renderPackParameterDocumentation(contract, pack.profile,
      { ...pack.admission, parameter_contract_digest: '0'.repeat(64) }), { code: 'pack_parameter_identity_mismatch' });
    for (const { pack, contract } of population) {
      const page = expected.get(`${contract.profile_id}@${contract.profile_version}.md`);
      for (const role of [...pack.profile.reference_roles, ...pack.profile.number_roles]) assert.ok(page.includes(role.role));
      for (const exclusion of pack.admission.explicit_exclusions) assert.ok(page.includes(exclusion));
      assert.ok(page.includes(contract.profile_digest));
      assert.ok(!page.includes(process.cwd()));
    }
  } finally { await rm(directory, { recursive: true }); }
});
