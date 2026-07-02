import path from "node:path";

import {
  WORK_REPORT_INGESTION_DECISION_CODES,
  ingestWorkReport
} from "@agent-chassis/wiki-core";
import { parseArgs, requireOption } from "../lib/cli.mjs";

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printSummary(result) {
  console.log(`Decision: ${result.decision_code}`);
  console.log(`Valid: ${result.valid}`);
  console.log(`Unit: ${result.unit_address}`);
  console.log(`Written: ${result.written}`);
  if (result.reasons.length > 0) {
    console.log(`Reasons: ${result.reasons.join("; ")}`);
  }
}

export async function runWorkReportIngestion(argv) {
  const { positionals, options } = parseArgs(argv);
  const [subcommand = "ingest"] = positionals;

  if (options.help || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    console.log(
      [
        "Usage: wiki work-report-ingestion [ingest] --unit <WK-0001|WK-0001#slice-id> --report-path <path> [--dir <path>] [--json]",
        "",
        `Decision codes: ${WORK_REPORT_INGESTION_DECISION_CODES.join(", ")}`
      ].join("\n")
    );
    return;
  }

  if (subcommand !== "ingest") {
    throw new Error(`Unknown work-report-ingestion subcommand: ${subcommand}`);
  }

  const result = await ingestWorkReport({
    dir: path.resolve(String(options.dir || ".")),
    unitAddress: requireOption(
      options,
      "unit",
      "work-report-ingestion requires --unit <WK-0001|WK-0001#slice-id>"
    ),
    reportPath: requireOption(
      options,
      "report-path",
      "work-report-ingestion requires --report-path <path>"
    )
  });

  if (options.json) {
    printJson(result);
    return;
  }

  printSummary(result);
}
