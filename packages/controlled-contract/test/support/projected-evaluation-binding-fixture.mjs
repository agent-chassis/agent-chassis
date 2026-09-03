import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  canonicalJsonBytes,
  sha256
} from "../../lib/deterministic-projection-primitives.mjs";
import {
  executeDeterministicProjection,
  prepareDeterministicProjection
} from "../../lib/deterministic-projection.mjs";
import {
  canonicalDigest as exactCanonicalDigest
} from "../../lib/exact-binding-common.mjs";
import {
  PinnedCaptureRoot,
  captureAndEvaluateExactBindingsV1
} from "../../lib/exact-binding-capture.mjs";
import {
  snapshotExactBindingAssessmentRequest
} from "../../lib/exact-binding-plain-data.mjs";
import {
  canonicalDigest,
  canonicalJson,
  projectContractAssessment
} from "../../lib/contract-assessment.mjs";
import { checkContract } from "../../bin/check-contract.mjs";
import { profileDigest as stableProfileDigest } from "./stable-v1-proof-pack-runtime.mjs";
import {
  VOCABULARY_DIGESTS as RUNTIME_VOCABULARY_DIGESTS,
  VOCABULARY_VERSION
} from "../../lib/vocabulary-v1.mjs";
import { VOCABULARY_DIGESTS } from "../../vocabulary/controlled-contract-vocabulary.v1.mjs";

const TRANSFORMER_ID = "integration-prefix-census.v1";
const GRAPH_PROJECTION_ID = "case-membership";
const CASE_POPULATION_REFERENCE = "ref-derived-case-population";
const CASE_ITERATION = Object.freeze({
  population_role: "census_cases",
  member_role: "case_member",
  complete_population_pattern_id: "complete-case-population",
  quantifier: "universal",
  empty_behavior: "vacuously_satisfied"
});

const DAG_SOURCE = canonicalJsonBytes({
  schema_version: "controlled-contract.integration-prefix-dag.v1",
  slices: [{ slice_id: "alpha" }],
  depends_on: []
}, { file: true });
const UNITS_SOURCE = canonicalJsonBytes({
  schema_version: "controlled-contract.integration-units.v1",
  integration_units: [{ unit_id: "unit-alpha", slice_ids: ["alpha"] }]
}, { file: true });
const PATHS_SOURCE = canonicalJsonBytes({
  schema_version: "controlled-contract.execution-path-requirements.v1",
  execution_paths: [{ path_id: "path-main", required_branches: ["ok"] }]
}, { file: true });

const ALTERNATE_DAG_SOURCE = canonicalJsonBytes({
  schema_version: "controlled-contract.integration-prefix-dag.v1",
  slices: [{ slice_id: "omega" }],
  depends_on: []
}, { file: true });
const ALTERNATE_UNITS_SOURCE = canonicalJsonBytes({
  schema_version: "controlled-contract.integration-units.v1",
  integration_units: [{ unit_id: "unit-omega", slice_ids: ["omega"] }]
}, { file: true });

const SOURCE_FILES = Object.freeze({
  "dag.json": DAG_SOURCE,
  "units.json": UNITS_SOURCE,
  "paths.json": PATHS_SOURCE
});
const ALTERNATE_SOURCE_FILES = Object.freeze({
  "dag.json": ALTERNATE_DAG_SOURCE,
  "units.json": ALTERNATE_UNITS_SOURCE,
  "paths.json": PATHS_SOURCE
});

const EXACT_BINDING_SOURCES = Object.freeze({
  "dag-source": { kind: "artifact_file", relative_path: "dag.json" },
  "execution-paths": { kind: "artifact_file", relative_path: "paths.json" },
  "integration-units": { kind: "artifact_file", relative_path: "units.json" },
  "prefix-census": { kind: "artifact_file", relative_path: "census.json" }
});

function censusBytes(sources = SOURCE_FILES) {
  return executeDeterministicProjection(TRANSFORMER_ID, [
    sources["dag.json"], sources["units.json"], sources["paths.json"]
  ]);
}

function projectedGraph(bytes) {
  return prepareDeterministicProjection(TRANSFORMER_ID, bytes)
    .graph(GRAPH_PROJECTION_ID);
}

function referenceRole(role, typeTerm, cardinality) {
  return {
    role,
    allowed_type_terms: [typeTerm],
    allowed_identity_kinds: ["profile_term"],
    cardinality
  };
}

function membershipClaimPattern(patternId, subjectRole, operandRole) {
  return {
    pattern_id: patternId,
    required_by_stage: "pre_dispatch",
    claim_kind: "evidence",
    allowed_modalities: ["MUST"],
    proposition_template: {
      subject_role: subjectRole,
      operator: "reference:contains",
      applicability_context: { mode: "unconditional", operand_roles: [] },
      operands: [{ kind: "reference", role: operandRole }]
    }
  };
}

