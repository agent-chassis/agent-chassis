import path from "node:path";
import { validateDocsPolicyOperation } from "@agent-chassis/wiki-core";
import { optionalListOption, parseArgs } from "../lib/cli.mjs";

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function formatResult(result) {
  const lines = [
    `Docs policy: ${result.valid ? "ok" : "drift"}`,
    `Files scanned: ${result.files_scanned.length}`,
    `Diagnostics: ${result.diagnostics.length}`
  ];
  for (const diagnostic of result.diagnostics) {
    lines.push(
      `- [${diagnostic.level}] ${diagnostic.code} :: ${diagnostic.file}:${diagnostic.line} :: ${diagnostic.message}`
    );
  }
  return lines.join("\n");
}

async function runValidate(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki docs-policy validate [--paths <path[,path]>] [--dir <path>] [--json]\n" +
        "Validate agent-facing docs for non-MCP role-dispatch authority drift."
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const paths = optionalListOption(options, "paths");
  const result = await validateDocsPolicyOperation({
    dir: targetDir,
    paths: paths && paths.length > 0 ? paths : null
  });

  if (options.json) {
    printJson(result);
  } else {
    console.log(formatResult(result));
  }

  if (!result.valid) {
    process.exitCode = 1;
  }
}

export async function runDocsPolicy(argv) {
  const [subcommand = "validate", ...rest] = argv;
  switch (subcommand) {
    case "validate":
      await runValidate(rest);
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(
        "Usage: wiki docs-policy <validate> [options]\n" +
          "Validate agent-facing docs for non-MCP role-dispatch authority drift."
      );
      return;
    default:
      throw new Error(`Unknown docs-policy subcommand: ${subcommand}`);
  }
}
