import {
  executeDeterministicProjection,
  projectDeterministicPopulation
} from "../../lib/deterministic-projection.mjs";
import {
  canonicalJsonBytes,
  sha256
} from "../../lib/deterministic-projection-primitives.mjs";
import {
  COMPLETE_TRAVERSAL_RESOURCE_LIMITS,
  MUTATION_PAGINATION_TRACE_VERSION,
  completeTraversalOccurrenceId
} from
  "../../lib/mutation-pagination-trace-projection.mjs";
import { buildAuthenticationProvenanceSources } from
  "./authentication-provenance-v1-fixture.mjs";

const completeEqualityPolicy = Object.freeze({
  schema_version: "controlled-contract.pagination-equality-policy.v1",
  normalization_owner: "equality-normalization-v034.mjs",
  equivalence: "exact-equality-key"
});

const completeResourcePolicy = Object.freeze({
  schema_version: "controlled-contract.pagination-resource-policy.v1",
  accounting_owner: "mutation-pagination-trace-projection.mjs",
  aggregate_input_bytes_limit: 67108864,
  canonical_result_bytes_limit: 67108864,
  work_formula: "authoritative_occurrences+returned_occurrences+pages+transitions",
  work_units_limit: 1000000
});

function cursorDigest(value) {
  return value === null ? null : sha256(Buffer.from(value, "utf8"));
}

function rebuildCompleteSources(fixture, { reauthenticate = false } = {}) {
  if (reauthenticate) fixture.authentication = buildAuthenticationProvenanceSources({
    evidenceContentBytes: canonicalJsonBytes(fixture.population, { file: true }),
    targetSuffix: "complete-pagination",
    sourceSuffix: "complete-pagination",
    occurrenceSuffix: "complete-pagination"
  });
  const values = [
    fixture.trace, fixture.population,
    JSON.parse(fixture.authentication.resultBytes.toString("utf8")),
    fixture.equalityPolicy, fixture.resourcePolicy
  ];
  const bytes = values.map((value) => canonicalJsonBytes(value, { file: true }));
  fixture.trace.authentication_target_grounded_identity_sha256 =
    JSON.parse(fixture.authentication.resultBytes).roles.target.grounded_identity_sha256;
  fixture.trace.source_bindings = {
    authoritative_population_sha256: sha256(bytes[1]),
    authentication_capture_sha256: sha256(bytes[2]),
    equality_policy_sha256: sha256(bytes[3]),
    resource_policy_sha256: sha256(bytes[4])
  };
  bytes[0] = canonicalJsonBytes(fixture.trace, { file: true });
  fixture.sources = bytes;
  return fixture;
}

