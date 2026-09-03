import assert from "node:assert/strict";
import test from "node:test";

import * as proofIntentSelectionModule from
  "../lib/proof-intent-selection.mjs";
import {
  readProofPackCatalog
} from "../lib/admitted-proof-packs.mjs";
import {
  PROOF_INTENT_ARTIFACT,
  PROOF_INTENT_DIGESTS,
  ProofIntentSelectionError,
  compactProofIntentSelection,
  normalizeIntentArtifact,
  normalizeProofPackCatalog,
  selectProofPacks,
  selectProofPacksV2,
  validateIntentArtifact,
  validateSelectionResult,
  validateSelectionResultV2
} from "../lib/proof-intent-selection.mjs";
import { reduceProofIntentSelectionStatus } from
  "../lib/proof-intent-selection-status.mjs";
import { buildRefusalBeforeEffectsFixture } from
  "./proof-packs/refusal-before-effects-fixture.mjs";

const refusalIntent = "controlled-proof-intent.refusal-before-effects";
const nonconsumptionIntent =
  "controlled-proof-intent.failed-attempt-nonconsumption";

test("the intrinsic artifact is schema-valid and discovers every admitted pack", async () => {
  assert.equal(validateIntentArtifact(PROOF_INTENT_ARTIFACT), true);
  const catalog = await readProofPackCatalog();
  const mapped = new Set(PROOF_INTENT_ARTIFACT.intents.flatMap(
    ({ capable_packs: packs }) => packs.map(
      ({ profile_id: id, profile_version: version }) => `${id}@${version}`
    )
  ));
  assert.equal(mapped.size, catalog.packs.length);
  for (const pack of catalog.packs) assert(mapped.has(
    `${pack.profile_id}@${pack.profile_version}`
  ));
  assert(PROOF_INTENT_ARTIFACT.intents.every(
    ({ capable_packs: packs }) => packs.length > 0
  ));
});

test("confused intents remain distinct intrinsic mappings", () => {
  const byId = new Map(PROOF_INTENT_ARTIFACT.intents.map((intent) => [
    intent.intent_id, intent
  ]));
  for (const [left, right] of [
    ["controlled-proof-intent.result-shape-conformance",
      "controlled-proof-intent.lossless-projection"],
    ["controlled-proof-intent.lossless-projection",
      "controlled-proof-intent.cross-representation-parity"],
    ["controlled-proof-intent.behavioral-preservation",
      "controlled-proof-intent.integration-prefix-safety"],
    ["controlled-proof-intent.forbidden-operation-noninvocation",
      "controlled-proof-intent.dormancy-nonactivation"],
    ["controlled-proof-intent.idempotent-effect-nonduplication",
      "controlled-proof-intent.retry-convergence"],
    [refusalIntent, nonconsumptionIntent]
  ]) {
    assert.notDeepEqual(byId.get(left).capable_packs, byId.get(right).capable_packs);
    assert(byId.get(left).distinctions.some(
      ({ from_intent_id: id }) => id === right
    ) || byId.get(right).distinctions.some(
      ({ from_intent_id: id }) => id === left
    ));
  }
});

test("selection never lets an omitted obligation suppress its explicitly requested pack", () => {
  const contract = buildRefusalBeforeEffectsFixture().contract;
  contract.claims = [];
  contract.propositions = [];
  contract.relations = [];
  const result = selectProofPacks({ contract, requestedIntents: [refusalIntent] });
  assert.equal(validateSelectionResult(result), true);
  assert.equal(result.selected_packs[0].profile_id,
    "proof.authorization.refusal-before-effects");
  assert.equal(result.selected_packs[0].selection_status, "requires_bindings");
  assert(result.candidates[0].missing_compatible_reference_types.length >= 0);
});

