

import assert from 'node:assert/strict';
import { Tiktoken } from 'js-tiktoken/lite';
import ranks from 'js-tiktoken/ranks/o200k_base';
import { sha } from './mcp-journey-accounting.mjs';
const tokenizer = new Tiktoken(ranks);
export const BENCHMARK_TOKEN_IDENTITY = Object.freeze({ library: 'js-tiktoken', version: '1.0.21', encoding: 'o200k_base',
  ranks_sha256: sha(JSON.stringify(ranks)), framing: 'each precisely recorded UTF-8 text item encoded separately; special-token-looking text is ordinary text' });
export function benchmarkTokenPopulation(items, expectedIds = items.map(item => item.id)) {
  assert.equal(new Set(items.map(item => item.id)).size, items.length, 'duplicate counted item');
  assert.deepEqual(items.map(item => item.id), expectedIds, 'missing, reordered or extra counted item');
  const rows = items.map(({ id, text }) => {
    assert.equal(typeof text, 'string');
    const encoded = tokenizer.encode(text, [], []);
    assert.equal(tokenizer.decode(encoded), text, 'tokenizer round trip');
    return { id, bytes: Buffer.byteLength(text), benchmark_tokens: encoded.length, sha256: sha(text) };
  });
  return { identity: BENCHMARK_TOKEN_IDENTITY, items: rows,
    bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    benchmark_tokens: rows.reduce((sum, row) => sum + row.benchmark_tokens, 0) };
}

export function benchmarkClientLedger(journey, ledger) {
  const requests = journey.requests.filter(request => request.kind === 'stage');
  assert.equal(requests.length, ledger.requests.length, 'client ledger population mismatch');
  const newly = [], repeated = [], wire = [];
  for (let index = 0; index < requests.length; index++) {
    const request = requests[index], boundary = ledger.requests[index];
    const items = request.body.input.map(item => JSON.stringify(item));
    const held = boundary.repeated_history.items;
    const newItems = items.slice(held).map((text, item) => ({ id: `${index}:${item + held}`, text }));
    const heldItems = items.slice(0, held).map((text, item) => ({ id: `${index}:${item}`, text }));
    assert.equal(newItems.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0), boundary.newly_delivered.utf8_bytes);
    assert.equal(heldItems.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0), boundary.repeated_history.utf8_bytes);
    newly.push(...newItems); repeated.push(...heldItems);
    wire.push({ id: index, text: JSON.stringify(request.body) });
  }
  return { newly_delivered: benchmarkTokenPopulation(newly), repeated_history: benchmarkTokenPopulation(repeated),
    client_request_json: benchmarkTokenPopulation(wire), native_usage: 'unavailable', cache: 'unavailable', billing: 'unavailable' };
}
