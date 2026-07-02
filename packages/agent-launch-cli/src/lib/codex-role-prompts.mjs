

import {
  renderLauncherFamilyOrchestratorPrompt,
  renderLauncherFamilyRoleContract,
  reviewPromptSubjectPath
} from "./workspace-agent-role-contract.mjs";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function subjectTextForNotes(subject) {
  if (typeof subject === "string") {
    return subject;
  }
  if (isPlainObject(subject)) {
    for (const key of ["subject", "subjectPath", "unit", "path", "id", "title"]) {
      const value = subject[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return String(subject);
}

function renderCodexFindingsOnlyRoleContract({
  role,
  subject,
  notes,
  acceptanceCriteria = [],
  acceptanceValidation = [],
  terminalStructuredRoleResultMode = undefined
}) {
  return renderLauncherFamilyRoleContract({
    appName: "Codex",
    role,
    subject,
    acceptanceCriteria,
    acceptanceValidation,
    notes,

    terminalStructuredRoleResultMode
  });
}

export {
  reviewPromptSubjectPath,
  LAUNCHER_FAMILY_ROLE_CONTRACT_ROLES,
  LauncherRoleContractError,
  renderLauncherFamilyRoleContract,
  LAUNCHER_FAMILY_ROLE_CONTRACT_SHAPES,
  LAUNCHER_ROLE_CONTRACT_FINDINGS_ONLY_MARKER,
  LAUNCHER_ROLE_CONTRACT_IMPLEMENTATION_MARKER,
  classifyLauncherRoleContractShape
} from "./workspace-agent-role-contract.mjs";

export function orchestratorPrompt({ initiative, threadName, focus }) {
  return renderLauncherFamilyOrchestratorPrompt({
    appName: "Codex",
    renameHintLabel: "Codex",
    initiative,
    threadName,
    focus
  });
}

export function reviewPrompt(subject, { acceptanceCriteria = [], acceptanceValidation = [], terminalStructuredRoleResultMode = undefined } = {}) {
  const subjectText = subjectTextForNotes(subject);
  return renderCodexFindingsOnlyRoleContract({
    role: "reviewer",
    subject,
    acceptanceCriteria,
    acceptanceValidation,
    terminalStructuredRoleResultMode,
    notes: [
      `Suggested Codex rename command: /rename ${subjectText} reviewer`,
      "Review the WK implementation and result against the WK Summary, Scope, Acceptance Criteria, write_scope, validation expectations, and any contract language such as full corpus, all records, no cap, no fallback, or complete coverage.",
      "Report findings ordered by severity with file/line references where applicable. If there are no findings, say that clearly and mention any residual test or contract risk."
    ]
  });
}

export function redteamPrompt(subject, { acceptanceCriteria = [], acceptanceValidation = [], terminalStructuredRoleResultMode = undefined } = {}) {
  const subjectText = subjectTextForNotes(subject);
  return renderCodexFindingsOnlyRoleContract({
    role: "redteam",
    subject,
    acceptanceCriteria,
    acceptanceValidation,
    terminalStructuredRoleResultMode,
    notes: [
      `Suggested Codex rename command: /rename ${subjectText} redteam`,
      "Adversarially evaluate the assigned WK or IN plan, implementation state, and results for missed contract requirements, hidden assumptions, unsafe scope expansion, insufficient validation, fallback behavior, partial-corpus shortcuts, and risks that ordinary review might miss.",
      "Report findings ordered by severity with file/line references where applicable. If there are no findings, say that clearly and mention any residual test or contract risk."
    ]
  });
}