function bindingConstraint(patternId, role, minimum, maximum) {
  return {
    pattern_id: patternId,
    required_by_stage: "pre_dispatch",
    role_kind: "reference",
    role,
    minimum,
    ...(maximum === null ? {} : { maximum })
  };
}

function buildProfile() {
  return {
    schema_version: "controlled-contract-verification-profile.v1",
    profile_id: "test.projected-evaluation.reference",
    profile_version: "2.0.0",
    contract_schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    vocabulary_signature_digest: VOCABULARY_DIGESTS.signature,
    vocabulary_algebra_digest: VOCABULARY_DIGESTS.algebra,
    vocabulary_definitions_digest: VOCABULARY_DIGESTS.definitions,
    vocabulary_complete_digest: VOCABULARY_DIGESTS.complete,
    evaluation_stages: ["pre_dispatch"],
    reference_roles: [
      referenceRole("case_of_empty_prefix", "cc:test", "exactly_one"),
      referenceRole("case_of_full_prefix", "cc:test", "exactly_one"),
      referenceRole("case_population", "cc:population", "exactly_one"),
      referenceRole("census_cases", "cc:test", "zero_or_more"),
      referenceRole("empty_prefix", "cc:scope", "exactly_one"),
      referenceRole("execution_paths", "cc:artifact", "zero_or_one"),
      referenceRole("full_prefix", "cc:scope", "exactly_one"),
      referenceRole("integration_dag", "cc:artifact", "zero_or_one"),
      referenceRole("integration_units", "cc:artifact", "zero_or_one"),
      referenceRole("prefix_census", "cc:artifact", "zero_or_one")
    ],
    number_roles: [],
    distinct_reference_role_sets: [],
    reference_binding_patterns: [{
      pattern_id: "complete-case-population",
      required_by_stage: "pre_dispatch",
      comparison: "complete_population",
      roles: ["case_population", "census_cases"],
      applicability_context: { mode: "unconditional", operand_roles: [] }
    }],
    reference_role_count_bindings: [],
    binding_constraint_patterns: [
      bindingConstraint("census-cases-bound", "census_cases", 1, null),
      bindingConstraint("execution-paths-bound", "execution_paths", 1, 1),
      bindingConstraint("integration-dag-bound", "integration_dag", 1, 1),
      bindingConstraint("integration-units-bound", "integration_units", 1, 1),
      bindingConstraint("prefix-census-bound", "prefix_census", 1, 1)
    ],
    claim_patterns: [
      membershipClaimPattern(
        "empty-prefix-contains-case", "empty_prefix", "case_of_empty_prefix"
      ),
      membershipClaimPattern(
        "full-prefix-contains-case", "full_prefix", "case_of_full_prefix"
      ),
      {
        pattern_id: "case-exists",
        required_by_stage: "pre_dispatch",
        claim_kind: "evidence",
        allowed_modalities: ["MUST"],
        for_each: { ...CASE_ITERATION },
        proposition_template: {
          subject_role: "case_member",
          operator: "boolean:exists",
          applicability_context: { mode: "unconditional", operand_roles: [] },
          operands: [{ kind: "boolean", value: true }]
        }
      },
      {
        pattern_id: "case-member-of-population",
        required_by_stage: "pre_dispatch",
        claim_kind: "evidence",
        allowed_modalities: ["MUST"],
        for_each: { ...CASE_ITERATION },
        proposition_template: {
          subject_role: "case_member",
          operator: "reference:member_of",
          applicability_context: { mode: "unconditional", operand_roles: [] },
          operands: [{ kind: "reference", role: "case_population" }]
        }
      }
    ],
    relation_patterns: [{
      pattern_id: "case-derivation",
      required_by_stage: "pre_dispatch",
      role: "derives_from",
      source_claim_pattern_id: "case-member-of-population",
      target_claim_pattern_id: "case-exists"
    }],
    collection_patterns: [{
      pattern_id: "derived-case-membership-population",
      required_by_stage: "pre_dispatch",
      collection_kind: "closed_set",
      collection_purpose: "derived_case_membership",
      member_claim_pattern_ids: [
        "empty-prefix-contains-case", "full-prefix-contains-case"
      ]
    }],
    resolver_fact_patterns: [],
    evidence_patterns: [],
    falsifier_condition_bindings: [{
      relation_pattern_id: "no-verification-relation-pattern",
      applicability_context: { mode: "unconditional", operand_roles: [] }
    }],
    falsifier_occurrence_bindings: [],
    satisfaction_expression: {
      all_of: [
        { pattern: "case-derivation" },
        { pattern: "case-exists" },
        { pattern: "case-member-of-population" },
        { pattern: "census-cases-bound" },
        { pattern: "complete-case-population" },
        { pattern: "derived-case-membership-population" },
        { pattern: "empty-prefix-contains-case" },
        { pattern: "execution-paths-bound" },
        { pattern: "full-prefix-contains-case" },
        { pattern: "integration-dag-bound" },
        { pattern: "integration-units-bound" },
        { pattern: "prefix-census-bound" }
      ]
    }
  };
}

