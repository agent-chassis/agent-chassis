import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestDispatchBackend } from './workspace-agent-dispatch-backend-shared.mjs';

const REVIEWER_ROLE = 'reviewer';
const REDTEAM_ROLE = 'redteam';
const WORKER_ROLE = 'worker';

const SUBJECT = 'WK-0999';
const OTHER_SUBJECT = 'WK-0998';
const CALLER_SESSION_ID = 'sess-wk-0999';

const REVIEWER_OUTCOME_NO_FINDINGS = 'no_findings';
const REVIEWER_OUTCOME_CLEAN_FINDINGS = 'passed_no_blocking_or_medium_findings';
const REVIEWER_OUTCOME_CHANGES_REQUESTED = 'changes_requested';

const FIXTURE_CONTROL_IDS = Object.freeze([
  'write_scope_total_loc',
  'max_write_file_loc',
  'write_scope_count',
  'acceptance_criteria_count',
  'validation_command_count',
  'expected_changed_line_budget',
  'declared_runtime_mode_count',
  'artifact_kind_count',
]);

const UNRECOGNISED_CONTROL_IDS = Object.freeze([
  'sibling_visibility_count',
  'general',
  'quality',
  'node-engine:write_scope_total_loc',
  'Write_Scope_Total_Loc',
  'This write scope looks fine to me.',
]);

const REVIEW_RESULT_BOUNDED_KEYS = Object.freeze([
  'blocking_finding_count',
  'clean_review',
  'medium_finding_count',
  'no_findings',
  'review_outcome',
  'reviewed_controls',
]);

const ZERO_COUNTS = Object.freeze({
  total: 0,
  blocking: 0,
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
});

function counts(overrides = {}) {
  return { ...ZERO_COUNTS, ...overrides };
}

function reviewedControls(controlIds = FIXTURE_CONTROL_IDS) {
  return controlIds.map((control_id) => ({ control_id, result: 'pass' }));
}

function finding(overrides = {}) {
  return {
    id: 'F-001',
    title: 'informational note',
    severity: 'low',
    blocking: false,
    affected_paths: [{ path: 'tests/workspace-agent-dispatch-review-result.test.mjs', line: 1 }],
    control_id: 'write_scope_total_loc',
    ...overrides,
  };
}

function roleResultPayload(overrides = {}) {
  const {
    reported_role = REVIEWER_ROLE,
    reported_subject = SUBJECT,
    reported_outcome = REVIEWER_OUTCOME_NO_FINDINGS,
    findings = [],
    finding_counts = counts(),
    reviewed_controls = reviewedControls(),
    summary,
  } = overrides;

  const payload = {
    schema_version: 'agent-role-result.v1',
    reported_role,
    reported_subject,
    reported_outcome,
    findings,
    finding_counts,
    reviewed_controls,
  };
  if (summary !== undefined) {
    payload.summary = summary;
  }
  return payload;
}

function renderTerminalText(payload) {
  const json = JSON.stringify(payload, null, 2);
  return `Reviewed the slice against its acceptance criteria.\n\n\`\`\`agent-role-result.v1\n${json}\n\`\`\`\n`;
}

function makeTextExecutor(finalResponseText, { status = 'succeeded' } = {}) {
  return async () => ({
    status,
    final_result: {
      kind: 'findings',
      findings: { text: finalResponseText },
      full_response: { text: finalResponseText },
    },
  });
}

function makeBackend(finalResponseText, { status = 'succeeded' } = {}) {
  return createTestDispatchBackend({
    launchExecutor: makeTextExecutor(finalResponseText, { status }),
    clock: () => 0,
    runIdFactory: () => 'wkdb_slice046_test',
    monitorHandleFactory: () => 'wkmh_slice046_test',
  });
}

async function dispatch({
  finalResponseText,
  role = REVIEWER_ROLE,
  subject = SUBJECT,
  status = 'succeeded',
}) {
  const backend = makeBackend(finalResponseText, { status });
  const launch = await backend.startLaunch({
    caller_session_id: CALLER_SESSION_ID,
    role,
    app: 'codex',
    subject,
  });
  return { backend, launch };
}

async function dispatchPayload({ payload, role, subject, status } = {}) {
  return dispatch({
    finalResponseText: renderTerminalText(payload),
    role,
    subject,
    status,
  });
}

