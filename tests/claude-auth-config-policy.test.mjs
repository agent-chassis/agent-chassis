import test from "node:test";
import assert from "node:assert/strict";

import {
  CLAUDE_AUTH_CONFIG_POLICY_REFUSAL_CODES,
  ClaudeAuthConfigPolicyError,
  assertClaudeAuthConfigReadOnlyFileAllowed,
  buildClaudeAuthConfigHomePolicy,
  resolveClaudeAuthConfigPolicyFacts
} from "../packages/agent-launch-cli/src/lib/claude-auth-config-policy.mjs";
import {
  LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON
} from "../packages/agent-launch-cli/src/lib/launcher-runtime-home-policy.mjs";

const HOST_HOME = "/srv/agent-launcher";
const AUTH_POLICY_OPTIONS = Object.freeze({
  launcherOwnedHostHome: HOST_HOME,
  platform: "linux"
});

const ALLOWED_READ_ONLY_FILES = Object.freeze([
  `${HOST_HOME}/.claude/.credentials.json`,
  `${HOST_HOME}/.claude.json`
]);

const FORBIDDEN_SURFACES = Object.freeze([
  "$HOME",
  `${HOST_HOME}/.claude`,
  `${HOST_HOME}/.config`,
  `${HOST_HOME}/gcp-credentials`
]);

function isClaudeAuthConfigPolicyRefusal(err, code, expectedFragment) {
  return err instanceof ClaudeAuthConfigPolicyError
    && err.code === code
    && typeof err.detail === "object"
    && err.detail !== null
    && Object.values(err.detail).some((value) => value === expectedFragment || (
      Array.isArray(value) && value.includes(expectedFragment)
    ));
}

test("WK-1103#SLICE-005 Claude auth/config policy: allow and deny paths track the resolved host home", () => {
  const resolved = resolveClaudeAuthConfigPolicyFacts(AUTH_POLICY_OPTIONS);
  assert.equal(resolved.ok, true);
  assert.deepEqual(
    [...resolved.facts.allowedReadOnlyFiles],
    [...ALLOWED_READ_ONLY_FILES]
  );
  assert.deepEqual(
    [...resolved.facts.forbiddenSurfaces],
    [...FORBIDDEN_SURFACES]
  );

  for (const file of ALLOWED_READ_ONLY_FILES) {
    assert.equal(assertClaudeAuthConfigReadOnlyFileAllowed(file, AUTH_POLICY_OPTIONS), file);
  }
});

test("WK-1103#SLICE-005 Claude auth/config policy: trailing-slash homes are accepted and normalized", () => {
  const resolved = resolveClaudeAuthConfigPolicyFacts({
    launcherOwnedHostHome: "/Users/alice/",
    platform: "darwin"
  });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.facts.launcherOwnedHostHome, "/Users/alice/");
  assert.deepEqual(
    [...resolved.facts.allowedReadOnlyFiles],
    [
      "/Users/alice/.claude/.credentials.json",
      "/Users/alice/.claude.json"
    ]
  );
});

test("WK-1103#SLICE-005 Claude auth/config policy: unresolvable host home refuses with a fact-resolution reason", () => {
  const resolved = resolveClaudeAuthConfigPolicyFacts({
    readHostHome: () => "relative/home",
    platform: "linux"
  });

  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON);
  assert.equal(resolved.detail.failure, "relative");

  assert.throws(
    () => buildClaudeAuthConfigHomePolicy({}, { readHostHome: () => "/" }),
    (err) => err instanceof ClaudeAuthConfigPolicyError
      && err.code === LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON
      && err.detail.failure === "root"
  );
});

test("WK-0776 Claude auth/config policy: homePolicy output shape is a read-only leaf bind list", () => {
  const homePolicy = buildClaudeAuthConfigHomePolicy({
    readOnlyFile: `${HOST_HOME}/.claude/.credentials.json`,
    readOnlyFiles: [
      `${HOST_HOME}/.claude.json`,
      `${HOST_HOME}/.claude/.credentials.json`
    ]
  }, AUTH_POLICY_OPTIONS);

  assert.deepEqual(homePolicy, {
    schema_version: "claude-auth-config-policy.v1",
    reads: [
      `${HOST_HOME}/.claude/.credentials.json`,
      `${HOST_HOME}/.claude.json`
    ]
  });
  assert.deepEqual(Object.keys(homePolicy), ["schema_version", "reads"]);
  assert.equal(Object.isFrozen(homePolicy), true);
  assert.equal(Object.isFrozen(homePolicy.reads), true);
});

test("WK-0776 Claude auth/config policy: broad directories and non-leaf paths are refused", () => {
  for (const readOnlyFile of [
    "$HOME",
    `${HOST_HOME}/.claude`,
    `${HOST_HOME}/.claude/`,
    `${HOST_HOME}/.config`,
    `${HOST_HOME}/.config/gcloud`,
    `${HOST_HOME}/gcp-credentials`,
    `${HOST_HOME}/gcp-credentials/key.json`,
    `${HOST_HOME}/.claude/credentials.json`,
    `${HOST_HOME}/.claude/.credentials.json/`
  ]) {
    assert.throws(
      () => assertClaudeAuthConfigReadOnlyFileAllowed(readOnlyFile, AUTH_POLICY_OPTIONS),
      (err) => isClaudeAuthConfigPolicyRefusal(
        err,
        CLAUDE_AUTH_CONFIG_POLICY_REFUSAL_CODES.INVALID_PATH,
        readOnlyFile
      ),
      `expected invalid-path refusal for ${readOnlyFile}`
    );
  }
});

test("WK-0776 Claude auth/config policy: env-secret propagation and other unknown keys are refused", () => {
  for (const input of [
    { envSecrets: ["ANTHROPIC_API_KEY"] },
    { writableAuthConfig: [`${HOST_HOME}/.claude`] },
    { envPolicy: { secrets: ["ANTHROPIC_API_KEY"] } }
  ]) {
    assert.throws(
      () => buildClaudeAuthConfigHomePolicy(input, AUTH_POLICY_OPTIONS),
      (err) => err instanceof ClaudeAuthConfigPolicyError
        && err.code === CLAUDE_AUTH_CONFIG_POLICY_REFUSAL_CODES.INVALID_INPUT
        && typeof err.detail === "object"
        && err.detail !== null
        && Array.isArray(err.detail.invalid_keys)
        && err.detail.invalid_keys.length >= 1,
      `expected invalid-input refusal for ${JSON.stringify(input)}`
    );
  }
});
