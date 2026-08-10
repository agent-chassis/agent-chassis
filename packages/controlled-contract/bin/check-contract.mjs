#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  NATIVE_CONTRACT_SCHEMA_V034,
  PROFILE_ID_V034,
  SCHEMA_VERSION_V034,
  VOCABULARY_VERSION_V034,
  validateAndResolveNativeContractV034
} from "../lib/native-contract-carrier-v034.mjs";
import {
  resolveNativeContractDecomposition
} from "../lib/native-contract-decomposition.mjs";
import {
  anonymousPlanningInputFromDecomposition
} from "../lib/anonymous-structural-partitioner.mjs";
import {
  evaluateVerificationProfileV034
} from "../lib/verification-profile-v034.mjs";
import {
  AdmittedProofPackError,
  loadAdmittedProofPack
} from "../lib/admitted-proof-packs.mjs";

const TOOL_VERSION = "controlled-contract-check.v0.34";
const TOOL_VERSION_V034 = TOOL_VERSION;
const TOOL_VERSION_ADMITTED_V034 =
  "controlled-contract-check-proof-pack-admission.experimental.v0.1";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA_PATH = path.resolve(
  scriptDirectory,
  "../schema/controlled-acceptance-contract.experimental.v0.2.schema.json"
);
const DEFAULT_SCHEMA_PATH_V034 = DEFAULT_SCHEMA_PATH;
const EXAMPLE_PATH = path.resolve(
  scriptDirectory,
  "../examples/minimal-controlled-acceptance-contract-v034.json"
);
const EXAMPLE_PATH_V034 = EXAMPLE_PATH;

function usage() {
  return `Usage:
  node packages/controlled-contract/bin/check-contract.mjs \\
    --input <controlled-contract.json> [options]

Admitted proof-pack evaluation:
  node packages/controlled-contract/bin/check-contract.mjs \\
    --input <controlled-contract.json> \\
    --profile <proof-pack-id> \\
    --evaluation-input <profile-evaluation-input.json> [options]

Author the input directly against:
  packages/controlled-contract/schema/controlled-acceptance-contract.experimental.v0.2.schema.json

Minimal example:
  packages/controlled-contract/examples/minimal-controlled-acceptance-contract-v034.json

Options:
  --profile <proof-pack-id> Require a release-certified built-in proof pack.
  --evaluation-input <path> Evaluation input required with --profile.
  --output <path>            Write the complete deterministic report to a file.
  --planning-output <path>   Write anonymous DAG planning facts when available.
  --help                     Show this help.

Without --profile, the command performs only the structural carrier check and
marks its result unadmitted. With --profile, it verifies the compact admission
record produced by the pack's release-time executable adequacy gate, then
evaluates the admitted profile. Ordinary checks do not rerun the development
corpus. Exit 0
means the requested mode passed; exit 2 means a completed structural/profile
evaluation did not pass; exit 1 means input, pack admission, or tool failure.
The command performs no prose translation or model call and does not authorize
dispatch, decide evidence sufficiency, or modify the source contract.`;
}

function parseArgs(argv) {
  const options = {
    input: null,
    profile: null,
    evaluationInput: null,
    output: null,
    planningOutput: null,
    help: false
  };
  const seen = new Set();
  const markSingleton = (flag) => {
    if (seen.has(flag)) throw new Error(`duplicate argument: ${flag}`);
    seen.add(flag);
  };
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
      markSingleton("--help");
      options.help = true;
      continue;
    }
    if (flag === "--input") {
      markSingleton(flag);
      options.input = next(index, flag);
    } else if (flag === "--profile") {
      markSingleton(flag);
      options.profile = next(index, flag);
    } else if (flag === "--evaluation-input") {
      markSingleton(flag);
      options.evaluationInput = next(index, flag);
    } else if (flag === "--output") {
      markSingleton(flag);
      options.output = next(index, flag);
    } else if (flag === "--planning-output") {
      markSingleton(flag);
      options.planningOutput = next(index, flag);
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
    index += 1;
  }
  if (options.help && seen.size > 1) {
    throw new Error("--help cannot be combined with other arguments");
  }
  if (!options.help && !options.input) throw new Error("--input is required");
  if (!options.help && Boolean(options.profile) !== Boolean(options.evaluationInput)) {
    throw new Error("--profile and --evaluation-input must be supplied together");
  }
  return options;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function canonical(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(filePath, label) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`cannot read ${label} ${filePath}: ${error.message}`);
  }
  try {
    return { text, value: JSON.parse(text) };
  } catch (error) {
    throw new Error(`invalid JSON in ${label} ${filePath}: ${error.message}`);
  }
}

