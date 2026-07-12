import path from "node:path";
import {
  ratifyDecisionRecord,
  unratifyDecisionRecord
} from "@agent-chassis/wiki-core/src/operations/kind-record-edit.mjs";
import { parseArgs } from "../lib/cli.mjs";

const USAGE = `Usage: wiki decision <ratify|unratify> --id DEC-#### [--dir <path>] [--json]
Examples:
  wiki decision ratify --id DEC-0001 --dir /path/to/repo
    flip a proposed decision to accepted (human-only ratification)
  wiki decision unratify --id DEC-0001 --dir /path/to/repo
    flip an accepted decision back to proposed`;

const SUBCOMMAND_HANDLERS = {
  ratify: { run: ratifyDecisionRecord, ratifiedStatus: "accepted" },
  unratify: { run: unratifyDecisionRecord, ratifiedStatus: "proposed" }
};

function isTestRunnerProcess() {
  return (
    process.execArgv.some((arg) => arg === "--test" || arg.startsWith("--test=")) ||
    process.argv.includes("--test") ||
    process.env.NODE_TEST_CONTEXT !== undefined
  );
}

export async function runDecision(argv) {
  const [subcommand, ...rest] = argv;

  if (
    subcommand === undefined ||
    subcommand === "help" ||
    subcommand === "--help" ||
    subcommand === "-h"
  ) {
    console.log(USAGE);
    return { ok: true };
  }

  const handler = SUBCOMMAND_HANDLERS[subcommand];
  if (!handler) {
    throw new Error(
      `Unknown decision subcommand: ${subcommand}. Expected ratify or unratify.\n\n${USAGE}`
    );
  }

  const { positionals, options } = parseArgs(rest);
  if (options.help) {
    console.log(USAGE);
    return { ok: true };
  }

  const targetDir = path.resolve(String(options.dir || "."));
  const id =
    options.id && options.id !== true
      ? String(options.id).trim()
      : positionals[0]
        ? String(positionals[0]).trim()
        : "";

  if (!id) {
    throw new Error(
      `decision ${subcommand} requires --id DEC-####, for example: wiki decision ${subcommand} --id DEC-0001`
    );
  }

  const result = await handler.run({ repoRoot: targetDir, id });

  const status = result.ok ? handler.ratifiedStatus : null;
  const summary = {
    ok: Boolean(result.ok),
    id,
    status,
    source_digest: result.source_digest ?? null,
    written: Boolean(result.written),
    changedFields: result.changedFields ?? [],
    diagnostics: result.diagnostics ?? []
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else if (summary.ok) {
    const verb = subcommand === "unratify" ? "Unratified" : "Ratified";
    console.log(`${verb} ${id} -> ${status}`);
  } else {
    console.log(`Refused decision ${subcommand} for ${id}`);
    for (const diagnostic of summary.diagnostics) {
      const code = diagnostic?.code ? `${diagnostic.code}: ` : "";
      console.log(`  ${code}${diagnostic?.message ?? ""}`);
    }
  }

  if (!summary.ok && !isTestRunnerProcess()) {
    process.exitCode = 1;
  }

  return summary;
}
