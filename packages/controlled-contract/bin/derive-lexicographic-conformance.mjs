#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { deriveDeterministicLexicographicConformance } from
  "../lib/deterministic-lexicographic-ordering.mjs";
import { canonicalJsonBytes } from
  "../lib/deterministic-projection-primitives.mjs";

function usage() {
  return `Usage:
  controlled-contract-derive-lexicographic-conformance \\
    --comparator-evidence <evidence.json> \\
    --input <input.json> \\
    --policy <policy.json> \\
    --result <result.json>

Reads the four exact captured artifacts, validates the complete policy and
evidence, and writes one canonical digest-bound conformance report to stdout.`;
}

function parseArgs(argv) {
  const names = new Map([
    ["--comparator-evidence", "comparatorEvidence"],
    ["--input", "inputSnapshot"],
    ["--policy", "orderingPolicy"],
    ["--result", "resultSnapshot"]
  ]);
  const options = {};
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) return { help: true };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const field = names.get(flag);
    const value = argv[index + 1];
    if (!field || !value || value.startsWith("-") || Object.hasOwn(options, field)) {
      throw new Error(`invalid or duplicate argument: ${flag ?? "<missing>"}`);
    }
    options[field] = value;
  }
  if ([...names.values()].some((field) => !Object.hasOwn(options, field))) {
    throw new Error("all four exact source paths are required");
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const result = deriveDeterministicLexicographicConformance({
    comparatorEvidenceBytes: await readFile(options.comparatorEvidence),
    inputSnapshotBytes: await readFile(options.inputSnapshot),
    orderingPolicyBytes: await readFile(options.orderingPolicy),
    resultSnapshotBytes: await readFile(options.resultSnapshot)
  });
  process.stdout.write(result);
  return result;
}

const isMain = process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  process.stderr.write(canonicalJsonBytes({
    error: error?.code ?? "lexicographic_conformance_derivation_failed",
    message: error instanceof Error ? error.message : String(error)
  }, { file: true }));
  process.exitCode = 1;
});

export { main, parseArgs, usage };