function assertCleanReviewedControls(launch, message, expectedControlIds = FIXTURE_CONTROL_IDS) {
  assert.equal(launch.accepted, true, `${message}: launch must be accepted`);
  assert.ok(launch.review_result, `${message}: a clean review_result must be projected`);
  assert.equal(launch.review_result.clean_review, true, `${message}: review must be clean`);
  assert.deepEqual(
    launch.review_result.reviewed_controls,
    [...expectedControlIds].sort(),
    `${message}: expected the closed control ids to project in canonical sorted order`,
  );
  assert.equal(
    launch.review_result.reviewed_controls.length,
    expectedControlIds.length,
    `${message}: expected exactly ${expectedControlIds.length} reviewed controls`,
  );
}

function assertNoReviewedControls(launch, message) {
  assert.equal(launch.accepted, true, `${message}: launch is still accepted`);
  assert.equal(
    launch.review_result,
    undefined,
    `${message}: invalid/unclean/untrusted evidence must not project any review_result`,
  );
}

test('projects every reviewed control from clean no-findings reviewer text', async () => {
  const payload = roleResultPayload({
    reported_outcome: REVIEWER_OUTCOME_NO_FINDINGS,
    findings: [],
    finding_counts: counts(),
    reviewed_controls: reviewedControls(),
  });

  const { backend, launch } = await dispatchPayload({ payload });

  assertCleanReviewedControls(launch, 'clean no-findings projection via startLaunch');

  const status = await backend.getRunStatus({
    caller_session_id: CALLER_SESSION_ID,
    monitor_handle: launch.monitor_handle,
    subject: SUBJECT,
  });
  assertCleanReviewedControls(status, 'clean no-findings projection via getRunStatus');
});

test('projects every reviewed control from clean low/info reviewer text', async () => {
  const payload = roleResultPayload({
    reported_outcome: REVIEWER_OUTCOME_CLEAN_FINDINGS,
    findings: [
      finding({
        id: 'F-101',
        title: 'informational note',
        severity: 'low',
        blocking: false,
        control_id: 'write_scope_total_loc',
      }),
    ],
    finding_counts: counts({ total: 1, low: 1 }),
    reviewed_controls: reviewedControls(),
  });

  const { launch } = await dispatchPayload({ payload });

  assertCleanReviewedControls(launch, 'clean low/info projection via startLaunch');
});

test('redteam clean review_result projects every reviewed control', async () => {

  const payload = roleResultPayload({
    reported_role: REDTEAM_ROLE,
    reported_outcome: REVIEWER_OUTCOME_NO_FINDINGS,
    findings: [],
    finding_counts: counts(),
    reviewed_controls: reviewedControls(),
  });

  const { launch } = await dispatchPayload({ payload, role: REDTEAM_ROLE });

  assertCleanReviewedControls(launch, 'clean redteam all-eight projection');
});

test('projects each control individually in reviewed_controls', async () => {

  for (const controlId of FIXTURE_CONTROL_IDS) {
    const payload = roleResultPayload({
      reported_outcome: REVIEWER_OUTCOME_NO_FINDINGS,
      findings: [],
      finding_counts: counts(),
      reviewed_controls: reviewedControls([controlId]),
    });

    const { launch } = await dispatchPayload({ payload });
    assertCleanReviewedControls(launch, `single control ${controlId}`, [controlId]);
  }
});

test('does not project a clean review_result when any reviewed control result is fail', async () => {

  for (const failingControl of FIXTURE_CONTROL_IDS) {
    const reviewed_controls = FIXTURE_CONTROL_IDS.map((control_id) => ({
      control_id,
      result: control_id === failingControl ? 'fail' : 'pass',
    }));
    const payload = roleResultPayload({
      reported_outcome: REVIEWER_OUTCOME_NO_FINDINGS,
      findings: [],
      finding_counts: counts(),
      reviewed_controls,
    });

    const { launch } = await dispatchPayload({ payload });
    assertNoReviewedControls(launch, `failed control ${failingControl} with otherwise-clean counts`);
  }
});

test('review attestation authority excludes findings prose and affected_paths', async () => {

  const SECRET_TITLE = 'sensitive-finding-title-must-not-project-as-authority';
  const SECRET_PATH = 'packages/agent-launch-core/src/lib/secret-affected-path.mjs';
  const payload = roleResultPayload({
    reported_outcome: REVIEWER_OUTCOME_CLEAN_FINDINGS,
    findings: [
      finding({
        id: 'F-501',
        title: SECRET_TITLE,
        severity: 'low',
        blocking: false,
        affected_paths: [{ path: SECRET_PATH, line: 7 }],
        control_id: 'write_scope_total_loc',
      }),
    ],
    finding_counts: counts({ total: 1, low: 1 }),
    reviewed_controls: reviewedControls(),
  });

  const { launch } = await dispatchPayload({ payload });
  assertCleanReviewedControls(launch, 'clean low finding with sensitive prose');

  const reviewResultText = JSON.stringify(launch.review_result);
  assert.ok(
    !reviewResultText.includes(SECRET_TITLE),
    'finding title must not project into review_result attestation authority',
  );
  assert.ok(
    !reviewResultText.includes(SECRET_PATH),
    'affected_paths must not project into review_result attestation authority',
  );
  assert.deepEqual(
    Object.keys(launch.review_result).sort(),
    [...REVIEW_RESULT_BOUNDED_KEYS],
    'review_result must carry only the bounded attestation-authority fields',
  );
});