function artifactReference(referenceId, term) {
  return {
    reference_id: referenceId,
    type_term: "cc:artifact",
    identity: { kind: "profile_term", term }
  };
}

function buildContract(graph) {
  return {
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    references: [
      ...structuredClone(graph.references),
      artifactReference("ref-source-dag", "integration-dag-source"),
      artifactReference("ref-source-paths", "execution-paths-source"),
      artifactReference("ref-source-units", "integration-units-source"),
      artifactReference("ref-prefix-census", "prefix-census-artifact")
    ].sort((left, right) =>
      left.reference_id < right.reference_id ? -1
        : left.reference_id > right.reference_id ? 1 : 0),
    propositions: structuredClone(graph.propositions),
    claims: structuredClone(graph.claims),
    relations: structuredClone(graph.relations),
    collections: structuredClone(graph.collections),
    residue: [],
    annotations: []
  };
}

function orderedCases(graph) {
  return graph.propositions
    .filter(({ proposition_id: id }) => id.startsWith("prop-membership-"))
    .map((proposition) => ({
      prefix_reference_id: proposition.subject_reference_id,
      case_reference_id: proposition.operands[0].reference_id,
      claim_id: `claim-${proposition.proposition_id.slice("prop-".length)}`,
      proposition_id: proposition.proposition_id
    }));
}

function buildEvaluationInput(graph) {
  const [first, second] = orderedCases(graph);
  return {
    input_version: "controlled-contract-verification-profile-input.v1",
    evaluation_stage: "pre_dispatch",
    reference_bindings: [
      { role: "case_of_empty_prefix", reference_ids: [first.case_reference_id] },
      { role: "case_of_full_prefix", reference_ids: [second.case_reference_id] },
      { role: "case_population", reference_ids: [CASE_POPULATION_REFERENCE] },
      {
        role: "census_cases",
        reference_ids: [first.case_reference_id, second.case_reference_id]
          .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      },
      { role: "empty_prefix", reference_ids: [first.prefix_reference_id] },
      { role: "execution_paths", reference_ids: ["ref-source-paths"] },
      { role: "full_prefix", reference_ids: [second.prefix_reference_id] },
      { role: "integration_dag", reference_ids: ["ref-source-dag"] },
      { role: "integration_units", reference_ids: ["ref-source-units"] },
      { role: "prefix_census", reference_ids: ["ref-prefix-census"] }
    ],
    number_bindings: [],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: []
  };
}

function buildDeclaration(profile, profileDigest, { optIn = true } = {}) {
  return {
    schema_version: "controlled-contract-exact-binding-declaration.v1",
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: profileDigest,
    ...(optIn ? {
      projected_evaluation_binding: {
        binding_version: "controlled-contract-projected-evaluation-binding.v1",
        result_requirement_id: "prefix-census",
        graph_projection_id: GRAPH_PROJECTION_ID
      }
    } : {}),
    requirements: [
      {
        requirement_id: "dag-source",
        binding_kind: "artifact_bytes",
        role_coverage: [{
          role: "integration_dag", coverage: "exact", projection: "artifact_subject"
        }]
      },
      {
        requirement_id: "execution-paths",
        binding_kind: "artifact_bytes",
        role_coverage: [{
          role: "execution_paths", coverage: "exact", projection: "artifact_subject"
        }]
      },
      {
        requirement_id: "integration-units",
        binding_kind: "artifact_bytes",
        role_coverage: [{
          role: "integration_units", coverage: "exact", projection: "artifact_subject"
        }]
      },
      {
        requirement_id: "prefix-census",
        binding_kind: "artifact_bytes",
        role_coverage: [
          {
            role: "census_cases",
            coverage: "exact",
            projection: "projection_result_population",
            population_id: "cases"
          },
          {
            role: "prefix_census", coverage: "exact", projection: "artifact_subject"
          }
        ]
      }
    ],
    relations: [{
      relation_id: "derive-prefix-census",
      operator: "deterministic_projection",
      transformer_id: TRANSFORMER_ID,
      source_requirement_ids: ["dag-source", "integration-units", "execution-paths"],
      result_requirement_id: "prefix-census"
    }]
  };
}

