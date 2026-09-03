import test from "node:test";
import assert from "node:assert/strict";

import {
  TERMINAL_STRUCTURED_ROLE_RESULT_MODES
} from "../../packages/agent-launch-core/src/lib/work-record-launch-prompt.mjs";
import {
  reviewPrompt,
  redteamPrompt
} from "../../packages/agent-launch-cli/src/lib/codex-role-prompts.mjs";
import {
  defaultBuildClaudeCommandLine
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-claude-launch-support.mjs";
import {
  renderLauncherFamilyOrchestratorPrompt,
  renderLauncherFamilyRoleContract
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-role-contract.mjs";

const SUBJECT = "WK-1577#SLICE-007";

const TASK_SPECIFIC_CONTEXT = `Task-specific context: ${"retain the selected unit's exact review boundary and discriminating validation evidence. ".repeat(8).trimEnd()}`;
const ACCEPTANCE_CRITERIA = Object.freeze([
  "Fully rendered Claude and Codex reviewer/redteam prompts retain the selected unit review contract.",
  "Schema-constrained prompts stay within explicit byte budgets.",
  TASK_SPECIFIC_CONTEXT
]);
const ACCEPTANCE_VALIDATION = Object.freeze([
  "node --test tests/unit/launcher-findings-prompt-budget.test.mjs"
]);

const PROMPT_BYTE_BUDGETS = Object.freeze({
  reviewer: 1200,
  redteam: 4096
});

function bytes(value) {
  return Buffer.byteLength(value, "utf8");
}

function assertTaskSpecificContract(prompt, role, { schemaConstrained }) {
  assert.ok(prompt.includes(SUBJECT), `${role}: exact subject must be retained`);
  for (const body of [...ACCEPTANCE_CRITERIA, ...ACCEPTANCE_VALIDATION]) {
    assert.ok(!prompt.includes(body), `${role}: mutable inline contract body must be omitted`);
  }
  assert.match(prompt, /Snapshot acceptance: workspace_read_page/u);
  assert.match(prompt, /"path":"wiki\/work-records\/WK-1577\.json","selected_slice":"SLICE-007"/u);
  assert.doesNotMatch(prompt, /"selected_slice":"WK-1577#SLICE-007"/u);
  assert.match(prompt, /Assigned unit: WK-1577#SLICE-007/u);
  assert.match(prompt, /selected_slice is only the bare slice id/u);
  assert.match(prompt, /Use its criteria and validation/u);
  assert.doesNotMatch(prompt, /workspace_frozen_review_contract_query|read its index|paging|cursor|omitted=0/u);
  assert.match(prompt, /Report findings by severity with file\/line references/u);
  if (schemaConstrained) {
    assert.match(prompt, /Return exactly one raw JSON object matching the launcher-supplied schema/u);
    assert.ok(
      prompt.includes(`Set \`reported_subject\` to exactly \`${SUBJECT}\`.`),
      `${role}: terminal result must retain the exact subject binding`
    );
  } else {
    assert.match(prompt, /## Review findings/u);
    assert.doesNotMatch(prompt, /Terminal structured role result|agent-role-result\.v1/u);
  }

  for (const duplicatedPolicyFragment of [
    "Read AGENTS.md",
    "Broad read-only source inspection",
    "Public seam steering",
    "Render the subject unit's canonical acceptance criteria",
    "Backend-minted run status remains the authority",
    "Reviewer and redteam payloads must include"
  ]) {
    assert.ok(
      !prompt.includes(duplicatedPolicyFragment),
      `${role}: prompt must omit duplicated policy fragment ${JSON.stringify(duplicatedPolicyFragment)}`
    );
  }
}

function renderCodex(role, { schemaConstrained = true } = {}) {
  const common = {
    acceptanceCriteria: ACCEPTANCE_CRITERIA,
    acceptanceValidation: ACCEPTANCE_VALIDATION,
    canonicalRepo: role === "reviewer" ? "/srv/canonical/main-repo" : null,
    terminalStructuredRoleResultMode: schemaConstrained
      ? TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
      : TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FREE_PROSE
  };
  return role === "reviewer"
    ? reviewPrompt(SUBJECT, { ...common, canonicalRepo: "/srv/canonical/main-repo" })
    : redteamPrompt(SUBJECT, common);
}

test("managed reviewer prompt bytes are invariant to frozen contract length for both families", () => {
  const longCriteria = Array.from({ length: 100 }, (_, index) =>
    `criterion-${index}-${"x".repeat(4000)}`);
  const longValidation = Array.from({ length: 100 }, (_, index) =>
    `validation-${index}-${"y".repeat(4000)}`);
  for (const schemaConstrained of [true, false]) {
    const mode = schemaConstrained
      ? TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
      : TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FREE_PROSE;
    const codexShort = renderCodex("reviewer", { schemaConstrained });
    const codexLong = reviewPrompt(SUBJECT, {
      acceptanceCriteria: longCriteria,
      acceptanceValidation: longValidation,
      terminalStructuredRoleResultMode: mode,
      canonicalRepo: "/srv/canonical/main-repo"
    });
    assert.equal(codexLong, codexShort);

    const claudeShort = renderClaude("reviewer", { schemaConstrained });
    const claudeLong = defaultBuildClaudeCommandLine({
      claudePath: "claude",
      role: "reviewer",
      subject: SUBJECT,
      workspaceDir: "/srv/review/WK-1577",
      acceptanceCriteria: longCriteria,
      acceptanceValidation: longValidation,
      canonicalRepo: "/srv/canonical/main-repo",
      schemaConstrainedTerminalResult: schemaConstrained
    }).prompt;
    assert.equal(claudeLong, claudeShort);
  }
});

function renderClaude(role, { schemaConstrained = true } = {}) {
  const commandLine = defaultBuildClaudeCommandLine({
    claudePath: "claude",
    role,
    subject: SUBJECT,
    workspaceDir: "/srv/review/WK-1577",
    acceptanceCriteria: ACCEPTANCE_CRITERIA,
    acceptanceValidation: ACCEPTANCE_VALIDATION,
    canonicalRepo: role === "reviewer" ? "/srv/canonical/main-repo" : null,
    schemaConstrainedTerminalResult: schemaConstrained
  });
  assert.equal(
    commandLine.args.includes("--json-schema"),
    schemaConstrained,
    `${role}: Claude schema flag must match the launcher-selected terminal mode`
  );
  return commandLine.prompt;
}

for (const family of ["codex", "claude"]) {
  for (const role of ["reviewer", "redteam"]) {
    for (const schemaConstrained of [true, false]) {
      const mode = schemaConstrained ? "schema-constrained" : "free-prose";
      test(`${family} ${role} fully rendered ${mode} prompt stays within its byte budget`, () => {
        const prompt = family === "codex"
          ? renderCodex(role, { schemaConstrained })
          : renderClaude(role, { schemaConstrained });
        assertTaskSpecificContract(prompt, role, { schemaConstrained });
        assert.ok(
          bytes(prompt) <= PROMPT_BYTE_BUDGETS[role],
          `${family} ${role}: ${bytes(prompt)} bytes exceeds ${PROMPT_BYTE_BUDGETS[role]}-byte budget`
        );
      });
    }
  }
}

test("redteam keeps only concise adversarial and scope-exclusion guidance", () => {
  for (const prompt of [renderCodex("redteam"), renderClaude("redteam")]) {
    assert.match(prompt, /adversarial, non-authoritative input/u);
    assert.match(prompt, /Do not expand the selected unit's scope/u);
    assert.doesNotMatch(prompt, /use structured wiki search/u);
    assert.doesNotMatch(prompt, /interactive session|headless session/u);
  }
});

test("launcher role and orchestrator prompts rely on automatic AGENTS.md injection", () => {
  const prompts = [
    renderLauncherFamilyRoleContract({
      appName: "Codex",
      role: "worker",
      subject: SUBJECT
    }),
    renderLauncherFamilyRoleContract({
      appName: "Claude",
      role: "worker",
      subject: SUBJECT
    }),
    renderLauncherFamilyOrchestratorPrompt({
      appName: "Codex",
      initiative: "IN-0016",
      threadName: "IN-0016 orchestrator"
    }),
    renderLauncherFamilyOrchestratorPrompt({
      appName: "Claude",
      initiative: "IN-0016",
      threadName: "IN-0016 orchestrator"
    })
  ];
  for (const prompt of prompts) {
    assert.ok(!prompt.includes("AGENTS.md"));
  }
});
