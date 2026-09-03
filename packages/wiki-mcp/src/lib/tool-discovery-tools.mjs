

import { Buffer } from "node:buffer";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { z } from "zod";
import {
  createBoundedToolDiscoveryListEnvelope,
  createToolDiscoveryEnvelope,
  loadToolDiscoveryDescriptor,
  projectRuntimeToolDiscoveryDocumentation,
  rankToolDiscoveryTools,
  TOOL_DISCOVERY_LIST_DEFAULT_LIMIT
} from "@agent-chassis/wiki-core/src/lib/tool-discovery.mjs";

import { parseToolProfile, shouldExposeTool } from "./tool-profile.mjs";
import { recordOwnerRegisteredRequestSchema } from "./dispatch-tool-helpers.mjs";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const WIKI_MCP_PACKAGE_JSON_PATH = path.resolve(THIS_DIR, "../../package.json");
const VERSION_FALLBACK = "0.0.0";
const TOOL_DISCOVERY_DESCRIBE_COMPACT_OMITTED_FIELDS = Object.freeze([
  "kind",
  "entrypoint",
  "runtime_posture",
  "priority",
  "rank"
]);

export const WORKSPACE_TOOLS_DESCRIBE_INPUT_SCHEMA = Object.freeze({
  task_id: z.string().optional(),
  tool_name: z.string().optional(),
  limit: z.number().int().positive().optional(),
  verbose: z.boolean().optional()
});

async function readPackageVersionByPath(packageJsonPath) {
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    return typeof packageJson.version === "string" ? packageJson.version : VERSION_FALLBACK;
  } catch {
    return VERSION_FALLBACK;
  }
}

async function resolveDependencyVersion(packageJsonSpecifier) {
  try {
    return await readPackageVersionByPath(require.resolve(packageJsonSpecifier));
  } catch {
    return VERSION_FALLBACK;
  }
}

async function loadToolDiscoveryPackageVersions() {
  const [wiki_core, wiki_mcp] = await Promise.all([
    resolveDependencyVersion("@agent-chassis/wiki-core/package.json"),
    readPackageVersionByPath(WIKI_MCP_PACKAGE_JSON_PATH)
  ]);
  return { wiki_core, wiki_mcp };
}

function resolveToolDiscoveryQuery(options = {}) {
  const taskId = String(options.task_id || "").trim();
  const toolName = String(options.tool_name || "").trim();

  if (taskId && toolName) {
    throw new Error("Use only one of task_id or tool_name");
  }

  const query = {};
  if (taskId) {
    query.task_id = taskId;
  }
  if (toolName) {
    query.tool_name = toolName;
  }
  if (Number.isInteger(options.limit) && options.limit > 0) {
    query.limit = options.limit;
  }

  if (Number.isInteger(options.offset) && options.offset > 0) {
    query.offset = options.offset;
  }
  return query;
}

function applyToolDiscoveryListPagination(envelope, { totalCount, limit }) {
  envelope.total_count = totalCount;
  envelope.limit_applied = limit;
  envelope.truncated =
    Number.isInteger(limit) && limit > 0 ? totalCount > limit : false;
  return envelope;
}

