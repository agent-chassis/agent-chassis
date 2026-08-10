#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../lib/contract-assessment.mjs";
import {
  ProofIntentSelectionError,
  compactProofIntentSelection,
  selectProofPacks
} from "../lib/proof-intent-selection.mjs";

function usage() {
  return `Usage:
  controlled-contract-select-proof-packs \\
    --input <controlled-contract.json> \\
    --intent <controlled-proof-intent-id> [--intent <id> ...] \\
    [--expected-digests <selection-digests.json>]

Returns only the requested intent mappings, definitions, distinctions, pack
guarantees, explicit exclusions, required inputs, missing compatible reference
types, authoring-projection digests/counts, ambiguities, incompatibilities, and
the substrate digests. Run controlled-contract-discover-proof-intents first when
the exact controlled intent IDs are not already known. Then use
controlled-contract-describe-proof-pack for the exact selected pack's bounded
authoring requirements. None of these commands emits certification corpora.`;
}

function parseArgs(argv) {
  const options = { input: null, intents: [], expectedDigests: null, help: false };
  const single = new Set();
  const next = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("-")) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    const value = next(index, flag);
    if (flag === "--intent") options.intents.push(value);
    else {
      if (single.has(flag)) throw new Error(`duplicate argument: ${flag}`);
      single.add(flag);
      if (flag === "--input") options.input = value;
      else if (flag === "--expected-digests") options.expectedDigests = value;
      else throw new Error(`unknown argument: ${flag}`);
    }
    index += 1;
  }
  if (!options.help && !options.input) throw new Error("--input is required");
  if (!options.help && options.intents.length === 0) {
    throw new Error("at least one --intent is required");
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const contract = JSON.parse(await readFile(path.resolve(options.input), "utf8"));
  const expectedDigests = options.expectedDigests === null ? null : JSON.parse(
    await readFile(path.resolve(options.expectedDigests), "utf8")
  );
  const compact = compactProofIntentSelection(selectProofPacks({
    contract,
    requestedIntents: options.intents,
    expectedDigests
  }));
  process.stdout.write(canonicalJson(compact));
  return compact;
}

const isMain = process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  process.stderr.write(canonicalJson({
    error: error instanceof ProofIntentSelectionError
      ? error.code : "proof_intent_selection_failed",
    message: error instanceof Error ? error.message : String(error)
  }));
  process.exitCode = 1;
});

export { main, parseArgs, usage };
