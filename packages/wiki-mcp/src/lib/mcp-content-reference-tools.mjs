

import { readSpilledMcpContentReference } from "./mcp-response.mjs";

export const MCP_CONTENT_REFERENCE_READ_TOOL = "workspace_read_mcp_content_reference";

export function createMcpContentReferenceReadInputSchema(z) {
  return {
    ref_id: z.string(),
    offset: z.number().optional(),
    length: z.number().optional()
  };
}

export const MCP_CONTENT_REFERENCE_PAGE_STEPS = Object.freeze([
  "follow the reader's own next_offset on the same ref_id until it is null",
  "base64-decode each page's data_base64 separately",
  "concatenate the decoded bytes in page order",
  "verify the concatenated byte count against the reader's total_bytes and their sha256 against the reference's sha256"
]);

export function mcpContentReferenceReconstruction(finalStep) {
  return Object.freeze([...MCP_CONTENT_REFERENCE_PAGE_STEPS, finalStep]);
}

export function mcpContentReferenceReassembly(finalStep) {
  return mcpContentReferenceReconstruction(finalStep).join("; ");
}

export function mcpContentReferenceFirstCall(contentReference) {
  return Object.freeze({
    tool: contentReference.read_tool,
    arguments: Object.freeze({ ref_id: contentReference.ref_id,
      offset: contentReference.range.offset, length: contentReference.range.length })
  });
}

export function registerMcpContentReferenceTools({
  registerTool,
  z,
  jsonContent,
  errorContent,

  env = process.env
}) {
  registerTool(
    MCP_CONTENT_REFERENCE_READ_TOOL,
    {
      description:
        "Read a byte range from a server-side MCP response content reference created when an oversized lossless tool response is spilled instead of inlined. Use offset and length to reassemble the complete payload; length must not exceed the returned max_length.",
      inputSchema: createMcpContentReferenceReadInputSchema(z)
    },
    async (args) => {
      try {
        return jsonContent(
          readSpilledMcpContentReference({
            ref_id: args.ref_id,
            offset: args.offset ?? 0,
            length: args.length ?? null
          }, { env })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
