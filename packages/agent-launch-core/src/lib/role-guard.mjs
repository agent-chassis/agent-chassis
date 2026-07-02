import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";

import {
  RoleGuardError,
  fail,
  assertPlainObject,
  assertString,
  rejectUnknownKeys,
  validatePattern,
  normalizeRepoRelativePath,
  assertPathInside,
  globToRegExp,
  scopeAllowsPath,
  normalizeAndValidateEvaluatedPaths,
  validateTargetPayload
} from "./role-guard-path-policy.mjs";
import {
  normalizeSource,
  assertKnownCaller,
  sourceMayGrantRole,
  sourceMayGrantWk,
  sourceMayGrantOperatorScope,
  hasTrustedLauncherContext,
  hasTrustedAdapterContext
} from "./role-guard-provenance.mjs";
import {
  ROLE_GUARD_SCHEMA_VERSION,
  ROLE_GUARD_ROLES,
  validateRoleGuardConfig
} from "./role-guard-config.mjs";

export {
  RoleGuardError,
  validateTargetPayload
} from "./role-guard-path-policy.mjs";
export {
  ROLE_GUARD_CALLERS,
  ROLE_GUARD_SOURCES,
  ROLE_GUARD_LAUNCHER_AUTHORITY,
  ROLE_GUARD_OPERATOR_CONFIG_AUTHORITY,
  ROLE_GUARD_ADAPTER_AUTHORITY
} from "./role-guard-provenance.mjs";
export {
  ROLE_GUARD_SCHEMA_VERSION,
  ROLE_GUARD_ROLES,
  validateRoleGuardConfig,
  loadRoleGuardConfig
} from "./role-guard-config.mjs";
export {
  canonicalizeJson,
  canonicalizeLauncherContext,
  signLauncherContext,
  verifyLauncherContext
} from "./role-guard-launcher-context.mjs";

const BEHAVIOR_AFFECTING_ENV = [
  "NODE_OPTIONS",
  "npm_config_script_shell",
  "BASH_ENV",
  "PYTHONPATH",
  "HOME",
  "XDG_CONFIG_HOME"
];

function normalizeEffectiveRole(role) {
  return role === "redteam" ? "reviewer" : role;
}

export function resolveAgentRole({ config, provenance = {}, allowTestFixture = false } = {}) {
  const normalizedConfig = validateRoleGuardConfig(config);
  const caller = provenance.caller ?? "shell_wrapper";
  assertKnownCaller(caller, { allowTestFixture });
  const roleEvidence = normalizeSource(provenance.role, "role");
  const sessionEvidence = normalizeSource(provenance.session_name, "session_name");

  let explicitRole = null;
  if (roleEvidence.value !== null) {
    if (!ROLE_GUARD_ROLES.has(roleEvidence.value)) {
      fail(`Unsupported role: ${roleEvidence.value}`, "role_invalid");
    }
    if (!sourceMayGrantRole(roleEvidence.source, { ...provenance, caller }, { allowTestFixture })) {
      fail(`Source ${roleEvidence.source} may not grant role`, "role_source_untrusted");
    }
    explicitRole = roleEvidence.value;
  }

  let derivedRole = null;
  const derivation = normalizedConfig.roles.derive_from_session_name;
  if (sessionEvidence.value && derivation) {
    if (!sourceMayGrantRole(sessionEvidence.source, { ...provenance, caller, session_name: sessionEvidence }, { allowTestFixture })) {
      fail("session-name role derivation requires trusted launcher evidence", "session_name_source_untrusted");
    }
    const matches = [];
    for (const rule of derivation.rules) {
      if (rule.patterns.some((rawPattern) => new RegExp(rawPattern).test(sessionEvidence.value))) {
        matches.push(rule.role);
      }
    }
    const unique = [...new Set(matches)];
    if (unique.length > 1) {
      fail("session-name role derivation is ambiguous", "role_ambiguous");
    }
    derivedRole = unique[0] ?? null;
  }

  if (explicitRole && derivedRole && normalizeEffectiveRole(explicitRole) !== normalizeEffectiveRole(derivedRole)) {
    fail("explicit and derived role evidence conflict", "role_conflict");
  }
  const role = explicitRole ?? derivedRole ?? "unknown";
  return {
    role,
    effective_role: normalizeEffectiveRole(role),
    role_source: explicitRole ? roleEvidence.source : derivedRole ? sessionEvidence.source : "absent"
  };
}

function parseFrontmatterValue(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    return inner ? inner.split(",").map((part) => part.trim()).filter(Boolean) : [];
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  return trimmed;
}

