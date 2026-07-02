import { posix as pathPosix } from "node:path";
import {
  LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON,
  resolveLauncherRuntimeHomePolicyFacts
} from "./launcher-runtime-home-policy.mjs";

export const CLAUDE_AUTH_CONFIG_POLICY_SCHEMA_VERSION =
  "claude-auth-config-policy.v1";

export const CLAUDE_AUTH_CONFIG_POLICY_REFUSAL_CODES = Object.freeze({
  INVALID_INPUT: "claude_auth_config_policy_invalid_input",
  INVALID_PATH: "claude_auth_config_path_invalid"
});

const CLAUDE_AUTH_CONFIG_ALLOWED_INPUT_KEYS = Object.freeze([
  "readOnlyFile",
  "readOnlyFiles"
]);

export class ClaudeAuthConfigPolicyError extends Error {
  constructor(message, { code, detail = null } = {}) {
    super(message);
    this.name = "ClaudeAuthConfigPolicyError";
    this.code = code ?? CLAUDE_AUTH_CONFIG_POLICY_REFUSAL_CODES.INVALID_INPUT;
    if (detail !== null) {
      this.detail = detail;
    }
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function failClaudeAuthConfigPolicy(code, message, detail = null) {
  throw new ClaudeAuthConfigPolicyError(`agent-launch claude auth/config policy: ${message}`, {
    code,
    detail
  });
}

function freezeUniqueList(values) {
  return Object.freeze([...new Set(values)]);
}

export function deriveClaudeAuthConfigPolicyFacts({
  launcherRuntimeHomePolicyFacts
} = {}) {
  if (!isPlainObject(launcherRuntimeHomePolicyFacts?.paths)) {
    throw new TypeError("launcherRuntimeHomePolicyFacts.paths must be present");
  }

  const paths = launcherRuntimeHomePolicyFacts.paths;
  const hostHome = launcherRuntimeHomePolicyFacts.launcherOwnedHostHome;
  if (typeof hostHome !== "string" || hostHome.length === 0) {
    throw new TypeError("launcherRuntimeHomePolicyFacts.launcherOwnedHostHome must be present");
  }

  const allowedReadOnlyFiles = freezeUniqueList([
    paths.credentialsFile,
    pathPosix.join(hostHome, ".claude.json")
  ]);
  const forbiddenSurfaces = freezeUniqueList([
    "$HOME",
    paths.claudeDirectory,
    paths.configDirectory,
    paths.gcpCredentialsDirectory
  ]);

  return Object.freeze({
    kind: "claude-auth-config-policy-facts",
    launcherOwnedHostHome: hostHome,
    allowedReadOnlyFiles,
    forbiddenSurfaces
  });
}

export function resolveClaudeAuthConfigPolicyFacts(options = {}) {
  const {
    launcherRuntimeHomePolicyFacts,
    source = "claude_auth_config_host_home",
    ...runtimeHomePolicyOptions
  } = options;

  if (launcherRuntimeHomePolicyFacts !== undefined) {
    try {
      return {
        ok: true,
        facts: deriveClaudeAuthConfigPolicyFacts({ launcherRuntimeHomePolicyFacts })
      };
    } catch (err) {
      return {
        ok: false,
        reason: LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON,
        detail: {
          fact: source,
          failure: "policy_facts_invalid",
          message: err?.message ?? String(err),
          code: err?.code ?? null
        }
      };
    }
  }

  const resolved = resolveLauncherRuntimeHomePolicyFacts({
    ...runtimeHomePolicyOptions,
    source
  });
  if (!resolved.ok) return resolved;

  return {
    ok: true,
    facts: deriveClaudeAuthConfigPolicyFacts({
      launcherRuntimeHomePolicyFacts: resolved.facts
    })
  };
}

function resolveClaudeAuthConfigPolicyFactsOrThrow(options = {}) {
  const resolved = resolveClaudeAuthConfigPolicyFacts(options);
  if (!resolved.ok) {
    failClaudeAuthConfigPolicy(
      resolved.reason ?? LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON,
      resolved.reason ?? LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON,
      resolved.detail ?? null
    );
  }
  return resolved.facts;
}

function policyDetail(policyFacts, extraDetail) {
  return {
    ...extraDetail,
    allowed_read_only_files: Object.freeze([...policyFacts.allowedReadOnlyFiles]),
    forbidden_surfaces: Object.freeze([...policyFacts.forbiddenSurfaces])
  };
}

function normalizeReadOnlyFileInput(readOnlyFile, detailKey, policyFacts) {
  if (readOnlyFile === null || readOnlyFile === undefined) {
    return null;
  }
  if (typeof readOnlyFile !== "string" || readOnlyFile.length === 0) {
    failClaudeAuthConfigPolicy(
      CLAUDE_AUTH_CONFIG_POLICY_REFUSAL_CODES.INVALID_PATH,
      "claude_auth_config_path_invalid",
      policyDetail(policyFacts, { [detailKey]: readOnlyFile })
    );
  }
  if (!policyFacts.allowedReadOnlyFiles.includes(readOnlyFile)) {
    failClaudeAuthConfigPolicy(
      CLAUDE_AUTH_CONFIG_POLICY_REFUSAL_CODES.INVALID_PATH,
      "claude_auth_config_path_invalid",
      policyDetail(policyFacts, { [detailKey]: readOnlyFile })
    );
  }
  return readOnlyFile;
}

function normalizeReadOnlyFileList(readOnlyFiles, policyFacts) {
  if (readOnlyFiles === null || readOnlyFiles === undefined) {
    return [];
  }
  if (!Array.isArray(readOnlyFiles)) {
    failClaudeAuthConfigPolicy(
      CLAUDE_AUTH_CONFIG_POLICY_REFUSAL_CODES.INVALID_INPUT,
      "claude_auth_config_policy_invalid_input",
      {
        readOnlyFiles,
        allowed_keys: Object.freeze([...CLAUDE_AUTH_CONFIG_ALLOWED_INPUT_KEYS])
      }
    );
  }
  const normalized = [];
  for (let index = 0; index < readOnlyFiles.length; index += 1) {
    const entry = normalizeReadOnlyFileInput(
      readOnlyFiles[index],
      `readOnlyFiles[${index}]`,
      policyFacts
    );
    if (entry !== null && !normalized.includes(entry)) {
      normalized.push(entry);
    }
  }
  return normalized;
}

function assertNoUnknownInputKeys(input) {
  const keys = Object.keys(input);
  const invalidKeys = keys.filter((key) => !CLAUDE_AUTH_CONFIG_ALLOWED_INPUT_KEYS.includes(key));
  if (invalidKeys.length > 0) {
    failClaudeAuthConfigPolicy(
      CLAUDE_AUTH_CONFIG_POLICY_REFUSAL_CODES.INVALID_INPUT,
      "claude_auth_config_policy_invalid_input",
      {
        invalid_keys: Object.freeze([...invalidKeys]),
        allowed_keys: Object.freeze([...CLAUDE_AUTH_CONFIG_ALLOWED_INPUT_KEYS]),
        received_keys: Object.freeze([...keys])
      }
    );
  }
}

export function assertClaudeAuthConfigReadOnlyFileAllowed(readOnlyFile, options = {}) {
  const policyFacts = resolveClaudeAuthConfigPolicyFactsOrThrow(options);
  return normalizeReadOnlyFileInput(readOnlyFile, "readOnlyFile", policyFacts);
}

export function buildClaudeAuthConfigHomePolicy(input = {}, options = {}) {
  if (!isPlainObject(input)) {
    failClaudeAuthConfigPolicy(
      CLAUDE_AUTH_CONFIG_POLICY_REFUSAL_CODES.INVALID_INPUT,
      "claude_auth_config_policy_invalid_input",
      {
        input,
        allowed_keys: Object.freeze([...CLAUDE_AUTH_CONFIG_ALLOWED_INPUT_KEYS])
      }
    );
  }
  assertNoUnknownInputKeys(input);

  const policyFacts = resolveClaudeAuthConfigPolicyFactsOrThrow(options);
  const normalized = [];
  const singleReadOnlyFile = normalizeReadOnlyFileInput(
    input.readOnlyFile,
    "readOnlyFile",
    policyFacts
  );
  if (singleReadOnlyFile !== null) {
    normalized.push(singleReadOnlyFile);
  }
  for (const readOnlyFile of normalizeReadOnlyFileList(input.readOnlyFiles, policyFacts)) {
    if (!normalized.includes(readOnlyFile)) {
      normalized.push(readOnlyFile);
    }
  }

  return Object.freeze({
    schema_version: CLAUDE_AUTH_CONFIG_POLICY_SCHEMA_VERSION,
    reads: Object.freeze(normalized)
  });
}
