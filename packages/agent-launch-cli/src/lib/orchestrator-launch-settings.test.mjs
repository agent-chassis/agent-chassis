import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildKeyFromParts,
  buildOrchestratorRuntimeDirKey,
  buildOrchestratorSettings,
  buildOrchestratorThreadName,
  resolveLocalProfileValue,
  resolveOrchestratorModelEffort,
  sanitizeOrchestratorNamePart,
} from './orchestrator-launch-settings.mjs';

const SAFE_PART = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;

function assertFamilyNeutral(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.ok(!/\bcodex\b/i.test(text), `expected no codex token in ${text}`);
  assert.ok(!/\bclaude\b/i.test(text), `expected no claude token in ${text}`);
  assert.ok(!/\bgemini\b/i.test(text), `expected no gemini token in ${text}`);
}

test('orchestrator settings sanitizeOrchestratorNamePart normalizes unsafe characters', () => {
  const sanitized = sanitizeOrchestratorNamePart('  Repo Name / Alpha+Beta  ');

  assert.equal(sanitized, 'Repo-Name-Alpha-Beta');
  assert.match(sanitized, SAFE_PART);
  assert.ok(!/\s/.test(sanitized));
  assertFamilyNeutral(sanitized);
});

test('orchestrator settings sanitizeOrchestratorNamePart falls back when nothing safe remains', () => {

  assert.equal(sanitizeOrchestratorNamePart('+++', { fallback: 'fallback-name' }), 'fallback-name');

  assert.equal(sanitizeOrchestratorNamePart('   ', { fallback: '***' }), 'unknown');
});

test('orchestrator runtime buildKeyFromParts joins sanitized parts family-neutrally', () => {
  const key = buildKeyFromParts(['Repo Name', 'WK-0777', 'state dir']);

  assert.equal(key, 'Repo-Name-WK-0777-state-dir');
  assert.match(key, SAFE_PART);
  assertFamilyNeutral(key);
});

test('orchestrator runtime buildKeyFromParts honors fallback and custom separator', () => {

  assert.equal(buildKeyFromParts([], { fallback: 'runtime' }), 'runtime');
  assert.equal(buildKeyFromParts(null), 'runtime');

  assert.equal(buildKeyFromParts(['', '   ']), 'unknown-unknown');

  assert.equal(buildKeyFromParts(['a', 'b'], { separator: '/' }), 'a/b');
});

test('orchestrator runtime buildOrchestratorRuntimeDirKey sanitizes state-dir, repo, and subject', () => {
  const runtimeDirKey = buildOrchestratorRuntimeDirKey({
    stateDirName: '.agent-runs/orchestrator runtime',
    repoName: 'agent-chassis/agent chassis',
    subject: 'WK-0777#orchestrator-settings-runtime-dir-core-tests-rework',
  });

  assert.match(runtimeDirKey, SAFE_PART);

  assert.equal(
    runtimeDirKey,
    'agent-runs-orchestrator-runtime-agent-chassis-agent-chassis-WK-0777-orchestrator-settings-runtime-dir-core-tests-rework',
  );
  const lowered = runtimeDirKey.toLowerCase();
  assert.ok(lowered.includes('portfolio'));
  assert.ok(lowered.includes('wiki'));
  assert.ok(lowered.includes('tools'));
  assert.ok(lowered.includes('wk-0777'));
  assert.ok(lowered.includes('runtime'));
  assertFamilyNeutral(runtimeDirKey);
});

test('orchestrator runtime buildOrchestratorRuntimeDirKey fills missing parts with a neutral placeholder', () => {

  const key = buildOrchestratorRuntimeDirKey({});
  assert.equal(key, 'unknown-unknown-unknown');
  assert.match(key, SAFE_PART);
  assertFamilyNeutral(key);
});

test('orchestrator settings buildOrchestratorThreadName formats subject, role, and repo', () => {
  const threadName = buildOrchestratorThreadName({
    subject: 'WK-0777#orchestrator-settings-runtime-dir-core-tests-rework',
    repoName: 'agent-chassis/agent chassis',
    roleLabel: 'worker',
  });

  assert.equal(
    threadName,
    'WK-0777-orchestrator-settings-runtime-dir-core-tests-rework worker (agent-chassis-agent-chassis)',
  );
  assert.match(threadName, /^.+ worker \(.+\)$/);
  assertFamilyNeutral(threadName);
});

test('orchestrator settings buildOrchestratorThreadName applies neutral fallbacks', () => {
  const threadName = buildOrchestratorThreadName({});

  assert.equal(threadName, 'orchestrator orchestrator (repo)');
  assertFamilyNeutral(threadName);
});

test('orchestrator settings resolveOrchestratorModelEffort prefers caller env keys over profile', () => {
  const env = {
    CUSTOM_ORCH_MODEL: 'env-model',
    CUSTOM_ORCH_EFFORT: 'env-effort',
  };
  const profile = { model: 'profile-model', effort: 'profile-effort' };

  const resolved = resolveOrchestratorModelEffort({
    env,
    profile,
    localModelKey: 'CUSTOM_ORCH_MODEL',
    localEffortKey: 'CUSTOM_ORCH_EFFORT',
  });

  assert.equal(resolved.model, 'env-model');
  assert.equal(resolved.effort, 'env-effort');
  assert.equal(resolved.modelSource, 'local');
  assert.equal(resolved.effortSource, 'local');
});

