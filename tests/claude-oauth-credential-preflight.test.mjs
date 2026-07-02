import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CLAUDE_OAUTH_CREDENTIAL_PREFLIGHT_REASON_CODES,
  DEFAULT_CLAUDE_OAUTH_REFRESH_SAFETY_WINDOW_MS,
  classifyClaudeOAuthCredentialPreflight,
} from '../packages/agent-launch-cli/src/lib/claude-oauth-credential-preflight.mjs';

const CREDENTIAL_PATH = '/tmp/claude-oauth-credentials.json';
const NOW_MS = 1_700_000_000_000;
const REASON_CODE_VALUES = new Set(
  Object.values(CLAUDE_OAUTH_CREDENTIAL_PREFLIGHT_REASON_CODES).filter(
    (value) => typeof value === 'string',
  ),
);

function makeCredential({
  accessToken = 'fixture-access-token-value',
  expiresAt,
  expires_at,
  refreshToken = 'fixture-refresh-token-value',
} = {}) {
  const payload = {};

  if (accessToken !== undefined) {
    payload.accessToken = accessToken;
  }

  if (refreshToken !== undefined) {
    payload.refreshToken = refreshToken;
  }

  if (expiresAt !== undefined) {
    payload.expiresAt = expiresAt;
  }

  if (expires_at !== undefined) {
    payload.expires_at = expires_at;
  }

  return JSON.stringify(payload);
}

function makeNestedCredential({
  accessToken = 'nested-fixture-access-token-value',
  refreshToken = 'nested-fixture-refresh-token-value',
  expiresAt,
  expires_at,
  extra,
} = {}) {
  const oauth = {};

  if (accessToken !== undefined) {
    oauth.accessToken = accessToken;
  }

  if (refreshToken !== undefined) {
    oauth.refreshToken = refreshToken;
  }

  if (expiresAt !== undefined) {
    oauth.expiresAt = expiresAt;
  }

  if (expires_at !== undefined) {
    oauth.expires_at = expires_at;
  }

  return JSON.stringify({ ...(extra ?? {}), claudeAiOauth: oauth });
}

async function classifyWith({
  credentialText,
  nowMs = NOW_MS,
  readFile,
  refreshSafetyWindowMs = DEFAULT_CLAUDE_OAUTH_REFRESH_SAFETY_WINDOW_MS,
} = {}) {
  const readFileImpl =
    readFile ??
    (() => {
      if (credentialText === undefined) {
        throw new Error('credentialText or readFile is required');
      }

      return credentialText;
    });

  return await classifyClaudeOAuthCredentialPreflight({
    credentialPath: CREDENTIAL_PATH,
    readFile: readFileImpl,
    nowMs,
    refreshSafetyWindowMs,
  });
}

function assertRecognizedReasonCode(result) {
  assert.equal(typeof result.diagnostics.reasonCode, 'string');
  assert.ok(
    REASON_CODE_VALUES.has(result.diagnostics.reasonCode),
    `unexpected reason code: ${result.diagnostics.reasonCode}`,
  );
}

function assertNoSecretValues(result, secretValues) {
  const serialized = JSON.stringify(result);

  for (const secretValue of secretValues) {
    assert.ok(
      !serialized.includes(secretValue),
      `serialized result leaked ${secretValue}`,
    );
  }
}

test('exports the stable public API surface', () => {
  assert.equal(
    typeof DEFAULT_CLAUDE_OAUTH_REFRESH_SAFETY_WINDOW_MS,
    'number',
  );
  assert.ok(DEFAULT_CLAUDE_OAUTH_REFRESH_SAFETY_WINDOW_MS > 0);

  assert.equal(typeof CLAUDE_OAUTH_CREDENTIAL_PREFLIGHT_REASON_CODES, 'object');
  assert.ok(CLAUDE_OAUTH_CREDENTIAL_PREFLIGHT_REASON_CODES);
  assert.equal(typeof classifyClaudeOAuthCredentialPreflight, 'function');
});

