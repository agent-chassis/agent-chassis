

import path from "node:path";
import {
  getWorkRecordSummary,
  readWorkRecordById,
  readWorkRecordByPath
} from "@agent-chassis/wiki-core";
import { parseArgs, requireOption } from "../../lib/cli.mjs";
import { printJson } from "./output.mjs";

function markJsonExitCode(result) {
  if (!result.valid) {
    process.exitCode = 1;
  }
}

export async function runLoad(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records load (--id <WK-0001> | --path <repo-relative-json-path>) [--dir <path>] [--json]\n" +
        "Inspect canonical JSON work-records by id or path."
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const result = options.path
    ? await readWorkRecordByPath({
        dir: targetDir,
        path: requireOption(options, "path", "work-records load requires --path"),
        recordStore: null
      })
    : await readWorkRecordById({
        dir: targetDir,
        id: requireOption(options, "id", "work-records load requires --id"),
        recordStore: null
      });

  if (options.json) {
    printJson(result);
    markJsonExitCode(result);
    return;
  }

  console.log(result.valid ? "valid" : "invalid");
  console.log(`Record: ${result.record_id || "(missing)"}`);
  console.log(`Path: ${result.source_path_relative || result.source_path}`);
  for (const diagnostic of result.diagnostics) {
    console.log(`- ${diagnostic.code}: ${diagnostic.message}`);
  }
}

export async function runDigest(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records digest (--id <WK-0001> | --path <repo-relative-json-path>) [--dir <path>] [--json]\n" +
        "Inspect canonical JSON work-records by id or path."
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const result = options.path
    ? await readWorkRecordByPath({
        dir: targetDir,
        path: requireOption(options, "path", "work-records digest requires --path"),
        recordStore: null
      })
    : await readWorkRecordById({
        dir: targetDir,
        id: requireOption(options, "id", "work-records digest requires --id"),
        recordStore: null
      });

  if (options.json) {
    printJson({
      record_id: result.record_id,
      source_path: result.source_path_relative || result.source_path,
      source_digest: result.source_digest,
      valid: result.valid
    });
    markJsonExitCode(result);
    return;
  }

  console.log(result.source_digest || "(missing)");
}

export async function runValidate(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records validate (--id <WK-0001> | --path <repo-relative-json-path>) [--dir <path>] [--json]\n" +
        "Inspect canonical JSON work-records by id or path."
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const result = options.path
    ? await readWorkRecordByPath({
        dir: targetDir,
        path: requireOption(options, "path", "work-records validate requires --path"),
        recordStore: null
      })
    : await readWorkRecordById({
        dir: targetDir,
        id: requireOption(options, "id", "work-records validate requires --id"),
        recordStore: null
      });

  if (options.json) {
    printJson({
      valid: result.valid,
      diagnostics: result.diagnostics
    });
    markJsonExitCode(result);
    return;
  }

  console.log(result.valid ? "valid" : "invalid");
  for (const diagnostic of result.diagnostics) {
    console.log(`- ${diagnostic.code}: ${diagnostic.message}`);
  }
}

export async function runSummary(argv) {
  const { options } = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: wiki work-records summary (--unit <WK-0001|WK-0001#slice-id> | --id <WK-0001> | --path <repo-relative-json-path>) [--dir <path>] [--json]\n" +
        "Return a compact work-record summary view: dependencies, write_scope, acceptance, slices, validation, owners, review state, blockers."
    );
    return;
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const unitSelector = options.unit ? String(options.unit) : null;
  const idSelector = options.id ? String(options.id) : null;
  const pathSelector = options.path ? String(options.path) : null;

  if (!unitSelector && !idSelector && !pathSelector) {
    throw new Error(
      "work-records summary requires --unit <WK-0001|WK-0001#slice-id>, --id <WK-0001>, or --path <repo-relative-json-path>"
    );
  }

  const result = await getWorkRecordSummary({
    dir: targetDir,
    id: idSelector,
    unit: unitSelector,
    pathInput: pathSelector,
    recordStore: null
  });

  if (options.json) {
    printJson(result);
    if (!result.valid) {
      process.exitCode = 1;
    }
    return;
  }

  console.log(result.valid ? "valid" : "invalid");
  console.log(`Record: ${result.record_id || "(missing)"}`);
  if (result.source_path_relative || result.source_path) {
    console.log(`Path: ${result.source_path_relative || result.source_path}`);
  }
  if (result.summary) {

    const summary = result.summary;
    const arr = (value) => (Array.isArray(value) ? value : []);
    const dependencies = summary.dependencies || {};
    const acceptance = summary.acceptance || {};
    const reviewState = summary.review_state || {};
    console.log(`Title: ${summary.title || "(missing)"}`);
    console.log(`Status: ${summary.status || "(missing)"}`);
    console.log(`Owner: ${summary.owner || "(missing)"}`);
    console.log(`Owners: ${arr(summary.owners).join(", ") || "(none)"}`);
    console.log(`Initiative: ${summary.initiative || "(none)"}`);
    console.log(
      `Dependencies: depends_on=${arr(dependencies.depends_on).length} blocks=${arr(dependencies.blocks).length} related=${arr(dependencies.related).length}`
    );
    console.log(`Write scope: ${arr(summary.write_scope).length} entries`);
    console.log(`Acceptance criteria: ${arr(acceptance.criteria).length}`);
    console.log(`Validation: ${arr(summary.validation).length}`);
    const totalSlices =
      typeof summary.slice_count === "number" ? summary.slice_count : arr(summary.slices).length;
    console.log(`Slices: ${totalSlices}`);
    if (typeof summary.slice_count === "number") {
      console.log(`Open slices: ${arr(summary.slices).length}`);
    }
    console.log(
      `Review state: required=${Boolean(reviewState.required)} status=${reviewState.status || "(none)"}`
    );
    console.log(`Blockers: ${arr(summary.blockers).length}`);
  }
  for (const diagnostic of result.diagnostics || []) {
    console.log(`- ${diagnostic.code}: ${diagnostic.message}`);
  }
  if (!result.valid) {
    process.exitCode = 1;
  }
}
