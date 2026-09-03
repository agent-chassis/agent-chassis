import { executeDeterministicProjection } from "../../lib/deterministic-projection.mjs";
import { evaluateStableProofPackFixtureV1 } from
  "../support/stable-v1-proof-pack-runtime.mjs";
import { PROOF_PACK_ADEQUACY_RUN_VERSION } from
  "../support/proof-pack-adequacy-constants.mjs";

const GUARANTEE = "For one exact captured complete declared integration DAG, one exact complete integration-unit partition, and one exact declared execution-path and required-branch population, the package-owned integration-prefix-census.v1 transformer derives every independently integrable prefix crossed with every declared path and required branch; that exact derived case population is bound into the profile, every case is declared preserved, the aggregate result records that population, and one verification reads the exact sources, census, every case, and aggregate result with a positive non-preservation falsifier.";
const PROFILE_DIGEST =
  "f0ccdd91e638d72aa09c7e3e46dc4d16ae295d602dde297899ea88017729b32c";
const GUARANTEE_DIGEST =
  "77ffbca9bd9a063e667d13d48668f30e21236d4da2f2eb612db07cd7dc40754e";

const EXCLUSIONS = Object.freeze([
  "caller-supplied-dag-unit-path-and-branch-source-truth-or-authority",
  "concurrency-rollback-and-rollout-orchestration",
  "dishonest-authored-preservation-claims-or-reference-grounding",
  "pack-applicability-evidence-authority-or-cce-consequence",
  "production-path-or-branch-discovery-outside-captured-sources",
  "runtime-or-deployment-behavior-outside-captured-artifacts"
]);

const POSITIVE_IDS = Object.freeze([
  "api-schema-rollout",
  "atomic-producer-consumer",
  "managed-repository-selection"
]);

const MUTANT_IDS = Object.freeze([
  "generic-status-only",
  "missing-target-present-case-claim",
  "producer-only-prefix-breaks-target-present"
]);

const REJECTION_PATTERNS = Object.freeze([
  ["missing-census-population-link", "census-includes-case-population"],
  ["missing-each-case-preservation", "each-prefix-case-preserved"],
  ["missing-aggregate-population-record", "preservation-result-records-case-population"],
  ["missing-aggregate-preservation", "all-prefix-cases-preserved"],
  ["missing-exact-read-spine", "verification-reads-exact-prefix-census"],
  ["missing-discriminating-verification", "verify-all-prefix-cases-preserved"]
]);

const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });
const canonicalValue = (value) => Array.isArray(value)
  ? value.map(canonicalValue)
  : value !== null && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(
      (key) => [key, canonicalValue(value[key])]
    ))
    : Object.is(value, -0) ? 0 : value;
const canonicalJsonBytes = (value) => Buffer.from(
  `${JSON.stringify(canonicalValue(value))}\n`, "utf8"
);

function sourceDocuments(domain = "managed-repository-selection", { atomic = false } = {}) {
  const labels = domain === "api-schema-rollout"
    ? { producer: "schema-producer", consumer: "api-consumer", path: "api-read" }
    : domain === "message-codec-rollout"
      ? { producer: "message-encoder", consumer: "message-decoder", path: "decode" }
      : { producer: "repository-selector", consumer: "managed-reader", path: "managed-read" };
  return [{
    schema_version: "controlled-contract.integration-prefix-dag.v1",
    slices: [{ slice_id: labels.consumer }, { slice_id: labels.producer }].sort(
      (left, right) => left.slice_id < right.slice_id ? -1 : 1
    ),
    depends_on: [{
      predecessor_slice_id: labels.producer,
      successor_slice_id: labels.consumer
    }]
  }, {
    schema_version: "controlled-contract.integration-units.v1",
    integration_units: atomic ? [{
      unit_id: `${labels.producer}-${labels.consumer}`,
      slice_ids: [labels.consumer, labels.producer].sort()
    }] : [{ unit_id: labels.consumer, slice_ids: [labels.consumer] },
      { unit_id: labels.producer, slice_ids: [labels.producer] }].sort(
        (left, right) => left.unit_id < right.unit_id ? -1 : 1
      )
  }, {
    schema_version: "controlled-contract.execution-path-requirements.v1",
    execution_paths: [{
      path_id: labels.path,
      required_branches: ["target-absent", "target-present"]
    }]
  }];
}

