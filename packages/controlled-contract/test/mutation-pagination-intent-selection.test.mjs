import assert from "node:assert/strict";
import test from "node:test";

import {
  describeProofPackAuthoring,
  selectProofPacks
} from "../lib/proof-intent-selection.mjs";
import { discoverProofIntents } from "../lib/proof-intent-discovery.mjs";
import { buildRefusalBeforeEffectsFixture } from
  "./proof-packs/refusal-before-effects-fixture.mjs";

const intent = "controlled-proof-intent.mutation-consistent-pagination";
const alternatives = [
  "proof.pagination.snapshot-consistency",
  "proof.pagination.versioned-cursor-refusal"
];
const completeTraversalIntent =
  "controlled-proof-intent.complete-pagination-traversal";

test("mutation-consistent pagination preserves the explicit policy choice", () => {
  const { contract } = buildRefusalBeforeEffectsFixture();
  const result = selectProofPacks({ contract, requestedIntents: [intent] });
  assert.deepEqual(result.selected_packs, []);
  assert.equal(result.ambiguous_intents.length, 1);
  assert.deepEqual(result.ambiguous_intents[0].candidate_packs.map(
    ({ profile_id: profileId }) => profileId
  ), alternatives);
  assert.deepEqual(result.candidates.map(({ profile_id: profileId }) => profileId),
    alternatives);
  for (const profileId of alternatives) {
    const selected = describeProofPackAuthoring({
      profileId,
      profileVersion: "1.0.0",
      requestedIntents: [intent]
    });
    assert.equal(selected.profile_id, profileId);
    assert.deepEqual(selected.intent_definitions.map(
      ({ intent_id: intentId }) => intentId
    ), [intent]);
  }
});

test("complete pagination traversal is atomically discoverable and selectable", () => {
  assert.deepEqual(discoverProofIntents({
    query: "complete pagination traversal"
  }).intents.map(({ intent_id: id }) => id), [completeTraversalIntent]);
  const { contract } = buildRefusalBeforeEffectsFixture();
  const result = selectProofPacks({
    contract, requestedIntents: [completeTraversalIntent]
  });
  assert.deepEqual(result.selected_packs.map(({ profile_id: id }) => id), [
    "proof.pagination.complete-traversal"
  ]);
  assert.deepEqual(result.candidates.map(({ profile_id: id }) => id), [
    "proof.pagination.complete-traversal"
  ]);
  assert.deepEqual(result.ambiguous_intents, []);
  const authored = describeProofPackAuthoring({
    profileId: "proof.pagination.complete-traversal",
    profileVersion: "1.0.0",
    requestedIntents: [completeTraversalIntent]
  });
  assert.deepEqual(authored.intent_definitions.map(({ intent_id: id }) => id), [
    completeTraversalIntent
  ]);
});

test("complete traversal admission preserves exact neighboring discovery order", () => {
  for (const [query, expected] of [
    ["snapshot pagination consistency", [intent]],
    ["versioned cursor refusal", [intent]],
    ["refusal before effects", [
      "controlled-proof-intent.refusal-before-effects",
      "controlled-proof-intent.revocation-propagation"
    ]]
  ]) assert.deepEqual(discoverProofIntents({ query }).intents.map(
    ({ intent_id: id }) => id
  ), expected, query);
});
