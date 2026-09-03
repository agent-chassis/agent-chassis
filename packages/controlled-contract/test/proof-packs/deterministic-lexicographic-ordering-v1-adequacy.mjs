import { evaluateStableProofPackFixtureV1 } from
  "../support/stable-v1-proof-pack-runtime.mjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PinnedCaptureRoot,
  captureAndEvaluateExactBindingsV1
} from "../../lib/exact-binding-capture.mjs";
import { snapshotExactBindingAssessmentRequest } from
  "../../lib/exact-binding-plain-data.mjs";
import { PROOF_PACK_ADEQUACY_RUN_VERSION } from
  "../support/proof-pack-adequacy-constants.mjs";
import { canonicalJsonBytes } from
  "../../lib/deterministic-projection-primitives.mjs";
import {
  FACT_ARGUMENTS,
  assertLexicographicConformanceResult
} from "../../lib/deterministic-lexicographic-ordering.mjs";
import { executeFixture, executeMutant } from
  "./deterministic-lexicographic-ordering-v1-harness.mjs";
import { buildLexicographicDocuments } from
  "./deterministic-lexicographic-ordering-v1-fixture.mjs";

const GUARANTEE = "For exact captured input, complete result, ordering policy, and item-key/comparator evidence artifacts, the package-owned deterministic-lexicographic-conformance.v1 transformer validates complete mutually inclusive item populations and exact counts, at least two typed keys with explicit precedence and direction, first-unequal-key ordering, equal-key fallthrough to one stable item-identity tie-breaker, non-equality for every distinguishable pair, the complete captured result, and observed input, declaration, and equivalent-serialization permutation invariance; it emits one exact digest-bound conformance report containing the complete typed fact set and derived declared-item, result-item, and policy-key populations, and the profile retains its own population, count, claim, falsifier, and verifies spine.";
const PROFILE_DIGEST =
  "e8236db6201793762140c3999ff605ac52829a36940d5f383d2ec2df9950575e";
const GUARANTEE_DIGEST =
  "93cd1b6fdab1f2173ab1d256c99f7b56f3ddf568dc9554596cee2dabf9e6a62c";

const EXCLUSIONS = Object.freeze([
  "artifact-acquisition-completeness-before-exact-capture",
  "caller-supplied-source-truth-or-authority",
  "empty-or-singleton-item-or-policy-key-populations",
  "ordering-behavior-after-the-captured-observation-boundary",
  "pack-applicability-evidence-authority-or-cce-consequence",
  "pagination-performance-or-resource-behavior",
  "runtime-or-deployment-behavior-outside-captured-artifacts",
  "undeclared-coercion-null-nan-locale-collation-normalization-or-punctuation-semantics"
]);
const POSITIVE_IDS = Object.freeze([
  "boolean-numeric-unicode-three-key",
  "numeric-unicode-two-key",
  "tie-normalized-unicode-two-key",
  "timestamp-integer-two-key"
]);
const MUTANT_IDS = Object.freeze([
  "ambient-locale-comparison",
  "comparator-false-equality",
  "declaration-permutation-sensitivity",
  "direction-reversal",
  "duplicated-result-member",
  "fabricated-resolver-facts",
  "input-permutation-sensitivity",
  "key-precedence-reversal",
  "key-extractor-ignored",
  "key-normalization-ignored",
  "key-type-ignored",
  "oldest-first-substitution",
  "omitted-result-member",
  "premature-tie-breaking",
  "prefix-only-sorting",
  "punctuation-stripping-comparison",
  "resolver-facts-bound-to-different-artifacts",
  "serialization-permutation-sensitivity",
  "serialization-duplicate-members",
  "substituted-result-member",
  "tie-breaker-direction-reversal",
  "tie-breaker-normalization-ignored",
  "unicode-leading-lone-surrogate",
  "unicode-trailing-lone-surrogate",
  "unstable-equal-key-ordering"
]);
const FACT_WEAKENING_IDS = Object.freeze([
  ...Object.entries(FACT_ARGUMENTS).flatMap(([factKey, argumentRoles]) =>
    argumentRoles.map((role) => `fact-${factKey}-missing-argument-${role.replaceAll("_", "-")}`)),
  ...Object.keys(FACT_ARGUMENTS).map((factKey) => `fact-${factKey}-omitted`),
  "fact-satisfied-false",
  "fact-source-digest-rebound"
].sort());
const REJECTION_PATTERNS = Object.freeze([
  "complete-declared-population",
  "complete-key-population",
  "complete-result-population",
  "comparator-uses-policy",
  "conformance-report-records-exact-sources-and-populations",
  "declared-within-result",
  "input-carries-population",
  "lexicographic-conformance-established",
  "operation-deterministic",
  "operation-reads-input",
  "operation-returns-result",
  "operation-uses-comparator",
  "policy-carries-keys",
  "policy-carries-tie-breaker",
  "result-carries-population",
  "result-count-exact",
  "result-emits-count",
  "result-within-declared",
  "verification-reads-artifacts",
  "verification-target-count",
  "verification-target-declared-population",
  "verification-target-determinism",
  "verify-lexicographic-conformance",
  "verification-target-lexicographic-conformance",
  "verification-target-result-population",
  "verify-declared-within-result",
  "verify-determinism",
  "verify-result-count",
  "verify-result-within-declared"
]);

