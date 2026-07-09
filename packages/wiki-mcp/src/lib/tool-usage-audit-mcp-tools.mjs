import path from "node:path";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createLiveMcpToolUsageRecorder } from "./tool-usage-audit/live-recorder.mjs";
import { aggregateToolUsageAudit } from "./tool-usage-audit/aggregate.mjs";

export const WORKSPACE_TOOL_USAGE_AUDIT_TOOL_NAME = "workspace_tool_usage_audit";

const require = createRequire(import.meta.url);
const WIKI_CORE_PACKAGE_ROOT = path.dirname(require.resolve("@agent-chassis/wiki-core/package.json"));
const DEFAULT_POLICY_PATH = path.join(WIKI_CORE_PACKAGE_ROOT, "data/tool-use-policy.v1.json");

export function createToolUsageAuditBoundaryRecorder({
  recorder = createLiveMcpToolUsageRecorder(),
  origin = null,
  selected = null,
  classifyMisuse = null,
  onRecorderError = null
} = {}) {
  async function observeToolCall({ toolName, args, response, handler }) {
    if (typeof handler !== "function") throw new Error("tool-usage audit boundary handler must be a function");
    if (!recorder || typeof recorder.recordEvent !== "function") {
      return handler(args);
    }

    const baseEvent = {
      toolName,
      args,
      response,
      origin: safeResolveBoundaryValue(origin, { toolName, args }, onRecorderError),
      selected: safeResolveBoundaryValue(selected, { toolName, args }, onRecorderError),
      misuse: safeResolveMisuseClassifications(classifyMisuse, { toolName, args }, onRecorderError)
    };

    try {
      const result = await handler(args);
      safeRecord(recorder, onRecorderError, {
        ...baseEvent,
        result,
        outcome: "returned",
        response: { ...response, result }
      });
      return result;
    } catch (error) {
      safeRecord(recorder, onRecorderError, {
        ...baseEvent,
        outcome: "threw",
        error
      });
      throw error;
    }
  }

  function wrapHandler(toolName, handler) {
    return async (args) => observeToolCall({ toolName, args, handler });
  }

  return {
    recorder,
    observeToolCall,
    wrapHandler,
    getEvents() {
      return typeof recorder?.getEvents === "function" ? recorder.getEvents() : [];
    },
    getDiagnostics() {
      return typeof recorder?.getDiagnostics === "function" ? recorder.getDiagnostics() : {};
    },
    clear() {
      if (typeof recorder?.clear === "function") recorder.clear();
    }
  };
}

export function registerToolUsageAuditTools({
  registerTool,
  z,
  jsonContent,
  errorContent,
  recorder = createLiveMcpToolUsageRecorder(),
  policy = null,
  policyPath = DEFAULT_POLICY_PATH
}) {
  if (typeof registerTool !== "function") throw new Error("registerTool is required");
  if (!z) throw new Error("zod instance is required");
  if (typeof jsonContent !== "function") throw new Error("jsonContent is required");
  if (typeof errorContent !== "function") throw new Error("errorContent is required");

  registerTool(
    WORKSPACE_TOOL_USAGE_AUDIT_TOOL_NAME,
    {
      description:
        "Read-only compact aggregate telemetry for observed agent MCP tool-use policy evidence. Returns bounded counts, provenance buckets, high-cost call indicators, unsupported-gap labels, and coarse guidance from redacted live audit facts. It does not dispatch, mutate work records, run lint/generate, block calls, or authorize routing.",
      inputSchema: z
        .object({
          max_facts: z.number().int().positive().max(5000).optional(),
          max_buckets: z.number().int().positive().max(200).optional(),
          max_top_calls: z.number().int().positive().max(100).optional(),
          max_guidance: z.number().int().positive().max(100).optional(),
          filter: z
            .object({
              caller_kind: z.string().optional(),
              session_kind: z.string().optional(),
              tool_profile: z.string().optional(),
              source_group: z.string().optional(),
              tool_name: z.string().optional()
            })
            .strict()
            .optional()
        })
        .strict()
    },
    async (args) => {
      try {
        return jsonContent(
          await createWorkspaceToolUsageAuditResponse({
            args,
            recorder,
            policy,
            policyPath
          })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  return recorder;
}

export async function createWorkspaceToolUsageAuditResponse({
  args = {},
  recorder,
  policy = null,
  policyPath = DEFAULT_POLICY_PATH
} = {}) {
  const facts = typeof recorder?.getEvents === "function" ? recorder.getEvents() : [];
  const loadedPolicy = policy ?? await loadToolUsePolicy(policyPath);
  const aggregate = aggregateToolUsageAudit(facts, {
    ...args,
    policy: loadedPolicy
  });
  return {
    tool: WORKSPACE_TOOL_USAGE_AUDIT_TOOL_NAME,
    mode: "read_only_observational",
    effects: {
      dispatches_agents: false,
      mutates_work_records: false,
      runs_lint_or_generate: false,
      blocks_tool_calls: false,
      authorizes_tool_calls: false,
      reinterprets_domain_results: false
    },
    aggregate,
    recorder_diagnostics: typeof recorder?.getDiagnostics === "function" ? recorder.getDiagnostics() : {}
  };
}

async function loadToolUsePolicy(policyPath) {
  const text = await readFile(policyPath, "utf8");
  return JSON.parse(text);
}

function resolveBoundaryValue(value, context) {
  return typeof value === "function" ? value(context) : value;
}

function resolveMisuseClassifications(classifyMisuse, context) {
  if (typeof classifyMisuse !== "function") return [];
  const result = classifyMisuse(context);
  return Array.isArray(result) ? result : [];
}

function safeResolveBoundaryValue(value, context, onRecorderError) {
  try {
    return resolveBoundaryValue(value, context);
  } catch (error) {
    reportRecorderError(onRecorderError, error);
    return null;
  }
}

function safeResolveMisuseClassifications(classifyMisuse, context, onRecorderError) {
  try {
    return resolveMisuseClassifications(classifyMisuse, context);
  } catch (error) {
    reportRecorderError(onRecorderError, error);
    return [];
  }
}

function reportRecorderError(onRecorderError, error) {
  if (typeof onRecorderError !== "function") return;
  try {
    onRecorderError(error);
  } catch {

  }
}

function safeRecord(recorder, onRecorderError, event) {
  try {
    recorder.recordEvent(event);
  } catch (error) {
    reportRecorderError(onRecorderError, error);
  }
}
