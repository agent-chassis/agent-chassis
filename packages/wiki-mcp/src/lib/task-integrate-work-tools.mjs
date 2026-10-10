import { guardToolHandler, jsonContent } from "./mcp-response.mjs";
import { createIntegrateWorkTask } from "./task-integrate-work.mjs";
import { INTEGRATE_WORK_TOOL_NAME } from "./task-integrate-work-schema.mjs";

export function registerIntegrateWorkTools({ registerTool, ...configuration }) {
  const task = createIntegrateWorkTask(configuration);
  registerTool(INTEGRATE_WORK_TOOL_NAME, {
    description: "Approve one immutable delivered result and integrate it. Repeating the selection repairs only missing completion effects. Saved judgments are advisory; no terminal candidate is constructed.",
    inputSchema: task.inputContract.advertisedInputSchema, writeSemantics: "none"
  }, guardToolHandler(async request => {
    const frame = await task.prepare(request);
    return jsonContent(frame.body, { env: configuration.responseEnv ?? configuration.sessionEnv ?? process.env });
  }, { env: configuration.responseEnv ?? configuration.sessionEnv ?? process.env }));
  return task;
}
