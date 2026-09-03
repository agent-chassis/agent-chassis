

import { readSpilledMcpContentReference } from "./mcp-response.mjs";

export function registerMcpContentReferenceTools({
  registerTool,
  z,
  jsonContent,
  errorContent
}) {
  registerTool(
    "workspace_read_mcp_content_reference",
    {
      description:
        "Read a byte range from a server-side MCP response content reference created when an oversized lossless tool response is spilled instead of inlined. Use offset and length to reassemble the complete payload; length must not exceed the returned max_length.",
      inputSchema: {
        ref_id: z.string(),
        offset: z.number().optional(),
        length: z.number().optional()
      }
    },
    async (args) => {
      try {
        return jsonContent(
          readSpilledMcpContentReference({
            ref_id: args.ref_id,
            offset: args.offset ?? 0,
            length: args.length ?? null
          })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
