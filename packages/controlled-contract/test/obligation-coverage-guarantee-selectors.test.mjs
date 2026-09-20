import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadAdmittedProofPack,
  readProofPackCatalog
} from "../lib/admitted-proof-packs.mjs";
import {
  OBLIGATION_GUARANTEE_SELECTOR_KINDS,
  ObligationGuaranteeSelectorError,
  buildObligationGuaranteeSelectorIndex,
  resolveObligationGuaranteeSelector
} from "../lib/obligation-coverage-guarantee-selectors.mjs";
import { canonicalJson } from "../lib/contract-assessment.mjs";
import { assessProofPlan } from "../lib/multi-pack-assessment.mjs";
import { buildDormancyNonactivationFixture }
  from "./proof-packs/dormancy-nonactivation-v1-fixture.mjs";
import { buildImplementationReadinessFixture }
  from "./proof-packs/implementation-readiness-v1-adequacy.mjs";
import { buildProofPlanFixture } from "./proof-plan-fixture.mjs";
import {
  buildStableTestProofPopulation,
  evaluateStableProofPackFixtureV1
} from "./support/stable-v1-proof-pack-runtime.mjs";

const READINESS_PROFILE_ID = "proof.design.implementation-readiness";
const DORMANCY_PROFILE_ID = "proof.dormancy.nonactivation";
const digest = `sha256:${"b".repeat(64)}`;

const readinessSnapshot = await loadAdmittedProofPack(READINESS_PROFILE_ID);
const dormancySnapshot = await loadAdmittedProofPack(DORMANCY_PROFILE_ID);
const foreignV2Snapshot = await loadAdmittedProofPack(
  "proof.compatibility.behavioral-preservation"
);

function evaluateAgainst(snapshot, options = {}) {
  const build = snapshot === dormancySnapshot
    ? buildDormancyNonactivationFixture : buildImplementationReadinessFixture;
  const fixture = build({ profile: snapshot.profile, ...options });
  return evaluateStableProofPackFixtureV1({
    contract: fixture.contract, profile: snapshot.profile,
    evaluation_input: fixture.input
  });
}

const readinessAssessment = evaluateAgainst(readinessSnapshot);
const readinessUnsatisfiedAssessment = evaluateAgainst(readinessSnapshot, {
  omitPatternIds: ["placeholder-population-empty"]
});
const dormancyAssessment = evaluateAgainst(dormancySnapshot);

function readinessPack(overrides = {}) {
  return {
    pack_id: "pack-readiness",
    requested_intents: ["implementation-readiness"],
    pack_snapshot: readinessSnapshot,
    assessment: readinessAssessment,
    evaluation_input_present: true,
    profile_discrimination: "proven",
    ...overrides
  };
}

function dormancyPack(overrides = {}) {
  return {
    pack_id: "pack-dormancy",
    requested_intents: ["dormancy-nonactivation"],
    pack_snapshot: dormancySnapshot,
    assessment: dormancyAssessment,
    evaluation_input_present: true,
    profile_discrimination: "proven",
    ...overrides
  };
}

function index(overrides = {}) {
  return buildObligationGuaranteeSelectorIndex({ packs: [readinessPack(overrides)] });
}

function mapping(overrides = {}) {
  const profileId = overrides.profile_id ?? READINESS_PROFILE_ID;
  const profileVersion = profileId === DORMANCY_PROFILE_ID
    ? dormancySnapshot.profile.profile_version
    : readinessSnapshot.profile.profile_version;
  return {
    kind: "pack_mapping", pack_id: "pack-readiness",
    requested_intent: "implementation-readiness",
    profile_id: profileId,
    profile_version: profileVersion,
    selector: { kind: "claim", component_id: "design-names-grounded-loci" },
    ...overrides
  };
}

function resolve(selectorIndex = index(), mappingOverrides = {},
  nodes = ["claim-design-names-grounded-loci"]) {
  return resolveObligationGuaranteeSelector({
    index: selectorIndex, mapping: mapping(mappingOverrides), nodeIds: nodes
  });
}

function errorCode(operation) {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof ObligationGuaranteeSelectorError, error.message);
    return error.code;
  }
  return null;
}

test("exports the closed exact selector vocabulary", () => {
  assert.deepEqual(OBLIGATION_GUARANTEE_SELECTOR_KINDS, [
    "reference_binding", "claim", "relation", "collection", "resolver_fact",
    "evidence"
  ]);
  const selectorIndex = index();
  assert.ok(selectorIndex.components.length > 0);
  for (const { selector } of selectorIndex.components) {
    assert.ok(OBLIGATION_GUARANTEE_SELECTOR_KINDS.includes(selector.kind),
      selector.kind);
  }
});

