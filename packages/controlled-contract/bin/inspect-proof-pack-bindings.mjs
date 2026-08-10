#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytes } from
  "../lib/deterministic-projection-primitives.mjs";
import {
  ProofPackBindingAssistanceError,
  canonicalProofPackBindingAssistanceJson,
  inspectProofPackBindings
} from "../lib/proof-pack-binding-assistance.mjs";

function usage() {
  return `Usage:
  controlled-contract-inspect-proof-pack-bindings \\
    --input <contract.json> \\
    --profile-id <exact-id> \\
    --profile-version <exact-version> \\
    [--intent <controlled-intent-id> ...] \\
    [--evaluation-input <evaluation-input.json>]

Reports every mechanically compatible contract reference and number candidate,
the supplied bindings when present, exact compatibility facts, typed ambiguity
or validity status, and the profile patterns, populations, and constraints using
each role. It never chooses or writes a binding and never infers semantic truth
from compatibility or identity names. Profiles and catalogs are package-owned;
no catalog, profile path, root, module, executable, or environment override is
accepted. Output is canonical, digest-bound, and limited to 65,536 UTF-8 bytes.`;
}

function parseArgs(argv) {
  const result = {
    input: null,
    profileId: null,
    profileVersion: null,
    requestedIntents: [],
    evaluationInput: null,
    help: false
  };
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
    if (["--help", "-h"].includes(flag)) {
      if (seen.has("help")) throw new Error("duplicate argument: --help");
      seen.add("help");
      result.help = true;
      continue;
    }
    if (!["--input", "--profile-id", "--profile-version", "--intent",
      "--evaluation-input"].includes(flag)) throw new Error("unknown argument");
    if (flag !== "--intent" && seen.has(flag)) {
      throw new Error(`duplicate argument: ${flag}`);
    }
    seen.add(flag);
    const value = next(index, flag);
    if (flag === "--input") result.input = value;
    else if (flag === "--profile-id") result.profileId = value;
    else if (flag === "--profile-version") result.profileVersion = value;
    else if (flag === "--intent") result.requestedIntents.push(value);
    else result.evaluationInput = value;
    index += 1;
  }
  if (!result.help && (!result.input || !result.profileId || !result.profileVersion)) {
    throw new Error("--input, --profile-id, and --profile-version are required");
  }
  if (new Set(result.requestedIntents).size !== result.requestedIntents.length) {
    throw new Error("--intent values must be unique");
  }
  return result;
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new ProofPackBindingAssistanceError(
      `proof_pack_binding_${label}_read_failed`,
      `could not read ${label} JSON`,
      { cause: error.message }
    );
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const [contract, evaluationInput] = await Promise.all([
    readJson(options.input, "contract"),
    options.evaluationInput === null
      ? Promise.resolve(null)
      : readJson(options.evaluationInput, "evaluation_input")
  ]);
  const result = await inspectProofPackBindings({
    contract,
    profileId: options.profileId,
    profileVersion: options.profileVersion,
    requestedIntents: options.requestedIntents.length === 0
      ? null : options.requestedIntents,
    evaluationInput
  });
  process.stdout.write(canonicalProofPackBindingAssistanceJson(result));
  if (result.summary.status === "invalid") process.exitCode = 2;
  return result;
}

const isMain = process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  process.stderr.write(canonicalJsonBytes({
    error: error instanceof ProofPackBindingAssistanceError
      ? error.code : "proof_pack_binding_assistance_failed",
    message: error instanceof Error ? error.message : String(error)
  }, { file: true }));
  process.exitCode = 1;
});

export { main, parseArgs, usage };
