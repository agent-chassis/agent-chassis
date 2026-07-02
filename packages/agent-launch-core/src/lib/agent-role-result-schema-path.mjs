import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ROLE_RESULT_SCHEMA_PATH = path.resolve(
  MODULE_DIR,
  "../../data/agent-role-result.v1.schema.json"
);

export function resolveAgentRoleResultSchemaPath() {
  return AGENT_ROLE_RESULT_SCHEMA_PATH;
}

export function resolveAgentRoleResultSchemaJson() {
  return readFileSync(AGENT_ROLE_RESULT_SCHEMA_PATH, "utf8");
}