test("derives every component from the recognized snapshot and its bound assessment", () => {
  const selectorIndex = index();
  assert.equal(Object.isFrozen(selectorIndex), true);
  assert.deepEqual(selectorIndex.pack_ids, ["pack-readiness"]);
  const component = selectorIndex.components.find(({ selector }) =>
    selector.kind === "claim" &&
    selector.component_id === "design-names-grounded-loci");
  assert.deepEqual(component, {
    pack_id: "pack-readiness",
    profile_id: READINESS_PROFILE_ID,
    profile_version: readinessSnapshot.profile.profile_version,
    requested_intents: ["implementation-readiness"],
    selector: { kind: "claim", component_id: "design-names-grounded-loci" },

    guarantee_applicability_proven: false,
    applicable_exclusion: null,
    matched_node_ids: ["claim-design-names-grounded-loci"],
    satisfaction: "satisfied",
    evaluation_input_present: true,
    pack_evaluated: true,
    profile_discrimination: "proven"
  });
});

test("rejects caller-injected applicability outside a recognized assessment", () => {
  assert.equal(errorCode(() => buildObligationGuaranteeSelectorIndex({
    packs: [readinessPack({
      authenticated_component_exclusion_applicability: {
        projection_version:
          "controlled-contract-assessment-component-exclusion-applicability.v2"
      }
    })]
  })), "obligation_guarantee_selector_assessment_unrecognized");
});

function stabilizeFixture(value) {
  const fixture = structuredClone(value);
  fixture.contract.schema_version = "controlled-acceptance-contract.v1";
  fixture.contract.profile_id = "acceptance-contract.standard.v1";
  fixture.contract.vocabulary_version = "controlled-contract-vocabulary.v1";
  fixture.contract.test_proof_version = "controlled-contract-test-proof.v1";
  fixture.contract.test_proofs = buildStableTestProofPopulation(fixture.contract);
  fixture.input.input_version =
    "controlled-contract-verification-profile-input.v2";
  fixture.input.stable_evaluation = {};
  return fixture;
}

test("recognized assessment preserves omitted applicability as unknown", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-selector-applicability-"));
  try {
    const fixture = stabilizeFixture(buildImplementationReadinessFixture({
      profile: readinessSnapshot.profile
    }));
    const contractPath = path.join(root, "contract.json");
    const evaluationPath = path.join(root, "evaluation.json");
    await Promise.all([
      writeFile(contractPath, canonicalJson(fixture.contract)),
      writeFile(evaluationPath, canonicalJson(fixture.input))
    ]);
    const proofPlan = await buildProofPlanFixture({
      contractPath,
      packs: [{
        profileId: readinessSnapshot.profile.profile_id,
        requestedIntents: [
          "controlled-proof-intent.implementation-readiness"
        ],
        evaluationInputPath: evaluationPath
      }]
    });
    const projected = await assessProofPlan({
      inputPath: contractPath, proofPlan, planDirectory: root
    });
    const selectorIndex = buildObligationGuaranteeSelectorIndex({
      assessment: projected
    });
    const omittedComponent = selectorIndex.components.find(({ selector }) =>
      selector.kind === "claim" &&
      selector.component_id === "implementation-locus-targets-requirements"
    );
    assert.equal(readinessSnapshot.profile.profile_version, "4.0.0");
    assert.equal(omittedComponent.applicable_exclusion, null);
    assert.equal(omittedComponent.guarantee_applicability_proven, false);
    assert.ok(omittedComponent.matched_node_ids.length > 0);
    const resolution = resolveObligationGuaranteeSelector({
      index: selectorIndex,
      mapping: {
        kind: "pack_mapping",
        pack_id: readinessSnapshot.profile.profile_id,
        requested_intent:
          "controlled-proof-intent.implementation-readiness",
        profile_id: readinessSnapshot.profile.profile_id,
        profile_version: readinessSnapshot.profile.profile_version,
        selector: omittedComponent.selector,

      },
      nodeIds: [omittedComponent.matched_node_ids[0]]
    });
    assert.equal(resolution.status, "incompatible");
    assert.equal(resolution.reason, "exclusion_applicability_unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("package-minted profile results are deeply immutable", () => {
  assert.equal(Object.isFrozen(readinessAssessment), true);
  assert.equal(Object.isFrozen(readinessAssessment.profile), true);
  assert.equal(Object.isFrozen(readinessAssessment.admission), true);
  assert.equal(Object.isFrozen(readinessAssessment.pattern_results), true);
  assert.ok(readinessAssessment.pattern_results.every((result) =>
    Object.isFrozen(result) && Object.isFrozen(result.matched_ids)));
  assert.throws(() => readinessAssessment.pattern_results.push({}), TypeError);
  assert.throws(() => readinessAssessment.pattern_results[0].matched_ids.push("forged"),
    TypeError);
});

test("index derivation is independent of pack and component ordering", () => {
  const forward = buildObligationGuaranteeSelectorIndex({
    packs: [readinessPack(), dormancyPack()]
  });
  const reverse = buildObligationGuaranteeSelectorIndex({
    packs: [dormancyPack(), readinessPack()]
  });
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.pack_ids, ["pack-dormancy", "pack-readiness"]);
});