const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

function roleBindings(profile, report) {
  const roles = Object.fromEntries(profile.reference_roles.map(({ role }) => [
    role, [`ref-${role.replaceAll("_", "-")}`]
  ]));
  roles.declared_items = [...report.populations.declared_items];
  roles.result_items = [...report.populations.result_items];
  roles.policy_keys = [...report.populations.policy_keys];
  return roles;
}

function resolveTemplate(template, roles) {
  const values = (role) => roles[role] ?? [];
  return {
    subject_reference_id: values(template.subject_role)[0] ?? null,
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.flatMap(values)
    },
    operands: template.operands.flatMap((operand) => operand.kind === "reference"
      ? values(operand.role).map(ref)
      : [{ kind: operand.kind,
          ...(operand.value_role === undefined ? { value: operand.value } : {
            value: operand.value_role === "item_count"
              ? roles.__item_count : roles.__policy_key_count
          }) }])
  };
}

function buildLexicographicProfileFixture({ profile, caseId = "numeric-unicode",
  omitPatternIds = [], mutateContract = null, mutateInput = null } = {}) {
  const documents = buildLexicographicDocuments(caseId);
  const report = JSON.parse(executeFixture(documents));
  const roles = roleBindings(profile, report);
  roles.__item_count = report.counts.item_count;
  roles.__policy_key_count = report.counts.policy_key_count;
  const typeByReference = new Map();
  for (const role of profile.reference_roles) for (const referenceId of roles[role.role]) {
    if (!typeByReference.has(referenceId)) typeByReference.set(
      referenceId, role.allowed_type_terms[0]
    );
  }
  const references = [...typeByReference].map(([referenceId, typeTerm]) => ({
    reference_id: referenceId,
    type_term: typeTerm,
    identity: { kind: "durable_id", domain: "lexicographic-conformance",
      value: referenceId }
  }));
  const contract = {
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    references,
    propositions: [],
    claims: [],
    relations: [],
    collections: [],
    residue: [],
    annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: []
  };
  const addClaim = (claimId, proposition, kind = "evidence", modality = "MUST",
    verificationMethod = null, falsifierId = null) => {
    contract.propositions.push({ proposition_id: `prop-${claimId}`, ...proposition });
    contract.claims.push({
      claim_id: `claim-${claimId}`,
      proposition_id: `prop-${claimId}`,
      kind,
      modality,
      ...(verificationMethod ? { verification_method: verificationMethod } : {}),
      ...(falsifierId ? { falsifying_proposition_id: `prop-${falsifierId}` } : {})
    });
  };
  const omitted = new Set(omitPatternIds);
  for (const pattern of profile.reference_binding_patterns) {
    if (omitted.has(pattern.pattern_id)) continue;
    const [populationRole, membersRole] = pattern.roles;
    const members = roles[membersRole];
    addClaim(`population-${pattern.pattern_id}-count`, {
      subject_reference_id: roles[populationRole][0],
      operator: "number:has_cardinality",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "number", value: members.length }]
    });
    addClaim(`population-${pattern.pattern_id}-members`, {
      subject_reference_id: roles[populationRole][0],
      operator: "reference:contains",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: members.map(ref)
    });
  }
  for (const pattern of profile.claim_patterns) {
    if (omitted.has(pattern.pattern_id)) continue;
    let falsifierId = null;
    if (pattern.falsifying_proposition_template) {
      falsifierId = `falsifier-${pattern.pattern_id}`;
      contract.propositions.push({
        proposition_id: `prop-${falsifierId}`,
        ...resolveTemplate(pattern.falsifying_proposition_template, roles)
      });
    }
    addClaim(pattern.pattern_id, resolveTemplate(pattern.proposition_template, roles),
      pattern.claim_kind, pattern.allowed_modalities[0],
      pattern.claim_kind === "verification" ? pattern.verification_methods[0] : null,
      falsifierId);
  }
  for (const relation of profile.relation_patterns) {
    if (omitted.has(relation.pattern_id) ||
        omitted.has(relation.source_claim_pattern_id) ||
        omitted.has(relation.target_claim_pattern_id)) continue;
    contract.relations.push({
      relation_id: `rel-${relation.pattern_id}`,
      role: relation.role,
      source_claim_id: `claim-${relation.source_claim_pattern_id}`,
      target_claim_id: `claim-${relation.target_claim_pattern_id}`
    });
  }
  const harmlessEvidenceId = "ref-harmless-unrelated-evidence";
  contract.references.push({
    reference_id: harmlessEvidenceId,
    type_term: "cc:evidence",
    identity: {
      kind: "durable_id",
      domain: "lexicographic-conformance",
      value: harmlessEvidenceId
    }
  });
  addClaim("harmless-unrelated-evidence", {
    subject_reference_id: harmlessEvidenceId,
    operator: "reference:records",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [ref(roles.input_snapshot[0])]
  });
  const input = {
    input_version: "controlled-contract-verification-profile-input.v1",
    evaluation_stage: "pre_dispatch",
    reference_bindings: profile.reference_roles.map(({ role }) => ({
      role, reference_ids: [...roles[role]]
    })),
    number_bindings: [
      { role: "item_count", value: report.counts.item_count },
      { role: "policy_key_count", value: report.counts.policy_key_count }
    ],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [], stable_evaluation: {}
  };
  mutateContract?.(contract, input, roles);
  mutateInput?.(input, contract, roles);
  return { contract, input, profile, roles, documents, report };
}

