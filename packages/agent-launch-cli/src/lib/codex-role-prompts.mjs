

import {
  renderLauncherFamilyOrchestratorPrompt,
  renderLauncherFamilyRoleContract,
  reviewPromptSubjectPath
} from "./workspace-agent-role-contract.mjs";

function renderCodexFindingsOnlyRoleContract({
  role,
  subject,
  notes,
  acceptanceCriteria = [],
  acceptanceValidation = [],
  terminalStructuredRoleResultMode = undefined,

  canonicalRepo = undefined
}) {
  return renderLauncherFamilyRoleContract({
    appName: "Codex",
    role,
    subject,
    acceptanceCriteria,
    acceptanceValidation,
    notes,

    terminalStructuredRoleResultMode,

    canonicalRepo
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

export function orchestratorPrompt({ initiative, threadName, focus, headless = false }) {

  return renderLauncherFamilyOrchestratorPrompt({
    appName: "Codex",
    renameHintLabel: "Codex",
    initiative,
    threadName,
    focus,
    headless: headless === true
  });
}

export function reviewPrompt(subject, { acceptanceCriteria = [], acceptanceValidation = [], terminalStructuredRoleResultMode = undefined, canonicalRepo = undefined } = {}) {
  return renderCodexFindingsOnlyRoleContract({
    role: "reviewer",
    subject,
    acceptanceCriteria,
    acceptanceValidation,
    terminalStructuredRoleResultMode,

    canonicalRepo
  });
}

export function redteamPrompt(subject, { acceptanceCriteria = [], acceptanceValidation = [], terminalStructuredRoleResultMode = undefined } = {}) {
  return renderCodexFindingsOnlyRoleContract({
    role: "redteam",
    subject,
    acceptanceCriteria,
    acceptanceValidation,
    terminalStructuredRoleResultMode
  });
}
