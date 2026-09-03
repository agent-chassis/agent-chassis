

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  cloneJson,
  hasOwn,
  isObject,
  isNonEmptyString,
  TOOL_DISCOVERY_FRAGMENT_DIR,
  TOOL_DISCOVERY_AUDIENCE_VALUES,
  TOOL_DISCOVERY_TIER_VISIBILITY_VALUES,
  TOOL_DISCOVERY_TIER_TEXT_FIELDS
} from "./descriptor.mjs";

export const SESSION_ROLE_TOOL_ACCESS_POLICY_FILENAME = "session-role-tool-access.json";
export const SESSION_ROLE_TOOL_ACCESS_POLICY_PATH = path.join(
  TOOL_DISCOVERY_FRAGMENT_DIR,
  SESSION_ROLE_TOOL_ACCESS_POLICY_FILENAME
);
export const SESSION_ROLE_TOOL_ACCESS_POLICY_RELATIVE_PATH =
  "packages/wiki-core/data/tool-discovery/session-role-tool-access.json";
export const SESSION_ROLE_TOOL_ACCESS_POLICY_SCHEMA_VERSION =
  "session-role-tool-access.v2";
export const SESSION_ROLE_TOOL_ACCESS_POLICY_KIND =
  "session-role-tool-access-policy";

export const SESSION_ROLE_TOOL_DISPOSITIONS = Object.freeze({
  DIRECT: "direct",
  CLOSED_TYPED_FRONT_DOOR: "closed_typed_front_door",
  SERVER_ISSUED_CONTINUATION: "server_issued_continuation",
  OPERATOR_RECOVERY_ONLY: "operator_recovery_only",
  OUTSIDE_CURRENT_CONTRACT: "outside_current_contract"
});
export const SESSION_ROLE_TOOL_DISPOSITION_VALUES = Object.freeze(
  Object.values(SESSION_ROLE_TOOL_DISPOSITIONS)
);

function policyDiagnostic(code, message) {
  return Object.freeze({
    code,
    level: "error",
    message: `${SESSION_ROLE_TOOL_ACCESS_POLICY_RELATIVE_PATH}: ${message}`,
    path: SESSION_ROLE_TOOL_ACCESS_POLICY_RELATIVE_PATH
  });
}

export class SessionRoleToolAccessPolicyError extends Error {
  constructor(diagnostics) {
    const normalized = Array.isArray(diagnostics) ? diagnostics : [];
    super(normalized.map((diagnostic) => diagnostic.message).join("; ") ||
      `${SESSION_ROLE_TOOL_ACCESS_POLICY_RELATIVE_PATH}: invalid required policy`);
    this.name = "SessionRoleToolAccessPolicyError";
    this.code = normalized[0]?.code ?? "session_role_policy_invalid";
    this.diagnostics = Object.freeze(normalized.slice());
  }
}

export function validateSessionRoleToolAccessPolicy(policy) {
  const diagnostics = [];
  if (!isObject(policy)) {
    diagnostics.push(policyDiagnostic(
      "session_role_policy_invalid_shape",
      "central role->tool access policy must be a JSON object"
    ));
    return diagnostics;
  }
  if (policy.schema_version !== SESSION_ROLE_TOOL_ACCESS_POLICY_SCHEMA_VERSION) {
    diagnostics.push(policyDiagnostic(
      "session_role_policy_incompatible_schema_version",
      `schema_version must be ${SESSION_ROLE_TOOL_ACCESS_POLICY_SCHEMA_VERSION}`
    ));
  }
  if (policy.kind !== SESSION_ROLE_TOOL_ACCESS_POLICY_KIND) {
    diagnostics.push(policyDiagnostic(
      "session_role_policy_invalid_kind",
      `kind must be ${SESSION_ROLE_TOOL_ACCESS_POLICY_KIND}`
    ));
  }
  if (!Array.isArray(policy.roles)) {
    diagnostics.push(policyDiagnostic(
      "session_role_policy_invalid_roles",
      "roles must be an array"
    ));
  } else {
    policy.roles.forEach((role, index) => {
      if (!isNonEmptyString(role)) {
        diagnostics.push(policyDiagnostic(
          "session_role_policy_invalid_role_entry",
          `roles[${index}] must be a non-empty string`
        ));
      }
    });
  }
  if (!isObject(policy.access)) {
    diagnostics.push(policyDiagnostic(
      "session_role_policy_missing_access",
      "policy must declare an 'access' object mapping each tool name to role grants"
    ));
  } else {
    for (const [toolName, roles] of Object.entries(policy.access)) {
      if (!isNonEmptyString(toolName)) {
        diagnostics.push(policyDiagnostic(
          "session_role_policy_invalid_tool_name",
          "access keys must be non-empty operation names"
        ));
      }
      if (!Array.isArray(roles)) {
        diagnostics.push(policyDiagnostic(
          "session_role_policy_invalid_grant_list",
          `operation '${toolName}' must map to an array of session roles`
        ));
        continue;
      }
      roles.forEach((role, index) => {
        if (!isNonEmptyString(role)) {
          diagnostics.push(policyDiagnostic(
            "session_role_policy_invalid_grant_entry",
            `operation '${toolName}' access[${index}] must be a non-empty role string`
          ));
        }
      });
    }
  }
  if (!isObject(policy.dispositions)) {
    diagnostics.push(policyDiagnostic(
      "session_role_policy_missing_dispositions",
      "policy must declare a 'dispositions' object mapping each classified operation to exactly one disposition"
    ));
  } else {
    for (const [toolName, dispositions] of Object.entries(policy.dispositions)) {
      if (!isNonEmptyString(toolName)) {
        diagnostics.push(policyDiagnostic(
          "session_role_policy_invalid_tool_name",
          "disposition keys must be non-empty operation names"
        ));
      }
      if (!Array.isArray(dispositions)) {
        diagnostics.push(policyDiagnostic(
          "session_role_policy_invalid_disposition_list",
          `operation '${toolName}' must map to an array containing exactly one disposition`
        ));
        continue;
      }
      if (dispositions.length !== 1) {
        diagnostics.push(policyDiagnostic(
          "session_role_policy_invalid_disposition_count",
          `operation '${toolName}' must have exactly one disposition; found ${dispositions.length}`
        ));
        continue;
      }
      if (!SESSION_ROLE_TOOL_DISPOSITION_VALUES.includes(dispositions[0])) {
        diagnostics.push(policyDiagnostic(
          "session_role_policy_unknown_disposition",
          `operation '${toolName}' has unknown disposition '${String(dispositions[0])}'`
        ));
      }
    }
  }
  return diagnostics;
}

