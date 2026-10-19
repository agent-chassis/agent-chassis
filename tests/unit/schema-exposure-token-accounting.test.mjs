import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmarkTokenPopulation } from '../helpers/schema-exposure-token-accounting.mjs';
test('benchmark tokenizer preserves Unicode and ordinary special-looking text with exact populations', () => {
  const items = ['hello', '雪 ☃ café', '<|endoftext|>'].map((text, id) => ({ id, text }));
  const result = benchmarkTokenPopulation(items);
  assert.deepEqual(result, benchmarkTokenPopulation(items));
  assert.equal(result.bytes, items.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0));
  assert.notEqual(result.benchmark_tokens, result.bytes);
  assert.equal(result.identity.encoding, 'o200k_base');
  assert.throws(() => benchmarkTokenPopulation([items[0], items[0]]), /duplicate counted item/);
  assert.throws(() => benchmarkTokenPopulation(items.slice(1), items.map(item => item.id)), /missing, reordered or extra counted item/);
});
