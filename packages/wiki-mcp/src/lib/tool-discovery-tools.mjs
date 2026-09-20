

import { Buffer } from "node:buffer";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { z } from "zod";
import {
  compactToolDiscoveryListEntry,
  createBoundedToolDiscoveryListEnvelope,
  createToolDiscoveryEnvelope,
  digestToolDiscoveryDescriptor,
  loadToolDiscoveryDescriptor,
  projectRuntimeToolDiscoveryDocumentation,
  rankToolDiscoveryTools,
  TOOL_DISCOVERY_LIST_DEFAULT_LIMIT
} from "@agent-chassis/wiki-core/src/lib/tool-discovery.mjs";

import { parseToolProfile, shouldExposeTool } from "./tool-profile.mjs";
import {
  buildDispatchContinuation,
  recordOwnerRegisteredRequestSchema,
  requestSchemaAuthorityForRegistration
} from "./dispatch-tool-helpers.mjs";

import {
  completeToolInputContract,
  registeredToolInputGuidance
} from "./compact-tool-declaration-registry.mjs";
import {
  deliverToolInputGuidance,
  inputContractSourceBindingRefusal,
  inputContractSourceDigest,
  toolInputGuidanceRequestRefusal,
  WORKSPACE_TOOLS_DESCRIBE_INPUT_SCHEMA
} from "./tool-discovery-input-guidance-delivery.mjs";
import {
  createWorkRecordEditInputRequestFacts,
  createWorkRecordEditInputSchema
} from "./work-record-edit-input-contract.mjs";
import {
  deliverWorkRecordEditInputGuidance,
  workRecordEditInputContractRequestRefusal,
  WORK_RECORD_EDIT_INPUT_CONTRACT_TOOL
} from "./work-record-edit-input-guidance-delivery.mjs";
import {
  MCP_WRITE_SEMANTICS,
  MCP_WRITE_SEMANTICS_STATEMENTS
} from "./register-tool.mjs";

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

export { WORKSPACE_TOOLS_DESCRIBE_INPUT_SCHEMA };

export const WORKSPACE_TOOLS_LIST_INPUT_SCHEMA = z.object({
  task_id: z.string().optional(),
  tool_name: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  expected_source_digest: z.string().optional()
});

export const TOOL_DISCOVERY_LIST_SOURCE = "tool_discovery_list";
export const TOOL_DISCOVERY_LIST_CODES = Object.freeze({
  SOURCE_DIGEST_REQUIRED: "tool_discovery_list_source_digest_required",
  SOURCE_CHANGED: "tool_discovery_list_source_changed"
});
const LIST_PAGE_RETURNED = "tool_discovery.list_page_returned";
const DESCRIBE_ENTRY_RETURNED = "tool_discovery.describe_entry_returned";

export function bareDiscoveryToolName(toolName) {
  if (typeof toolName !== "string" || !toolName.includes("__")) return null;
  const segments = toolName.split("__");
  const bare = segments[segments.length - 1];
  return bare.length > 0 && bare !== toolName ? bare : null;
}

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

function throwInputContractRefusal(refusal) {
  if (refusal === null) return;
  const error = new Error(`${refusal.diagnostic.code}: ${refusal.diagnostic.message}`);
  error.envelope = refusal;
  throw error;
}

