

import {
  NODE_ENGINE_API_SMOKE_ENV_KEYS,
  NODE_ENGINE_BOOTSTRAP_ENV_KEYS,
  bootstrapNodeEngineEnvFromFile,
  parseDotEnvText,
  resolveNodeEngineEnvFilePath
} from "@agent-chassis/wiki-core/src/lib/node-engine-env-bootstrap.mjs";

export {
  NODE_ENGINE_API_SMOKE_ENV_KEYS,
  NODE_ENGINE_BOOTSTRAP_ENV_KEYS,
  parseDotEnvText
};

export const NODE_ENGINE_ENV_BOOTSTRAP_SCHEMA_VERSION =
  "wiki-mcp-node-engine-env-bootstrap.v1";

export function bootstrapWikiMcpNodeEngineEnv({
  env = process.env,
  readFileText
} = {}) {
  const workspaceDir =
    typeof env?.WIKI_MCP_WORKSPACE_DIR === "string"
      ? env.WIKI_MCP_WORKSPACE_DIR.trim()
      : "";
  const envFilePath = resolveNodeEngineEnvFilePath(workspaceDir);
  const core = bootstrapNodeEngineEnvFromFile({ env, envFilePath, readFileText });
  return Object.freeze({
    schema_version: NODE_ENGINE_ENV_BOOTSTRAP_SCHEMA_VERSION,
    workspace_dir_present: workspaceDir !== "",
    ...core
  });
}
