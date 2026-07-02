import path from "node:path";
import { buildSearchIndex } from "@agent-chassis/wiki-core";
import { optionalListOption, optionalOption, parseArgs } from "../lib/cli.mjs";

export async function runBuildSearchIndex(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki build-search-index [--dir <path>] [--reindex] [--profile <standard|research>] [--extensions a,b,c]"
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const result = await buildSearchIndex({
    dir: targetDir,
    reindex: Boolean(options.reindex),
    profile: optionalOption(options, "profile"),
    extensionNamespaces: optionalListOption(options, "extensions")
  });

  console.log(`Built search index: ${result.indexPath}`);
  console.log(`Chunks: ${result.chunkCount}`);
  console.log(`Rebuilt: ${result.rebuilt ? "yes" : "no"}`);
}
