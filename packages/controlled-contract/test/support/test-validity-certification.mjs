import assert from "node:assert/strict";
import { canonicalDigest } from "./proof-pack-adequacy.mjs";
import { facts, mutate } from "./test-validity-execution-controls.mjs";
import { evaluateExecutionTestValidity } from
  "../../profiles/proof.verification.test-validity/10.0.0/evaluator.mjs";

export function runTestValidityCertification(profile, adequacy, corpus) {
  assert.equal(profile.profile_id, "proof.verification.test-validity");
  assert.equal(profile.profile_version, "10.0.0");
  assert.equal(corpus.positive_cases.length, 1);
  assert.deepEqual(Object.keys(mutate).sort(),
    corpus.single_axis_weakenings.map(({ case_id: id }) => id).sort());
  const observations = [];
  for (const id of corpus.positive_cases) {
    const subject = facts();
    const before = canonicalDigest(subject);
    const result = evaluateExecutionTestValidity({ semantic_facts: subject });
    assert.equal(result.satisfaction, "satisfied", id);
    assert.deepEqual(result.diagnostics, [], id);
    assert.equal(canonicalDigest(subject), before, id);
    observations.push({ case_id: id, category: "positive", satisfaction: result.satisfaction });
  }
  for (const control of corpus.single_axis_weakenings) {
    const subject = facts();
    mutate[control.case_id](subject.facts);
    const result = evaluateExecutionTestValidity({ semantic_facts: subject });
    assert.equal(result.satisfaction, "unsatisfied", control.case_id);
    assert.ok(result.diagnostics.length > 0, control.case_id);
    assert.ok(result.diagnostics.some(
      ({ code }) => code === control.expected_code), control.case_id);
    observations.push({ case_id: control.case_id, category: "mutant",
      satisfaction: result.satisfaction, diagnostics: result.diagnostics });
  }
  const positiveCount = corpus.positive_cases.length;
  const negativeCount = corpus.single_axis_weakenings.length;
  assert.deepEqual(adequacy.certification_population, {
    positive_case_count: positiveCount, single_axis_weakening_count: negativeCount
  });
  return {
    schema_version: "controlled-contract-proof-pack-adequacy-result.v2",
    authority: { kind: "experimental_local", authoritative: false },
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: adequacy.profile_digest,
    guarantee_digest: adequacy.guarantee_digest,
    adequacy_digest: canonicalDigest(adequacy),
    corpus_digest: canonicalDigest(corpus),
    variation_mode: "full_census", passed: true, diagnostics: [],
    control_count: positiveCount + negativeCount,
    positive_control_count: positiveCount, mutant_control_count: negativeCount,
    rejection_control_count: 0,
    negative_fixture_count: negativeCount, coverage_witness_count: negativeCount,
    passed_positive_cases: [...corpus.positive_cases],
    passed_single_axis_weakenings: corpus.single_axis_weakenings.map(({ case_id: id }) => id),
    observations
  };
}
