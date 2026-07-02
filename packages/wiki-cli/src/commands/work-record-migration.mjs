import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  migrateWorkRecordMarkdownOperation,
  renderWorkRecordMarkdown
} from "@agent-chassis/wiki-core";
import { parseArgs, requireOption } from "../lib/cli.mjs";

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function requireSelection(options) {
  if (options.id && options.path) {
    throw new Error("work-record-migration accepts either --id or --path, not both");
  }

  if (!options.id && !options.path) {
    throw new Error("work-record-migration requires --id or --path");
  }
}

async function writeTextFile(targetDir, relativePath, content) {
  const absolutePath = path.resolve(targetDir, relativePath);
  const directory = path.dirname(absolutePath);
  await mkdir(directory, { recursive: true });
  const tempDir = await mkdtemp(path.join(directory, ".record-tmp-"));
  const tempPath = path.join(tempDir, path.basename(absolutePath));
  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, absolutePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function formatTextResult(result) {
  const lines = [
    result.decision_code,
    `Source: ${result.source_path || "(missing)"}`,
    `Target: ${result.target_path || "(none)"}`
  ];

  if (result.review_required_fields?.length) {
    lines.push(`Review required: ${result.review_required_fields.join(", ")}`);
  }

  for (const diagnostic of result.diagnostics || []) {
    lines.push(`- ${diagnostic.code}: ${diagnostic.message}`);
  }

  return lines.join("\n");
}

export async function runWorkRecordMigration(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-record-migration (--id <WK-0001> | --path <repo-relative-markdown-path>) [--dir <path>] [--json] [--write] [--render-markdown] [--migrated-at <iso8601>]"
    );
    return;
  }

  requireSelection(options);

  const targetDir = path.resolve(String(options.dir || "."));
  const result = await migrateWorkRecordMarkdownOperation({
    dir: targetDir,
    id: options.id ? requireOption(options, "id", "work-record-migration requires --id") : null,
    path: options.path ? requireOption(options, "path", "work-record-migration requires --path") : null,
    migratedAt: options["migrated-at"] || null
  });

  let markdown = null;
  if (options["render-markdown"] && result.record) {
    markdown = renderWorkRecordMarkdown(result.record, {
      generatedAt: options["generated-at"] || undefined,
      outputPath: result.source_path || undefined
    }).markdown;
  }

  if (options.write && result.valid === false) {
    const diagnostics = (result.diagnostics || [])
      .filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);
    const suffix = diagnostics.length ? `: ${diagnostics.join("; ")}` : "";
    throw new Error(`Refusing to write invalid migrated work record${suffix}`);
  }

  if (options.write && result.record && result.target_path) {
    await writeTextFile(targetDir, result.target_path, `${JSON.stringify(result.record, null, 2)}\n`);
    if (markdown != null) {
      await writeTextFile(targetDir, result.source_path, markdown);
    }
  }

  if (options.json) {
    printJson({
      ...result,
      markdown
    });
    return;
  }

  console.log(formatTextResult(result));
  if (markdown != null) {
    console.log("");
    console.log(markdown);
  }
}
