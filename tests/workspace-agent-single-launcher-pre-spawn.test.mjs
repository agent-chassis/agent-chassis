import assert from 'node:assert/strict';
import test from 'node:test';

import * as launchCore from '../packages/agent-launch-cli/src/lib/workspace-agent-launch-core.mjs';
import * as adapterContract from '../packages/agent-launch-cli/src/lib/workspace-agent-launch-adapter-contract.mjs';
import {
  CALLER_SUPPLIED_IDENTITY_CARRIERS,
  IDENTITY_REFUSAL_CODES,
  refuseCallerSuppliedIdentityFields,
} from '../packages/wiki-core/src/lib/agent-dispatch-identity.mjs';

const {
  LAUNCHER_IDENTITY_REFUSAL_HANDOFF_FIELDS,
  LAUNCHER_PRE_SPAWN_GATE_PRIMITIVES,
  LAUNCHER_REFUSAL_REASONS,
  normalizeAdmissionHandoff,
  normalizeGraphImpactHandoff,
  normalizeIdentityRefusalHandoff,
  normalizeReadinessHandoff,
  validateDispatchSidecarDescriptor,
  validateFamilyAdapter,
} = adapterContract;

function readFirstDefined(object, keys) {
  for (const key of keys) {
    if (object && Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined) {
      return object[key];
    }
  }
  return undefined;
}

function invokeAndCapture(fn, input) {
  try {
    return { ok: true, value: fn(input) };
  } catch (error) {
    return { ok: false, error };
  }
}

function assertFailClosedInvocation(fn, input, label) {
  const outcome = invokeAndCapture(fn, input);

  if (!outcome.ok) {
    assert.match(String(outcome.error?.message ?? outcome.error), /object|non-object|invalid/i, label);
    return;
  }

  const { value } = outcome;
  if (Array.isArray(value)) {
    assert.ok(value.length > 0, label);
    return;
  }

  assert.equal(typeof value, 'object', label);
  assert.ok(value !== null, label);
  assert.ok(
    value.ok === false ||
      value.valid === false ||
      value.accepted === false ||
      value.refused === true ||
      value.status === 'refused' ||
      value.state === 'refused' ||
      value.kind === 'refusal' ||
      value.kind === 'diagnostic',
    label,
  );
}

test('launch-core re-exports the shared pre-spawn gate contract bindings', () => {
  assert.strictEqual(launchCore.normalizeReadinessHandoff, normalizeReadinessHandoff);
  assert.strictEqual(launchCore.normalizeAdmissionHandoff, normalizeAdmissionHandoff);
  assert.strictEqual(launchCore.normalizeIdentityRefusalHandoff, normalizeIdentityRefusalHandoff);
  assert.strictEqual(launchCore.normalizeGraphImpactHandoff, normalizeGraphImpactHandoff);
  assert.strictEqual(
    launchCore.LAUNCHER_IDENTITY_REFUSAL_HANDOFF_FIELDS,
    LAUNCHER_IDENTITY_REFUSAL_HANDOFF_FIELDS,
  );
  assert.strictEqual(
    launchCore.LAUNCHER_PRE_SPAWN_GATE_PRIMITIVES,
    LAUNCHER_PRE_SPAWN_GATE_PRIMITIVES,
  );
});

test('LAUNCHER_PRE_SPAWN_GATE_PRIMITIVES contains exactly the shared pre-spawn primitives', () => {
  const expected = [
    'readiness_admission_handoff',
    'reviewer_redteam_write_scope_gating',
    'caller_supplied_identity_refusal',
    'graph_impact_bridge_handoff',
  ];

  assert.equal(LAUNCHER_PRE_SPAWN_GATE_PRIMITIVES.length, expected.length);
  assert.deepStrictEqual([...LAUNCHER_PRE_SPAWN_GATE_PRIMITIVES].sort(), expected.sort());
});

test('normalizeIdentityRefusalHandoff allows proceed when no caller-supplied identity claim exists', () => {
  for (const noClaim of [null, undefined, refuseCallerSuppliedIdentityFields({ prompt: { text: 'ok' } })]) {
    const handoff = normalizeIdentityRefusalHandoff(noClaim);
    assert.equal(handoff.ok, true);
    assert.equal(handoff.identity_refusal, null);
  }
});

