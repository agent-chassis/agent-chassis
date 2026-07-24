

import { createRequire } from "node:module";

export const WIKI_MCP_HOST_SERVER_PACKAGE_SUBPATH =
  "@agent-chassis/wiki-mcp/src/server.mjs";

const requireFromLauncher = createRequire(import.meta.url);

export function resolveWikiMcpHostServerPath() {
  try {
    return requireFromLauncher.resolve(WIKI_MCP_HOST_SERVER_PACKAGE_SUBPATH);
  } catch {
    return null;
  }
}
