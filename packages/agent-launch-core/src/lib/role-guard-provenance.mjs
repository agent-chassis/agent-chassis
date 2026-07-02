import { isPlainObject, fail } from "./role-guard-path-policy.mjs";

export const ROLE_GUARD_CALLERS = new Set([
  "agent_launch",
  "codex_hook",
  "claude_hook",
  "shell_wrapper",
  "repo_script",
  "test_fixture"
]);

export const ROLE_GUARD_SOURCES = new Set([
  "launcher_metadata",
  "launcher_env",
  "operator_config",
  "repo_config",
  "wk_frontmatter",
  "ambient_env",
  "session_name",
  "absent",
  "test_fixture"
]);

export const ROLE_GUARD_LAUNCHER_AUTHORITY = Symbol("role_guard_launcher_authority");
export const ROLE_GUARD_OPERATOR_CONFIG_AUTHORITY = Symbol("role_guard_operator_config_authority");
export const ROLE_GUARD_ADAPTER_AUTHORITY = Symbol("role_guard_adapter_authority");

export function normalizeSource(value, name) {
  if (!isPlainObject(value)) {
    return { value: null, source: "absent" };
  }
  const source = value.source ?? "absent";
  if (!ROLE_GUARD_SOURCES.has(source)) {
    fail(`Unsupported ${name} source: ${source}`, "provenance_source_invalid");
  }
  return {
    value: value.value ?? null,
    source,
    trusted: Boolean(value.trusted)
  };
}

export function assertKnownCaller(caller, { allowTestFixture = false } = {}) {
  if (!ROLE_GUARD_CALLERS.has(caller)) {
    fail(`Unsupported caller: ${caller}`, "provenance_caller_invalid");
  }
  if (caller === "test_fixture" && !allowTestFixture) {
    fail("test_fixture caller is test-only", "test_fixture_rejected");
  }
}

export function hasTrustedLauncherContext(provenance) {
  return provenance?.[ROLE_GUARD_LAUNCHER_AUTHORITY] === true;
}

export function hasTrustedOperatorConfigContext(provenance) {
  return hasTrustedLauncherContext(provenance) || provenance?.[ROLE_GUARD_OPERATOR_CONFIG_AUTHORITY] === true;
}

export function hasTrustedAdapterContext(proof, provenance) {
  return proof?.[ROLE_GUARD_ADAPTER_AUTHORITY] === true;
}

export function launcherSourceMayGrant(source, provenance) {
  if (source === "launcher_metadata") {
    return hasTrustedLauncherContext(provenance);
  }
  if (source === "launcher_env") {
    return provenance?.caller === "agent_launch" && hasTrustedLauncherContext(provenance);
  }
  return false;
}

export function sourceMayGrantRole(source, provenance, { allowTestFixture = false } = {}) {
  if (source === "session_name") {
    return Boolean(provenance?.session_name?.trusted) && hasTrustedLauncherContext(provenance);
  }
  if (source === "test_fixture") {
    return allowTestFixture;
  }
  return launcherSourceMayGrant(source, provenance);
}

export function sourceMayGrantWk(source, provenance, { allowTestFixture = false } = {}) {
  if (source === "test_fixture") {
    return allowTestFixture;
  }
  return launcherSourceMayGrant(source, provenance);
}

export function sourceMayGrantOperatorScope(source, provenance, { allowTestFixture = false } = {}) {
  if (source === "operator_config") {
    return allowTestFixture || hasTrustedOperatorConfigContext(provenance);
  }
  if (source === "test_fixture") {
    return allowTestFixture;
  }
  return false;
}
