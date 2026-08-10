import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CONTROLLED_VOCABULARY } from "../../vocabulary/cv.experimental.0.34.mjs";
import { validateAndResolveNativeContractV034 } from
  "../../lib/native-contract-carrier-v034.mjs";
import {
  evaluateVerificationProfileV034,
  validateProfileSemanticsV034
} from "../../lib/verification-profile-v034.mjs";
import {
  buildIdempotencyV2Fixture,
  referenceIdForRole
} from "../proof-packs/idempotency-v2-test-fixture.mjs";
import {
  responseEqualityOnlyFixture
} from "../proof-packs/idempotency-v2-adequacy.mjs";
import {
  assertFixedNegativeCorpus,
  removeFirstMissingRelationBranch
} from "../support/fixed-negative-corpus-test-helpers.mjs";
import {
  COVERAGE_WITNESS_INDEX_SCHEMA,
  PROOF_PACK_ADEQUACY_RUN_SCHEMA,
  PROOF_PACK_ADEQUACY_RUN_VERSION,
  PROOF_PACK_ADEQUACY_SCHEMA,
  PROOF_PACK_ADEQUACY_VERSION,
  assessAdequacyRun,
  assessCoverageWitnessIndex,
  assessNegativeFixtureSemanticDiscrimination,
  claimNestedSemanticDescriptors,
  evaluateNegativeContractFixtures,
  guaranteeDigest,
  loadProofPack,
  profileDigest,
  runLoadedProofPackAdequacy,
  runProofPackAdequacy,
  validateGenericCoverageDeclaration,
  validateProofPackAdequacy
} from "../support/proof-pack-adequacy.mjs";

const adequacy = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.idempotency.effect-nonduplication/2.0.0/adequacy.json",
  import.meta.url
), "utf8"));

test("coverage witnesses reject survival caused by an unrelated coupled patch", async () => {
  const packRoot = new URL(
    "../certification/profiles/proof.result-shape.conformance/1.0.0/", import.meta.url
  );
  const [profile, resultAdequacy, fixture] = await Promise.all([
    readFile(new URL("profile.json", packRoot), "utf8").then(JSON.parse),
    readFile(new URL("adequacy.json", packRoot), "utf8").then(JSON.parse),
    readFile(
      new URL("negative-fixtures/semantic-surface-variations.json", packRoot),
      "utf8"
    ).then(JSON.parse)
  ]);
  const surfaceId = "claim-operation-returns-result-proposition-operator";
  const weakened = structuredClone(profile);
  weakened.claim_patterns[0].proposition_template.operator = "reference:uses";
  weakened.satisfaction_expression = {
    any_of: profile.satisfaction_expression.all_of
  };
  const witness = {
    surface_id: surfaceId,
    weakening_class: "proposition_weakening",
    fixture_id: fixture.fixture_id,
    variant_id: surfaceId,
    weakened_profile_digest: profileDigest(weakened),
    profile_patches: [{
      op: "replace",
      path: "/claim_patterns/0/proposition_template/operator",
      value: "reference:uses"
    }, {
      op: "replace",
      path: "/satisfaction_expression",
      value: weakened.satisfaction_expression
    }]
  };

  const assessment = assessCoverageWitnessIndex(
    profile, resultAdequacy, [fixture], {
      schema_version:
        "controlled-contract-proof-pack-coverage-witness-index.experimental.v0.1",
      profile_digest: profileDigest(profile),
      witnesses: [witness]
    }
  );
  assert.equal(assessment.results[0].outcome, "survived");
  assert.ok(assessment.diagnostics.some((diagnostic) =>
    diagnostic.code === "coverage_witness_surface_not_load_bearing" &&
    diagnostic.profile_json_pointer ===
      "/claim_patterns/0/proposition_template/operator"
  ));
});

test("fixed negative coverage must discriminate the exact semantic surface it names", () => {
  const fixture = buildIdempotencyV2Fixture();
  const unrelatedClaim = fixture.contract.claims.find(
    ({ claim_id: id }) => id === "claim-operation-effect-resource"
  );
  fixture.contract.propositions.find(
    ({ proposition_id: id }) => id === unrelatedClaim.proposition_id
  ).operator = "reference:creates";
  fixture.input.claim_pattern_bindings = [{
    pattern_id: "operation-effect-resource",
    claim_id: unrelatedClaim.claim_id
  }];

  const claimIndex = fixture.profile.claim_patterns.findIndex(
    ({ pattern_id: id }) => id === "first-invocation"
  );
  const surface = {
    surface_id: "claim-first-invocation-proposition-operator",
    profile_json_pointer:
      `/claim_patterns/${claimIndex}/proposition_template/operator`,
    coverage: [{
      weakening_class: "proposition_weakening",
      negative_fixture_ids: ["reject-unrelated-semantic-defect"]
    }]
  };
  const negative = {
    fixture_id: "reject-unrelated-semantic-defect",
    covers: [{
      surface_id: surface.surface_id,
      weakening_class: "proposition_weakening"
    }],
    contract: fixture.contract,
    evaluation_input: fixture.input
  };

  assert.deepEqual(
    assessNegativeFixtureSemanticDiscrimination(
      fixture.profile,
      { guarantee_critical_profile_surfaces: [surface] },
      [negative]
    ),
    [{
      code: "negative_fixture_discrimination_missing",
      fixture_id: negative.fixture_id,
      surface_id: surface.surface_id,
      weakening_class: "proposition_weakening",
      reason: "no_valid_rebound_profile_admits_fixture"
    }]
  );

  const discriminating = buildIdempotencyV2Fixture();
  const targetedClaim = discriminating.contract.claims.find(
    ({ claim_id: id }) => id === "claim-first-invocation"
  );
  discriminating.contract.propositions.find(
    ({ proposition_id: id }) => id === targetedClaim.proposition_id
  ).operator = "reference:uses";
  discriminating.input.claim_pattern_bindings = [{
    pattern_id: "first-invocation",
    claim_id: targetedClaim.claim_id
  }];
  negative.contract = discriminating.contract;
  negative.evaluation_input = discriminating.input;
  assert.deepEqual(
    assessNegativeFixtureSemanticDiscrimination(
      discriminating.profile,
      { guarantee_critical_profile_surfaces: [surface] },
      [negative]
    ),
    []
  );
});

function addEvidence(contract, {
  id,
  subject,
  operator,
  mode = "unconditional",
  context = [],
  operands,
  modality = "MUST"
}) {
  contract.propositions.push({
    proposition_id: `prop-${id}`,
    subject_reference_id: subject,
    operator,
    applicability_context: { mode, operand_reference_ids: context },
    operands
  });
  contract.claims.push({
    claim_id: `claim-${id}`,
    kind: "evidence",
    modality,
    proposition_id: `prop-${id}`
  });
}

const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

test("the proof pack adequacy declaration is schema-valid and profile-bound", () => {
  const { profile } = buildIdempotencyV2Fixture();
  assert.equal(validateProofPackAdequacy(adequacy), true,
    JSON.stringify(validateProofPackAdequacy.errors));
  assert.equal(adequacy.schema_version, PROOF_PACK_ADEQUACY_VERSION);
  assert.equal(adequacy.profile_id, profile.profile_id);
  assert.equal(adequacy.profile_version, profile.profile_version);
  assert.equal(adequacy.profile_digest, profileDigest(profile));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));
});

test("all P1-P4 nested claim semantics have exact derived classifications", async () => {
  const packs = [
    ["proof.idempotency.effect-nonduplication/2.0.0", 156],
    ["proof.authorization.refusal-before-effects/1.0.0", 119],
    ["proof.atomicity.failure-boundary/1.0.0", 247],
    ["proof.authorization.failed-attempt-nonconsumption/1.0.0", 220]
  ];
  for (const [directory, expectedCount] of packs) {
    const base = new URL(`../certification/profiles/${directory}/`, import.meta.url);
    const [profile, declaration] = await Promise.all([
      readFile(new URL("profile.json", base), "utf8").then(JSON.parse),
      readFile(new URL("adequacy.json", base), "utf8").then(JSON.parse)
    ]);
    const descriptors = claimNestedSemanticDescriptors(profile);
    const classifications = new Map([
      ...declaration.guarantee_critical_profile_surfaces,
      ...declaration.noncritical_profile_surfaces
    ].map((surface) => [surface.profile_json_pointer, surface]));
    assert.equal(descriptors.length, expectedCount, directory);
    assert.deepEqual(descriptors.filter((descriptor) =>
      classifications.get(descriptor.profile_json_pointer)?.surface_id !==
        descriptor.surface_id
    ), [], directory);
    assert.doesNotThrow(() => validateGenericCoverageDeclaration(profile, declaration));
  }
});

