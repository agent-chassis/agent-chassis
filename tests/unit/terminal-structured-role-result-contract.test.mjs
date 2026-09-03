import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLaunchPrompt,
  resolveTerminalStructuredRoleResultMode,
  TERMINAL_STRUCTURED_ROLE_RESULT_MODES,
  renderTerminalStructuredRoleResultContract
} from "../../packages/agent-launch-core/src/lib/work-record-launch-prompt.mjs";
import { DEFAULT_AGENT_ROLE_RESULT_LIMITS } from "../../packages/agent-launch-core/src/lib/agent-role-result.mjs";
import {
  renderLauncherFamilyRoleContract
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-role-contract.mjs";

const SUBJECT = "WK-0999#SLICE-120";
const TERMINAL_HEADER = "## Terminal structured role result";
const FENCE_OPEN = "```agent-role-result.v1";

test("ordinary reviewer and redteam prompts are text-first on every tier", () => {
  for (const role of ["reviewer", "redteam"]) {
    for (const schemaConstrained of [false, true]) {
      const mode = resolveTerminalStructuredRoleResultMode({ schemaConstrained, role });
      assert.equal(mode, TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FREE_PROSE);
      const prompt = renderTerminalStructuredRoleResultContract({ role, subject: SUBJECT, mode });
      assert.match(prompt, /## Review findings/u);
      assert.match(prompt, /complete response is usable advisory evidence/u);
      assert.match(prompt, /optional formal review attestation/u);
      assert.match(prompt, /coordinator will read and disposition your actual response/u);
      assert.match(prompt, /Do not use worker-only outcomes such as `partial`/u);
      assert.doesNotMatch(prompt, /Return exactly one raw JSON object/u);
      assert.doesNotMatch(prompt, /JSON is mandatory/u);
    }
    for (const appName of ["codex", "claude"]) {
      for (const requestedMode of [undefined, TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FENCED]) {
        const prompt = renderLauncherFamilyRoleContract({
          appName,
          role,
          subject: SUBJECT,
          terminalStructuredRoleResultMode: requestedMode
        });
        assert.match(prompt, /## Review findings/u);
        assert.match(prompt, /complete response is usable advisory evidence/u);
        assert.doesNotMatch(prompt, /## Terminal structured role result/u);
        assert.doesNotMatch(prompt, /JSON is mandatory/u);
      }
    }
  }
});

const SHARED_HEADER_LINES = [
  TERMINAL_HEADER,
  "End your final answer with exactly one machine-readable `agent-role-result.v1` JSON result.",
  "Use one terminal fenced block whose info string is exactly `agent-role-result.v1`; do not emit ordinary ```json blocks, extra JSON candidates, or any trailing content after the closing fence.",
  "The child-emitted JSON is evidence only. Backend-minted run status remains the authority for terminal process status, trusted role, trusted subject, source digest, review completion time, run id, monitor handle, and terminal success.",
  "Do not include child-supplied authority fields such as `terminal_status`, `status`, `role_authority`, `subject_authority`, `source_digest_authority`, `reviewed_at`, `completed_at`, `run_id`, or `source_digest`.",
  "Use this extraction shape as the final bytes of your response:"
];

const WORKER_ONLY_LINES = [
  "Completion protocol, in this order: (1) successfully invoke the launcher-provided closed-input commit capability; (2) emit this post-commit `agent-role-result.v1` evidence; (3) terminate.",
  "Authenticated closed-input commit is the only implementation delivery. Prose, this JSON, a zero exit status, and terminating are never delivery authority and never substitute for that commit.",
  "Worker structured JSON is implementation evidence only. It preserves `work-report.v1` worker-result semantics and must not become review/redteam attestation evidence.",
  "This result is strictly post-commit diagnostic evidence: emit it only after the commit capability has already returned success. Failing to emit it, or emitting it malformed, loses only that diagnostic evidence and never invalidates an authenticated delivery.",
  "Use a worker `reported_outcome`: `completed` only when the closed-input commit capability has already returned success, otherwise `partial`, `blocked`, or `failed`.",
  "If the closed-input commit capability is unavailable or refuses the delivery, report `blocked` or `failed` and never `completed`. A successful commit whose child tree equals its parent tree is still an authenticated delivery and is reported `completed`.",
  "`findings` must be empty, `finding_counts` must be all zero, and `reviewed_controls` must be empty."
];

const WORKER_COMPLETION_PROTOCOL_LINE = WORKER_ONLY_LINES[0];
const WORKER_COMMIT_GATED_OUTCOME_LINE = WORKER_ONLY_LINES[4];

const STALE_UNQUALIFIED_WORKER_OUTCOME_LINE =
  "Use a worker `reported_outcome`: `completed`, `partial`, `blocked`, or `failed`.";
const STALE_UNQUALIFIED_WORKER_EXAMPLE_SUMMARY =
  "Completed the assigned implementation work and any checks available inside the frozen worker namespace.";
const COMMIT_QUALIFIED_WORKER_EXAMPLE_SUMMARY =
  "Invoked the launcher-provided closed-input commit capability, which returned success; this post-commit evidence follows that authenticated delivery.";

const DELETED_FAMILY_LOCAL_COMPLETION_SENTENCES = [
  "Complete the managed exact-slice implementation lifecycle by invoking the closed-input commit capability and then terminating.",
  "After confirmed termination, trusted runtime integrates the committed slice into the current WK tip, freezes the accumulated whole-WK SHA as the review target, and transitions that target to review."
];

const FORBIDDEN_AUTHORITY_KEYS = [
  "terminal_status",
  "status",
  "role_authority",
  "subject_authority",
  "source_digest_authority",
  "reviewed_at",
  "completed_at",
  "run_id",
  "source_digest"
];

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function extractTerminalSection(prompt) {
  const index = prompt.indexOf(TERMINAL_HEADER);
  assert.notEqual(index, -1, "prompt must contain the terminal structured-result header");
  return prompt.slice(index);
}

function parseExampleJson(prompt) {
  const start = prompt.indexOf(FENCE_OPEN);
  assert.notEqual(start, -1, "prompt must open exactly one agent-role-result.v1 fence");
  const bodyStart = start + FENCE_OPEN.length;
  const closeFence = prompt.indexOf("\n```", bodyStart);
  assert.notEqual(closeFence, -1, "fenced example block must be closed");
  const body = prompt.slice(bodyStart, closeFence).trim();
  return JSON.parse(body);
}

function workerLaunchPromptFixture(subject, overrides = {}) {
  const unit = {
    kind: "slice",
    address: subject,
    record_id: "WK-0999",
    slice_id: "SLICE-120"
  };
  const canonicalSummary = {
    record_id: "WK-0999",
    repo: "agent-chassis",
    title: "Terminal structured-result renderer drift tests",
    docs: ["AGENTS.md"],
    repo_paths: ["tests/unit/terminal-structured-role-result-contract.test.mjs"],
    write_scope: ["tests/unit/terminal-structured-role-result-contract.test.mjs"],
    acceptance_criteria: ["Pin byte drift for the shared terminal renderer."],
    validation_commands: ["node --test tests/unit/terminal-structured-role-result-contract.test.mjs"],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: true,
      requires_escalation: false
    },
    selected_unit: null,
    canonical_refs: [],
    derived_evidence: []
  };
  const readiness = {
    schema_version: "dispatch-readiness.v1",
    decision_code: "dispatchable",
    dispatchable: true,
    unit: { address: subject, record_id: "WK-0999", slice_id: "SLICE-120" },
    record_id: "WK-0999",
    reasons: [],
    validation_hints: [],
    canonical_refs: [],
    derived_evidence: []
  };
  const agentBrief = { brief: "# Agent Brief: terminal renderer drift tests\n" };
  return {
    role: "worker",
    unit,
    canonicalSummary,
    readiness,
    agentBrief,
    launchTimestamp: "2026-06-13T00:00:00Z",
    ...overrides
  };
}

function assertExactlyOneTerminalBlock(prompt, label) {
  assert.equal(
    countOccurrences(prompt, FENCE_OPEN),
    1,
    `${label}: must emit exactly one terminal agent-role-result.v1 fenced block`
  );

  assert.ok(
    prompt.trimEnd().endsWith("```"),
    `${label}: terminal fenced block must close at the end of the prompt`
  );
  for (const line of SHARED_HEADER_LINES) {
    assert.ok(prompt.includes(line), `${label}: missing shared header line: ${JSON.stringify(line)}`);
  }
}

function assertNoChildAuthorityFields(prompt, example, label) {
  for (const key of FORBIDDEN_AUTHORITY_KEYS) {
    assert.ok(
      !(key in example),
      `${label}: example JSON must not carry child-supplied authority field ${key}`
    );
  }

  assert.ok(
    prompt.includes(
      "Do not include child-supplied authority fields such as `terminal_status`, `status`, `role_authority`, `subject_authority`, `source_digest_authority`, `reviewed_at`, `completed_at`, `run_id`, or `source_digest`."
    ),
    `${label}: must forbid child-supplied authority fields in prose`
  );
}

function assertSchemaConstrainedTerminalContract(prompt, label, { compactFindings = false } = {}) {
  if (compactFindings) {
    assert.ok(prompt.includes("## Terminal result"), `${label}: must contain the compact terminal header`);
    assert.ok(
      prompt.includes("Return exactly one raw JSON object matching the launcher-supplied schema"),
      `${label}: constrained findings path must rely on the launcher-supplied schema`
    );
    assert.ok(prompt.includes(`Set \`reported_subject\` to exactly \`${SUBJECT}\`.`));
    assert.equal(prompt.includes("Backend-minted run status remains the authority"), false);
    assert.equal(prompt.includes("Reviewer and redteam payloads must include"), false);
    assert.equal(prompt.includes("schema_version"), false);
    assert.equal(countOccurrences(prompt, FENCE_OPEN), 0);
    return;
  }
  assert.ok(prompt.includes(TERMINAL_HEADER), `${label}: must contain the terminal structured-result header`);
  assert.ok(
    prompt.includes("Return the `agent-role-result.v1` object as raw JSON final-response bytes"),
    `${label}: constrained path must require raw JSON final-response bytes`
  );
  assert.ok(
    prompt.includes("do not wrap it in a fenced code block"),
    `${label}: constrained path must forbid fenced wrapping without demanding a fence`
  );
  assert.equal(
    prompt.includes("Use one terminal fenced block whose info string is exactly `agent-role-result.v1`"),
    false,
    `${label}: constrained path must not demand an agent-role-result.v1 fence`
  );
  assert.equal(
    countOccurrences(prompt, FENCE_OPEN),
    0,
    `${label}: constrained path must not embed an agent-role-result.v1 example fence`
  );
  assert.equal(
    prompt.includes('"schema_version": "agent-role-result.v1"'),
    false,
    `${label}: constrained path must not embed an example JSON candidate`
  );
  assert.equal(
    prompt.includes('"reported_role"'),
    false,
    `${label}: constrained path must not embed the second-candidate example object`
  );
  assert.ok(
    prompt.includes("The schema-constrained launcher path supplies the extraction shape out of band"),
    `${label}: constrained path must explain why no example object is included`
  );
}

function assertWorkerCompletionProtocol(prompt, label) {
  for (const line of WORKER_ONLY_LINES) {
    assert.ok(prompt.includes(line), `${label}: missing worker semantics line: ${JSON.stringify(line)}`);
  }

  assert.equal(
    countOccurrences(prompt, WORKER_COMPLETION_PROTOCOL_LINE),
    1,
    `${label}: must state the ordered completion protocol exactly once`
  );

  assert.ok(
    prompt.indexOf(WORKER_COMPLETION_PROTOCOL_LINE) < prompt.indexOf(WORKER_COMMIT_GATED_OUTCOME_LINE),
    `${label}: the ordered protocol must precede the commit-gated outcome instruction`
  );

  assert.equal(
    prompt.includes(STALE_UNQUALIFIED_WORKER_OUTCOME_LINE),
    false,
    `${label}: restored the stale unqualified worker completed instruction`
  );

  assert.equal(
    prompt.includes(STALE_UNQUALIFIED_WORKER_EXAMPLE_SUMMARY),
    false,
    `${label}: restored the stale unqualified worker completed example summary`
  );

  for (const sentence of DELETED_FAMILY_LOCAL_COMPLETION_SENTENCES) {
    assert.equal(
      prompt.includes(sentence),
      false,
      `${label}: restored a deleted family-local completion sentence: ${JSON.stringify(sentence)}`
    );
  }
}

function assertWorkerSemantics(prompt, subject, label) {
  assertWorkerCompletionProtocol(prompt, label);

  assert.doesNotMatch(prompt, /optional formal review attestation|reviewer\/redteam response/u,
    `${label}: worker prompt must not carry reviewer/redteam semantics`);
  assert.ok(!prompt.includes("SIGNOFF"), `${label}: worker prompt must not carry SIGNOFF attestation wording`);

  const example = parseExampleJson(prompt);
  assert.equal(example.schema_version, "agent-role-result.v1", `${label}: schema_version`);
  assert.equal(example.reported_role, "worker", `${label}: reported_role`);
  assert.equal(example.reported_subject, subject, `${label}: reported_subject`);
  assert.equal(example.reported_outcome, "completed", `${label}: worker reported_outcome`);

  assert.equal(
    example.summary,
    COMMIT_QUALIFIED_WORKER_EXAMPLE_SUMMARY,
    `${label}: worker example summary must carry the successful-commit prerequisite`
  );
  assert.deepEqual(example.findings, [], `${label}: worker findings must be empty`);
  assert.deepEqual(example.reviewed_controls, [], `${label}: worker reviewed_controls must be empty`);
  assert.deepEqual(
    example.finding_counts,
    { total: 0, blocking: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    `${label}: worker finding_counts must be all zero`
  );
  assertNoChildAuthorityFields(prompt, example, label);
}

test("buildLaunchPrompt embeds exactly one worker terminal structured-result block", () => {
  const prompt = buildLaunchPrompt(workerLaunchPromptFixture(SUBJECT));
  assertExactlyOneTerminalBlock(prompt, "buildLaunchPrompt");
  assertWorkerSemantics(prompt, SUBJECT, "buildLaunchPrompt");
});

test("renderLauncherFamilyRoleContract worker embeds exactly one worker terminal structured-result block", () => {
  const prompt = renderLauncherFamilyRoleContract({ role: "worker", subject: SUBJECT });
  assertExactlyOneTerminalBlock(prompt, "renderLauncherFamilyRoleContract worker");
  assertWorkerSemantics(prompt, SUBJECT, "renderLauncherFamilyRoleContract worker");
});

for (const appName of ["codex", "claude"]) {
  for (const mode of [
    TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FENCED,
    TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
  ]) {
    test(`renderLauncherFamilyRoleContract ${appName} worker (${mode}) states one commit-gated completion protocol`, () => {
      const prompt = renderLauncherFamilyRoleContract({
        role: "worker",
        subject: SUBJECT,
        appName,
        terminalStructuredRoleResultMode: mode
      });
      assertWorkerCompletionProtocol(prompt, `renderLauncherFamilyRoleContract ${appName} worker ${mode}`);
    });

    test(`buildLaunchPrompt worker (${appName}/${mode}) states one commit-gated completion protocol`, () => {
      const prompt = buildLaunchPrompt(
        workerLaunchPromptFixture(SUBJECT, { terminalStructuredRoleResultMode: mode })
      );
      assertWorkerCompletionProtocol(prompt, `buildLaunchPrompt worker ${mode}`);
    });
  }
}

test("FREE_PROSE degrades to the fenced worker floor and still carries the commit-gated protocol", () => {

  const section = renderTerminalStructuredRoleResultContract({
    role: "worker",
    subject: SUBJECT,
    mode: TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FREE_PROSE
  });
  assertWorkerCompletionProtocol(section, "shared renderer worker FREE_PROSE");
  assert.equal(
    section,
    renderTerminalStructuredRoleResultContract({
      role: "worker",
      subject: SUBJECT,
      mode: TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FENCED
    }),
    "FREE_PROSE worker must render byte-identically to the fenced floor"
  );
});

test("reviewer and redteam completion semantics are unchanged by the worker protocol", () => {

  for (const role of ["reviewer", "redteam"]) {
    for (const mode of [
      TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FENCED,
      TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
    ]) {
      const prompt = renderLauncherFamilyRoleContract({
        role,
        subject: SUBJECT,
        terminalStructuredRoleResultMode: mode
      });
      for (const line of WORKER_ONLY_LINES) {
        assert.equal(
          prompt.includes(line),
          false,
          `${role} ${mode}: must not carry worker completion-protocol line ${JSON.stringify(line)}`
        );
      }
      assert.ok(
        prompt.includes("When findings-only reviewer or redteam work is complete, call workspace_submit_for_review; it moves only the assigned unit to review."),
        `${role} ${mode}: findings-only completion signaling must be unchanged`
      );
    }
  }

  const managedReviewer = renderLauncherFamilyRoleContract({
    role: "reviewer",
    subject: SUBJECT,
    canonicalRepo: "/canonical/main-repo"
  });
  assert.ok(
    managedReviewer.includes("Complete by returning your findings response for trusted-runtime capture"),
    "managed reviewer completion must be unchanged"
  );
});

for (const role of ["reviewer", "redteam"]) {
  test(`renderLauncherFamilyRoleContract ${role} defaults to text-first advisory findings`, () => {
    const prompt = renderLauncherFamilyRoleContract({ role, subject: SUBJECT });
    const expected = renderTerminalStructuredRoleResultContract({
      role,
      subject: SUBJECT,
      mode: TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FREE_PROSE
    });
    assert.ok(prompt.endsWith(expected));
    assert.match(prompt, /complete response is usable advisory evidence/u);
    assert.doesNotMatch(prompt, /## Terminal structured role result/u);
    assert.doesNotMatch(prompt, /agent-role-result\.v1` JSON is mandatory/u);
  });
}

test("both prompt builders consume the single shared terminal renderer (no byte drift between builders)", () => {

  const expectedWorker = renderTerminalStructuredRoleResultContract({ role: "worker", subject: SUBJECT });

  const launchSection = extractTerminalSection(buildLaunchPrompt(workerLaunchPromptFixture(SUBJECT)));
  const contractSection = extractTerminalSection(
    renderLauncherFamilyRoleContract({ role: "worker", subject: SUBJECT })
  );

  assert.equal(launchSection, expectedWorker, "buildLaunchPrompt worker terminal section must equal the shared renderer output");
  assert.equal(contractSection, expectedWorker, "renderLauncherFamilyRoleContract worker terminal section must equal the shared renderer output");
  assert.equal(launchSection, contractSection, "both builders must emit byte-identical worker terminal sections");

  for (const role of ["reviewer", "redteam"]) {
    const expected = renderTerminalStructuredRoleResultContract({ role, subject: SUBJECT });
    const prompt = renderLauncherFamilyRoleContract({ role, subject: SUBJECT });
    assert.ok(prompt.endsWith(expected),
      `renderLauncherFamilyRoleContract ${role} findings section must equal the shared renderer output`);
  }
});

test("schema-constrained terminal contract uses raw JSON and omits the example candidate", () => {
  for (const role of ["worker", "reviewer", "redteam"]) {
    const section = renderTerminalStructuredRoleResultContract({
      role,
      subject: SUBJECT,
      mode: TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
    });
    assertSchemaConstrainedTerminalContract(section, `shared renderer ${role}`, {
      compactFindings: role !== "worker"
    });
  }

  const launchSection = extractTerminalSection(
    buildLaunchPrompt(
      workerLaunchPromptFixture(SUBJECT, {
        terminalStructuredRoleResultMode: TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
      })
    )
  );
  const contractSection = extractTerminalSection(
    renderLauncherFamilyRoleContract({
      role: "worker",
      subject: SUBJECT,
      terminalStructuredRoleResultMode: TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
    })
  );
  const expectedWorker = renderTerminalStructuredRoleResultContract({
    role: "worker",
    subject: SUBJECT,
    mode: TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
  });

  assert.equal(launchSection, expectedWorker, "buildLaunchPrompt constrained worker terminal section must equal the shared renderer output");
  assert.equal(contractSection, expectedWorker, "renderLauncherFamilyRoleContract constrained worker terminal section must equal the shared renderer output");
  assertSchemaConstrainedTerminalContract(launchSection, "buildLaunchPrompt constrained worker");
  assertSchemaConstrainedTerminalContract(contractSection, "renderLauncherFamilyRoleContract constrained worker");
});

test("schema-constrained findings families share the owned soft-summary guidance", () => {
  const guidance = `The parent-declared soft-summary recommendation is ${DEFAULT_AGENT_ROLE_RESULT_LIMITS.summaryBudgetChars} JavaScript string code units; exceeding it is allowed, and the complete captured result is preserved.`;

  for (const appName of ["codex", "claude"]) {
    for (const role of ["reviewer", "redteam"]) {
      const prompt = renderLauncherFamilyRoleContract({
        appName,
        role,
        subject: SUBJECT,
        terminalStructuredRoleResultMode: TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
      });
      assert.ok(prompt.includes(guidance), `${appName} ${role}: missing owned soft-summary guidance`);
      assert.equal(
        prompt.includes("summaryBudgetChars"),
        false,
        `${appName} ${role}: prompt must render the value, not its implementation identifier`
      );
      assert.equal(
        prompt.includes("Use one terminal fenced block whose info string is exactly `agent-role-result.v1`"),
        false,
        `${appName} ${role}: schema-constrained findings prompt must remain raw JSON`
      );
      assert.doesNotMatch(prompt, /JSON is mandatory for ordinary review/u);
    }
  }

  for (const role of ["worker", "reviewer", "redteam"]) {
    const fenced = renderTerminalStructuredRoleResultContract({
      role,
      subject: SUBJECT,
      mode: TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FENCED
    });
    assert.equal(fenced.includes(guidance), false, `${role}: fenced guidance must remain unchanged`);
  }
});

test("worker floor pins extraction prohibitions while ordinary findings remain prose", () => {

  const worker = renderTerminalStructuredRoleResultContract({ role: "worker", subject: SUBJECT });
  assert.ok(worker.includes(
    "Use one terminal fenced block whose info string is exactly `agent-role-result.v1`; do not emit ordinary ```json blocks, extra JSON candidates, or any trailing content after the closing fence."
  ));
  assert.ok(worker.includes(
    "Do not include child-supplied authority fields such as `terminal_status`, `status`, `role_authority`, `subject_authority`, `source_digest_authority`, `reviewed_at`, `completed_at`, `run_id`, or `source_digest`."
  ));
  for (const role of ["reviewer", "redteam"]) {
    const section = renderTerminalStructuredRoleResultContract({ role, subject: SUBJECT });
    assert.match(section, /## Review findings/u);
    assert.doesNotMatch(section, /terminal fenced block/u);
    assert.doesNotMatch(section, /child-supplied authority fields/u);
  }
});