function determineOutcome(validation, decomposition, residueCount) {
  if (!validation.schema_valid) return "schema_invalid";
  if (validation.diagnostics.length > 0 || decomposition.diagnostics.length > 0) {
    return "incomplete_structure";
  }
  if (residueCount > 0) return "residue_present";
  return "structurally_complete";
}

async function checkContractSource({ resolvedInputPath, inputText, contract }) {
  const runtime = {
    toolVersion: TOOL_VERSION_V034,
    schemaPath: DEFAULT_SCHEMA_PATH_V034,
    schema: NATIVE_CONTRACT_SCHEMA_V034,
    schemaVersion: SCHEMA_VERSION_V034,
    vocabularyVersion: VOCABULARY_VERSION_V034,
    profileId: PROFILE_ID_V034,
    validateContract: validateAndResolveNativeContractV034
  };
  const { text: schemaText, value: schema } = await readJson(
    runtime.schemaPath,
    "controlled-contract schema"
  );

  if (canonical(schema) !== canonical(runtime.schema)) {
    throw new Error(
      `tracked schema does not match the executable native schema; run ` +
      "node packages/controlled-contract/bin/build-schema.mjs"
    );
  }

  const validation = runtime.validateContract(contract);
  const decomposition = resolveNativeContractDecomposition(contract, {
    validate_contract: runtime.validateContract,
    counterfactual_falsifier_semantics: "falsifier_role"
  });
  const residueCount = validation.schema_valid
    ? validation.facts.operative_residue_count
    : null;
  const anonymousPlanningInput = decomposition.schema_valid &&
      decomposition.facts?.components?.length > 0 &&
      decomposition.diagnostics.length === 0
    ? anonymousPlanningInputFromDecomposition(decomposition)
    : null;
  const outcome = determineOutcome(validation, decomposition, residueCount);

  return {
    tool_version: runtime.toolVersion,
    authority: {
      kind: "experimental_local",
      authoritative: false
    },
    schema: {
      path: path.relative(process.cwd(), runtime.schemaPath),
      schema_version: runtime.schemaVersion,
      vocabulary_version: runtime.vocabularyVersion,
      profile_id: runtime.profileId,
      sha256: sha256(schemaText)
    },
    input: {
      path: path.relative(process.cwd(), resolvedInputPath),
      sha256: sha256(inputText)
    },
    outcome,
    structurally_complete: outcome === "structurally_complete",
    residue_count: residueCount,
    validation,
    decomposition,
    anonymous_planning_input: anonymousPlanningInput
  };
}

async function readContractSource(inputPath) {
  const resolvedInputPath = path.resolve(inputPath);
  const { text: inputText, value: contract } = await readJson(
    resolvedInputPath,
    "controlled contract"
  );
  return { resolvedInputPath, inputText, contract };
}

async function checkContract(inputPath) {
  const structural = await checkContractSource(await readContractSource(inputPath));
  return {
    ...structural,
    mode: "structural",
    verification_scope: {
      graph_edge_coverage: "assessed",
      proof_plan_discrimination: "not_assessed"
    },
    admission: {
      kind: "unadmitted_structural",
      authoritative: false,
      proof_pack_verified: false
    },
    passed: structural.structurally_complete
  };
}