export function parseIssueFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return {};
  }
  const result = {};
  let currentKey = null;
  for (const line of match[1].split("\n")) {
    if (!line.trim()) {
      continue;
    }
    if (line.trimStart().startsWith("#")) {
      continue;
    }
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(result[currentKey])) {
        result[currentKey] = [];
      }
      result[currentKey].push(parseFrontmatterValue(listMatch[1]));
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      fail(`Invalid issue frontmatter line: ${line}`, "wk_frontmatter_invalid");
    }
    const key = line.slice(0, separator).trim();
    const raw = line.slice(separator + 1);
    if (raw.trim() === "") {
      result[key] = [];
      currentKey = key;
    } else {
      result[key] = parseFrontmatterValue(raw);
      currentKey = key;
    }
  }
  return result;
}

export async function readWorkerScope({ repoRoot, config, wkId } = {}) {
  const normalizedConfig = validateRoleGuardConfig(config);
  const pattern = new RegExp(normalizedConfig.worker.wk_id_pattern);
  if (!pattern.test(wkId)) {
    fail("worker WK id is invalid", "wk_invalid");
  }
  const root = await realpath(repoRoot);
  const issuePath = normalizeRepoRelativePath(
    normalizedConfig.worker.issue_path_template.replace("{wk}", wkId),
    "worker issue path"
  );
  const absoluteIssuePath = path.resolve(root, issuePath);
  assertPathInside(root, absoluteIssuePath, "worker issue path");
  const frontmatter = parseIssueFrontmatter(await readFile(absoluteIssuePath, "utf8"));
  const rawScope = frontmatter[normalizedConfig.worker.write_scope_frontmatter_key];
  if (!Array.isArray(rawScope) || rawScope.length === 0) {
    fail("worker issue write_scope is missing or empty", "worker_scope_missing");
  }
  return {
    wk_id: wkId,
    issue_path: issuePath,
    write_scope: rawScope.map((entry) => validatePattern(entry, "worker write_scope")),
    runtime_command_policy: frontmatter[normalizedConfig.worker.runtime_command_frontmatter_key] ?? null,
    frontmatter
  };
}

function normalizeOperatorScope(value) {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((entry) => validatePattern(entry, "operator write scope"));
  }
  if (typeof value === "string") {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      fail("operator write scope must be a JSON array", "operator_scope_invalid");
    }
    if (!Array.isArray(parsed)) {
      fail("operator write scope must be a JSON array", "operator_scope_invalid");
    }
    return parsed.map((entry) => validatePattern(entry, "operator write scope"));
  }
  fail("operator write scope must be a JSON array", "operator_scope_invalid");
}

function commandPolicyEffect(config, roleContext, category) {
  const policy = config.policies[roleContext.effective_role]?.commands;
  if (!policy) {
    fail(`Missing command policy for role ${roleContext.effective_role}`, "policy_missing");
  }
  return policy[category] ?? policy.default ?? "deny";
}

function normalizedCommandArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((token) => typeof token !== "string" || token.length === 0)) {
    fail("command argv must be a non-empty string array", "command_argv_invalid");
  }
  return [path.basename(argv[0]), ...argv.slice(1)];
}

function patternMatches(pattern, argv) {
  if (pattern.argv.length !== argv.length) {
    return false;
  }
  return pattern.argv.every((token, index) => token === "*" || token === argv[index]);
}

function runtimeCommandPolicyAllows(policy, normalizedArgv) {
  const entries = Array.isArray(policy)
    ? policy
    : typeof policy === "string"
      ? [policy]
      : [];
  return entries.some((entry) => {
    if (typeof entry !== "string") {
      return false;
    }
    const argv = entry.trim().split(/\s+/).filter(Boolean);
    if (argv.length === 0) {
      return false;
    }
    return patternMatches({ argv }, normalizedArgv);
  });
}

function effectKey(config, roleContext, pattern) {
  return JSON.stringify({
    category: pattern.category,
    target_requirement: pattern.target_requirement,
    expected_targets: pattern.expected_targets ?? null,
    policy_effect: commandPolicyEffect(config, roleContext, pattern.category)
  });
}

