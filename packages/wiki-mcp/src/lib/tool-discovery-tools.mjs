

import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { z } from "zod";
import {
  createToolDiscoveryEnvelope,
  loadToolDiscoveryDescriptor,
  TOOL_DISCOVERY_LIST_DEFAULT_LIMIT
} from "@agent-chassis/wiki-core/src/lib/tool-discovery.mjs";

import { parseToolProfile, shouldExposeTool } from "./tool-profile.mjs";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const WIKI_MCP_PACKAGE_JSON_PATH = path.resolve(THIS_DIR, "../../package.json");
const VERSION_FALLBACK = "0.0.0";

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

  sessionRole = null
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

  function scopeToolDiscoveryResultsToSessionRole(results) {
    if (!Array.isArray(results)) {
      return [];
    }
    const role = resolveSessionRole();
    return results.filter((entry) => {
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

    const tierQuery =
      typeof registeredTier === "string" && registeredTier
        ? { ...query, registered_tier: registeredTier }
        : query;
    const envelope = createToolDiscoveryEnvelope({
      interface: "mcp",
      source_kind: "runtime_snapshot",
      package_versions,
      descriptor: augmentDescriptor(descriptor),
      query: tierQuery,
      verbose
    });

    if (Array.isArray(envelope.results)) {
      envelope.results = scopeToolDiscoveryResultsToSessionRole(envelope.results);
    }
    return envelope;
  }

  async function loadWorkspaceToolDiscoveryListEnvelope(options = {}) {
    const query = resolveToolDiscoveryQuery(options);
    const envelope = await loadWorkspaceToolDiscoveryEnvelope(query, { verbose: false });
    const totalCount = Array.isArray(envelope.results) ? envelope.results.length : 0;
    const limit = Number.isInteger(query.limit) && query.limit > 0
      ? query.limit
      : TOOL_DISCOVERY_LIST_DEFAULT_LIMIT;
    envelope.results = Array.isArray(envelope.results) ? envelope.results.slice(0, limit) : [];
    return applyToolDiscoveryListPagination(envelope, { totalCount, limit });
  }

  async function loadWorkspaceToolDiscoveryDescribeEnvelope(options = {}) {
    const query = resolveToolDiscoveryQuery(options);
    const verbose = options.verbose === true;
    const envelope = await loadWorkspaceToolDiscoveryEnvelope(query, { verbose });
    const totalCount = Array.isArray(envelope.results) ? envelope.results.length : 0;
    const limit = Number.isInteger(query.limit) && query.limit > 0
      ? query.limit
      : verbose
        ? null
        : TOOL_DISCOVERY_LIST_DEFAULT_LIMIT;
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
        "List the repository-local discovery envelope as a compact daily-use catalog scan. Default output is bounded to the first 20 compact entries; pass task_id, tool_name, or limit to change the bound. Use workspace_tools_describe for targeted per-tool detail and workspace_tools_query for known task_id/tool_name lookups.",
      inputSchema: {
        task_id: z.string().optional(),
        tool_name: z.string().optional(),
        limit: z.number().int().positive().optional()
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

  registerTool(
    "workspace_tools_describe",
    {
      description:
        "Describe the repository-local discovery envelope for targeted per-tool inspection. Default response returns compact entries (tool_name, kind, entrypoint, task_ids, runtime_posture, recommended_route, priority, rank) and is bounded to 20 entries unless a different positive limit is provided; pass task_id, tool_name, or limit to target a narrow set, and verbose:true for full catalog entries including display_name, install_state, side_effects, authority, docs_refs, source_files, and notes.",
      inputSchema: {
        task_id: z.string().optional(),
        tool_name: z.string().optional(),
        limit: z.number().int().positive().optional(),
        verbose: z.boolean().optional()
      }
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
