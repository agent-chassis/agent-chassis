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

List mode returns every controlled proof intent. Search mode mechanically
normalizes case and punctuation, evaluates the complete intrinsic catalog, and
returns the strongest candidate class before the optional output limit is
applied: all-token matches when any exist, otherwise explicit partial matches.
Partial candidates report matched and unmatched terms; zero-overlap queries
remain no_match. Results include exact scan and truncation facts. Discovery never
selects, ranks, combines, invokes, or admits a proof pack and accepts no path,
root, catalog, executable, module, or environment override.`;
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