export function classifyCommand({ config, roleContext, argv } = {}) {
  const normalizedConfig = validateRoleGuardConfig(config);
  const normalizedArgv = normalizedCommandArgv(argv);
  const matches = normalizedConfig.command_policy.patterns.filter((pattern) => patternMatches(pattern, normalizedArgv));
  if (matches.length === 0) {
    return {
      category: normalizedConfig.command_policy.default_category,
      target_requirement: "none",
      matched_patterns: [],
      normalized_argv: normalizedArgv
    };
  }
  const keys = new Set(matches.map((pattern) => effectKey(normalizedConfig, roleContext, pattern)));
  if (keys.size > 1) {
    fail("command pattern matches are ambiguous", "command_pattern_ambiguous");
  }
  const [match] = matches;
  return {
    category: match.category,
    target_requirement: match.target_requirement,
    expected_targets: match.expected_targets ?? null,
    implementation_inputs: match.implementation_inputs ?? [],
    matched_patterns: matches.map((pattern) => pattern.argv),
    normalized_argv: normalizedArgv
  };
}

function validateCommandExecutionProof(proof, argv, config, { provenance = {}, allowTestFixture = false } = {}) {
  assertPlainObject(proof, "command execution proof");
  rejectUnknownKeys(
    proof,
    new Set(["executable", "spawn", "environment"]),
    "command execution proof"
  );
  if (!allowTestFixture && !hasTrustedAdapterContext(proof, provenance)) {
    fail("command execution proof requires trusted adapter or launcher authority", "execution_proof_untrusted");
  }
  assertPlainObject(proof.executable, "command execution proof executable");
  rejectUnknownKeys(
    proof.executable,
    new Set(["resolved_realpath", "digest", "resolution_inputs_digest"]),
    "command execution proof executable"
  );
  assertString(proof.executable.resolved_realpath, "executable.resolved_realpath");
  if (!String(proof.executable.digest).startsWith("sha256:")) {
    fail("executable.digest must use sha256:", "executable_identity_missing");
  }
  assertString(proof.executable.resolution_inputs_digest, "executable.resolution_inputs_digest");
  assertPlainObject(proof.spawn, "command execution proof spawn");
  rejectUnknownKeys(
    proof.spawn,
    new Set(["shell_mode", "cwd", "raw_argv", "resolved_argv0"]),
    "command execution proof spawn"
  );
  if (proof.spawn.shell_mode !== false) {
    fail("v1 command proof requires shell_mode: false", "spawn_primitive_invalid");
  }
  if (JSON.stringify(proof.spawn.raw_argv) !== JSON.stringify(argv)) {
    fail("spawn raw_argv does not match command argv", "spawn_primitive_mismatch");
  }
  assertString(proof.spawn.cwd, "spawn.cwd");
  assertString(proof.spawn.resolved_argv0, "spawn.resolved_argv0");
  assertPlainObject(proof.environment, "command execution proof environment");
  rejectUnknownKeys(
    proof.environment,
    new Set(["mode", "digest", "variables"]),
    "command execution proof environment"
  );
  if (proof.environment.mode !== "closed") {
    fail("command environment must be closed", "environment_policy_invalid");
  }
  assertString(proof.environment.digest, "environment.digest");
  const variables = proof.environment.variables ?? {};
  assertPlainObject(variables, "environment.variables");
  const pins = config.command_policy.environment_pins ?? {};
  for (const key of Object.keys(variables)) {
    if (BEHAVIOR_AFFECTING_ENV.includes(key) || key.startsWith("GIT_CONFIG_")) {
      if (!(key in pins) || pins[key] !== variables[key]) {
        fail(`behavior-affecting env var is not pinned: ${key}`, "environment_variable_unpinned");
      }
    }
  }
}

async function verifyImplementationInputs({ repoRoot, inputs }) {
  const root = await realpath(repoRoot);
  for (const input of inputs) {
    const relativePath = normalizeRepoRelativePath(input.path, "implementation input path");
    const absolutePath = path.resolve(root, relativePath);
    assertPathInside(root, absolutePath, "implementation input path");
    const digest = `sha256:${createHash("sha256").update(await readFile(absolutePath)).digest("hex")}`;
    if (digest !== input.digest) {
      fail(`implementation input digest mismatch: ${relativePath}`, "implementation_input_digest_mismatch");
    }
  }
}