export function assertValidSessionRoleToolAccessPolicy(policy) {
  const diagnostics = validateSessionRoleToolAccessPolicy(policy);
  if (diagnostics.length > 0) {
    throw new SessionRoleToolAccessPolicyError(diagnostics);
  }
  return policy;
}

export async function loadSessionRoleToolAccessPolicy({ readPolicyFile = readFile } = {}) {
  let raw;
  try {
    raw = await readPolicyFile(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH, "utf8");
  } catch (error) {
    const code = error?.code === "ENOENT"
      ? "session_role_policy_required_file_absent"
      : "session_role_policy_required_file_unreadable";
    const detail = error instanceof Error ? error.message : String(error);
    return {
      policy: null,
      diagnostics: [policyDiagnostic(code, `required policy cannot be read: ${detail}`)]
    };
  }

  let policy;
  try {
    policy = JSON.parse(raw);
  } catch (error) {
    return {
      policy: null,
      diagnostics: [policyDiagnostic(
        "session_role_policy_invalid_json",
        `required policy is not valid JSON: ${error.message}`
      )]
    };
  }

  const diagnostics = validateSessionRoleToolAccessPolicy(policy);
  return { policy, diagnostics };
}

export const TOOL_DISCOVERY_DEFAULT_AUDIENCE = Object.freeze(["agent", "operator"]);
export const TOOL_DISCOVERY_DEFAULT_TIER_VISIBILITY = Object.freeze([]);
export const TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL = "free_local";
export const TOOL_DISCOVERY_REGISTERED_TIER_PAID_CCE = "paid_cce";

export function resolveRoleToolGrantsFromPolicy(policy) {
  assertValidSessionRoleToolAccessPolicy(policy);
  const grants = new Map();
  for (const [toolName, roles] of Object.entries(policy.access)) {
    if (typeof toolName !== "string" || toolName.trim() === "" || !Array.isArray(roles)) {
      continue;
    }
    for (const role of roles) {
      if (typeof role !== "string" || role.trim() === "") {
        continue;
      }
      if (!grants.has(role)) {
        grants.set(role, new Set());
      }
      grants.get(role).add(toolName);
    }
  }
  return grants;
}

export function resolveToolDispositionsFromPolicy(policy) {
  assertValidSessionRoleToolAccessPolicy(policy);
  return new Map(
    Object.entries(policy.dispositions).map(([toolName, dispositions]) => [
      toolName,
      dispositions[0]
    ])
  );
}

