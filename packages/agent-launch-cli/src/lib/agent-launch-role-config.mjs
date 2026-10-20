import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

import { highPriorityRoleGuideEnabled } from "@agent-chassis/agent-launch-core/src/lib/agent-role-guides.mjs";

export const AGENT_LAUNCH_ROLE_CONFIG_FILENAME = "agent-launch.toml";

const ROLE_ALIASES = Object.freeze({
  review: "reviewer",
  resume: "orchestrator"
});

const ROLE_MODEL_ENV_KEYS = Object.freeze({
  worker: "WORKER_MODEL",
  reviewer: "REVIEWER_MODEL",
  orchestrator: "ORCHESTRATOR_MODEL",
  redteam: "REDTEAM_MODEL"
});

const KNOWN_ROLE_SET = new Set(Object.keys(ROLE_MODEL_ENV_KEYS));
const ROLE_CONFIG_EFFORT_SET = new Set(["low", "medium", "high", "xhigh", "max"]);

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MODEL_TABLE_KEYS = new Set(["use_litellm"]);
const VERTEXAI_TABLE_KEYS = new Set(["credentials_file", "project", "location", "port"]);

export class AgentLaunchRoleConfigError extends Error {
  constructor(message, { code, detail } = {}) {
    super(message);
    this.name = "AgentLaunchRoleConfigError";
    this.code = code ?? "agent_launch_role_config_error";
    this.detail = detail ?? null;
  }
}

function canonicalRole(role) {
  if (typeof role !== "string" || role.length === 0) {
    return null;
  }
  return ROLE_ALIASES[role] ?? role;
}

function roleConfigPath(dir) {
  if (typeof dir !== "string" || dir.length === 0 || !path.isAbsolute(dir)) {
    return null;
  }
  return path.join(dir, AGENT_LAUNCH_ROLE_CONFIG_FILENAME);
}

function parseTomlBasicString(value, { lineNumber, key }) {
  if (typeof value !== "string") {
    throw configError(`${key} must be a TOML string`, "role_config.value_not_string",
      { line_number: lineNumber, key });
  }
  return value;
}

function configError(message, code, detail) {
  return new AgentLaunchRoleConfigError(`agent-launch-role-config: ${message}`, { code, detail });
}

function parseTomlBoolean(value, { lineNumber, key }) {
  if (typeof value === "boolean") return value;
  throw configError(`${key} must be a TOML boolean (true or false)`,
    "role_config.value_not_boolean", { line_number: lineNumber, key });
}

function parseTomlPort(value, { lineNumber, key }) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw configError(`${key} must be a TOML integer between 1 and 65535`,
      "role_config.value_not_port", { line_number: lineNumber, key });
  }
  return value;
}

function isTable(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function freezeNative(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeNative(child);
    Object.freeze(value);
  }
  return value;
}

function unsupportedKey(section, key, lineNumber, source, expected) {
  const table = section.kind === "role" ? `role ${section.role}` : `[${section.key}]`;
  return configError(
    `unsupported key ${key} for ${table}; expected ${expected.join(" or ")}`,
    "role_config.unsupported_key",
    { role: section.role ?? null, table: section.key, key, line_number: lineNumber, source }
  );
}

function parseTableValue(section, key, rawValue, { lineNumber, source }) {
  if (section.kind === "role") {
    if (key === "high_priority_role_guide") return parseTomlBoolean(rawValue, { lineNumber, key });
    if (key !== "model" && key !== "effort") {
      throw unsupportedKey(section, key, lineNumber, source, ["model", "effort", "high_priority_role_guide"]);
    }
    const trimmed = parseTomlBasicString(rawValue, { lineNumber, key }).trim();
    if (key === "model" && trimmed === "") {
      throw configError(
        `role ${section.role} model must be non-empty`,
        "role_config.empty_model",
        { line_number: lineNumber, role: section.role, source }
      );
    }
    if (key === "effort" && !ROLE_CONFIG_EFFORT_SET.has(trimmed)) {
      throw configError(
        `role ${section.role} effort ${trimmed} is not in low|medium|high|xhigh|max`,
        "role_config.unknown_effort",
        { line_number: lineNumber, role: section.role, effort: trimmed, source }
      );
    }
    return trimmed;
  }
  if (section.kind === "model") {
    if (!MODEL_TABLE_KEYS.has(key)) {
      throw unsupportedKey(section, key, lineNumber, source, [...MODEL_TABLE_KEYS]);
    }
    return parseTomlBoolean(rawValue, { lineNumber, key });
  }
  if (!VERTEXAI_TABLE_KEYS.has(key)) {
    throw unsupportedKey(section, key, lineNumber, source, [...VERTEXAI_TABLE_KEYS]);
  }
  if (key === "port") return parseTomlPort(rawValue, { lineNumber, key });
  const text = parseTomlBasicString(rawValue, { lineNumber, key }).trim();
  if (text === "") {
    throw configError(
      `[vertexai] ${key} must be non-empty; omit it to use the default`,
      "role_config.empty_value",
      { line_number: lineNumber, key, source }
    );
  }
  return text;
}

