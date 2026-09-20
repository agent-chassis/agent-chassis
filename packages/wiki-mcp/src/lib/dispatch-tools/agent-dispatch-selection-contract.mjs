

import { AGENT_DISPATCH_ROLE_VALUES } from "../dispatch-tool-constants.mjs";

export function agentDispatchSelectionShape(z) {
  return {
    repo: z.string().optional().describe("Configured workspace repository alias; not an agent app."),
    app: z.string().optional().describe(
      "Optional agent app assertion checked against the role's configured model."
    ),
    model: z.string().optional(),
    role: z.enum(AGENT_DISPATCH_ROLE_VALUES),
    subject: z.string()
  };
}

export function agentDispatchRoutingInput({ role, subject, app, model }, workspace) {
  return {
    role,
    subject,
    target: subject,
    target_role: role,
    workspace_dir: workspace.dir,
    app,
    model
  };
}