test('classifies healthy credentials with the default safety window', async () => {
  const expiresAt =
    NOW_MS + DEFAULT_CLAUDE_OAUTH_REFRESH_SAFETY_WINDOW_MS + 1_000;
  let readFilePath = null;

  const result = await classifyWith({
    credentialText: makeCredential({ expiresAt }),
    readFile: (credentialPath) => {
      readFilePath = credentialPath;
      return makeCredential({ expiresAt });
    },
  });

  assert.equal(readFilePath, CREDENTIAL_PATH);
  assert.equal(result.shouldRefuse, false);
  assert.match(result.state, /healthy|ok|valid|good/i);
  assert.equal(result.diagnostics.credentialPath, CREDENTIAL_PATH);
  assert.equal(
    result.diagnostics.refreshSafetyWindowMs,
    DEFAULT_CLAUDE_OAUTH_REFRESH_SAFETY_WINDOW_MS,
  );
  assert.notEqual(result.diagnostics.expiresAt, null);
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, ['fixture-access-token-value', 'fixture-refresh-token-value']);
});

test('classifies missing credential files as fail-open without leaking token values', async () => {
  const error = new Error('ENOENT');
  error.code = 'ENOENT';

  const result = await classifyWith({
    readFile: () => {
      throw error;
    },
  });

  assert.equal(result.shouldRefuse, false);
  assert.match(result.state, /missing|absent|not.?found/i);
  assert.equal(result.diagnostics.credentialPath, CREDENTIAL_PATH);
  assert.equal(result.diagnostics.expiresAt, null);
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, ['fixture-access-token-value', 'fixture-refresh-token-value']);
});

test('classifies unreadable non-missing credential files as malformed refusals', async () => {
  const error = new Error('EACCES');
  error.code = 'EACCES';

  const result = await classifyWith({
    readFile: () => {
      throw error;
    },
  });

  assert.equal(result.shouldRefuse, true);
  assert.match(result.state, /malformed|unreadable|invalid/i);
  assert.equal(result.diagnostics.credentialPath, CREDENTIAL_PATH);
  assert.equal(result.diagnostics.expiresAt, null);
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, ['fixture-access-token-value', 'fixture-refresh-token-value']);
});

test('redacts malformed nested expiresAt payloads that contain token-like fields', async () => {
  const malformedCredential = makeCredential({
    accessToken: 'top-level-fixture-access-token-value',
    expiresAt: {
      accessToken: 'nested-fixture-access-token-value',
      expires_at: {
        refreshToken: 'deep-fixture-refresh-token-value',
      },
      refreshToken: 'nested-fixture-refresh-token-value',
    },
    refreshToken: 'top-level-fixture-refresh-token-value',
  });

  const result = await classifyWith({
    credentialText: malformedCredential,
  });

  assert.equal(result.shouldRefuse, true);
  assert.match(result.state, /malformed|invalid|parse|bad/i);
  assert.equal(result.diagnostics.credentialPath, CREDENTIAL_PATH);
  assert.equal(result.diagnostics.expiresAt, null);
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, [
    'top-level-fixture-access-token-value',
    'top-level-fixture-refresh-token-value',
    'nested-fixture-access-token-value',
    'nested-fixture-refresh-token-value',
    'deep-fixture-refresh-token-value',
  ]);
});

test('redacts invalid string expiresAt values that contain token-like text', async () => {

  const tokenLikeExpiry = 'invalid-expiry-with-embedded-fixture-token-redact-me';

  const result = await classifyWith({
    credentialText: makeCredential({ expiresAt: tokenLikeExpiry }),
  });

  assert.equal(result.shouldRefuse, true);
  assert.match(result.state, /malformed|invalid|parse|bad/i);
  assert.equal(result.diagnostics.credentialPath, CREDENTIAL_PATH);
  assert.equal(result.diagnostics.expiresAt, null);
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, [
    tokenLikeExpiry,
    'fixture-access-token-value',
    'fixture-refresh-token-value',
  ]);
});

test('redacts invalid string expires_at values that contain token-like text', async () => {
  const tokenLikeExpiry = 'expires-soon-but-actually-a-fixture-refresh-token-leak';

  const result = await classifyWith({
    credentialText: makeCredential({ expires_at: tokenLikeExpiry }),
  });

  assert.equal(result.shouldRefuse, true);
  assert.match(result.state, /malformed|invalid|parse|bad/i);
  assert.equal(result.diagnostics.expiresAt, null);
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, [tokenLikeExpiry]);
});

