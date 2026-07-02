export const DEFAULT_CLAUDE_OAUTH_REFRESH_SAFETY_WINDOW_MS = 30 * 60 * 1000;

export const CLAUDE_OAUTH_CREDENTIAL_PREFLIGHT_REASON_CODES = Object.freeze({
  healthy: 'credential_healthy',
  missing: 'credential_missing',
  malformed: 'credential_malformed',
  expired: 'credential_expired',
  nearExpiry: 'credential_near_expiry',
});

const PREFLIGHT_STATES = Object.freeze({
  healthy: 'healthy',
  missing: 'missing',
  malformed: 'malformed',
  expired: 'expired',
  nearExpiry: 'near-expiry',
});

const MISSING_FILE_CODES = new Set(['ENOENT', 'ENOTDIR']);

export async function classifyClaudeOAuthCredentialPreflight({
  credentialPath,
  readFile,
  nowMs,
  refreshSafetyWindowMs = DEFAULT_CLAUDE_OAUTH_REFRESH_SAFETY_WINDOW_MS,
} = {}) {
  assertCredentialPath(credentialPath);
  assertReadFile(readFile);
  assertFiniteNumber(nowMs, 'nowMs');
  assertRefreshSafetyWindowMs(refreshSafetyWindowMs);

  let credentialText;
  try {
    credentialText = await readFile(credentialPath);
  } catch (error) {
    const missing = isMissingFileError(error);
    return buildResult(
      missing ? PREFLIGHT_STATES.missing : PREFLIGHT_STATES.malformed,
      !missing,
      credentialPath,
      nowMs,
      refreshSafetyWindowMs,
      null,
      missing
        ? CLAUDE_OAUTH_CREDENTIAL_PREFLIGHT_REASON_CODES.missing
        : CLAUDE_OAUTH_CREDENTIAL_PREFLIGHT_REASON_CODES.malformed,
    );
  }

  let credential;
  try {
    credential = JSON.parse(String(credentialText));
  } catch {
    return buildResult(
      PREFLIGHT_STATES.malformed,
      true,
      credentialPath,
      nowMs,
      refreshSafetyWindowMs,
      null,
      CLAUDE_OAUTH_CREDENTIAL_PREFLIGHT_REASON_CODES.malformed,
    );
  }

  const expiry = extractExpiryValue(credential);

  if (expiry.kind !== 'valid') {
    return buildResult(
      PREFLIGHT_STATES.malformed,
      true,
      credentialPath,
      nowMs,
      refreshSafetyWindowMs,
      null,
      CLAUDE_OAUTH_CREDENTIAL_PREFLIGHT_REASON_CODES.malformed,
    );
  }
  if (expiry.millis <= nowMs) {
    return buildResult(
      PREFLIGHT_STATES.expired,
      true,
      credentialPath,
      nowMs,
      refreshSafetyWindowMs,
      expiry.raw,
      CLAUDE_OAUTH_CREDENTIAL_PREFLIGHT_REASON_CODES.expired,
    );
  }
  if (expiry.millis <= nowMs + refreshSafetyWindowMs) {
    return buildResult(
      PREFLIGHT_STATES.nearExpiry,
      true,
      credentialPath,
      nowMs,
      refreshSafetyWindowMs,
      expiry.raw,
      CLAUDE_OAUTH_CREDENTIAL_PREFLIGHT_REASON_CODES.nearExpiry,
    );
  }
  return buildResult(
    PREFLIGHT_STATES.healthy,
    false,
    credentialPath,
    nowMs,
    refreshSafetyWindowMs,
    expiry.raw,
    CLAUDE_OAUTH_CREDENTIAL_PREFLIGHT_REASON_CODES.healthy,
  );
}

function buildResult(state, shouldRefuse, credentialPath, nowMs, refreshSafetyWindowMs, expiresAt, reasonCode) {
  return { state, shouldRefuse, diagnostics: { credentialPath, nowMs, refreshSafetyWindowMs, expiresAt, reasonCode } };
}

function extractExpiryValue(credential) {
  if (!isPlainObject(credential)) return { kind: 'unsafe', raw: null, millis: null };

  const source = isPlainObject(credential.claudeAiOauth)
    ? credential.claudeAiOauth
    : credential;
  const raw = hasOwn(source, 'expiresAt')
    ? source.expiresAt
    : hasOwn(source, 'expires_at')
      ? source.expires_at
      : undefined;
  if (raw == null) return { kind: 'missing', raw: null, millis: null };
  if (raw instanceof Date) return { kind: 'unsafe', raw: null, millis: null };
  if (typeof raw === 'string') {
    const trimmed = raw.trim();

    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (!Number.isSafeInteger(numeric)) return { kind: 'invalid-string', raw: null, millis: null };
      return { kind: 'valid', raw, millis: numeric < 1e12 ? numeric * 1000 : numeric };
    }
    const parsedMs = Date.parse(trimmed);
    if (Number.isFinite(parsedMs)) return { kind: 'valid', raw, millis: parsedMs };
    return { kind: 'invalid-string', raw: null, millis: null };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { kind: 'valid', raw, millis: raw < 1e12 ? raw * 1000 : raw };
  }
  return { kind: 'unsafe', raw: null, millis: null };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isMissingFileError(error) {
  return Boolean(error) && typeof error === 'object' && (MISSING_FILE_CODES.has(error.code) || error.name === 'ENOENT');
}

function assertCredentialPath(credentialPath) {
  if (typeof credentialPath !== 'string' || credentialPath.trim() === '') {
    throw new TypeError('credentialPath must be a non-empty string');
  }
}

function assertReadFile(readFile) {
  if (typeof readFile !== 'function') throw new TypeError('readFile must be a function');
}

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
}

function assertRefreshSafetyWindowMs(refreshSafetyWindowMs) {
  if (typeof refreshSafetyWindowMs !== 'number' || !Number.isFinite(refreshSafetyWindowMs) || refreshSafetyWindowMs < 0) {
    throw new TypeError('refreshSafetyWindowMs must be a finite, non-negative number');
  }
}
