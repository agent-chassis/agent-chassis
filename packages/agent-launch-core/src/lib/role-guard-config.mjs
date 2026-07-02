import path from "node:path";
import { readFile, realpath } from "node:fs/promises";
import {
  fail,
  isPlainObject,
  assertPlainObject,
  assertString,
  rejectUnknownKeys,
  validatePattern,
  normalizeRepoRelativePath,
  assertPathInside,
  validateTargetPayload
} from "./role-guard-path-policy.mjs";

export const ROLE_GUARD_SCHEMA_VERSION = 1;

export const ROLE_GUARD_ROLES = new Set([
  "orchestrator",
  "worker",
  "reviewer",
  "redteam",
  "operator",
  "unknown"
]);

const EFFECTIVE_ROLES = ["orchestrator", "worker", "reviewer", "unknown", "operator"];
const COMMAND_CATEGORIES = [
  "denied",
  "read_only",
  "runtime",
  "repo_mutating_bounded",
  "operator_reviewed_broad"
];
const COMMAND_ACTIONS = new Set([
  "deny",
  "allow",
  "allow_from_wk_frontmatter",
  "allow_with_operator_write_scope"
]);
const TARGET_REQUIREMENTS = new Set(["none", "trusted_targets", "static_targets"]);
const PACKAGE_MANAGER_EXECUTABLES = new Set(["npm", "pnpm", "yarn", "npx"]);

function validateCommandPattern(pattern, index) {
  assertPlainObject(pattern, `command_policy.patterns[${index}]`);
  rejectUnknownKeys(
    pattern,
    new Set(["argv", "category", "target_requirement", "expected_targets", "implementation_inputs", "install_state_manifest"]),
    `command_policy.patterns[${index}]`
  );
  if (!Array.isArray(pattern.argv) || pattern.argv.length === 0) {
    fail(`command_policy.patterns[${index}].argv must be a non-empty array`, "command_pattern_invalid");
  }
  for (const [tokenIndex, token] of pattern.argv.entries()) {
    if (typeof token !== "string" || token.length === 0) {
      fail(`command argv token ${tokenIndex} must be a non-empty string`, "command_pattern_invalid");
    }
    if (token !== "*" && token.includes("*")) {
      fail("substring wildcards are rejected in v1 command patterns", "command_pattern_invalid");
    }
  }
  if (!COMMAND_CATEGORIES.includes(pattern.category)) {
    fail(`Unsupported command category: ${pattern.category}`, "command_category_invalid");
  }
  const requirement = pattern.target_requirement ?? "none";
  if (!TARGET_REQUIREMENTS.has(requirement)) {
    fail(`Unsupported target_requirement: ${requirement}`, "target_requirement_invalid");
  }
  if (pattern.category === "repo_mutating_bounded" && requirement === "none") {
    fail("repo_mutating_bounded commands require trusted_targets or static_targets", "target_requirement_invalid");
  }
  if (pattern.category !== "repo_mutating_bounded" && requirement !== "none") {
    fail("only repo_mutating_bounded commands may require targets", "target_requirement_invalid");
  }
  if (requirement === "static_targets") {
    validateTargetPayload(pattern.expected_targets, {
      expectedSource: "repo_config_static",
      allowTestFixture: true
    });
    if (!Array.isArray(pattern.implementation_inputs) || pattern.implementation_inputs.length === 0) {
      fail("static_targets requires non-empty implementation_inputs", "implementation_inputs_missing");
    }
    for (const input of pattern.implementation_inputs) {
      if (!isPlainObject(input)) {
        fail("implementation_inputs entries must be objects with path and digest", "implementation_inputs_invalid");
      }
      normalizeRepoRelativePath(input.path, "implementation input path");
      if (!String(input.digest).startsWith("sha256:")) {
        fail("implementation input digest must use sha256:", "implementation_input_digest_invalid");
      }
    }
    if (PACKAGE_MANAGER_EXECUTABLES.has(path.basename(pattern.argv[0]))) {
      validateInstallStateManifest(pattern.install_state_manifest);
    }
  }
  if (requirement !== "static_targets" && pattern.expected_targets !== undefined) {
    fail("expected_targets is valid only with static_targets", "expected_targets_invalid");
  }
  return {
    ...pattern,
    target_requirement: requirement
  };
}

