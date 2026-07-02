const DEFAULT_NAME_PART_FALLBACK = 'unknown';

const UNSAFE_PATH_SEGMENT_CHAR = /[^A-Za-z0-9._-]/g;

const DEFAULT_PATH_SEGMENT_REPLACEMENT = '_';

function hasText(value) {
  return typeof value === 'string' ? value.trim().length > 0 : value != null && String(value).trim().length > 0;
}

function normalizeNamePart(value, fallback = DEFAULT_NAME_PART_FALLBACK) {
  const raw = hasText(value) ? String(value) : fallback;
  const cleaned = raw
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  if (cleaned.length > 0) {
    return cleaned;
  }
  const fallbackText = String(fallback)
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  return fallbackText.length > 0 ? fallbackText : DEFAULT_NAME_PART_FALLBACK;
}

function pickLocalProfileText({ localValue, profileValue } = {}) {
  if (hasText(localValue)) {
    return { source: 'local', value: String(localValue).trim() };
  }
  if (hasText(profileValue)) {
    return { source: 'profile', value: String(profileValue).trim() };
  }
  return { source: null, value: undefined };
}

export function sanitizeOrchestratorNamePart(value, { fallback = DEFAULT_NAME_PART_FALLBACK } = {}) {
  return normalizeNamePart(value, fallback);
}

export function sanitizeOrchestratorPathSegment(value, { replacement = DEFAULT_PATH_SEGMENT_REPLACEMENT } = {}) {
  return String(value).replace(UNSAFE_PATH_SEGMENT_CHAR, replacement);
}

export function buildKeyFromParts(parts, { fallback = 'runtime', separator = '-' } = {}) {
  const normalizedParts = Array.isArray(parts) ? parts.map((part) => normalizeNamePart(part)).filter((part) => part.length > 0) : [];
  return normalizedParts.length > 0 ? normalizedParts.join(separator) : normalizeNamePart(fallback, fallback);
}

export function buildOrchestratorRuntimeDirKey({
  stateDirName,
  repoName,
  subject,
  fallback = 'runtime',
  separator = '-',
} = {}) {
  return buildKeyFromParts([stateDirName, repoName, subject], { fallback, separator });
}

export function buildOrchestratorThreadName({
  subject,
  repoName,
  roleLabel = 'orchestrator',
  subjectFallback = 'orchestrator',
  repoFallback = 'repo',
} = {}) {
  const safeSubject = normalizeNamePart(subject, subjectFallback);
  const safeRepo = normalizeNamePart(repoName, repoFallback);
  const roleText = hasText(roleLabel) ? String(roleLabel).trim() : 'orchestrator';
  return `${safeSubject} ${roleText} (${safeRepo})`;
}

export function resolveLocalProfileValue({ localValue, profileValue } = {}) {
  return pickLocalProfileText({ localValue, profileValue });
}

export function resolveOrchestratorModelEffort({
  env = {},
  profile = {},
  localModelKey,
  localEffortKey,
  profileModelKey = 'model',
  profileEffortKey = 'effort',
} = {}) {
  const modelSelection = resolveLocalProfileValue({
    localValue: localModelKey ? env[localModelKey] : undefined,
    profileValue: profileModelKey ? profile[profileModelKey] : undefined,
  });
  const effortSelection = resolveLocalProfileValue({
    localValue: localEffortKey ? env[localEffortKey] : undefined,
    profileValue: profileEffortKey ? profile[profileEffortKey] : undefined,
  });

  return {
    effort: effortSelection.value,
    effortSource: effortSelection.source,
    model: modelSelection.value,
    modelSource: modelSelection.source,
  };
}

export function buildOrchestratorSettings({
  appLabel,
  env = {},
  localEffortKey,
  localModelKey,
  modelFlag,
  effortFlag,
  profile = {},
  profileEffortKey = 'effort',
  profileModelKey = 'model',
  repoName,
  roleLabel = 'orchestrator',
  stateDirName,
  subject,
} = {}) {
  const runtimeDirKey = buildOrchestratorRuntimeDirKey({ stateDirName, repoName, subject });
  const threadName = buildOrchestratorThreadName({ subject, repoName, roleLabel });
  const modelEffort = resolveOrchestratorModelEffort({
    env,
    localEffortKey,
    localModelKey,
    profile,
    profileEffortKey,
    profileModelKey,
  });

  return {
    appLabel,
    effortFlag,
    modelFlag,
    repoName: normalizeNamePart(repoName, 'repo'),
    roleLabel: hasText(roleLabel) ? String(roleLabel).trim() : 'orchestrator',
    runtimeDirKey,
    stateDirName: normalizeNamePart(stateDirName, 'runtime'),
    subject: normalizeNamePart(subject, 'orchestrator'),
    threadName,
    ...modelEffort,
  };
}

export default {
  buildKeyFromParts,
  buildOrchestratorRuntimeDirKey,
  buildOrchestratorSettings,
  buildOrchestratorThreadName,
  resolveLocalProfileValue,
  resolveOrchestratorModelEffort,
  sanitizeOrchestratorNamePart,
  sanitizeOrchestratorPathSegment,
};
