import { createHash } from "node:crypto";

function classifyTestPath(repositoryPath) {
  return typeof repositoryPath === "string" &&
    /^tests\/integration\/.+\.test\.mjs$/u.test(repositoryPath)
    ? "integration" : "other";
}

export const INTEGRATION_TEST_DESIGN_ASSESSMENT_INPUT_SCHEMA_VERSION =
  "integration-test-design-assessment-input.experimental.v0.1";
export const INTEGRATION_TEST_DESIGN_ASSESSMENT_RESULT_SCHEMA_VERSION =
  "integration-test-design-assessment-result.experimental.v0.1";
export const INTEGRATION_TEST_DESIGN_ASSESSMENT_STATES = Object.freeze([
  "pass", "fail", "incomplete", "unevaluable", "review_only"
]);

export const INTEGRATION_TEST_DESIGN_ASSESSMENT_AXES = Object.freeze([
  "registered_routes",
  "selector_partitions",
  "authority_producer_consumer_edges",
  "role_tool_profiles",
  "failure_phases",
  "result_schema_population",
  "persistent_refs_and_state",
  "concurrency_and_interleavings",
  "declared_mutants",
  "prohibited_stubs"
]);
const AXES = INTEGRATION_TEST_DESIGN_ASSESSMENT_AXES;

const COMPLETE_SOURCE_KINDS = new Set([
  "canonical_closed_set",
  "repository_registry_derived",
  "schema_derived",
  "server_derived"
]);

const REQUIRED_EVIDENCE_KEYS = {
  registered_routes: ["action_id", "boundary_id"],
  selector_partitions: ["input_id"],
  authority_producer_consumer_edges: ["action_id", "dependency_expectation_id"],
  role_tool_profiles: [
    "registered_set_id",
    "returned_set_id",
    "invoked_set_id",
    "completed_set_id"
  ],
  failure_phases: ["failure_injection_id", "expected_result_id"],
  result_schema_population: ["expected_result_id"],
  persistent_refs_and_state: ["action_id", "before_checkpoint_id", "after_checkpoint_id"],
  concurrency_and_interleavings: ["concurrency_constraint_id"],
  declared_mutants: ["mutant_case_id", "ordinary_discovery_binding_id", "kill_oracle_id"],
  prohibited_stubs: ["seam_policy_id"]
};

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function rawCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortBy(items, identity) {
  return [...values(items)].map((item) => structuredClone(item))
    .sort((left, right) => rawCompare(identity(left), identity(right)));
}

function normalizeResolvedInput(value) {
  const input = structuredClone(value);
  input.axis_applicability = sortBy(input.axis_applicability, (item) => item.axis);
  input.requirements = sortBy(input.requirements, (item) => item.requirement_id);
  input.population_censuses = sortBy(input.population_censuses, (item) => item.census_id)
    .map((census) => ({
      ...census,
      omissions: [...values(census.omissions)].sort(rawCompare),
      members: sortBy(census.members, (member) => member.member_id)
    }));
  input.obligations = sortBy(input.obligations, (item) => item.obligation_id)
    .map((obligation) => ({
      ...obligation,
      source_requirement_ids: [...values(obligation.source_requirement_ids)].sort(rawCompare),
      verification_claim_ids: [...values(obligation.verification_claim_ids)].sort(rawCompare),
      required_population_members: sortBy(
        obligation.required_population_members,
        (member) => `${member.census_id}\u0000${member.member_id}`
      )
    }));
  input.declared_integration_tests = sortBy(
    input.declared_integration_tests, (item) => item.test_id
  );
  input.integration_scenarios = sortBy(
    input.integration_scenarios, (item) => item.scenario_id
  ).map((scenario) => ({
    ...scenario,
    obligation_ids: [...values(scenario.obligation_ids)].sort(rawCompare),
    inputs: sortBy(scenario.inputs, (item) => item.input_id),

    actions: values(scenario.actions).map((item) => structuredClone(item)),
    expected_results: sortBy(scenario.expected_results, (item) => item.result_id),
    coverage: sortBy(
      scenario.coverage, (item) => `${item.census_id}\u0000${item.member_id}`
    ),
    fixture_effects: sortBy(
      scenario.fixture_effects, (item) => `${item.state_member_id}\u0000${item.effect}`
    ),
    seams: sortBy(
      scenario.seams, (item) => `${item.authority_member_id}\u0000${item.mode}`
    )
  }));
  input.interaction_requirements = sortBy(
    input.interaction_requirements, (item) => item.interaction_id
  ).map((interaction) => ({
    ...interaction,
    required_population_members: sortBy(
      interaction.required_population_members,
      (member) => `${member.census_id}\u0000${member.member_id}`
    )
  }));
  input.review_questions = sortBy(input.review_questions, (item) => item.question_id)
    .map((question) => ({
      ...question,
      related_ids: [...values(question.related_ids)].sort(rawCompare)
    }));
  return input;
}

const ROOT_FIELDS = Object.freeze([
  "schema_version", "subject", "declaration_completeness", "axis_applicability",
  "requirements", "population_censuses", "obligations",
  "declared_integration_tests", "integration_scenarios",
  "interaction_requirements", "review_questions"
]);

function inputIssue(path, message) {
  return Object.freeze({ path, message });
}