test("canonical v2 selection is requested-only, decision-first, and v1 is derived", () => {
  const contract = buildRefusalBeforeEffectsFixture().contract;
  const requestedIntents = [refusalIntent, nonconsumptionIntent];
  const v2 = selectProofPacksV2({ contract, requestedIntents });
  const v1 = selectProofPacks({ contract, requestedIntents });
  assert.equal(validateSelectionResultV2(v2), true);
  assert.equal(v2.schema_version,
    "controlled-contract-proof-pack-selection.v2");
  assert.deepEqual(v2.decision, {
    selection_scope: "requested_intents_only",
    selection_status: "compatible_candidates_require_bindings",
    requested_intent_count: 2,
    compatible_candidate_count: 2,
    uncovered_requested_intent_count: 0,
    hard_incompatibility_count: 0,
    missing_authoring_binding_count: 10,
    unrequested_intent_applicability: "not_evaluated",
    runtime_evidence_applicability: "not_evaluated"
  });
  assert.deepEqual(v2.compatible_candidates.map(({ profile_id: id }) => id), [
    "proof.authorization.failed-attempt-nonconsumption",
    "proof.authorization.refusal-before-effects"
  ]);
  assert(v2.compatible_candidates.every(({ authoring_state: state }) =>
    state === "requires_bindings"));
  assert.equal(v2.per_intent_outcomes.length, requestedIntents.length);
  assert(v2.per_intent_outcomes.every(({ candidate_outcomes: outcomes }) =>
    outcomes.length === 1 && outcomes[0].compatibility_state === "compatible"));
  assert.equal(validateSelectionResult(v1), true);
  assert.equal(v1.schema_version,
    "controlled-contract-proof-pack-selection.v1");
  assert.deepEqual(v1.requested_intents, v2.requested_intents);
  assert.deepEqual(v1.selected_packs, v2.compatible_candidates.map((candidate) => ({
    profile_id: candidate.profile_id,
    profile_version: candidate.profile_version,
    requested_intents: candidate.requested_intents,
    selection_status: candidate.authoring_state === "requires_bindings"
      ? "requires_bindings" : "ready"
  })));
  assert.deepEqual(v1.packs_requiring_bindings,
    v2.compatible_candidates.filter(({ authoring_state: state }) =>
      state === "requires_bindings").map(({ profile_id: profileId,
      profile_version: profileVersion }) => ({
      profile_id: profileId, profile_version: profileVersion
    })));
  assert.deepEqual(v1.hard_incompatibilities, v2.hard_incompatibilities);
  assert.deepEqual(v1.candidates, v2.candidates);
  assert.deepEqual(v1.digests, v2.digests);
  assert.equal("projectProofIntentSelectionV1" in proofIntentSelectionModule, false);
  assert.equal(JSON.stringify(v2).includes("evaluated_intent_count"), false);
  assert.equal(JSON.stringify(v2).includes("runtime_evidence_count"), false);
});

test("private status reducer applies every branch and total mixed-state precedence", () => {
  const ready = (id) => ({
    profile_id: `profile.${id}`,
    profile_version: "1.0.0",
    compatibility_state: "compatible",
    authoring_state: "ready_for_authoring",
    missing_authoring_binding_count: 0
  });
  const bindings = (id) => ({
    ...ready(id), authoring_state: "requires_bindings",
    missing_authoring_binding_count: 1
  });
  const hard = (id) => ({
    profile_id: `profile.${id}`,
    profile_version: "1.0.0",
    compatibility_state: "hard_incompatible",
    hard_incompatibility_count: 1
  });
  const outcome = (id, candidateOutcomes) => ({
    intent_id: `intent.${id}`, candidate_outcomes: candidateOutcomes
  });
  assert.equal(reduceProofIntentSelectionStatus([outcome("ready", [ready("a")])]),
    "compatible_candidates_ready_for_authoring");
  assert.equal(reduceProofIntentSelectionStatus([outcome("bindings", [bindings("a")])]),
    "compatible_candidates_require_bindings");
  assert.equal(reduceProofIntentSelectionStatus([outcome("uncovered", [])]),
    "requested_intents_uncovered");
  assert.equal(reduceProofIntentSelectionStatus([outcome("hard", [hard("a")])]),
    "hard_incompatibility_present");
  assert.equal(reduceProofIntentSelectionStatus([
    outcome("ready", [ready("a")]), outcome("bindings", [bindings("b")])
  ]), "compatible_candidates_require_bindings");
  assert.equal(reduceProofIntentSelectionStatus([
    outcome("bindings", [bindings("a")]), outcome("uncovered", [])
  ]), "requested_intents_uncovered");
  assert.equal(reduceProofIntentSelectionStatus([
    outcome("hard", [hard("a")]), outcome("uncovered", []),
    outcome("bindings", [bindings("b")])
  ]), "hard_incompatibility_present");
});

