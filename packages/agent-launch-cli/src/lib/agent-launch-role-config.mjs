import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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
const SECTION_PATTERN = /^\[\s*([^\[\]]+?)\s*\]$/;
const ASSIGNMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+)$/;

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MODEL_TABLE_PATTERN = /^models\.(?:"([^"\\]*)"|([A-Za-z0-9_-]+))$/;
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

function stripInlineTomlComment(rawLine) {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < rawLine.length; index += 1) {
    const char = rawLine[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (char === "#" && !inString) {
      return rawLine.slice(0, index);
    }
  }
  return rawLine;
}

function parseTomlBasicString(value, { lineNumber, key }) {
  const trimmed = value.trim();
  if (trimmed.length < 2 || !trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    throw new AgentLaunchRoleConfigError(
      `agent-launch-role-config: ${key} on line ${lineNumber} must be a TOML basic string`,
      {
        code: "role_config.value_not_string",
        detail: { line_number: lineNumber, key }
      }
    );
  }

  const body = trimmed.slice(1, -1);
  return body.replace(/\\(["\\btnfr])/g, (_match, escaped) => {
    if (escaped === "b") return "\b";
    if (escaped === "t") return "\t";
    if (escaped === "n") return "\n";
    if (escaped === "f") return "\f";
    if (escaped === "r") return "\r";
    return escaped;
  });
}

function configError(message, code, detail) {
  return new AgentLaunchRoleConfigError(`agent-launch-role-config: ${message}`, { code, detail });
}

function parseSection(sectionName, { lineNumber, source }) {
  if (sectionName === "roles") return { kind: "roles_root" };
  if (sectionName === "models") return { kind: "models_root" };
  if (sectionName === "vertexai") return { kind: "vertexai", key: "vertexai" };
  if (sectionName.startsWith("models.")) {
    const match = MODEL_TABLE_PATTERN.exec(sectionName);
    const model = match ? (match[1] ?? match[2]) : null;
    if (model === null || !MODEL_ID_PATTERN.test(model)) {
      throw configError(
        `[${sectionName}] on line ${lineNumber} is not a model table; use [models."<registered-model-id>"]`,
        "role_config.invalid_model_table",
        { line_number: lineNumber, section: sectionName, source }
      );
    }
    return { kind: "model", key: `models.${model}`, model };
  }
  if (!sectionName.startsWith("roles.")) {
    return { kind: "other" };
  }

  const role = sectionName.slice("roles.".length);
  if (!KNOWN_ROLE_SET.has(role)) {
    throw configError(
      `unknown role ${role} in [${sectionName}] on line ${lineNumber}`,
      "role_config.unknown_role",
      { line_number: lineNumber, role, source }
    );
  }
  return { kind: "role", key: `roles.${role}`, role };
}

function parseTomlBoolean(value, { lineNumber, key }) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  throw configError(
    `${key} on line ${lineNumber} must be a TOML boolean (true or false)`,
    "role_config.value_not_boolean",
    { line_number: lineNumber, key }
  );
}

function parseTomlPort(value, { lineNumber, key }) {
  const trimmed = value.trim();
  const port = /^[0-9]{1,5}$/.test(trimmed) ? Number(trimmed) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw configError(
      `${key} on line ${lineNumber} must be a TOML integer between 1 and 65535`,
      "role_config.value_not_port",
      { line_number: lineNumber, key }
    );
  }
  return port;
}

function unsupportedKey(section, key, lineNumber, source, expected) {
  const table = section.kind === "role" ? `role ${section.role}` : `[${section.key}]`;
  return configError(
    `unsupported key ${key} for ${table} on line ${lineNumber}; expected ${expected.join(" or ")}`,
    "role_config.unsupported_key",
    { role: section.role ?? null, table: section.key, key, line_number: lineNumber, source }
  );
}

function parseTableValue(section, key, rawValue, { lineNumber, source }) {
  if (section.kind === "role") {
    if (key !== "model" && key !== "effort") {
      throw unsupportedKey(section, key, lineNumber, source, ["model", "effort"]);
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
      `[vertexai] ${key} on line ${lineNumber} must be non-empty; omit it to use the default`,
      "role_config.empty_value",
      { line_number: lineNumber, key, source }
    );
  }
  return text;
}

export function parseAgentLaunchRoleConfigSource(input, { source = null } = {}) {
  const tables = new Map();
  let section = { kind: "other" };
  const lines = String(input ?? "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = stripInlineTomlComment(lines[index]).trim();

    if (line === "") continue;

    const sectionMatch = SECTION_PATTERN.exec(line);
    if (sectionMatch) {
      section = parseSection(sectionMatch[1], { lineNumber, source });
      if (section.key !== undefined) {
        const existing = tables.get(section.key);
        if (existing) {
          const duplicateLabel = section.kind === "role" ? `[roles.${section.role}]` : `[${sectionMatch[1]}]`;
          throw configError(
            `duplicate ${duplicateLabel} table on line ${lineNumber}; first declared on line ${existing.lineNumber}`,
            section.kind === "role" ? "role_config.duplicate_role" : "role_config.duplicate_table",
            {
              ...(section.kind === "role" ? { role: section.role } : { table: section.key }),
              line_number: lineNumber,
              first_line_number: existing.lineNumber,
              source
            }
          );
        }
        tables.set(section.key, { section, lineNumber, values: new Map(), keyLines: new Map() });
      }
      continue;
    }

    const assignmentMatch = ASSIGNMENT_PATTERN.exec(line);
    if (!assignmentMatch) {
      throw configError(
        `invalid TOML assignment on line ${lineNumber}`,
        "role_config.invalid_assignment",
        { line_number: lineNumber, source }
      );
    }

    if (section.kind === "other") continue;
    if (section.kind === "roles_root") {
      throw configError(
        `[roles] assignments are not supported on line ${lineNumber}; use [roles.<role>] with model = "..."`,
        "role_config.legacy_roles_table_assignment",
        { line_number: lineNumber, source }
      );
    }
    if (section.kind === "models_root") {
      throw configError(
        `[models] assignments are not supported on line ${lineNumber}; use [models."<registered-model-id>"] with use_litellm = true`,
        "role_config.models_root_assignment",
        { line_number: lineNumber, source }
      );
    }

    const key = assignmentMatch[1];
    const table = tables.get(section.key);
    const value = parseTableValue(section, key, assignmentMatch[2], { lineNumber, source });
    if (table.keyLines.has(key)) {
      const owner = section.kind === "role" ? `role ${section.role}` : `[${section.key}]`;
      throw configError(
        `duplicate ${key} for ${owner} on line ${lineNumber}; first declared on line ${table.keyLines.get(key)}`,
        "role_config.duplicate_key",
        {
          ...(section.kind === "role" ? { role: section.role } : { table: section.key }),
          key,
          line_number: lineNumber,
          first_line_number: table.keyLines.get(key),
          source
        }
      );
    }
    table.values.set(key, value);
    table.keyLines.set(key, lineNumber);
  }

  const roles = {};
  const efforts = {};
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
    models: Object.freeze(models),
    vertexai,
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
