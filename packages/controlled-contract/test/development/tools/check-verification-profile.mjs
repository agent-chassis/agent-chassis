#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateVerificationProfile
} from "../../../lib/verification-profile.mjs";
import {
  PROFILE_SCHEMA_VERSION_V1,
  evaluateVerificationProfileV1
} from "../../support/stable-v1-proof-pack-runtime.mjs";
import {
  ProofPackAdequacyError,
  loadProofPack,
  runLoadedProofPackAdequacy
} from "../../support/proof-pack-adequacy.mjs";

const TOOL_VERSION = "controlled-contract-verification-profile-check.experimental.v0.1";
const TOOL_VERSION_V034 =
  "controlled-contract-verification-profile-check.experimental.v0.2";

function usage() {
  return `Usage:
  node packages/controlled-contract/bin/check-verification-profile.mjs \\
    --contract <controlled-contract.json> \\
    --profile <verification-profile.json> \\
    --input <profile-evaluation-input.json> [options]

Options:
  --output <path>   Write the complete deterministic result envelope.
  --help            Show this help.

The command evaluates a versioned proof pack against an agent-authored native
controlled contract. It performs no prose translation, model call, resolver
execution, policy selection, or authorization. Reference-role bindings,
resolver facts, and delivered evidence are explicit evaluation input. The
declared profile schema selects the frozen v0.1 compatibility evaluator or the
vocabulary-derived v0.2 evaluator.`;
}

function parseArgs(argv) {
  const options = {
    contract: null,
    profile: null,
    input: null,
    output: null,
    help: false
  };
  const next = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
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
    if (!["--contract", "--profile", "--input", "--output"].includes(flag)) {
      throw new Error(`unknown argument: ${flag}`);
    }
    options[flag.slice(2)] = next(index, flag);
    index += 1;
  }
  if (!options.help) {
    for (const field of ["contract", "profile", "input"]) {
      if (!options[field]) throw new Error(`--${field} is required`);
    }
  }
  return options;
}

function digest(text) {
  return createHash("sha256").update(text).digest("hex");
}

function canonical(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(filePath, label) {
  const resolvedPath = path.resolve(filePath);
  let text;
  try {
    text = await readFile(resolvedPath, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${label} ${filePath}: ${error.message}`);
  }
  try {
    return {
      absolute_path: resolvedPath,
      path: path.relative(process.cwd(), resolvedPath),
      sha256: digest(text),
      text,
      value: JSON.parse(text)
    };
  } catch (error) {
    throw new Error(`invalid JSON in ${label} ${filePath}: ${error.message}`);
  }
}

async function checkVerificationProfile({ contractPath, profilePath, inputPath }) {
  const [contract, profile, input] = await Promise.all([
    readJson(contractPath, "controlled contract"),
    readJson(profilePath, "verification profile"),
    readJson(inputPath, "verification profile input")
  ]);
  const usesV034 = profile.value.schema_version === PROFILE_SCHEMA_VERSION_V1;
  const pack = usesV034
    ? await loadProofPack(path.dirname(profile.absolute_path), {
      profileSource: { path: profile.absolute_path, text: profile.text }
    })
    : null;
  const adequacyResult = pack
    ? await runLoadedProofPackAdequacy(pack)
    : null;
  if (adequacyResult && !adequacyResult.passed) throw new ProofPackAdequacyError(
    "proof_pack_adequacy_failed",
    "v0.34 proof pack failed its executable adequacy gate",
    { diagnostics: adequacyResult.diagnostics }
  );
  const evaluator = usesV034
    ? evaluateVerificationProfileV1
    : evaluateVerificationProfile;
  const inputs = {
    contract: { path: contract.path, sha256: contract.sha256 },
    profile: {
      path: profile.path,
      sha256: pack?.profile_sha256 ?? profile.sha256
    },
    evaluation: { path: input.path, sha256: input.sha256 }
  };
  if (pack) inputs.adequacy = {
    path: path.relative(process.cwd(), pack.adequacy_path),
    sha256: pack.adequacy_sha256,
    profile_digest: pack.profile_digest,
    guarantee_digest: pack.adequacy.guarantee_digest,
    executable_control_count: adequacyResult.control_count,
    result_sha256: digest(canonical(adequacyResult))
  };
  const admission = pack ? {
    kind: "local_proof_pack_admission",
    authoritative: false,
    adequacy_verified: true,
    profile_digest: pack.profile_digest,
    guarantee_digest: pack.adequacy.guarantee_digest,
    adequacy_digest: pack.adequacy_digest,
    adequacy_result_sha256: digest(canonical(adequacyResult))
  } : {
    kind: "legacy_unadmitted",
    authoritative: false,
    adequacy_verified: false
  };
  return {
    tool_version: usesV034 ? TOOL_VERSION_V034 : TOOL_VERSION,
    authority: { kind: "free_tier_local", authoritative: false },
    admission,
    inputs,
    evaluation: evaluator({
      contract: contract.value,
      profile: pack?.profile ?? profile.value,
      evaluation_input: input.value
    })
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const result = await checkVerificationProfile({
    contractPath: options.contract,
    profilePath: options.profile,
    inputPath: options.input
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
    if (result && result.evaluation.satisfaction !== "satisfied") process.exitCode = 2;
  }).catch((error) => {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  });
}

export {
  TOOL_VERSION,
  TOOL_VERSION_V034,
  checkVerificationProfile,
  main,
  parseArgs,
  readJson,
  usage
};