test('does not project reviewed controls for worker-role child output', async () => {

  const payload = roleResultPayload({
    reported_role: WORKER_ROLE,
    reported_outcome: 'completed',
    findings: [],
    finding_counts: counts(),
    reviewed_controls: [],
  });

  const { launch } = await dispatchPayload({ payload, role: REVIEWER_ROLE });

  assertNoReviewedControls(launch, 'worker-role child output');
});

test('does not project reviewed controls for a non-terminal run', async () => {
  const payload = roleResultPayload();

  const { launch } = await dispatchPayload({ payload, status: 'running' });

  assert.equal(launch.terminal, false, 'non-terminal run must not be terminal');
  assertNoReviewedControls(launch, 'non-terminal run status');
});

test('does not project reviewed controls when the trusted run is not a reviewer', async () => {

  const payload = roleResultPayload({ reported_role: REVIEWER_ROLE });

  const { launch } = await dispatchPayload({ payload, role: WORKER_ROLE });

  assertNoReviewedControls(launch, 'trusted run role mismatch');
});

test('does not project reviewed controls on subject mismatch', async () => {
  const payload = roleResultPayload({ reported_subject: OTHER_SUBJECT });

  const { launch } = await dispatchPayload({ payload, subject: SUBJECT });

  assertNoReviewedControls(launch, 'subject mismatch');
});

test('does not project reviewed controls for malformed prose-only output', async () => {
  const proseOnlyText = 'Looks fine to me. No structured JSON was emitted.';
  const { launch } = await dispatch({
    finalResponseText: proseOnlyText,
  });

  assert.equal(launch.status, 'succeeded', 'prose-only output must not fail the run');
  assert.equal(
    launch.final_result.full_response.text,
    proseOnlyText,
    'human-useful final prose must remain available as diagnostics',
  );
  assert.equal(
    launch.final_result.structured_role_result.valid,
    false,
    'malformed structured role result must be explicit and loud',
  );
  assert.ok(
    launch.final_result.structured_role_result.diagnostics.some(
      (diagnostic) => diagnostic.code === 'missing_result',
    ),
    'invalid structured role result must carry parser diagnostics',
  );
  assertNoReviewedControls(launch, 'prose-only output');
});

test('does not project reviewed controls for unclean structured results', async () => {
  const cases = [
    {
      label: 'blocking high-severity finding',
      payload: roleResultPayload({
        reported_outcome: REVIEWER_OUTCOME_CHANGES_REQUESTED,
        findings: [
          finding({
            id: 'F-201',
            title: 'write scope exceeds total LOC budget',
            severity: 'high',
            blocking: true,
            control_id: 'write_scope_total_loc',
          }),
        ],
        finding_counts: counts({ total: 1, blocking: 1, high: 1 }),
        reviewed_controls: reviewedControls(),
      }),
    },
    {
      label: 'finding-count mismatch',
      payload: roleResultPayload({
        reported_outcome: REVIEWER_OUTCOME_NO_FINDINGS,
        findings: [],
        finding_counts: counts({ total: 1 }),
        reviewed_controls: reviewedControls(),
      }),
    },
    {
      label: 'duplicate finding id',
      payload: roleResultPayload({
        reported_outcome: REVIEWER_OUTCOME_CHANGES_REQUESTED,
        findings: [
          finding({ id: 'F-301', title: 'first finding', severity: 'low', blocking: false }),
          finding({ id: 'F-301', title: 'duplicate finding', severity: 'low', blocking: false }),
        ],
        finding_counts: counts({ total: 2, low: 2 }),
        reviewed_controls: reviewedControls(),
      }),
    },
  ];

  for (const testCase of cases) {
    const { launch } = await dispatchPayload({ payload: testCase.payload });
    assertNoReviewedControls(launch, `unclean structured result: ${testCase.label}`);
  }
});

