import { canonicalJsonBytes, sha256 } from "../../lib/exact-binding-common.mjs";
import {
  deriveDeclaredBoundaryRecordConsistency
} from "../../lib/declared-boundary-record-consistency.mjs";
import {
  deriveDeclaredLimitGuidancePropagation
} from "../../lib/declared-limit-guidance-propagation.mjs";
import { executeDeterministicProjection } from "../../lib/deterministic-projection.mjs";
import { evaluateStableProofPackFixtureV1 } from "../support/stable-v1-proof-pack-runtime.mjs";
import { PROOF_PACK_ADEQUACY_RUN_VERSION } from "../support/proof-pack-adequacy-constants.mjs";
import { EXCLUSIONS, GUARANTEES } from "./bounded-policy-v1-constants.mjs";
import {
  buildBoundaryFixture, buildGuidanceFixture, guidanceText
} from "./bounded-policy-v1-fixture.mjs";

function profileSatisfaction(profile, fixture) {
  return evaluateStableProofPackFixtureV1({
    profile, contract: fixture.contract, evaluation_input: fixture.evaluationInput
  }).satisfaction;
}
function control(control_id, category, implementation_outcome, profile_satisfaction) {
  return { control_id, category, implementation_outcome, profile_satisfaction };
}
function killed(id, run) {
  try { run(); return control(id, "mutant", "survived", "satisfied"); } catch {
    return control(id, "mutant", "killed", "invalid");
  }
}
function boundaryMutant(id, mutate, fixtureOptions = {}) {
  return killed(id, () => {
    const fixture = buildBoundaryFixture(fixtureOptions);
    mutate(fixture);
    deriveDeclaredBoundaryRecordConsistency({
      policyBytes: canonicalJsonBytes(fixture.policy, { file: true }),
      observationBytes: canonicalJsonBytes(fixture.observation, { file: true }),
      subjectsBytes: canonicalJsonBytes(fixture.subjects, { file: true })
    });
  });
}
function guidanceMutant(id, mutate) {
  return killed(id, () => {
    const fixture = buildGuidanceFixture();
    const changed = mutate(fixture);
    deriveDeclaredLimitGuidancePropagation({
      policyBytes: canonicalJsonBytes(fixture.policy, { file: true }),
      guidanceBytes: Buffer.from(changed ?? fixture.guidanceBytes)
    });
  });
}
function swapFirstAssociations(fixture, marker) {
  const propositions = fixture.contract.propositions.filter(({ proposition_id: id }) =>
    id.includes(marker));
  [propositions[0].operands, propositions[1].operands] =
    [propositions[1].operands, propositions[0].operands];
  return fixture;
}
function omitFirstAssociationClaim(fixture, marker) {
  const index = fixture.contract.claims.findIndex(({ claim_id: id }) => id.includes(marker));
  fixture.contract.claims.splice(index, 1);
  return fixture;
}

