import {
  TERMINAL_STRUCTURED_ROLE_RESULT_MODES,
  renderTerminalStructuredRoleResultContract
} from '@agent-chassis/agent-launch-core/src/lib/work-record-launch-prompt.mjs';
import {
  projectWorkRecordTestProofValidation,
  renderWorkRecordValidationEntry,
} from '@agent-chassis/wiki-core/src/lib/work-record-test-proof-bindings.mjs';
import { buildSelectedRecordMemberCall } from
  '@agent-chassis/wiki-core/src/lib/work-record-selected-unit-projection.mjs';
import { renderAgentRoleGuideReadReference } from
  '@agent-chassis/agent-launch-core/src/lib/agent-role-guides.mjs';

export { TERMINAL_STRUCTURED_ROLE_RESULT_MODES };

const DEFAULT_REVIEW_PROMPT_SUBJECT_PATH = 'wiki/work-records/WK-0000.json';

export const LAUNCHER_FAMILY_ROLE_CONTRACT_ROLES = Object.freeze([
  'worker',
  'reviewer',
  'redteam',
]);

export const LAUNCHER_AGENT_SESSION_ROLE_POPULATIONS = Object.freeze({
  orchestrator: Object.freeze({
    lifecycle_position: 'coordination',
    review_purpose: null,
    completion_transport: 'coordinator_control',
  }),
  worker: Object.freeze({
    lifecycle_position: 'implementation',
    review_purpose: null,
    completion_transport: 'managed_slice_delivery',
  }),
  reviewer: Object.freeze({
    lifecycle_position: 'findings_only',
    review_purpose: Object.freeze(['standalone', 'terminal_whole_wk']),
    completion_transport: Object.freeze(['standalone_findings', 'workspace_submit_for_review']),
  }),
  redteam: Object.freeze({
    lifecycle_position: 'findings_only',
    review_purpose: Object.freeze(['standalone', 'terminal_whole_wk']),
    completion_transport: Object.freeze(['standalone_findings', 'workspace_submit_for_review']),
  }),
});

export const LAUNCHER_ORCHESTRATOR_PROMPT_MODES = Object.freeze({
  INTERACTIVE: 'interactive',
  HEADLESS: 'headless',
});

export const LAUNCHER_ORCHESTRATOR_HEADLESS_DIRECTIVE = [
  'Run UNATTENDED to completion, then EXIT.',
  'Complete your assigned work without pausing for human interaction.',
  'Follow canonical repository guidance, your assigned initiative or WK, and authoritative structured tool results.',
  'Report the outcome and exit.',
  'There is no interactive terminal and no human to prompt or resume: do not wait for input, do not ask for confirmation, and do not leave the session open after you have reported.',
].join(' ');

export const LAUNCHER_FAMILY_ROLE_CONTRACT_SHAPES = Object.freeze({
  worker: 'implementation',
  reviewer: 'findings_only',
  redteam: 'findings_only',
});

export const LAUNCHER_FINDINGS_COMPLETION_TRANSPORTS = Object.freeze({
  MANAGED_TERMINAL_RESULT: 'managed_terminal_result',
  WORKSPACE_SUBMIT_FOR_REVIEW: 'workspace_submit_for_review',
  NOT_APPLICABLE: 'not_applicable',
});

function toStringValue(value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toStringValue(entry)).filter(Boolean).join(' ');
  }
  if (typeof value === 'object') {
    for (const key of [
      'text',
      'body',
      'prompt',
      'message',
      'subject',
      'subjectPath',
      'unit',
      'path',
      'id',
      'shape',
      'role',
      'mode',
      'appName',
      'renameHintLabel',
      'threadName',
      'initiative',
      'workspaceDir',
    ]) {
      if (key in value) {
        const nested = toStringValue(value[key]);
        if (nested) {
          return nested;
        }
      }
    }
  }
  return String(value);
}

