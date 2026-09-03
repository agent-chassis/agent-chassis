import {
  executeMutationPaginationProjection,
  projectMutationPaginationPopulation
} from "./mutation-pagination-trace-v1-test-runner.mjs";
import {
  snapshotTraceFixture,
  versionedCursorTraceFixture
} from "./mutation-pagination-trace-v1-fixture.mjs";

const projectionRoles = Object.freeze(new Set(
  "traversal live_source snapshot snapshot_state page_attempts returned_pages member_occurrences stable_member_occurrences mutations initial_source_version later_source_version first_page_attempt later_page_attempt first_returned_page later_returned_page relevant_mutation page_attempt_population returned_page_population member_occurrence_population stable_member_occurrence_population mutation_population control_traversal control_source unrelated_source traversal_source_version current_source_version control_source_version primary_cursors control_cursors stale_cursor control_cursor primary_returned_pages control_returned_pages returns advancements effect_occurrences protected_effects prior_page_attempt stale_attempt control_attempt unrelated_mutation refusal page_result_artifact page_return_event cursor_advance_event cursor_state traversal_state control_return control_advancement control_returned_page primary_cursor_population control_cursor_population primary_returned_page_population control_returned_page_population return_population advancement_population effect_occurrence_population protected_effect_population".split(" ")
));
const exactArtifactRoles = Object.freeze({
  mutation_trace: "ref-a-trace", primary_before_capture: "ref-b-primary-before",
  primary_after_capture: "ref-c-primary-after",
  control_before_capture: "ref-d-control-before",
  control_after_capture: "ref-e-control-after", projection_result: "ref-f-projection"
});

const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

function roleIds(input) {
  return Object.fromEntries(input.reference_bindings.map(
    ({ role, reference_ids: ids }) => [role, [...ids]]
  ));
}

function generatedInput(profile, traceFixture) {
  const result = executeMutationPaginationProjection(traceFixture.sources);
  const extras = {
    sequence_comparison_result: "ref-sequence-comparison-result",
    identical_sequence_state: "ref-identical-sequence-state",
    verification: traceFixture.trace.policy === "snapshot"
      ? "ref-snapshot-pagination-verification" : "ref-versioned-cursor-verification",
    sequence_failure_condition: "ref-sequence-failure-condition",
    return_failure_condition: "ref-return-failure-condition",
    emission_failure_condition: "ref-emission-failure-condition",
    advancement_failure_condition: "ref-advancement-failure-condition",
    write_failure_condition: "ref-write-failure-condition",
    mutation_failure_condition: "ref-mutation-failure-condition",
    false_refusal_condition: "ref-false-refusal-condition"
  };
  return {
    input_version: "controlled-contract-verification-profile-input.v1",
    evaluation_stage: "pre_dispatch",
    reference_bindings: profile.reference_roles.map(({ role }) => ({
      role,
      reference_ids: projectionRoles.has(role)
        ? projectMutationPaginationPopulation(result, role)
        : [exactArtifactRoles[role] ?? extras[role]]
    })),
    number_bindings: [], claim_pattern_bindings: [], resolver_facts: [],
    delivered_evidence: [], stable_evaluation: {}
  };
}

function resolveTemplate(template, roles, override = {}) {
  const ids = { ...roles, ...override };
  return {
    subject_reference_id: ids[template.subject_role][0],
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.flatMap(
        (role) => ids[role]
      )
    },
    operands: template.operands.flatMap(({ role }) => ids[role].map(ref))
  };
}

function addClaim(contract, id, proposition, {
  kind = "evidence", modality = "MUST", method, falsifier
} = {}) {
  const propositionId = `prop-${id}`;
  contract.propositions.push({ proposition_id: propositionId, ...proposition });
  if (falsifier) contract.propositions.push({
    proposition_id: `prop-falsifier-${id}`, ...falsifier
  });
  contract.claims.push({
    claim_id: `claim-${id}`, kind, modality, proposition_id: propositionId,
    ...(method ? { verification_method: method } : {}),
    ...(falsifier ? { falsifying_proposition_id: `prop-falsifier-${id}` } : {})
  });
}