function boundaryControls(profile) {
  const positive = buildBoundaryFixture();
  const reordered = buildBoundaryFixture({ limits: [...positive.policy.limits].reverse() });
  const dispositionLimits = ["maximum", "minimum"].flatMap((bound_direction) =>
    ["inclusive", "exclusive"].flatMap((bound_inclusivity) =>
      ["refuse", "truncate"].map((overflow_disposition) => ({
        bound_direction, bound_inclusivity,
        limit_key: `${bound_direction}-${bound_inclusivity}-${overflow_disposition}`,
        limit_value: 2, measurement_class: "unicode_scalar_measurement",
        normalization: "none", overflow_disposition, unit: "unicode_scalar_count"
      }))));
  const dispositionFixture = buildBoundaryFixture({ limits: dispositionLimits });
  const controls = [
    control("multiple-limits-units-zero-boundaries", "positive", "passed",
      profileSatisfaction(profile, positive)),
    control("reordered-policy-declarations", "positive", "passed",
      profileSatisfaction(profile, reordered)),
    control("complete-disposition-table", "positive", "passed",
      profileSatisfaction(profile, dispositionFixture)),
    boundaryMutant("fabricated-execution-provenance", (f) => {
      f.observation.provenance = "captured_execution_transcript";
    }),
    boundaryMutant("missing-boundary-case", (f) => { f.observation.cases.splice(0, 1); }),
    boundaryMutant("duplicate-boundary-case", (f) => {
      const duplicate = structuredClone(f.observation.cases[0]);
      duplicate.case_id = `${duplicate.case_id}-duplicate`;
      f.observation.cases.push(duplicate); f.observation.cases.sort((a, b) => a.case_id < b.case_id ? -1 : 1);
    }),
    boundaryMutant("conflicting-boundary-case", (f) => {
      const duplicate = structuredClone(f.observation.cases[0]);
      duplicate.case_id = `${duplicate.case_id}-conflict`;
      duplicate.observed_disposition = duplicate.observed_disposition === "accepted"
        ? "refused" : "accepted";
      delete duplicate.observed_truncated_measure;
      f.observation.cases.push(duplicate);
      f.observation.cases.sort((a, b) => a.case_id < b.case_id ? -1 : 1);
    }),
    boundaryMutant("substituted-limit-key", (f) => {
      f.observation.cases[0].limit_key = "substituted-limit";
    }),
    boundaryMutant("substituted-subject-id", (f) => {
      f.observation.cases[0].subject_id = "substituted-subject";
    }),
    boundaryMutant("reordered-boundary-cases", (f) => {
      [f.observation.cases[0], f.observation.cases[1]] =
        [f.observation.cases[1], f.observation.cases[0]];
    }),
    ...dispositionLimits.flatMap((limit) => ["below", "at", "above"].map((position) =>
      boundaryMutant(`wrong-disposition-${limit.limit_key}-${position}`, (f) => {
        const entry = f.observation.cases.find((value) =>
          value.boundary_position === position && value.limit_key === limit.limit_key);
        entry.observed_disposition = entry.observed_disposition === "accepted"
          ? "refused" : "accepted";
        delete entry.observed_truncated_measure;
      }, { limits: dispositionLimits })
    )),
    boundaryMutant("character-as-byte-substitution", (f) => {
      const limit = f.policy.limits.find(({ limit_key: key }) => key === "scalar");
      limit.unit = "utf8_byte_count"; limit.measurement_class = "utf8_byte_measurement";
    }),
    boundaryMutant("byte-as-character-substitution", (f) => {
      const limit = f.policy.limits.find(({ limit_key: key }) => key === "bytes");
      const content = { below: "éa", at: "éé", above: "ééa" };
      for (const entry of f.observation.cases.filter(({ limit_key: key }) => key === "bytes")) {
        const subject = f.subjects.subjects.find(({ subject_id: id }) => id === entry.subject_id);
        subject.content_base64 = Buffer.from(content[entry.boundary_position], "utf8").toString("base64");
      }
      limit.unit = "unicode_scalar_count";
      limit.measurement_class = "unicode_scalar_measurement";
    }),
    boundaryMutant("incorrect-unit-declaration", (f) => {
      f.policy.limits[0].measurement_class = "unicode_scalar_measurement";
    }),
    boundaryMutant("subject-substitution", (f) => {
      [f.subjects.subjects[0].content_base64, f.subjects.subjects[1].content_base64] =
        [f.subjects.subjects[1].content_base64, f.subjects.subjects[0].content_base64];
    }),
    killed("policy-observation-source-role-swap", () => {
      executeDeterministicProjection("declared-boundary-record-consistency.v1", [
        positive.policyBytes, positive.observationBytes, positive.subjectsBytes
      ]);
    })
  ];
  controls.push(control("crossed-case-limit-association", "profile_rejection", "not_applicable",
    profileSatisfaction(profile, omitFirstAssociationClaim(buildBoundaryFixture(), "case-limit-"))));
  for (const [id, marker] of [
    ["omitted-complete-population-claim", "declared-limits-cardinality"],
    ["omitted-verification-claim", "verify-report-is-conformant"],
    ["omitted-target-claim", "report-is-conformant"]
  ]) controls.push(control(id, "profile_rejection", "not_applicable",
    profileSatisfaction(profile, omitFirstAssociationClaim(buildBoundaryFixture(), marker))));
  return [...controls, ...EXCLUSIONS.boundary.map((id) =>
    control(id, "exclusion", "boundary_demonstrated", "satisfied"))];
}