test('orchestrator settings resolveOrchestratorModelEffort falls back to profile values', () => {
  const profile = { model: 'profile-model', effort: 'profile-effort' };

  const resolved = resolveOrchestratorModelEffort({
    env: {},
    profile,
    localModelKey: 'CUSTOM_ORCH_MODEL',
    localEffortKey: 'CUSTOM_ORCH_EFFORT',
  });

  assert.equal(resolved.model, 'profile-model');
  assert.equal(resolved.effort, 'profile-effort');
  assert.equal(resolved.modelSource, 'profile');
  assert.equal(resolved.effortSource, 'profile');
});

test('orchestrator settings resolveOrchestratorModelEffort honors caller profile key names', () => {

  const resolved = resolveOrchestratorModelEffort({
    env: {},
    profile: { orchModel: 'p-model', orchEffort: 'p-effort' },
    localModelKey: 'ANY_MODEL',
    localEffortKey: 'ANY_EFFORT',
    profileModelKey: 'orchModel',
    profileEffortKey: 'orchEffort',
  });

  assert.equal(resolved.model, 'p-model');
  assert.equal(resolved.effort, 'p-effort');
  assert.equal(resolved.modelSource, 'profile');
  assert.equal(resolved.effortSource, 'profile');
});

test('orchestrator settings resolveOrchestratorModelEffort yields null source when unset', () => {
  const resolved = resolveOrchestratorModelEffort({});
  assert.equal(resolved.model, undefined);
  assert.equal(resolved.effort, undefined);
  assert.equal(resolved.modelSource, null);
  assert.equal(resolved.effortSource, null);
});

test('orchestrator settings resolveLocalProfileValue reports the winning source', () => {
  assert.deepEqual(
    resolveLocalProfileValue({ localValue: '  local  ', profileValue: 'profile' }),
    { source: 'local', value: 'local' },
  );
  assert.deepEqual(
    resolveLocalProfileValue({ localValue: '   ', profileValue: ' profile ' }),
    { source: 'profile', value: 'profile' },
  );
  assert.deepEqual(resolveLocalProfileValue({}), { source: null, value: undefined });
});

test('orchestrator settings buildOrchestratorSettings passes through flags and source labels', () => {
  const env = { CUSTOM_ORCH_MODEL: 'env-model' };
  const profile = { model: 'profile-model', effort: 'profile-effort' };

  const settings = buildOrchestratorSettings({
    appLabel: 'shared-orchestrator',
    modelFlag: '--model',
    effortFlag: '--effort',
    env,
    profile,
    localModelKey: 'CUSTOM_ORCH_MODEL',
    localEffortKey: 'CUSTOM_ORCH_EFFORT',
    repoName: 'agent-chassis/agent chassis',
    stateDirName: '.agent-runs/orchestrator runtime',
    subject: 'WK-0777#orchestrator-settings-runtime-dir-core-tests-rework',
    roleLabel: 'worker',
  });

  assert.equal(settings.appLabel, 'shared-orchestrator');
  assert.equal(settings.modelFlag, '--model');
  assert.equal(settings.effortFlag, '--effort');

  assert.equal(settings.model, 'env-model');
  assert.equal(settings.effort, 'profile-effort');
  assert.equal(settings.modelSource, 'local');
  assert.equal(settings.effortSource, 'profile');

  assert.equal(settings.repoName, 'agent-chassis-agent-chassis');
  assert.equal(settings.stateDirName, 'agent-runs-orchestrator-runtime');
  assert.equal(settings.subject, 'WK-0777-orchestrator-settings-runtime-dir-core-tests-rework');
  assert.equal(settings.roleLabel, 'worker');
  assert.match(settings.runtimeDirKey, SAFE_PART);
  assert.equal(
    settings.threadName,
    'WK-0777-orchestrator-settings-runtime-dir-core-tests-rework worker (agent-chassis-agent-chassis)',
  );

  assertFamilyNeutral(settings);
});

test('orchestrator settings buildOrchestratorSettings is deterministic and side-effect-free', () => {
  const input = {
    appLabel: 'shared-orchestrator',
    modelFlag: '--model',
    effortFlag: '--effort',
    env: { M: 'm' },
    profile: { model: 'pm', effort: 'pe' },
    localModelKey: 'M',
    localEffortKey: 'E',
    repoName: 'repo one',
    stateDirName: 'state dir',
    subject: 'subject one',
    roleLabel: 'orchestrator',
  };
  const frozenEnv = Object.freeze({ ...input.env });
  const frozenProfile = Object.freeze({ ...input.profile });

  const first = buildOrchestratorSettings({ ...input, env: frozenEnv, profile: frozenProfile });
  const second = buildOrchestratorSettings({ ...input, env: frozenEnv, profile: frozenProfile });

  assert.deepEqual(first, second);
  assert.deepEqual(frozenEnv, { M: 'm' });
  assert.deepEqual(frozenProfile, { model: 'pm', effort: 'pe' });
});