test('normalizeIdentityRefusalHandoff preserves canonical caller-supplied identity refusals', () => {
  const upstream = refuseCallerSuppliedIdentityFields({ request: { role: 'worker' } });
  assert.equal(upstream.accepted, false);
  assert.equal(upstream.refusal_code, IDENTITY_REFUSAL_CODES.CALLER_SUPPLIED_ROLE);

  const handoff = normalizeIdentityRefusalHandoff(upstream);
  assert.equal(handoff.ok, false);
  assert.equal(
    handoff.refusal.refusal.reason,
    LAUNCHER_REFUSAL_REASONS.IDENTITY_CALLER_SUPPLIED,
  );
  assert.equal(handoff.refusal.refusal.code, adapterContract.launcherRefusalBackendCode(
    LAUNCHER_REFUSAL_REASONS.IDENTITY_CALLER_SUPPLIED,
  ));
  assert.deepEqual([...LAUNCHER_IDENTITY_REFUSAL_HANDOFF_FIELDS], [
    'identity_refusal_code',
    'carrier',
  ]);
  assert.equal(
    readFirstDefined(handoff.refusal.refusal.detail, ['identity_refusal_code']),
    IDENTITY_REFUSAL_CODES.CALLER_SUPPLIED_ROLE,
  );
  assert.equal(handoff.refusal.refusal.detail.identity_refusal_code_known, true);
  assert.equal(handoff.refusal.refusal.detail.carrier, 'request.role');
  assert.equal(CALLER_SUPPLIED_IDENTITY_CARRIERS.has('request.role'), true);
  assert.equal(handoff.refusal.refusal.detail.carrier_known, true);
});

test('normalizeIdentityRefusalHandoff annotates known and unknown refusal codes with carrier metadata', () => {
  const unknownOutput = normalizeIdentityRefusalHandoff({
    accepted: false,
    refusal_code: 'some.unrecognized.code.v9',
    detail: { carrier: 'request.totally_made_up' },
  });

  assert.equal(unknownOutput.ok, false);
  assert.equal(
    unknownOutput.refusal.refusal.reason,
    LAUNCHER_REFUSAL_REASONS.IDENTITY_CALLER_SUPPLIED,
  );
  assert.equal(unknownOutput.refusal.refusal.detail.identity_refusal_code, 'some.unrecognized.code.v9');
  assert.equal(unknownOutput.refusal.refusal.detail.identity_refusal_code_known, false);
  assert.equal(unknownOutput.refusal.refusal.detail.carrier, 'request.totally_made_up');
  assert.equal(unknownOutput.refusal.refusal.detail.carrier_known, false);

  const noCarrierOutput = normalizeIdentityRefusalHandoff({
    accepted: false,
    refusal_code: IDENTITY_REFUSAL_CODES.PROMPT_TEXT_ROLE,
  });
  assert.equal(noCarrierOutput.refusal.refusal.detail.carrier, null);
  assert.equal(noCarrierOutput.refusal.refusal.detail.carrier_known, null);
  assert.equal(noCarrierOutput.refusal.refusal.detail.identity_refusal_code_known, true);
});

test('normalizeIdentityRefusalHandoff fails closed on malformed input', () => {
  for (const malformed of [
    'a string',
    42,
    [],
    {},
    { accepted: true, refusal_code: 'x' },
    { accepted: false },
    { accepted: false, refusal_code: '' },
  ]) {
    const handoff = normalizeIdentityRefusalHandoff(malformed);
    assert.equal(handoff.ok, false, `malformed handoff ${JSON.stringify(malformed)} must be refused`);
    assert.equal(
      handoff.refusal.refusal.reason,
      LAUNCHER_REFUSAL_REASONS.IDENTITY_REFUSAL_HANDOFF_INVALID,
    );
    assert.equal(
      handoff.refusal.refusal.code,
      adapterContract.launcherRefusalBackendCode(handoff.refusal.refusal.reason),
    );
  }
});

test('validateFamilyAdapter fails closed for non-object input', () => {
  assertFailClosedInvocation(
    validateFamilyAdapter,
    'not-an-object',
    'validateFamilyAdapter should fail closed for non-object input',
  );
});

test('validateDispatchSidecarDescriptor fails closed for non-object input', () => {
  assertFailClosedInvocation(
    validateDispatchSidecarDescriptor,
    42,
    'validateDispatchSidecarDescriptor should fail closed for non-object input',
  );
});