function guidanceControls(profile) {
  const positive = buildGuidanceFixture({ guidanceOptions: { punctuation: ": ", unicode: true } });
  const reordered = buildGuidanceFixture({ limits: [...positive.policy.limits].reverse(),
    guidance: guidanceText(positive.policy, { punctuation: " = ", unicode: true }) });
  const edit = (f, from, to) => f.guidanceBytes.toString("utf8").replace(from, to);
  const punctuationLimits = positive.policy.limits.map((limit, index) => ({
    ...limit, limit_key: index === 0 ? "max:length" : index === 1 ? "長さ.上限" : limit.limit_key
  }));
  const punctuationKeys = buildGuidanceFixture({
    limits: punctuationLimits,
    guidance: guidanceText({ limits: punctuationLimits }, { punctuation: ": ", unicode: true })
  });
  const controls = [
    control("unicode-punctuation-guidance", "positive", "passed", profileSatisfaction(profile, positive)),
    control("unicode-punctuation-policy-keys", "positive", "passed",
      profileSatisfaction(profile, punctuationKeys)),
    control("reordered-policy-declarations", "positive", "passed", profileSatisfaction(profile, reordered)),
    guidanceMutant("missing-policy-key", (f) => f.guidanceBytes.toString("utf8")
      .split("\n").filter((line) => !line.startsWith("bytes ")).join("\n")),
    guidanceMutant("duplicate-policy-value", (f) => `${f.guidanceBytes}bytes = 4 utf8_byte_count\n`),
    guidanceMutant("stale-policy-value", (f) => edit(f, "bytes = 4", "bytes = 5")),
    guidanceMutant("conflicting-policy-value", (f) =>
      `${f.guidanceBytes}bytes = 5 utf8_byte_count\n`),
    guidanceMutant("substituted-policy-key", (f) => edit(f, "bytes =", "unknown =")),
    guidanceMutant("wrong-unit-token", (f) =>
      edit(f, "bytes = 4 utf8_byte_count", "bytes = 4 unicode_scalar_count")),
    guidanceMutant("unrelated-number", (f) => `${f.guidanceBytes}revision 7\n`),
    guidanceMutant("missing-unit-token", (f) => edit(f, "bytes = 4 utf8_byte_count", "bytes = 4")),
    killed("policy-guidance-source-role-swap", () => {
      executeDeterministicProjection("declared-limit-guidance-propagation.v1", [
        positive.guidanceBytes, positive.policyBytes
      ]);
    })
  ];
  controls.push(control("crossed-guidance-limit-association", "profile_rejection", "not_applicable",
    profileSatisfaction(profile,
      omitFirstAssociationClaim(buildGuidanceFixture(), "association-limit-"))));
  for (const [id, marker] of [
    ["omitted-complete-population-claim", "declared-limits-cardinality"],
    ["omitted-verification-claim", "verify-report-is-propagated"],
    ["omitted-target-claim", "report-is-propagated"]
  ]) controls.push(control(id, "profile_rejection", "not_applicable",
    profileSatisfaction(profile, omitFirstAssociationClaim(buildGuidanceFixture(), marker))));
  return [...controls, ...EXCLUSIONS.guidance.map((id) =>
    control(id, "exclusion", "boundary_demonstrated", "satisfied"))];
}

async function runProofPackAdequacyControls({ profile, profile_digest }) {
  const kind = profile.profile_id.includes("boundary") ? "boundary" : "guidance";
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest,
    guarantee_digest: sha256(Buffer.from(GUARANTEES[kind], "utf8")),
    controls: kind === "boundary" ? boundaryControls(profile) : guidanceControls(profile)
  };
}

export { runProofPackAdequacyControls };