function satisfaction(fixture) {
  return evaluateStableProofPackFixtureV1({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  }).satisfaction;
}

function fabricatedFactControl(profile, differentArtifacts = false) {
  const first = buildLexicographicDocuments("numeric-unicode");
  const second = buildLexicographicDocuments("timestamp-integer");
  const report = JSON.parse(executeFixture(differentArtifacts ? second : first));
  if (!differentArtifacts) report.facts[0].fact_key = "fabricated-pass";
  return exactBoundaryRejectsReport({
    profile,
    documents: first,
    reportBytes: canonicalJsonBytes(report, { file: true })
  });
}

const EXACT_DECLARATION = Object.freeze({
  schema_version: "controlled-contract-exact-binding-declaration.v1",
  profile_id: "proof.ordering.lexicographic-conformance",
  profile_version: "2.0.0",
  profile_digest: PROFILE_DIGEST,
  requirements: [
    ["comparator-evidence", [["item_key_evidence", "artifact_subject"]]],
    ["conformance-report", [
      ["conformance_report", "artifact_subject"],
      ["declared_items", "projection_result_population", "declared-items"],
      ["policy_keys", "projection_result_population", "policy-keys"],
      ["result_count_signal", "artifact_subject"],
      ["result_items", "projection_result_population", "result-items"]
    ]],
    ["input-snapshot", [["input_snapshot", "artifact_subject"]]],
    ["ordering-policy", [["ordering_policy", "artifact_subject"]]],
    ["result-snapshot", [["result_snapshot", "artifact_subject"]]]
  ].map(([requirementId, coverage]) => ({
    requirement_id: requirementId,
    binding_kind: "artifact_bytes",
    role_coverage: coverage.map(([role, projection, populationId]) => ({
      role, coverage: "exact", projection,
      ...(populationId === undefined ? {} : { population_id: populationId })
    }))
  })),
  relations: [{
    relation_id: "derive-lexicographic-conformance",
    operator: "deterministic_projection",
    transformer_id: "deterministic-lexicographic-conformance.v1",
    source_requirement_ids: [
      "comparator-evidence", "input-snapshot", "ordering-policy", "result-snapshot"
    ],
    result_requirement_id: "conformance-report"
  }, {
    relation_id: "independent-exact-sources",
    operator: "distinct_source_descriptor",
    requirement_ids: [
      "comparator-evidence", "input-snapshot", "ordering-policy", "result-snapshot"
    ]
  }]
});
const EXACT_CONTEXT = Object.freeze({
  contract_digest: "1".repeat(64),
  profile_digest: PROFILE_DIGEST,
  evaluation_input_digest: "2".repeat(64),
  vocabulary_version: "0.34.0",
  vocabulary_complete_digest: "3".repeat(64),
  admission_digest: "4".repeat(64),
  exact_binding_declaration_digest: "5".repeat(64),
  exact_binding_certification_digest: "6".repeat(64)
});