function assertResolvedInput(value) {
  const issues = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    issues.push(inputIssue("/", "resolved input must be an object"));
  } else {
    for (const key of Object.keys(value)) {
      if (!ROOT_FIELDS.includes(key)) issues.push(inputIssue(`/${key}`, "unsupported field"));
    }
    for (const key of ROOT_FIELDS) {
      if (!Object.hasOwn(value, key)) issues.push(inputIssue(`/${key}`, "required field is absent"));
    }
    if (value.schema_version !== INTEGRATION_TEST_DESIGN_ASSESSMENT_INPUT_SCHEMA_VERSION) {
      issues.push(inputIssue("/schema_version", "unsupported schema version"));
    }
    for (const key of [
      "axis_applicability", "requirements", "population_censuses", "obligations",
      "declared_integration_tests", "integration_scenarios",
      "interaction_requirements", "review_questions"
    ]) {
      if (!Array.isArray(value[key])) issues.push(inputIssue(`/${key}`, "must be an array"));
    }
  }
  if (issues.length === 0) return;
  const error = new TypeError("resolved integration-test design input is invalid");
  error.code = "CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_INPUT_INVALID";
  error.issue_count = issues.length;
  error.issues = Object.freeze(issues.slice(0, 32));
  throw error;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function values(value) {
  return Array.isArray(value) ? value : [];
}

function safeRelative(relativePath) {
  const normalized = path.posix.normalize(String(relativePath).split(path.sep).join("/"));
  if (path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`repository path escapes root: ${relativePath}`);
  }
  return normalized;
}

function readRepositoryFile(relativePath) {
  const normalized = safeRelative(relativePath);
  const bytes = readFileSync(path.join(REPOSITORY_ROOT, normalized));
  return {
    relative_path: normalized,
    bytes,
    text: bytes.toString("utf8"),
    digest: digest(bytes)
  };
}

function jsonRepositoryFile(relativePath) {
  const file = readRepositoryFile(relativePath);
  return { ...file, value: JSON.parse(file.text) };
}

function exactContractPath(manifest) {
  const members = values(manifest.carriers).filter(({ carrier_kind: kind }) => kind === "contract");
  if (members.length !== 1) {
    throw new Error(`${manifest.wk_id} manifest selects ${members.length} contracts; expected one`);
  }
  return {
    member: members[0],
    relative_path: safeRelative(`wiki/contracts/${members[0].path}`)
  };
}

function duplicateIds(items, key) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of items) {
    const id = item?.[key];
    if (typeof id !== "string") continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
}

function diagnostic({
  code,
  state,
  findingKind,
  message,
  subject = null,
  axis = null,
  missing = [],
  relatedIds = [],
  nextAction
}) {
  return {
    code,
    state,
    finding_kind: findingKind,
    message,
    subject,
    axis,
    missing,
    related_ids: [...new Set(relatedIds)].sort(),
    supported_next_action: nextAction
  };
}

function censusMemberKey(censusId, memberId) {
  return `${censusId}\u0000${memberId}`;
}

function requirementCoverage(input) {
  const result = new Map(values(input.requirements).map(({ requirement_id: id }) => [id, []]));
  for (const obligation of values(input.obligations)) {
    for (const requirementId of values(obligation.source_requirement_ids)) {
      const current = result.get(requirementId);
      if (current) current.push(obligation.obligation_id);
    }
  }
  return result;
}

function scenarioCoreIsSufficient(scenario, testById) {
  const test = testById.get(scenario.test_id);
  return Boolean(
    test &&
    classifyTestPath(test.repository_path) === "integration" &&
    values(scenario.inputs).length > 0 &&
    values(scenario.actions).length > 0 &&
    values(scenario.expected_results).length > 0
  );
}

function criticalProofSpecificationGaps(scenario) {
  const specification = scenario.proof_specification;
  if (!specification || typeof specification !== "object") return ["proof_specification"];
  const gaps = [];
  if (values(specification.public_observations).length === 0) {
    gaps.push("proof_specification.public_observations");
  }
  for (const facet of ["forbidden_side_effects", "follow_up", "falsifiers", "writable_roots"]) {
    const value = specification[facet];
    if (!value || !["closed_set", "required", "not_applicable"].includes(value.mode)) {
      gaps.push(`proof_specification.${facet}`);
      continue;
    }
    if (value.mode === "not_applicable" && !value.rationale) {
      gaps.push(`proof_specification.${facet}.rationale`);
    }
    if (value.mode === "required" && values(value.items).length === 0) {
      gaps.push(`proof_specification.${facet}.items`);
    }
    if (value.mode === "closed_set" && !Array.isArray(value.items)) {
      gaps.push(`proof_specification.${facet}.items`);
    }
  }
  return gaps;
}

function memberCoverage(input, censusById, testById) {
  const obligationById = new Map(values(input.obligations).map((item) => [item.obligation_id, item]));
  const rows = new Map();
  for (const scenario of values(input.integration_scenarios)) {
    if (!scenarioCoreIsSufficient(scenario, testById)) continue;
    const scenarioObligations = values(scenario.obligation_ids)
      .map((id) => obligationById.get(id))
      .filter(Boolean);
    for (const coverage of values(scenario.coverage)) {
      const census = censusById.get(coverage.census_id);
      if (!census || !values(census.members).some(({ member_id: id }) =>
        id === coverage.member_id
      )) continue;
      const evidence = coverage.evidence_design ?? {};
      if ((REQUIRED_EVIDENCE_KEYS[census.axis] ?? []).some((key) =>
        typeof evidence[key] !== "string" || evidence[key].length === 0
      )) continue;
      const key = censusMemberKey(coverage.census_id, coverage.member_id);
      const obligationRequiresMember = scenarioObligations.some((obligation) =>
        values(obligation.required_population_members).some((required) =>
          censusMemberKey(required.census_id, required.member_id) === key
        )
      );
      if (!obligationRequiresMember) continue;
      const current = rows.get(key) ?? [];
      current.push({ scenario, coverage });
      rows.set(key, current);
    }
  }
  return rows;
}

function overallState(diagnostics) {
  if (diagnostics.some(({ state }) => state === "fail")) return "fail";
  if (diagnostics.some(({ state }) => state === "incomplete")) return "incomplete";
  if (diagnostics.some(({ state }) => state === "unevaluable")) return "unevaluable";
  if (diagnostics.some(({ state }) => state === "review_only")) return "review_only";
  return "pass";
}

