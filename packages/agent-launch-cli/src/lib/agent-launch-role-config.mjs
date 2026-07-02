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
const SECTION_PATTERN = /^\[([A-Za-z0-9_.-]+)\]$/;
const ASSIGNMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+)$/;

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

function parseRoleTableSection(sectionName, { lineNumber, source }) {
  if (sectionName === "roles") {
    return { kind: "roles_root" };
  }
  if (!sectionName.startsWith("roles.")) {
    return { kind: "other" };
  }

  const role = sectionName.slice("roles.".length);
  if (!KNOWN_ROLE_SET.has(role)) {
    throw new AgentLaunchRoleConfigError(
      `agent-launch-role-config: unknown role ${role} in [${sectionName}] on line ${lineNumber}`,
      {
        code: "role_config.unknown_role",
        detail: { line_number: lineNumber, role, source }
      }
    );
  }
  return { kind: "role", role };
}

export function parseAgentLaunchRoleConfigSource(input, { source = null } = {}) {
  const roleTables = new Map();
  let section = { kind: "other" };
  const lines = String(input ?? "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const rawLine = lines[index];
    const line = stripInlineTomlComment(rawLine).trim();

    if (line === "") continue;

    const sectionMatch = SECTION_PATTERN.exec(line);
    if (sectionMatch) {
      section = parseRoleTableSection(sectionMatch[1], { lineNumber, source });
      if (section.kind === "role") {
        if (roleTables.has(section.role)) {
          throw new AgentLaunchRoleConfigError(
            `agent-launch-role-config: duplicate [roles.${section.role}] table on line ${lineNumber}; first declared on line ${roleTables.get(section.role).lineNumber}`,
            {
              code: "role_config.duplicate_role",
              detail: {
                role: section.role,
                line_number: lineNumber,
                first_line_number: roleTables.get(section.role).lineNumber,
                source
              }
            }
          );
        }
        roleTables.set(section.role, {
          lineNumber,
          values: new Map(),
          keyLines: new Map()
        });
      }
      continue;
    }

    const assignmentMatch = ASSIGNMENT_PATTERN.exec(line);
    if (!assignmentMatch) {
      throw new AgentLaunchRoleConfigError(
        `agent-launch-role-config: invalid TOML assignment on line ${lineNumber}`,
        {
          code: "role_config.invalid_assignment",
          detail: { line_number: lineNumber, source }
        }
      );
    }

    if (section.kind === "other") continue;
    if (section.kind === "roles_root") {
      throw new AgentLaunchRoleConfigError(
        `agent-launch-role-config: [roles] assignments are not supported on line ${lineNumber}; use [roles.<role>] with model = "..."`,
        {
          code: "role_config.legacy_roles_table_assignment",
          detail: { line_number: lineNumber, source }
        }
      );
    }

    const role = section.role;
    const key = assignmentMatch[1];
    if (key !== "model" && key !== "effort") {
      throw new AgentLaunchRoleConfigError(
        `agent-launch-role-config: unsupported key ${key} for role ${role} on line ${lineNumber}; expected model or effort`,
        {
          code: "role_config.unsupported_key",
          detail: { role, key, line_number: lineNumber, source }
        }
      );
    }

    const roleTable = roleTables.get(role);
    if (roleTable.keyLines.has(key)) {
      throw new AgentLaunchRoleConfigError(
        `agent-launch-role-config: duplicate ${key} for role ${role} on line ${lineNumber}; first declared on line ${roleTable.keyLines.get(key)}`,
        {
          code: "role_config.duplicate_key",
          detail: {
            role,
            key,
            line_number: lineNumber,
            first_line_number: roleTable.keyLines.get(key),
            source
          }
        }
      );
    }

    const value = parseTomlBasicString(assignmentMatch[2], { lineNumber, key });
    const trimmed = value.trim();
    if (key === "model" && trimmed === "") {
      throw new AgentLaunchRoleConfigError(
        `agent-launch-role-config: role ${role} model must be non-empty`,
        {
          code: "role_config.empty_model",
          detail: { line_number: lineNumber, role, source }
        }
      );
    }
    if (key === "effort" && !ROLE_CONFIG_EFFORT_SET.has(trimmed)) {
      throw new AgentLaunchRoleConfigError(
        `agent-launch-role-config: role ${role} effort ${trimmed} is not in low|medium|high|xhigh|max`,
        {
          code: "role_config.unknown_effort",
          detail: { line_number: lineNumber, role, effort: trimmed, source }
        }
      );
    }
    roleTable.values.set(key, trimmed);
    roleTable.keyLines.set(key, lineNumber);
  }

  const roles = new Map();
  const efforts = new Map();
  for (const [role, roleTable] of roleTables) {
    if (!roleTable.values.has("model")) {
      throw new AgentLaunchRoleConfigError(
        `agent-launch-role-config: [roles.${role}] must declare model`,
        {
          code: "role_config.missing_model",
          detail: { line_number: roleTable.lineNumber, role, source }
        }
      );
    }
    roles.set(role, roleTable.values.get("model"));
    if (roleTable.values.has("effort")) {
      efforts.set(role, roleTable.values.get("effort"));
    }
  }

  return Object.freeze({
    roles: Object.freeze(Object.fromEntries(roles)),
    efforts: Object.freeze(Object.fromEntries(efforts)),
    source
  });
}

export function readRoleDefaultModel(role, { dir, readFileText = (filePath) => readFileSync(filePath, "utf8") } = {}) {
  const resolvedRole = canonicalRole(role);
  if (!resolvedRole || !KNOWN_ROLE_SET.has(resolvedRole)) {
    return null;
  }
  const configPath = roleConfigPath(dir);
  if (!configPath || !existsSync(configPath)) {
    return null;
  }
  const parsed = parseAgentLaunchRoleConfigSource(readFileText(configPath), {
    source: Object.freeze({ kind: "file", path: configPath })
  });
  return parsed.roles[resolvedRole] ?? null;
}

export function readRoleEffort(role, { dir, readFileText = (filePath) => readFileSync(filePath, "utf8") } = {}) {
  const resolvedRole = canonicalRole(role);
  if (!resolvedRole || !KNOWN_ROLE_SET.has(resolvedRole)) {
    return null;
  }
  const configPath = roleConfigPath(dir);
  if (!configPath || !existsSync(configPath)) {
    return null;
  }
  const parsed = parseAgentLaunchRoleConfigSource(readFileText(configPath), {
    source: Object.freeze({ kind: "file", path: configPath })
  });
  return parsed.efforts[resolvedRole] ?? null;
}
