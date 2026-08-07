

export const STDIO_MCP_CONDUIT_LIFECYCLE_DESCRIPTOR_SCHEMA_VERSION =
  "stdio-mcp-conduit-lifecycle-descriptor.v1";

export const STDIO_MCP_CONDUIT_PRODUCER_PROTOCOL_GENERATION =
  "stdio-mcp-conduit-lifecycle-vocabulary.v1";

const AUTHENTICATED_PRODUCER_DESCRIPTORS = new WeakSet();

function mintProducerDescriptor(protocolGeneration) {
  const descriptor = Object.freeze({
    schema_version: STDIO_MCP_CONDUIT_LIFECYCLE_DESCRIPTOR_SCHEMA_VERSION,
    protocol_generation: protocolGeneration
  });
  AUTHENTICATED_PRODUCER_DESCRIPTORS.add(descriptor);
  return descriptor;
}

export const STDIO_MCP_CONDUIT_PRODUCER_DESCRIPTOR = mintProducerDescriptor(
  STDIO_MCP_CONDUIT_PRODUCER_PROTOCOL_GENERATION
);

export function isAuthenticatedStdioMcpConduitProducerDescriptor(descriptor) {
  return descriptor !== null && typeof descriptor === "object" &&
    AUTHENTICATED_PRODUCER_DESCRIPTORS.has(descriptor);
}

export function __mintStdioMcpConduitProducerDescriptorForTest(protocolGeneration) {
  return mintProducerDescriptor(protocolGeneration);
}
