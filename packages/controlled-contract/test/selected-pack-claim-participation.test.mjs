import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SelectedPackClaimParticipationError,
  evaluateSelectedPackClaimParticipation,
  matchedProfileCoveredClaimIds,
  matchedProfileCoveredClaims
} from "../lib/selected-pack-claim-participation.mjs";
import { assessContractFiles } from "../lib/contract-assessment.mjs";
import { buildRefusalBeforeEffectsFixture } from
  "./proof-packs/refusal-before-effects-fixture.mjs";
import { readProofPackCatalog } from "../lib/admitted-proof-packs.mjs";

const PACK_PROFILE_ID = "proof.authorization.refusal-before-effects";
const ADMITTED_VERSIONS = (await readProofPackCatalog()).packs
  .filter(({ profile_id: id }) => id === PACK_PROFILE_ID)
  .map(({ profile_version: version }) => version);
assert.equal(ADMITTED_VERSIONS.length, 1, `${PACK_PROFILE_ID} must have one admitted version`);
const PACK = Object.freeze({
  profileId: PACK_PROFILE_ID,
  profileVersion: ADMITTED_VERSIONS[0]
});

function patternResult(patternId, status, matchedIds, patternKind = "claim") {
  return { pattern_id: patternId, pattern_kind: patternKind, status,
    matched_ids: matchedIds };
}

test("only satisfied claim patterns contribute participation", () => {

  const evaluation = { pattern_results: [
    patternResult("satisfied-pattern", "satisfied", ["claim-selected"]),

    patternResult("ambiguous-pattern", "indeterminate",
      ["claim-candidate-a", "claim-candidate-b"]),

    patternResult("downstream-conflicted", "indeterminate", ["claim-selected-twice"]),
    patternResult("unsatisfied-pattern", "unsatisfied", ["claim-not-selected"]),
    patternResult("inactive-pattern", "inactive", ["claim-inactive"]),

    patternResult("relation-pattern", "satisfied", ["rel-one"], "relation")
  ] };
  assert.deepEqual(matchedProfileCoveredClaimIds(evaluation), ["claim-selected"]);
  assert.deepEqual(matchedProfileCoveredClaims(evaluation), [
    { claim_id: "claim-selected", pattern_ids: ["satisfied-pattern"] }
  ]);
});

test("an absent, empty, or invalid evaluation contributes nothing", () => {
  for (const evaluation of [
    null, undefined, {}, { pattern_results: [] },
    { satisfaction: "invalid", diagnostics: [{ code: "whatever" }] }
  ]) assert.deepEqual(matchedProfileCoveredClaimIds(evaluation), []);
});

test("one claim matched by several satisfied patterns keeps every pattern", () => {
  const evaluation = { pattern_results: [
    patternResult("pattern-b", "satisfied", ["claim-one"]),
    patternResult("pattern-a", "satisfied", ["claim-one"])
  ] };
  assert.deepEqual(matchedProfileCoveredClaims(evaluation), [
    { claim_id: "claim-one", pattern_ids: ["pattern-a", "pattern-b"] }
  ]);
});

test("participation over a real pack is the assessment's matched claims", async (t) => {
  const { contract, input } = buildRefusalBeforeEffectsFixture({
    verification_method: "analysis"
  });
  assert.deepEqual(input.claim_pattern_bindings, [],
    "the witness must have no explicit binding for implicit matching to be shown");
  const participation = await evaluateSelectedPackClaimParticipation({
    contract, evaluationInput: input, ...PACK
  });
  assert.equal(participation.satisfaction, "satisfied");
  assert.ok(participation.claim_ids.length > 0);
  assert.equal(participation.profile_id, PACK.profileId);
  assert.equal(participation.profile_version, PACK.profileVersion);

  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = await mkdtemp(path.join(os.tmpdir(), "claim-participation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const contractPath = path.join(root, "contract.json");
  const inputPath = path.join(root, "evaluation-input.json");
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  const assessed = await assessContractFiles({
    inputPath: contractPath, profileId: PACK.profileId, evaluationInputPath: inputPath
  });
  assert.deepEqual(
    assessed.assessment.matched_profile_covered_claims.map(
      ({ claim_id: claimId }) => claimId),
    [...participation.claim_ids]);
});

test("a pack version that is not the admitted one refuses", async () => {
  const { contract, input } = buildRefusalBeforeEffectsFixture({
    verification_method: "analysis"
  });
  assert.notEqual(PACK.profileVersion, "0.0.1");
  const error = await evaluateSelectedPackClaimParticipation({
    contract, evaluationInput: input,
    profileId: PACK.profileId, profileVersion: "0.0.1"
  }).catch((cause) => cause);
  assert.ok(error instanceof SelectedPackClaimParticipationError);
  assert.equal(error.code,
    "selected_pack_claim_participation_pack_version_stale");
  assert.equal(error.details.requested_profile_version, "0.0.1");
  assert.equal(error.details.admitted_profile_version, PACK.profileVersion);
});

test("the published declarations and the runtime exports are the same surface",
  async () => {
    const declared = new Set([...(await readFile(
      new URL("../lib/selected-pack-claim-participation.d.mts", import.meta.url), "utf8"
    )).matchAll(
      /^export (?:declare )?(?:const|function|class) ([A-Za-z0-9_]+)/gmu
    )].map(([, name]) => name));
    const runtime = Object.keys(
      await import("../lib/selected-pack-claim-participation.mjs"));
    for (const name of runtime) {
      assert.equal(declared.has(name), true, name);
    }
  });