function proofOutcome(structuralOutcome, satisfaction) {
  if (structuralOutcome !== "structurally_complete") return structuralOutcome;
  return `proof_${satisfaction}`;
}

async function checkContractWithProofPack({
  inputPath,
  profileId,
  evaluationInputPath
}) {
  const resolvedEvaluationInputPath = path.resolve(evaluationInputPath);
  const [contractSource, evaluationInputSource, pack] = await Promise.all([
    readContractSource(inputPath),
    readJson(resolvedEvaluationInputPath, "verification profile input"),
    loadAdmittedProofPack(profileId)
  ]);
  const structural = await checkContractSource(contractSource);
  const evaluation = evaluateVerificationProfileV034({
    contract: contractSource.contract,
    profile: pack.profile,
    evaluation_input: evaluationInputSource.value
  });
  const evaluationResultSha256 = sha256(canonical(evaluation));
  const evaluationInputSha256 = sha256(evaluationInputSource.text);
  const admitted = structural.structurally_complete &&
    evaluation.satisfaction === "satisfied";
  return {
    ...structural,
    tool_version: TOOL_VERSION_ADMITTED_V034,
    mode: "proof_pack",
    verification_scope: {
      graph_edge_coverage: "assessed",
      proof_plan_discrimination: "assessed_by_admitted_profile"
    },
    structural_outcome: structural.outcome,
    outcome: proofOutcome(structural.outcome, evaluation.satisfaction),
    admission: {
      kind: "local_proof_pack_admission",
      authoritative: false,
      adequacy_verified: true,
      contract_sha256: structural.input.sha256,
      evaluation_input_sha256: evaluationInputSha256,
      profile_digest: pack.profile_digest,
      admission_digest: pack.admission_digest,
      guarantee_digest: pack.admission.guarantee_digest,
      adequacy_declaration_digest:
        pack.admission.certification.adequacy_declaration_digest,
      adequacy_result_digest: pack.admission.certification.adequacy_result_digest,
      evaluation_result_sha256: evaluationResultSha256
    },
    proof_pack: {
      profile_id: pack.profile.profile_id,
      profile_version: pack.profile.profile_version,
      profile_digest: pack.profile_digest,
      admission_digest: pack.admission_digest,
      guarantee: pack.admission.guarantee,
      guarantee_digest: pack.admission.guarantee_digest,
      certification: pack.admission.certification,
      evaluation_input: {
        path: path.relative(process.cwd(), resolvedEvaluationInputPath),
        sha256: evaluationInputSha256
      }
    },
    profile_evaluation: evaluation,
    passed: admitted
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return null;
  }
  const result = options.profile
    ? await checkContractWithProofPack({
      inputPath: options.input,
      profileId: options.profile,
      evaluationInputPath: options.evaluationInput
    })
    : await checkContract(options.input);
  const output = canonical(result);
  if (options.output) await writeFile(path.resolve(options.output), output, "utf8");
  if (options.planningOutput) {
    if (!result.anonymous_planning_input) {
      throw new Error("anonymous planning facts are unavailable for this contract");
    }
    await writeFile(
      path.resolve(options.planningOutput),
      canonical(result.anonymous_planning_input),
      "utf8"
    );
  }
  process.stdout.write(output);
  return result;
}

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then((result) => {
    if (result && !result.passed) process.exitCode = 2;
  }).catch((error) => {
    const detail = error instanceof AdmittedProofPackError
      ? ` [${error.code}]`
      : "";
    process.stderr.write(`error${detail}: ${error.message}\n`);
    process.exitCode = 1;
  });
}

export {
  DEFAULT_SCHEMA_PATH,
  DEFAULT_SCHEMA_PATH_V034,
  EXAMPLE_PATH,
  EXAMPLE_PATH_V034,
  TOOL_VERSION,
  TOOL_VERSION_ADMITTED_V034,
  TOOL_VERSION_V034,
  checkContract,
  checkContractWithProofPack,
  main,
  parseArgs,
  readJson,
  usage
};
