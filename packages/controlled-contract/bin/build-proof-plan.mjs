#!/usr/bin/env node
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { canonicalJsonBytes } from
  "../lib/deterministic-projection-primitives.mjs";
import {
  MAX_PROOF_PLAN_BYTES,
  ProofPlanCompilerError,
  buildProofPlanFiles,
  canonicalProofPlanJson
} from "../lib/proof-plan-compiler.mjs";

function usage() {
  return `Usage:
  controlled-contract-build-proof-plan \\
    --input <contract.json> \\
    --request <proof-plan-request.json>

Builds canonical controlled-contract-proof-plan.v1 JSON from genuine caller
choices only: requested controlled intents, exact selected pack identities,
pack-specific evaluation-input paths, and required exact-capture declarations
and sources. It reruns intrinsic selection, loads only admitted package-owned
packs, validates supplied bindings and exact paths, and computes every derivable
digest. It never infers an intent, selects a pack, binds a role, or emits a
placeholder. No caller catalog, profile path, module, executable, environment,
alternate root, digest, or output path is accepted. Output is canonical and
limited to ${MAX_PROOF_PLAN_BYTES.toLocaleString("en-US")} UTF-8 bytes.`;
}

function parseArgs(argv) {
  const result = { input: null, request: null, help: false };
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
    if (!["--input", "--request"].includes(flag)) {
      throw new Error("unknown argument");
    }
    if (seen.has(flag)) throw new Error(`duplicate argument: ${flag}`);
    seen.add(flag);
    const value = next(index, flag);
    if (flag === "--input") result.input = value;
    else result.request = value;
    index += 1;
  }
  if (!result.help && (!result.input || !result.request)) {
    throw new Error("--input and --request are required");
  }
  return result;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const plan = await buildProofPlanFiles({
    inputPath: options.input,
    requestPath: options.request
  });
  process.stdout.write(canonicalProofPlanJson(plan));
  return plan;
}

const isMain = process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
  const details = error instanceof ProofPlanCompilerError
    ? error.details : {};
  let output = canonicalJsonBytes({
    error: error instanceof ProofPlanCompilerError
      ? error.code : "proof_plan_compilation_failed",
    message: error instanceof Error ? error.message : String(error),
    details
  }, { file: true });
  if (output.byteLength > MAX_PROOF_PLAN_BYTES) output = canonicalJsonBytes({
    error: "proof_plan_compiler_error_too_large",
    message: "proof-plan compiler diagnostics exceed the declared output bound",
    details: { diagnostic_count: Array.isArray(details.diagnostics)
      ? details.diagnostics.length : 0 }
  }, { file: true });
  process.stderr.write(output);
  process.exitCode = 1;
});

export { main, parseArgs, usage };