export function parseAgentLaunchRoleConfigSource(input, { source = null, rejectExplicitRouting = false } = {}) {
  let parsed;
  try {
    parsed = parseToml(String(input ?? ""));
  } catch (error) {

    throw configError(`invalid TOML at line ${error.line}, column ${error.column}`,
      "role_config.invalid_toml", { line_number: error.line, column: error.column, source });
  }
  if (rejectExplicitRouting) {
    const inspect = (table) => {
      if (!isTable(table)) return;
      for (const [key, value] of Object.entries(table)) {
        if (["app", "client", "provider", "backend", "family", "model_provider"].includes(key)) {
          throw configError(`explicit ${key} conflicts with model-family routing`,
            "role_config.explicit_routing_conflict", { key, source });
        }
        inspect(value);
      }
    };
    for (const [key, value] of Object.entries(parsed)) {
      if (key !== "opencode") inspect({ [key]: value });
    }
  }
  const tables = new Map();
  const addTable = (section, table) => {
    if (!isTable(table)) throw configError(`[${section.key}] must be a TOML table`,
      "role_config.invalid_table", { table: section.key, source });
    const values = new Map(Object.entries(table).map(([key, value]) =>
      [key, parseTableValue(section, key, value, { lineNumber: null, source })]));
    tables.set(section.key, { section, lineNumber: null, values });
  };
  for (const key of ["roles", "models"]) {
    if (parsed[key] !== undefined && !isTable(parsed[key])) throw configError(`[${key}] must be a TOML table`,
      "role_config.invalid_table", { table: key, source });
  }
  for (const [role, table] of Object.entries(parsed.roles ?? {})) {
    if (!isTable(table)) throw configError(`[roles] assignments are not supported; use [roles.<role>]`,
      "role_config.legacy_roles_table_assignment", { source });
    if (!KNOWN_ROLE_SET.has(role)) throw configError(`unknown role ${role} in [roles.${role}]`,
      "role_config.unknown_role", { role, source });
    addTable({ kind: "role", key: `roles.${role}`, role }, table);
  }
  for (const [model, table] of Object.entries(parsed.models ?? {})) {
    if (!isTable(table)) throw configError(`[models] assignments are not supported; use [models."<registered-model-id>"]`,
      "role_config.models_root_assignment", { source });
    if (!MODEL_ID_PATTERN.test(model)) throw configError(`invalid model table ${model}`,
      "role_config.invalid_model_table", { source });
    addTable({ kind: "model", key: `models.${model}`, model }, table);
  }
  if (parsed.vertexai !== undefined) addTable({ kind: "vertexai", key: "vertexai" }, parsed.vertexai);

  const roles = {};
  const efforts = {};
  const highPriorityRoleGuides = {};
  const models = {};
  let vertexai = null;
  for (const { section: owner, lineNumber, values } of tables.values()) {
    if (owner.kind === "role") {
      if (!values.has("model")) {
        throw configError(
          `[roles.${owner.role}] must declare model`,
          "role_config.missing_model",
          { line_number: lineNumber, role: owner.role, source }
        );
      }
      roles[owner.role] = values.get("model");
      if (values.has("high_priority_role_guide")) highPriorityRoleGuides[owner.role] = values.get("high_priority_role_guide");
      if (values.has("effort")) efforts[owner.role] = values.get("effort");
    } else if (owner.kind === "model") {
      models[owner.model] = Object.freeze({
        use_litellm: values.get("use_litellm") === true,
        line_number: lineNumber
      });
    } else if (owner.kind === "vertexai") {
      vertexai = Object.freeze({
        credentials_file: values.get("credentials_file") ?? null,
        project: values.get("project") ?? null,
        location: values.get("location") ?? null,
        port: values.get("port") ?? null
      });
    }
  }

  return Object.freeze({
    roles: Object.freeze(roles),
    efforts: Object.freeze(efforts),
    highPriorityRoleGuides: Object.freeze(highPriorityRoleGuides),
    models: Object.freeze(models),
    vertexai,
    opencode: freezeNative(parsed.opencode ?? null),
    source
  });
}

const EMPTY_SNAPSHOT_SOURCE = Object.freeze({ kind: "absent" });

export function readAgentLaunchConfigSnapshot({
  dir,
  readFileText = (filePath) => readFileSync(filePath, "utf8")
} = {}) {
  const configPath = roleConfigPath(dir);
  if (!configPath || !existsSync(configPath)) {
    return parseAgentLaunchRoleConfigSource("", { source: EMPTY_SNAPSHOT_SOURCE });
  }
  return parseAgentLaunchRoleConfigSource(readFileText(configPath), {
    source: Object.freeze({ kind: "file", path: configPath })
  });
}

export function roleDefaultModelFromSnapshot(role, snapshot) {
  const resolvedRole = canonicalRole(role);
  if (!resolvedRole || !KNOWN_ROLE_SET.has(resolvedRole)) return null;
  return snapshot?.roles?.[resolvedRole] ?? null;
}

export function roleEffortFromSnapshot(role, snapshot) {
  const resolvedRole = canonicalRole(role);
  if (!resolvedRole || !KNOWN_ROLE_SET.has(resolvedRole)) return null;
  return snapshot?.efforts?.[resolvedRole] ?? null;
}

export function readRoleDefaultModel(role, { dir, readFileText } = {}) {
  const resolvedRole = canonicalRole(role);
  if (!resolvedRole || !KNOWN_ROLE_SET.has(resolvedRole)) return null;
  return roleDefaultModelFromSnapshot(resolvedRole, readAgentLaunchConfigSnapshot({ dir, readFileText }));
}

export function readRoleEffort(role, { dir, readFileText } = {}) {
  const resolvedRole = canonicalRole(role);
  if (!resolvedRole || !KNOWN_ROLE_SET.has(resolvedRole)) return null;
  return roleEffortFromSnapshot(resolvedRole, readAgentLaunchConfigSnapshot({ dir, readFileText }));
}

export function roleGuideDeliveryFromSnapshot(role, snapshot) {
  return highPriorityRoleGuideEnabled(role, snapshot?.highPriorityRoleGuides);
}

export function isConfiguredOpenCodeModel(model, opencode) {
  const slash = typeof model === "string" ? model.indexOf("/") : -1;
  return slash > 0 && slash < model.length - 1
    && Object.hasOwn(opencode?.provider ?? {}, model.slice(0, slash));
}