test("nested claim taxonomy fails closed on deletion and field-domain drift", () => {
  const { profile } = buildIdempotencyV2Fixture();
  const missing = structuredClone(adequacy);
  const removedIndex = missing.noncritical_profile_surfaces.findIndex(
    ({ profile_json_pointer: pointer }) => pointer ===
      "/claim_patterns/0/required_by_stage"
  );
  assert.notEqual(removedIndex, -1);
  missing.noncritical_profile_surfaces.splice(removedIndex, 1);
  assert.throws(
    () => validateGenericCoverageDeclaration(profile, missing),
    { code: "nested_profile_surface_classification_missing" }
  );

  const drifted = structuredClone(profile);
  drifted.evaluation_stages = ["pre_dispatch", "post_delivery"];
  assert.throws(
    () => validateGenericCoverageDeclaration(drifted, adequacy),
    (error) => [
      "noncritical_surface_digest_mismatch", "noncritical_surface_reason_invalid"
    ].includes(error.code)
  );
});

test("the tracked adequacy schema is the executable schema", async () => {
  const trackedWitnessIndex = JSON.parse(await readFile(new URL(
    "../../schema/controlled-contract-proof-pack-coverage-witness-index.experimental.v0.1.schema.json",
    import.meta.url
  ), "utf8"));
  assert.deepEqual(trackedWitnessIndex, COVERAGE_WITNESS_INDEX_SCHEMA);
  const tracked = JSON.parse(await readFile(new URL(
    "../../schema/controlled-contract-proof-pack-adequacy.experimental.v0.1.schema.json",
    import.meta.url
  ), "utf8"));
  assert.deepEqual(tracked, PROOF_PACK_ADEQUACY_SCHEMA);
  const trackedRun = JSON.parse(await readFile(new URL(
    "../../schema/controlled-contract-proof-pack-adequacy-run.experimental.v0.1.schema.json",
    import.meta.url
  ), "utf8"));
  assert.deepEqual(trackedRun, PROOF_PACK_ADEQUACY_RUN_SCHEMA);
});

const packDirectory = fileURLToPath(new URL(
  "../certification/profiles/proof.idempotency.effect-nonduplication/2.0.0/",
  import.meta.url
));

