import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { discoverProofIntents, canonicalProofIntentDiscoveryJson, PROOF_INTENT_DISCOVERY_CATALOG,
  normalizeProofIntentDiscoveryCatalog, validateProofIntentDiscoveryResult, MAX_DISCOVERY_QUERY_BYTES
} from '../lib/proof-intent-discovery.mjs';

const ids = result => result.candidates.map(x => x.id);

test('complete browsing deduplicates exact admitted associations and expands multi-pack intents', () => {
  const result = discoverProofIntents();
  const expected = [...new Set(PROOF_INTENT_DISCOVERY_CATALOG.intents.flatMap(x =>
    x.capable_packs.map(p => `${p.profile_id}@${p.profile_version}`)))].sort();
  assert.deepEqual(ids(result), expected);
  assert.equal(result.candidate_count, expected.length);
  assert.equal(result.total_match_count, expected.length);
  assert.equal(result.omitted_count, 0);
  assert.equal(result.selection_performed, false);
  assert.equal(result.pack_invocation_performed, false);
  assert.equal(validateProofIntentDiscoveryResult(result), true);
  for (const intent of PROOF_INTENT_DISCOVERY_CATALOG.intents) {
    assert.deepEqual(result.candidates.filter(x => x.associations.includes(intent.intent_id)).map(x => x.id).sort(),
      intent.capable_packs.map(x => `${x.profile_id}@${x.profile_version}`).sort());
  }
});

test('exact proof names resolve one identity, independently of lexical search', () => {
  for (const candidate of discoverProofIntents().candidates) {
    const result = discoverProofIntents({ proof_name: candidate.proof_name });
    assert.deepEqual(result.candidates, [candidate]);
    assert.equal(result.mode, 'detail');
  }
  assert.throws(() => discoverProofIntents({ proof_name: 'proof.unknown' }),
    { code: 'proof_discovery_identity_unknown' });
});

test('all ranking tiers remain reachable, ordered by relevance score then exact identity', () => {
  for (const query of ['complete', 'authorization attempt', 'disclosed omissions', 'baseline candidate behavior', 'forbidden operation context']) {
    const all = discoverProofIntents({ query });
    const limited = discoverProofIntents({ query, limit: 1 });
    assert.deepEqual(ids(limited), ids(all).slice(0, 1));
    assert.equal(limited.total_match_count, all.candidates.length);
    assert.equal(limited.omitted_count, all.candidates.length - 1);
    const tiers = { assertion_match: 0, partial_assertion_match: 1, navigation_or_exclusion_match: 2 };
    for (let i = 1; i < all.candidates.length; i++) {
      const a = all.candidates[i-1], b = all.candidates[i];
      assert.ok(tiers[a.ranking.match_kind] < tiers[b.ranking.match_kind] ||
        tiers[a.ranking.match_kind] === tiers[b.ranking.match_kind] &&
        (a.ranking.relevance_score > b.ranking.relevance_score ||
          a.ranking.relevance_score === b.ranking.relevance_score && a.id < b.id));
    }
  }
  const all = discoverProofIntents({ query: 'failure' });
  assert.ok(all.candidates.some(x => x.ranking.match_kind === 'assertion_match'));
  assert.ok(all.candidates.some(x => x.ranking.match_kind === 'navigation_or_exclusion_match'));
});

test('required-fields and deterministic-ordering exercises precede unrelated single-term matches', () => {
  for (const [query, name] of [['result contains exactly required fields', 'proof.result-shape.conformance'],
    ['deterministic relevance order all matching candidates', 'proof.ordering.lexicographic-conformance']]) {
    const result = discoverProofIntents({ query });
    const index = result.candidates.findIndex(x => x.proof_name === name);
    assert.ok(index >= 0 && index < 5);
    const unrelated = result.candidates.findIndex(x => x.ranking.semantic_terms.length <= 1);
    assert.ok(unrelated < 0 || index < unrelated);
  }
});

test('namespace identity syntax is excluded only at identity sources; genuine proof text remains searchable', () => {
  const result = discoverProofIntents({ query: 'proof controlled intent' });
  for (const candidate of result.candidates) for (const reason of candidate.ranking.match_reasons) {
    if (reason.source === 'name' || reason.source === 'intent_id') {
      assert.ok(!reason.source_value.startsWith('controlled-proof-intent.'));
      assert.ok(!reason.source_value.startsWith('proof.'));
    }
  }
  assert.ok(result.candidates.some(x => x.ranking.match_reasons.some(r =>
    ['assertion', 'constraint'].includes(r.source) && r.matched_terms.includes('proof'))));
  assert.equal(discoverProofIntents({ query: 'quasar marmalade 998877' }).total_match_count, 0);
});

test('normalization, source permutations, replay and detached immutable scope are deterministic', async () => {
  const result = discoverProofIntents({ query: 'compact output loss' });
  assert.deepEqual(discoverProofIntents({ query: 'ｌｏｓｓ ＣＯＭＰＡＣＴ output compact!!!' }), result);
  const raw = JSON.parse(await readFile(new URL('../proof-intents/catalog.json', import.meta.url)));
  const reordered = { ...raw, intents: [...raw.intents].reverse().map(x => ({ ...x,
    discovery_terms: [...x.discovery_terms].reverse(), capable_packs: [...x.capable_packs].reverse(),
    distinctions: [...x.distinctions].reverse() })) };
  assert.deepEqual(normalizeProofIntentDiscoveryCatalog(reordered), normalizeProofIntentDiscoveryCatalog(raw));
  assert.throws(() => { result.candidates[0].assertion = 'invented'; }, TypeError);
  assert.throws(() => { result.candidates[0].constraints.pop(); }, TypeError);
  assert.deepEqual(JSON.parse(canonicalProofIntentDiscoveryJson(result)), result);
});

test('UTF-8 query boundary and closed requests preserve actionable bounded recovery', () => {
  for (const query of ['x'.repeat(1024), 'é'.repeat(512)]) assert.doesNotThrow(() => discoverProofIntents({ query }));
  for (const query of ['x'.repeat(1025), 'é'.repeat(512)+'x']) assert.throws(
    () => discoverProofIntents({ query, limit: 2 }), error => {
      assert.equal(error.code, 'proof_intent_discovery_query_too_large');
      assert.equal(error.details.byte_length, 1025);
      assert.equal(error.details.maximum_bytes, MAX_DISCOVERY_QUERY_BYTES);
      assert.equal(error.details.replacement_call.arguments.limit, 2);
      assert.doesNotThrow(() => discoverProofIntents(error.details.replacement_call.arguments));
      return true;
    });
  for (const args of [null, [], { query: '' }, { query: '!!!' }, { limit: 0 }, { limit: 257 },
    { stage: 'pre_dispatch' }, { catalog: {} }, { proof_name: 'proof.unknown', query: 'x' }])
    assert.throws(() => discoverProofIntents(args));
  assert.throws(() => discoverProofIntents({}, {}));
});

test('one-shot CLI retains complete pure package results with no process-local actions', async () => {
  const { stdout } = await promisify(execFile)(process.execPath,
    ['packages/controlled-contract/bin/discover-proof-intents.mjs', '--query', 'lossless projection', '--limit', '1'],
    { maxBuffer: 8 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  assert.deepEqual(result, discoverProofIntents({ query: 'lossless projection', limit: 1 }));
  assert.doesNotMatch(stdout, /snapshot_identity|detail_action/);
});
