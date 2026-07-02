

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BACKEND_REFUSAL_CODES
} from '@agent-chassis/agent-launch-core';
import {
  FAMILY_MODEL_DISPOSITIONS,
  FAMILY_REFUSAL_TRANSPORTS,
  FAMILY_MODEL_GATE_REFUSAL_REASONS,
  LAUNCHER_WRITE_POSTURES,
  LAUNCHER_WRITE_POSTURE_FAMILIES,
  LAUNCHER_SCOPE_MOUNT_SANDBOX_MODES,
  LAUNCHER_ORCHESTRATOR_WRITABLE_PROJECT_ROOTS,
  LAUNCHER_COORDINATION_WRITE_ROOTS,
  resolveFamilyModelDisposition,
  resolveFamilyRoleModelGate,
  buildFamilyModelFlagArgs,
  buildFamilyModelRefusal,
  launcherRoleWritePosture,
  launcherRoleWritableRootPolicy,
  resolveLauncherRoleWritePosture,
} from '../packages/agent-launch-cli/src/lib/workspace-agent-family-policy.mjs';

const CODEX_REASON = 'model_hint_unsupported_for_codex_executor';
const AGY_REASON = 'model_hint_unsupported_for_agy_executor';
const AGY_APP_ID = 'agy';
const CLAUDE_MODEL_FLAG = '--model';

test('absent hint disposes as absent with a null model for every family', () => {
  for (const model of [undefined, null, '', 0, false, {}, ['x']]) {
    const codex = resolveFamilyModelDisposition({ model });
    assert.equal(codex.disposition, FAMILY_MODEL_DISPOSITIONS.ABSENT, `codex model=${JSON.stringify(model)}`);
    assert.equal(codex.model, null);
    assert.equal(codex.supported, false);

    const claude = resolveFamilyModelDisposition({ model, isModelSupported: () => true });
    assert.equal(claude.disposition, FAMILY_MODEL_DISPOSITIONS.ABSENT);
    assert.equal(claude.model, null);
  }
});

test('Codex refuses a typed model hint it cannot route to the CLI', () => {
  const disp = resolveFamilyModelDisposition({ model: 'gpt-5-codex' });
  assert.equal(disp.disposition, FAMILY_MODEL_DISPOSITIONS.REFUSE);
  assert.equal(disp.model, 'gpt-5-codex');
  assert.equal(disp.supported, false);
});

test('Agy refuses a typed model hint it cannot route to the CLI', () => {
  const disp = resolveFamilyModelDisposition({ model: 'agy-premier' });
  assert.equal(disp.disposition, FAMILY_MODEL_DISPOSITIONS.REFUSE);
  assert.equal(disp.model, 'agy-premier');
  assert.equal(disp.supported, false);
});

test('Claude honors a supported model hint', () => {
  const disp = resolveFamilyModelDisposition({
    model: 'claude-opus-4-8',
    isModelSupported: () => true,
  });
  assert.equal(disp.disposition, FAMILY_MODEL_DISPOSITIONS.HONOR);
  assert.equal(disp.model, 'claude-opus-4-8');
  assert.equal(disp.supported, true);
});

test('a family allowlist predicate refuses an unknown model but honors a known one', () => {
  const isModelSupported = (m) => m === 'claude-opus-4-8';
  const honored = resolveFamilyModelDisposition({ model: 'claude-opus-4-8', isModelSupported });
  assert.equal(honored.disposition, FAMILY_MODEL_DISPOSITIONS.HONOR);

  const refused = resolveFamilyModelDisposition({ model: 'some-other-model', isModelSupported });
  assert.equal(refused.disposition, FAMILY_MODEL_DISPOSITIONS.REFUSE);
  assert.equal(refused.model, 'some-other-model');
});

test('disposition is resilient to no-arg / malformed call shapes', () => {
  assert.equal(resolveFamilyModelDisposition().disposition, FAMILY_MODEL_DISPOSITIONS.ABSENT);
  assert.equal(resolveFamilyModelDisposition({}).disposition, FAMILY_MODEL_DISPOSITIONS.ABSENT);
});