function resolveToolDiscoveryQuery(options = {}) {
  const taskId = String(options.task_id || "").trim();
  const toolName = String(options.tool_name || "").trim();
  const inputContract = options.input_contract;

  if (inputContract?.kind === "guidance") {
    throwInputContractRefusal(toolInputGuidanceRequestRefusal(options));
  }
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
  if (inputContract !== undefined) {
    query.input_contract = inputContract;
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

  async function loadWorkspaceToolDiscoverySource(query = {}, { verbose = false } = {}) {
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
    return {
      augmentedDescriptor,
      envelope: createToolDiscoveryEnvelope({
        interface: "mcp",
        source_kind: "runtime_snapshot",
        package_versions,
        descriptor: augmentedDescriptor,
        query: tierQuery,
        verbose,
        results: roleVisibleResults
      })
    };
  }

  async function loadWorkspaceToolDiscoveryEnvelope(query = {}, options = {}) {
    return (await loadWorkspaceToolDiscoverySource(query, options)).envelope;
  }

  function measureToolDiscoveryListResultBytes(candidate) {
    return Buffer.byteLength(JSON.stringify(jsonContent(candidate)), "utf8");
  }

  async function loadWorkspaceToolDiscoveryListEnvelope(options = {}) {

    const query = resolveToolDiscoveryQuery(options);

    const filterQuery = { ...query };
    delete filterQuery.limit;
    delete filterQuery.offset;
    const { augmentedDescriptor, envelope } = await loadWorkspaceToolDiscoverySource(
      filterQuery,
      { verbose: false }
    );
    if (Object.keys(query).length > 0) {
      envelope.query = query;
    }
    const roleVisibleResults = Array.isArray(envelope.results) ? envelope.results : [];
    const limit = Number.isInteger(query.limit) && query.limit > 0
      ? query.limit
      : TOOL_DISCOVERY_LIST_DEFAULT_LIMIT;

    const offset = Number.isInteger(query.offset) && query.offset > 0 ? query.offset : 0;

    const sourceDigest = inputContractSourceDigest({
      source: TOOL_DISCOVERY_LIST_SOURCE,
      selector: filterQuery,
      descriptor_digest: digestToolDiscoveryDescriptor(augmentedDescriptor),
      rows: roleVisibleResults.map((entry) => compactToolDiscoveryListEntry(entry))
    });
    const pageCall = (pageOffset) => buildDispatchContinuation({
      tool: "workspace_tools_list",
      arguments: {
        ...filterQuery,
        limit,
        offset: pageOffset,
        expected_source_digest: sourceDigest
      },
      successPredicate: { fact: LIST_PAGE_RETURNED, operator: "is_true" },
      requestSchemaAuthority: discoveryRequestSchemaAuthority
    });
    const binding = inputContractSourceBindingRefusal({
      offset,
      expectedSourceDigest: typeof options.expected_source_digest === "string"
        ? options.expected_source_digest
        : undefined,
      currentSourceDigest: sourceDigest,
      source: TOOL_DISCOVERY_LIST_SOURCE,
      details: { query: filterQuery, limit },
      codes: {
        required: TOOL_DISCOVERY_LIST_CODES.SOURCE_DIGEST_REQUIRED,
        stale: TOOL_DISCOVERY_LIST_CODES.SOURCE_CHANGED
      },
      messages: {
        required: "expected_source_digest is required when offset is nonzero; restart the traversal at offset 0",
        stale: "the role- and tier-visible discovery source changed; restart the traversal at offset 0"
      },
      restartCalls: () => [pageCall(0)]
    });
    throwInputContractRefusal(binding);

    return createBoundedToolDiscoveryListEnvelope(
      { ...envelope, source_digest: sourceDigest },
      roleVisibleResults,
      {
        totalCount: roleVisibleResults.length,
        limit,
        offset,
        measureResultBytes: measureToolDiscoveryListResultBytes,
        createNextCalls(nextOffset) {
          return Number.isInteger(nextOffset) && nextOffset > offset ? [pageCall(nextOffset)] : [];
        }
      }
    );
  }

  async function loadWorkspaceToolDiscoveryDescribeEnvelope(options = {}) {

    throwInputContractRefusal(workRecordEditInputContractRequestRefusal(options, {
      editorVisible: shouldExposeTool(resolveSessionRole(), WORK_RECORD_EDIT_INPUT_CONTRACT_TOOL)
    }));
    const query = resolveToolDiscoveryQuery(options);
    const verbose = options.verbose === true;

    const rankRecoveryToolName = verbose ? query.tool_name : null;
    const projectionQuery = rankRecoveryToolName ? { ...query } : query;
    if (rankRecoveryToolName) {
      delete projectionQuery.tool_name;
      delete projectionQuery.limit;
      delete projectionQuery.input_contract;
    }
    const envelope = await loadWorkspaceToolDiscoveryEnvelope(projectionQuery, { verbose });
    if (rankRecoveryToolName && Array.isArray(envelope.results)) {
      envelope.results = envelope.results.filter(
        (entry) => entry.tool_name === rankRecoveryToolName
      );
      envelope.query = query;
    }
    if (query.tool_name && Array.isArray(envelope.results) && envelope.results.length === 0) {
      delete envelope.query;

      const bare = bareDiscoveryToolName(query.tool_name);
      const visible = bare === null
        ? null
        : await loadWorkspaceToolDiscoveryEnvelope({ tool_name: bare }, { verbose: false });
      if (Array.isArray(visible?.results) && visible.results.length > 0) {
        envelope.diagnostics = [{
          code: "unregistered_tool_name",
          severity: "error",
          authority_limb: "mechanical_failure",
          message: `${query.tool_name} is not a registered tool name. Discovery names tools ` +
            `bare, without a harness prefix: use ${bare}.`,
          requested_tool_name: query.tool_name,
          supported_tool_name: bare
        }];
        envelope.next_calls = [buildDispatchContinuation({
          tool: "workspace_tools_describe",
          arguments: { tool_name: bare, ...(verbose ? { verbose: true } : {}) },
          successPredicate: { fact: DESCRIBE_ENTRY_RETURNED, operator: "is_true" },
          requestSchemaAuthority: discoveryRequestSchemaAuthority
        })];
      }
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

    if (verbose && rankRecoveryToolName && Array.isArray(envelope.results)) {
      envelope.results = envelope.results.map((entry) => {
        const inputContract = completeToolInputContract(entry.tool_name);
        return inputContract === null ? entry : { ...entry, input_contract: inputContract };
      });
    }

    if (query.input_contract?.kind === "guidance" &&
        Array.isArray(envelope.results) && envelope.results.length > 0) {
      envelope.query = { tool_name: query.tool_name };
      envelope.results = envelope.results.map((entry) => {
        if (entry.tool_name !== query.tool_name) return entry;
        return {
          tool_name: entry.tool_name,
          input_guidance: deliverToolInputGuidance({
            toolName: entry.tool_name,
            guidance: registeredToolInputGuidance(entry.tool_name),
            selector: query.input_contract
          })
        };
      });
    }

    if (query.tool_name === WORK_RECORD_EDIT_INPUT_CONTRACT_TOOL &&
        query.input_contract?.kind !== "guidance" &&
        Array.isArray(envelope.results) && envelope.results.length > 0) {
      const requestFacts = createWorkRecordEditInputRequestFacts(z);
      const editorSchema = createWorkRecordEditInputSchema(z);
      const editorDescriptor = (await loadToolDiscoveryDescriptor()).tools.find(
        (candidate) => candidate.tool_name === WORK_RECORD_EDIT_INPUT_CONTRACT_TOOL
      );

      envelope.query = query.input_contract === undefined
        ? query
        : { tool_name: query.tool_name };
      envelope.results = envelope.results.map((entry) => {
        if (entry.tool_name !== WORK_RECORD_EDIT_INPUT_CONTRACT_TOOL) return entry;
        const guidedEntry = query.input_contract === undefined
          ? {
              ...entry,
              recommended_first_call: JSON.parse(JSON.stringify(
                editorDescriptor.recommended_first_call
              ))
            }
          : { tool_name: entry.tool_name };
        return {
          ...guidedEntry,
          editor_input_contract: deliverWorkRecordEditInputGuidance({
            entry: guidedEntry,
            selector: query.input_contract ?? null,
            requestFacts,
            editorSchema,
            writeSemanticsStatement: MCP_WRITE_SEMANTICS_STATEMENTS[
              MCP_WRITE_SEMANTICS.ACTION_REPLACE_OR_APPEND
            ],
            buildContinuation(argumentsValue, successFact) {
              return buildDispatchContinuation({
                tool: "workspace_tools_describe",
                arguments: argumentsValue,
                successPredicate: { fact: successFact, operator: "is_true" },
                requestSchemaAuthority: discoveryRequestSchemaAuthority
              });
            },
            measureResultBytes(candidateContract) {
              return measureToolDiscoveryListResultBytes({
                ...envelope,
                results: [{
                  ...guidedEntry,
                  editor_input_contract: candidateContract
                }],
                total_count: 1,
                limit_applied: limit,
                truncated: false
              });
            }
          })
        };
      });
    }
    return applyToolDiscoveryListPagination(envelope, { totalCount, limit });
  }

  recordOwnerRegisteredRequestSchema({
    registerTool,
    toolName: "workspace_tools_list",
    declaredInput: WORKSPACE_TOOLS_LIST_INPUT_SCHEMA
  });
  recordOwnerRegisteredRequestSchema({
    registerTool,
    toolName: "workspace_tools_describe",
    declaredInput: WORKSPACE_TOOLS_DESCRIBE_INPUT_SCHEMA
  });
  const discoveryRequestSchemaAuthority = requestSchemaAuthorityForRegistration(registerTool);

  registerTool(
    "workspace_tools_list",
    {
      description:
        "List role/tier-visible tool names and tasks. Follow next_calls while has_more for complete source-bound paging. Use workspace_tools_describe with tool_name and verbose:true for complete detail and rank.",
      inputSchema: WORKSPACE_TOOLS_LIST_INPUT_SCHEMA
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
        "Inspect tool routing and contracts. verbose:true restores all fields and a named compact tool's enforced schema with a guidance locator. input_contract selects editor field pages, or kind:\"guidance\": no path returns the overview; a literal path returns that complete value.",
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
}
