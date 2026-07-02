import {
  TERMINAL_STRUCTURED_ROLE_RESULT_MODES,
  renderTerminalStructuredRoleResultContract
} from '@agent-chassis/agent-launch-core/src/lib/work-record-launch-prompt.mjs';

export { TERMINAL_STRUCTURED_ROLE_RESULT_MODES };

const DEFAULT_REVIEW_PROMPT_SUBJECT_PATH = 'wiki/work-records/WK-0000.json';

export const LAUNCHER_ROLE_CONTRACT_FINDINGS_ONLY_MARKER =
  'Findings only. Do not modify files.';
export const LAUNCHER_ROLE_CONTRACT_IMPLEMENTATION_MARKER =
  'Implementation workers may use launcher-granted native Edit/Write only within assigned write_scope/bwrap; raw shell/Bash and raw exec_command remain forbidden.';

export const LAUNCHER_ROLE_CONTRACT_PUBLIC_SEAM_MARKER =
  'Public seam steering: when admission-related behavior needs a test seam, drive and assert it through the launcher-registered public backend and tool surfaces; do not target private or unexported admission-recovery helper internals.';

export const LAUNCHER_FAMILY_ROLE_CONTRACT_ROLES = Object.freeze([
  'worker',
  'reviewer',
  'redteam',
]);

export const LAUNCHER_FAMILY_ROLE_CONTRACT_SHAPES = Object.freeze({
  worker: 'implementation',
  reviewer: 'findings_only',
  redteam: 'findings_only',
});

const FINDINGS_ONLY_TOOL_SURFACE_GUIDANCE = [
  'Use the launcher-provided structured read tools for repo inspection.',
  'Broad read-only source inspection is allowed.',
  'Read-only raw shell/Bash and raw exec_command are allowed only for non-mutating source inspection with tools such as rg, sed, cat, and git grep, and for focused validation commands that do not modify files.',
  'You have no write grant, so do not modify files or attempt native Edit/Write tools.',
  'stock Edit/Write tools are not part of the launch contract.',
].join(' ');

const IMPLEMENTATION_TOOL_SURFACE_GUIDANCE = [
  'Use the launcher-provided structured read tools for inspection.',
  'Your repo read/write access is exactly the launcher-provided session contract, not inferred from filesystem layout or bwrap internals.',
  'Native Edit/Write only to explicitly assigned write_scope paths, and only when launcher-granted for this session.',
  'WK closure, status, review evidence, dispatch-readiness, and other coordination writes must use launcher-provided structured MCP/work-record tools.',
  'Do not native-edit wiki/work-records/*.json unless that file is explicitly in write_scope.',
  'You may read your assigned read_scope, repo_paths, and write_scope using the launcher-granted source-read access for this session; when no structured filesystem-MCP reader is configured for the session, native read-only inspection of that assigned scope from the read-only repo mount is the authorized read mechanism, so do not report a blocker merely because a structured filesystem-MCP reader is absent.',
  'This launcher-granted read access takes precedence over the AGENTS.md "structured tools first / shell denied" default: native read-only inspection of in-scope files is the session\'s authorized read mechanism, is not raw shell, and does not require a structured reader to be present.',
  'If needed access or structured tools are unavailable, stop and report a blocker rather than trying shell, raw filesystem writes, environment overrides, or fallback paths.',
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
    normalized.includes('needed access or structured tools are unavailable') ||
    normalized.includes('update the work record closure and status');

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
    lines.push('update the work record closure and status.');
    lines.push('WK closure, status, review evidence, dispatch-readiness, and other coordination writes must use launcher-provided structured MCP/work-record tools.');
    lines.push('Do not native-edit wiki/work-records/*.json unless that file is explicitly in write_scope.');
    lines.push('You may read your assigned read_scope, repo_paths, and write_scope using the launcher-granted source-read access for this session; when no structured filesystem-MCP reader is configured for the session, native read-only inspection of that assigned scope from the read-only repo mount is the authorized read mechanism, so do not report a blocker merely because a structured filesystem-MCP reader is absent.');
    lines.push('This launcher-granted read access takes precedence over the AGENTS.md "structured tools first / shell denied" default: native read-only inspection of in-scope files is the session\'s authorized read mechanism, is not raw shell, and does not require a structured reader to be present.');
    lines.push('If needed access or structured tools are unavailable, stop and report a blocker rather than trying shell, raw filesystem writes, environment overrides, or fallback paths.');
  } else {
    lines.push('Do not update the work record.');
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

export function renderLauncherFamilyOrchestratorPrompt(options = {}) {
  const input = normalizeLauncherRoleContractInput(options);
  const appName = normalizeAppName(input.appName);
  const resolvedRenameHintLabel = toStringValue(
    input.renameHintLabel ?? input.renameLabel ?? appName
  ).trim() || appName;
  const normalizedThreadName = toStringValue(
    input.threadName ?? input.subject ?? input.initiative ?? input.unit ?? input.path
  ).trim();
  const subjectPath = reviewPromptSubjectPath(
    input.subjectPath ?? input.initiative ?? input.subject ?? input.threadName
  );

  const lines = [
    `# ${appName} orchestrator prompt`,
    `You are the ${appName} orchestrator for ${normalizedThreadName || subjectPath}.`,
    `Suggested ${resolvedRenameHintLabel} rename command: /rename ${normalizedThreadName}`,
    `Read AGENTS.md and ${subjectPath} first.`,
  ];

  const workspaceDir = toStringValue(input.workspaceDir).trim();
  if (workspaceDir) {
    lines.splice(4, 0, `Workspace directory: ${workspaceDir}.`);
  }

  return lines.filter(Boolean).join('\n\n');
}

const launcherRoleContractExports = Object.freeze({
  LAUNCHER_FAMILY_ROLE_CONTRACT_ROLES,
  LAUNCHER_FAMILY_ROLE_CONTRACT_SHAPES,
  LAUNCHER_ROLE_CONTRACT_FINDINGS_ONLY_MARKER,
  LAUNCHER_ROLE_CONTRACT_IMPLEMENTATION_MARKER,
  LAUNCHER_ROLE_CONTRACT_PUBLIC_SEAM_MARKER,
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