async function writeTemporaryPack(profile, declaration = adequacy) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "proof-pack-adequacy-"));
  await Promise.all([
    writeFile(path.join(directory, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`),
    writeFile(path.join(directory, "adequacy.json"), `${JSON.stringify(declaration, null, 2)}\n`)
  ]);
  return directory;
}

test("the generic pack loader binds the canonical profile and adequacy declaration", async () => {
  const pack = await loadProofPack(packDirectory);
  assert.equal(pack.profile_digest, adequacy.profile_digest);
  assert.equal(pack.profile.profile_id, adequacy.profile_id);
  assert.equal(Object.isFrozen(pack), true);
  assert.equal(Object.isFrozen(pack.profile), true);
  assert.equal(Object.isFrozen(pack.adequacy), true);
  assert.match(pack.profile_sha256, /^[a-f0-9]{64}$/u);
  assert.match(pack.adequacy_sha256, /^[a-f0-9]{64}$/u);
  const result = await runProofPackAdequacy(packDirectory);
  assert.equal(result.passed, true);
  assert.equal(result.control_count, 21);
  assert.equal(result.negative_fixture_count, 46);
  assert.deepEqual(result.diagnostics, []);
});

test("idempotency fixed negatives kill every fully rebound critical weakening", async () => {
  const matrix = await assertFixedNegativeCorpus({
    packDirectory,
    expectedFixtureCount: 46,
    expectedSurfaceCount: 130,
    relationMutation: removeFirstMissingRelationBranch
  });
  assert.deepEqual(matrix, { fixture_count: 46, mutation_count: 42 });
});

test("static import.meta.url resources reject non-local or malformed literals", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "proof-pack-resource-refusal-"));
  const controlledRoot = path.join(repositoryRoot, "packages/controlled-contract");
  const modulePath = path.join(controlledRoot, "test/runtime-fixture/resource-refusal.mjs");
  const directory = path.join(controlledRoot, "profiles/resource-refusal/1.0.0");
  await Promise.all([
    mkdir(path.dirname(modulePath), { recursive: true }),
    mkdir(directory, { recursive: true })
  ]);
  const { profile } = buildIdempotencyV2Fixture();
  const guarantee = "static resources cannot escape the captured executable closure";
  const baseDeclaration = {
    schema_version: PROOF_PACK_ADEQUACY_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: profileDigest(profile),
    guarantee,
    guarantee_digest: guaranteeDigest(guarantee),
    required_positive_cases: ["positive-control"],
    required_mutant_kills: ["mutant-control"],
    required_profile_rejections: ["rejection-control"],
    explicit_exclusions: ["exclusion-control"],
    executable_module: "packages/controlled-contract/test/runtime-fixture/resource-refusal.mjs",
    executable_dependency_digests: []
  };
  await writeFile(
    path.join(directory, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`
  );
  const cases = [
    ["absolute", '"/tmp/outside.json"', "executable_resource_escaping"],
    ["file-url", '"file:///tmp/outside.json"', "executable_resource_escaping"],
    ["other-scheme", '"https://example.invalid/outside.json"',
      "executable_resource_escaping"],
    ["drive-form", '"C:/outside.json"', "executable_resource_escaping"],
    ["backslash", '"./outside\\\\resource.json"', "executable_resource_literal_invalid"],
    ["escaping-traversal", '"../../../../outside.json"',
      "executable_resource_escaping"],
    ["query", '"./resource.json?live=1"', "executable_resource_unsupported"],
    ["template", "`./resource.json`", "executable_resource_literal_invalid"],
    ["wrapped-base", '"./resource.json"', "executable_resource_literal_invalid",
      "(import.meta.url)"]
  ];
  for (const [label, literal, expectedCode, base = "import.meta.url"] of cases) {
    const source =
      `const resource = new URL(${literal}, ${base});\n` +
      "export async function runProofPackAdequacyControls() { return resource; }\n";
    const declaration = {
      ...baseDeclaration,
      executable_module_digest: createHash("sha256").update(source).digest("hex")
    };
    await Promise.all([
      writeFile(modulePath, source),
      writeFile(
        path.join(directory, "adequacy.json"),
        `${JSON.stringify(declaration, null, 2)}\n`
      )
    ]);
    await assert.rejects(
      loadProofPack(directory, { repositoryRoot }),
      (error) => error.code === expectedCode,
      label
    );
  }
});

test("captured relative import.meta.url resources are immutable after pack load", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "proof-pack-resource-snapshot-"));
  const controlledRoot = path.join(repositoryRoot, "packages/controlled-contract");
  const modulePath = path.join(
    controlledRoot, "test/runtime-fixture/resource-snapshot.mjs"
  );
  const resourcePath = path.join(
    controlledRoot, "test/runtime-fixture/resource-state.json"
  );
  const directory = path.join(controlledRoot, "profiles/resource-snapshot/1.0.0");
  await Promise.all([
    mkdir(path.dirname(modulePath), { recursive: true }),
    mkdir(directory, { recursive: true })
  ]);
  const { profile } = buildIdempotencyV2Fixture();
  const digest = profileDigest(profile);
  const guarantee = "captured relative resource bytes determine the adequacy result";
  const resourceSource = `${JSON.stringify({
    mutant_outcome: "passed",
    mutant_satisfaction: "satisfied"
  })}\n`;
  const replacementResourceSource = `${JSON.stringify({
    mutant_outcome: "killed",
    mutant_satisfaction: "unsatisfied"
  })}\n`;
  const moduleSource = `
import { readFile } from "node:fs/promises";
const resource = new URL("./resource-state.json", import.meta.url);
export async function runProofPackAdequacyControls() {
  const state = JSON.parse(await readFile(resource, "utf8"));
  return {
    schema_version: ${JSON.stringify(PROOF_PACK_ADEQUACY_RUN_VERSION)},
    profile_id: ${JSON.stringify(profile.profile_id)},
    profile_version: ${JSON.stringify(profile.profile_version)},
    profile_digest: ${JSON.stringify(digest)},
    guarantee_digest: ${JSON.stringify(guaranteeDigest(guarantee))},
    controls: [
      { control_id: "positive-control", category: "positive", implementation_outcome: "passed", profile_satisfaction: "satisfied" },
      { control_id: "mutant-control", category: "mutant", implementation_outcome: state.mutant_outcome, profile_satisfaction: state.mutant_satisfaction },
      { control_id: "rejection-control", category: "profile_rejection", implementation_outcome: "not_applicable", profile_satisfaction: "unsatisfied" },
      { control_id: "exclusion-control", category: "exclusion", implementation_outcome: "boundary_demonstrated", profile_satisfaction: "not_evaluated" }
    ]
  };
}
`;
  const declaration = {
    schema_version: PROOF_PACK_ADEQUACY_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: digest,
    guarantee,
    guarantee_digest: guaranteeDigest(guarantee),
    required_positive_cases: ["positive-control"],
    required_mutant_kills: ["mutant-control"],
    required_profile_rejections: ["rejection-control"],
    explicit_exclusions: ["exclusion-control"],
    executable_module: "packages/controlled-contract/test/runtime-fixture/resource-snapshot.mjs",
    executable_module_digest: createHash("sha256").update(moduleSource).digest("hex"),
    executable_dependency_digests: [{
      path: "packages/controlled-contract/test/runtime-fixture/resource-state.json",
      sha256: createHash("sha256").update(resourceSource).digest("hex")
    }]
  };
  await Promise.all([
    writeFile(modulePath, moduleSource),
    writeFile(resourcePath, resourceSource),
    writeFile(path.join(directory, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`),
    writeFile(
      path.join(directory, "adequacy.json"), `${JSON.stringify(declaration, null, 2)}\n`
    )
  ]);
  const loaded = await loadProofPack(directory, { repositoryRoot });
  await writeFile(resourcePath, replacementResourceSource);
  const result = await runLoadedProofPackAdequacy(loaded);
  assert.equal(result.passed, false);
  assert.ok(result.diagnostics.some(({ code }) => code === "adequacy_mutant_survived"));
  await assert.rejects(loadProofPack(directory, { repositoryRoot }), {
    code: "executable_dependency_digest_mismatch"
  });
});

test("adequacy and evaluation share one immutable pack snapshot", async () => {
  const { profile } = buildIdempotencyV2Fixture();
  const directory = await writeTemporaryPack(profile);
  const loaded = await loadProofPack(directory);

  const weakened = structuredClone(profile);
  weakened.claim_patterns.find(({ pattern_id: patternId }) =>
    patternId === "idempotent-effect"
  ).proposition_template.applicability_context = {
    mode: "unconditional",
    operand_roles: []
  };
  const changedDeclaration = {
    ...structuredClone(adequacy),
    profile_digest: profileDigest(weakened)
  };
  await Promise.all([
    writeFile(path.join(directory, "profile.json"), `${JSON.stringify(weakened, null, 2)}\n`),
    writeFile(
      path.join(directory, "adequacy.json"),
      `${JSON.stringify(changedDeclaration, null, 2)}\n`
    )
  ]);

  const snapshotResult = await runLoadedProofPackAdequacy(loaded);
  assert.equal(snapshotResult.passed, true);
  assert.equal(snapshotResult.pack.profile_digest, profileDigest(profile));
  await assert.rejects(runLoadedProofPackAdequacy({ ...loaded }), {
    code: "proof_pack_snapshot_unrecognized"
  });

  await assert.rejects(runProofPackAdequacy(directory), {
    code: "critical_surface_digest_mismatch"
  });
});

test("adequacy executes the verified module bytes captured by the pack snapshot", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "proof-pack-snapshot-root-"));
  const controlledRoot = path.join(repositoryRoot, "packages/controlled-contract");
  const modulePath = path.join(
    controlledRoot, "test/runtime-fixture/captured-adequacy.mjs"
  );
  const dependencyPath = path.join(
    controlledRoot, "test/runtime-fixture/captured-adequacy-dependency.mjs"
  );
  const directory = path.join(controlledRoot, "profiles/captured-proof/1.0.0");
  await Promise.all([
    mkdir(path.dirname(modulePath), { recursive: true }),
    mkdir(directory, { recursive: true })
  ]);
  const { profile } = buildIdempotencyV2Fixture();
  const digest = profileDigest(profile);
  const guarantee = "captured executable bytes determine the adequacy result";
  const controls = (mutantOutcome, mutantSatisfaction) => JSON.stringify({
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: digest,
    guarantee_digest: guaranteeDigest(guarantee),
    controls: [
      {
        control_id: "positive-control",
        category: "positive",
        implementation_outcome: "passed",
        profile_satisfaction: "satisfied"
      },
      {
        control_id: "mutant-control",
        category: "mutant",
        implementation_outcome: mutantOutcome,
        profile_satisfaction: mutantSatisfaction
      },
      {
        control_id: "rejection-control",
        category: "profile_rejection",
        implementation_outcome: "not_applicable",
        profile_satisfaction: "unsatisfied"
      },
      {
        control_id: "exclusion-control",
        category: "exclusion",
        implementation_outcome: "boundary_demonstrated",
        profile_satisfaction: "not_evaluated"
      }
    ]
  });
  const capturedDependencySource =
    "export const mutantOutcome = 'passed';\n" +
    "export const mutantSatisfaction = 'satisfied';\n";
  const replacementDependencySource =
    "export const mutantOutcome = 'killed';\n" +
    "export const mutantSatisfaction = 'unsatisfied';\n";
  const capturedSource =
    "import { mutantOutcome, mutantSatisfaction } from " +
    "'./captured-adequacy-dependency.mjs';\n" +
    `const observations = ${controls("passed", "satisfied")};\n` +
    "const mutant = observations.controls.find(({ control_id: id }) => " +
    "id === 'mutant-control');\n" +
    "mutant.implementation_outcome = mutantOutcome;\n" +
    "mutant.profile_satisfaction = mutantSatisfaction;\n" +
    "export async function runProofPackAdequacyControls() { " +
    "return structuredClone(observations); }\n";
  const replacementSource =
    `const observations = ${controls("killed", "unsatisfied")};\n` +
    "export async function runProofPackAdequacyControls() { " +
    "return structuredClone(observations); }\n";
  const declaration = {
    schema_version: PROOF_PACK_ADEQUACY_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: digest,
    guarantee,
    guarantee_digest: guaranteeDigest(guarantee),
    required_positive_cases: ["positive-control"],
    required_mutant_kills: ["mutant-control"],
    required_profile_rejections: ["rejection-control"],
    explicit_exclusions: ["exclusion-control"],
    executable_module: "packages/controlled-contract/test/runtime-fixture/captured-adequacy.mjs",
    executable_module_digest: createHash("sha256").update(capturedSource).digest("hex"),
    executable_dependency_digests: [{
      path: "packages/controlled-contract/test/runtime-fixture/captured-adequacy-dependency.mjs",
      sha256: createHash("sha256").update(capturedDependencySource).digest("hex")
    }]
  };
  await Promise.all([
    writeFile(modulePath, capturedSource),
    writeFile(dependencyPath, capturedDependencySource),
    writeFile(path.join(directory, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`),
    writeFile(path.join(directory, "adequacy.json"), `${JSON.stringify(declaration, null, 2)}\n`)
  ]);
  const loaded = await loadProofPack(directory, { repositoryRoot });
  await Promise.all([
    writeFile(modulePath, replacementSource),
    writeFile(dependencyPath, replacementDependencySource)
  ]);

  const result = await runLoadedProofPackAdequacy(loaded);
  assert.equal(result.passed, false);
  assert.ok(result.diagnostics.some(({ code, control_id: controlId }) =>
    code === "adequacy_mutant_survived" && controlId === "mutant-control"
  ));
  await assert.rejects(loadProofPack(directory, { repositoryRoot }), {
    code: "executable_module_digest_mismatch"
  });

  await Promise.all([
    writeFile(modulePath, capturedSource),
    writeFile(dependencyPath, capturedDependencySource)
  ]);
  const dependencyLoaded = await loadProofPack(directory, { repositoryRoot });
  await writeFile(dependencyPath, replacementDependencySource);
  const dependencyResult = await runLoadedProofPackAdequacy(dependencyLoaded);
  assert.equal(dependencyResult.passed, false);
  assert.ok(dependencyResult.diagnostics.some(({ code, control_id: controlId }) =>
    code === "adequacy_mutant_survived" && controlId === "mutant-control"
  ));
  await assert.rejects(loadProofPack(directory, { repositoryRoot }), {
    code: "executable_dependency_digest_mismatch"
  });

  await writeFile(dependencyPath, capturedDependencySource);
  const undeclaredTransitiveSource =
    "import './undeclared-transitive.mjs';\n" + capturedDependencySource;
  const undeclaredDeclaration = structuredClone(declaration);
  undeclaredDeclaration.executable_dependency_digests[0].sha256 =
    createHash("sha256").update(undeclaredTransitiveSource).digest("hex");
  await Promise.all([
    writeFile(dependencyPath, undeclaredTransitiveSource),
    writeFile(
      path.join(directory, "adequacy.json"),
      `${JSON.stringify(undeclaredDeclaration, null, 2)}\n`
    ),
    writeFile(
      path.join(controlledRoot, "test/runtime-fixture/undeclared-transitive.mjs"),
      "export const presentButUndeclared = true;\n"
    )
  ]);
  await assert.rejects(loadProofPack(directory, { repositoryRoot }), {
    code: "executable_dependency_undeclared"
  });

  const dynamicSource =
    "export async function runProofPackAdequacyControls() {\n" +
    "  return import('./captured-adequacy-dependency.mjs');\n}\n";
  const dynamicDeclaration = {
    ...structuredClone(declaration),
    executable_module_digest: createHash("sha256").update(dynamicSource).digest("hex"),
    executable_dependency_digests: []
  };
  await Promise.all([
    writeFile(modulePath, dynamicSource),
    writeFile(dependencyPath, capturedDependencySource),
    writeFile(
      path.join(directory, "adequacy.json"),
      `${JSON.stringify(dynamicDeclaration, null, 2)}\n`
    )
  ]);
  await assert.rejects(loadProofPack(directory, { repositoryRoot }), {
    code: "executable_dynamic_import_unsupported"
  });

  const escapingSource =
    "import '../../../../outside-snapshot.mjs';\n" +
    "export async function runProofPackAdequacyControls() { return {}; }\n";
  const escapingDeclaration = {
    ...structuredClone(declaration),
    executable_module_digest: createHash("sha256").update(escapingSource).digest("hex"),
    executable_dependency_digests: []
  };
  await Promise.all([
    writeFile(modulePath, escapingSource),
    writeFile(
      path.join(directory, "adequacy.json"),
      `${JSON.stringify(escapingDeclaration, null, 2)}\n`
    )
  ]);
  await assert.rejects(loadProofPack(directory, { repositoryRoot }), {
    code: "executable_import_escaping"
  });

  await Promise.all([
    writeFile(modulePath, capturedSource),
    writeFile(
      path.join(directory, "adequacy.json"),
      `${JSON.stringify(declaration, null, 2)}\n`
    )
  ]);
  const deletedSourceLoaded = await loadProofPack(directory, { repositoryRoot });
  await Promise.all([rm(modulePath), rm(dependencyPath)]);
  const deletedSourceResult = await runLoadedProofPackAdequacy(deletedSourceLoaded);
  assert.equal(deletedSourceResult.passed, false);
  assert.ok(deletedSourceResult.diagnostics.some(({ code, control_id: controlId }) =>
    code === "adequacy_mutant_survived" && controlId === "mutant-control"
  ));
});

