#!/usr/bin/env node
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytes } from
  "../lib/deterministic-projection-primitives.mjs";
import {
  ProofIntentDiscoveryError,
  canonicalProofIntentDiscoveryJson,
  discoverProofIntents
} from "../lib/proof-intent-discovery.mjs";

function usage() {
  return `Usage:
  controlled-contract-discover-proof-intents
  controlled-contract-discover-proof-intents --query <terms> [--limit <count>]

List mode returns every admitted proof-pack candidate. Search normalizes case
and punctuation and returns all matching candidates in rank order: all-term
assertion/constraint matches, then partial assertion matches, then navigation
or exclusion-only matches. The optional limit selects a prefix and results
report complete match and omission counts; reissue the same query without
--limit to recover omitted candidates. Zero-overlap queries remain no_match.
Discovery does not select, combine, invoke or admit proof packs and accepts
no path, root, catalog, executable, module or environment override.`;
}

function parseArgs(argv) {
  const options = { query: undefined, limit: undefined, help: false };
  const seen = new Set();
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
      if (seen.has("help")) throw new Error(`duplicate argument: ${flag}`);
      seen.add("help");
      options.help = true;
      continue;
    }
    if (!["--query", "--limit"].includes(flag)) {
      throw new Error("unknown argument");
    }
    if (seen.has(flag)) throw new Error(`duplicate argument: ${flag}`);
    seen.add(flag);
    const value = next(index, flag);
    if (flag === "--query") options.query = value;
    else {
      if (!/^[0-9]+$/u.test(value)) throw new Error(
        "--limit requires a positive decimal integer"
      );
      options.limit = Number(value);
    }
    index += 1;
  }
  if (!options.help && options.query === undefined && options.limit !== undefined) {
    throw new Error("--limit is available only with --query");
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const request = {};
  if (options.query !== undefined) request.query = options.query;
  if (options.limit !== undefined) request.limit = options.limit;
  const result = discoverProofIntents(request);
  process.stdout.write(canonicalProofIntentDiscoveryJson(result));
  return result;
}

const isMain = process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  process.stderr.write(canonicalJsonBytes({
    error: error instanceof ProofIntentDiscoveryError
      ? error.code : "proof_intent_discovery_failed",
    message: error instanceof Error ? error.message : String(error)
  }, { file: true }));
  process.exitCode = 1;
});

export { main, parseArgs, usage };
