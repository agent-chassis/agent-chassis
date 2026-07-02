import path from "node:path";
import { generateViews } from "@agent-chassis/wiki-core";
import { optionalListOption, optionalOption, parseArgs } from "../lib/cli.mjs";

export async function runGenerate(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki generate [--dir <path>] [--profile <standard|research>] [--extensions a,b,c]"
    );
    return;
  }
  const targetDir = path.resolve(String(options.dir || "."));
  const result = await generateViews({
    dir: targetDir,
    profile: optionalOption(options, "profile"),
    extensionNamespaces: optionalListOption(options, "extensions")
  });
  console.log(`Generated ${result.generatedViews.length} standard views in ${targetDir}/wiki`);
  console.log(`Generated auxiliary summary: ${result.summaryPath}`);
}
