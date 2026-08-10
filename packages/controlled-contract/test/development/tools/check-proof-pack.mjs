#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ProofPackAdequacyError,
  runProofPackAdequacy
} from "../../support/proof-pack-adequacy.mjs";

function usage() {
  return `Usage:
  node packages/controlled-contract/bin/check-proof-pack.mjs \\
    --pack <proof-pack-directory> [--variation-mode indexed|full_census] \\
    [--output <result.json>]

Loads a proof pack only when profile.json and adequacy.json are present,
schema-valid, identity-matched, and digest-bound. It then executes the declared
adequacy module and requires one machine-readable result for every positive,
mutant, profile-rejection, and exclusion control. This local release check is
not contract evidence, pack applicability policy, CCE authority, or dispatch
authorization.`;
}

function parseArgs(argv) {
  const options = { pack: null, output: null, variationMode: "indexed", help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    if (!["--pack", "--output", "--variation-mode"].includes(flag)) throw new Error(
      `unknown argument: ${flag}`
    );
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(
      `${flag} requires a value`
    );
    if (flag === "--variation-mode") options.variationMode = value;
    else options[flag.slice(2)] = value;
    index += 1;
  }
  if (!options.help && !options.pack) throw new Error("--pack is required");
  if (!["indexed", "full_census"].includes(options.variationMode)) throw new Error(
    "--variation-mode must be indexed or full_census"
  );
  return options;
}

function canonical(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const result = await runProofPackAdequacy(options.pack, {
    variationMode: options.variationMode
  });
  const output = canonical(result);
  if (options.output) await writeFile(path.resolve(options.output), output, "utf8");
  process.stdout.write(output);
  return result;
}

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((result) => {
    if (result && !result.passed) process.exitCode = 2;
  }).catch((error) => {
    const detail = error instanceof ProofPackAdequacyError
      ? ` [${error.code}]`
      : "";
    process.stderr.write(`error${detail}: ${error.message}\n`);
    process.exitCode = 1;
  });
}

export { canonical, main, parseArgs, usage };
