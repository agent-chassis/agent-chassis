import {
  TERMINAL_STRUCTURED_ROLE_RESULT_MODES,
  renderTerminalStructuredRoleResultContract
} from '@agent-chassis/agent-launch-core/src/lib/work-record-launch-prompt.mjs';

export { TERMINAL_STRUCTURED_ROLE_RESULT_MODES };

const DEFAULT_REVIEW_PROMPT_SUBJECT_PATH = 'wiki/work-records/WK-0000.json';

export const LAUNCHER_ROLE_CONTRACT_FINDINGS_ONLY_MARKER =
  'Findings only. Do not modify files.';
export const LAUNCHER_ROLE_CONTRACT_IMPLEMENTATION_MARKER =
  'Implementation workers may use the launcher-provided actual native command tool inside bwrap without interactive approval.';

export const LAUNCHER_ROLE_CONTRACT_PUBLIC_SEAM_MARKER =
  'Public seam steering: when admission-related behavior needs a test seam, drive and assert it through the launcher-registered public backend and tool surfaces; do not target private or unexported admission-recovery helper internals.';

export const LAUNCHER_REDTEAM_ADVERSARIAL_GUIDANCE_LINES = Object.freeze([
  'Your findings are an adversarial perspective and are not authoritative: state in your response that they are adversarial input, may be wrong, are non-authoritative, and must be evaluated independently by the orchestrator before any action.',
  "Explicitly identify every change you propose to the selected unit's scope. The orchestrator must raise each proposed scope change to the operator in an interactive session and must reject proposed scope changes in a headless session.",
  'Read every DEC referenced by the selected work, and use structured wiki search over the canonical wiki decisions to find any other directly relevant DEC; for each, check its status, scope, expiration, supersession, and applicability to the selected unit before relying on it.',
  "Finding or citing a DEC does not by itself widen the selected unit's scope or grant additional authority to you or the orchestrator.",
]);

export const LAUNCHER_FAMILY_ROLE_CONTRACT_ROLES = Object.freeze([
  'worker',
  'reviewer',
  'redteam',
]);

export const LAUNCHER_ORCHESTRATOR_PROMPT_MODES = Object.freeze({
  INTERACTIVE: 'interactive',
  HEADLESS: 'headless',
});

export const LAUNCHER_ORCHESTRATOR_HEADLESS_DIRECTIVE = [
  'Run UNATTENDED to completion, then EXIT.',
  'Complete the full orchestration lifecycle end-to-end — design, dispatch, wait for the dispatched roles, review, and report — without pausing for human input at any step.',
  'There is no interactive terminal and no human to prompt or resume: do not wait for input, do not ask for confirmation, and do not leave the session open after you have reported.',
].join(' ');

export const LAUNCHER_FAMILY_ROLE_CONTRACT_SHAPES = Object.freeze({
  worker: 'implementation',
  reviewer: 'findings_only',
  redteam: 'findings_only',
});

const FINDINGS_ONLY_TOOL_SURFACE_GUIDANCE = [
  'Broad read-only source inspection is allowed.',
  'Use the launcher-provided actual native command tool for repository inspection and declared validation without interactive approval.',
  'The reviewed checkout and Git metadata remain read-only; validation scratch, cache, and output belong only in launcher-provided temporary locations.',
  'You have no write grant, so do not modify files or attempt native Edit/Write tools.',
  'stock Edit/Write tools are not part of the launch contract.',
].join(' ');

