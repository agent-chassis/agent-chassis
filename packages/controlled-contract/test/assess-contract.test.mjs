import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test, { after, before } from "node:test";

import { checkContract } from "../bin/check-contract.mjs";
import {
  parseArgs,
  repositoryRootFromScriptDirectory,
  usage
} from "../bin/assess-contract.mjs";
import { buildRefusalBeforeEffectsFixture } from
  "./proof-packs/refusal-before-effects-fixture.mjs";
import { buildProofPlanFixture } from "./proof-plan-fixture.mjs";
import {
  loadAdmittedProofPack,
  readProofPackCatalog
} from "../lib/admitted-proof-packs.mjs";
import {
  ARTIFACT_RELATIVE_ROOT,
  ASSESSMENT_FORMAT,
  ASSESSMENT_FORMAT_VERSION,
  ASSESSMENT_IMPLEMENTATION_DIGEST,
  ASSESSMENT_SCHEMA,
  ASSESSMENT_SCHEMA_VERSION,
  ASSESSMENT_TOOL_VERSION,
  AssessmentArtifactError,
  assessContractFiles,
  assessStructuralContractFile,
  bundleBytes,
  canonicalDigest,
  canonicalJson,
  compactAssessmentOutput,
  markdownAssessment,
  projectContractAssessment,
  validateAssessmentSchema,
  writeAssessmentBundle
} from "../lib/contract-assessment.mjs";
import { buildStableTestProofPopulation } from
  "./support/stable-v1-proof-pack-runtime.mjs";

function stabilizeFixture(value) {
  const fixtureValue = structuredClone(value);
  fixtureValue.contract.schema_version = "controlled-acceptance-contract.v1";
  fixtureValue.contract.profile_id = "acceptance-contract.standard.v1";
  fixtureValue.contract.vocabulary_version = "controlled-contract-vocabulary.v1";
  fixtureValue.contract.test_proof_version = "controlled-contract-test-proof.v1";
  fixtureValue.contract.test_proofs = buildStableTestProofPopulation(fixtureValue.contract);
  fixtureValue.input.input_version = "controlled-contract-verification-profile-input.v1";
  fixtureValue.input.stable_evaluation = {};
  return fixtureValue;
}

const execFileAsync = promisify(execFile);
const childEnvironment = () => {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  return environment;
};
const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
let temporaryRoot;
let fixture;
let contractSource;
let structural;
let pack;
let projected;
let publishableProjected;

async function structuralFor(contract, name) {
  const source = canonicalJson(contract);
  const inputPath = path.join(temporaryRoot, `${name}.json`);
  await writeFile(inputPath, source, "utf8");
  return { inputPath, source, result: await checkContract(inputPath) };
}

function admittedProjection({
  contract = fixture.contract,
  source = contractSource,
  structuralResult = structural,
  evaluationInput = fixture.input,
  proofPack = pack
} = {}) {
  return projectContractAssessment({
    mode: "admitted_profile",
    contract,
    structuralResult,
    structuralInputSource: source,
    evaluationInput,
    proofPack
  });
}

function reverseObjectProperties(value) {
  if (Array.isArray(value)) return value.map(reverseObjectProperties);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.entries(value).reverse().map(
      ([key, child]) => [key, reverseObjectProperties(child)]
    )
  );
  return value;
}

function shuffledSetLikeInputs(originalContract, originalInput) {
  const contract = structuredClone(originalContract);
  for (const field of [
    "references", "propositions", "claims", "relations", "collections", "annotations"
  ]) contract[field].reverse();
  for (const proposition of contract.propositions) {
    proposition.applicability_context.operand_reference_ids.reverse();
    if (proposition.operator !== "reference:ordered_as") proposition.operands.reverse();
  }
  for (const collection of contract.collections) {
    if (collection.collection_kind === "closed_set") collection.member_claim_ids.reverse();
  }
  const input = structuredClone(originalInput);
  for (const field of [
    "reference_bindings", "number_bindings", "claim_pattern_bindings",
    "resolver_facts", "delivered_evidence"
  ]) input[field].reverse();
  for (const binding of input.reference_bindings) binding.reference_ids.reverse();
  return { contract, input };
}

function containsKey(value, sought) {
  if (Array.isArray(value)) return value.some((entry) => containsKey(entry, sought));
  if (value !== null && typeof value === "object") return Object.entries(value).some(
    ([key, child]) => key === sought || containsKey(child, sought)
  );
  return false;
}

before(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "controlled-assessment-test-"));
  fixture = stabilizeFixture(buildRefusalBeforeEffectsFixture());
  const checked = await structuralFor(fixture.contract, "contract");
  ({ source: contractSource, result: structural } = checked);
  pack = await loadAdmittedProofPack(
    "proof.authorization.refusal-before-effects"
  );
  projected = admittedProjection();
  const evaluationInputPath = path.join(temporaryRoot, "publishable-input.json");
  await writeFile(evaluationInputPath, canonicalJson(fixture.input), "utf8");
  publishableProjected = await assessContractFiles({
    inputPath: checked.inputPath,
    profileId: "proof.authorization.refusal-before-effects",
    evaluationInputPath
  });
});