export function registerToolDiscoveryTools({
  registerTool,
  jsonContent,
  errorContent,
  augmentDescriptor,

  registeredTier = null,

  sessionRole = null,

  docsCarrier = null
}) {

  function resolveSessionRole() {
    if (typeof sessionRole === "string" && sessionRole !== "") {
      return sessionRole;
    }
    try {
      return parseToolProfile();
    } catch {
      return null;
    }
  }

  function scopeToolDiscoveryRowsToSessionRole(rows) {
    if (!Array.isArray(rows)) {
      return [];
    }
    const role = resolveSessionRole();
    return rows.filter((entry) => {
      const toolName =
        entry && typeof entry.tool_name === "string" ? entry.tool_name : "";
      if (toolName === "") {
        return false;
      }
      return shouldExposeTool(role, toolName);
    });
  }

  function jsonToolDiscoveryContent(data) {
    const response = jsonContent(data);
    if (
      response?.structuredContent?.response_spilled === true &&
      response.structuredContent.package_versions === undefined &&
      data &&
      typeof data === "object" &&
      data.package_versions &&
      typeof data.package_versions === "object"
    ) {
      response.structuredContent.package_versions = JSON.parse(
        JSON.stringify(data.package_versions)
      );
    }
    return response;
  }

  async function loadWorkspaceToolDiscoveryEnvelope(query = {}, { verbose = false } = {}) {
    const descriptor = await loadToolDiscoveryDescriptor();
    const package_versions = await loadToolDiscoveryPackageVersions();
    const augmentedDescriptor = augmentDescriptor(descriptor);

    const tierQuery =
      typeof registeredTier === "string" && registeredTier
        ? { ...query, registered_tier: registeredTier }
        : query;

    const roleVisibleResults = projectRuntimeToolDiscoveryDocumentation(
      rankToolDiscoveryTools(
        {
          ...augmentedDescriptor,
          tools: scopeToolDiscoveryRowsToSessionRole(augmentedDescriptor?.tools)
        },
        tierQuery,
        { verbose }
      ),
      { docsCarrier }
    );
    return createToolDiscoveryEnvelope({
      interface: "mcp",
      source_kind: "runtime_snapshot",
      package_versions,
      descriptor: augmentedDescriptor,
      query: tierQuery,
      verbose,
      results: roleVisibleResults
    });
  }

  function measureToolDiscoveryListResultBytes(candidate) {
    return Buffer.byteLength(JSON.stringify(jsonContent(candidate)), "utf8");
  }

  async function loadWorkspaceToolDiscoveryListEnvelope(options = {}) {

    const query = resolveToolDiscoveryQuery(options);

    const filterQuery = { ...query };
    delete filterQuery.limit;
    delete filterQuery.offset;
    const envelope = await loadWorkspaceToolDiscoveryEnvelope(filterQuery, { verbose: false });
    if (Object.keys(query).length > 0) {
      envelope.query = query;
    }
    const roleVisibleResults = Array.isArray(envelope.results) ? envelope.results : [];
    const limit = Number.isInteger(query.limit) && query.limit > 0
      ? query.limit
      : TOOL_DISCOVERY_LIST_DEFAULT_LIMIT;

    const offset = Number.isInteger(query.offset) && query.offset > 0 ? query.offset : 0;

    return createBoundedToolDiscoveryListEnvelope(envelope, roleVisibleResults, {
      totalCount: roleVisibleResults.length,
      limit,
      offset,
      measureResultBytes: measureToolDiscoveryListResultBytes
    });
  }

  async function loadWorkspaceToolDiscoveryDescribeEnvelope(options = {}) {
    const query = resolveToolDiscoveryQuery(options);
    const verbose = options.verbose === true;

    const rankRecoveryToolName = verbose ? query.tool_name : null;
    const projectionQuery = rankRecoveryToolName ? { ...query } : query;
    if (rankRecoveryToolName) {
      delete projectionQuery.tool_name;
      delete projectionQuery.limit;
    }
    const envelope = await loadWorkspaceToolDiscoveryEnvelope(projectionQuery, { verbose });
    if (rankRecoveryToolName && Array.isArray(envelope.results)) {
      envelope.results = envelope.results.filter(
        (entry) => entry.tool_name === rankRecoveryToolName
      );
      envelope.query = query;
    }
    const totalCount = Array.isArray(envelope.results) ? envelope.results.length : 0;
    const limit = Number.isInteger(query.limit) && query.limit > 0
      ? query.limit
      : verbose
        ? null
        : TOOL_DISCOVERY_LIST_DEFAULT_LIMIT;
    if (!verbose && Array.isArray(envelope.results)) {
      envelope.results = envelope.results.map((entry) => {
        const projected = { ...entry };
        for (const field of TOOL_DISCOVERY_DESCRIBE_COMPACT_OMITTED_FIELDS) {
          delete projected[field];
        }
        return projected;
      });
    }
    if (Number.isInteger(limit) && limit > 0 && Array.isArray(envelope.results)) {
      envelope.results = envelope.results.slice(0, limit);
    }
    return applyToolDiscoveryListPagination(envelope, { totalCount, limit });
  }

  async function loadWorkspaceToolDiscoveryQueryEnvelope(options = {}) {
    const query = resolveToolDiscoveryQuery(options);
    const verbose = options.verbose === true;
    const envelope = await loadWorkspaceToolDiscoveryEnvelope(query, { verbose });
    if (Number.isInteger(query.limit) && query.limit > 0) {
      envelope.results = envelope.results.slice(0, query.limit);
    }
    return envelope;
  }

  registerTool(
    "workspace_tools_list",
    {
      description:
        "List a hard-bounded role- and tier-filtered catalog for tool selection. Default rows contain only tool_name and task_ids; total_count is the exact role-visible total and returned_count is what this page carries. The response is a page: while has_more is true, repeat with offset:next_offset, which resumes at the first omitted row after either count or byte truncation. Neither limit nor offset bypasses the byte ceiling. Recover complete detail and global rank for a selected name with workspace_tools_describe({tool_name,verbose:true}).",
      inputSchema: {
        task_id: z.string().optional(),
        tool_name: z.string().optional(),
        limit: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional()
      }
    },
    async (args) => {
      try {
        return jsonToolDiscoveryContent(await loadWorkspaceToolDiscoveryListEnvelope(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  recordOwnerRegisteredRequestSchema({
    registerTool,
    toolName: "workspace_tools_describe",
    declaredInput: WORKSPACE_TOOLS_DESCRIBE_INPUT_SCHEMA
  });
  registerTool(
    "workspace_tools_describe",
    {
      description:
        "Describe the repository-local discovery envelope for targeted per-tool inspection. Default response returns compact routing and task-contract fields while omitting kind, entrypoint, runtime_posture, priority, and rank, and is bounded to 20 entries unless a different positive limit is provided. Pass task_id, tool_name, or limit to target a narrow set; verbose:true returns the complete entry and losslessly restores every omitted field.",
      inputSchema: WORKSPACE_TOOLS_DESCRIBE_INPUT_SCHEMA
    },
    async (args) => {
      try {
        return jsonToolDiscoveryContent(await loadWorkspaceToolDiscoveryDescribeEnvelope(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerTool(
    "workspace_tools_query",
    {
      description:
        "Query the repository-local discovery envelope by task id or tool name.",
      inputSchema: {
        task_id: z.string().optional(),
        tool_name: z.string().optional(),
        limit: z.number().int().positive().optional(),
        verbose: z.boolean().optional()
      }
    },
    async (args) => {
      try {
        return jsonToolDiscoveryContent(await loadWorkspaceToolDiscoveryQueryEnvelope(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