test('reads a bare year-like numeric string expiry as a tiny epoch, not a calendar year', async () => {

  const result = await classifyWith({
    credentialText: makeCredential({ expiresAt: '2025' }),
  });

  assert.equal(result.shouldRefuse, true);
  assert.match(result.state, /expired|stale|past/i);
  assert.equal(result.diagnostics.expiresAt, '2025');
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, ['fixture-access-token-value', 'fixture-refresh-token-value']);
});

test('handles a strict decimal epoch numeric string expiry as numeric (healthy)', async () => {

  const healthyMs =
    NOW_MS + DEFAULT_CLAUDE_OAUTH_REFRESH_SAFETY_WINDOW_MS + 1_000;

  const result = await classifyWith({
    credentialText: makeCredential({ expiresAt: String(healthyMs) }),
  });

  assert.equal(result.shouldRefuse, false);
  assert.match(result.state, /healthy|ok|valid|good/i);
  assert.equal(result.diagnostics.expiresAt, String(healthyMs));
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, ['fixture-access-token-value', 'fixture-refresh-token-value']);
});

test('redacts whitespace-only, hex, and exponent-form string expiries as malformed', async () => {

  for (const invalidExpiry of ['   ', '0x10', '1e10', '\t\n']) {
    const result = await classifyWith({
      credentialText: makeCredential({ expiresAt: invalidExpiry }),
    });

    assert.equal(
      result.shouldRefuse,
      true,
      `expected refusal for ${JSON.stringify(invalidExpiry)}`,
    );
    assert.match(result.state, /malformed|invalid|parse|bad/i);
    assert.equal(
      result.diagnostics.expiresAt,
      null,
      `expected null expiresAt for ${JSON.stringify(invalidExpiry)}`,
    );
    assertRecognizedReasonCode(result);
    assertNoSecretValues(result, [
      'fixture-access-token-value',
      'fixture-refresh-token-value',
    ]);
  }
});

test('redacts a numeric-overflow string expiry as malformed without echoing the raw value', async () => {

  const overflowExpiry = '9'.repeat(20);

  const result = await classifyWith({
    credentialText: makeCredential({ expiresAt: overflowExpiry }),
  });

  assert.equal(result.shouldRefuse, true);
  assert.match(result.state, /malformed|invalid|parse|bad/i);
  assert.equal(result.diagnostics.expiresAt, null);
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, [
    overflowExpiry,
    'fixture-access-token-value',
    'fixture-refresh-token-value',
  ]);
});

test('classifies expired credentials as refusal cases', async () => {
  const expiresAt = NOW_MS - 1;

  const result = await classifyWith({
    credentialText: makeCredential({ expiresAt }),
  });

  assert.equal(result.shouldRefuse, true);
  assert.match(result.state, /expired|stale|past/i);
  assert.equal(result.diagnostics.credentialPath, CREDENTIAL_PATH);
  assert.equal(
    result.diagnostics.refreshSafetyWindowMs,
    DEFAULT_CLAUDE_OAUTH_REFRESH_SAFETY_WINDOW_MS,
  );
  assert.notEqual(result.diagnostics.expiresAt, null);
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, ['fixture-access-token-value', 'fixture-refresh-token-value']);
});

test('classifies near-expiry credentials using the configured safety window', async () => {
  const expiresAt =
    NOW_MS + DEFAULT_CLAUDE_OAUTH_REFRESH_SAFETY_WINDOW_MS - 1;

  const result = await classifyWith({
    credentialText: makeCredential({ expiresAt }),
  });

  assert.equal(result.shouldRefuse, true);
  assert.match(result.state, /near[-_ ]?expiry|expir|window|soon/i);
  assert.equal(result.diagnostics.credentialPath, CREDENTIAL_PATH);
  assert.equal(
    result.diagnostics.refreshSafetyWindowMs,
    DEFAULT_CLAUDE_OAUTH_REFRESH_SAFETY_WINDOW_MS,
  );
  assert.notEqual(result.diagnostics.expiresAt, null);
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, ['fixture-access-token-value', 'fixture-refresh-token-value']);
});

