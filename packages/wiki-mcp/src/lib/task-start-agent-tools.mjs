
import { guardToolHandler, jsonContent, errorContent } from "./mcp-response.mjs";
import { createToolInputValidationError } from "./register-tool.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { createStartAgentTask } from "./task-start-agent.mjs";
import { createSaveRecordInputContract } from "./task-save-record-tools.mjs";
import { parseToolProfile } from "./tool-profile.mjs";
import { recordOwnerRegisteredRequestSchema } from "./dispatch-tool-helpers.mjs";

export const START_AGENT_TOOL_NAME = "start_agent";

export function buildStartAgentBaseCorrectionCall({ correction, baseBranch }, z) {
  const args = { unit: correction.root_unit, revision: correction.revision,
    changes: { base_branch: baseBranch } };
  createSaveRecordInputContract(z).inputSchema.parse(args);
  return { tool: "save_record", arguments: args, recommended: true };
}
export function createStartAgentInputContract(z) {
  const shape = z.object({
    subject: z.string().regex(/^WK-\d{4}(?:#SLICE-\d{3})?$/u).optional(),
    role: z.enum(["worker", "reviewer", "redteam"]).optional(),
    app: z.string().min(1).optional(), model: z.string().min(1).optional(),
    diff_base_sha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u).optional(),
    reviewed_sha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u).optional(),
    preview: z.boolean().optional()
  }).strict();
  const inputSchema = shape.superRefine((value, context) => {
    const issue = (path, message) => context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (value.subject === undefined && (value.preview !== true || value.role === undefined)) {
      issue(value.preview === true ? "role" : "subject", value.preview === true
        ? "Capability preview requires role: worker, reviewer or redteam; no subject is required"
        : "Start/action preview requires subject; alternatively choose a role for capability preview with preview:true");
    }
    if ((value.diff_base_sha === undefined) !== (value.reviewed_sha === undefined)) {
      issue("reviewed_sha", "Supply the complete diff_base_sha/reviewed_sha pair");
    }
    if (value.diff_base_sha !== undefined && (value.subject === undefined || value.role === "worker")) {
      issue("diff_base_sha", "The pair selects review material for a subject-bearing findings role");
    }
  });
  const inputValidationError = (request, validationError) => {
    const missingChoice = request?.subject === undefined && request?.role === undefined;
    const roleChoices = missingChoice ? ["worker", "reviewer", "redteam"].map(role => {
      const args = { preview: true, role };
      inputSchema.parse(args);
      return buildNextCall({ tool: START_AGENT_TOOL_NAME, arguments: args });
    }) : [];
    return createToolInputValidationError({ tool: START_AGENT_TOOL_NAME, validationError,
      details: { correction: request?.preview === true && request?.subject === undefined
        ? "Choose a role for capability preview; subject is not required."
        : "Supply subject for normal start/action preview, or choose a role for subject-free capability preview.",
      ...(roleChoices.length === 0 ? {} : { role_choices: roleChoices,
        choice_state: "caller_role_not_selected" }) } });
  };
  return Object.freeze({ inputSchema, inputValidationError, declaredInput: shape, advertisedInputSchema: shape.describe(
    "Start with subject only; role derives from the saved unit. Managed worker implementation " +
    "requires an exact slice, for example WK-0001#SLICE-001. Parent targets remain role-dependent. " +
    "preview:true selects action preview, " +
    "or subject-free capabilities with required role: {\"preview\":true,\"role\":\"worker\"} or " +
    "{\"preview\":true,\"role\":\"reviewer\"}. SHA pairs are complete and findings-only.") });
}

export function registerStartAgentTool({ registerTool, z, ...configuration }) {
  const inputContract = createStartAgentInputContract(z);
  const task = createStartAgentTask({ ...configuration, inputContract });
  if (parseToolProfile(configuration.sessionEnv ?? process.env) !== "orchestrator") return task;
  registerTool(START_AGENT_TOOL_NAME, {
    description: "Start one canonical assignment, preview its readonly action, or preview configured " +
      "capabilities without a subject, with required role. Orchestrator-only. Starts never integrate; previews never spawn. " +
      'Managed worker implementation requires an exact slice. Examples: ' +
      '{"subject":"WK-0001#SLICE-001"}; {"subject":"WK-0001#SLICE-001","preview":true}; ' +
      '{"subject":"WK-0001","role":"reviewer","preview":true}; ' +
      '{"preview":true,"role":"worker"}; {"preview":true,"role":"reviewer"}.',
    inputSchema: inputContract.inputSchema,
    advertisedInputSchema: inputContract.advertisedInputSchema,
    inputValidationErrorProjector: ({ args, validationError }) => ({ terminal_result: errorContent(
      inputContract.inputValidationError(args, validationError), { env: configuration.responseEnv ?? process.env }) })
  }, guardToolHandler(async request => jsonContent(await task.prepare(request), {
    env: configuration.responseEnv ?? process.env
  }), { env: configuration.responseEnv ?? process.env }));

  recordOwnerRegisteredRequestSchema({ registerTool, toolName: START_AGENT_TOOL_NAME,
    declaredInput: inputContract.declaredInput });
  return task;
}