export function assessIntegrationTestDesign(input) {
  assertResolvedInput(input);
  input = normalizeResolvedInput(input);
  const diagnostics = [];
  const requirements = values(input.requirements);
  const obligations = values(input.obligations);
  const censuses = values(input.population_censuses);
  const tests = values(input.declared_integration_tests);
  const scenarios = values(input.integration_scenarios);
  const interactions = values(input.interaction_requirements);
  const applicability = values(input.axis_applicability);

  if (input.subject?.obligation_source_current !== true) diagnostics.push(diagnostic({
    code: "PAA-CANONICAL-OBLIGATION-SOURCE-NONCURRENT.v1",
    state: "incomplete",
    findingKind: "absence",
    message: "The canonical obligation source is absent, stale, or non-current.",
    subject: { kind: "canonical_source", id: "obligation-coverage" },
    nextAction: "restore a current canonical obligation source before assessing sufficiency"
  }));
  if (input.subject?.acceptance_coverage_current !== true) diagnostics.push(diagnostic({
    code: "PAA-CANONICAL-ACCEPTANCE-COVERAGE-NONCURRENT.v1",
    state: "incomplete",
    findingKind: "absence",
    message: "The canonical acceptance mapping is absent, stale, or incomplete.",
    subject: { kind: "canonical_source", id: "acceptance-coverage" },
    nextAction: "restore current complete acceptance mappings before assessing sufficiency"
  }));

  const collections = [
    [requirements, "requirement_id", "requirement"],
    [obligations, "obligation_id", "obligation"],
    [censuses, "census_id", "population census"],
    [tests, "test_id", "declared integration test"],
    [scenarios, "scenario_id", "integration scenario"],
    [interactions, "interaction_id", "interaction requirement"]
  ];
  for (const [items, key, label] of collections) {
    for (const id of duplicateIds(items, key)) diagnostics.push(diagnostic({
      code: "PAA-DUPLICATE-IDENTITY.v1",
      state: "fail",
      findingKind: "contradiction",
      message: `Duplicate ${label} identity prevents an exact join.`,
      subject: { kind: label.replaceAll(" ", "_"), id },
      nextAction: `assign one unique ${key} to each ${label}`
    }));
  }

  const requirementById = new Map(requirements.map((item) => [item.requirement_id, item]));
  const obligationById = new Map(obligations.map((item) => [item.obligation_id, item]));
  const censusById = new Map(censuses.map((item) => [item.census_id, item]));
  const testById = new Map(tests.map((item) => [item.test_id, item]));
  const applicabilityByAxis = new Map(applicability.map((item) => [item.axis, item]));
  const censusIsApplicableComplete = (census) => {
    const declaration = applicabilityByAxis.get(census.axis);
    return declaration?.status === "required" &&
      declaration.census_id === census.census_id &&
      census.completeness === "complete" &&
      census.currentness === "current" &&
      census.member_count === values(census.members).length &&
      COMPLETE_SOURCE_KINDS.has(census.source_kind);
  };

  for (const axis of AXES) {
    const declaration = applicabilityByAxis.get(axis);
    if (!declaration || declaration.status === "undetermined") diagnostics.push(diagnostic({
      code: "PAA-AXIS-APPLICABILITY-UNDECLARED.v1",
      state: "incomplete",
      findingKind: "absence",
      message: "The design does not decide whether this adequacy axis applies.",
      subject: { kind: "axis", id: axis },
      axis,
      nextAction: "declare the axis required, not_applicable with rationale, or review_only"
    }));
    else if (declaration.status === "unevaluable") diagnostics.push(diagnostic({
      code: "PAA-AXIS-UNEVALUABLE.v1",
      state: "unevaluable",
      findingKind: "unsupported",
      message: declaration.rationale ?? "No supported design-time census can evaluate this axis.",
      subject: { kind: "axis", id: axis },
      axis,
      nextAction: "add a supported census provider or retain this explicit limitation"
    }));
    else if (declaration.status === "review_only") diagnostics.push(diagnostic({
      code: "PAA-AXIS-APPLICABILITY-REQUIRES-REVIEW.v1",
      state: "review_only",
      findingKind: "semantic_residue",
      message: declaration.rationale ?? "Axis applicability requires operator judgment.",
      subject: { kind: "axis", id: axis },
      axis,
      nextAction: "resolve applicability or retain the explicit review-only residue"
    }));
    else if (declaration.status === "required" && !censusById.has(declaration.census_id)) {
      diagnostics.push(diagnostic({
        code: "PAA-REQUIRED-AXIS-CENSUS-ABSENT.v1",
        state: "incomplete",
        findingKind: "absence",
        message: "A required axis has no joined population census.",
        subject: { kind: "axis", id: axis },
        axis,
        missing: ["census_id"],
        nextAction: "obtain the axis census from its independent design-time owner"
      }));
    }
  }

  const bindingCompleteness = input.declaration_completeness ?? {};
  const requirementMap = requirementCoverage(input);
  for (const requirement of requirements) {
    const coveredBy = requirementMap.get(requirement.requirement_id) ?? [];
    if (coveredBy.length === 0) diagnostics.push(diagnostic({
      code: bindingCompleteness.requirement_obligation_bindings === "unavailable"
        ? "PAA-REQUIREMENT-OBLIGATION-JOIN-UNAVAILABLE.v1"
        : "PAA-REQUIREMENT-WITHOUT-OBLIGATION.v1",
      state: bindingCompleteness.requirement_obligation_bindings === "unavailable"
        ? "incomplete"
        : "fail",
      findingKind: bindingCompleteness.requirement_obligation_bindings === "unavailable"
        ? "absence"
        : "omission",
      message: bindingCompleteness.requirement_obligation_bindings === "unavailable"
        ? "The current carrier cannot express an exact acceptance-requirement to obligation join."
        : "A canonical acceptance requirement has no declared proof obligation.",
      subject: { kind: "requirement", id: requirement.requirement_id },
      relatedIds: [requirement.source_pointer].filter(Boolean),
      nextAction: "add an obligation with an exact source_requirement_id, or remove/change the requirement canonically"
    }));
  }

  for (const obligation of obligations) {
    if (values(obligation.source_requirement_ids).length === 0) diagnostics.push(diagnostic({
      code: "PAA-OBLIGATION-SOURCE-BINDING-ABSENT.v1",
      state: "incomplete",
      findingKind: "absence",
      message: "The obligation is not joined to an exact canonical requirement identity.",
      subject: { kind: "obligation", id: obligation.obligation_id },
      nextAction: "bind the obligation to one or more canonical requirement pointers"
    }));
    for (const requirementId of values(obligation.source_requirement_ids)) {
      if (!requirementById.has(requirementId)) diagnostics.push(diagnostic({
        code: "PAA-OBLIGATION-REFERENCES-UNKNOWN-REQUIREMENT.v1",
        state: "fail",
        findingKind: "contradiction",
        message: "The obligation references a requirement outside the selected requirement census.",
        subject: { kind: "obligation", id: obligation.obligation_id },
        relatedIds: [requirementId],
        nextAction: "correct the binding or select the matching canonical requirement snapshot"
      }));
    }
    if (values(obligation.verification_claim_ids).length === 0) diagnostics.push(diagnostic({
      code: "PAA-OBLIGATION-WITHOUT-VERIFICATION-CLAIM.v1",
      state: "fail",
      findingKind: "omission",
      message: "The obligation has no declared verification claim.",
      subject: { kind: "obligation", id: obligation.obligation_id },
      nextAction: "declare the verification claim that would falsify this obligation"
    }));
    if (!obligation.proof_rigor || obligation.proof_rigor === "unspecified") {
      diagnostics.push(diagnostic({
        code: "PAA-PROOF-RIGOR-UNDECLARED.v1",
        state: "incomplete",
        findingKind: "absence",
        message: "The design does not decide whether this obligation needs a standard or critical-semantic integration specification.",
        subject: { kind: "obligation", id: obligation.obligation_id },
        nextAction: "declare proof_rigor as standard or critical_semantic"
      }));
    }
    if (obligation.integration_required !== true && obligation.integration_required !== false) {
      diagnostics.push(diagnostic({
        code: "PAA-INTEGRATION-APPLICABILITY-UNDECLARED.v1",
        state: "incomplete",
        findingKind: "absence",
        message: "The obligation does not decide whether integration proof is required.",
        subject: { kind: "obligation", id: obligation.obligation_id },
        nextAction: "declare integration_required as true or false with the contract design"
      }));
    }
    for (const required of values(obligation.required_population_members)) {
      const census = censusById.get(required.census_id);
      const memberExists = census && values(census.members)
        .some(({ member_id: id }) => id === required.member_id);
      if (!memberExists) diagnostics.push(diagnostic({
        code: "PAA-OBLIGATION-REFERENCES-UNKNOWN-POPULATION-MEMBER.v1",
        state: "fail",
        findingKind: "contradiction",
        message: "The obligation references a member absent from the selected census snapshot.",
        subject: { kind: "obligation", id: obligation.obligation_id },
        axis: census?.axis ?? null,
        relatedIds: [required.census_id, required.member_id],
        nextAction: "correct the member identity or refresh the independently owned census"
      }));
    }
  }

  for (const census of censuses) {
    const axisDeclaration = applicabilityByAxis.get(census.axis);
    if (!AXES.includes(census.axis)) diagnostics.push(diagnostic({
      code: "PAA-UNKNOWN-AXIS.v1",
      state: "fail",
      findingKind: "contradiction",
      message: "The population census uses an unsupported adequacy axis.",
      subject: { kind: "census", id: census.census_id },
      nextAction: "use one of the ten supported axes"
    }));
    if (census.completeness !== "complete" || census.currentness !== "current" ||
        census.member_count !== values(census.members).length ||
        !COMPLETE_SOURCE_KINDS.has(census.source_kind)) {
      diagnostics.push(diagnostic({
        code: "PAA-CENSUS-COMPLETENESS-UNSUPPORTED.v1",
        state: "incomplete",
        findingKind: "absence",
        message: "This census cannot establish a complete denominator for mechanical sufficiency.",
        subject: { kind: "census", id: census.census_id },
        axis: census.axis,
        relatedIds: [
          census.source_kind, census.completeness, census.currentness,
          `declared-count:${census.member_count}`,
          `observed-count:${values(census.members).length}`,
          ...values(census.omissions)
        ].filter(Boolean),
        nextAction: "use a complete server-, registry-, schema-, or canonical-closed-set census"
      }));
    }
    if (!census.owner_id || !census.generation_id || !census.content_digest) diagnostics.push(diagnostic({
      code: "PAA-CENSUS-IDENTITY-INCOMPLETE.v1",
      state: "incomplete",
      findingKind: "absence",
      message: "The census lacks owner, generation, or content identity needed for a reproducible join.",
      subject: { kind: "census", id: census.census_id },
      axis: census.axis,
      missing: [
        ...(!census.owner_id ? ["owner_id"] : []),
        ...(!census.generation_id ? ["generation_id"] : []),
        ...(!census.content_digest ? ["content_digest"] : [])
      ],
      nextAction: "bind the exact census owner, generation, and digest"
    }));
    if (axisDeclaration?.status === "not_applicable") diagnostics.push(diagnostic({
      code: "PAA-CENSUS-CONTRADICTS-NOT-APPLICABLE-AXIS.v1",
      state: "fail",
      findingKind: "contradiction",
      message: "A declared population contradicts the assertion that its axis is not applicable.",
      subject: { kind: "census", id: census.census_id },
      axis: census.axis,
      nextAction: "correct the axis applicability or remove the unrelated census from this assessment"
    }));
    const requiredBy = new Map(values(census.members).map(({ member_id: id }) => [id, []]));
    for (const obligation of obligations) {
      for (const member of values(obligation.required_population_members)) {
        if (member.census_id !== census.census_id || !requiredBy.has(member.member_id)) continue;
        requiredBy.get(member.member_id).push(obligation.obligation_id);
      }
    }
    for (const [memberId, obligationIds] of requiredBy) {
      if (obligationIds.length === 0) diagnostics.push(diagnostic({
        code: "PAA-CENSUS-MEMBER-WITHOUT-OBLIGATION.v1",
        state: "fail",
        findingKind: "omission",
        message: "A member of a complete required population has no proof obligation.",
        subject: { kind: "population_member", id: memberId },
        axis: census.axis,
        relatedIds: [census.census_id],
        nextAction: "add an obligation for this member or change the owning census"
      }));
    }
  }

  const scenariosByObligation = new Map(obligations.map(({ obligation_id: id }) => [id, []]));
  for (const scenario of scenarios) {
    const test = testById.get(scenario.test_id);
    if (!test) diagnostics.push(diagnostic({
      code: "PAA-SCENARIO-TEST-BINDING-ABSENT.v1",
      state: bindingCompleteness.integration_scenario_bindings === "partial"
        ? "incomplete"
        : "fail",
      findingKind: bindingCompleteness.integration_scenario_bindings === "partial"
        ? "absence"
        : "contradiction",
      message: bindingCompleteness.integration_scenario_bindings === "partial"
        ? "The current carrier does not bind this proof scenario to one exact integration-test path."
        : "The scenario does not identify a declared integration test.",
      subject: { kind: "scenario", id: scenario.scenario_id },
      relatedIds: [scenario.test_id].filter(Boolean),
      nextAction: "bind the scenario to one declared integration test identity"
    }));
    else if (classifyTestPath(test.repository_path) !== "integration") diagnostics.push(diagnostic({
      code: "PAA-DECLARED-TEST-NOT-INTEGRATION-CLASSIFIED.v1",
      state: "fail",
      findingKind: "contradiction",
      message: "The scenario is credited as integration proof, but the repository classifier does not classify its declared path as integration.",
      subject: { kind: "test", id: test.test_id },
      relatedIds: [test.repository_path],
      nextAction: "declare an integration-classified path or stop crediting the scenario as integration proof"
    }));
    for (const obligationId of values(scenario.obligation_ids)) {
      if (!obligationById.has(obligationId)) diagnostics.push(diagnostic({
        code: "PAA-SCENARIO-REFERENCES-UNKNOWN-OBLIGATION.v1",
        state: "fail",
        findingKind: "contradiction",
        message: "The scenario references an unknown obligation.",
        subject: { kind: "scenario", id: scenario.scenario_id },
        relatedIds: [obligationId],
        nextAction: "correct the obligation identity"
      }));
      else scenariosByObligation.get(obligationId).push(scenario.scenario_id);
    }
    const missingCore = [
      ...(values(scenario.inputs).length === 0 ? ["inputs"] : []),
      ...(values(scenario.actions).length === 0 ? ["actions"] : []),
      ...(values(scenario.expected_results).length === 0 ? ["expected_results"] : [])
    ];
    if (missingCore.length > 0) diagnostics.push(diagnostic({
      code: "PAA-INTEGRATION-SCENARIO-UNDERSPECIFIED.v1",
      state: "incomplete",
      findingKind: "absence",
      message: "The integration scenario lacks a concrete input, action, or expected result.",
      subject: { kind: "scenario", id: scenario.scenario_id },
      missing: missingCore,
      nextAction: "declare the scenario's concrete inputs, public action sequence, and expected result"
    }));
    for (const coverage of values(scenario.coverage)) {
      const census = censusById.get(coverage.census_id);
      const member = census && values(census.members)
        .find(({ member_id: id }) => id === coverage.member_id);
      if (!member) {
        diagnostics.push(diagnostic({
          code: "PAA-SCENARIO-COVERS-UNKNOWN-POPULATION-MEMBER.v1",
          state: "fail",
          findingKind: "contradiction",
          message: "The scenario claims coverage for a member absent from the selected census.",
          subject: { kind: "scenario", id: scenario.scenario_id },
          axis: census?.axis ?? null,
          relatedIds: [coverage.census_id, coverage.member_id],
          nextAction: "correct the coverage identity or refresh the census"
        }));
        continue;
      }
      const evidence = coverage.evidence_design ?? {};
      const missingEvidence = (REQUIRED_EVIDENCE_KEYS[census.axis] ?? [])
        .filter((key) => typeof evidence[key] !== "string" || evidence[key].length === 0);
      if (missingEvidence.length > 0) diagnostics.push(diagnostic({
        code: "PAA-AXIS-COVERAGE-DESIGN-UNDERSPECIFIED.v1",
        state: "incomplete",
        findingKind: "absence",
        message: "The scenario names a population member without the axis-specific test design needed to exercise it.",
        subject: { kind: "scenario", id: scenario.scenario_id },
        axis: census.axis,
        missing: missingEvidence,
        relatedIds: [coverage.census_id, coverage.member_id],
        nextAction: "supply the missing axis-specific scenario design fields"
      }));
      if (census.axis === "registered_routes" && missingEvidence.length === 0) {
        const exactAction = values(scenario.actions).some((action) =>
          action.action_id === evidence.action_id &&
          action.boundary_id === evidence.boundary_id
        );
        if (!exactAction || evidence.boundary_id !== member.member_id) diagnostics.push(diagnostic({
          code: "PAA-PUBLIC-BOUNDARY-DESIGN-BYPASSED.v1",
          state: "fail",
          findingKind: "contradiction",
          message: "The scenario credits a registered route but its declared action begins at a different boundary.",
          subject: { kind: "scenario", id: scenario.scenario_id },
          axis: census.axis,
          relatedIds: [member.member_id, evidence.action_id, evidence.boundary_id],
          nextAction: "make the scenario action enter the exact registered route or stop crediting that route"
        }));
      }
      if (census.axis === "selector_partitions" && missingEvidence.length === 0 &&
          !values(scenario.inputs).some(({ input_id: id }) => id === evidence.input_id)) {
        diagnostics.push(diagnostic({
          code: "PAA-SELECTOR-PARTITION-INPUT-ABSENT.v1",
          state: "fail",
          findingKind: "contradiction",
          message: "The scenario credits a selector partition using an input not declared by the scenario.",
          subject: { kind: "scenario", id: scenario.scenario_id },
          axis: census.axis,
          relatedIds: [member.member_id, evidence.input_id],
          nextAction: "declare the exact partition input or stop crediting the partition"
        }));
      }
      if (["failure_phases", "result_schema_population"].includes(census.axis) &&
          missingEvidence.length === 0 &&
          !values(scenario.expected_results).some(({ result_id: id }) =>
            id === evidence.expected_result_id
          )) diagnostics.push(diagnostic({
        code: "PAA-EXPECTED-RESULT-BINDING-ABSENT.v1",
        state: "fail",
        findingKind: "contradiction",
        message: "The population coverage cites an expected result absent from the scenario.",
        subject: { kind: "scenario", id: scenario.scenario_id },
        axis: census.axis,
        relatedIds: [member.member_id, evidence.expected_result_id],
        nextAction: "bind the exact expected result to the scenario"
      }));
      if (census.axis === "persistent_refs_and_state" && member.required_before === "absent" &&
          values(scenario.fixture_effects).some((effect) =>
            effect.state_member_id === member.member_id && effect.effect === "create"
          )) diagnostics.push(diagnostic({
        code: "PAA-FIXTURE-PRECREATES-FORBIDDEN-STATE.v1",
        state: "fail",
        findingKind: "contradiction",
        message: "The declared fixture creates state whose required pre-action state is absent.",
        subject: { kind: "scenario", id: scenario.scenario_id },
        axis: census.axis,
        relatedIds: [member.member_id],
        nextAction: "remove the fixture creation or correct the canonical state invariant"
      }));
      if (census.axis === "authority_producer_consumer_edges" &&
          values(scenario.seams).some((seam) =>
            seam.authority_member_id === member.member_id && seam.mode === "replace_result"
          )) diagnostics.push(diagnostic({
        code: "PAA-AUTHORITY-PRODUCER-SUBSTITUTED-IN-DESIGN.v1",
        state: "fail",
        findingKind: "contradiction",
        message: "The scenario declares a result-producing replacement for an authority edge it claims to integrate.",
        subject: { kind: "scenario", id: scenario.scenario_id },
        axis: census.axis,
        relatedIds: [member.member_id],
        nextAction: "use the production producer; retain only observation, external simulation, or declared fault control"
      }));
    }
  }

  for (const obligation of obligations) {
    const scenarioIds = scenariosByObligation.get(obligation.obligation_id) ?? [];
    if (obligation.integration_required === true && scenarioIds.length === 0) diagnostics.push(diagnostic({
      code: "PAA-INTEGRATION-OBLIGATION-WITHOUT-SCENARIO.v1",
      state: "fail",
      findingKind: "omission",
      message: "An integration-required obligation has no declared integration scenario.",
      subject: { kind: "obligation", id: obligation.obligation_id },
      nextAction: "add a structured integration scenario or justify that the obligation is not integration-required"
    }));
    if (obligation.proof_rigor === "critical_semantic") {
      for (const scenarioId of scenarioIds) {
        const scenario = scenarios.find(({ scenario_id: id }) => id === scenarioId);
        const gaps = criticalProofSpecificationGaps(scenario);
        if (gaps.length === 0) continue;
        diagnostics.push(diagnostic({
          code: "PAA-CRITICAL-PROOF-SPECIFICATION-INCOMPLETE.v1",
          state: "incomplete",
          findingKind: "absence",
          message: "A critical-semantic obligation lacks a complete design-time proof specification.",
          subject: { kind: "scenario", id: scenarioId },
          missing: gaps,
          relatedIds: [obligation.obligation_id],
          nextAction: "declare public observations, forbidden effects, follow-up, falsifiers, and the closed writable-root set"
        }));
      }
    }
  }

  const coveredMembers = memberCoverage(input, censusById, testById);
  for (const census of censuses) {
    if (!censusIsApplicableComplete(census)) continue;
    for (const member of values(census.members)) {
      const key = censusMemberKey(census.census_id, member.member_id);
      if ((coveredMembers.get(key) ?? []).length === 0) diagnostics.push(diagnostic({
        code: bindingCompleteness.integration_scenario_bindings === "partial"
          ? "PAA-POPULATION-SCENARIO-JOIN-UNAVAILABLE.v1"
          : "PAA-REQUIRED-POPULATION-MEMBER-WITHOUT-INTEGRATION-SCENARIO.v1",
        state: bindingCompleteness.integration_scenario_bindings === "partial"
          ? "incomplete"
          : "fail",
        findingKind: bindingCompleteness.integration_scenario_bindings === "partial"
          ? "absence"
          : "omission",
        message: bindingCompleteness.integration_scenario_bindings === "partial"
          ? "The current carrier cannot establish a sufficiently structured integration-scenario join for this population member."
          : "A required complete-population member has no integration scenario joined through an obligation.",
        subject: { kind: "population_member", id: member.member_id },
        axis: census.axis,
        relatedIds: [census.census_id],
        nextAction: "add or extend a scenario with an exact obligation and member binding"
      }));
    }
  }

  for (const interaction of interactions) {
    const requiredKeys = values(interaction.required_population_members)
      .map(({ census_id: censusId, member_id: memberId }) => censusMemberKey(censusId, memberId));
    const candidateScenarios = scenarios.filter((scenario) => {
      const keys = new Set(values(scenario.coverage)
        .map(({ census_id: censusId, member_id: memberId }) => censusMemberKey(censusId, memberId)));
      return requiredKeys.every((key) => keys.has(key));
    });
    if (interaction.coverage_mode === "single_scenario" && candidateScenarios.length === 0) {
      diagnostics.push(diagnostic({
        code: "PAA-INTERACTION-FRAGMENTED-ACROSS-SCENARIOS.v1",
        state: "fail",
        findingKind: "omission",
        message: "The required interaction is not represented within one integration scenario.",
        subject: { kind: "interaction", id: interaction.interaction_id },
        relatedIds: values(interaction.required_population_members)
          .flatMap(({ census_id: censusId, member_id: memberId }) => [censusId, memberId]),
        nextAction: "declare one scenario containing the interacting members and their ordering constraints"
      }));
    }
    if (interaction.coverage_mode !== "single_scenario" && interaction.coverage_mode !== "collective") {
      diagnostics.push(diagnostic({
        code: "PAA-INTERACTION-COVERAGE-MODE-UNSUPPORTED.v1",
        state: "incomplete",
        findingKind: "absence",
        message: "The interaction requirement lacks a supported coverage mode.",
        subject: { kind: "interaction", id: interaction.interaction_id },
        nextAction: "choose single_scenario for a relationship or collective for an independent population"
      }));
    }
  }

  for (const question of values(input.review_questions)) diagnostics.push(diagnostic({
    code: "PAA-DECLARED-REVIEW-ONLY-RESIDUE.v1",
    state: "review_only",
    findingKind: "semantic_residue",
    message: question.question,
    subject: { kind: "review_question", id: question.question_id },
    axis: question.axis ?? null,
    relatedIds: values(question.related_ids),
    nextAction: question.resolution_owner
      ? `obtain a decision from ${question.resolution_owner}`
      : "obtain an explicit design decision"
  }));

  const diagnosticStateRank = Object.freeze({
    fail: 0,
    incomplete: 1,
    unevaluable: 2,
    review_only: 3
  });
  diagnostics.sort((left, right) =>
    diagnosticStateRank[left.state] - diagnosticStateRank[right.state] || rawCompare(
    [left.code, left.axis ?? "", left.subject?.kind ?? "", left.subject?.id ?? "",
      left.related_ids.join("\u0000"), left.missing.join("\u0000")].join("\u0001"),
    [right.code, right.axis ?? "", right.subject?.kind ?? "", right.subject?.id ?? "",
      right.related_ids.join("\u0000"), right.missing.join("\u0000")].join("\u0001")
  ));

  const populationId = ({ census_id: censusId, member_id: memberId }) =>
    `${censusId}#${memberId}`;
  const axisResults = AXES.map((axis) => {
    const declaration = applicabilityByAxis.get(axis) ?? null;
    const axisCensuses = censuses.filter((census) => census.axis === axis);
    const required = axisCensuses.flatMap((census) => values(census.members).map((member) =>
      populationId({ census_id: census.census_id, member_id: member.member_id })
    )).sort(rawCompare);
    const declared = scenarios.flatMap((scenario) => values(scenario.coverage)
      .filter((coverage) => censusById.get(coverage.census_id)?.axis === axis)
      .map(populationId)).filter((id, index, rows) => rows.indexOf(id) === index)
      .sort(rawCompare);
    const matched = axisCensuses.flatMap((census) => values(census.members)
      .filter((member) => (coveredMembers.get(censusMemberKey(
        census.census_id, member.member_id
      )) ?? []).length > 0)
      .map((member) => populationId({
        census_id: census.census_id,
        member_id: member.member_id
      }))).sort(rawCompare);
    const requiredSet = new Set(required);
    const matchedSet = new Set(matched);
    const missing = required.filter((id) => !matchedSet.has(id));
    const extra = declared.filter((id) => !requiredSet.has(id));
    const contradictory = diagnostics.filter((item) =>
      item.axis === axis && item.finding_kind === "contradiction"
    ).map((item) => `${item.code}:${item.subject?.id ?? axis}`).sort(rawCompare);
    const unsupported = [
      ...(declaration?.status === "unevaluable" ? [`axis:${axis}`] : []),
      ...(declaration?.status === "required" && axisCensuses.length === 0
        ? [`provider:${axis}`] : []),
      ...axisCensuses.filter((census) => !censusIsApplicableComplete(census))
        .map((census) => `census:${census.census_id}`)
    ].sort(rawCompare);
    const omitted = diagnostics.filter((item) =>
      item.axis === axis && item.finding_kind === "omission"
    ).map((item) => `${item.code}:${item.subject?.id ?? axis}`).sort(rawCompare);
    const populations = {
      required, declared, matched, missing, extra, contradictory, unsupported, omitted
    };
    return {
      axis,
      applicability: declaration?.status ?? "undetermined",
      census_id: declaration?.census_id ?? null,
      denominator_state: declaration?.status === "not_applicable"
        ? "not_applicable"
        : unsupported.length > 0 ? "unsupported"
          : missing.length > 0 ? "incomplete" : "complete",
      counts: Object.fromEntries(Object.entries(populations).map(([key, rows]) => [key, rows.length])),
      populations
    };
  });

  const interactionToScenarios = interactions.map((interaction) => {
    const requiredKeys = values(interaction.required_population_members)
      .map(({ census_id: censusId, member_id: memberId }) => censusMemberKey(censusId, memberId));
    const scenarioRows = scenarios.map((scenario) => ({
      scenario,
      keys: new Set(values(scenario.coverage).map(
        ({ census_id: censusId, member_id: memberId }) => censusMemberKey(censusId, memberId)
      ))
    }));
    const matching = interaction.coverage_mode === "single_scenario"
      ? scenarioRows.filter(({ keys }) => requiredKeys.every((key) => keys.has(key)))
      : scenarioRows.filter(({ keys }) => requiredKeys.some((key) => keys.has(key)));
    return {
      interaction_id: interaction.interaction_id,
      coverage_mode: interaction.coverage_mode,
      required_population_members: values(interaction.required_population_members)
        .map(populationId).sort(rawCompare),
      scenario_ids: matching.map(({ scenario }) => scenario.scenario_id).sort(rawCompare)
    };
  });

  const state = overallState(diagnostics);
  const countState = (candidate) => diagnostics.filter(({ state: itemState }) =>
    itemState === candidate).length;
  return {
    schema_version: INTEGRATION_TEST_DESIGN_ASSESSMENT_RESULT_SCHEMA_VERSION,
    assessment_kind: "design_time_declared_integration_sufficiency",
    state,
    guarantee: state === "pass"
      ? "Every selected requirement and every member of every applicable complete census is joined through a proof obligation to a sufficiently structured declared integration scenario."
      : "No sufficiency guarantee is issued.",
    non_guarantees: [
      "tests exist or execute",
      "test implementations conform to their declarations",
      "production boundaries are traversed at runtime",
      "tests pass",
      "implementation is correct"
    ],
    subject: input.subject,
    input_digest: digest(Buffer.from(canonicalJson(input))),
    denominators: {
      requirements: requirements.length,
      obligations: obligations.length,
      integration_required_obligations: obligations.filter(
        (obligation) => obligation.integration_required === true
      ).length,
      applicable_complete_census_members: censuses.filter(censusIsApplicableComplete)
        .reduce((total, census) => total + values(census.members).length, 0),
      declared_integration_tests: tests.length,
      integration_scenarios: scenarios.length,
      interaction_requirements: interactions.length,
      review_questions: values(input.review_questions).length,
      adequacy_axes: AXES.length
    },
    coverage: {
      requirements_with_obligations: [...requirementMap.values()].filter((ids) => ids.length > 0).length,
      integration_required_obligations_with_scenarios: obligations.filter((obligation) =>
        obligation.integration_required === true &&
        scenarios.some((scenario) =>
          values(scenario.obligation_ids).includes(obligation.obligation_id) &&
          scenarioCoreIsSufficient(scenario, testById)
        )
      ).length,
      applicable_complete_census_members_with_scenarios: censuses.filter(censusIsApplicableComplete)
        .flatMap((census) => values(census.members).map(({ member_id: memberId }) =>
          censusMemberKey(census.census_id, memberId)
        )).filter((key) => coveredMembers.has(key)).length,
      axes_decided: AXES.filter((axis) => {
        const declaration = applicabilityByAxis.get(axis);
        return declaration && declaration.status !== "undetermined";
      }).length
    },
    axis_results: axisResults,
    lossless_denominators: {
      axis_applicability: applicability.map((item) => ({
        axis: item.axis,
        status: item.status,
        census_id: item.census_id ?? null,
        rationale: item.rationale
      })),
      requirements: requirements.map((item) => ({
        requirement_id: item.requirement_id,
        source_pointer: item.source_pointer,
        text_digest: item.text_digest
      })),
      obligations: obligations.map((item) => ({
        obligation_id: item.obligation_id,
        integration_required: item.integration_required,
        proof_rigor: item.proof_rigor
      })),
      population_censuses: censuses.map((census) => ({
        census_id: census.census_id,
        axis: census.axis,
        source_kind: census.source_kind,
        provider_id: census.provider_id,
        owner_id: census.owner_id,
        generation_id: census.generation_id,
        content_digest: census.content_digest,
        completeness: census.completeness,
        currentness: census.currentness,
        omissions: values(census.omissions),
        member_count: values(census.members).length
      })),
      population_members: censuses.flatMap((census) => values(census.members).map((member) => ({
        census_id: census.census_id,
        axis: census.axis,
        source_kind: census.source_kind,
        provider_id: census.provider_id,
        owner_id: census.owner_id,
        generation_id: census.generation_id,
        content_digest: census.content_digest,
        completeness: census.completeness,
        currentness: census.currentness,
        member_id: member.member_id
      }))),
      declared_integration_tests: tests.map((item) => ({
        test_id: item.test_id,
        repository_path: item.repository_path
      })),
      integration_scenario_ids: scenarios.map(({ scenario_id: id }) => id),
      interaction_requirement_ids: interactions.map(({ interaction_id: id }) => id),
      review_question_ids: values(input.review_questions).map(({ question_id: id }) => id)
    },
    lossless_joins: {
      requirement_to_obligations: requirements.map((requirement) => ({
        requirement_id: requirement.requirement_id,
        obligation_ids: values(requirementMap.get(requirement.requirement_id)).sort()
      })),
      population_member_to_obligations: censuses.flatMap((census) =>
        values(census.members).map((member) => ({
          census_id: census.census_id,
          member_id: member.member_id,
          obligation_ids: obligations.filter((obligation) =>
            values(obligation.required_population_members).some((required) =>
              required.census_id === census.census_id &&
              required.member_id === member.member_id
            )
          ).map(({ obligation_id: id }) => id).sort()
        }))
      ),
      obligation_to_scenarios: obligations.map((obligation) => ({
        obligation_id: obligation.obligation_id,
        scenario_ids: values(scenariosByObligation.get(obligation.obligation_id)).sort()
      })),
      population_member_to_sufficient_scenarios: censuses.flatMap((census) =>
        values(census.members).map((member) => ({
          census_id: census.census_id,
          member_id: member.member_id,
          scenario_ids: values(coveredMembers.get(censusMemberKey(
            census.census_id, member.member_id
          ))).map(({ scenario }) => scenario.scenario_id).sort()
        }))
      ),
      interaction_to_scenarios: interactionToScenarios
    },
    diagnostic_summary: {
      fail: countState("fail"),
      incomplete: countState("incomplete"),
      unevaluable: countState("unevaluable"),
      review_only: countState("review_only")
    },
    diagnostics
  };
}
