

import { getAgentFaq } from "@agent-chassis/wiki-core";

export function registerAgentFaqTools({
  registerTool,
  z,
  jsonContent,
  errorContent,

  registeredTier = null
}) {
  registerTool(
    "workspace_agent_faq",
    {
      description:
        "Read-only agent FAQ: serve the agent-faq.v1 known-issues corpus, where each entry pairs a recurring symptom and cause with the exact structured workspace_* route(s) to resolve it and the responsible actor (agent vs operator). Output is tier-projected: free/local responses show only source-available coordination entries and omit paid/CCE remediation entries, which appear only under a valid paid/CCE key posture. Returns all tier-visible entries by default; pass id to fetch one entry or related_code to filter by a runtime-blocker code. Performs no writes and accepts no caller-supplied filesystem root.",
      inputSchema: {
        id: z.string().optional(),
        related_code: z.string().optional()
      }
    },
    async (args) => {
      try {
        const result = getAgentFaq({
          id: args.id ?? null,
          related_code: args.related_code ?? null,
          registered_tier: registeredTier
        });
        return jsonContent(result);
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