test('honors an injected refresh safety window for deterministic tests', async () => {
  const refreshSafetyWindowMs = 2_500;
  const healthyResult = await classifyWith({
    credentialText: makeCredential({
      expires_at: NOW_MS + refreshSafetyWindowMs + 1,
    }),
    refreshSafetyWindowMs,
  });
  const nearExpiryResult = await classifyWith({
    credentialText: makeCredential({
      expires_at: NOW_MS + refreshSafetyWindowMs - 1,
    }),
    refreshSafetyWindowMs,
  });

  assert.equal(healthyResult.shouldRefuse, false);
  assert.equal(nearExpiryResult.shouldRefuse, true);
  assert.equal(
    healthyResult.diagnostics.refreshSafetyWindowMs,
    refreshSafetyWindowMs,
  );
  assert.equal(
    nearExpiryResult.diagnostics.refreshSafetyWindowMs,
    refreshSafetyWindowMs,
  );
  assertRecognizedReasonCode(healthyResult);
  assertRecognizedReasonCode(nearExpiryResult);
});

test('classifies nested claudeAiOauth healthy credentials (current Claude Code shape)', async () => {
  const expiresAt =
    NOW_MS + DEFAULT_CLAUDE_OAUTH_REFRESH_SAFETY_WINDOW_MS + 1_000;

  const result = await classifyWith({
    credentialText: makeNestedCredential({ expiresAt }),
  });

  assert.equal(result.shouldRefuse, false);
  assert.match(result.state, /healthy|ok|valid|good/i);
  assert.equal(result.diagnostics.credentialPath, CREDENTIAL_PATH);
  assert.notEqual(result.diagnostics.expiresAt, null);
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, [
    'nested-fixture-access-token-value',
    'nested-fixture-refresh-token-value',
  ]);
});

test('classifies nested claudeAiOauth expired credentials as refusals', async () => {
  const result = await classifyWith({
    credentialText: makeNestedCredential({ expiresAt: NOW_MS - 1 }),
  });

  assert.equal(result.shouldRefuse, true);
  assert.match(result.state, /expired|stale|past/i);
  assert.notEqual(result.diagnostics.expiresAt, null);
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, [
    'nested-fixture-access-token-value',
    'nested-fixture-refresh-token-value',
  ]);
});

test('classifies nested claudeAiOauth near-expiry credentials using expires_at', async () => {
  const result = await classifyWith({
    credentialText: makeNestedCredential({
      expires_at: NOW_MS + DEFAULT_CLAUDE_OAUTH_REFRESH_SAFETY_WINDOW_MS - 1,
    }),
  });

  assert.equal(result.shouldRefuse, true);
  assert.match(result.state, /near[-_ ]?expiry|expir|window|soon/i);
  assert.notEqual(result.diagnostics.expiresAt, null);
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, [
    'nested-fixture-access-token-value',
    'nested-fixture-refresh-token-value',
  ]);
});

test('prefers the nested claudeAiOauth expiry over a flat top-level expiry', async () => {

  const result = await classifyWith({
    credentialText: makeNestedCredential({
      expiresAt: NOW_MS + DEFAULT_CLAUDE_OAUTH_REFRESH_SAFETY_WINDOW_MS + 1_000,
      extra: { expiresAt: NOW_MS - 1 },
    }),
  });

  assert.equal(result.shouldRefuse, false);
  assert.match(result.state, /healthy|ok|valid|good/i);
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, [
    'nested-fixture-access-token-value',
    'nested-fixture-refresh-token-value',
  ]);
});

test('classifies malformed JSON credential text as a refusal without leaking tokens', async () => {

  const tokenLikeFragment = 'fixture-token-fragment-redact-me';

  const result = await classifyWith({
    credentialText: `{ "accessToken": "${tokenLikeFragment}", not valid json`,
  });

  assert.equal(result.shouldRefuse, true);
  assert.match(result.state, /malformed|invalid|parse|bad/i);
  assert.equal(result.diagnostics.credentialPath, CREDENTIAL_PATH);
  assert.equal(result.diagnostics.expiresAt, null);
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, [tokenLikeFragment]);
});

test('classifies valid JSON missing any expiry field as a malformed refusal', async () => {

  const result = await classifyWith({
    credentialText: makeCredential({ expiresAt: undefined, expires_at: undefined }),
  });

  assert.equal(result.shouldRefuse, true);
  assert.match(result.state, /malformed|invalid|missing|absent/i);
  assert.equal(result.diagnostics.credentialPath, CREDENTIAL_PATH);
  assert.equal(result.diagnostics.expiresAt, null);
  assertRecognizedReasonCode(result);
  assertNoSecretValues(result, ['fixture-access-token-value', 'fixture-refresh-token-value']);
});
