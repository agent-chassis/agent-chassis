import { guardToolHandler, jsonContent } from "./mcp-response.mjs";
import { createIntegrateWorkTask } from "./task-integrate-work.mjs";
import { INTEGRATE_WORK_TOOL_NAME } from "./task-integrate-work-schema.mjs";
import { registeredToolRequestContracts } from "./registered-tool-request-contracts.mjs";
import { recordOwnerRegisteredRequestSchema } from "./dispatch-tool-helpers.mjs";

export function registerIntegrateWorkTools({ registerTool, ...configuration }) {
  const task = createIntegrateWorkTask({ ...configuration, requestContracts: registeredToolRequestContracts(registerTool) });
  registerTool(INTEGRATE_WORK_TOOL_NAME, {
    description: "Integrate one delivery acquired through supported observation. Requires an authenticated orchestrator session. " +
      "After a reported remaining condition is corrected, repeat the exact selection to finish only its unfinished effects.",
    inputSchema: task.inputContract.advertisedInputSchema, writeSemantics: "none"
  }, guardToolHandler(async request => {
    const frame = await task.prepare(request);
    return task.deliver(frame);
  }, { env: configuration.responseEnv ?? configuration.sessionEnv ?? process.env }));
  recordOwnerRegisteredRequestSchema({ registerTool, toolName: INTEGRATE_WORK_TOOL_NAME,
    declaredInput: task.inputContract.inputSchema });
  return task;
}
