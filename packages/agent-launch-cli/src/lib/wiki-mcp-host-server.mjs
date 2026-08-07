

import { createRequire } from "node:module";
import {
  isAuthenticatedStdioMcpConduitProducerDescriptor
} from "@agent-chassis/wiki-mcp/src/lib/stdio-mcp-conduit-producer-descriptor.mjs";
import {
  LAUNCHER_READINESS_PRODUCER_DESCRIPTOR
} from "@agent-chassis/wiki-mcp/src/lib/launcher-readiness-observer.mjs";

export const WIKI_MCP_HOST_SERVER_PACKAGE_SUBPATH =
  "@agent-chassis/wiki-mcp/src/server.mjs";

const requireFromLauncher = createRequire(import.meta.url);
const TRUSTED_HOST_SERVER_BINDINGS = new WeakSet();

export function resolveWikiMcpHostServerPath() {
  try {
    return requireFromLauncher.resolve(WIKI_MCP_HOST_SERVER_PACKAGE_SUBPATH);
  } catch {
    return null;
  }
}

function mintHostServerBinding(entrypoint) {
  const binding = Object.freeze({
    entrypoint,
    producerDescriptor: LAUNCHER_READINESS_PRODUCER_DESCRIPTOR
  });
  if (typeof entrypoint === "string" && entrypoint.length > 0 &&
      entrypoint === resolveWikiMcpHostServerPath() &&
      isAuthenticatedStdioMcpConduitProducerDescriptor(
        LAUNCHER_READINESS_PRODUCER_DESCRIPTOR)) {
    TRUSTED_HOST_SERVER_BINDINGS.add(binding);
  }
  return binding;
}

export function resolveWikiMcpHostServerBinding() {
  return mintHostServerBinding(resolveWikiMcpHostServerPath());
}

export function isTrustedWikiMcpHostServerBinding(binding) {
  return binding !== null && typeof binding === "object" &&
    Object.isFrozen(binding) && TRUSTED_HOST_SERVER_BINDINGS.has(binding) &&
    typeof binding.entrypoint === "string" && binding.entrypoint.length > 0 &&
    binding.entrypoint === resolveWikiMcpHostServerPath() &&
    binding.producerDescriptor === LAUNCHER_READINESS_PRODUCER_DESCRIPTOR &&
    isAuthenticatedStdioMcpConduitProducerDescriptor(binding.producerDescriptor);
}
