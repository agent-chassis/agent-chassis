
import path from "node:path";
import { STDIO_MCP_CONDUIT_ALLOWED_FAMILIES, STDIO_MCP_CONDUIT_ALLOWED_ROLES,
  STDIO_MCP_CONDUIT_ERROR_CODES, failStdioMcpConduit as fail,
  normalizeStdioMcpConduitRole as normalizedRole } from "./stdio-mcp-conduit-contract.mjs";
import { assertTrustedStdioMcpConduitAuthority, authenticateLauncherAgentSessionContract,
  resolveLauncherAgentSessionContractFacts } from "./stdio-mcp-conduit-authority.mjs";
const INPUT_FIELDS = Object.freeze(new Set([
  "family", "role", "assignedUnit", "workspaceDir", "workspaceAlias",
  "dispatchWorktreeRoot", "responseStateDir", "commitTuple", "authority",
  "sessionContract", "hostSessionProfile"
]));

export function validateConduitInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID, "stdio MCP conduit input must be an object");
  }
  const extra = Object.keys(input).filter((key) => !INPUT_FIELDS.has(key));
  if (extra.length > 0) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "stdio MCP conduit input contains caller-controlled authority carriers", { extra });
  }
  const family = String(input.family ?? "");
  const role = normalizedRole(input.role);
  if (!STDIO_MCP_CONDUIT_ALLOWED_FAMILIES.has(family)) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.FAMILY_UNSUPPORTED,
      "confined wiki-MCP conduit supports only Claude and Codex", { family });
  }
  if (!STDIO_MCP_CONDUIT_ALLOWED_ROLES.has(role) || typeof input.assignedUnit !== "string" ||
      input.assignedUnit.length === 0 || typeof input.workspaceDir !== "string" ||
      !path.isAbsolute(input.workspaceDir)) {
    fail(STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "stdio MCP conduit requires a launcher-derived role, assigned unit, and absolute workspace");
  }

  const authority = assertTrustedStdioMcpConduitAuthority(input.authority, {
    family,
    role,
    assignedUnit: input.assignedUnit,
    workspaceDir: input.workspaceDir
  });
  const sessionContract = authenticateLauncherAgentSessionContract({
    contract: input.sessionContract,
    expectedFacts: resolveLauncherAgentSessionContractFacts(authority),
    preparation: true
  });
  return { family, role, authority, sessionContract };
}