function normalizeAppName(appName) {
  const value = toStringValue(appName).trim();
  if (!value) {
    return 'Launcher';
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeSubjectPath(subject) {
  const raw = toStringValue(subject).trim();
  if (!raw) {
    return DEFAULT_REVIEW_PROMPT_SUBJECT_PATH;
  }

  if (/^(?:\/|[A-Za-z]:[\\/])/.test(raw)) {
    return raw;
  }

  const wkMatch = raw.match(/^(WK-\d{4})(?:#.*)?$/);
  if (wkMatch) {
    return `wiki/work-records/${wkMatch[1]}.json`;
  }

  const issueMatch = raw.match(/^wiki\/issues\/(WK-\d{4})\.md$/);
  if (issueMatch) {
    return `wiki/work-records/${issueMatch[1]}.json`;
  }

  const inMatch = raw.match(/^(IN-\d{4})(?:#.*)?$/);
  if (inMatch) {
    return `wiki/initiatives/${inMatch[1]}.md`;
  }

  const decMatch = raw.match(/^(DEC-\d{4})(?:#.*)?$/);
  if (decMatch) {
    return `wiki/decisions/${decMatch[1]}.md`;
  }

  return raw;
}

function renderFindingsSnapshotAcceptanceInstruction(subject) {
  const assignedUnit = toStringValue(subject).trim();
  const subjectPath = normalizeSubjectPath(subject);
  const sliceMatch = assignedUnit.match(/^(WK-\d{4})#(SLICE-\d{3})$/u);
  const selectionInstruction = sliceMatch
    ? `Assigned unit: ${assignedUnit}; selected_slice is only the bare slice id. `
    : `Assigned unit: ${assignedUnit}; use its record-level result. `;
  if (!/^wiki\/work-records\/WK-\d{4}\.json$/u.test(subjectPath)) {
    return `Snapshot acceptance: workspace_read_page arguments ${JSON.stringify({ path: subjectPath })}. ` +
      selectionInstruction +
      `Use its criteria and validation. ` +
      'No live-main reads or inline mutable-record bytes.';
  }

  const acceptanceCall = (selectedSlice) => JSON.stringify(buildSelectedRecordMemberCall({
    tool: "workspace_read_page",
    identity: { path: subjectPath },
    selectedSlice,
    member: { path: ["acceptance"] }
  }).arguments);
  const calls = sliceMatch
    ? `${acceptanceCall(sliceMatch[2])} and parent ${acceptanceCall(null)}`
    : acceptanceCall(null);
  return `Snapshot acceptance: workspace_read_page arguments ${calls}. ` +
    selectionInstruction +
    `Follow returned member calls for criteria and validation. ` +
    'No live-main reads or inline mutable-record bytes.';
}

function formatBulletList(label, values) {
  const items = Array.isArray(values)
    ? values.map((value) => toStringValue(value).trim()).filter(Boolean)
    : [];
  if (!items.length) {
    return '';
  }
  return `${label}:\n${items.map((item) => `- ${item}`).join('\n')}`;
}

function normalizeAcceptanceContractValues(values) {
  const items = Array.isArray(values) ? values : values == null ? [] : [values];
  return items.map((value) => toStringValue(value).trim()).filter(Boolean);
}

function resolveSubjectAcceptanceContract(input) {
  const acceptance =
    input && typeof input.acceptance === 'object' && !Array.isArray(input.acceptance)
      ? input.acceptance
      : {};

  const authoredValidation =
    input.acceptanceValidation ??
    input.acceptance_validation ??
    acceptance.validation ??
    input.validation ??
    [];
  const validationProjection = projectWorkRecordTestProofValidation({
    selectedUnit: {
      acceptance: {
        validation: Array.isArray(authoredValidation) ? authoredValidation : [authoredValidation],
      },
    },
  });
  if (validationProjection.status !== 'valid') {
    throw new LauncherRoleContractError('launcher role contract acceptance validation is invalid', {
      code: 'acceptance_validation_invalid',
      detail: { diagnostics: validationProjection.diagnostics },
    });
  }
  return {
    criteria: normalizeAcceptanceContractValues(
      input.acceptanceCriteria ??
        input.acceptance_criteria ??
        acceptance.criteria ??
        input.criteria
    ),
    validation: validationProjection.validation_entries.map(renderWorkRecordValidationEntry),
  };
}

function renderAcceptanceContractSections(input) {
  const { criteria, validation } = resolveSubjectAcceptanceContract(input);
  const hasAcceptanceContract = criteria.length > 0 || validation.length > 0;
  const blocks = [];

  const criteriaBlock = formatBulletList('Acceptance criteria', criteria);
  if (criteriaBlock) {
    blocks.push(criteriaBlock);
  }

  const validationBlock = formatBulletList(
    hasAcceptanceContract ? 'Acceptance validation' : 'Validation',
    validation
  );
  if (validationBlock) {
    blocks.push(validationBlock);
  }

  return blocks;
}

function normalizeLauncherRoleContractInput(firstArg, secondArg, thirdArg = {}) {
  if (firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
    return { ...firstArg };
  }
  if (typeof firstArg === 'string') {
    return {
      ...thirdArg,
      appName: firstArg,
      renameHintLabel:
        typeof secondArg === 'string' ? secondArg : thirdArg.renameHintLabel,
    };
  }
  return { ...thirdArg };
}

function validateRoleContractRole(role) {
  const normalized = toStringValue(role).trim().toLowerCase();
  if (!normalized) {
    throw new LauncherRoleContractError('launcher role contract requires a role', {
      code: 'role_required',
      detail: { role: role ?? null, allowed: [...LAUNCHER_FAMILY_ROLE_CONTRACT_ROLES] },
    });
  }
  if (!LAUNCHER_FAMILY_ROLE_CONTRACT_ROLES.includes(normalized)) {
    throw new LauncherRoleContractError(
      `launcher role contract does not support role: ${normalized}`,
      {
        code: 'role_unsupported',
        detail: { role: role ?? null, allowed: [...LAUNCHER_FAMILY_ROLE_CONTRACT_ROLES] },
      }
    );
  }
  return normalized;
}

export class LauncherRoleContractError extends Error {
  constructor(message, { code, detail } = {}) {
    super(message);
    this.name = 'LauncherRoleContractError';
    if (code !== undefined) {
      this.code = code;
    }
    if (detail !== undefined) {
      this.detail = detail;
    }
  }
}

export function reviewPromptSubjectPath(subject) {
  return normalizeSubjectPath(subject);
}

reviewPromptSubjectPath.toString = () => DEFAULT_REVIEW_PROMPT_SUBJECT_PATH;
reviewPromptSubjectPath.valueOf = () => DEFAULT_REVIEW_PROMPT_SUBJECT_PATH;
reviewPromptSubjectPath[Symbol.toPrimitive] = (hint) => {
  if (hint === 'number') {
    return Number.NaN;
  }
  return DEFAULT_REVIEW_PROMPT_SUBJECT_PATH;
};

export function classifyLauncherFindingsCompletionTransport({
  role,
  canonicalRepo,
} = {}) {
  const normalizedRole = toStringValue(role).trim().toLowerCase();
  if (normalizedRole === 'reviewer' && toStringValue(canonicalRepo).trim()) {
    return LAUNCHER_FINDINGS_COMPLETION_TRANSPORTS.MANAGED_TERMINAL_RESULT;
  }
  if (normalizedRole === 'reviewer' || normalizedRole === 'redteam') {
    return LAUNCHER_FINDINGS_COMPLETION_TRANSPORTS.WORKSPACE_SUBMIT_FOR_REVIEW;
  }
  return LAUNCHER_FINDINGS_COMPLETION_TRANSPORTS.NOT_APPLICABLE;
}

export function renderLauncherFamilyRoleContract(options = {}) {
  const input = normalizeLauncherRoleContractInput(options);
  const role = validateRoleContractRole(input.role);
  const subject = toStringValue(input.subject ?? input.subjectPath ?? input.unit ?? input.path).trim();
  if (!subject) {
    throw new LauncherRoleContractError('launcher role contract requires a subject', {
      code: 'subject_required',
      detail: {
        role,
        subject: input.subject ?? null,
      },
    });
  }

  const appName = normalizeAppName(input.appName);
  const workspaceDir = toStringValue(input.workspaceDir).trim();

  const canonicalRepo = toStringValue(input.canonicalRepo).trim();
  const completionTransport = classifyLauncherFindingsCompletionTransport({
    role,
    canonicalRepo,
  });
  const isManagedReviewer =
    completionTransport === LAUNCHER_FINDINGS_COMPLETION_TRANSPORTS.MANAGED_TERMINAL_RESULT;

  const lines = [
    `# ${appName} ${role} role contract`,
    role === 'worker'
      ? `Role: implementation worker for ${subject}.`
      : `Subject: ${subject}.`,
    renderAgentRoleGuideReadReference(role === 'worker' ? 'managed-worker' : 'reviewer'),
  ];

  if (role === 'worker' && workspaceDir) {
    lines.push(`Workspace directory: ${workspaceDir}.`);
  }

  const docsBlock = role === 'worker' ? formatBulletList('Read first', input.docs) : '';
  if (docsBlock) {
    lines.push(docsBlock);
  }

  const writeScopeBlock = role === 'worker'
    ? formatBulletList('Write scope', input.writeScope ?? input.write_scope)
    : '';
  if (writeScopeBlock) {
    lines.push(writeScopeBlock);
  }

  const acceptanceBlocks = role === 'worker'
    ? renderAcceptanceContractSections(input)
    : [];
  if (acceptanceBlocks.length) {
    lines.push(...acceptanceBlocks);
  }

  if (role !== 'worker') {
    lines.push(renderFindingsSnapshotAcceptanceInstruction(subject));
  }

  if (isManagedReviewer) {
    lines.push('Do not call workspace_submit_for_review.');
    lines.push('Complete by returning your findings response for trusted-runtime capture.');
  } else if (role !== 'worker') {
    lines.push('When findings-only reviewer or redteam work is complete, call workspace_submit_for_review; it moves only the assigned unit to review.');
  }

  const notesBlock = formatBulletList('Notes', input.notes);
  if (notesBlock) {
    lines.push(notesBlock);
  }

  const selectedTerminalResultMode = input.terminalStructuredRoleResultMode
    ?? input.structuredRoleResultMode;
  const terminalResultMode = role === 'worker'
    ? selectedTerminalResultMode ?? TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FENCED
    : selectedTerminalResultMode === TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
      ? TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
      : TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FREE_PROSE;
  lines.push(renderTerminalStructuredRoleResultContract({
    role,
    subject,

    mode: terminalResultMode,
  }));

  return lines.filter(Boolean).join('\n\n');
}

export function renderImplementationWorkerPrompt(options = {}) {
  return renderLauncherFamilyRoleContract(options);
}

export function renderRoleContract(options = {}) {
  return renderLauncherFamilyRoleContract(options);
}

export function renderWorkerPrompt(options = {}) {
  return renderLauncherFamilyRoleContract(options);
}

function isHeadlessOrchestratorPromptMode(input) {
  if (!input || typeof input !== 'object') {
    return false;
  }
  if (input.headless === true) {
    return true;
  }
  const mode = toStringValue(
    input.orchestratorPromptMode ?? input.promptMode ?? input.mode
  )
    .trim()
    .toLowerCase();
  return mode === LAUNCHER_ORCHESTRATOR_PROMPT_MODES.HEADLESS;
}

function renderOrchestratorContext({
  appName,
  subject,
  subjectPath,
  repo,
  workspaceDir,
}) {
  const context = [
    `role=${appName} orchestrator`,
    `subject=${subject || subjectPath}`,
  ];
  if (repo) {
    context.push(`repo=${repo}`);
  }
  if (workspaceDir) {
    context.push(`workspace=${workspaceDir}`);
  }

  return [
    `Context: ${context.join('; ')}.`,
    renderAgentRoleGuideReadReference('orchestrator'),
  ].join('\n');
}

export function renderLauncherFamilyOrchestratorPrompt(options = {}) {
  const input = normalizeLauncherRoleContractInput(options);
  const appName = normalizeAppName(input.appName);
  const headless = isHeadlessOrchestratorPromptMode(input);
  const resolvedRenameHintLabel = toStringValue(
    input.renameHintLabel ?? input.renameLabel ?? appName
  ).trim() || appName;
  const normalizedThreadName = toStringValue(
    input.threadName ?? input.subject ?? input.initiative ?? input.unit ?? input.path
  ).trim();
  const repo = toStringValue(input.repo ?? input.repository ?? input.repoName).trim();
  const subjectPath = reviewPromptSubjectPath(
    input.subjectPath ?? input.initiative ?? input.subject ?? input.threadName
  );
  const workspaceDir = toStringValue(input.workspaceDir).trim();
  const focus = toStringValue(input.focus);

  const lines = [
    `# ${appName} orchestrator prompt`,
    `You are the ${appName} orchestrator for ${normalizedThreadName || subjectPath}.`,
  ];
  if (!headless) {
    lines.push(
      `Suggested ${resolvedRenameHintLabel} rename command: /rename ${normalizedThreadName}`
    );
  }
  if (workspaceDir) {
    lines.splice(lines.length, 0, `Workspace directory: ${workspaceDir}.`);
  }

  lines.push(renderOrchestratorContext({
    appName,
    subject: normalizedThreadName,
    subjectPath,
    repo,
    workspaceDir,
  }));

  if (headless) {
    lines.push(LAUNCHER_ORCHESTRATOR_HEADLESS_DIRECTIVE);
  }

  if (focus.trim()) {
    lines.push(focus);
  }

  return lines.filter(Boolean).join('\n\n');
}

const launcherRoleContractExports = Object.freeze({
  LAUNCHER_FAMILY_ROLE_CONTRACT_ROLES,
  LAUNCHER_FAMILY_ROLE_CONTRACT_SHAPES,
  LAUNCHER_FINDINGS_COMPLETION_TRANSPORTS,
  LAUNCHER_ORCHESTRATOR_PROMPT_MODES,
  LAUNCHER_ORCHESTRATOR_HEADLESS_DIRECTIVE,
  TERMINAL_STRUCTURED_ROLE_RESULT_MODES,
  LauncherRoleContractError,
  classifyLauncherFindingsCompletionTransport,
  renderImplementationWorkerPrompt,
  renderLauncherFamilyOrchestratorPrompt,
  renderLauncherFamilyRoleContract,
  renderRoleContract,
  renderWorkerPrompt,
  reviewPromptSubjectPath,
});

export default launcherRoleContractExports;
