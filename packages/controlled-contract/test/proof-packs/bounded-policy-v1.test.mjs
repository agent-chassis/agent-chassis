import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  describeProofPackAuthoring,
  discoverProofIntents,
  inspectProofPackBindingsPage,
  selectProofPacks
} from "../../current.mjs";
import {
  buildStableTestProofPopulation,
  profileDigest
} from "../support/stable-v1-proof-pack-runtime.mjs";
import { buildBoundaryFixture, buildGuidanceFixture } from "./bounded-policy-v1-fixture.mjs";
import { buildProfile } from "./bounded-policy-v1-profile.mjs";
import { runProofPackAdequacyControls } from "./bounded-policy-v1-adequacy.mjs";
import {
  CONTROL_IDS,
  runExactBindingCertificationControls
} from "./bounded-policy-v1-exact-corpus.mjs";

for (const kind of ["boundary", "guidance"]) {
  test(`${kind} bounded-policy profile passes its executable adequacy controls`, async () => {
    const profile = buildProfile(kind);
    const run = await runProofPackAdequacyControls({
      profile, profile_digest: profileDigest(profile)
    });
    const failed = run.controls.filter(({ category, implementation_outcome, profile_satisfaction }) =>
      (category === "positive" && (implementation_outcome !== "passed" ||
        profile_satisfaction !== "satisfied")) ||
      (category === "mutant" && implementation_outcome !== "killed") ||
      (category === "profile_rejection" && profile_satisfaction === "satisfied"));
    assert.deepEqual(failed, []);
  });

  test(`${kind} bounded-policy pack passes exact-binding substitution controls`, async () => {
    const result = await runExactBindingCertificationControls({ kind });
    assert.deepEqual(result.failed_control_ids, []);
    assert.deepEqual(result.passed_control_ids, CONTROL_IDS);
  });
}

test("bounded-policy derivations are stable across repetition and property insertion order", () => {
  const boundary = buildBoundaryFixture();
  const guidance = buildGuidanceFixture();
  assert.deepEqual(buildBoundaryFixture().reportBytes, boundary.reportBytes);
  assert.deepEqual(buildGuidanceFixture().reportBytes, guidance.reportBytes);
  const reorderedProperties = boundary.policy.limits.map((limit) =>
    Object.fromEntries(Object.entries(limit).reverse()));
  assert.deepEqual(buildBoundaryFixture({ limits: reorderedProperties }).reportBytes,
    boundary.reportBytes);
  assert.deepEqual(buildGuidanceFixture({ limits: reorderedProperties }).reportBytes,
    guidance.reportBytes);
});

test("bounded-policy derivations are stable across locale, timezone, and process", () => {
  const fixtureUrl = new URL("./bounded-policy-v1-fixture.mjs", import.meta.url).href;
  const script = `
    import { buildBoundaryFixture, buildGuidanceFixture } from
      ${JSON.stringify(fixtureUrl)};
    process.stdout.write(JSON.stringify({
      boundary: buildBoundaryFixture().reportBytes.toString("hex"),
      guidance: buildGuidanceFixture().reportBytes.toString("hex")
    }));
  `;
  const execute = (LANG, TZ) => spawnSync(process.execPath,
    ["--input-type=module", "--eval", script], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, LANG, LC_ALL: LANG, TZ }
    });
  const utc = execute("C", "Etc/UTC");
  const alternate = execute("tr_TR.UTF-8", "America/Los_Angeles");
  assert.equal(utc.status, 0, utc.stderr);
  assert.equal(alternate.status, 0, alternate.stderr);
  assert.equal(alternate.stdout, utc.stdout);
});

test("bounded-policy identifiers are semantically renamed without changing population counts", () => {
  const boundary = buildBoundaryFixture();
  const renamed = boundary.policy.limits.map((limit) => ({
    ...limit, limit_key: `renamed-${limit.limit_key}`
  }));
  const renamedFixture = buildBoundaryFixture({ limits: renamed });
  assert.notEqual(renamedFixture.report.source_set_sha256, boundary.report.source_set_sha256);
  assert.equal(renamedFixture.report.counts["declared-limits"], boundary.report.counts["declared-limits"]);
});

test("bounded-policy intents are independently discoverable, selectable, and described", async () => {
  const cases = [
    ["boundary", "controlled-proof-intent.declared-boundary-record-consistency",
      "proof.policy.declared-boundary-record-consistency", buildBoundaryFixture()],
    ["guidance", "controlled-proof-intent.declared-limit-guidance-propagation",
      "proof.policy.declared-limit-propagation", buildGuidanceFixture()]
  ];
  for (const [kind, intentId, profileId, fixture] of cases) {
    assert.deepEqual(discoverProofIntents({ query: kind === "boundary"
      ? "caller asserted N-1 N N+1" : "stale guidance unit" }).intents.map(
      ({ intent_id: id }) => id), [intentId]);
    const selected = selectProofPacks({ contract: fixture.contract, requestedIntents: [intentId] });
    assert.deepEqual(selected.selected_packs.map(({ profile_id: id }) => id), [profileId]);
    const description = describeProofPackAuthoring({
      profileId, profileVersion: "2.0.0", requestedIntents: [intentId]
    });
    assert.ok(description.proof_obligations.claim_patterns.some(
      (pattern) => (pattern.for_each?.association_bindings?.length ?? 0) > 0));

    const contract = {
      ...fixture.contract,
      test_proofs: buildStableTestProofPopulation(fixture.contract)
    };
    const assistance = await inspectProofPackBindingsPage({
      contract, profileId, profileVersion: "2.0.0",
      requestedIntents: [intentId], evaluationInput: fixture.evaluationInput,
      roles: [kind === "boundary" ? "boundary_cases" : "guidance_associations"],
      maximumItems: 20
    });
    assert.equal(assistance.summary.status, "valid");
  }
});