test("unknown, duplicate, and stale intent requests fail closed", () => {
  const contract = buildRefusalBeforeEffectsFixture().contract;
  assert.throws(() => selectProofPacks({
    contract, requestedIntents: ["controlled-proof-intent.near-name-refusal"]
  }), (error) => error instanceof ProofIntentSelectionError &&
    error.code === "proof_intent_unknown");
  assert.throws(() => selectProofPacks({
    contract, requestedIntents: [refusalIntent, refusalIntent]
  }), (error) => error.code === "proof_intent_request_duplicate");
  assert.throws(() => selectProofPacks({
    contract,
    requestedIntents: [refusalIntent],
    expectedDigests: { ...PROOF_INTENT_DIGESTS, catalog: "0".repeat(64) }
  }), (error) => error.code === "proof_intent_digest_stale");
});

test("caller-supplied selector substrates cannot replace the shipped mapping", () => {
  const contract = buildRefusalBeforeEffectsFixture().contract;
  const malicious = structuredClone(PROOF_INTENT_ARTIFACT);
  malicious.intents.find(({ intent_id: id }) => id === refusalIntent)
    .capable_packs = [{
      profile_id: "proof.authorization.failed-attempt-nonconsumption",
      profile_version: "1.0.0"
    }];
  const result = selectProofPacks({ contract, requestedIntents: [refusalIntent] }, {
    intentCatalog: malicious,
    packs: []
  });
  assert.equal(result.selected_packs[0].profile_id,
    "proof.authorization.refusal-before-effects");
  assert.equal(result.digests.intent_artifact,
    PROOF_INTENT_DIGESTS.intent_artifact);
});

test("contract schema and vocabulary incompatibilities are both hard failures", () => {
  const contract = buildRefusalBeforeEffectsFixture().contract;
  contract.vocabulary_version = "cv.experimental.9.99";
  const result = selectProofPacks({ contract, requestedIntents: [refusalIntent] });
  assert.equal(result.selected_packs.length, 0);
  assert.deepEqual(result.hard_incompatibilities.map(
    ({ reason_code: code }) => code
  ), ["contract_vocabulary_incompatible"]);
});

test("mechanical ambiguity remains explicit and unranked", () => {
  const contract = buildRefusalBeforeEffectsFixture().contract;
  const result = selectProofPacks({
    contract,
    requestedIntents: ["controlled-proof-intent.protected-effect-nonmutation"]
  });
  assert.equal(result.ambiguous_intents.length, 1);
  assert.equal(result.selected_packs.length, 0);
  assert.deepEqual(result.ambiguous_intents[0].candidate_packs.map(
    ({ profile_id: id }) => id
  ), [
    "proof.authorization.refusal-before-effects",
    "proof.state.bounded-interval-nonmutation"
  ]);
});

test("contract, request, artifact, and catalog order do not affect selection", async () => {
  const contract = buildRefusalBeforeEffectsFixture().contract;
  const requestedIntents = [refusalIntent, nonconsumptionIntent];
  const baseline = selectProofPacks({ contract, requestedIntents });
  const reorderedContract = structuredClone(contract);
  for (const field of ["references", "propositions", "claims", "relations"])
    reorderedContract[field].reverse();
  const reorderedArtifact = structuredClone(PROOF_INTENT_ARTIFACT);
  reorderedArtifact.intents.reverse();
  for (const intent of reorderedArtifact.intents) intent.capable_packs.reverse();
  const reordered = selectProofPacks({
    contract: reorderedContract,
    requestedIntents: [...requestedIntents].reverse()
  });
  assert.deepEqual(reordered, baseline);
  const catalog = await readProofPackCatalog();
  assert.deepEqual(normalizeProofPackCatalog({
    ...catalog, packs: [...catalog.packs].reverse()
  }), normalizeProofPackCatalog(catalog));
  assert.deepEqual(normalizeIntentArtifact(reorderedArtifact),
    normalizeIntentArtifact(PROOF_INTENT_ARTIFACT));
});

test("selection and compact projections are detached, frozen, and bounded", () => {
  const contract = buildRefusalBeforeEffectsFixture().contract;
  const input = { contract, requestedIntents: [refusalIntent] };
  const result = selectProofPacks(input);
  const compact = compactProofIntentSelection(result);
  contract.references.length = 0;
  input.requestedIntents[0] = nonconsumptionIntent;
  assert.equal(result.requested_intents[0], refusalIntent);
  assert.equal(Object.isFrozen(result.candidates[0].required_inputs), true);
  assert.throws(() => result.requested_intents.push("forged"), TypeError);
  assert.equal(JSON.stringify(compact).length < 20000, true);
  assert.equal(JSON.stringify(compact).includes("proof_obligations"), false);
  assert.equal(JSON.stringify(compact).includes("coverage_witness"), false);
});