function buildPack(profile, declaration) {
  const profileDigest = stableProfileDigest(profile);
  const guarantee =
    "Test-only synthetic profile for the generic projected-evaluation binding.";
  const admission = {
    schema_version: "controlled-contract-admitted-proof-pack.v2",
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: profileDigest,
    guarantee,
    guarantee_digest: sha256(guarantee),
    explicit_exclusions: [],
    certification: {
      adequacy_declaration_digest: "a".repeat(64),
      adequacy_result_digest: "b".repeat(64)
    }
  };
  return Object.freeze({
    profile,
    declaration,
    admission,
    profile_digest: profileDigest,
    admission_digest: canonicalDigest(admission),
    exact_binding_declaration_digest: exactCanonicalDigest(declaration),
    exact_binding_certification_digest: "c".repeat(64),
    admission_version: 2
  });
}

async function createSubject({
  sourceFiles = SOURCE_FILES,
  censusOverride = null,
  mutateGraph = (graph) => graph,
  mutateContract = (contract) => contract,
  mutateEvaluationInput = (input) => input,
  mutateProfile = (profile) => profile,
  optIn = true
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-projected-evaluation-"));
  const derived = censusBytes(sourceFiles);
  const census = censusOverride ?? derived;
  const graph = mutateGraph(projectedGraph(derived), derived);
  const profile = mutateProfile(buildProfile());
  const declaration = buildDeclaration(profile, stableProfileDigest(profile), { optIn });
  const pack = buildPack(profile, declaration);
  const contract = mutateContract(buildContract(graph), graph);
  const evaluationInput = mutateEvaluationInput(buildEvaluationInput(graph), graph);
  const contractSource = canonicalJson(contract);
  await Promise.all([
    ...Object.entries(sourceFiles).map(([name, bytes]) =>
      writeFile(path.join(root, name), bytes)),
    writeFile(path.join(root, "census.json"), census),
    writeFile(path.join(root, "contract.json"), contractSource),
    writeFile(path.join(root, "evaluation.json"), canonicalJson(evaluationInput))
  ]);
  const context = {
    contract_digest: exactCanonicalDigest(contract),
    profile_digest: pack.profile_digest,
    evaluation_input_digest: exactCanonicalDigest(evaluationInput),
    vocabulary_version: VOCABULARY_VERSION,
    vocabulary_complete_digest: RUNTIME_VOCABULARY_DIGESTS.complete,
    admission_digest: pack.admission_digest,
    exact_binding_declaration_digest: pack.exact_binding_declaration_digest,
    exact_binding_certification_digest: pack.exact_binding_certification_digest
  };
  const request = snapshotExactBindingAssessmentRequest({
    contractPath: "contract.json",
    evaluationInputPath: "evaluation.json",
    profileId: profile.profile_id,
    exactBindingSources: structuredClone(EXACT_BINDING_SOURCES)
  });
  const pinnedRoot = await PinnedCaptureRoot.open(root);
  let exactBindingResult;
  try {
    exactBindingResult = await captureAndEvaluateExactBindingsV1({
      request,
      declaration,
      contract,
      evaluationInput,
      context,
      expectedContext: context,
      pinnedRoot
    });
  } finally {
    await pinnedRoot.close();
  }
  const structuralResult = await checkContract(path.join(root, "contract.json"));
  const project = (overrides = {}) => projectContractAssessment({
    mode: "exact_bound_profile",
    contract,
    structuralResult,
    structuralInputSource: contractSource,
    evaluationInput,
    proofPack: pack,
    exactBindingResult,
    exactBindingSources: EXACT_BINDING_SOURCES,
    ...overrides
  });
  return {
    root,
    graph,
    census,
    contract,
    contractSource,
    declaration,
    evaluationInput,
    exactBindingResult,
    pack,
    profile,
    project,
    structuralResult,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

function projectedBindingDiagnostics(projected) {
  return projected.assessment.diagnostics
    .filter(({ source, detail }) => source === "assessment_binding" &&
      detail.field === "exact_binding.projected_evaluation")
    .map(({ detail }) => detail.code)
    .sort();
}

export {
  ALTERNATE_SOURCE_FILES,
  EXACT_BINDING_SOURCES,
  GRAPH_PROJECTION_ID,
  SOURCE_FILES,
  TRANSFORMER_ID,
  buildContract,
  buildDeclaration,
  buildEvaluationInput,
  buildPack,
  buildProfile,
  censusBytes,
  createSubject,
  orderedCases,
  projectedBindingDiagnostics,
  projectedGraph,
  sha256
};
