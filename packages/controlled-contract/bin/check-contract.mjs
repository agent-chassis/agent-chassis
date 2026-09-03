#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  NATIVE_CONTRACT_SCHEMA_V1,
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  VOCABULARY_VERSION_V1,
  validateAndResolveNativeContractV1
} from "../lib/native-contract-carrier-v1.mjs";
import {
  anonymousPlanningInputFromDecomposition
} from "../lib/anonymous-structural-partitioner.mjs";
import {
  evaluateVerificationProfileV1
} from "../lib/verification-profile-v1.mjs";
import {
  AdmittedProofPackError,
  loadAdmittedProofPack
} from "../lib/admitted-proof-packs.mjs";

const TOOL_VERSION = "controlled-contract-check.v1";
const TOOL_VERSION_ADMITTED = "controlled-contract-check-proof-pack-admission.v1";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA_PATH = path.resolve(
  scriptDirectory,
  "../schema/controlled-acceptance-contract.v1.schema.json"
);

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
  packages/controlled-contract/schema/controlled-acceptance-contract.v1.schema.json

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

function stableDecomposition(contract, validation) {
  if (!validation.schema_valid) return {
    decomposition_version: "controlled-contract-decomposition.v1",
    schema_valid: false,
    schema_errors: validation.schema_errors,
    facts: null,
    source_contract_diagnostics: validation.diagnostics,
    diagnostics: [{ code: "contract_schema_invalid" }]
  };
  const compare = (left, right) => String(left).localeCompare(String(right));
  const claims = new Map(contract.claims.map((claim) => [claim.claim_id, claim]));
  const propositions = new Map(contract.propositions.map((item) =>
    [item.proposition_id, item]));
  const behaviorClaims = contract.claims.filter(({ kind }) => kind === "behavior")
    .sort((left, right) => compare(left.claim_id, right.claim_id));
  const componentByClaim = new Map(behaviorClaims.map((claim, index) =>
    [claim.claim_id, `component-${String(index + 1).padStart(3, "0")}`]));
  const verifyingRelations = contract.relations.filter(({ role, source_claim_id: source,
    target_claim_id: target }) => role === "verifies" &&
      claims.get(source)?.kind === "verification" &&
      claims.get(target)?.kind === "behavior");
  const verificationByBehavior = new Map();
  for (const relation of verifyingRelations) {
    const rows = verificationByBehavior.get(relation.target_claim_id) ?? [];
    rows.push(relation.source_claim_id);
    verificationByBehavior.set(relation.target_claim_id, rows);
  }
  const dependencies = contract.relations.filter(({ role, source_claim_id: source,
    target_claim_id: target }) => ["depends_on", "precedes"].includes(role) &&
      componentByClaim.has(source) && componentByClaim.has(target)).map((relation) => {
    const source = componentByClaim.get(relation.source_claim_id);
    const target = componentByClaim.get(relation.target_claim_id);
    const [prerequisite, dependent] = relation.role === "depends_on"
      ? [target, source] : [source, target];
    return {
      relation_id: relation.relation_id,
      role: relation.role,
      source_component_id: source,
      target_component_id: target,
      prerequisite_component_id: prerequisite,
      dependent_component_id: dependent
    };
  }).sort((left, right) => compare(left.relation_id, right.relation_id));
  const arcs = [...new Map(dependencies.map((item) => [
    `${item.prerequisite_component_id}\0${item.dependent_component_id}`,
    {
      prerequisite_component_id: item.prerequisite_component_id,
      dependent_component_id: item.dependent_component_id,
      relation_ids: dependencies.filter((candidate) =>
        candidate.prerequisite_component_id === item.prerequisite_component_id &&
        candidate.dependent_component_id === item.dependent_component_id
      ).map(({ relation_id: id }) => id).sort(compare),
      transitive: false
    }
  ])).values()].sort((left, right) => compare(
    `${left.prerequisite_component_id}\0${left.dependent_component_id}`,
    `${right.prerequisite_component_id}\0${right.dependent_component_id}`
  ));
  const components = behaviorClaims.map((claim) => {
    const proposition = propositions.get(claim.proposition_id);
    const referenceIds = [...new Set([
      proposition?.subject_reference_id,
      ...(proposition?.applicability_context?.operand_reference_ids ?? []),
      ...(proposition?.operands ?? []).filter(({ kind }) => kind === "reference")
        .map(({ reference_id: id }) => id)
    ].filter(Boolean))].sort(compare);
    const verificationIds = [...new Set(verificationByBehavior.get(claim.claim_id) ?? [])]
      .sort(compare);
    return {
      component_id: componentByClaim.get(claim.claim_id),
      behavior_claim_ids: [claim.claim_id],
      mandatory_behavior_claim_ids: ["MUST", "MUST_NOT"].includes(claim.modality)
        ? [claim.claim_id] : [],
      behavior_proposition_ids: [claim.proposition_id],
      behavior_reference_ids: referenceIds,
      behavior_repository_reference_ids: referenceIds.filter((id) => {
        const reference = contract.references.find(({ reference_id: value }) => value === id);
        return ["repository_path", "code_symbol"].includes(reference?.identity?.kind);
      }),
      cohesive_relation_ids: [],
      verification_claim_ids: verificationIds.filter((id) => claims.get(id)?.modality === "MUST"),
      supplementary_verification_claim_ids: verificationIds.filter(
        (id) => claims.get(id)?.modality !== "MUST"),
      exclusive_verification_claim_ids: verificationIds.filter((id) =>
        verifyingRelations.filter(({ source_claim_id: source }) => source === id).length === 1),
      shared_verification_claim_ids: verificationIds.filter((id) =>
        verifyingRelations.filter(({ source_claim_id: source }) => source === id).length > 1),
      incoming_dependency_component_ids: arcs.filter(
        ({ dependent_component_id: id }) => id === componentByClaim.get(claim.claim_id)
      ).map(({ prerequisite_component_id: id }) => id),
      outgoing_dependency_component_ids: arcs.filter(
        ({ prerequisite_component_id: id }) => id === componentByClaim.get(claim.claim_id)
      ).map(({ dependent_component_id: id }) => id),
      dependency_depth: 0,
      mandatory_bearing: ["MUST", "MUST_NOT"].includes(claim.modality),
      complexity: {
        behavior_claim_count: 1,
        mandatory_behavior_count: ["MUST", "MUST_NOT"].includes(claim.modality) ? 1 : 0,
        behavior_proposition_count: 1,
        behavior_reference_count: referenceIds.length,
        cohesive_relation_count: 0,
        distinct_behavior_operator_count: proposition ? 1 : 0,
        behavior_operator_counts: proposition ? { [proposition.operator]: 1 } : {},
        conditional_behavior_proposition_count:
          proposition?.applicability_context?.mode === "unconditional" ? 0 : 1,
        attached_verification_count: verificationIds.length,
        supplementary_verification_count: verificationIds.filter(
          (id) => claims.get(id)?.modality !== "MUST").length,
        exclusive_verification_count: verificationIds.filter((id) =>
          verifyingRelations.filter(({ source_claim_id: source }) => source === id).length === 1
        ).length,
        shared_verification_count: verificationIds.filter((id) =>
          verifyingRelations.filter(({ source_claim_id: source }) => source === id).length > 1
        ).length,
        max_verification_behavior_fan_out: Math.max(0, ...verificationIds.map((id) =>
          verifyingRelations.filter(({ source_claim_id: source }) => source === id).length)),
        max_verification_component_fan_out: Math.max(0, ...verificationIds.map((id) =>
          new Set(verifyingRelations.filter(({ source_claim_id: source }) => source === id)
            .map(({ target_claim_id: target }) => componentByClaim.get(target))).size)),
        max_behavior_verifier_count: verificationIds.length,
        dependency_in_degree: arcs.filter(({ dependent_component_id: id }) =>
          id === componentByClaim.get(claim.claim_id)).length,
        dependency_out_degree: arcs.filter(({ prerequisite_component_id: id }) =>
          id === componentByClaim.get(claim.claim_id)).length
      }
    };
  });
  const collectionAttachments = contract.collections.map((collection) => {
    const behaviorIds = collection.member_claim_ids.filter((id) => componentByClaim.has(id));
    if (collection.collection_kind === "closed_set") behaviorIds.sort(compare);
    const members = behaviorIds.map((id) => {
      const verificationIds = [...new Set(verificationByBehavior.get(id) ?? [])].sort(compare);
      return {
        behavior_claim_id: id,
        component_id: componentByClaim.get(id),
        verification_claim_ids: verificationIds,
        falsifying_proposition_ids: verificationIds.map((verificationId) =>
          claims.get(verificationId)?.falsifying_proposition_id).filter(Boolean).sort(compare)
      };
    });
    const verifierCounts = new Map();
    const falsifierCounts = new Map();
    for (const member of members) {
      for (const id of member.verification_claim_ids) {
        verifierCounts.set(id, (verifierCounts.get(id) ?? 0) + 1);
      }
      for (const id of member.falsifying_proposition_ids) {
        falsifierCounts.set(id, (falsifierCounts.get(id) ?? 0) + 1);
      }
    }
    const targetIds = [...new Set(behaviorIds.map((id) => componentByClaim.get(id)))];
    return {
      collection_id: collection.collection_id,
      collection_kind: collection.collection_kind,
      behavior_claim_ids: behaviorIds,
      nonbehavior_claim_ids: collection.member_claim_ids.filter((id) =>
        claims.has(id) && !componentByClaim.has(id)).sort(compare),
      target_component_ids: targetIds,
      attachment: targetIds.length === 0 ? "no_behavior_members"
        : targetIds.length === 1 ? "single_component" : "shared_components",
      verification_population: {
        verified_behavior_member_count: members.filter(
          ({ verification_claim_ids: ids }) => ids.length > 0).length,
        distinct_verification_claim_count: verifierCounts.size,
        distinct_falsifying_proposition_count: falsifierCounts.size,
        shared_verification_claim_ids: [...verifierCounts].filter(([, count]) => count > 1)
          .map(([id]) => id).sort(compare),
        shared_falsifying_proposition_ids: [...falsifierCounts]
          .filter(([, count]) => count > 1).map(([id]) => id).sort(compare),
        members_without_exclusive_falsifier_ids: members.filter((member) =>
          !member.falsifying_proposition_ids.some((id) => falsifierCounts.get(id) === 1)
        ).map(({ behavior_claim_id: id }) => id),
        members
      }
    };
  }).sort((left, right) => compare(left.collection_id, right.collection_id));
  return {
    decomposition_version: "controlled-contract-decomposition.v1",
    schema_valid: true,
    schema_errors: [],
    facts: {
      behavior_component_count: components.length,
      collection_overlay: { collection_count: collectionAttachments.length,
        attachments: collectionAttachments },
      components,
      behavior_dependency_relations: dependencies,
      behavior_dependency_arcs: arcs
    },
    source_contract_diagnostics: validation.diagnostics,
    diagnostics: []
  };
}

async function checkContractSource({ resolvedInputPath, inputText, contract }) {
  const runtime = {
    toolVersion: TOOL_VERSION,
    schemaPath: DEFAULT_SCHEMA_PATH,
    schema: NATIVE_CONTRACT_SCHEMA_V1,
    schemaVersion: SCHEMA_VERSION_V1,
    vocabularyVersion: VOCABULARY_VERSION_V1,
    profileId: PROFILE_ID_V1,
    validateContract: validateAndResolveNativeContractV1
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
  const decomposition = stableDecomposition(contract, validation);
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
      kind: "stable_local",
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
  const evaluation = evaluateVerificationProfileV1({
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
    tool_version: TOOL_VERSION_ADMITTED,
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
  TOOL_VERSION,
  TOOL_VERSION_ADMITTED,
  checkContract,
  checkContractWithProofPack,
  main,
  parseArgs,
  readJson,
  usage
};