test("the pack loader refuses missing, stale, or orphaned adequacy", async () => {
  const { profile } = buildIdempotencyV2Fixture();
  const missingDirectory = await mkdtemp(path.join(os.tmpdir(), "proof-pack-missing-"));
  await writeFile(
    path.join(missingDirectory, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`
  );
  await assert.rejects(loadProofPack(missingDirectory), { code: "adequacy_missing" });

  const weakened = structuredClone(profile);
  weakened.claim_patterns.find(
    ({ verification_methods: methods }) => methods
  ).verification_methods.reverse();
  const staleDirectory = await writeTemporaryPack(weakened);
  await assert.rejects(loadProofPack(staleDirectory), {
    code: "adequacy_profile_digest_mismatch"
  });

  const orphaned = structuredClone(adequacy);
  orphaned.executable_module =
    "packages/controlled-contract/test/runtime-fixture/absent-adequacy-module.mjs";
  const orphanedDirectory = await writeTemporaryPack(profile, orphaned);
  await assert.rejects(loadProofPack(orphanedDirectory), {
    code: "executable_module_missing"
  });

  const staleExecutable = {
    ...structuredClone(adequacy),
    executable_module_digest: "0".repeat(64)
  };
  const staleExecutableDirectory = await writeTemporaryPack(profile, staleExecutable);
  await assert.rejects(loadProofPack(staleExecutableDirectory), {
    code: "executable_module_digest_mismatch"
  });

  const staleDependency = structuredClone(adequacy);
  staleDependency.executable_dependency_digests[0].sha256 = "0".repeat(64);
  const staleDependencyDirectory = await writeTemporaryPack(profile, staleDependency);
  await assert.rejects(loadProofPack(staleDependencyDirectory), {
    code: "executable_dependency_digest_mismatch"
  });

});

test("the pack loader confines executable modules to the real controlled-contract tree", async () => {
  const { profile } = buildIdempotencyV2Fixture();
  const traversing = {
    ...structuredClone(adequacy),
    executable_module: "packages/controlled-contract/../../wiki/planted-adequacy.mjs"
  };
  const traversingDirectory = await writeTemporaryPack(profile, traversing);
  await assert.rejects(loadProofPack(traversingDirectory), {
    code: "executable_module_parent_segment_forbidden"
  });

  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "proof-pack-root-"));
  const controlledRoot = path.join(repositoryRoot, "packages/controlled-contract");
  const outsideRoot = path.join(repositoryRoot, "outside");
  await Promise.all([
    mkdir(controlledRoot, { recursive: true }),
    mkdir(outsideRoot, { recursive: true })
  ]);
  const outsideModule = path.join(outsideRoot, "adequacy.mjs");
  await writeFile(outsideModule, "export const outside = true;\n");
  await symlink(outsideModule, path.join(controlledRoot, "linked-adequacy.mjs"));
  const linked = {
    ...structuredClone(adequacy),
    executable_module: "packages/controlled-contract/linked-adequacy.mjs"
  };
  delete linked.negative_contract_fixtures;
  delete linked.coverage_witness_index;
  delete linked.guarantee_critical_profile_surfaces;
  delete linked.noncritical_profile_surfaces;
  const linkedDirectory = await writeTemporaryPack(profile, linked);
  await assert.rejects(loadProofPack(linkedDirectory, { repositoryRoot }), {
    code: "executable_module_outside_controlled_contract"
  });
});

test("the generic assessor fails closed on skipped and undeclared controls", async () => {
  const pack = await loadProofPack(packDirectory);
  const baseline = await runProofPackAdequacy(packDirectory);
  const skipped = structuredClone(baseline.observations);
  skipped.controls = skipped.controls.slice(1);
  assert.ok(assessAdequacyRun(pack, skipped).some(
    ({ code }) => code === "adequacy_control_not_executed"
  ));
  const extra = structuredClone(baseline.observations);
  extra.controls.push({
    control_id: "undeclared-success",
    category: "positive",
    implementation_outcome: "passed",
    profile_satisfaction: "satisfied"
  });
  assert.ok(assessAdequacyRun(pack, extra).some(
    ({ code }) => code === "adequacy_control_undeclared"
  ));
  const empty = {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: pack.profile.profile_id,
    profile_version: pack.profile.profile_version,
    profile_digest: pack.profile_digest,
    guarantee_digest: pack.adequacy.guarantee_digest,
    controls: []
  };
  assert.ok(assessAdequacyRun(pack, empty).some(
    ({ code }) => code === "adequacy_run_schema_invalid"
  ));
});

test("direct negative-fixture evaluation is total for malformed caller inputs", () => {
  const profile = buildIdempotencyV2Fixture().profile;
  for (const fixtures of [null, undefined, {}, "fixtures"]) {
    assert.deepEqual(evaluateNegativeContractFixtures(profile, fixtures), {
      diagnostics: [{
        code: "negative_fixtures_malformed",
        reason: "fixtures_must_be_array",
        actual_type: fixtures === null ? "null" : typeof fixtures
      }],
      results: []
    });
  }
  const malformed = evaluateNegativeContractFixtures(profile, [null, 7, {}]);
  assert.deepEqual(malformed.results, [0, 1, 2].map((index) => ({
    fixture_id: `fixture-index-${index}`, outcome: "malformed"
  })));
  assert.deepEqual(malformed.diagnostics, [0, 1, 2].map((index) => ({
    code: "negative_fixture_malformed",
    fixture_id: `fixture-index-${index}`,
    fixture_index: index,
    reason: "fixture_shape_invalid"
  })));
});

test("a guarantee change must update both its digest and executable controls", async () => {
  const { profile } = buildIdempotencyV2Fixture();
  const changed = {
    ...structuredClone(adequacy),
    guarantee: `${adequacy.guarantee} This also proves concurrent replay safety.`
  };
  const staleDirectory = await writeTemporaryPack(profile, changed);
  await assert.rejects(loadProofPack(staleDirectory), {
    code: "adequacy_guarantee_digest_mismatch"
  });

  changed.guarantee_digest = guaranteeDigest(changed.guarantee);
  const redigestedDirectory = await writeTemporaryPack(profile, changed);
  const result = await runProofPackAdequacy(redigestedDirectory);
  assert.equal(result.passed, false);
  assert.ok(result.diagnostics.some(({ code, field }) =>
    code === "adequacy_run_binding_mismatch" && field === "guarantee_digest"
  ));
});

function removeVerifiedBehavior(profile, {
  behaviorPatternId,
  verificationPatternId,
  relationPatternId,
  bindingPatternId = null
}) {
  const removedPatternIds = new Set([
    behaviorPatternId, verificationPatternId, relationPatternId, bindingPatternId
  ].filter(Boolean));
  profile.claim_patterns = profile.claim_patterns.filter(
    ({ pattern_id: patternId }) => !removedPatternIds.has(patternId)
  );
  profile.relation_patterns = profile.relation_patterns.filter(
    ({ pattern_id: patternId }) => !removedPatternIds.has(patternId)
  );
  profile.reference_binding_patterns = profile.reference_binding_patterns.filter(
    ({ pattern_id: patternId }) => !removedPatternIds.has(patternId)
  );
  profile.falsifier_condition_bindings = profile.falsifier_condition_bindings.filter(
    ({ relation_pattern_id: patternId }) => patternId !== relationPatternId
  );
  profile.satisfaction_expression.all_of = profile.satisfaction_expression.all_of.filter(
    ({ pattern: patternId }) => !removedPatternIds.has(patternId)
  );
  return profile;
}

test("stale critical-surface bindings refuse re-digested profile weakenings", async () => {
  const { profile } = buildIdempotencyV2Fixture();
  const weakenings = {
    "remove-final-state-equality": (candidate) => removeVerifiedBehavior(candidate, {
      behaviorPatternId: "idempotent-effect",
      verificationPatternId: "idempotency-equivalence-verification",
      relationPatternId: "verification-target-equivalence",
      bindingPatternId: "distinct-effect-state-binding"
    }),
    "remove-pre-second-equality": (candidate) => removeVerifiedBehavior(candidate, {
      behaviorPatternId: "pre-second-state-equality",
      verificationPatternId: "pre-second-equality-verification",
      relationPatternId: "verification-target-pre-second-equality"
    }),
    "make-final-equality-unconditional": (candidate) => {
      candidate.claim_patterns.find(({ pattern_id: id }) =>
        id === "idempotent-effect"
      ).proposition_template.applicability_context = {
        mode: "unconditional", operand_roles: []
      };
      return candidate;
    },
    "make-final-equality-vacuous": (candidate) => {
      candidate.claim_patterns.find(({ pattern_id: id }) =>
        id === "idempotent-effect"
      ).proposition_template.applicability_context = {
        mode: "unless", operand_roles: ["second_invocation"]
      };
      return candidate;
    },
    "mis-scope-pre-second-equality": (candidate) => {
      candidate.claim_patterns.find(({ pattern_id: id }) =>
        id === "pre-second-state-equality"
      ).proposition_template.applicability_context = {
        mode: "after", operand_roles: ["first_invocation"]
      };
      return candidate;
    },
    "open-proof-population": (candidate) => {
      candidate.collection_patterns.find(({ pattern_id: id }) =>
        id === "proof-population"
      ).candidate_quantifier = "any";
      return candidate;
    },
    "collapse-invocation-distinctness": (candidate) => {
      candidate.distinct_reference_role_sets = candidate.distinct_reference_role_sets.filter(
        ({ roles }) => !roles.includes("first_invocation")
      );
      return candidate;
    }
  };
  for (const [name, mutate] of Object.entries(weakenings)) {
    const weakened = mutate(structuredClone(profile));
    assert.deepEqual(validateProfileSemanticsV034(weakened), [], name);
    const declaration = {
      ...structuredClone(adequacy),
      profile_digest: profileDigest(weakened)
    };
    const directory = await writeTemporaryPack(weakened, declaration);
    await assert.rejects(runProofPackAdequacy(directory), {
      code: "critical_surface_digest_mismatch"
    }, name);
  }
});

test("v0.34 exposes whether each declared algebraic trait is mechanically enforced", () => {
  for (const operator of CONTROLLED_VOCABULARY.operators) {
    assert.ok(operator.mechanical_support);
    for (const trait of ["symmetric", "transitive", "irreflexive"]) {
      const support = operator.mechanical_support.algebraic_traits[trait];
      assert.ok(["declared_only", "enforced", "not_applicable"].includes(support));
      assert.equal(operator.algebraic_traits[trait], support !== "not_applicable");
    }
  }
  assert.equal(CONTROLLED_VOCABULARY.operators.find(
    ({ term }) => term === "reference:equals"
  ).mechanical_support.algebraic_traits.transitive, "enforced");
  assert.equal(CONTROLLED_VOCABULARY.operators.find(
    ({ term }) => term === "reference:precedes"
  ).mechanical_support.algebraic_traits.transitive, "enforced");
  assert.equal(CONTROLLED_VOCABULARY.operators.find(
    ({ term }) => term === "reference:precedes"
  ).mechanical_support.inverse, "enforced");
});

test("v0.34 rejects cycles across precedes and follows declarations", () => {
  const contract = buildIdempotencyV2Fixture().contract;
  for (const id of ["ref-order-a", "ref-order-b", "ref-order-c"]) {
    contract.references.push({
      reference_id: id,
      type_term: "cc:event",
      identity: { kind: "profile_term", term: id }
    });
  }
  addEvidence(contract, {
    id: "order-a-before-b",
    subject: "ref-order-a",
    operator: "reference:precedes",
    operands: [ref("ref-order-b")]
  });
  addEvidence(contract, {
    id: "order-b-before-c",
    subject: "ref-order-b",
    operator: "reference:precedes",
    operands: [ref("ref-order-c")]
  });
  addEvidence(contract, {
    id: "order-a-after-c",
    subject: "ref-order-a",
    operator: "reference:follows",
    operands: [ref("ref-order-c")]
  });

  const result = validateAndResolveNativeContractV034(contract);
  assert.ok(result.diagnostics.some(({ code, reason, operators }) =>
    code === "direct_proposition_contradiction" &&
      reason === "ordering_cycle" &&
      operators.includes("reference:precedes") &&
      operators.includes("reference:follows")
  ));

  contract.propositions.find(
    ({ proposition_id: propositionId }) => propositionId === "prop-order-a-after-c"
  ).subject_reference_id = "ref-order-c";
  contract.propositions.find(
    ({ proposition_id: propositionId }) => propositionId === "prop-order-a-after-c"
  ).operands = [ref("ref-order-a")];
  assert.equal(validateAndResolveNativeContractV034(contract).diagnostics.some(
    ({ reason }) => reason === "ordering_cycle"
  ), false);
});

test("v0.34 rejects symmetric and transitive equality contradictions", () => {
  const symmetric = buildIdempotencyV2Fixture().contract;
  addEvidence(symmetric, {
    id: "reverse-not-equal",
    subject: referenceIdForRole("state_after_first"),
    operator: "reference:not_equals",
    mode: "after",
    context: [referenceIdForRole("second_invocation")],
    operands: [ref(referenceIdForRole("state_after_second"))]
  });
  const symmetricResult = validateAndResolveNativeContractV034(symmetric);
  assert.ok(symmetricResult.diagnostics.some(({ code, reason }) =>
    code === "direct_proposition_contradiction" && reason === "opposed_operator"
  ));

  const transitive = buildIdempotencyV2Fixture().contract;
  for (const id of ["ref-triangle-a", "ref-triangle-b", "ref-triangle-c"]) {
    transitive.references.push({
      reference_id: id,
      type_term: "cc:state",
      identity: { kind: "profile_term", term: id }
    });
  }
  addEvidence(transitive, {
    id: "triangle-ab",
    subject: "ref-triangle-a",
    operator: "reference:equals",
    operands: [ref("ref-triangle-b")]
  });
  addEvidence(transitive, {
    id: "triangle-ac",
    subject: "ref-triangle-a",
    operator: "reference:equals",
    operands: [ref("ref-triangle-c")]
  });
  addEvidence(transitive, {
    id: "triangle-bc-not",
    subject: "ref-triangle-b",
    operator: "reference:not_equals",
    operands: [ref("ref-triangle-c")]
  });
  const transitiveResult = validateAndResolveNativeContractV034(transitive);
  assert.ok(transitiveResult.diagnostics.some(({ code, reason }) =>
    code === "direct_proposition_contradiction" &&
      reason === "transitive_opposed_operator"
  ));

  const multiOperand = buildIdempotencyV2Fixture().contract;
  multiOperand.references.push({
    reference_id: "ref-additional-peer",
    type_term: "cc:resource",
    identity: { kind: "profile_term", term: "additional-peer" }
  });
  addEvidence(multiOperand, {
    id: "multi-symmetric-positive",
    subject: referenceIdForRole("effect_subject"),
    operator: "reference:conflicts_with",
    operands: [
      ref(referenceIdForRole("operation")),
      ref("ref-additional-peer")
    ]
  });
  addEvidence(multiOperand, {
    id: "multi-symmetric-prohibited",
    subject: referenceIdForRole("operation"),
    operator: "reference:conflicts_with",
    operands: [ref(referenceIdForRole("effect_subject"))],
    modality: "MUST_NOT"
  });
  assert.ok(validateAndResolveNativeContractV034(multiOperand).diagnostics.some(
    ({ reason }) => reason === "opposed_modality"
  ));
});

test("v0.34 rejects prohibited complements and incompatible exact/range values", () => {
  const prohibited = buildIdempotencyV2Fixture().contract;
  addEvidence(prohibited, {
    id: "forbid-equal",
    subject: referenceIdForRole("state_after_first"),
    operator: "reference:equals",
    operands: [ref(referenceIdForRole("state_after_second"))],
    modality: "MUST_NOT"
  });
  addEvidence(prohibited, {
    id: "forbid-not-equal",
    subject: referenceIdForRole("state_after_first"),
    operator: "reference:not_equals",
    operands: [ref(referenceIdForRole("state_after_second"))],
    modality: "MUST_NOT"
  });
  assert.ok(validateAndResolveNativeContractV034(prohibited).diagnostics.some(
    ({ reason }) => reason === "opposed_operator"
  ));

  const cardinality = buildIdempotencyV2Fixture().contract;
  const observation = referenceIdForRole("observation_after_first");
  const invocation = referenceIdForRole("first_invocation");
  addEvidence(cardinality, {
    id: "exact-cardinality",
    subject: observation,
    operator: "number:equals",
    mode: "after",
    context: [invocation],
    operands: [{ kind: "number", value: 1 }]
  });
  addEvidence(cardinality, {
    id: "range-cardinality",
    subject: observation,
    operator: "range:has_cardinality",
    mode: "after",
    context: [invocation],
    operands: [{ kind: "range", minimum: 10, maximum: 20 }]
  });
  assert.ok(validateAndResolveNativeContractV034(cardinality).diagnostics.some(
    ({ reason }) => reason === "cross_operator_constraint"
  ));

  for (const operator of [
    "number:emits", "number:equals", "number:has_value",
    "number:matches", "number:returns"
  ]) {
    const value = buildIdempotencyV2Fixture().contract;
    addEvidence(value, {
      id: `exact-${operator.slice(7).replaceAll("_", "-")}`,
      subject: observation,
      operator,
      operands: [{ kind: "number", value: 99 }]
    });
    addEvidence(value, {
      id: `range-${operator.slice(7).replaceAll("_", "-")}`,
      subject: observation,
      operator: "range:has_range",
      operands: [{ kind: "range", minimum: 0, maximum: 1 }]
    });
    assert.ok(validateAndResolveNativeContractV034(value).diagnostics.some(
      ({ reason }) => reason === "cross_operator_constraint"
    ), `${operator} escaped its declared value-range constraint`);
  }
});

test("v0.34 rejects exact cardinality below the declared member population", () => {
  const contract = buildIdempotencyV2Fixture().contract;
  contract.references.push({
    reference_id: "ref-declared-population",
    type_term: "cc:scope",
    identity: { kind: "profile_term", term: "declared-population" }
  });
  for (const suffix of ["a", "b", "c"]) contract.references.push({
    reference_id: `ref-declared-member-${suffix}`,
    type_term: "cc:resource",
    identity: { kind: "profile_term", term: `declared-member-${suffix}` }
  });
  addEvidence(contract, {
    id: "declared-population-cardinality",
    subject: "ref-declared-population",
    operator: "number:has_cardinality",
    operands: [{ kind: "number", value: 2 }]
  });
  addEvidence(contract, {
    id: "declared-population-contains",
    subject: "ref-declared-population",
    operator: "reference:contains",
    operands: [ref("ref-declared-member-a"), ref("ref-declared-member-b")]
  });
  addEvidence(contract, {
    id: "declared-population-third-member",
    subject: "ref-declared-member-c",
    operator: "reference:member_of",
    operands: [ref("ref-declared-population")]
  });

  const result = validateAndResolveNativeContractV034(contract);
  const diagnostic = result.diagnostics.find(
    ({ constraint_id: constraintId }) =>
      constraintId === "exact-cardinality-not-below-declared-membership"
  );
  assert.ok(diagnostic);
  assert.equal(diagnostic.reason, "cross_operator_constraint");
  assert.equal(diagnostic.declared_member_count, 3);
  assert.equal(diagnostic.exact_cardinality, 2);

  contract.propositions.find(
    ({ proposition_id: propositionId }) =>
      propositionId === "prop-declared-population-cardinality"
  ).operands[0].value = 3;
  assert.equal(validateAndResolveNativeContractV034(contract).diagnostics.some(
    ({ constraint_id: constraintId }) =>
      constraintId === "exact-cardinality-not-below-declared-membership"
  ), false);
});

test("v0.34 unconditional cardinality includes scoped membership declarations", () => {
  const contract = buildIdempotencyV2Fixture().contract;
  contract.references.push({
    reference_id: "ref-scoped-population",
    type_term: "cc:scope",
    identity: { kind: "profile_term", term: "scoped-population" }
  });
  for (const suffix of ["a", "b", "c"]) contract.references.push({
    reference_id: `ref-scoped-member-${suffix}`,
    type_term: "cc:resource",
    identity: { kind: "profile_term", term: `scoped-member-${suffix}` }
  });
  addEvidence(contract, {
    id: "scoped-population-cardinality",
    subject: "ref-scoped-population",
    operator: "number:has_cardinality",
    operands: [{ kind: "number", value: 2 }]
  });
  addEvidence(contract, {
    id: "scoped-population-members",
    subject: "ref-scoped-population",
    operator: "reference:contains",
    operands: [ref("ref-scoped-member-a"), ref("ref-scoped-member-b")]
  });
  addEvidence(contract, {
    id: "scoped-population-third-member",
    subject: "ref-scoped-member-c",
    operator: "reference:member_of",
    mode: "after",
    context: [referenceIdForRole("second_invocation")],
    operands: [ref("ref-scoped-population")]
  });

  assert.ok(validateAndResolveNativeContractV034(contract).diagnostics.some(
    ({ constraint_id: constraintId, declared_member_count: memberCount }) =>
      constraintId === "exact-cardinality-not-below-declared-membership" &&
      memberCount === 3
  ));

  contract.propositions.find(
    ({ proposition_id: propositionId }) =>
      propositionId === "prop-scoped-population-cardinality"
  ).applicability_context = {
      mode: "during",
      operand_reference_ids: [referenceIdForRole("first_invocation")]
    };
  assert.equal(validateAndResolveNativeContractV034(contract).diagnostics.some(
    ({ constraint_id: constraintId }) =>
      constraintId === "exact-cardinality-not-below-declared-membership"
  ), false);
});

test("v0.34 equality classes participate in complement contradiction checks", () => {
  const contract = buildIdempotencyV2Fixture().contract;
  for (const suffix of ["allowed", "forbidden", "bridge", "population"]) {
    contract.references.push({
      reference_id: `ref-equality-${suffix}`,
      type_term: suffix === "population" ? "cc:scope" : "cc:state",
      identity: { kind: "profile_term", term: `equality-${suffix}` }
    });
  }
  addEvidence(contract, {
    id: "equality-allowed-member",
    subject: "ref-equality-allowed",
    operator: "reference:member_of",
    operands: [ref("ref-equality-population")]
  });
  addEvidence(contract, {
    id: "equality-forbidden-member",
    subject: "ref-equality-forbidden",
    operator: "reference:member_of",
    operands: [ref("ref-equality-population")],
    modality: "MUST_NOT"
  });
  addEvidence(contract, {
    id: "equality-allowed-to-bridge",
    subject: "ref-equality-allowed",
    operator: "reference:equals",
    operands: [ref("ref-equality-bridge")]
  });
  addEvidence(contract, {
    id: "equality-bridge-to-forbidden",
    subject: "ref-equality-bridge",
    operator: "reference:equals",
    operands: [ref("ref-equality-forbidden")]
  });

  assert.ok(validateAndResolveNativeContractV034(contract).diagnostics.some(
    ({ code, reason, claim_ids: claimIds }) =>
      code === "direct_proposition_contradiction" &&
      reason === "opposed_modality" &&
      claimIds.includes("claim-equality-allowed-member") &&
      claimIds.includes("claim-equality-forbidden-member")
  ));
});

test("v0.34 binds each verification relation to its intended falsifier condition", () => {
  const { profile } = buildIdempotencyV2Fixture();
  const equality = profile.claim_patterns.find(
    ({ pattern_id: id }) => id === "idempotency-equivalence-verification"
  );
  const continuity = profile.claim_patterns.find(
    ({ pattern_id: id }) => id === "pre-second-equality-verification"
  );
  [equality.falsifying_proposition_template.applicability_context,
    continuity.falsifying_proposition_template.applicability_context] = [
    continuity.falsifying_proposition_template.applicability_context,
    equality.falsifying_proposition_template.applicability_context
  ];
  const diagnostics = validateProfileSemanticsV034(profile);
  assert.ok(diagnostics.some(({ reasons = [] }) =>
    reasons.includes("falsifier_condition_differs")
  ));
});

test("v0.34 profiles fail closed on definitions or complete-artifact drift", () => {
  for (const field of [
    "vocabulary_definitions_digest", "vocabulary_complete_digest"
  ]) {
    const fixture = buildIdempotencyV2Fixture();
    fixture.profile[field] = "0".repeat(64);
    const result = evaluateVerificationProfileV034({
      contract: fixture.contract,
      profile: fixture.profile,
      evaluation_input: fixture.input
    });
    assert.equal(result.satisfaction, "invalid");
    assert.ok(result.diagnostics.some(({ code }) =>
      code === "verification_profile_schema_invalid"
    ));
  }
});

test("a competing overlapping closed proof population prevents satisfaction", () => {
  const { contract, profile, input } = buildIdempotencyV2Fixture({
    mutate_contract(candidate) {
      candidate.collections.push({
        collection_id: "set-polluted-proof-population",
        collection_kind: "closed_set",
        purpose: "profile_proof_population",
        member_claim_ids: candidate.collections.find(
          ({ collection_kind: kind }) => kind === "closed_set"
        ).member_claim_ids.slice(0, -1)
      });
    }
  });
  const result = evaluateVerificationProfileV034({
    contract,
    profile,
    evaluation_input: input
  });
  assert.equal(result.satisfaction, "unsatisfied");
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "collection_noncovering_population_overlap"
  ));
});

test("a disjoint same-purpose closed population also prevents satisfaction", () => {
  const { contract, profile, input } = buildIdempotencyV2Fixture({
    mutate_contract(candidate) {
      addEvidence(candidate, {
        id: "disjoint-claim",
        subject: referenceIdForRole("operation"),
        operator: "reference:within_scope",
        operands: [ref(referenceIdForRole("effect_subject"))]
      });
      candidate.collections.push({
        collection_id: "set-disjoint-proof-population",
        collection_kind: "closed_set",
        purpose: "profile_proof_population",
        member_claim_ids: ["claim-disjoint-claim"]
      });
    }
  });
  const result = evaluateVerificationProfileV034({
    contract,
    profile,
    evaluation_input: input
  });
  assert.equal(result.satisfaction, "unsatisfied");
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "collection_disjoint_purpose_match"
  ));
});

test("a disjoint same-purpose ordered sequence also prevents satisfaction", () => {
  const { contract, profile, input } = buildIdempotencyV2Fixture({
    mutate_contract(candidate) {
      addEvidence(candidate, {
        id: "disjoint-sequence-claim",
        subject: referenceIdForRole("operation"),
        operator: "reference:within_scope",
        operands: [ref(referenceIdForRole("effect_subject"))]
      });
      candidate.collections.push({
        collection_id: "set-disjoint-proof-sequence",
        collection_kind: "ordered_sequence",
        purpose: "profile_proof_sequence",
        member_claim_ids: ["claim-disjoint-sequence-claim"]
      });
    }
  });
  const result = evaluateVerificationProfileV034({
    contract,
    profile,
    evaluation_input: input
  });
  assert.equal(result.satisfaction, "unsatisfied");
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "collection_disjoint_purpose_match"
  ));
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "collection_covering_sequences_disagree"
  ));
});

test("the two falsifier conditions cannot collapse to one reference", () => {
  const fixture = buildIdempotencyV2Fixture();
  fixture.input.reference_bindings.find(
    ({ role }) => role === "duplicate_effect_condition"
  ).reference_ids = [referenceIdForRole("intervening_reset_condition")];
  const result = evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  });
  assert.equal(result.satisfaction, "invalid");
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "distinct_reference_roles_collapsed"
  ));
});

test("idempotency 2.0 rejects response equality as durable-effect proof", () => {
  const { contract, profile, input } = responseEqualityOnlyFixture(
    buildIdempotencyV2Fixture().profile
  );
  assert.equal(validateAndResolveNativeContractV034(contract).diagnostics.length, 0);
  const result = evaluateVerificationProfileV034({
    contract,
    profile,
    evaluation_input: input
  });
  assert.equal(result.satisfaction, "unsatisfied");
});

function newStore() {
  return {
    charges: new Map(),
    ledger: [],
    responses: new Map(),
    keys: new Map(),
    secondaryWrites: 0,
    sequence: 0
  };
}

function stateOf(store) {
  return JSON.stringify({
    charges: [...store.charges.entries()].sort(),
    ledger: store.ledger
  });
}

function correctCapture(store, request) {
  if (store.keys.has(request.key)) return store.responses.get(request.key);
  store.sequence += 1;
  const id = `charge-${store.sequence}`;
  store.charges.set(id, { id, amount: request.amount });
  store.ledger.push({ id, amount: request.amount });
  const response = { status: 200, id };
  store.keys.set(request.key, id);
  store.responses.set(request.key, response);
  return response;
}

function preSecondStateChangeRestoredByReplay(store, request) {
  if (store.intermediateState) {
    store.charges = store.intermediateState.charges;
    store.ledger = store.intermediateState.ledger;
    delete store.intermediateState;
    return store.responses.get(request.key);
  }
  return correctCapture(store, request);
}

preSecondStateChangeRestoredByReplay.betweenObservations = (store) => {
  store.intermediateState = {
    charges: new Map(store.charges),
    ledger: structuredClone(store.ledger)
  };
  const [id] = store.charges.keys();
  store.charges.set(id, { id, amount: 9999 });
  store.ledger = [{ id, amount: 9999 }];
};

const executableImplementations = {
  correct: correctCapture,
  "duplicate-durable-effect": (store, request) => {
    if (store.keys.has(request.key)) {
      store.ledger.push({ id: store.keys.get(request.key), amount: request.amount });
      return store.responses.get(request.key);
    }
    return correctCapture(store, request);
  },
  "reset-then-replay": (store, request) => {
    if (store.keys.has(request.key)) {
      const id = store.keys.get(request.key);
      store.charges.delete(id);
      store.ledger = store.ledger.filter((entry) => entry.id !== id);
      store.keys.delete(request.key);
      store.responses.delete(request.key);
    }
    return correctCapture(store, request);
  },
  "replace-preserving-cardinality": (store, request) => {
    if (!store.keys.has(request.key)) return correctCapture(store, request);
    const prior = store.keys.get(request.key);
    store.charges.delete(prior);
    store.ledger = [];
    store.sequence += 1;
    const id = `charge-${store.sequence}`;
    store.charges.set(id, { id, amount: request.amount });
    store.ledger.push({ id, amount: request.amount });
    store.keys.set(request.key, id);
    return store.responses.get(request.key);
  },
  "pre-second-state-change-restored-by-replay":
    preSecondStateChangeRestoredByReplay,
  "mutation-of-resources-outside-the-elected-effect-resource": (store, request) => {
    if (store.keys.has(request.key)) {
      store.secondaryWrites += 1;
      return store.responses.get(request.key);
    }
    return correctCapture(store, request);
  }
};

function executeCompleteStatePlan(implementation) {
  return executeSequentialPlan(implementation, { key: "capture-1", amount: 4200 });
}

function executeSequentialPlan(implementation, request) {
  const store = newStore();
  const first = implementation(store, request);
  const afterFirst = stateOf(store);
  implementation.betweenObservations?.(store, request);
  const beforeSecond = stateOf(store);
  const second = implementation(store, request);
  return {
    passed: afterFirst === beforeSecond && stateOf(store) === afterFirst,
    responses_equal: JSON.stringify(first) === JSON.stringify(second),
    secondary_writes: store.secondaryWrites
  };
}

function correctQueueSubmission(store, request) {
  if (store.keys.has(request.key)) return store.responses.get(request.key);
  store.sequence += 1;
  const id = `job-${store.sequence}`;
  store.charges.set(id, { id, payload: request.payload });
  store.ledger.push({ id, payload: request.payload });
  const response = { status: 202, id };
  store.keys.set(request.key, id);
  store.responses.set(request.key, response);
  return response;
}

function correctDatabaseBootstrap(store, request) {
  if (store.keys.has(request.database)) return store.responses.get(request.database);
  store.charges.set(request.database, { name: request.database, schema: request.schema });
  store.ledger.push({ event: "database-created", name: request.database });
  const response = { status: 201, name: request.database };
  store.keys.set(request.database, request.database);
  store.responses.set(request.database, response);
  return response;
}

test("one proof shape passes across three storage architectures", () => {
  const cases = {
    "payment-capture-sequential-replay": [
      correctCapture, { key: "capture-1", amount: 4200 }, "payment"
    ],
    "queue-submission-sequential-replay": [
      correctQueueSubmission, { key: "enqueue-1", payload: "work" }, "queue"
    ],
    "database-bootstrap-sequential-replay": [
      correctDatabaseBootstrap, { database: "analytics", schema: "v1" }, "database"
    ]
  };
  assert.deepEqual(Object.keys(cases), adequacy.required_positive_cases);
  for (const [implementation, request, domain] of Object.values(cases)) {
    assert.equal(executeSequentialPlan(implementation, request).passed, true);
    const fixture = buildIdempotencyV2Fixture({ domain });
    assert.equal(evaluateVerificationProfileV034({
      contract: fixture.contract,
      profile: fixture.profile,
      evaluation_input: fixture.input
    }).satisfaction, "satisfied");
  }
});

test("the pack's executable adequacy contract kills every required sequential mutant", () => {
  const fixture = buildIdempotencyV2Fixture();
  const profileResult = evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  });
  assert.equal(profileResult.satisfaction, "satisfied");

  assert.equal(executeCompleteStatePlan(executableImplementations.correct).passed, true);
  for (const mutant of adequacy.required_mutant_kills) {
    assert.equal(executeCompleteStatePlan(executableImplementations[mutant]).passed, false,
      `${mutant} survived the complete-state plan`);
  }
  const excluded = "mutation-of-resources-outside-the-elected-effect-resource";
  assert.ok(adequacy.explicit_exclusions.includes(excluded));
  assert.equal(executeCompleteStatePlan(executableImplementations[excluded]).passed, true);
});

test("response equality can pass a duplicate effect but cannot satisfy the pack", () => {
  const execution = executeCompleteStatePlan(
    executableImplementations["duplicate-durable-effect"]
  );
  assert.equal(execution.responses_equal, true);
  assert.equal(execution.passed, false);

  const fixture = responseEqualityOnlyFixture(buildIdempotencyV2Fixture().profile);
  const profileResult = evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  });
  assert.notEqual(profileResult.satisfaction, "satisfied");
});

test("the operation must write the same durable resource whose state is compared", () => {
  const fixture = buildIdempotencyV2Fixture({
    mutate_contract(contract) {
      contract.references.push({
        reference_id: "ref-unrelated-resource",
        type_term: "cc:resource",
        identity: { kind: "profile_term", term: "unrelated-resource" }
      });
      contract.propositions.find(
        ({ proposition_id: id }) => id === "prop-operation-effect-resource"
      ).operands = [ref("ref-unrelated-resource")];
    }
  });
  const result = evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  });
  assert.equal(result.satisfaction, "unsatisfied");
});

test("every declared profile rejection remains mechanically exercised", () => {
  const cases = {
    "response-equality-only": () => responseEqualityOnlyFixture(
      buildIdempotencyV2Fixture().profile
    ),
    "idempotent-effect-unconditional": () => {
      const fixture = buildIdempotencyV2Fixture();
      fixture.contract.propositions.find(({ proposition_id: id }) =>
        id === "prop-idempotent-effect"
      ).applicability_context = { mode: "unconditional", operand_reference_ids: [] };
      return fixture;
    },
    "idempotent-effect-unless-second": () => {
      const fixture = buildIdempotencyV2Fixture();
      fixture.contract.propositions.find(({ proposition_id: id }) =>
        id === "prop-idempotent-effect"
      ).applicability_context = {
        mode: "unless",
        operand_reference_ids: [referenceIdForRole("second_invocation")]
      };
      return fixture;
    },
    "pre-second-equality-after-first": () => {
      const fixture = buildIdempotencyV2Fixture();
      fixture.contract.propositions.find(({ proposition_id: id }) =>
        id === "prop-pre-second-state-equality"
      ).applicability_context = {
        mode: "after",
        operand_reference_ids: [referenceIdForRole("first_invocation")]
      };
      return fixture;
    },
    "competing-proof-population": () => buildIdempotencyV2Fixture({
      mutate_contract(contract) {
        addEvidence(contract, {
          id: "competing-population-extra",
          subject: referenceIdForRole("verification"),
          operator: "reference:reads",
          operands: [ref(referenceIdForRole("first_input"))]
        });
        const proofPopulation = contract.collections.find(
          ({ collection_id: id }) => id === "set-proof-population"
        );
        contract.collections.push({
          collection_id: "set-competing-proof-population",
          collection_kind: "closed_set",
          purpose: "profile_proof_population",
          member_claim_ids: [
            ...proofPopulation.member_claim_ids,
            "claim-competing-population-extra"
          ]
        });
      }
    }),
    "single-invocation": () => {
      const fixture = buildIdempotencyV2Fixture();
      fixture.input.reference_bindings.find(
        ({ role }) => role === "second_invocation"
      ).reference_ids = [referenceIdForRole("first_invocation")];
      return fixture;
    },
    "unrelated-effect-resource": () => buildIdempotencyV2Fixture({
      mutate_contract(contract) {
        contract.references.push({
          reference_id: "ref-unrelated-resource",
          type_term: "cc:resource",
          identity: { kind: "profile_term", term: "unrelated-resource" }
        });
        contract.propositions.find(
          ({ proposition_id: id }) => id === "prop-operation-effect-resource"
        ).operands = [ref("ref-unrelated-resource")];
      }
    })
  };
  assert.deepEqual(Object.keys(cases), adequacy.required_profile_rejections);
  for (const createFixture of Object.values(cases)) {
    const { contract, profile, input } = createFixture();
    assert.notEqual(evaluateVerificationProfileV034({
      contract,
      profile,
      evaluation_input: input
    }).satisfaction, "satisfied");
  }
});
