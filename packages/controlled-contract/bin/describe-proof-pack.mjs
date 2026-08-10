#!/usr/bin/env node
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "../lib/contract-assessment.mjs";
import {
  ProofIntentSelectionError,
  describeProofPackAuthoring
} from "../lib/proof-intent-selection.mjs";

function usage() {
  return `Usage:
  controlled-contract-describe-proof-pack \\
    --profile-id <exact-profile-id> \\
    --profile-version <exact-profile-version> \\
    [--intent <controlled-proof-intent-id> ...]

Returns one bounded, digest-bound authoring projection for an exact admitted
proof pack: guarantee, exclusions, intent distinctions, roles, constraints,
proof obligations, falsifiers, collections, satisfaction logic, and the
evaluation-input binding skeleton. It never emits certification corpora.`;
}

function parseArgs(argv) {
  const options = {
    profileId: null,
    profileVersion: null,
    intents: [],
    help: false
  };
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
      if (flag === "--profile-id") options.profileId = value;
      else if (flag === "--profile-version") options.profileVersion = value;
      else throw new Error(`unknown argument: ${flag}`);
    }
    index += 1;
  }
  if (!options.help && options.profileId === null) {
    throw new Error("--profile-id is required");
  }
  if (!options.help && options.profileVersion === null) {
    throw new Error("--profile-version is required");
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const projection = describeProofPackAuthoring({
    profileId: options.profileId,
    profileVersion: options.profileVersion,
    requestedIntents: options.intents.length === 0 ? null : options.intents
  });
  process.stdout.write(canonicalJson(projection));
  return projection;
}

const isMain = process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  process.stderr.write(canonicalJson({
    error: error instanceof ProofIntentSelectionError
      ? error.code : "proof_pack_authoring_projection_failed",
    message: error instanceof Error ? error.message : String(error)
  }));
  process.exitCode = 1;
});

export { main, parseArgs, usage };