function executePrefixChecks({ domain, atomic = false, brokenCase = null }) {
  const documents = sourceDocuments(domain, { atomic });
  const sourceBytes = documents.map(canonicalJsonBytes);
  const censusBytes = executeDeterministicProjection(
    "integration-prefix-census.v1", sourceBytes
  );
  const census = JSON.parse(censusBytes);
  const cases = census.cases.map((entry) => ({
    ...entry,
    preserved: brokenCase ? !brokenCase(entry, census) : true
  }));
  return { documents, sourceBytes, censusBytes, census, cases };
}

function resolveTemplate(template, roles, local = {}) {
  const values = (role) => local[role] ?? roles[role] ?? [];
  const subjects = values(template.subject_role);
  return {
    subject_reference_id: subjects[0] ?? null,
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.flatMap(values)
    },
    operands: template.operands.flatMap((operand) => operand.kind === "reference"
      ? values(operand.role).map(ref)
      : [structuredClone(operand)])
  };
}

function buildPrefixSafetyFixture({
  profile,
  domain = "managed-repository-selection",
  atomic = false,
  brokenCase = null,
  omitPatternIds = [],
  omitCaseIds = [],
  omitCompletePopulation = false,
  aliasRoles = {},
  roleTypeOverrides = {},
  roleCountOverrides = {},
  numberOverrides = {},
  declaredPopulationCountOverride = null,
  selectLastModalityPatterns = [],
  selectLastVerificationPatterns = [],
  mutateContract = null,
  mutateInput = null
} = {}) {
  const execution = executePrefixChecks({ domain, atomic, brokenCase });
  const caseIds = execution.cases.map(({ case_id: id }) => `ref-${id}`);
  const roles = {
    integration_dag: ["ref-integration-dag"],
    integration_units: ["ref-integration-units"],
    execution_paths: ["ref-execution-paths"],
    prefix_census: ["ref-prefix-census"],
    prefix_case_population: ["ref-prefix-case-population"],
    prefix_cases: caseIds,
    preservation_result: ["ref-preservation-result"],
    preserved_state: ["ref-preserved-state"],
    verification: ["ref-prefix-verification"],
    case_failure_condition: ["ref-case-failure-condition"]
  };
  for (const [role, sourceRole] of Object.entries(aliasRoles)) {
    roles[role] = [...roles[sourceRole]];
  }
  for (const [role, count] of Object.entries(roleCountOverrides)) {
    const existing = roles[role] ?? [];
    roles[role] = Array.from({ length: count }, (_, index) =>
      existing[index] ?? `ref-${role.replaceAll("_", "-")}-${index + 1}`);
  }
  const roleById = new Map(profile.reference_roles.map((entry) => [entry.role, entry]));
  const referenceRoles = new Map();
  for (const [role, ids] of Object.entries(roles)) for (const id of ids) {
    if (!referenceRoles.has(id)) referenceRoles.set(id, []);
    referenceRoles.get(id).push(role);
  }
  const references = [...referenceRoles].map(([referenceId, boundRoles]) => {
    const role = boundRoles[0];
    const definition = roleById.get(role);
    const typeTerm = roleTypeOverrides[role] ?? definition.allowed_type_terms[0];
    const identityKind = definition.allowed_identity_kinds?.[0] ?? "durable_id";
    return {
      reference_id: referenceId,
      type_term: typeTerm,
      identity: identityKind === "repository_path" ? {
        kind: "repository_path", repository: `example/${domain}`,
        path: `proof/${referenceId}`
      } : identityKind === "code_symbol" ? {
        kind: "code_symbol", repository: `example/${domain}`,
        path: "test/prefix-safety.mjs", symbol: referenceId
      } : identityKind === "runtime_parameter" ? {
        kind: "runtime_parameter", name: `${domain}.${referenceId}`
      } : { kind: "durable_id", domain: `prefix-safety-${domain}`, value: referenceId }
    };
  });
  const brokenStateId = "ref-not-preserved-state";
  if (execution.cases.some(({ preserved }) => !preserved)) references.push({
    reference_id: brokenStateId,
    type_term: "cc:state",
    identity: { kind: "durable_id", domain: `prefix-safety-${domain}`,
      value: "not-preserved" }
  });
  const contract = {
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    references,
    propositions: [], claims: [], relations: [], collections: [], residue: [], annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: []
  };
  const addClaim = (id, proposition, kind = "evidence", modality = "MUST",
    verificationMethod = null, falsifierId = null) => {
    contract.propositions.push({ proposition_id: `prop-${id}`, ...proposition });
    contract.claims.push({ claim_id: `claim-${id}`, proposition_id: `prop-${id}`,
      kind, modality,
      ...(verificationMethod ? { verification_method: verificationMethod } : {}),
      ...(falsifierId ? { falsifying_proposition_id: `prop-${falsifierId}` } : {}) });
  };
  const members = roles.prefix_cases;
  const count = numberOverrides.case_count ?? members.length;
  const declaredPopulationCount = declaredPopulationCountOverride ?? members.length;
  if (!omitCompletePopulation) {
    addClaim("complete-prefix-case-population-count", {
      subject_reference_id: roles.prefix_case_population[0],
      operator: "number:has_cardinality",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "number", value: declaredPopulationCount }]
    });
    addClaim("complete-prefix-case-population-members", {
      subject_reference_id: roles.prefix_case_population[0],
      operator: "reference:contains",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: members.map(ref)
    });
  }
  const omitted = new Set(omitPatternIds);
  const omittedCases = new Set(omitCaseIds);
  const lastModalities = new Set(selectLastModalityPatterns);
  const lastMethods = new Set(selectLastVerificationPatterns);
  for (const pattern of profile.claim_patterns) {
    if (omitted.has(pattern.pattern_id)) continue;
    if (pattern.for_each) {
      for (const entry of execution.cases) {
        const caseReferenceId = `ref-${entry.case_id}`;
        if (omittedCases.has(caseReferenceId)) continue;
        const proposition = resolveTemplate(pattern.proposition_template, roles, {
          [pattern.for_each.member_role]: [caseReferenceId]
        });
        if (!entry.preserved) proposition.operands = [ref(brokenStateId)];
        addClaim(`${pattern.pattern_id}-${entry.case_id.slice(5, 17)}`,
          proposition, pattern.claim_kind,
          lastModalities.has(pattern.pattern_id)
            ? pattern.allowed_modalities.at(-1) : pattern.allowed_modalities[0]);
      }
      continue;
    }
    let falsifierId = null;
    if (pattern.falsifying_proposition_template) {
      falsifierId = `falsifier-${pattern.pattern_id}`;
      contract.propositions.push({ proposition_id: `prop-${falsifierId}`,
        ...resolveTemplate(pattern.falsifying_proposition_template, roles) });
    }
    const proposition = resolveTemplate(pattern.proposition_template, roles);
    if (pattern.pattern_id === "all-prefix-cases-preserved" &&
        execution.cases.some(({ preserved }) => !preserved)) {
      proposition.operator = "reference:not_equals";
    }
    addClaim(pattern.pattern_id, proposition, pattern.claim_kind,
      lastModalities.has(pattern.pattern_id)
        ? pattern.allowed_modalities.at(-1) : pattern.allowed_modalities[0],
      pattern.claim_kind === "verification"
        ? lastMethods.has(pattern.pattern_id)
          ? pattern.verification_methods.at(-1) : pattern.verification_methods[0]
        : null, falsifierId);
  }
  for (const relation of profile.relation_patterns) if (
    !omitted.has(relation.source_claim_pattern_id) &&
    !omitted.has(relation.target_claim_pattern_id)) contract.relations.push({
      relation_id: `rel-${relation.pattern_id}`, role: relation.role,
      source_claim_id: `claim-${relation.source_claim_pattern_id}`,
      target_claim_id: `claim-${relation.target_claim_pattern_id}`
    });
  const input = {
    input_version: "controlled-contract-verification-profile-input.v1",
    evaluation_stage: "pre_dispatch",
    reference_bindings: profile.reference_roles.map(({ role }) => ({
      role, reference_ids: [...(roles[role] ?? [])]
    })),
    number_bindings: profile.number_roles.map(({ role }) => ({ role,
      value: role === "case_count" ? count : 0 })),
    claim_pattern_bindings: [], resolver_facts: [], delivered_evidence: [], stable_evaluation: {}
  };
  mutateContract?.(contract, input, roles, execution);
  mutateInput?.(input, contract, roles, execution);
  return { contract, input, profile, roles, execution };
}