test('Claude honored model produces the family `--model <model>` flag args', () => {
  const disp = resolveFamilyModelDisposition({ model: 'claude-opus-4-8', isModelSupported: () => true });
  const args = buildFamilyModelFlagArgs({
    disposition: disp.disposition,
    model: disp.model,
    flag: CLAUDE_MODEL_FLAG,
  });
  assert.deepEqual(args, ['--model', 'claude-opus-4-8']);
});

test('flag args are empty for absent and refuse dispositions', () => {
  assert.deepEqual(
    buildFamilyModelFlagArgs({ disposition: FAMILY_MODEL_DISPOSITIONS.ABSENT, model: null, flag: CLAUDE_MODEL_FLAG }),
    [],
  );
  assert.deepEqual(
    buildFamilyModelFlagArgs({ disposition: FAMILY_MODEL_DISPOSITIONS.REFUSE, model: 'x', flag: CLAUDE_MODEL_FLAG }),
    [],
  );
});

test('flag args are empty when the family flag spelling or model is missing', () => {
  assert.deepEqual(
    buildFamilyModelFlagArgs({ disposition: FAMILY_MODEL_DISPOSITIONS.HONOR, model: 'x', flag: '' }),
    [],
  );
  assert.deepEqual(
    buildFamilyModelFlagArgs({ disposition: FAMILY_MODEL_DISPOSITIONS.HONOR, model: '', flag: CLAUDE_MODEL_FLAG }),
    [],
  );
  assert.deepEqual(buildFamilyModelFlagArgs(), []);
});

test('Codex in-process model refusal carries the launcher envelope shape', () => {
  const disp = resolveFamilyModelDisposition({ model: 'gpt-5-codex' });
  const refusal = buildFamilyModelRefusal({
    transport: FAMILY_REFUSAL_TRANSPORTS.IN_PROCESS,
    reason: CODEX_REASON,
    detail: { model: disp.model },
  });
  assert.deepEqual(refusal, {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason: CODEX_REASON,
      detail: { model: 'gpt-5-codex' },
    },
  });
});

test('Codex broker model refusal carries the host-write-authority envelope shape', () => {
  const disp = resolveFamilyModelDisposition({ model: 'gpt-5-codex' });
  const refusal = buildFamilyModelRefusal({
    transport: FAMILY_REFUSAL_TRANSPORTS.BROKER,
    reason: CODEX_REASON,
    detail: { model: disp.model },
  });
  assert.deepEqual(refusal, {
    ok: false,
    refusal: { reason: CODEX_REASON, detail: { model: 'gpt-5-codex' } },
  });
});

test('Agy in-process and broker model refusals carry the family `{ app, model }` detail', () => {
  const disp = resolveFamilyModelDisposition({ model: 'agy-premier' });

  const inProcess = buildFamilyModelRefusal({
    transport: FAMILY_REFUSAL_TRANSPORTS.IN_PROCESS,
    reason: AGY_REASON,
    detail: { app: AGY_APP_ID, model: disp.model },
  });
  assert.deepEqual(inProcess, {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason: AGY_REASON,
      detail: { app: 'agy', model: 'agy-premier' },
    },
  });

  const broker = buildFamilyModelRefusal({
    transport: FAMILY_REFUSAL_TRANSPORTS.BROKER,
    reason: AGY_REASON,
    detail: { app: AGY_APP_ID, model: disp.model },
  });
  assert.deepEqual(broker, {
    ok: false,
    refusal: { reason: AGY_REASON, detail: { app: 'agy', model: 'agy-premier' } },
  });
});

test('in-process transport is the default and an explicit code is honored', () => {
  const refusal = buildFamilyModelRefusal({ reason: CODEX_REASON });
  assert.equal(refusal.accepted, false);
  assert.equal(refusal.refusal.code, BACKEND_REFUSAL_CODES.LAUNCH_REFUSED);

  const custom = buildFamilyModelRefusal({
    reason: CODEX_REASON,
    code: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
  });
  assert.equal(custom.refusal.code, BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE);
});

