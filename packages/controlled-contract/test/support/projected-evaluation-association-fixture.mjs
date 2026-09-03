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
import {
  evaluateVerificationProfileV1,
  profileDigest as stableProfileDigest
} from "./stable-v1-proof-pack-runtime.mjs";
import {
  createGraphSelectionTrace
} from "../../lib/projected-evaluation-binding.mjs";
import {
  VOCABULARY_DIGESTS as RUNTIME_VOCABULARY_DIGESTS,
  VOCABULARY_VERSION
} from "../../lib/vocabulary-v1.mjs";
import { VOCABULARY_DIGESTS } from "../../vocabulary/controlled-contract-vocabulary.v1.mjs";

const TRANSFORMER_ID = "integration-prefix-census.v1";
const GRAPH_PROJECTION_ID = "case-association";
const CENSUS_RUN_REFERENCE = "ref-derived-census-run";
const EXACT_ITERATION_PATTERN = "occurrence-exact-associations";
const COVERING_ITERATION_PATTERN = "occurrence-covering-associations";
const PARTICIPATION_ITERATION_PATTERN = "source-participation-associations";
const VACUOUS_ITERATION_PATTERN = "excluded-case-associations";

const DAG_SOURCE = canonicalJsonBytes({
  schema_version: "controlled-contract.integration-prefix-dag.v1",
  slices: [{ slice_id: "alpha" }, { slice_id: "beta" }],
  depends_on: []
}, { file: true });
const UNITS_SOURCE = canonicalJsonBytes({
  schema_version: "controlled-contract.integration-units.v1",
  integration_units: [
    { unit_id: "unit-alpha", slice_ids: ["alpha"] },
    { unit_id: "unit-beta", slice_ids: ["beta"] }
  ]
}, { file: true });
const PATHS_SOURCE = canonicalJsonBytes({
  schema_version: "controlled-contract.execution-path-requirements.v1",
  execution_paths: [
    { path_id: "path-main", required_branches: ["ok"] },
    { path_id: "path-retry", required_branches: ["ok"] }
  ]
}, { file: true });

