#!/usr/bin/env node
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  AssessmentArtifactError,
  assessStructuralContractFile,
  canonicalJson,
  compactAssessmentOutput,
  writeAssessmentBundle
} from "../lib/contract-assessment.mjs";
import {
  ProofPlanError,
  assessProofPlanFiles,
  compactMultiPackAssessment,
  writeMultiPackAssessmentBundle
} from "../lib/multi-pack-assessment.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

function repositoryRootFromScriptDirectory(directory) {
  const packageDirectory = path.resolve(directory, "..");
  const scopeDirectory = path.dirname(packageDirectory);
  const nodeModulesDirectory = path.dirname(scopeDirectory);
  if (path.basename(scopeDirectory) === "@agent-chassis" &&
      path.basename(nodeModulesDirectory) === "node_modules") {
    return path.dirname(nodeModulesDirectory);
  }
  return path.resolve(directory, "../../..");
}

const DEFAULT_REPOSITORY_ROOT = repositoryRootFromScriptDirectory(scriptDirectory);

function usage() {
  return `Usage:
  node packages/controlled-contract/bin/assess-contract.mjs \\
    --input <controlled-contract.json>

Canonical zero-, one-, or multi-pack assessment:
  node packages/controlled-contract/bin/assess-contract.mjs \\
    --input <controlled-contract.json> \\
    --proof-plan <proof-plan.json>

With only --input, runs structural evaluation and marks profile discrimination
NOT ASSESSED. Every admitted proof-pack assessment requires
a schema-valid --proof-plan; there is no implicit single-pack or intent shorthand.
Certification is verified when the package is built; ordinary assessment does
not rerun its large development corpus. The command writes a deterministic bundle
beneath .cache/controlled-contract/assessments/sha256 and accepts no output path.

The result is non-authoritative and planning-scoped. Profile discrimination
applies only to the authored controlled graph. This command does not accept or
assess delivered runtime evidence.`;
}

function parseArgs(argv) {
  const options = {
    input: null,
    proofPlan: null,
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
    if (seen.has(flag)) throw new Error(`duplicate argument: ${flag}`);
    seen.add(flag);
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    if (flag === "--input") options.input = next(index, flag);
    else if (flag === "--proof-plan") options.proofPlan = next(index, flag);
    else {
      throw new Error(`unknown argument: ${flag}`);
    }
    index += 1;
  }
  if (options.help && seen.size > 1) {
    throw new Error("--help cannot be combined with other arguments");
  }
  if (!options.help && !options.input) throw new Error("--input is required");
  return options;
}

async function main(argv = process.argv.slice(2), {
  repositoryRoot = DEFAULT_REPOSITORY_ROOT
} = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  let projected;
  let multiPack = false;
  if (options.proofPlan) {
    projected = await assessProofPlanFiles({
      inputPath: options.input,
      proofPlanPath: options.proofPlan
    });
    multiPack = true;
  } else {
    projected = await assessStructuralContractFile({ inputPath: options.input });
  }
  if (multiPack) {
    await writeMultiPackAssessmentBundle(projected, { repositoryRoot });
    const compact = compactMultiPackAssessment(projected.assessment);
    process.stdout.write(canonicalJson(compact));
    return compact;
  }
  await writeAssessmentBundle(projected, { repositoryRoot });
  const compact = compactAssessmentOutput(projected.assessment);
  process.stdout.write(canonicalJson(compact));
  return compact;
}

const isMain = process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().then((result) => {
  const aggregate = result?.aggregate ?? result;
  if (result && (aggregate.structure !== "proven" ||
      aggregate.profile_discrimination === "not_proven")) process.exitCode = 2;
}).catch((error) => {
  process.stderr.write(canonicalJson({
    error: error instanceof AssessmentArtifactError || error instanceof ProofPlanError
      ? error.code : "assessment_failed",
    message: error instanceof Error ? error.message : String(error)
  }));
  process.exitCode = 1;
});

export {
  DEFAULT_REPOSITORY_ROOT,
  main,
  parseArgs,
  repositoryRootFromScriptDirectory,
  usage
};
