
import { z } from "zod";
import { buildSidecarIndex } from "@agent-chassis/wiki-core";
import {
  getSidecarSymbolCallers,
  getSidecarSymbolCallees,
  getSidecarSymbolDefinition,
  getSidecarSymbolReferences
} from "@agent-chassis/wiki-core/src/lib/sidecar-symbol-query.mjs";
import { publishedQueryContext } from "@agent-chassis/wiki-core/src/lib/sidecar-published-preparation.mjs";
import { registerCodeIndexQueryTools } from "./code-index-query-tools.mjs";
import { resolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";

function codeIndexWriterHandler({ rebuild, workspaceRepos, jsonContent, errorContent }) {
  return async (args) => {
    try {
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      const result = await buildSidecarIndex({
        ...args,
        dir: workspace.dir,
        ...(rebuild ? { rebuild: true } : {})
      });
      return jsonContent({ workspaceRepo: workspace.repo, ...result });
    } catch (error) {
      return errorContent(error);
    }
  };
}

const codeIndexWriterInputSchema = () => ({
  repo: z.string().optional(),
  cacheDir: z.string().optional()
});

export function registerCodeIndexTools({ registerTool, workspaceRepos, jsonContent, errorContent,
  env = process.env, published = publishedQueryContext() }) {
  const shared = { workspaceRepos, jsonContent, errorContent };
  registerTool(
    "workspace_code_index_build",
    {
      description:
        "Prepare the configured repo's ignored code-index cache for the current HEAD and wait for it; queries answer from the published index and refresh it in the background.",
      inputSchema: codeIndexWriterInputSchema()
    },
    codeIndexWriterHandler({ rebuild: false, ...shared })
  );

  registerTool(
    "workspace_code_index_rebuild",
    {
      description:
        "Force a clean rebuild that re-extracts current checkout sources and wait for it; queries answer from the published index and refresh it in the background.",
      inputSchema: codeIndexWriterInputSchema()
    },
    codeIndexWriterHandler({ rebuild: true, ...shared })
  );

  registerCodeIndexQueryTools({
    registerTool,
    env,
    published,
    navigation: {
      definition: getSidecarSymbolDefinition,
      references: getSidecarSymbolReferences,
      callers: getSidecarSymbolCallers,
      callees: getSidecarSymbolCallees
    },
    ...shared
  });
}