function completeTraversalTraceFixture({
  member_ids: memberIds = ["member-alpha", "member-beta", "member-gamma",
    "member-delta", "member-epsilon"],
  page_sizes: pageSizes = [2, 2, 1],
  snapshot_id: snapshotId = "snapshot-complete",
  version_id: versionId = "source-version-complete",
  reference_prefix: referencePrefix = "ref-result"
} = {}) {
  const provisional = buildAuthenticationProvenanceSources({
    evidenceContentBytes: canonicalJsonBytes({ provisional: true }, { file: true }),
    targetSuffix: "complete-pagination",
    sourceSuffix: "complete-pagination",
    occurrenceSuffix: "complete-pagination"
  });
  const sourceIdentity = JSON.parse(provisional.resultBytes)
    .roles.source.grounded_identity_sha256;
  const population = {
    schema_version: "controlled-contract.authoritative-ordered-occurrence-population.v1",
    source_grounded_identity_sha256: sourceIdentity,
    occurrences: memberIds.map((memberId) => ({
      source_occurrence_id: memberId,
      equality_key: `equality-${memberId}`,
      content_sha256: sha256(Buffer.from(`content:${memberId}`, "utf8"))
    }))
  };
  const authentication = buildAuthenticationProvenanceSources({
    evidenceContentBytes: canonicalJsonBytes(population, { file: true }),
    targetSuffix: "complete-pagination",
    sourceSuffix: "complete-pagination",
    occurrenceSuffix: "complete-pagination"
  });
  const authoritative = population.occurrences.map((member, index) => ({
    occurrence_id: completeTraversalOccurrenceId(
      population.source_grounded_identity_sha256, member.source_occurrence_id
    ),
    source_occurrence_id: member.source_occurrence_id,
    reference_id: `${referencePrefix}-${index}`,
    equality_key: member.equality_key,
    content_sha256: member.content_sha256
  }));
  if (pageSizes.reduce((sum, value) => sum + value, 0) !== authoritative.length ||
      pageSizes.length === 0 || pageSizes.some((value) =>
        !Number.isSafeInteger(value) || value < 0)) throw new TypeError(
    "complete traversal fixture page sizes must partition every member"
  );
  let offset = 0;
  const pages = pageSizes.map((size, index) => {
    const requestCursor = index === 0 ? null : `opaque-cursor-${index}`;
    const nextCursor = index === pageSizes.length - 1
      ? null : `opaque-cursor-${index + 1}`;
    const page = {
      page_id: `page-${index}`,
      request_cursor: requestCursor,
      request_cursor_sha256: cursorDigest(requestCursor),
      next_cursor: nextCursor,
      next_cursor_sha256: cursorDigest(nextCursor),
      snapshot_id: snapshotId,
      version_id: versionId,
      terminal: index === pageSizes.length - 1,
      member_occurrences: authoritative.slice(offset, offset + size)
    };
    offset += size;
    return page;
  });
  const transitions = pages.slice(0, -1).map((page, index) => ({
    transition_id: `transition-${index}`,
    from_page_id: page.page_id,
    to_page_id: pages[index + 1].page_id,
    cursor_sha256: page.next_cursor_sha256
  }));
  const fixture = {
    population,
    authentication,
    equalityPolicy: structuredClone(completeEqualityPolicy),
    resourcePolicy: structuredClone(completeResourcePolicy),
    trace: {
      schema_version: MUTATION_PAGINATION_TRACE_VERSION,
      policy: "complete_traversal",
      traversal_id: "traversal-complete",
      canonical_initial_state: true,
      snapshot_id: snapshotId,
      version_id: versionId,
      pages,
      transitions,
      terminal_page_id: pages.at(-1).page_id,
      authentication_target_grounded_identity_sha256: "0".repeat(64),
      source_bindings: {
        authoritative_population_sha256: "0".repeat(64),
        authentication_capture_sha256: "0".repeat(64),
        equality_policy_sha256: "0".repeat(64),
        resource_policy_sha256: "0".repeat(64)
      }
    },
    sources: []
  };
  return rebuildCompleteSources(fixture);
}

const CANONICAL_RESULT_SINGLETON_BYTES = 2517;

function completeTraversalResourceFixture(resource) {
  const limit = COMPLETE_TRAVERSAL_RESOURCE_LIMITS[resource];
  if (!Number.isSafeInteger(limit)) throw new TypeError(
    `unknown complete traversal resource: ${resource}`
  );
  if (resource === "work_units") {
    const memberCount = limit / 2;
    const fixture = completeTraversalTraceFixture({
      member_ids: Array.from(
        { length: memberCount }, (_, index) => `member-${index}`
      ),
      page_sizes: [memberCount],
      reference_prefix: "ref-r"
    });
    return { fixture, expected_measure: limit + 1 };
  }

  const fixture = completeTraversalTraceFixture({
    member_ids: ["member-alpha"], page_sizes: [1]
  });
  if (resource === "aggregate_input_bytes") {
    const measured = fixture.sources.reduce((total, bytes) => total + bytes.byteLength, 0);
    fixture.trace.pages[0].member_occurrences[0].reference_id +=
      "r".repeat(limit + 1 - measured);
  } else if (resource === "canonical_result_bytes") {
    fixture.trace.traversal_id +=
      "x".repeat(limit + 1 - CANONICAL_RESULT_SINGLETON_BYTES);
  }
  rebuildCompleteSources(fixture);
  return { fixture, expected_measure: limit + 1 };
}

const transformerId = "mutation-pagination-trace.v1";
const durableIdentity = (value) => ({
  kind: "durable_id", domain: "complete-pagination-traversal", value
});
const context = (mode, ...operandReferenceIds) => ({
  mode, operand_reference_ids: operandReferenceIds
});
const refOperand = (reference_id) => ({ kind: "reference", reference_id });