const SMALL_DAG_SOURCE = canonicalJsonBytes({
  schema_version: "controlled-contract.integration-prefix-dag.v1",
  slices: [{ slice_id: "alpha" }],
  depends_on: []
}, { file: true });
const SMALL_UNITS_SOURCE = canonicalJsonBytes({
  schema_version: "controlled-contract.integration-units.v1",
  integration_units: [{ unit_id: "unit-alpha", slice_ids: ["alpha"] }]
}, { file: true });
const SMALL_PATHS_SOURCE = canonicalJsonBytes({
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
const ALTERNATE_PATHS_SOURCE = canonicalJsonBytes({
  schema_version: "controlled-contract.execution-path-requirements.v1",
  execution_paths: [{ path_id: "path-alternate", required_branches: ["alt"] }]
}, { file: true });

const SOURCE_FILES = Object.freeze({
  "dag.json": DAG_SOURCE,
  "units.json": UNITS_SOURCE,
  "paths.json": PATHS_SOURCE
});
const SMALL_SOURCE_FILES = Object.freeze({
  "dag.json": SMALL_DAG_SOURCE,
  "units.json": SMALL_UNITS_SOURCE,
  "paths.json": SMALL_PATHS_SOURCE
});
const ALTERNATE_SOURCE_FILES = Object.freeze({
  "dag.json": ALTERNATE_DAG_SOURCE,
  "units.json": ALTERNATE_UNITS_SOURCE,
  "paths.json": ALTERNATE_PATHS_SOURCE
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

function completePopulation(patternId, populationRole, memberRole) {
  return {
    pattern_id: patternId,
    required_by_stage: "pre_dispatch",
    comparison: "complete_population",
    roles: [populationRole, memberRole],
    applicability_context: { mode: "unconditional", operand_roles: [] }
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

function association(associatedRole, operator, applicabilityContext, populationPatternId,
  cardinality = null) {
  return {
    associated_role: associatedRole,
    operator,
    member_position: "subject",
    associated_position: "reference_operand",
    applicability_context: applicabilityContext,
    complete_population_pattern_id: populationPatternId,
    ...(cardinality === null ? {} : { associated_cardinality: cardinality })
  };
}

const OCCURRENCE_ITERATION = Object.freeze({
  population_role: "census_occurrences",
  member_role: "occurrence",
  complete_population_pattern_id: "complete-occurrence-population",
  quantifier: "universal",
  empty_behavior: "vacuously_satisfied"
});

function buildProfile() {
  return {
    schema_version: "controlled-contract-verification-profile.v1",
    profile_id: "test.projected-evaluation.association",
    profile_version: "2.0.0",
    contract_schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    vocabulary_signature_digest: VOCABULARY_DIGESTS.signature,
    vocabulary_algebra_digest: VOCABULARY_DIGESTS.algebra,
    vocabulary_definitions_digest: VOCABULARY_DIGESTS.definitions,
    vocabulary_complete_digest: VOCABULARY_DIGESTS.complete,
    evaluation_stages: ["pre_dispatch"],
    reference_roles: [
      referenceRole("attempt_population", "cc:population", "exactly_one"),
      referenceRole("census_occurrences", "cc:evidence_occurrence", "zero_or_more"),
      referenceRole("census_run", "cc:process", "exactly_one"),
      referenceRole("criterion_population", "cc:population", "exactly_one"),
      referenceRole("excluded_cases", "cc:evidence_occurrence", "zero_or_more"),
      referenceRole("excluded_population", "cc:population", "exactly_one"),
      referenceRole("execution_paths", "cc:artifact", "zero_or_one"),
      referenceRole("integration_dag", "cc:artifact", "zero_or_one"),
      referenceRole("integration_units", "cc:artifact", "zero_or_one"),
      referenceRole("occurrence_attempts", "cc:process", "zero_or_more"),
      referenceRole("occurrence_criteria", "cc:criterion", "zero_or_more"),
      referenceRole("occurrence_population", "cc:population", "exactly_one"),
      referenceRole("occurrence_sources", "cc:resource", "zero_or_more"),
      referenceRole("prefix_census", "cc:artifact", "zero_or_one"),
      referenceRole("source_population", "cc:population", "exactly_one")
    ],
    number_roles: [],
    distinct_reference_role_sets: [],
    reference_binding_patterns: [
      completePopulation(
        "complete-attempt-population", "attempt_population", "occurrence_attempts"
      ),
      completePopulation(
        "complete-criterion-population", "criterion_population", "occurrence_criteria"
      ),
      completePopulation(
        "complete-excluded-population", "excluded_population", "excluded_cases"
      ),
      completePopulation(
        "complete-occurrence-population", "occurrence_population", "census_occurrences"
      ),
      completePopulation(
        "complete-source-population", "source_population", "occurrence_sources"
      )
    ],
    reference_role_count_bindings: [],
    binding_constraint_patterns: [
      bindingConstraint("census-occurrences-bound", "census_occurrences", 1, null),
      bindingConstraint("execution-paths-bound", "execution_paths", 1, 1),
      bindingConstraint("integration-dag-bound", "integration_dag", 1, 1),
      bindingConstraint("integration-units-bound", "integration_units", 1, 1),
      bindingConstraint("prefix-census-bound", "prefix_census", 1, 1)
    ],
    claim_patterns: [
      {
        pattern_id: EXACT_ITERATION_PATTERN,
        required_by_stage: "pre_dispatch",
        claim_kind: "evidence",
        allowed_modalities: ["MUST"],
        for_each: {
          ...OCCURRENCE_ITERATION,
          association_bindings: [
            association("occurrence_attempts", "reference:observed_in",
              { mode: "unconditional", operand_roles: [] },
              "complete-attempt-population"),
            association("occurrence_sources", "reference:originates_from",
              { mode: "during", operand_roles: ["census_run"] },
              "complete-source-population")
          ]
        },
        proposition_template: {
          subject_role: "occurrence",
          operator: "reference:depends_on",
          applicability_context: { mode: "unconditional", operand_roles: [] },
          operands: [
            { kind: "reference", role: "occurrence_attempts" },
            { kind: "reference", role: "occurrence_sources" }
          ]
        }
      },
      {

        pattern_id: PARTICIPATION_ITERATION_PATTERN,
        required_by_stage: "pre_dispatch",
        claim_kind: "evidence",
        allowed_modalities: ["MUST"],
        for_each: {
          population_role: "occurrence_sources",
          member_role: "source_member",
          complete_population_pattern_id: "complete-source-population",
          quantifier: "universal",
          empty_behavior: "vacuously_satisfied",
          association_bindings: [{
            associated_role: "census_occurrences",
            operator: "reference:originates_from",
            member_position: "reference_operand",
            associated_position: "subject",
            applicability_context: { mode: "during", operand_roles: ["census_run"] },
            complete_population_pattern_id: "complete-occurrence-population",
            associated_cardinality: "one_or_more"
          }]
        },
        proposition_template: {
          subject_role: "census_occurrences",
          operator: "reference:originates_from",
          applicability_context: { mode: "during", operand_roles: ["census_run"] },
          operands: [{ kind: "reference", role: "source_member" }]
        }
      },
      {

        pattern_id: VACUOUS_ITERATION_PATTERN,
        required_by_stage: "pre_dispatch",
        claim_kind: "evidence",
        allowed_modalities: ["MUST"],
        for_each: {
          population_role: "excluded_cases",
          member_role: "excluded_case",
          complete_population_pattern_id: "complete-excluded-population",
          quantifier: "universal",
          empty_behavior: "vacuously_satisfied",
          association_bindings: [
            association("occurrence_attempts", "reference:observed_in",
              { mode: "unconditional", operand_roles: [] },
              "complete-attempt-population")
          ]
        },
        proposition_template: {
          subject_role: "excluded_case",
          operator: "reference:observed_in",
          applicability_context: { mode: "unconditional", operand_roles: [] },
          operands: [{ kind: "reference", role: "occurrence_attempts" }]
        }
      },
      {
        pattern_id: COVERING_ITERATION_PATTERN,
        required_by_stage: "pre_dispatch",
        claim_kind: "evidence",
        allowed_modalities: ["MUST"],
        for_each: {
          ...OCCURRENCE_ITERATION,
          association_bindings: [
            association("occurrence_criteria", "reference:covers",
              { mode: "unconditional", operand_roles: [] },
              "complete-criterion-population", "one_or_more")
          ]
        },
        proposition_template: {
          subject_role: "occurrence",
          operator: "reference:covers",
          applicability_context: { mode: "unconditional", operand_roles: [] },
          operands: [{ kind: "reference", role: "occurrence_criteria" }]
        }
      }
    ],
    relation_patterns: [],
    collection_patterns: [],
    resolver_fact_patterns: [],
    evidence_patterns: [],
    falsifier_condition_bindings: [{
      relation_pattern_id: "no-verification-relation-pattern",
      applicability_context: { mode: "unconditional", operand_roles: [] }
    }],
    falsifier_occurrence_bindings: [],
    satisfaction_expression: {
      all_of: [
        { pattern: COVERING_ITERATION_PATTERN },
        { pattern: EXACT_ITERATION_PATTERN },
        { pattern: PARTICIPATION_ITERATION_PATTERN },
        { pattern: VACUOUS_ITERATION_PATTERN },
        { pattern: "census-occurrences-bound" },
        { pattern: "complete-attempt-population" },
        { pattern: "complete-criterion-population" },
        { pattern: "complete-excluded-population" },
        { pattern: "complete-occurrence-population" },
        { pattern: "complete-source-population" },
        { pattern: "execution-paths-bound" },
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

function graphReferenceIds(graph, typeTerm) {
  return graph.references
    .filter(({ type_term: term }) => term === typeTerm)
    .map(({ reference_id: referenceId }) => referenceId)
    .filter((referenceId) => referenceId !== CENSUS_RUN_REFERENCE)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function populationReference(graph, term) {
  return graph.references.find(({ identity }) => identity.term === term).reference_id;
}

function associationClaimIds(graph, occurrenceReferenceId) {
  const caseId = occurrenceReferenceId.slice("ref-".length);
  return {
    attempt: `claim-observed-in-${caseId}`,
    source: `claim-originates-from-${caseId}`,
    criteria: graph.claims
      .map(({ claim_id: claimId }) => claimId)
      .filter((claimId) => claimId.startsWith("claim-covers-") &&
        claimId.endsWith(`-${caseId}`))
      .sort()
  };
}

function buildEvaluationInput(graph) {
  return {
    input_version: "controlled-contract-verification-profile-input.v1",
    evaluation_stage: "pre_dispatch",
    reference_bindings: [
      {
        role: "attempt_population",
        reference_ids: [populationReference(graph, "attempt")]
      },
      {
        role: "census_occurrences",
        reference_ids: graphReferenceIds(graph, "cc:evidence_occurrence")
      },
      { role: "census_run", reference_ids: [CENSUS_RUN_REFERENCE] },
      {
        role: "criterion_population",
        reference_ids: [populationReference(graph, "criterion")]
      },
      { role: "excluded_cases", reference_ids: [] },
      {
        role: "excluded_population",
        reference_ids: [populationReference(graph, "excluded-case")]
      },
      { role: "execution_paths", reference_ids: ["ref-source-paths"] },
      { role: "integration_dag", reference_ids: ["ref-source-dag"] },
      { role: "integration_units", reference_ids: ["ref-source-units"] },
      {
        role: "occurrence_attempts",
        reference_ids: graphReferenceIds(graph, "cc:process")
      },
      {
        role: "occurrence_criteria",
        reference_ids: graphReferenceIds(graph, "cc:criterion")
      },
      {
        role: "occurrence_population",
        reference_ids: [populationReference(graph, "occurrence")]
      },
      {
        role: "occurrence_sources",
        reference_ids: graphReferenceIds(graph, "cc:resource")
      },
      { role: "prefix_census", reference_ids: ["ref-prefix-census"] },
      {
        role: "source_population",
        reference_ids: [populationReference(graph, "source")]
      }
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
            role: "census_occurrences",
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
    "Test-only synthetic profile for the generic iterated-association binding.";
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
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-projected-association-"));
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

function realEvaluationTrace(subject, { profile = null } = {}) {
  const selectionTrace = createGraphSelectionTrace();
  const evaluation = evaluateVerificationProfileV1({
    contract: structuredClone(subject.contract),
    profile: structuredClone(profile ?? subject.profile),
    evaluation_input: structuredClone(subject.evaluationInput)
  }, { graphSelectionSink: selectionTrace.sink });
  return { evaluation, trace: selectionTrace.snapshot() };
}

function retracedWith(trace, records) {
  return Object.freeze({
    trace_version: trace.trace_version,
    began: trace.began,
    records: Object.freeze(records.map((record) => Object.freeze({ ...record })))
  });
}

function projectedBindingDiagnostics(projected) {
  return projected.assessment.diagnostics
    .filter(({ source, detail }) => source === "assessment_binding" &&
      detail.field === "exact_binding.projected_evaluation")
    .map(({ detail }) => detail)
    .sort((left, right) =>
      JSON.stringify(left) < JSON.stringify(right) ? -1
        : JSON.stringify(left) > JSON.stringify(right) ? 1 : 0);
}

function projectedBindingCodes(projected) {
  return [...new Set(projectedBindingDiagnostics(projected).map(({ code }) => code))]
    .sort();
}

export {
  ALTERNATE_SOURCE_FILES,
  CENSUS_RUN_REFERENCE,
  COVERING_ITERATION_PATTERN,
  PARTICIPATION_ITERATION_PATTERN,
  VACUOUS_ITERATION_PATTERN,
  EXACT_BINDING_SOURCES,
  EXACT_ITERATION_PATTERN,
  GRAPH_PROJECTION_ID,
  SMALL_SOURCE_FILES,
  SOURCE_FILES,
  TRANSFORMER_ID,
  associationClaimIds,
  buildContract,
  buildDeclaration,
  buildEvaluationInput,
  buildPack,
  buildProfile,
  censusBytes,
  createSubject,
  graphReferenceIds,
  populationReference,
  projectedBindingCodes,
  projectedBindingDiagnostics,
  projectedGraph,
  realEvaluationTrace,
  retracedWith,
  sha256
};