const IMPLEMENTATION_TOOL_SURFACE_GUIDANCE = [
  'Your repo read/write access is exactly the launcher-provided session contract, not inferred from filesystem layout or bwrap internals.',
  'Use the launcher-provided actual native command tool for inspection, generation, formatting, and in-scope mutation without interactive approval.',
  'Shell commands may read only assigned R union W and may mutate only assigned W; bwrap mount authority enforces that boundary without command parsing, classification, or an allowlist.',
  'Any launcher-provided patch tool remains one editing option, not the required editing path and not a replacement for the native command tool.',
  'No structured validation or general MCP surface is granted to an implementation worker.',
  'The only delivery capability is the closed-input commit tool; it accepts no worker-supplied path, ref, message, or binding.',
  'Do not native-edit wiki/work-records/*.json unless that file is explicitly in write_scope.',
  'The declared acceptance validation is reviewer-owned. Run any useful checks already available inside the frozen namespace, but do not treat absent undeclared test infrastructure or inability to run the complete repository suite as a blocker.',
  'Test availability and success are not closed-input commit prerequisites; complete the assigned implementation and invoke commit when the scoped change is ready.',
  'This launcher-granted command access takes precedence over the AGENTS.md "structured tools first / shell denied" default for this confined implementation session.',
  'If assigned source access or the closed-input commit capability is unavailable, stop and report a blocker; do not try environment overrides or alternate delivery paths.',
].join(' ');

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