function roleType(profile, role) {
  return profile.reference_roles.find(({ role: candidate }) => candidate === role)
    .allowed_type_terms[0];
}

function expandContext(template, roles, local = {}) {
  return context(template.mode, ...template.operand_roles.flatMap(
    (role) => local[role] ?? roles[role]
  ));
}

function buildCompletePaginationProfileFixture({
  profile,
  trace_options: traceOptions = {},
  mutate_contract: mutateContract = null,
  mutate_input: mutateInput = null
} = {}) {
  if (!profile) throw new TypeError("complete traversal profile is required");
  const traceFixture = completeTraversalTraceFixture(traceOptions);
  const projectionBytes = executeDeterministicProjection(transformerId,
    traceFixture.sources);
  const projection = JSON.parse(projectionBytes);
  const projected = (name) => projectDeterministicPopulation(
    transformerId, projectionBytes, name
  );
  const auth = traceFixture.authentication.roles;
  const roles = {
    mutation_trace: ["ref-complete-mutation-trace"],
    projection_result: ["ref-complete-projection-result"],
    authoritative_population: ["ref-authoritative-population-artifact"],
    authoritative_occurrence_population: projected("authoritative_occurrence_population"),
    authoritative_occurrences: projected("authoritative_occurrences"),
    returned_occurrence_population: projected("returned_occurrence_population"),
    returned_occurrences: projected("returned_occurrences"),
    returned_page_population: projected("returned_page_population"),
    returned_pages: projected("returned_pages"),
    cursor_transition_population: projected("cursor_transition_population"),
    cursor_transitions: projected("cursor_transitions"),
    equality_normalized_member_population: projected(
      "equality_normalized_member_population"
    ),
    equality_normalized_members: projected("equality_normalized_members"),
    authentication_evidence_occurrence: [auth.evidenceOccurrence.reference_id],
    authentication_observation_attempt: [auth.attempt.reference_id],
    authenticated_source: [auth.source.reference_id],
    target_resolution_witness: ["ref-target-resolution-witness"],
    source_authentication_witness: ["ref-source-authentication-witness"],
    source_of_record_witness: ["ref-source-of-record-witness"],
    attempt_binding_witness: ["ref-attempt-binding-witness"],
    authentication_witness: ["ref-authentication-witness"],
    authentication_capture: ["ref-authentication-capture"],
    equality_policy: ["ref-equality-policy"],
    resource_policy: ["ref-resource-policy"],
    traversal: projected("traversal"),
    snapshot: projected("snapshot"),
    traversal_source_version: projected("traversal_source_version"),
    terminal_page: projected("terminal_page"),
    exact_order_state: ["ref-exact-order-state"],
    exact_equality_state: ["ref-exact-equality-state"],
    aggregate_input_accounting: projected("aggregate_input_accounting"),
    canonical_result_accounting: projected("canonical_result_accounting"),
    work_accounting: projected("work_accounting"),
    verification: ["ref-complete-traversal-verification"],
    traversal_failure_condition: ["ref-complete-traversal-failure-condition"]
  };
  const grounded = new Map([
    [auth.evidenceOccurrence.reference_id, auth.evidenceOccurrence.grounded_identity],
    [auth.attempt.reference_id, auth.attempt.grounded_identity],
    [auth.source.reference_id, auth.source.grounded_identity]
  ]);
  const referenceById = new Map();
  for (const [role, ids] of Object.entries(roles)) for (const referenceId of ids) {
    const candidate = {
      reference_id: referenceId,
      type_term: roleType(profile, role),
      identity: structuredClone(grounded.get(referenceId) ?? durableIdentity(referenceId))
    };
    const prior = referenceById.get(referenceId);
    if (prior && prior.type_term !== candidate.type_term) throw new TypeError(
      `fixture role type conflict for ${referenceId}`
    );
    referenceById.set(referenceId, candidate);
  }

  const propositions = [];
  const claims = [];
  const claimIdsByPattern = new Map();
  const addClaim = ({ id, kind, modality, subject, operator, scope, operands,
    verificationMethod = null, falsifier = null }) => {
    const propositionId = `prop-${id}`;
    propositions.push({
      proposition_id: propositionId,
      subject_reference_id: subject,
      operator,
      applicability_context: scope,
      operands: operands.map(refOperand)
    });
    const claim = {
      claim_id: `claim-${id}`, kind, modality, proposition_id: propositionId
    };
    if (verificationMethod) {
      const falsifierId = `prop-falsifier-${id}`;
      propositions.push({ proposition_id: falsifierId, ...falsifier });
      claim.verification_method = verificationMethod;
      claim.falsifying_proposition_id = falsifierId;
    }
    claims.push(claim);
    return claim.claim_id;
  };

  for (const pattern of profile.reference_binding_patterns) {
    const [populationRole, memberRole] = pattern.roles;
    const scope = expandContext(pattern.applicability_context, roles);
    const populationId = roles[populationRole][0];
    const memberIds = roles[memberRole];
    if (memberIds.length > 0) addClaim({
      id: `${pattern.pattern_id}-membership`, kind: "evidence", modality: "MUST",
      subject: populationId, operator: "reference:contains", scope,
      operands: memberIds
    });
    addClaim({
      id: `${pattern.pattern_id}-cardinality`, kind: "evidence", modality: "MUST",
      subject: populationId, operator: "number:has_cardinality", scope,
      operands: []
    });
    propositions.at(-1).operands = [{ kind: "number", value: memberIds.length }];
  }

  for (const pattern of profile.claim_patterns) {
    const members = pattern.for_each ? roles[pattern.for_each.population_role] : [null];
    const ids = [];
    members.forEach((memberId, index) => {
      const local = pattern.for_each
        ? { [pattern.for_each.member_role]: [memberId] } : {};
      const template = pattern.proposition_template;
      const id = `${pattern.pattern_id}${pattern.for_each ? `-${index}` : ""}`;
      const falsifierTemplate = pattern.falsifying_proposition_template;
      const falsifier = falsifierTemplate ? {
        subject_reference_id: (local[falsifierTemplate.subject_role] ??
          roles[falsifierTemplate.subject_role])[0],
        operator: falsifierTemplate.operator,
        applicability_context: expandContext(
          falsifierTemplate.applicability_context, roles, local
        ),
        operands: falsifierTemplate.operands.flatMap(({ role }) =>
          (local[role] ?? roles[role]).map(refOperand))
      } : null;
      ids.push(addClaim({
        id,
        kind: pattern.claim_kind,
        modality: pattern.allowed_modalities[0],
        subject: (local[template.subject_role] ?? roles[template.subject_role])[0],
        operator: template.operator,
        scope: expandContext(template.applicability_context, roles, local),
        operands: template.operands.flatMap(({ role }) => local[role] ?? roles[role]),
        verificationMethod: falsifier ? "test_execution" : null,
        falsifier
      }));
    });
    claimIdsByPattern.set(pattern.pattern_id, ids);
  }
  const relations = profile.relation_patterns.map((pattern) => ({
    relation_id: `rel-${pattern.pattern_id}`,
    role: pattern.role,
    source_claim_id: claimIdsByPattern.get(pattern.source_claim_pattern_id)[0],
    target_claim_id: claimIdsByPattern.get(pattern.target_claim_pattern_id)[0]
  }));
  const contract = {
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    references: [...referenceById.values()],
    propositions,
    claims,
    relations,
    collections: [],
    residue: [],
    annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: []
  };
  const input = {
    input_version: "controlled-contract-verification-profile-input.v1",
    evaluation_stage: "pre_dispatch",
    reference_bindings: profile.reference_roles.map(({ role }) => ({
      role, reference_ids: [...roles[role]]
    })),
    number_bindings: [],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [], stable_evaluation: {}
  };
  mutateContract?.(contract, { roles, traceFixture, projection });
  mutateInput?.(input, { roles, traceFixture, projection });
  return { contract, input, profile, projection, projectionBytes, roles, traceFixture };
}

export {
  buildCompletePaginationProfileFixture,
  completeTraversalResourceFixture,
  completeTraversalTraceFixture,
  rebuildCompleteSources
};