function validateTrustedTargetProof(proof, { provenance = {}, allowTestFixture = false } = {}) {
  assertPlainObject(proof, "trusted_target_proof");
  rejectUnknownKeys(
    proof,
    new Set([
      "adapter_id",
      "capability_id",
      "containment_mode",
      "bounded_write_primitive_id",
      "ledger_digest",
      "observed_write_set"
    ]),
    "trusted_target_proof"
  );
  if (!allowTestFixture && !hasTrustedAdapterContext(proof, provenance)) {
    fail("trusted target proof requires trusted adapter or launcher authority", "trusted_target_proof_untrusted");
  }
  assertString(proof.adapter_id, "trusted_target_proof.adapter_id");
  assertString(proof.capability_id, "trusted_target_proof.capability_id");
  if (!["bounded_write_primitive", "write_ledger"].includes(proof.containment_mode)) {
    fail("trusted_target_proof.containment_mode is invalid", "trusted_target_proof_invalid");
  }
  if (proof.containment_mode === "bounded_write_primitive") {
    assertString(proof.bounded_write_primitive_id, "trusted_target_proof.bounded_write_primitive_id");
  }
  if (proof.containment_mode === "write_ledger") {
    assertString(proof.ledger_digest, "trusted_target_proof.ledger_digest");
    if (!Array.isArray(proof.observed_write_set) || proof.observed_write_set.length === 0) {
      fail("write_ledger proof requires observed_write_set", "trusted_target_proof_invalid");
    }
  }
}