test("refuses caller-constructed, copied, and substituted pack artifacts", () => {

  const minimal = Object.freeze({
    profile: readinessSnapshot.profile,
    admission: readinessSnapshot.admission,
    profile_digest: readinessSnapshot.profile_digest,
    admission_digest: readinessSnapshot.admission_digest,
    catalog_entry: readinessSnapshot.catalog_entry,
    admission_version: readinessSnapshot.admission_version
  });
  const substituted = Object.freeze({
    ...readinessSnapshot, admission: dormancySnapshot.admission
  });
  for (const [label, snapshot] of [
    ["caller_minted", { profile: {}, admission: {} }],
    ["minimal", minimal],
    ["structured_copy", structuredClone(readinessSnapshot)],
    ["shallow_copy", { ...readinessSnapshot }],
    ["admission_substitution", substituted],
    ["profile_substitution", Object.freeze({
      ...readinessSnapshot, profile: dormancySnapshot.profile
    })],
    ["absent", null]
  ]) assert.equal(errorCode(() => buildObligationGuaranteeSelectorIndex({
    packs: [readinessPack({ pack_snapshot: snapshot })]
  })), "obligation_guarantee_selector_pack_snapshot_unrecognized", label);
  assert.equal(errorCode(() => buildObligationGuaranteeSelectorIndex({
    packs: [{ ...readinessPack(), adapter: "infer-components" }]
  })), "obligation_guarantee_selector_input_invalid");
  assert.equal(errorCode(() => buildObligationGuaranteeSelectorIndex({
    packs: [{
      ...readinessPack(), profile: readinessSnapshot.profile,
      admission: readinessSnapshot.admission
    }]
  })), "obligation_guarantee_selector_input_invalid");
});