function satisfaction(fixture) {
  return evaluateStableProofPackFixtureV1({
    contract: fixture.contract, profile: fixture.profile, evaluation_input: fixture.input
  }).satisfaction;
}

function mutantFixture(profile, id) {
  if (id === "producer-only-prefix-breaks-target-present") return buildPrefixSafetyFixture({
      profile, domain: "managed-repository-selection",
      brokenCase: (entry, census) => {
        const prefix = census.prefixes.find(({ prefix_id: prefixId }) =>
          prefixId === entry.prefix_id);
        return entry.branch === "target-present" &&
          prefix.slice_ids.length === 1 && prefix.slice_ids[0] === "repository-selector";
      }
    });
  if (id === "missing-target-present-case-claim") {
    const base = buildPrefixSafetyFixture({ profile, domain: "api-schema-rollout" });
    const target = base.execution.cases.find(({ branch }) => branch === "target-present");
    return buildPrefixSafetyFixture({ profile, domain: "api-schema-rollout",
      omitCaseIds: [`ref-${target.case_id}`] });
  }
  if (id === "generic-status-only") return buildPrefixSafetyFixture({
    profile, domain: "message-codec-rollout",
    omitPatternIds: ["each-prefix-case-preserved"]
  });
  throw new Error(`unknown mutant ${id}`);
}

