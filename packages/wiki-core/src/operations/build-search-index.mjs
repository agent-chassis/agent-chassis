import path from "node:path";
import { ensureLexicalSearchIndex } from "../lib/search.mjs";

export async function buildSearchIndex({
  dir = ".",
  reindex = false,
  profile = null,
  extensionNamespaces = null
} = {}) {
  const targetDir = path.resolve(String(dir));
  const { index, indexPath, rebuilt, indexState, indexStateReason } =
    await ensureLexicalSearchIndex(targetDir, {
      reindex,
      profile,
      extensionNamespaces
    });

  return {
    targetDir,
    indexPath,
    rebuilt,
    indexState,
    indexStateReason,
    version: index.version,
    mode: index.mode,
    chunkCount: index.chunkCount,
    builtAt: index.builtAt,
    sourceSignature: index.sourceSignature,
    extensionNamespaces: index.extensionNamespaces || []
  };
}
