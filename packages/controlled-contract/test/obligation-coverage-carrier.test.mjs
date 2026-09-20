import assert from 'node:assert/strict';
import test from 'node:test';
import { pinProofSelection } from '../lib/proof-authoring-selection.mjs';
import { resolveProofAuthoring } from '../lib/proof-authoring-resolution.mjs';
import { validateObligationCoverageCarrier } from '../lib/obligation-coverage-carrier.mjs';
const pin = await pinProofSelection('proof.verification.test-validity');
const source = { schema_version: 'controlled-contract-obligation-coverage.v3', wk_id: 'WK-2095',
  selected_unit: null, focus: null, obligations: [{ obligation_id: 'OBL-001', statement: 'An authored obligation',
    selection: { ...pin, parameters: {} } }] };
const resolved = await resolveProofAuthoring(source, { source_digest: `sha256:${'a'.repeat(64)}` });
const carrier = () => structuredClone(resolved.mapping);
test('resolved selections retain real design gaps without obsolete mapping fields', () => {
  const value = carrier();
  assert.equal(validateObligationCoverageCarrier(value).valid, true);
  assert.equal(value.obligations[0].design_status, 'invalid');
  assert.deepEqual(value.obligations[0].selection, source.obligations[0].selection);
  assert.equal(validateObligationCoverageCarrier(source).valid, false);
  for (const field of ['source_locator', 'source_locator_digest', 'proof', 'mechanically_proven']) {
    const wrong = carrier(); wrong.obligations[0][field] = 'invented';
    assert.equal(validateObligationCoverageCarrier(wrong).valid, false, field);
  }
});
test('resolved schema rejects empty populations, missing pins, unknown fields and false design validity', () => {
  for (const mutate of [
    value => { value.obligations = []; },
    value => { value.definition_identities = []; },
    value => { value.obligations[0].selection.proof_version = null; },
    value => { value.obligations[0].design_status = 'valid'; },
    value => { value.obligations[0].statement = 'first\nsecond'; },
    value => { value.counts = { proven: 1 }; }
  ]) { const value = carrier(); mutate(value); assert.equal(validateObligationCoverageCarrier(value).valid, false); }
});
test('obligation identities are unique but separate obligations may select the same definition', () => {
  const value = carrier(); value.obligations.push(structuredClone(value.obligations[0]));
  assert.equal(validateObligationCoverageCarrier(value).valid, false);
  value.obligations[1].obligation_id = 'OBL-002';
  assert.equal(validateObligationCoverageCarrier(value).valid, true);
});