export function evaluateToolDispositionCompatibility({
  disposition,
  grantedRoles,
  audience,
  tierVisibility
}) {
  const conflicts = [];
  const roles = Array.isArray(grantedRoles) ? grantedRoles : [];
  const resolvedAudience = Array.isArray(audience) ? audience : [];
  const resolvedTierVisibility = Array.isArray(tierVisibility) ? tierVisibility : [];
  const agentRoles = roles.filter((role) => role !== "operator");
  const hasOnlyOperatorGrant = roles.length > 0 && roles.every((role) => role === "operator");

  if (disposition !== SESSION_ROLE_TOOL_DISPOSITIONS.DIRECT && agentRoles.length > 0) {
    conflicts.push({
      kind: "grant",
      message: "an indirect/operator-only disposition cannot retain a direct non-operator role grant"
    });
  }
  if (agentRoles.length === 0 && roles.includes("operator") && !resolvedAudience.includes("operator")) {
    conflicts.push({
      kind: "axis",
      message: "an operator-only grant requires resolved audience 'operator'"
    });
  }
  if (agentRoles.length > 0 && !resolvedAudience.includes("agent")) {
    conflicts.push({
      kind: "axis",
      message: "a non-operator role grant requires resolved audience 'agent'"
    });
  }
  if (
    agentRoles.length > 0 &&
    !resolvedTierVisibility.some((tier) => tier === "free_local" || tier === "paid_cce")
  ) {
    conflicts.push({
      kind: "axis",
      message: "a non-operator role grant requires a resolved non-operator registered tier"
    });
  }
  if (resolvedTierVisibility.length === 0) {
    conflicts.push({
      kind: "axis",
      message: "a classified operation requires non-empty resolved tier visibility"
    });
  }
  if (
    disposition === SESSION_ROLE_TOOL_DISPOSITIONS.OPERATOR_RECOVERY_ONLY &&
    !resolvedTierVisibility.includes("operator_only") &&
    !hasOnlyOperatorGrant
  ) {
    conflicts.push({
      kind: "axis",
      message: `disposition '${disposition}' requires resolved tier 'operator_only'`
    });
  }
  if (
    disposition === SESSION_ROLE_TOOL_DISPOSITIONS.OUTSIDE_CURRENT_CONTRACT &&
    !resolvedTierVisibility.includes("operator_only")
  ) {
    conflicts.push({
      kind: "axis",
      message: `disposition '${disposition}' requires resolved tier 'operator_only'`
    });
  }
  return conflicts;
}

export function normalizeDiscoveryQuery(query = {}) {
  if (!isObject(query)) {
    return {};
  }

  const normalized = {};
  if (isNonEmptyString(query.task_id)) {
    normalized.task_id = query.task_id;
  }
  if (isNonEmptyString(query.tool_name)) {
    normalized.tool_name = query.tool_name;
  }
  if (isNonEmptyString(query.audience) && TOOL_DISCOVERY_AUDIENCE_VALUES.includes(query.audience)) {
    normalized.audience = query.audience;
  }
  if (
    isNonEmptyString(query.registered_tier) &&
    TOOL_DISCOVERY_TIER_VISIBILITY_VALUES.includes(query.registered_tier)
  ) {
    normalized.registered_tier = query.registered_tier;
  }
  if (hasOwn(query, "limit") && Number.isInteger(query.limit) && query.limit > 0) {
    normalized.limit = query.limit;
  }
  return normalized;
}

export function resolveToolAudience(tool) {
  if (!isObject(tool)) {
    return TOOL_DISCOVERY_DEFAULT_AUDIENCE.slice();
  }
  if (!Array.isArray(tool.audience) || tool.audience.length === 0) {
    return TOOL_DISCOVERY_DEFAULT_AUDIENCE.slice();
  }
  return tool.audience.filter((entry) => TOOL_DISCOVERY_AUDIENCE_VALUES.includes(entry));
}

export function resolveToolTierVisibility(tool) {
  if (!isObject(tool) || !Array.isArray(tool.tier_visibility) || tool.tier_visibility.length === 0) {
    return TOOL_DISCOVERY_DEFAULT_TIER_VISIBILITY.slice();
  }
  return tool.tier_visibility.filter((entry) => TOOL_DISCOVERY_TIER_VISIBILITY_VALUES.includes(entry));
}

export function tierVisibilityAllows(visibility, registeredTier) {
  const set = Array.isArray(visibility)
    ? visibility.filter((entry) => TOOL_DISCOVERY_TIER_VISIBILITY_VALUES.includes(entry))
    : [];
  if (set.length === 0) {
    return false;
  }
  if (registeredTier === TOOL_DISCOVERY_REGISTERED_TIER_PAID_CCE) {

    return true;
  }
  if (registeredTier === TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL) {
    return set.includes(TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL);
  }
  if (registeredTier === "operator_only") {
    return set.includes("operator_only");
  }
  return false;
}

export function projectToolDiscoveryEntryForTier(tool, registeredTier) {
  if (!isObject(tool)) {
    return tool;
  }
  const projected = cloneJson(tool);
  const tierText = isObject(tool.tier_text) ? tool.tier_text : null;
  if (hasOwn(projected, "tier_text")) {
    delete projected.tier_text;
  }
  const tier = TOOL_DISCOVERY_TIER_VISIBILITY_VALUES.includes(registeredTier)
    ? registeredTier
    : TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL;
  const overrides = tierText && isObject(tierText[tier]) ? tierText[tier] : null;
  if (overrides) {
    for (const field of TOOL_DISCOVERY_TIER_TEXT_FIELDS) {
      if (isNonEmptyString(overrides[field])) {
        projected[field] = overrides[field];
      }
    }
  }
  return projected;
}
