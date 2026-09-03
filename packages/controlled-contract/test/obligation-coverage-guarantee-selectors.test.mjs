import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateAcceptanceCoverage } from "../lib/acceptance-coverage.mjs";
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
import {
  captureExactBoundAssessmentInputsV1
} from "../lib/exact-binding-assessment.mjs";
import { canonicalJson } from "../lib/contract-assessment.mjs";
import { assessProofPlan } from "../lib/multi-pack-assessment.mjs";
import {
  VOCABULARY_DIGESTS,
  VOCABULARY_VERSION
} from "../lib/vocabulary-v034.mjs";
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

async function capturedDormancyBindings() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2095-selector-exact-"));
  const fixture = buildDormancyNonactivationFixture({
    profile: dormancySnapshot.profile, domain: "plugin-registry"
  });
  const graphNodes = fixture.input.reference_bindings.find(
    ({ role }) => role === "graph_nodes"
  ).reference_ids;
  const sources = {
    "activation-observation-artifact": {
      kind: "artifact_file", relative_path: "activation-observation.json"
    },
    "default-configuration-artifact": {
      kind: "artifact_file", relative_path: "default-configuration.json"
    },
    "production-reachability-snapshot": {
      kind: "complete_reachability_snapshot",
      snapshot: {
        complete: true,
        subject_reference_id: "ref-production-graph",
        nodes: graphNodes.map((reference_id) => ({ reference_id })),
        edges: [
          { from_reference_id: "ref-production-entry-a",
            to_reference_id: "ref-active-component" },
          { from_reference_id: "ref-production-entry-b",
            to_reference_id: "ref-active-component" }
        ]
      }
    }
  };
  await Promise.all([
    writeFile(path.join(root, "contract.json"), canonicalJson(fixture.contract)),
    writeFile(path.join(root, "evaluation-input.json"), canonicalJson(fixture.input)),
    writeFile(path.join(root, "activation-observation.json"),
      canonicalJson({ complete: true, activation_events: [] })),
    writeFile(path.join(root, "default-configuration.json"),
      canonicalJson({ component: "ref-dormant-component", active: false }))
  ]);
  const capture = (exactBindingSources) => captureExactBoundAssessmentInputsV1({
    contractPath: "contract.json",
    evaluationInputPath: "evaluation-input.json",
    profileId: DORMANCY_PROFILE_ID,
    exactBindingSources
  }, {
    captureRoot: root,
    proofPack: dormancySnapshot,
    vocabularyIdentity: {
      version: VOCABULARY_VERSION,
      complete_digest: VOCABULARY_DIGESTS.complete
    }
  });
  try {
    const satisfied = (await capture(sources)).exactBindingResult;
    const missingSource = structuredClone(sources);
    delete missingSource["activation-observation-artifact"];
    const unsatisfied = (await capture(missingSource)).exactBindingResult;
    return { satisfied, unsatisfied };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const dormancyExactBindings = await capturedDormancyBindings();

function readinessPack(overrides = {}) {
  return {
    pack_id: "pack-readiness",
    requested_intents: ["implementation-readiness"],
    pack_snapshot: readinessSnapshot,
    assessment: readinessAssessment,
    evaluation_input_present: true,
    profile_discrimination: "proven",
    exact_binding: null,
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
    exact_binding: null,
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
    evaluation_stage: "pre_dispatch", ...overrides
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
    evaluation_stage: "pre_dispatch",
    assessed_evaluation_stage: "pre_dispatch",
    guarantee_applicability_proven: false,
    applicable_exclusion: null,
    matched_node_ids: ["claim-design-names-grounded-loci"],
    satisfaction: "satisfied",
    evaluation_input_present: true,
    pack_evaluated: true,
    profile_discrimination: "proven",
    exact_binding_required: false,
    exact_binding: "not_applicable"
  });
});