test("accepts only exact package-minted and pack-bound assessment artifacts", () => {
  assert.doesNotThrow(() => index());
  const copiedFrozen = structuredClone(readinessAssessment);
  const freeze = (value) => {
    if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  for (const [label, assessment, code] of [
    ["foreign_pack", dormancyAssessment,
      "obligation_guarantee_selector_assessment_invalid"],
    ["structured_copy", structuredClone(readinessAssessment),
      "obligation_guarantee_selector_assessment_unrecognized"],
    ["shallow_copy", { ...readinessAssessment },
      "obligation_guarantee_selector_assessment_unrecognized"],
    ["copied_frozen", freeze(copiedFrozen),
      "obligation_guarantee_selector_assessment_unrecognized"],
    ["identity_spliced", Object.freeze({
      ...readinessAssessment, profile: dormancyAssessment.profile
    }), "obligation_guarantee_selector_assessment_unrecognized"],
    ["caller_minted", Object.freeze({
      result_version: "controlled-contract-verification-profile-result.v2",
      profile: { profile_id: READINESS_PROFILE_ID, profile_version: "4.0.0" },

      admission: { profile_digest: readinessSnapshot.profile_digest },
      pattern_results: [{ pattern_id: "design-names-grounded-loci",
        pattern_kind: "claim", status: "satisfied",
        matched_ids: ["claim-design-names-grounded-loci"] }]
    }), "obligation_guarantee_selector_assessment_unrecognized"],
    ["digest_substituted", Object.freeze({
      ...readinessAssessment,
      admission: { ...readinessAssessment.admission,
        profile_digest: "0".repeat(64) }
    }), "obligation_guarantee_selector_assessment_unrecognized"],
    ["unversioned", Object.freeze({
      ...readinessAssessment, result_version: "some-other-result.v1"
    }), "obligation_guarantee_selector_assessment_unrecognized"]
  ]) {
    const observed = errorCode(() => buildObligationGuaranteeSelectorIndex({
      packs: [readinessPack({ assessment })]
    }));
    assert.equal(observed, code, label);
  }
});

test("discriminates every selector incompatibility", () => {
  const unsatisfiedIndex = index({ assessment: readinessUnsatisfiedAssessment });
  const cases = [
    [resolve(index(), { profile_version: "2.1.0" }), "profile_identity_mismatch"],
    [resolve(index(), { requested_intent: "other-intent" }), "incompatible_intent"],

    [resolve(index(), {}, ["unmatched-node"]), "unmatched_node"],
    [resolve(unsatisfiedIndex, { selector: { kind: "reference_binding",
      component_id: "complete-placeholder-population" } },
    ["ref-placeholder-population"]), "component_not_satisfied"],
    [resolve(index()), "component_applicability_unproven"]
  ];
  for (const [result, reason] of cases) {
    assert.equal(result.status, "incompatible", reason);
    assert.equal(result.reason, reason);
  }
  for (const componentId of [
    READINESS_PROFILE_ID, "authored-population-truth", "satisfaction_expression",
    "0", "absent-component"
  ]) assert.equal(resolve(index(), {
    selector: { kind: "claim", component_id: componentId }
  }).reason, "unknown_selector", componentId);
  assert.equal(errorCode(() => resolveObligationGuaranteeSelector({
    index: index(), mapping: { ...mapping(), selector: "design-names-grounded-loci" },
    nodeIds: ["claim-design-names-grounded-loci"]
  })), "obligation_guarantee_selector_input_invalid");
});

test("preserves missing input and unevaluated pack distinctions", () => {
  assert.equal(resolve(index({ evaluation_input_present: false })).status,
    "mapped_input_missing");
  assert.equal(resolve(index({ assessment: null })).status,
    "mapped_pack_not_evaluated");

  const dormancyIndex = buildObligationGuaranteeSelectorIndex({
    packs: [dormancyPack()]
  });
  const dormancyResult = resolveObligationGuaranteeSelector({
    index: dormancyIndex,
    mapping: mapping({ pack_id: "pack-dormancy",
      requested_intent: "dormancy-nonactivation",
      profile_id: DORMANCY_PROFILE_ID,
      selector: { kind: "claim", component_id: "activation-population-is-empty" } }),
    nodeIds: ["claim-activation-population-is-empty"]
  });
  assert.equal(dormancyResult.status, "incompatible");
  assert.equal(dormancyResult.reason, "component_applicability_unproven");
});

test("one population component credits distinct assessed members", () => {
  const selectorIndex = index();
  const population = selectorIndex.components.find(({ selector }) =>
    selector.kind === "reference_binding" &&
    selector.component_id === "complete-requirement-population");
  assert.ok(population.matched_node_ids.length > 1);
  const populationMapping = { selector: { kind: "reference_binding",
    component_id: "complete-requirement-population" } };
  for (const member of population.matched_node_ids) {

    assert.equal(resolve(selectorIndex, populationMapping, [member]).reason,
      "component_applicability_unproven", member);
  }
  assert.equal(resolve(selectorIndex, populationMapping,
    ["ref-not-in-this-population"]).reason, "unmatched_node");
});

test("no admitted pack awards mechanical proof without authenticated applicability",
  async () => {
    const catalog = await readProofPackCatalog();
    const snapshots = await Promise.all(catalog.packs.map(
      ({ profile_id: profileId }) => loadAdmittedProofPack(profileId)));
    const evaluated = new Map([
      [READINESS_PROFILE_ID, readinessAssessment],
      [DORMANCY_PROFILE_ID, dormancyAssessment]
    ]);

    const packs = snapshots.map((snapshot) => ({
      pack_id: snapshot.profile.profile_id,
      requested_intents: ["corpus-intent"],
      pack_snapshot: snapshot,
      assessment: evaluated.get(snapshot.profile.profile_id) ?? null,
      evaluation_input_present: true,
      profile_discrimination: "proven"
    }));
    const corpus = buildObligationGuaranteeSelectorIndex({ packs });
    assert.equal(corpus.pack_ids.length, catalog.packs.length);
    assert.ok(corpus.components.length > corpus.pack_ids.length);
    assert.ok(corpus.components.every(
      ({ guarantee_applicability_proven: proven }) => proven === false));
    const resolutions = corpus.components.map(component => resolveObligationGuaranteeSelector({
      index: corpus, mapping: { kind: 'pack_mapping', pack_id: component.pack_id,
        requested_intent: 'corpus-intent', profile_id: component.profile_id,
        profile_version: component.profile_version, selector: { ...component.selector } },
      nodeIds: [component.matched_node_ids?.[0] ?? 'node-unmatched']
    }));
    assert.equal(resolutions.length, corpus.components.length);
    assert.ok(resolutions.every(result => result.status !== 'compatible'));
    assert.ok(resolutions.some(result => result.reason === 'component_applicability_unproven'));
  });
