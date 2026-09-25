import assert from "node:assert/strict";
import { canonicalDigest } from "./proof-pack-adequacy.mjs";
import { facts, mutate, notEvaluable, positive } from "./test-validity-execution-controls.mjs";
import { evaluateExecutionTestValidity } from
  "../../profiles/proof.verification.test-validity/11.0.0/evaluator.mjs";

const caseIds = (cases) => cases.map((entry) => entry.case_id ?? entry).sort();

export function runTestValidityCertification(profile, adequacy, corpus) {
  assert.equal(profile.profile_id, "proof.verification.test-validity");
  assert.equal(profile.profile_version, "11.0.0");
  assert.deepEqual(Object.keys(positive).sort(), caseIds(corpus.positive_cases));
  assert.deepEqual(Object.keys(mutate).sort(), caseIds(corpus.single_axis_weakenings));
  assert.deepEqual(Object.keys(notEvaluable).sort(), caseIds(corpus.not_evaluable_cases));
  const observations = [];
  for (const id of corpus.positive_cases) {
    const subject = positive[id]();
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

    assert.deepEqual(result.diagnostics.map(({ code }) => code), [control.expected_code],
      control.case_id);
    observations.push({ case_id: control.case_id, category: "mutant",
      satisfaction: result.satisfaction, diagnostics: result.diagnostics });
  }
  for (const control of corpus.not_evaluable_cases) {
    const subject = facts();
    notEvaluable[control.case_id](subject.facts);
    assert.throws(() => evaluateExecutionTestValidity({ semantic_facts: subject }),
      (error) => error.code === control.expected_code, control.case_id);
    observations.push({ case_id: control.case_id, category: "rejection",
      refusal_code: control.expected_code });
  }
  const positiveCount = corpus.positive_cases.length;
  const negativeCount = corpus.single_axis_weakenings.length;
  const rejectionCount = corpus.not_evaluable_cases.length;
  assert.deepEqual(adequacy.certification_population, {
    positive_case_count: positiveCount, single_axis_weakening_count: negativeCount,
    not_evaluable_case_count: rejectionCount
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
    control_count: positiveCount + negativeCount + rejectionCount,
    positive_control_count: positiveCount, mutant_control_count: negativeCount,
    rejection_control_count: rejectionCount,
    negative_fixture_count: negativeCount, coverage_witness_count: negativeCount,
    passed_positive_cases: [...corpus.positive_cases],
    passed_single_axis_weakenings: corpus.single_axis_weakenings.map(({ case_id: id }) => id),
    passed_not_evaluable_cases: corpus.not_evaluable_cases.map(({ case_id: id }) => id),
    observations
  };
}
