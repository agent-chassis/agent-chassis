

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
        "Read-only bounded agent FAQ with compact-index-first disclosure. An empty call returns discovery-only tier-projected rows (id, title, actor, related_codes, plus a complete symptom only when its JSON string is at most 160 bytes), not full entries; the pretty-printed UTF-8 response is capped at 4096 bytes. Pass an exact id for one bounded detail entry or related_code for bounded matching detail entries. total/returned/omitted and entries_truncated report omitted results; entry_fields_clipped and clipped_entry_count separately report bounded fields, so truncated is false whenever every match was returned. Free/local output omits paid/CCE remediation entries. Performs no writes and accepts no caller-supplied filesystem root.",
      inputSchema: {
        id: z.string().max(256).optional(),
        related_code: z.string().max(256).optional()
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