after(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

test("projects planning-only non-authoritative axes without a runtime verdict", () => {
  const { assessment } = projected;
  assert.equal(assessment.structure, "proven");
  assert.equal(assessment.profile_discrimination, "proven");
  assert.equal(assessment.assessment_scope, "planning");
  assert.equal(assessment.residue_status, "none");
  assert.equal(assessment.authority, "non_authoritative");
  assert.equal(
    assessment.overall_code,
    "structure_proven__profile_proven__residue_none"
  );
  const markdown = markdownAssessment(assessment);
  assert.match(markdown, /^## ASSESSMENT SCOPE: PLANNING$/mu);
  assert.match(markdown, /^## AUTHORITY: NON-AUTHORITATIVE$/mu);
  assert.match(markdown, /^## RESIDUE: NONE$/mu);
  assert.match(markdown, /does not establish runtime truth/u);
  assert.equal(assessment.schema_version, "controlled-contract-assessment.v1");
  assert.equal(ASSESSMENT_SCHEMA_VERSION, "controlled-contract-assessment.v1");
  assert.equal(ASSESSMENT_TOOL_VERSION, "controlled-contract-assess.v1");
  assert.equal(ASSESSMENT_FORMAT_VERSION, "controlled-contract-assessment-bundle.v1");
});

test("v1 format identity cannot reuse the experimental assessment cache identity", async () => {
  const source = projected.assessment.digests.source;
  assert.equal(source.assessment_format, canonicalDigest(ASSESSMENT_FORMAT));
  const implementationSource = await readFile(
    new URL("../lib/contract-assessment.mjs", import.meta.url)
  );
  assert.equal(
    ASSESSMENT_IMPLEMENTATION_DIGEST,
    createHash("sha256").update(implementationSource).digest("hex")
  );
  const legacySourceDigests = structuredClone(source);
  delete legacySourceDigests.assessment_format;
  const legacyIdentity = canonicalDigest({
    assessment_schema_version: "controlled-contract-assessment.experimental.v0.1",
    assessment_tool_version: "controlled-contract-assess.experimental.v0.1",
    mode: "admitted_profile",
    source_digests: legacySourceDigests
  });
  assert.notEqual(projected.assessment.assessment_identity, legacyIdentity);

  const artifactRepository = await mkdtemp(path.join(temporaryRoot, "versioned-cache-"));
  const legacyDirectory = path.join(
    artifactRepository, ARTIFACT_RELATIVE_ROOT, legacyIdentity
  );
  await mkdir(legacyDirectory, { recursive: true });
  await writeFile(path.join(legacyDirectory, "historical-v0.1"), "existing\n");
  const currentArtifact = await writeAssessmentBundle(publishableProjected, {
    repositoryRoot: artifactRepository
  });
  assert.notEqual(legacyDirectory, currentArtifact.directory);
  assert.equal(currentArtifact.reused, false);
});

test("exported identity metadata is deeply immutable", () => {
  assert.equal(Object.isFrozen(ASSESSMENT_FORMAT.files), true);
  assert.equal(Object.isFrozen(ASSESSMENT_SCHEMA), true);
  assert.equal(Object.isFrozen(ASSESSMENT_SCHEMA.properties), true);
  assert.throws(() => ASSESSMENT_FORMAT.files.push("forged-report.json"), TypeError);
  assert.throws(() => {
    ASSESSMENT_SCHEMA.title = "forged-schema";
  }, TypeError);
});

test("repository grounding is claim-specific structural anchoring", async () => {
  assert.deepEqual(projected.assessment.repository_grounding, {
    status: "none",
    scope_statement: projected.assessment.categorical_limits.repository_grounding,
    grounded_mandatory_behavior_claim_ids: [],
    ungrounded_mandatory_behavior_claim_ids: [
      "claim-no-protected-mutation-before-refusal",
      "claim-no-protected-write-before-refusal"
    ],
    grounded_count: 0,
    total_mandatory_behavior_count: 2,
    claims: [
      {
        claim_id: "claim-no-protected-mutation-before-refusal",
        proposition_id: "prop-no-protected-mutation-before-refusal",
        repository_reference_ids: []
      },
      {
        claim_id: "claim-no-protected-write-before-refusal",
        proposition_id: "prop-no-protected-write-before-refusal",
        repository_reference_ids: []
      }
    ]
  });

  const groundedContract = structuredClone(fixture.contract);
  groundedContract.references.push({
    reference_id: "ref-grounded-channel",
    type_term: "cc:protected_resource",
    identity: {
      kind: "repository_path",
      repository: "example/repository",
      path: "src/protected-channel.mjs"
    }
  });
  const groundedProposition = groundedContract.propositions.find(
    ({ proposition_id: id }) => id === "prop-no-protected-write-before-refusal"
  );
  groundedProposition.operands = groundedProposition.operands.map(
    (operand, index) => index === 0
      ? { ...operand, reference_id: "ref-grounded-channel" }
      : { ...operand }
  );
  const checked = await structuralFor(groundedContract, "grounded-contract");
  const assessment = projectContractAssessment({
    mode: "structural_only",
    contract: groundedContract,
    structuralResult: checked.result,
    structuralInputSource: checked.source
  }).assessment;
  assert.equal(assessment.repository_grounding.status, "some");
  assert.deepEqual(assessment.repository_grounding.grounded_mandatory_behavior_claim_ids,
    ["claim-no-protected-write-before-refusal"]);
  assert.deepEqual(assessment.repository_grounding.ungrounded_mandatory_behavior_claim_ids,
    ["claim-no-protected-mutation-before-refusal"]);
  assert.deepEqual(
    assessment.repository_grounding.claims.find(
      ({ claim_id: id }) => id === "claim-no-protected-write-before-refusal"
    ).repository_reference_ids,
    ["ref-grounded-channel"]
  );
  const review = assessment.review_actions.find(
    ({ code }) => code === "confirm_or_bind_repository_grounding"
  );
  assert.deepEqual(review.claim_ids,
    ["claim-no-protected-mutation-before-refusal"]);
  assert.match(review.description, /not proof of existence or honesty/u);
  const compact = compactAssessmentOutput(assessment);
  assert.deepEqual(compact.ungrounded_mandatory_behavior_claim_ids,
    ["claim-no-protected-mutation-before-refusal"]);
  assert.match(markdownAssessment(assessment),
    /Ungrounded mandatory behavior claim IDs: `claim-no-protected-mutation-before-refusal`/u);
});

test("every catalog entry loads as one compact digest-bound admission", async () => {
  const catalog = await readProofPackCatalog();
  assert.ok(catalog.packs.length > 0);
  for (const { profile_id: profileId } of catalog.packs) {
    const admitted = await loadAdmittedProofPack(profileId);
    assert.equal(admitted.profile.profile_id, profileId);
    assert.equal(admitted.admission.profile_id, profileId);
    assert.equal(Object.isFrozen(admitted), true);
    assert.equal(Object.isFrozen(admitted.profile), true);
    assert.equal(Object.isFrozen(admitted.admission.certification), true);
    assert.match(admitted.profile_digest, /^[a-f0-9]{64}$/u);
    assert.match(admitted.admission_digest, /^[a-f0-9]{64}$/u);
  }
});

test("keeps honest residue separate from structural validity and binds its actions", async () => {
  const contract = structuredClone(fixture.contract);
  contract.residue.push({
    residue_id: "res-review-boundary",
    reason: "review_only",
    text: "This disposition belongs to a separate review."
  }, {
    residue_id: "res-unresolved-design-value",
    reason: "unresolved_value",
    text: "The carrier cannot select this design value."
  });
  const checked = await structuralFor(contract, "honest-residue");
  const result = projectContractAssessment({
    mode: "structural_only",
    contract,
    structuralResult: checked.result,
    structuralInputSource: checked.source
  }).assessment;
  assert.equal(result.structure, "proven");
  assert.equal(result.residue_status, "review_and_resolution_required");
  assert.equal(
    result.overall_code,
    "structure_proven__profile_not_assessed__" +
      "residue_review_and_resolution_required"
  );
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.required_next_evidence.some(
    ({ code }) => code === "structural_contract_remediation"
  ), false);
  assert.deepEqual(result.required_next_evidence.filter(
    ({ code }) => code.startsWith("residue_")
  ).map(({ code, subject_ids: subjectIds }) => [code, subjectIds]), [
    ["residue_review_required", ["res-review-boundary"]],
    ["residue_resolution_required", ["res-unresolved-design-value"]]
  ]);
  const markdown = markdownAssessment(result);
  assert.match(markdown, /^## STRUCTURE: PROVEN$/mu);
  assert.match(markdown, /^## RESIDUE: REVIEW AND RESOLUTION REQUIRED$/mu);
  assert.match(markdown, /residue_review_required.*res-review-boundary/u);
  assert.match(markdown, /residue_resolution_required.*res-unresolved-design-value/u);
});

test("never emits an unqualified passed field or pass heading", () => {
  assert.equal(containsKey(projected, "passed"), false);
  for (const contents of bundleBytes(projected).values()) {
    assert.doesNotMatch(contents, /^#+\s+PASS(?:ED)?\b/mu);
  }
});

test("preserves every proof exclusion in compact and full projections", () => {
  const expected = [...pack.admission.explicit_exclusions].sort();
  assert.deepEqual(
    projected.assessment.proof_exclusions.map(({ exclusion_id: id }) => id),
    expected
  );
  const compact = bundleBytes(projected).get("assessment.json");
  const full = bundleBytes(projected).get("proof-pack-admission.full.json");
  for (const exclusion of expected) {
    assert(compact.includes(exclusion));
    assert(full.includes(exclusion));
  }
});

test("puts every mandatory claim in exactly one explicit category", () => {
  const mandatoryIds = fixture.contract.claims.filter(
    ({ modality }) => modality === "MUST" || modality === "MUST_NOT"
  ).map(({ claim_id: id }) => id).sort();
  const categorizedIds = Object.values(
    projected.assessment.mandatory_claim_categories
  ).flat().map(({ claim_id: id }) => id).sort();
  assert.deepEqual(categorizedIds, mandatoryIds);
  assert.equal(new Set(categorizedIds).size, categorizedIds.length);
});

test("does not drop structural, profile, binding diagnostics or residue", async () => {
  const contract = structuredClone(fixture.contract);
  contract.residue.push({
    residue_id: "res-assessment-test",
    reason: "review_only",
    text: "Pressure-test residue must remain visible."
  });
  const checked = await structuralFor(contract, "contract-with-residue");
  checked.result.validation = {
    ...checked.result.validation,
    diagnostics: [...checked.result.validation.diagnostics,
      { code: "synthetic-structural-diagnostic" }]
  };
  const stalePack = structuredClone(pack);
  stalePack.admission.profile_digest = "f".repeat(64);
  const result = admittedProjection({
    contract,
    source: checked.source,
    structuralResult: checked.result,
    proofPack: stalePack
  }).assessment;
  assert.deepEqual(result.residue, contract.residue);
  assert(result.diagnostics.some(
    ({ source, detail }) => source === "structural_validation" &&
      detail.code === "synthetic-structural-diagnostic"
  ));
  assert(result.diagnostics.some(
    ({ source, detail }) => source === "assessment_binding" &&
      detail.field === "admission.profile_digest"
  ));
});

test("structural diagnostics project precise non-duplicated remediation actions", () => {
  const structuralResult = structuredClone(structural);
  structuralResult.validation.diagnostics.push({
    code: "population_definition_missing",
    population_reference_id: "ref-placeholder-population",
    applicability_context: {
      mode: "where",
      operand_reference_ids: ["ref-operation"]
    },
    claim_ids: []
  }, {
    code: "population_exact_cardinality_missing",
    population_reference_id: "ref-declared-members",
    applicability_context: {
      mode: "unconditional", operand_reference_ids: []
    },
    claim_ids: ["claim-declared-members"]
  }, {
    code: "mandatory_behavior_unverified",
    claim_id: "claim-no-protected-write-before-refusal"
  });
  const assessment = admittedProjection({ structuralResult }).assessment;
  assert.equal(assessment.structure, "not_proven");
  assert.notEqual(assessment.assessment_identity,
    projected.assessment.assessment_identity);
  assert.equal(assessment.required_next_evidence.some(
    ({ code }) => code === "structural_contract_remediation"
  ), false);
  const populationAction = assessment.required_next_evidence.find(
    ({ code }) => code === "declare_complete_population_definition"
  );
  assert.deepEqual(populationAction.population_reference_ids,
    ["ref-placeholder-population"]);
  assert.deepEqual(populationAction.applicability_contexts, [{
    mode: "where", operand_reference_ids: ["ref-operation"]
  }]);
  assert.match(populationAction.description,
    /cardinality zero.*adding an arbitrary cardinality alone is not sufficient/u);
  assert.deepEqual(populationAction.accepted_membership_operators,
    ["reference:contains", "reference:member_of"]);
  assert.deepEqual(populationAction.declared_member_reference_ids, []);
  assert.deepEqual(populationAction.membership_claim_ids, []);
  assert.equal(populationAction.declared_cardinality, null);
  assert.deepEqual(populationAction.declared_cardinality_values, []);
  assert.equal(populationAction.observed_member_count, 0);
  const cardinalityAction = assessment.required_next_evidence.find(
    ({ code }) => code === "declare_population_exact_cardinality"
  );
  assert.deepEqual(cardinalityAction.population_reference_ids,
    ["ref-declared-members"]);
  assert.deepEqual(cardinalityAction.claim_ids, ["claim-declared-members"]);
  const claimAction = assessment.required_next_evidence.find(
    ({ code }) => code === "bind_mandatory_behavior_verification"
  );
  assert.deepEqual(claimAction.claim_ids,
    ["claim-no-protected-write-before-refusal"]);
  assert.equal(assessment.required_next_evidence.filter(
    ({ code }) => code === "declare_complete_population_definition"
  ).length, 1);
});

test("population remediation carries authored membership and count facts", async () => {
  const contract = structuredClone(fixture.contract);
  contract.claims = contract.claims.filter(({ claim_id: claimId }) =>
    claimId !== "claim-protected-effect-population-cardinality");
  contract.propositions = contract.propositions.filter(
    ({ proposition_id: propositionId }) =>
      propositionId !== "prop-protected-effect-population-cardinality"
  );
  const checked = await structuralFor(contract, "population-remediation");
  checked.result.validation = {
    ...checked.result.validation,
    diagnostics: [...checked.result.validation.diagnostics, {
    code: "population_exact_cardinality_missing",
    population_reference_id: "ref-protected-effect-population",
    applicability_context: {
      mode: "unconditional", operand_reference_ids: []
    },
    claim_ids: ["claim-protected-effect-population-membership"]
  }]
  };
  const assessment = admittedProjection({
    contract,
    source: checked.source,
    structuralResult: checked.result
  }).assessment;
  const action = assessment.required_next_evidence.find(
    ({ code }) => code === "declare_population_exact_cardinality"
  );
  assert.deepEqual(action.accepted_membership_operators,
    ["reference:contains", "reference:member_of"]);
  assert.deepEqual(action.population_reference_ids,
    ["ref-protected-effect-population"]);
  assert.deepEqual(action.applicability_contexts,
    [{ mode: "unconditional", operand_reference_ids: [] }]);
  assert.deepEqual(action.declared_member_reference_ids,
    ["ref-protected-channel", "ref-protected-configuration"]);
  assert.deepEqual(action.membership_claim_ids,
    ["claim-protected-effect-population-membership"]);
  assert.equal(action.declared_cardinality, null);
  assert.deepEqual(action.declared_cardinality_values, []);
  assert.equal(action.observed_member_count, 2);
});

test("unknown structural diagnostics retain one generic remediation action", () => {
  const structuralResult = structuredClone(structural);
  structuralResult.decomposition.diagnostics.push({
    code: "future_unmapped_structural_diagnostic"
  }, {
    code: "future_unmapped_structural_diagnostic"
  });
  const assessment = admittedProjection({ structuralResult }).assessment;
  assert.equal(assessment.required_next_evidence.filter(
    ({ code }) => code === "structural_contract_remediation"
  ).length, 1);
});

test("shared falsifiers remain a bounded non-fatal review signal", async () => {
  const contract = structuredClone(fixture.contract);
  contract.collections[0].member_claim_ids = [
    "claim-no-protected-write-before-refusal",
    "claim-no-protected-mutation-before-refusal"
  ];
  contract.relations = contract.relations.filter(
    ({ relation_id: id }) => id !== "rel-mutation-verification-target"
  );
  contract.claims = contract.claims.filter(
    ({ claim_id: id }) => id !== "claim-mutation-prohibition-verification"
  );
  contract.test_proofs = contract.test_proofs.filter(
    ({ verification_claim_id: id }) => id !== "claim-mutation-prohibition-verification"
  );
  contract.relations.push({
    relation_id: "rel-shared-write-verification-target",
    role: "verifies",
    source_claim_id: "claim-write-prohibition-verification",
    target_claim_id: "claim-no-protected-mutation-before-refusal"
  });
  const checked = await structuralFor(contract, "shared-falsifier");
  assert.equal(checked.result.validation.diagnostics.length, 0);
  assert.equal(checked.result.decomposition.diagnostics.length, 0);
  const assessment = projectContractAssessment({
    mode: "structural_only",
    contract,
    structuralResult: checked.result,
    structuralInputSource: checked.source
  }).assessment;
  assert.equal(assessment.structure, "proven");
  assert.deepEqual(assessment.review_signals, [{
    code: "shared_falsifier_scope_review",
    collection_id: "set-proof-population",
    member_claim_ids: [
      "claim-no-protected-mutation-before-refusal",
      "claim-no-protected-write-before-refusal"
    ],
    shared_verification_claim_ids: ["claim-write-prohibition-verification"],
    shared_falsifying_proposition_ids: [
      "prop-falsifier-write-prohibition-verification"
    ],
    scope_statement: "Members without an exclusive falsifier are a review signal only. Shared verification may legitimately cover related behaviors; profile-specific adequacy remains the responsibility of an admitted proof pack."
  }]);
  const reviewAction = assessment.review_actions.find(
    ({ code }) => code === "confirm_shared_falsifier_scope"
  );
  assert.deepEqual(reviewAction.collection_ids, ["set-proof-population"]);
  assert.deepEqual(reviewAction.claim_ids, [
    "claim-no-protected-mutation-before-refusal",
    "claim-no-protected-write-before-refusal"
  ]);
  assert.match(markdownAssessment(assessment), /shared_falsifier_scope_review/u);
  assert.equal(compactAssessmentOutput(assessment).review_signal_count, 1);
});

test("binds identical source digests in compact, full, and manifest projections", () => {
  const files = bundleBytes(projected);
  const expected = projected.assessment.digests.source;
  assert.deepEqual(JSON.parse(files.get("assessment.json")).digests.source, expected);
  for (const name of [
    "structural.full.json",
    "admitted-proof.full.json",
    "proof-pack-admission.full.json",
    "manifest.json"
  ]) assert.deepEqual(JSON.parse(files.get(name)).source_digests, expected);
});

test("property order and set-like input order preserve assessment identity", async () => {
  const propertyContract = reverseObjectProperties(fixture.contract);
  const propertyInput = reverseObjectProperties(fixture.input);
  const propertyChecked = await structuralFor(propertyContract, "property-order");
  const propertyProjection = admittedProjection({
    contract: propertyContract,
    source: propertyChecked.source,
    structuralResult: propertyChecked.result,
    evaluationInput: propertyInput
  });
  assert.equal(
    propertyProjection.assessment.assessment_identity,
    projected.assessment.assessment_identity
  );

  const shuffled = shuffledSetLikeInputs(fixture.contract, fixture.input);
  const shuffledChecked = await structuralFor(shuffled.contract, "set-order");
  const shuffledProjection = admittedProjection({
    contract: shuffled.contract,
    source: shuffledChecked.source,
    structuralResult: shuffledChecked.result,
    evaluationInput: shuffled.input
  });
  assert.equal(
    shuffledProjection.assessment.assessment_identity,
    projected.assessment.assessment_identity
  );
});

test("repeated processes, locale, timezone, and elapsed wall clock preserve bytes", async () => {
  const directPayload = {
    mode: "structural_only",
    contract: fixture.contract,
    structuralResult: structural,
    structuralInputSource: contractSource
  };
  const payloadPath = path.join(temporaryRoot, "process-payload.json");
  await writeFile(payloadPath, JSON.stringify(directPayload), "utf8");
  const modulePath = path.join(
    repositoryRoot,
    "packages/controlled-contract/lib/contract-assessment.mjs"
  );
  const probe = [
    "import { readFile } from 'node:fs/promises';",
    `const m = await import(${JSON.stringify(`file://${modulePath}`)});`,
    "const payload = JSON.parse(await readFile(process.argv[1], 'utf8'));",
    "const projected = m.projectContractAssessment(payload);",
    "process.stdout.write(JSON.stringify([...m.bundleBytes(projected)]));"
  ].join("\n");
  const run = async (env) => (await execFileAsync(
    process.execPath,
    ["--input-type=module", "-e", probe, payloadPath],
    { env: { ...process.env, ...env }, maxBuffer: 20 * 1024 * 1024 }
  )).stdout;
  const first = await run({ TZ: "Pacific/Honolulu", LANG: "C" });
  await new Promise((resolve) => setTimeout(resolve, 25));
  const second = await run({ TZ: "Asia/Tokyo", LANG: "de_DE.UTF-8" });
  assert.equal(second, first);
});

test("direct structural mode cannot masquerade as admitted-profile assessment", () => {
  const direct = projectContractAssessment({
    mode: "structural_only",
    contract: fixture.contract,
    structuralResult: structural,
    structuralInputSource: contractSource
  }).assessment;
  assert.equal(direct.profile_discrimination, "not_assessed");
  assert.equal(direct.verification_scope.proof_plan_discrimination, "not_assessed");
  assert.equal(direct.profile_guarantee, null);
  assert.throws(() => projectContractAssessment({
    mode: "structural_only",
    contract: fixture.contract,
    structuralResult: structural,
    structuralInputSource: contractSource,
    proofPack: pack
  }), /rejects proof-profile inputs/u);
});

test("stale profile or admission cannot prove profile discrimination", () => {
  const stalePack = structuredClone(pack);
  stalePack.profile.description = `${stalePack.profile.description ?? ""} stale`;
  const stale = admittedProjection({ proofPack: stalePack }).assessment;
  assert.equal(stale.profile_discrimination, "not_proven");
  assert(stale.diagnostics.some(
    ({ source, detail }) => source === "assessment_binding" &&
      detail.field === "pack.profile_digest"
  ));
});

test("pressure: altered release admission cannot prove a pack", () => {
  const alteredPack = structuredClone(pack);
  alteredPack.admission.guarantee = `${alteredPack.admission.guarantee} altered`;
  const result = admittedProjection({ proofPack: alteredPack }).assessment;
  assert.equal(result.profile_discrimination, "not_proven");
  assert(result.diagnostics.some(
    ({ source, detail }) => source === "assessment_binding" &&
      detail.field === "admission.guarantee_digest"
  ));
});

test("pressure: structural and evaluation digest splicing fails closed", () => {
  const differentContract = structuredClone(fixture.contract);
  differentContract.annotations.push({
    annotation_id: "ann-splice",
    text: "This object was not structurally checked."
  });
  assert.throws(() => admittedProjection({ contract: differentContract }),
    /source and supplied contract value differ/u);

  const splicedAdmission = structuredClone(pack);
  splicedAdmission.admission.profile_digest = "e".repeat(64);
  const result = admittedProjection({ proofPack: splicedAdmission }).assessment;
  assert.equal(result.profile_discrimination, "not_proven");
  assert(result.diagnostics.some(
    ({ source, detail }) => source === "assessment_binding" &&
      detail.field === "admission.profile_digest"
  ));
});

test("pressure: a planning assessment cannot carry a runtime verdict or binder", () => {
  const result = admittedProjection().assessment;
  assert.equal(result.assessment_scope, "planning");
  assert.equal(result.required_next_evidence.some(
    ({ code }) => code.includes("runtime")
  ), false);
  const overstated = structuredClone(result);
  overstated.runtime_evidence = "proven";
  assert.equal(validateAssessmentSchema(overstated), false);
  delete overstated.runtime_evidence;
  overstated.runtime_evidence_binding = {};
  assert.equal(validateAssessmentSchema(overstated), false);
});

test("fixed artifact root rejects escape and reuses only identical content", async () => {
  const artifactRepository = await mkdtemp(path.join(temporaryRoot, "artifact-repo-"));
  const first = await writeAssessmentBundle(publishableProjected, {
    repositoryRoot: artifactRepository
  });
  assert.equal(first.reused, false);
  assert.equal(
    path.relative(artifactRepository, first.directory),
    path.join(
      ARTIFACT_RELATIVE_ROOT,
      publishableProjected.assessment.assessment_identity
    )
  );
  const second = await writeAssessmentBundle(publishableProjected, {
    repositoryRoot: artifactRepository
  });
  assert.equal(second.reused, true);

  await writeFile(path.join(first.directory, "assessment.md"), "conflict\n", "utf8");
  await assert.rejects(
    writeAssessmentBundle(publishableProjected, {
      repositoryRoot: artifactRepository
    }),
    (error) => error instanceof AssessmentArtifactError &&
      error.code === "assessment_artifact_collision"
  );

  const forged = structuredClone(publishableProjected);
  forged.assessment.assessment_identity = "a".repeat(64);
  forged.assessment.structure = "proven";
  await assert.rejects(
    writeAssessmentBundle(forged, { repositoryRoot: artifactRepository }),
    (error) => error instanceof AssessmentArtifactError &&
      error.code === "assessment_projection_untrusted"
  );
  await assert.rejects(
    writeAssessmentBundle(projected, { repositoryRoot: artifactRepository }),
    (error) => error instanceof AssessmentArtifactError &&
      error.code === "assessment_projection_untrusted"
  );
});

test("fixed artifact root fails when a cache symlink resolves outside repository", async () => {
  const repository = await mkdtemp(path.join(temporaryRoot, "symlink-repo-"));
  const outside = await mkdtemp(path.join(temporaryRoot, "outside-cache-"));
  await symlink(outside, path.join(repository, ".cache"));
  await assert.rejects(
    writeAssessmentBundle(publishableProjected, { repositoryRoot: repository }),
    (error) => error instanceof AssessmentArtifactError &&
      error.code === "assessment_artifact_root_escape"
  );
  assert.deepEqual(await readdir(outside), []);
});

test("does not mutate caller inputs or alias returned objects", () => {
  const contract = structuredClone(fixture.contract);
  const evaluationInput = structuredClone(fixture.input);
  const packInput = structuredClone(pack);
  const contractBefore = structuredClone(contract);
  const inputBefore = structuredClone(evaluationInput);
  const packBefore = structuredClone(packInput);
  const result = admittedProjection({
    contract,
    evaluationInput,
    proofPack: packInput
  });
  assert.deepEqual(contract, contractBefore);
  assert.deepEqual(evaluationInput, inputBefore);
  assert.deepEqual(packInput, packBefore);
  assert.notStrictEqual(result.assessment.residue, contract.residue);
  assert.notStrictEqual(
    result.reports.proofPackAdmission.result,
    packInput.admission
  );
  assert.throws(() => {
    result.assessment.residue.push({});
  }, TypeError);
});

test("CLI accepts structural-only input and rejects legacy single-pack flags", () => {
  assert.deepEqual(parseArgs(["--input", "contract.json"]), {
    input: "contract.json",
    proofPlan: null,
    help: false
  });
  assert.throws(() => parseArgs([
    "--input", "contract.json",
    "--profile", "proof.example",
    "--evaluation-input", "input.json",
    "--output", "elsewhere"
  ]), /unknown argument: --profile/u);
  assert.throws(() => parseArgs([
    "--input", "contract.json",
    "--profile", "proof.example"
  ]), /unknown argument: --profile/u);
  assert.doesNotMatch(usage(), /--profile|--evaluation-input|--capture-root/u);
  assert.match(usage(), /Every admitted proof-pack assessment requires/u);
  assert.equal(
    repositoryRootFromScriptDirectory(
      "/consumer/node_modules/@agent-chassis/controlled-contract/bin"
    ),
    "/consumer"
  );
});

test("structural-only CLI output is bounded and points to the typed bundle", async () => {
  const contract = structuredClone(fixture.contract);
  const uniqueId = createHash("sha256").update(temporaryRoot).digest("hex").slice(0, 16);
  contract.annotations.push({
    annotation_id: `ann-structural-cli-${uniqueId}`,
    kind: "note",
    text: "Unique structural-only CLI publication test input."
  });
  const inputPath = path.join(temporaryRoot, "structural-cli-contract.json");
  await writeFile(inputPath, canonicalJson(contract), "utf8");
  const direct = await assessStructuralContractFile({ inputPath });
  assert.equal(direct.assessment.structure, "proven");
  assert.equal(direct.assessment.profile_discrimination, "not_assessed");
  assert.equal(direct.assessment.assessment_scope, "planning");
  assert.equal(direct.reports.admittedProof.result, null);
  assert.equal(direct.reports.proofPackAdmission.result, null);

  const cliPath = path.join(
    repositoryRoot,
    "packages/controlled-contract/bin/assess-contract.mjs"
  );
  const execution = await execFileAsync(process.execPath, [
    cliPath,
    "--input",
    inputPath
  ], { cwd: repositoryRoot, env: childEnvironment() });
  assert(execution.stdout.length < 1000);
  const compact = JSON.parse(execution.stdout);
  assert.equal(compact.profile_discrimination, "not_assessed");
  assert.equal(compact.assessment_scope, "planning");
  const identity = compact.artifact.match(/\/([a-f0-9]{64})\/manifest\.json$/u)?.[1];
  assert(identity);
  const artifactDirectory = path.join(
    repositoryRoot,
    ARTIFACT_RELATIVE_ROOT,
    identity
  );
  const emitted = JSON.parse(await readFile(
    path.join(artifactDirectory, "assessment.json"),
    "utf8"
  ));
  assert.equal(validateAssessmentSchema(emitted), true);
  await rm(artifactDirectory, { recursive: true, force: true });
});

test("proof-plan CLI output stays bounded and does not run a proof corpus", async () => {
  const contractPath = path.join(temporaryRoot, "admitted-cli-contract.json");
  const inputPath = path.join(temporaryRoot, "admitted-cli-input.json");
  const proofPlanPath = path.join(temporaryRoot, "admitted-cli-proof-plan.json");
  await Promise.all([
    writeFile(contractPath, canonicalJson(fixture.contract), "utf8"),
    writeFile(inputPath, canonicalJson(fixture.input), "utf8")
  ]);
  const proofPlan = await buildProofPlanFixture({
    contractPath,
    packs: [{
      profileId: "proof.authorization.refusal-before-effects",
      requestedIntents: ["controlled-proof-intent.refusal-before-effects"],
      evaluationInputPath: inputPath
    }]
  });
  await writeFile(proofPlanPath, canonicalJson(proofPlan), "utf8");
  const cliPath = path.join(
    repositoryRoot,
    "packages/controlled-contract/bin/assess-contract.mjs"
  );
  const execution = await execFileAsync(process.execPath, [
    cliPath,
    "--input", contractPath,
    "--proof-plan", proofPlanPath
  ], { cwd: repositoryRoot, env: childEnvironment() });
  assert(execution.stdout.length < 1000);
  assert.doesNotMatch(execution.stdout, /negative_fixture_results|coverage_witness/u);
  const compact = JSON.parse(execution.stdout);
  assert.equal(compact.profile_discrimination, "proven");
  const identity = compact.artifact.match(/\/([a-f0-9]{64})\/manifest\.json$/u)?.[1];
  assert(identity);
  const artifactDirectory = path.join(
    repositoryRoot, ARTIFACT_RELATIVE_ROOT, identity
  );
  const proofPacks = JSON.parse(await readFile(
    path.join(artifactDirectory, "proof-packs.full.json"), "utf8"
  ));
  assert.equal(proofPacks.packs.length, 1);
  assert.equal(
    proofPacks.packs[0].admission.certification.executable_control_count, 59
  );
  assert.equal("negative_fixture_results" in proofPacks.packs[0].admission, false);
  await rm(artifactDirectory, { recursive: true, force: true });
});

test("full report bytes use the same content identity and omit source filenames", async () => {
  const files = bundleBytes(projected);
  for (const name of [
    "assessment.json", "structural.full.json", "admitted-proof.full.json",
    "proof-pack-admission.full.json", "manifest.json"
  ]) assert.match(files.get(name), new RegExp(projected.assessment.assessment_identity, "u"));
  const structuralFull = await readFile(
    new URL("../lib/contract-assessment.mjs", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(files.get("structural.full.json"), /contract\.json/u);
  assert.match(structuralFull, /canonical_sha256/u);
});