test('carries an unrecognised reviewed control end to end into the projected controls', async () => {
  for (const controlId of UNRECOGNISED_CONTROL_IDS) {
    const payload = roleResultPayload({
      reported_outcome: REVIEWER_OUTCOME_NO_FINDINGS,
      findings: [],
      finding_counts: counts(),
      reviewed_controls: reviewedControls([controlId]),
    });

    const { backend, launch } = await dispatchPayload({ payload });

    assert.deepEqual(
      launch.final_result?.structured_role_result?.reviewed_controls,
      [{ control_id: controlId, result: 'pass' }],
      `unrecognised control ${controlId} must survive the structured_role_result carry`,
    );
    assertCleanReviewedControls(launch, `unrecognised control ${controlId}`, [controlId]);

    const status = await backend.getRunStatus({
      caller_session_id: CALLER_SESSION_ID,
      monitor_handle: launch.monitor_handle,
      subject: SUBJECT,
    });
    assertCleanReviewedControls(status, `unrecognised control ${controlId} via getRunStatus`, [controlId]);
  }
});

test('carries an unrecognised reviewed control alongside recognised ones', async () => {
  const controlIds = ['sibling_visibility_count', 'write_scope_total_loc'];
  const payload = roleResultPayload({
    reported_outcome: REVIEWER_OUTCOME_NO_FINDINGS,
    findings: [],
    finding_counts: counts(),
    reviewed_controls: reviewedControls(controlIds),
  });

  const { launch } = await dispatchPayload({ payload });
  assertCleanReviewedControls(launch, 'mixed recognised and unrecognised controls', controlIds);
});

test('a fail on an unrecognised reviewed control blocks the clean review_result', async () => {
  for (const controlId of UNRECOGNISED_CONTROL_IDS) {
    const payload = roleResultPayload({
      reported_outcome: REVIEWER_OUTCOME_NO_FINDINGS,
      findings: [],
      finding_counts: counts(),
      reviewed_controls: [{ control_id: controlId, result: 'fail' }],
    });

    const { launch } = await dispatchPayload({ payload });
    assertNoReviewedControls(launch, `failed unrecognised control ${controlId}`);
  }
});

test('a fail on an unrecognised control blocks even when every recognised control passes', async () => {
  const reviewed_controls = [
    ...FIXTURE_CONTROL_IDS.map((control_id) => ({ control_id, result: 'pass' })),
    { control_id: 'sibling_visibility_count', result: 'fail' },
  ];
  const payload = roleResultPayload({
    reported_outcome: REVIEWER_OUTCOME_NO_FINDINGS,
    findings: [],
    finding_counts: counts(),
    reviewed_controls,
  });

  const { launch } = await dispatchPayload({ payload });
  assertNoReviewedControls(launch, 'unrecognised fail among otherwise-clean recognised passes');
});

test('still refuses malformed, empty, and duplicate reviewed_controls', async () => {
  const invalidCases = [
    { label: 'empty control id', reviewed_controls: [{ control_id: '', result: 'pass' }] },
    { label: 'whitespace-only control id', reviewed_controls: [{ control_id: '   ', result: 'pass' }] },
    { label: 'non-string control id', reviewed_controls: [{ control_id: 42, result: 'pass' }] },
    { label: 'null control id', reviewed_controls: [{ control_id: null, result: 'pass' }] },
    { label: 'wrong-type container', reviewed_controls: 'write_scope_total_loc' },
    {
      label: 'unexpected entry field',
      reviewed_controls: [{ control_id: 'write_scope_total_loc', result: 'pass', extra: true }],
    },
    {
      label: 'non-pass/fail result',
      reviewed_controls: [{ control_id: 'write_scope_total_loc', result: 'warn' }],
    },
    {
      label: 'duplicate recognised control id',
      reviewed_controls: reviewedControls(['write_scope_total_loc', 'write_scope_total_loc']),
    },
    {
      label: 'duplicate unrecognised control id',
      reviewed_controls: reviewedControls(['sibling_visibility_count', 'sibling_visibility_count']),
    },
  ];

  for (const testCase of invalidCases) {
    const payload = roleResultPayload({
      reported_outcome: REVIEWER_OUTCOME_NO_FINDINGS,
      findings: [],
      finding_counts: counts(),
      reviewed_controls: testCase.reviewed_controls,
    });

    const { launch } = await dispatchPayload({ payload });
    assertNoReviewedControls(launch, `shape violation: ${testCase.label}`);
  }
});

test('still refuses a worker payload carrying a non-empty reviewed_controls', async () => {
  for (const controlId of ['write_scope_total_loc', 'sibling_visibility_count']) {
    const payload = roleResultPayload({
      reported_role: WORKER_ROLE,
      reported_outcome: 'completed',
      findings: [],
      finding_counts: counts(),
      reviewed_controls: [{ control_id: controlId, result: 'pass' }],
    });

    const { launch } = await dispatchPayload({ payload, role: WORKER_ROLE });
    assertNoReviewedControls(launch, `worker-supplied reviewed control ${controlId}`);
  }
});