test('refusal fails closed on a missing or blank reason', () => {
  for (const reason of [undefined, null, '', '   ', 42, {}]) {
    const result = buildFamilyModelRefusal({ reason });
    assert.equal(result.ok, false, `reason=${JSON.stringify(reason)}`);
    assert.equal(result.error.code, 'missing_refusal_reason');
    assert.equal(result.accepted, undefined);
    assert.equal(result.refusal, undefined);
  }
});

test('refusal fails closed on an unknown transport rather than emitting a malformed envelope', () => {
  const result = buildFamilyModelRefusal({ transport: 'sideband', reason: CODEX_REASON });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'invalid_refusal_transport');
  assert.equal(result.accepted, undefined);
  assert.equal(result.refusal, undefined);
});

test('disposition diagnostics expose a bounded, scalar-only shape', () => {
  const disp = resolveFamilyModelDisposition({ model: 'gpt-5-codex' });
  const diag = disp.diagnostics;
  assert.deepEqual(Object.keys(diag).sort(), ['details', 'disposition', 'model', 'supported']);
  assert.equal(diag.disposition, FAMILY_MODEL_DISPOSITIONS.REFUSE);
  assert.equal(diag.model, 'gpt-5-codex');
  assert.equal(diag.supported, false);
  assert.ok(Array.isArray(diag.details));
  assert.ok(diag.details.length <= 6);
});

test('refusal-failure diagnostics are bounded and never leak raw input objects', () => {
  const result = buildFamilyModelRefusal({ transport: 'sideband', reason: CODEX_REASON });
  const diag = result.error.diagnostics;
  assert.deepEqual(Object.keys(diag).sort(), ['details', 'disposition', 'model', 'supported']);
  assert.ok(Array.isArray(diag.details));
  assert.ok(diag.details.length <= 6);
  for (const item of diag.details) {
    assert.equal(typeof item, 'string');
  }
});

test('role-model gate leaves worker no-hint launches to the worker plan builder', async () => {
  const profile = { backend_profile_key: 'worker' };
  let called = false;
  const result = await resolveFamilyRoleModelGate({
    role: 'worker',
    isWorker: true,
    resolvedProfile: profile,
    modelHint: undefined,
    resolveRoleModel: () => {
      called = true;
      return { ok: false, reason: 'should_not_resolve' };
    },
  });

  assert.equal(called, false);
  assert.deepEqual(result, {
    ok: true,
    resolvedProfile: profile,
    model: null,
    modelHint: null,
    disposition: FAMILY_MODEL_DISPOSITIONS.ABSENT,
  });
});