async function runProofPackAdequacyControls({ profile }) {
  const controls = [];
  for (const [controlId, options] of [
    ["managed-repository-selection", {}],
    ["api-schema-rollout", {}],
    ["atomic-producer-consumer", { domain: "message-codec-rollout", atomic: true }]
  ]) controls.push({ control_id: controlId, category: "positive",
    implementation_outcome: "passed",
    profile_satisfaction: satisfaction(buildPrefixSafetyFixture({
      profile, domain: options.domain ?? controlId, atomic: options.atomic ?? false
    })) });
  for (const controlId of MUTANT_IDS) controls.push({ control_id: controlId,
    category: "mutant", implementation_outcome: "killed",
    profile_satisfaction: satisfaction(mutantFixture(profile, controlId)) });
  for (const [controlId, patternId] of REJECTION_PATTERNS) controls.push({
    control_id: controlId, category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: satisfaction(buildPrefixSafetyFixture({
      profile, omitPatternIds: [patternId]
    }))
  });
  for (const controlId of EXCLUSIONS) controls.push({ control_id: controlId,
    category: "exclusion", implementation_outcome: "boundary_demonstrated",
    profile_satisfaction: "not_evaluated" });
  controls.sort((left, right) => left.control_id < right.control_id ? -1 : 1);
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: PROFILE_DIGEST,
    guarantee_digest: GUARANTEE_DIGEST,
    controls
  };
}

export {
  EXCLUSIONS,
  GUARANTEE,
  MUTANT_IDS,
  POSITIVE_IDS,
  REJECTION_PATTERNS,
  buildPrefixSafetyFixture,
  executePrefixChecks,
  runProofPackAdequacyControls,
  sourceDocuments
};