function validateInstallStateManifest(manifest) {
  assertPlainObject(manifest, "install_state_manifest");
  if (!["trusted_installer", "launcher_context", "package_manager_integrity"].includes(manifest.provenance)) {
    fail("install_state_manifest provenance is not trusted", "install_state_manifest_untrusted");
  }
  for (const field of [
    "lockfile_digest",
    "package_content_digest",
    "bin_shims_digest",
    "lifecycle_hooks_digest"
  ]) {
    if (!String(manifest[field]).startsWith("sha256:")) {
      fail(`install_state_manifest.${field} must use sha256:`, "install_state_manifest_invalid");
    }
  }
  assertString(manifest.package_manager, "install_state_manifest.package_manager");
  return manifest;
}

export function validateRoleGuardConfig(config) {
  assertPlainObject(config, "config");
  rejectUnknownKeys(
    config,
    new Set(["schema_version", "roles", "worker", "operator", "path_policy", "command_policy", "policies"]),
    "config"
  );
  if (config.schema_version !== ROLE_GUARD_SCHEMA_VERSION) {
    fail(`Unsupported role guard schema_version: ${config.schema_version}`, "schema_version_unsupported");
  }

  assertPlainObject(config.roles, "roles");
  assertPlainObject(config.roles.aliases, "roles.aliases");
  if (config.roles.aliases.redteam !== "reviewer") {
    fail('schema v1 requires roles.aliases.redteam === "reviewer"', "redteam_alias_invalid");
  }
  if (config.roles.derive_from_session_name !== undefined) {
    assertPlainObject(config.roles.derive_from_session_name, "roles.derive_from_session_name");
    if (config.roles.derive_from_session_name.trusted_source_required !== true) {
      fail("session-name derivation requires trusted_source_required: true", "session_name_trust_invalid");
    }
    if (!Array.isArray(config.roles.derive_from_session_name.rules)) {
      fail("session-name derivation rules must be an array", "session_name_rules_invalid");
    }
    for (const [index, rule] of config.roles.derive_from_session_name.rules.entries()) {
      assertPlainObject(rule, `session-name rule ${index}`);
      if (!ROLE_GUARD_ROLES.has(rule.role) || rule.role === "redteam" || rule.role === "unknown") {
        fail(`Invalid session-name derived role: ${rule.role}`, "session_name_role_invalid");
      }
      if (!Array.isArray(rule.patterns) || rule.patterns.length === 0) {
        fail("session-name rule patterns must be non-empty", "session_name_rules_invalid");
      }
      for (const rawPattern of rule.patterns) {
        try {
          new RegExp(rawPattern);
        } catch {
          fail(`Malformed session-name pattern: ${rawPattern}`, "session_name_pattern_invalid");
        }
      }
    }
  }

  assertPlainObject(config.worker, "worker");
  assertString(config.worker.wk_env, "worker.wk_env");
  assertString(config.worker.wk_id_pattern, "worker.wk_id_pattern");
  try {
    new RegExp(config.worker.wk_id_pattern);
  } catch {
    fail("worker.wk_id_pattern must be a valid regexp", "wk_pattern_invalid");
  }
  assertString(config.worker.issue_path_template, "worker.issue_path_template");
  if (!config.worker.issue_path_template.includes("{wk}")) {
    fail("worker.issue_path_template must include {wk}", "issue_path_template_invalid");
  }
  assertString(config.worker.write_scope_frontmatter_key, "worker.write_scope_frontmatter_key");
  if (config.worker.allow_wk_page_write !== undefined && typeof config.worker.allow_wk_page_write !== "boolean") {
    fail("worker.allow_wk_page_write must be boolean", "schema_invalid");
  }

  assertPlainObject(config.operator, "operator");
  assertString(config.operator.write_scope_env, "operator.write_scope_env");
  if (config.operator.write_scope_env_format !== "json_array") {
    fail("operator.write_scope_env_format must be json_array", "operator_scope_format_invalid");
  }

  assertPlainObject(config.path_policy, "path_policy");
  const denied = config.path_policy.deny ?? [];
  if (!Array.isArray(denied)) {
    fail("path_policy.deny must be an array", "path_policy_invalid");
  }
  const normalizedDenied = denied.map((entry) => validatePattern(entry, "path_policy.deny"));
  if (config.path_policy.reject_repo_wide_patterns !== true) {
    fail("path_policy.reject_repo_wide_patterns must be true in v1", "path_policy_invalid");
  }

  assertPlainObject(config.command_policy, "command_policy");
  if (JSON.stringify(config.command_policy.categories) !== JSON.stringify(COMMAND_CATEGORIES)) {
    fail("command_policy.categories must exactly match the v1 enum", "command_categories_invalid");
  }
  if (!Array.isArray(config.command_policy.patterns)) {
    fail("command_policy.patterns must be an array", "command_patterns_invalid");
  }
  const patterns = config.command_policy.patterns.map(validateCommandPattern);
  if (config.command_policy.default_category !== undefined && !COMMAND_CATEGORIES.includes(config.command_policy.default_category)) {
    fail("command_policy.default_category is invalid", "command_category_invalid");
  }
  if (config.command_policy.environment_pins !== undefined) {
    assertPlainObject(config.command_policy.environment_pins, "command_policy.environment_pins");
  }

  assertPlainObject(config.policies, "policies");
  if ("redteam" in config.policies) {
    fail("schema v1 rejects policies.redteam; redteam normalizes to reviewer", "redteam_policy_invalid");
  }
  for (const role of EFFECTIVE_ROLES) {
    assertPlainObject(config.policies[role], `policies.${role}`);
    assertPlainObject(config.policies[role].write, `policies.${role}.write`);
    assertPlainObject(config.policies[role].commands, `policies.${role}.commands`);
    for (const key of Object.keys(config.policies[role].commands)) {
      if (!["default", ...COMMAND_CATEGORIES].includes(key)) {
        fail(`Unsupported command policy key: ${key}`, "command_policy_key_invalid");
      }
      if (!COMMAND_ACTIONS.has(config.policies[role].commands[key])) {
        fail(`Unsupported command policy action: ${config.policies[role].commands[key]}`, "command_policy_action_invalid");
      }
      if (config.policies[role].commands[key] === "allow_from_wk_frontmatter" && !(role === "worker" && key === "runtime")) {
        fail("allow_from_wk_frontmatter is valid only for worker runtime", "command_policy_action_invalid");
      }
      if (config.policies[role].commands[key] === "allow_with_operator_write_scope" && key !== "repo_mutating_bounded") {
        fail("allow_with_operator_write_scope is valid only for repo_mutating_bounded", "command_policy_action_invalid");
      }
    }
    const write = config.policies[role].write;
    if (Array.isArray(write.allow)) {
      write.allow = write.allow.map((entry) => validatePattern(entry, `policies.${role}.write.allow`));
    }
  }

  return {
    ...config,
    path_policy: {
      ...config.path_policy,
      deny: normalizedDenied
    },
    command_policy: {
      ...config.command_policy,
      patterns,
      default_category: config.command_policy.default_category ?? "denied"
    }
  };
}

export async function loadRoleGuardConfig({ repoRoot, configPath = ".agent-role-guard.json", fixtureConfig, allowTestFixture = false } = {}) {
  if (fixtureConfig !== undefined) {
    if (!allowTestFixture) {
      fail("built-in or supplied fixtures are test-only", "test_fixture_rejected");
    }
    return validateRoleGuardConfig(fixtureConfig);
  }
  assertString(repoRoot, "repoRoot");
  assertString(configPath, "configPath");
  const root = await realpath(repoRoot);
  const relativeConfig = normalizeRepoRelativePath(configPath, "configPath");
  const resolvedConfig = path.resolve(root, relativeConfig);
  assertPathInside(root, resolvedConfig, "configPath");
  let parsed;
  try {
    parsed = JSON.parse(await readFile(resolvedConfig, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail("role guard config is missing", "config_missing");
    }
    throw error;
  }
  return validateRoleGuardConfig(parsed);
}