export async function evaluateRoleGuardAction({
  config,
  repoRoot,
  provenance = {},
  action,
  workerScope = null,
  allowTestFixture = false
} = {}) {
  const normalizedConfig = validateRoleGuardConfig(config);
  assertPlainObject(action, "action");
  const caller = provenance.caller ?? "shell_wrapper";
  assertKnownCaller(caller, { allowTestFixture });
  const callerProvenance = { ...provenance, caller };
  const roleContext = resolveAgentRole({ config: normalizedConfig, provenance: callerProvenance, allowTestFixture });
  const targetDecisions = [];
  let category = "denied";

  const resolveWorkerScopeForAction = async () => {
    const wkEvidence = normalizeSource(provenance.wk, "wk");
    if (!sourceMayGrantWk(wkEvidence.source, callerProvenance, { allowTestFixture })) {
      fail("worker WK source is not trusted", "wk_source_untrusted");
    }
    return workerScope ?? await readWorkerScope({ repoRoot, config: normalizedConfig, wkId: wkEvidence.value });
  };

  const resolveOperatorScopeForAction = () => {
    const scopeEvidence = normalizeSource(provenance.operator_write_scope, "operator_write_scope");
    if (!sourceMayGrantOperatorScope(scopeEvidence.source, callerProvenance, { allowTestFixture })) {
      fail("operator write scope is not trusted", "operator_scope_untrusted");
    }
    const patterns = normalizeOperatorScope(scopeEvidence.value);
    if (patterns.length === 0) {
      fail("operator write scope is absent or empty", "operator_scope_missing");
    }
    return patterns;
  };

  const assertTargetsWithinOperatorScope = (operatorScope, paths) => {
    if (operatorScope && !paths.every((pathValue) => scopeAllowsPath(operatorScope, pathValue))) {
      fail("repo-mutating command target is outside operator write scope", "operator_scope_denied");
    }
  };

  const recordAllowedTargets = (paths, matchedRule) => {
    targetDecisions.push(...paths.map((pathValue) => ({ path: pathValue, allowed: true, matched_rules: [matchedRule] })));
  };

  const deny = (code, reason) => ({
    schema_version: ROLE_GUARD_SCHEMA_VERSION,
    allowed: false,
    decision_code: code,
    reason,
    category,
    role: roleContext.role,
    effective_role: roleContext.effective_role,
    role_source: roleContext.role_source,
    action: action.type,
    targets: targetDecisions
  });
  const allow = (code = "allowed") => ({
    schema_version: ROLE_GUARD_SCHEMA_VERSION,
    allowed: true,
    decision_code: code,
    category,
    role: roleContext.role,
    effective_role: roleContext.effective_role,
    role_source: roleContext.role_source,
    action: action.type,
    targets: targetDecisions
  });

  try {
    if (action.type === "check-write" || action.type === "check-diff") {
      const rawPaths = action.type === "check-write"
        ? action.paths
        : validateTargetPayload(action.target_payload, { allowTestFixture }).evaluated_paths;
      if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
        return deny("targets_missing", "write action requires targets");
      }
      const paths = await normalizeAndValidateEvaluatedPaths({ repoRoot, config: normalizedConfig, paths: rawPaths });
      let allowedPatterns = [];
      if (roleContext.effective_role === "worker") {
        const scope = await resolveWorkerScopeForAction();
        allowedPatterns = [...scope.write_scope];
        if (normalizedConfig.worker.allow_wk_page_write) {
          allowedPatterns.push(scope.issue_path);
        }
      } else if (roleContext.effective_role === "orchestrator") {
        allowedPatterns = normalizedConfig.policies.orchestrator.write.allow ?? [];
      } else if (roleContext.effective_role === "operator") {
        allowedPatterns = resolveOperatorScopeForAction();
      } else {
        return deny("role_read_only", "role is read-only");
      }
      for (const pathValue of paths) {
        const targetAllowed = scopeAllowsPath(allowedPatterns, pathValue);
        targetDecisions.push({
          path: pathValue,
          allowed: targetAllowed,
          matched_rules: targetAllowed ? allowedPatterns.filter((pattern) => globToRegExp(pattern).test(pathValue)) : []
        });
      }
      return targetDecisions.every((target) => target.allowed)
        ? allow("write_allowed")
        : deny("write_scope_denied", "one or more targets are outside write scope");
    }

    if (action.type === "check-command") {
      const classification = classifyCommand({ config: normalizedConfig, roleContext, argv: action.argv });
      category = classification.category;
      if (category === "denied" || category === "operator_reviewed_broad") {
        return deny("command_denied", "command category denies execution");
      }
      validateCommandExecutionProof(action.execution_proof, action.argv, normalizedConfig, {
        provenance: callerProvenance,
        allowTestFixture
      });
      const effect = commandPolicyEffect(normalizedConfig, roleContext, category);
      if (effect === "deny") {
        return deny("command_policy_denied", "role policy denies command category");
      }
      if (effect === "allow_from_wk_frontmatter") {
        const scope = await resolveWorkerScopeForAction();
        if (!scope.runtime_command_policy) {
          return deny("wk_runtime_policy_missing", "worker runtime command policy is missing");
        }
        if (!runtimeCommandPolicyAllows(scope.runtime_command_policy, classification.normalized_argv)) {
          return deny("wk_runtime_policy_denied", "worker runtime command policy does not allow argv");
        }
      }
      let operatorScope = null;
      if (effect === "allow_with_operator_write_scope") {
        operatorScope = resolveOperatorScopeForAction();
      }
      if (classification.target_requirement === "static_targets") {
        await verifyImplementationInputs({
          repoRoot,
          inputs: classification.implementation_inputs
        });
        const payload = validateTargetPayload(classification.expected_targets, {
          expectedSource: "repo_config_static",
          allowTestFixture
        });
        const paths = await normalizeAndValidateEvaluatedPaths({
          repoRoot,
          config: normalizedConfig,
          paths: payload.evaluated_paths
        });
        assertTargetsWithinOperatorScope(operatorScope, paths);
        recordAllowedTargets(paths, "repo_config_static");
      } else if (classification.target_requirement === "trusted_targets") {
        const payload = validateTargetPayload(action.target_payload, { allowTestFixture });
        if (payload.target_source === "user_supplied" || payload.target_source === "model_supplied") {
          return deny("target_source_untrusted", "user/model target lists cannot authorize repo-mutating commands");
        }
        if (payload.target_source === "repo_config_static") {
          return deny("target_source_untrusted", "payload-supplied repo_config_static targets reject");
        }
        if (payload.target_source === "launcher_metadata" && !hasTrustedLauncherContext(callerProvenance)) {
          return deny("target_source_untrusted", "launcher_metadata targets require verified launcher context");
        }
        validateTrustedTargetProof(payload.trusted_target_proof, {
          provenance: callerProvenance,
          allowTestFixture
        });
        const paths = await normalizeAndValidateEvaluatedPaths({
          repoRoot,
          config: normalizedConfig,
          paths: payload.evaluated_paths
        });
        assertTargetsWithinOperatorScope(operatorScope, paths);
        recordAllowedTargets(paths, payload.target_source);
      }
      return allow("command_allowed");
    }
  } catch (error) {
    if (error instanceof RoleGuardError) {
      return deny(error.code, error.message);
    }
    throw error;
  }

  return deny("action_type_unsupported", `Unsupported action type: ${action.type}`);
}

export function formatRoleGuardDecision(decision) {
  return {
    schema_version: ROLE_GUARD_SCHEMA_VERSION,
    allowed: Boolean(decision.allowed),
    decision_code: decision.decision_code,
    category: decision.category ?? "denied",
    role: decision.role ?? "unknown",
    role_source: decision.role_source ?? "absent",
    action: decision.action ?? null,
    config_source: decision.config_source ?? null,
    targets: decision.targets ?? [],
    reason: decision.reason ?? null
  };
}