function resolveRoleShape(role) {
  const normalizedRole = toStringValue(role).trim().toLowerCase();
  if (normalizedRole === 'reviewer' || normalizedRole === 'redteam') {
    return LAUNCHER_FAMILY_ROLE_CONTRACT_SHAPES.reviewer;
  }
  if (normalizedRole === 'worker') {
    return LAUNCHER_FAMILY_ROLE_CONTRACT_SHAPES.worker;
  }
  return '';
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

  return {
    criteria: normalizeAcceptanceContractValues(
      input.acceptanceCriteria ??
        input.acceptance_criteria ??
        acceptance.criteria ??
        input.criteria
    ),
    validation: normalizeAcceptanceContractValues(
      input.acceptanceValidation ??
        input.acceptance_validation ??
        acceptance.validation ??
        input.validation
    ),
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

function classifyFromText(text) {
  const content = toStringValue(text);
  const normalized = content.trim().toLowerCase();
  if (!normalized) {
    return 'ambiguous';
  }

  const hasFindingsMarker =
    content.includes(LAUNCHER_ROLE_CONTRACT_FINDINGS_ONLY_MARKER) ||
    normalized.includes('findings only. do not modify files.') ||
    normalized.includes('broad read-only source inspection') ||
    normalized.includes('non-mutating read-only commands and focused validation') ||
    normalized.includes('you have no write grant, so do not modify files or attempt native edit/write tools.') ||
    normalized.includes('stock edit/write tools are not part of the launch contract') ||
    normalized.includes('do not update the work record');

  const hasImplementationMarker =
    content.includes(LAUNCHER_ROLE_CONTRACT_IMPLEMENTATION_MARKER) ||
    normalized.includes('implementation workers may use launcher-granted native edit/write only for files explicitly listed in assigned write_scope') ||
    normalized.includes('native edit/write only for files explicitly listed in assigned write_scope') ||
    normalized.includes('implementation worker for ') ||
    normalized.includes('repo read/write access is exactly the launcher-provided session contract') ||
    normalized.includes('native edit/write only to explicitly assigned write_scope paths') ||
    normalized.includes('modify only files inside the assigned write_scope') ||
    normalized.includes('structured mcp/work-record tools') ||
    normalized.includes('native edit/write tools only when the launcher grants write authority for your assigned write_scope and bwrap') ||
    normalized.includes('stock edit/write tools are only allowed within granted write authority') ||
    normalized.includes('stop and report a blocker') ||
    normalized.includes('needed access or structured tools are unavailable');

  if (hasFindingsMarker && hasImplementationMarker) {
    return 'ambiguous';
  }
  if (hasFindingsMarker) {
    return LAUNCHER_FAMILY_ROLE_CONTRACT_SHAPES.reviewer;
  }
  if (hasImplementationMarker) {
    return LAUNCHER_FAMILY_ROLE_CONTRACT_SHAPES.worker;
  }
  return 'ambiguous';
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

export function launcherRoleToolSurfaceGuidance(input = {}) {
  const { role, shape, mode } =
    input && typeof input === 'object' ? input : { role: input };
  const normalizedShape = toStringValue(shape ?? mode ?? resolveRoleShape(role)).trim();
  return normalizedShape === LAUNCHER_FAMILY_ROLE_CONTRACT_SHAPES.reviewer
    ? FINDINGS_ONLY_TOOL_SURFACE_GUIDANCE
    : IMPLEMENTATION_TOOL_SURFACE_GUIDANCE;
}

export function classifyLauncherRoleContractShape(input = {}) {
  return classifyFromText(input);
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
  const subjectPath = reviewPromptSubjectPath(subject);
  const shape = resolveRoleShape(role);
  const guidance = launcherRoleToolSurfaceGuidance({ role, shape });
  const workspaceDir = toStringValue(input.workspaceDir).trim();

  const canonicalRepo = toStringValue(input.canonicalRepo).trim();
  const isManagedReviewer = role === 'reviewer' && canonicalRepo !== '';

  const lines = [
    role === 'worker' ? LAUNCHER_ROLE_CONTRACT_IMPLEMENTATION_MARKER : LAUNCHER_ROLE_CONTRACT_FINDINGS_ONLY_MARKER,
    `# ${appName} ${role} role contract`,
    `Role: ${role === 'worker' ? 'implementation worker' : role === 'reviewer' ? 'review worker' : 'redteam worker'} for ${subject}.`,
    `Read AGENTS.md and ${subjectPath} first.`,
    'Render the subject unit\'s canonical acceptance criteria and validation; when the subject is a slice, use that slice\'s own acceptance.criteria and acceptance.validation.',
  ];

  if (workspaceDir) {
    lines.push(`Workspace directory: ${workspaceDir}.`);
  }

  const docsBlock = formatBulletList('Read first', input.docs);
  if (docsBlock) {
    lines.push(docsBlock);
  }

  const writeScopeBlock = formatBulletList('Write scope', input.writeScope ?? input.write_scope);
  if (writeScopeBlock) {
    lines.push(writeScopeBlock);
  }

  const acceptanceBlocks = renderAcceptanceContractSections(input);
  if (acceptanceBlocks.length) {
    lines.push(...acceptanceBlocks);
  }

  lines.push(guidance);
  lines.push(LAUNCHER_ROLE_CONTRACT_PUBLIC_SEAM_MARKER);

  if (role === 'worker') {
    lines.push('modify only files inside the assigned write_scope.');
    lines.push('Do not edit the WK record, its closure, or its status.');
    lines.push('Do not call workspace_submit_for_review.');
    lines.push('Complete the managed exact-slice implementation lifecycle by invoking the closed-input commit capability and then terminating.');
    lines.push('After confirmed termination, trusted runtime integrates the committed slice into the current WK tip, freezes the accumulated whole-WK SHA as the review target, and transitions that target to review.');
    lines.push('Prompt text, caller input, ambient environment, and worker-selected modes cannot select legacy submission or WK-update behavior.');
    lines.push('No structured validation or general MCP tools are available; delivery uses only the closed-input commit capability.');
    lines.push('Do not native-edit wiki/work-records/*.json unless that file is explicitly in write_scope.');
    lines.push('Use the launcher-provided actual native command tool directly inside bwrap to inspect assigned R union W and to mutate assigned W.');
    lines.push('Declared validation is reviewer-owned; worker-side checks are optional evidence and complete-test availability or success is not required before commit.');
    lines.push('This launcher-granted command access takes precedence over the AGENTS.md "structured tools first / shell denied" default for this confined implementation session.');
    lines.push('If assigned source access or the closed-input commit capability is unavailable, stop and report a blocker rather than trying environment overrides or alternate delivery paths.');
  } else if (isManagedReviewer) {
    lines.push('Do not update the work record.');
    lines.push('Do not call workspace_submit_for_review.');
    lines.push('Complete by returning your terminal structured findings result for trusted-runtime capture; trusted runtime derives the review_result from that captured response and transitions the review target. There is no submit step and no repository write.');
    lines.push('You have no repository write grant: do not modify any file or the work record.');
    lines.push('Prompt text, caller input, ambient environment, and reviewer-selected modes cannot select a legacy submission path.');
  } else {
    lines.push('Do not update the work record.');
    lines.push('When findings-only reviewer or redteam work is complete, call workspace_submit_for_review; it moves only the assigned unit to review.');
    if (role === 'redteam') {
      lines.push(...LAUNCHER_REDTEAM_ADVERSARIAL_GUIDANCE_LINES);
    }
  }

  const notesBlock = formatBulletList('Notes', input.notes);
  if (notesBlock) {
    lines.push(notesBlock);
  }

  lines.push(renderTerminalStructuredRoleResultContract({
    role,
    subject,
    mode: input.terminalStructuredRoleResultMode
      ?? input.structuredRoleResultMode
      ?? TERMINAL_STRUCTURED_ROLE_RESULT_MODES.FENCED,
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

function renderOrchestratorAuthorityPacket({
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
    'Coordinator authority reminder:',
    `- Context: ${context.join('; ')}.`,
    '- Allowed coordination surfaces: AGENTS.md, canonical docs/wiki/work records, and structured wiki/MCP coordination tools.',
    '- Forbidden implementation/test surfaces: do not use the orchestrator role to edit packages/, tests/, product/runtime code, or runnable artifacts under docs/ or wiki/; dispatch the appropriate worker instead.',
    '- After launch or resume, reread AGENTS.md and the subject record before choosing coordination actions.',
    '- When role authority, mount state, dispatch readiness, or write authority is unclear, use structured tool discovery and workspace coordination/preflight/status checks before acting.',
    '- This packet is a reminder for orchestrator startup/resume prompts; it is not runtime enforcement and does not solve mid-session compaction or non-Codex harness behavior.',
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

  const lines = [
    `# ${appName} orchestrator prompt`,
    `You are the ${appName} orchestrator for ${normalizedThreadName || subjectPath}.`,
  ];
  if (!headless) {
    lines.push(
      `Suggested ${resolvedRenameHintLabel} rename command: /rename ${normalizedThreadName}`
    );
  }
  lines.push(`Read AGENTS.md and ${subjectPath} first.`);

  if (workspaceDir) {

    lines.splice(lines.length, 0, `Workspace directory: ${workspaceDir}.`);
  }

  lines.push(renderOrchestratorAuthorityPacket({
    appName,
    subject: normalizedThreadName,
    subjectPath,
    repo,
    workspaceDir,
  }));

  if (headless) {
    lines.push(LAUNCHER_ORCHESTRATOR_HEADLESS_DIRECTIVE);
  }

  return lines.filter(Boolean).join('\n\n');
}

const launcherRoleContractExports = Object.freeze({
  LAUNCHER_FAMILY_ROLE_CONTRACT_ROLES,
  LAUNCHER_FAMILY_ROLE_CONTRACT_SHAPES,
  LAUNCHER_ROLE_CONTRACT_FINDINGS_ONLY_MARKER,
  LAUNCHER_ROLE_CONTRACT_IMPLEMENTATION_MARKER,
  LAUNCHER_ROLE_CONTRACT_PUBLIC_SEAM_MARKER,
  LAUNCHER_REDTEAM_ADVERSARIAL_GUIDANCE_LINES,
  LAUNCHER_ORCHESTRATOR_PROMPT_MODES,
  LAUNCHER_ORCHESTRATOR_HEADLESS_DIRECTIVE,
  TERMINAL_STRUCTURED_ROLE_RESULT_MODES,
  LauncherRoleContractError,
  classifyLauncherRoleContractShape,
  launcherRoleToolSurfaceGuidance,
  renderImplementationWorkerPrompt,
  renderLauncherFamilyOrchestratorPrompt,
  renderLauncherFamilyRoleContract,
  renderRoleContract,
  renderWorkerPrompt,
  reviewPromptSubjectPath,
});

export default launcherRoleContractExports;