async function exactBoundaryRejectsReport({ profile, documents, reportBytes }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-lex-adequacy-boundary-"));
  const fixture = buildLexicographicProfileFixture({ profile });
  const files = new Map([
    ["comparator-evidence", documents.sourceBytes[0]],
    ["input-snapshot", documents.sourceBytes[1]],
    ["ordering-policy", documents.sourceBytes[2]],
    ["result-snapshot", documents.sourceBytes[3]],
    ["conformance-report", reportBytes]
  ]);
  await Promise.all([...files].map(([id, bytes]) =>
    writeFile(path.join(root, `${id}.json`), bytes)));
  const pinnedRoot = await PinnedCaptureRoot.open(root);
  try {
    const result = await captureAndEvaluateExactBindingsV1({
      request: snapshotExactBindingAssessmentRequest({
        contractPath: "contract.json",
        evaluationInputPath: "evaluation.json",
        profileId: "proof.ordering.lexicographic-conformance",
        exactBindingSources: Object.fromEntries([...files.keys()].map((id) => [id, {
          kind: "artifact_file", relative_path: `${id}.json`
        }]))
      }),
      declaration: EXACT_DECLARATION,
      evaluationInput: fixture.input,
      context: EXACT_CONTEXT,
      expectedContext: EXACT_CONTEXT,
      pinnedRoot
    });
    return result.satisfaction !== "satisfied";
  } finally {
    await pinnedRoot.close();
    await rm(root, { recursive: true, force: true });
  }
}

function factWeakeningControl(controlId) {
  const documents = buildLexicographicDocuments("numeric-unicode");
  const report = JSON.parse(executeFixture(documents));
  if (controlId === "fact-satisfied-false") report.facts[0].satisfied = false;
  else if (controlId === "fact-source-digest-rebound") {
    report.facts[0].source_set_sha256 = "0".repeat(64);
  } else {
    const omittedSuffix = "-omitted";
    if (controlId.endsWith(omittedSuffix)) {
      const factKey = controlId.slice("fact-".length, -omittedSuffix.length);
      report.facts = report.facts.filter((fact) => fact.fact_key !== factKey);
    } else {
      const prefix = "fact-";
      const marker = "-missing-argument-";
      const split = controlId.indexOf(marker);
      const factKey = controlId.slice(prefix.length, split);
      const role = controlId.slice(split + marker.length).replaceAll("-", "_");
      const fact = report.facts.find((entry) => entry.fact_key === factKey);
      fact.argument_roles = fact.argument_roles.filter((entry) => entry !== role);
    }
  }
  try {
    assertLexicographicConformanceResult(report);
    return false;
  } catch {
    return true;
  }
}

async function runProofPackAdequacyControls({ profile, profile_digest: profileDigest }) {
  const controls = [];
  for (const [controlId, caseId] of [
    ["numeric-unicode-two-key", "numeric-unicode"],
    ["timestamp-integer-two-key", "timestamp-integer"],
    ["tie-normalized-unicode-two-key", "tie-normalized-unicode"],
    ["boolean-numeric-unicode-three-key", "boolean-numeric-unicode"]
  ]) controls.push({
    control_id: controlId,
    category: "positive",
    implementation_outcome: "passed",
    profile_satisfaction: satisfaction(buildLexicographicProfileFixture({ profile, caseId }))
  });
  for (const controlId of MUTANT_IDS) {
    const killed = controlId === "fabricated-resolver-facts"
      ? await fabricatedFactControl(profile, false)
      : controlId === "resolver-facts-bound-to-different-artifacts"
        ? await fabricatedFactControl(profile, true)
        : executeMutant(controlId).killed;
    controls.push({
      control_id: controlId,
      category: "mutant",
      implementation_outcome: killed ? "killed" : "passed",
      profile_satisfaction: killed ? "unsatisfied" : "satisfied"
    });
  }
  for (const controlId of FACT_WEAKENING_IDS) controls.push({
    control_id: controlId,
    category: "mutant",
    implementation_outcome: factWeakeningControl(controlId) ? "killed" : "passed",
    profile_satisfaction: factWeakeningControl(controlId) ? "unsatisfied" : "satisfied"
  });
  for (const patternId of REJECTION_PATTERNS) controls.push({
    control_id: `missing-${patternId}`,
    category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: satisfaction(buildLexicographicProfileFixture({
      profile, omitPatternIds: [patternId]
    }))
  });
  for (const controlId of EXCLUSIONS) controls.push({
    control_id: controlId,
    category: "exclusion",
    implementation_outcome: "boundary_demonstrated",
    profile_satisfaction: "not_evaluated"
  });
  controls.sort((left, right) => left.control_id < right.control_id ? -1 : 1);
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: profileDigest ?? PROFILE_DIGEST,
    guarantee_digest: GUARANTEE_DIGEST,
    controls
  };
}

export {
  EXCLUSIONS,
  FACT_WEAKENING_IDS,
  GUARANTEE,
  GUARANTEE_DIGEST,
  MUTANT_IDS,
  POSITIVE_IDS,
  PROFILE_DIGEST,
  REJECTION_PATTERNS,
  buildLexicographicProfileFixture,
  runProofPackAdequacyControls,
  satisfaction
};
