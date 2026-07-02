import path from "node:path";
import {
  checkWorkRecordRenderByPath,
  renderWorkRecordAgentBriefById,
  renderWorkRecordMarkdownById
} from "@agent-chassis/wiki-core";
import { parseArgs, requireOption } from "../lib/cli.mjs";

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printProjectionResult(result, { json = false, field = "markdown" } = {}) {
  if (json) {
    printJson(result);
    return;
  }

  console.log(result[field] || "");
}

async function runMarkdown(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-record-render markdown (--id <WK-0001> | --path <repo-relative-json-path>) [--dir <path>] [--slice-id <slice-id>] [--output-path <path>] [--json]"
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const result = await renderWorkRecordMarkdownById({
    dir: targetDir,
    id: options.path ? null : requireOption(options, "id", "work-record-render markdown requires --id"),
    path: options.path || null,
    generatedAt: options["generated-at"] || null,
    outputPath: options["output-path"] || null,
    sliceId: options["slice-id"] || null
  });

  printProjectionResult(result, { json: Boolean(options.json), field: "markdown" });
}

async function runAgentBrief(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-record-render agent-brief (--id <WK-0001> | --path <repo-relative-json-path>) [--dir <path>] [--slice-id <slice-id>] [--output-path <path>] [--json]"
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const result = await renderWorkRecordAgentBriefById({
    dir: targetDir,
    id: options.path ? null : requireOption(options, "id", "work-record-render agent-brief requires --id"),
    path: options.path || null,
    generatedAt: options["generated-at"] || null,
    outputPath: options["output-path"] || null,
    sliceId: options["slice-id"] || null
  });

  printProjectionResult(result, { json: Boolean(options.json), field: "brief" });
}

async function runCheck(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-record-render check --path <repo-relative-json-path> [--dir <path>] [--source-dir <path>] [--json]"
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const result = await checkWorkRecordRenderByPath({
    dir: targetDir,
    path: requireOption(options, "path", "work-record-render check requires --path"),
    sourceDir: options["source-dir"] || null
  });

  if (options.json) {
    printJson(result);
    return;
  }

  console.log(result.valid ? "valid" : "invalid");
  console.log(`Path: ${result.source_path || "(missing)"}`);
  for (const diagnostic of result.diagnostics || []) {
    console.log(`- ${diagnostic.code}: ${diagnostic.message}`);
  }
}

export async function runWorkRecordRender(argv) {
  const [subcommand = "markdown", ...rest] = argv;

  switch (subcommand) {
    case "markdown":
      await runMarkdown(rest);
      return;
    case "agent-brief":
      await runAgentBrief(rest);
      return;
    case "check":
      await runCheck(rest);
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(
        "Usage: wiki work-record-render <markdown|agent-brief|check> [--id <WK-0001> | --path <repo-relative-json-path>] [--dir <path>] [--slice-id <slice-id>] [--output-path <path>] [--source-dir <path>] [--json]"
      );
      return;
    default:
      throw new Error(`Unknown work-record-render subcommand: ${subcommand}`);
  }
}
