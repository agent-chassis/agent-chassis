import path from "node:path";
import { lintRepo } from "@agent-chassis/wiki-core";
import { optionalListOption, optionalOption, parseArgs } from "../lib/cli.mjs";

export async function runLint(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki lint [--dir <path>] [--profile <standard|research>] [--extensions a,b,c] [--require-json-open-work] [--all|--include-all-findings]"
    );
    return;
  }
  const targetDir = path.resolve(String(options.dir || "."));
  const includeAllFindings =
    options.all === true || options["include-all-findings"] === true;
  const result = await lintRepo({
    dir: targetDir,
    profile: optionalOption(options, "profile"),
    extensionNamespaces: optionalListOption(options, "extensions"),
    requireJsonOpenWork: options["require-json-open-work"] === true,
    includeAllFindings
  });
  const warnings = result.warnings || [];
  const problems = result.problems || [];
  const errorCount = Number(result.error_count || 0);
  const warningCount = Number(result.warning_count || 0);
  const findingCount = errorCount + warningCount;
  const returnedFindingCount = problems.length + warnings.length;
  const findingsTruncated =
    !includeAllFindings && returnedFindingCount < findingCount;

  for (const warning of warnings) {
    console.warn(`Warning: ${warning}`);
  }
  if (findingsTruncated) {
    console.warn(
      `Warning: listing is a compact projection of ${returnedFindingCount} of ${findingCount} total finding(s).`
    );
    console.warn(`Next action: ${result.next_action}`);
  }
  if (!result.ok) {
    for (const problem of problems) {
      console.error(problem);
    }
    throw new Error(
      `lint failed with ${errorCount} error(s) and ${warningCount} warning(s)`
    );
  }

  console.log(`Lint passed for ${targetDir}`);
  console.log(`Profile: ${result.profile}`);
}