function addCompletePopulation(contract, populationId, memberIds, id) {
  if (memberIds.length > 0) addClaim(contract, `${id}-members`, {
    subject_reference_id: populationId,
    operator: "reference:contains",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: memberIds.map(ref)
  });
  addClaim(contract, `${id}-count`, {
    subject_reference_id: populationId,
    operator: "number:has_cardinality",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [{ kind: "number", value: memberIds.length }]
  });
}

function buildFixture({
  profile,
  input: inputTemplate,
  trace,
  verification_method: verificationMethod = "test_execution",
  identity_domain: identityDomain = "mutation-pagination",
  mutate_contract: mutateContract,
  mutate_input: mutateInput
}) {
  const input = structuredClone(inputTemplate);
  const roles = roleIds(input);
  const typeByReference = new Map();
  for (const declaration of profile.reference_roles) {
    for (const referenceId of roles[declaration.role]) {
      const existing = typeByReference.get(referenceId);
      const candidates = declaration.allowed_type_terms;
      typeByReference.set(referenceId,
        existing && candidates.includes(existing) ? existing : candidates[0]);
    }
  }
  const contract = {
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    references: [...typeByReference].map(([reference_id, type_term]) => ({
      reference_id, type_term,
      identity: { kind: "durable_id", domain: identityDomain, value: reference_id }
    })),
    propositions: [], claims: [], relations: [], collections: [], residue: [], annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: []
  };
  for (const binding of profile.reference_binding_patterns) {
    addCompletePopulation(
      contract, roles[binding.roles[0]][0], roles[binding.roles[1]], binding.pattern_id
    );
  }
  const claimIds = new Map();
  for (const pattern of profile.claim_patterns) {
    if (pattern.for_each) {
      roles[pattern.for_each.population_role].forEach((referenceId, index) => {
        const id = `${pattern.pattern_id}-${String(index + 1).padStart(3, "0")}`;
        addClaim(contract, id, resolveTemplate(pattern.proposition_template, roles, {
          [pattern.for_each.member_role]: [referenceId]
        }), { kind: pattern.claim_kind, modality: pattern.allowed_modalities[0] });
      });
      continue;
    }
    const options = { kind: pattern.claim_kind, modality: pattern.allowed_modalities[0] };
    if (pattern.claim_kind === "verification") {
      options.method = verificationMethod;
      options.falsifier = resolveTemplate(pattern.falsifying_proposition_template, roles);
    }
    addClaim(contract, pattern.pattern_id,
      resolveTemplate(pattern.proposition_template, roles), options);
    claimIds.set(pattern.pattern_id, `claim-${pattern.pattern_id}`);
  }
  for (const pattern of profile.relation_patterns) contract.relations.push({
    relation_id: `rel-${pattern.pattern_id}`, role: pattern.role,
    source_claim_id: claimIds.get(pattern.source_claim_pattern_id),
    target_claim_id: claimIds.get(pattern.target_claim_pattern_id)
  });
  mutateContract?.(contract, input, roles, trace);
  mutateInput?.(input, contract, roles, trace);
  return { contract, input, profile: structuredClone(profile), roles, trace };
}

function buildSnapshotPaginationFixture(options = {}) {
  const trace = options.trace_fixture ?? snapshotTraceFixture(options.trace_options);
  if (!options.profile) throw new TypeError("snapshot fixture requires an explicit profile");
  return buildFixture({
    profile: options.profile,
    input: options.input ?? generatedInput(options.profile, trace),
    trace,
    verification_method: options.verification_method,
    identity_domain: options.identity_domain,
    mutate_contract: options.mutate_contract,
    mutate_input: options.mutate_input
  });
}

function buildVersionedCursorPaginationFixture(options = {}) {
  const trace = options.trace_fixture ?? versionedCursorTraceFixture(options.trace_options);
  if (!options.profile) throw new TypeError("versioned fixture requires an explicit profile");
  return buildFixture({
    profile: options.profile,
    input: options.input ?? generatedInput(options.profile, trace),
    trace,
    verification_method: options.verification_method,
    identity_domain: options.identity_domain,
    mutate_contract: options.mutate_contract,
    mutate_input: options.mutate_input
  });
}

export {
  buildSnapshotPaginationFixture,
  buildVersionedCursorPaginationFixture
};