test("rejects caller-injected applicability outside a recognized assessment", () => {
  assert.equal(errorCode(() => buildObligationGuaranteeSelectorIndex({
    packs: [readinessPack({
      authenticated_component_exclusion_applicability: {
        projection_version:
          "controlled-contract-assessment-component-exclusion-applicability.v1"
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
    "controlled-contract-verification-profile-input.v1";
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
    assert.equal(readinessSnapshot.profile.profile_version, "2.1.0");
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
        evaluation_stage: "pre_dispatch"
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
      result_version: "controlled-contract-verification-profile-result.v1",
      profile: { profile_id: READINESS_PROFILE_ID, profile_version: "2.0.0" },
      evaluation_stage: "pre_dispatch",
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

test("exact-binding requirement and absence follow the authenticated admission version", () => {
  const readinessComponents = index().components;
  assert.ok(readinessComponents.every(
    ({ exact_binding_required: required }) => required === false));
  assert.ok(readinessComponents.every(
    ({ exact_binding: status }) => status === "not_applicable"));
  const dormancyIndex = buildObligationGuaranteeSelectorIndex({
    packs: [dormancyPack()]
  });
  assert.ok(dormancyIndex.components.every(
    ({ exact_binding_required: required }) => required === true));
  assert.ok(dormancyIndex.components.every(
    ({ exact_binding: status }) => status === "not_assessed"));
  assert.equal(errorCode(() => buildObligationGuaranteeSelectorIndex({
    packs: [readinessPack({ exact_binding: dormancyExactBindings.satisfied })]
  })), "obligation_guarantee_selector_exact_binding_artifact_mismatch");
});

test("derives v2 exact-binding status only from recognized pack-bound captures", () => {
  const proven = buildObligationGuaranteeSelectorIndex({
    packs: [dormancyPack({ exact_binding: dormancyExactBindings.satisfied })]
  });
  assert.ok(proven.components.every(
    ({ exact_binding: status }) => status === "proven"));
  const notProven = buildObligationGuaranteeSelectorIndex({
    packs: [dormancyPack({ exact_binding: dormancyExactBindings.unsatisfied })]
  });
  assert.ok(notProven.components.every(
    ({ exact_binding: status }) => status === "not_proven"));

  for (const [label, exactBinding, code, snapshot = dormancySnapshot] of [
    ["caller_status", { status: "proven" },
      "obligation_guarantee_selector_exact_binding_artifact_unrecognized"],
    ["structured_clone", structuredClone(dormancyExactBindings.satisfied),
      "obligation_guarantee_selector_exact_binding_artifact_unrecognized"],
    ["shallow_copy", { ...dormancyExactBindings.satisfied },
      "obligation_guarantee_selector_exact_binding_artifact_unrecognized"],
    ["cross_pack", dormancyExactBindings.satisfied,
      "obligation_guarantee_selector_exact_binding_binding_mismatch",
      foreignV2Snapshot]
  ]) assert.equal(errorCode(() => buildObligationGuaranteeSelectorIndex({
    packs: [dormancyPack({ pack_snapshot: snapshot, assessment: null, exact_binding:
      exactBinding })]
  })), code, label);
});

test("v2 missing and not-proven exact binding remain distinct", () => {
  const missingIndex = buildObligationGuaranteeSelectorIndex({
    packs: [dormancyPack()]
  });
  const notProvenIndex = buildObligationGuaranteeSelectorIndex({
    packs: [dormancyPack({ exact_binding: dormancyExactBindings.unsatisfied })]
  });
  for (const selectorIndex of [missingIndex, notProvenIndex]) {
    const result = resolveObligationGuaranteeSelector({
      index: selectorIndex,
      mapping: mapping({ pack_id: "pack-dormancy",
        requested_intent: "dormancy-nonactivation",
        profile_id: DORMANCY_PROFILE_ID,
        selector: { kind: "claim", component_id: "activation-population-is-empty" } }),
      nodeIds: ["claim-activation-population-is-empty"]
    });
    assert.equal(result.status, "profile_proven_exact_binding_missing");
    assert.equal(result.reason, "required_exact_binding_not_proven");
  }
  const captured = buildObligationGuaranteeSelectorIndex({
    packs: [dormancyPack({ exact_binding: dormancyExactBindings.satisfied })]
  });
  const capturedResult = resolveObligationGuaranteeSelector({
    index: captured,
    mapping: mapping({ pack_id: "pack-dormancy",
      requested_intent: "dormancy-nonactivation",
      profile_id: DORMANCY_PROFILE_ID,
      selector: { kind: "claim", component_id: "activation-population-is-empty" } }),
    nodeIds: ["claim-activation-population-is-empty"]
  });
  assert.equal(capturedResult.status, "incompatible");
  assert.equal(capturedResult.reason, "component_applicability_unproven");
});

test("v1 rejects every non-null exact-binding value before component derivation", () => {
  for (const value of [
    dormancyExactBindings.satisfied,
    { status: "not_applicable" },
    Object.freeze({ status: "not_applicable" })
  ]) assert.equal(errorCode(() => buildObligationGuaranteeSelectorIndex({
    packs: [readinessPack({ assessment: null, exact_binding: value })]
  })), "obligation_guarantee_selector_exact_binding_artifact_mismatch");
});

test("discriminates every selector incompatibility", () => {
  const unsatisfiedIndex = index({ assessment: readinessUnsatisfiedAssessment });
  const cases = [
    [resolve(index(), { profile_version: "3.0.0" }), "profile_identity_mismatch"],
    [resolve(index(), { requested_intent: "other-intent" }), "incompatible_intent"],
    [resolve(index(), { evaluation_stage: "post_delivery" }), "stage_mismatch"],
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

test("preserves missing input, unevaluated pack, and missing exact binding distinctions", () => {
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
  assert.equal(dormancyResult.status, "profile_proven_exact_binding_missing");
  assert.equal(dormancyResult.reason, "required_exact_binding_not_proven");
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
      profile_discrimination: "proven",
      exact_binding: null
    }));
    const corpus = buildObligationGuaranteeSelectorIndex({ packs });
    assert.equal(corpus.pack_ids.length, catalog.packs.length);
    assert.ok(corpus.components.length > corpus.pack_ids.length);
    assert.ok(corpus.components.every(
      ({ guarantee_applicability_proven: proven }) => proven === false));
    const obligations = corpus.components.map((component, position) => ({
      obligation_id: `OBL-${String(position + 1).padStart(5, "0")}`,
      source_locator: `/acceptance/criteria/${position}`,
      source_locator_digest: digest,
      statement: `Implement ${component.selector.component_id} exactly.`,
      controlled_contract_node_ids: [
        component.matched_node_ids?.[0] ?? `node-${position}`
      ],
      mechanism: { owner: "packages/example.mjs", kind: "code_symbol",
        selector: `owner-${position}` },
      proof: { kind: "pack_mapping", pack_id: component.pack_id,
        requested_intent: "corpus-intent", profile_id: component.profile_id,
        profile_version: component.profile_version,
        selector: { ...component.selector },
        evaluation_stage: component.evaluation_stage }
    }));
    const result = evaluateAcceptanceCoverage({
      obligationCoverage: {
        schema_version: "controlled-contract-obligation-coverage.v1",
        wk_id: "WK-2095", obligations
      },
      guaranteeSelectorIndex: corpus,
      selectedPackIds: [...corpus.pack_ids]
    });
    assert.equal(result.obligation_outcomes.length, obligations.length);
    assert.equal(result.obligation_outcomes.filter(
      ({ outcome }) => outcome === "mechanically_proven").length, 0);
    assert.equal(result.complete, false);

    const denied = result.obligation_outcomes.filter(({ proof, reason }) =>
      [READINESS_PROFILE_ID, DORMANCY_PROFILE_ID].includes(proof.pack_id) &&
      reason === "component_applicability_unproven");
    assert.ok(denied.length > 0);
    assert.ok(denied.every(({ outcome }) => outcome === "guarantee_incompatible"));
  });
