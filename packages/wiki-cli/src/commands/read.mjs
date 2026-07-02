import path from "node:path";
import {
  getWikiRecord,
  readWorkRecordById,
  readWikiPage
} from "@agent-chassis/wiki-core";
import { optionalListOption, optionalOption, parseArgs, requireOption } from "../lib/cli.mjs";

function printReadResult(result, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(result.markdown);
}

function printWorkRecordResult(result, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`JSON work record: ${result.source_path_relative || result.source_path}`);
  if (result.record_id) {
    console.log(`Record: ${result.record_id}`);
  }
  console.log(result.valid ? "valid" : "invalid");
  for (const diagnostic of result.diagnostics) {
    console.log(`- ${diagnostic.code}: ${diagnostic.message}`);
  }
}

function isWorkRecordId(id) {
  return /^(WK|IN|DEC|SRC)-\d+$/.test(String(id));
}

function isMissingWikiRecordError(error, id) {
  return error instanceof Error && error.message === `Wiki record not found: ${String(id)}`;
}

async function readCanonicalRecordById({ dir, id, profile, extensionNamespaces, verbose }) {
  try {
    return {
      kind: "wiki",
      value: await getWikiRecord({
        dir,
        id,
        profile,
        extensionNamespaces,
        verbose
      })
    };
  } catch (error) {
    if (!isWorkRecordId(id) || !isMissingWikiRecordError(error, id)) {
      throw error;
    }

    const workRecord = await readWorkRecordById({
      dir,
      id
    });
    if (!workRecord.valid) {
      throw error;
    }

    return {
      kind: "work-record",
      value: workRecord
    };
  }
}

export async function runRead(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki read --path <repo-relative-markdown-path> [--dir <path>] [--json] [--profile <standard|research>] [--extensions a,b,c]"
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const result = await readWikiPage({
    dir: targetDir,
    path: requireOption(options, "path", "read requires --path"),
    profile: optionalOption(options, "profile"),
    extensionNamespaces: optionalListOption(options, "extensions"),
    verbose: true
  });

  printReadResult(result, { json: Boolean(options.json) });
}

export async function runGetRecord(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki get-record --id <WK-0001|IN-0001|DEC-0001|SRC-0001|area-slug> [--dir <path>] [--json] [--profile <standard|research>] [--extensions a,b,c]\nJSON work records under wiki/work-records/<ID>.json are resolved when the wiki page is absent."
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const record = await readCanonicalRecordById({
    dir: targetDir,
    id: requireOption(options, "id", "get-record requires --id"),
    profile: optionalOption(options, "profile"),
    extensionNamespaces: optionalListOption(options, "extensions"),
    verbose: true
  });

  if (record.kind === "work-record") {
    printWorkRecordResult(record.value, { json: Boolean(options.json) });
    return;
  }

  printReadResult(record.value, { json: Boolean(options.json) });
}