test('role-model gate injects a resolved reviewer model into resolvedProfile', async () => {
  const result = await resolveFamilyRoleModelGate({
    role: 'reviewer',
    isWorker: false,
    resolvedProfile: { backend_profile_key: 'review' },
    modelHint: null,
    dir: '/repo',
    resolveRoleModel: ({ role, resolvedProfile, dir }) => {
      assert.equal(role, 'reviewer');
      assert.equal(dir, '/repo');
      return {
        ok: true,
        model: 'gpt-5-codex-review',
        model_source: 'workspace_env',
        env_key: 'REVIEWER_MODEL',
        resolvedProfile: {
          ...resolvedProfile,
          model: 'gpt-5-codex-review',
          model_source: 'workspace_env',
        },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.model, 'gpt-5-codex-review');
  assert.equal(result.env_key, 'REVIEWER_MODEL');
  assert.equal(result.resolvedProfile.model, 'gpt-5-codex-review');
});

test('role-model gate refuses a model hint that diverges from the resolved role model', async () => {
  const result = await resolveFamilyRoleModelGate({
    role: 'redteam',
    modelHint: 'requested-model',
    resolveRoleModel: () => ({
      ok: true,
      model: 'resolved-model',
      resolvedProfile: { model: 'resolved-model' },
    }),
  });

  assert.deepEqual(result, {
    ok: false,
    reason: FAMILY_MODEL_GATE_REFUSAL_REASONS.MODEL_HINT_DIVERGES_FROM_RESOLVED_MODEL,
    detail: { requested: 'requested-model', resolved: 'resolved-model' },
  });
});

test('role-model gate preserves <role>_model_unset refusals from the shared role resolver', async () => {
  const result = await resolveFamilyRoleModelGate({
    role: 'reviewer',
    modelHint: null,
    resolveRoleModel: () => ({
      ok: false,
      reason: 'reviewer_model_unset',
      detail: {
        role: 'reviewer',
        env_key: 'REVIEWER_MODEL',
      },
    }),
  });

  assert.deepEqual(result, {
    ok: false,
    reason: 'reviewer_model_unset',
    detail: {
      role: 'reviewer',
      env_key: 'REVIEWER_MODEL',
    },
  });
});

test('role-model gate preserves worker resolvedProfile when a supplied hint matches', async () => {
  const profile = { backend_profile_key: 'worker' };
  const result = await resolveFamilyRoleModelGate({
    role: 'worker',
    isWorker: true,
    resolvedProfile: profile,
    modelHint: 'worker-model',
    resolveRoleModel: () => ({
      ok: true,
      model: 'worker-model',
      model_source: 'workspace_env',
      env_key: 'WORKER_MODEL',
      resolvedProfile: { model: 'worker-model' },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.model, 'worker-model');
  assert.equal(result.resolvedProfile, profile);
});

test('role-model gate can resolve the workspace env dir through an async adopter hook', async () => {
  const result = await resolveFamilyRoleModelGate({
    role: 'reviewer',
    cwd: '/workspace/subdir',
    resolveWorkspaceEnvDir: async (cwd) => {
      assert.equal(cwd, '/workspace/subdir');
      return '/workspace';
    },
    resolveRoleModel: ({ dir }) => {
      assert.equal(dir, '/workspace');
      return {
        ok: true,
        model: 'review-model',
        resolvedProfile: { model: 'review-model' },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.model, 'review-model');
});

test('launcherRoleWritePosture is role-complete with real launcher aliases', () => {
  assert.equal(launcherRoleWritePosture('worker'), LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE);
  assert.equal(launcherRoleWritePosture('reviewer'), LAUNCHER_WRITE_POSTURES.FINDINGS_ONLY);
  assert.equal(launcherRoleWritePosture('review'), LAUNCHER_WRITE_POSTURES.FINDINGS_ONLY);
  assert.equal(launcherRoleWritePosture('redteam'), LAUNCHER_WRITE_POSTURES.FINDINGS_ONLY);
  assert.equal(launcherRoleWritePosture('orchestrator'), LAUNCHER_WRITE_POSTURES.COORDINATION_WRITE_SCOPE);
  assert.equal(launcherRoleWritePosture('orch'), LAUNCHER_WRITE_POSTURES.COORDINATION_WRITE_SCOPE);
  assert.equal(launcherRoleWritePosture('orch-resume'), LAUNCHER_WRITE_POSTURES.COORDINATION_WRITE_SCOPE);
  assert.equal(launcherRoleWritePosture('unknown'), null);
});

test('scope-mount write posture serves Codex and Claude role decisions without family prefiltering', () => {
  const worker = resolveLauncherRoleWritePosture({
    role: 'worker',
    family: LAUNCHER_WRITE_POSTURE_FAMILIES.SCOPE_MOUNT,
  });
  assert.equal(worker.ok, true);
  assert.equal(worker.posture, LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE);
  assert.equal(worker.scopeMount.sandboxMode, LAUNCHER_SCOPE_MOUNT_SANDBOX_MODES.WORKSPACE_WRITE);
  assert.equal(worker.scopeMount.requiresAssignedWriteScope, true);

  for (const role of ['reviewer', 'review', 'redteam']) {
    const readOnly = resolveLauncherRoleWritePosture({
      role,
      family: LAUNCHER_WRITE_POSTURE_FAMILIES.SCOPE_MOUNT,
    });
    assert.equal(readOnly.ok, true, role);
    assert.equal(readOnly.posture, LAUNCHER_WRITE_POSTURES.FINDINGS_ONLY);
    assert.equal(readOnly.scopeMount.sandboxMode, LAUNCHER_SCOPE_MOUNT_SANDBOX_MODES.READ_ONLY);
    assert.deepEqual(readOnly.scopeMount.writableProjectRoots, []);
  }

  const orchestrator = resolveLauncherRoleWritePosture({
    role: 'orch',
    family: LAUNCHER_WRITE_POSTURE_FAMILIES.SCOPE_MOUNT,
  });
  assert.equal(orchestrator.ok, true);
  assert.equal(orchestrator.role, 'orchestrator');
  assert.equal(orchestrator.posture, LAUNCHER_WRITE_POSTURES.COORDINATION_WRITE_SCOPE);
  assert.equal(orchestrator.scopeMount.sandboxMode, LAUNCHER_SCOPE_MOUNT_SANDBOX_MODES.WORKSPACE_WRITE);
  assert.deepEqual(orchestrator.scopeMount.writableProjectRoots, ['docs', 'wiki']);
});

test('permission-flag write posture preserves Agy worker-only flag behavior', () => {
  const worker = resolveLauncherRoleWritePosture({
    role: 'worker',
    family: LAUNCHER_WRITE_POSTURE_FAMILIES.PERMISSION_FLAG,
    permissionFlag: '--dangerously-skip-permissions',
  });
  assert.equal(worker.ok, true);
  assert.equal(worker.posture, LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE);
  assert.equal(worker.permissionFlags.emitWritePermissionFlag, true);
  assert.deepEqual(worker.permissionFlags.args, ['--dangerously-skip-permissions']);

  for (const role of ['reviewer', 'redteam', 'orchestrator']) {
    const result = resolveLauncherRoleWritePosture({
      role,
      family: LAUNCHER_WRITE_POSTURE_FAMILIES.PERMISSION_FLAG,
      permissionFlag: '--dangerously-skip-permissions',
    });
    assert.equal(result.ok, true, role);
    assert.equal(result.permissionFlags.emitWritePermissionFlag, false);
    assert.deepEqual(result.permissionFlags.args, []);
  }
});

test('write-posture producer fails closed for unknown roles or posture families', () => {
  assert.deepEqual(resolveLauncherRoleWritePosture({ role: 'bogus' }), {
    ok: false,
    role: 'bogus',
    reason: 'launcher_role_unsupported_for_write_posture',
  });
  assert.deepEqual(resolveLauncherRoleWritePosture({ role: 'worker', family: 'local_policy' }), {
    ok: false,
    role: 'worker',
    reason: 'launcher_write_posture_family_unsupported',
    detail: { family: 'local_policy' },
  });
});

test('orchestrator writable-root policy is role-parameterized and shared', () => {
  const worker = launcherRoleWritableRootPolicy({ role: 'worker' });
  assert.equal(worker.ok, true);
  assert.deepEqual(worker.writableProjectRoots, []);
  assert.deepEqual(worker.coordinationWriteRoots, []);

  const reviewer = launcherRoleWritableRootPolicy({ role: 'reviewer' });
  assert.equal(reviewer.ok, true);
  assert.deepEqual(reviewer.writableProjectRoots, []);

  const orchestrator = launcherRoleWritableRootPolicy({ role: 'orch-resume' });
  assert.equal(orchestrator.ok, true);
  assert.equal(orchestrator.role, 'orchestrator');
  assert.equal(orchestrator.posture, LAUNCHER_WRITE_POSTURES.COORDINATION_WRITE_SCOPE);
  assert.deepEqual(orchestrator.writableProjectRoots, LAUNCHER_ORCHESTRATOR_WRITABLE_PROJECT_ROOTS);
  assert.deepEqual(orchestrator.writableProjectRoots, ['docs', 'wiki']);
  assert.deepEqual(new Set(orchestrator.coordinationWriteRoots), new Set(LAUNCHER_COORDINATION_WRITE_ROOTS));
  assert.deepEqual(new Set(orchestrator.coordinationWriteRoots), new Set(['docs/', 'wiki/']));
});

test('writable-root policy refuses unsupported roles without emitting writable roots', () => {
  assert.deepEqual(launcherRoleWritableRootPolicy({ role: 'unknown' }), {
    ok: false,
    role: 'unknown',
    reason: 'launcher_role_unsupported_for_write_posture',
    writableProjectRoots: [],
    coordinationWriteRoots: [],
  });
});
