import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileProjectedSelectionTrace
} from "../lib/projected-evaluation-binding.mjs";
import {
  buildProjectedSelectionSupplement
} from "../lib/projected-selection-supplement.mjs";
import {
  EXACT_ITERATION_PATTERN,
  COVERING_ITERATION_PATTERN,
  createSubject,
  realEvaluationTrace,
  retracedWith
} from "./support/projected-evaluation-association-fixture.mjs";

const BEGIN = "for_each_iteration_begin";
const END = "for_each_iteration_end";
const OCCURRENCE = "for_each_member_occurrence";
const ASSOCIATION = "for_each_association_binding";
const CODE = "projected_evaluation_universal_trace_mismatch";

async function withSubject(body) {
  const subject = await createSubject();
  try {
    return await body(subject);
  } finally {
    await subject.cleanup();
  }
}

function reconcile(subject, mutate) {
  const { evaluation, trace } = realEvaluationTrace(subject);
  const records = mutate(trace.records.map((record) => structuredClone(record)));
  return reconcileProjectedSelectionTrace({
    evaluation,
    profile: subject.profile,
    trace: retracedWith(trace, records),
    graph: subject.graph
  });
}

function reasons(result) {
  return new Set(result.diagnostics.filter(({ code }) => code === CODE)
    .map(({ reason }) => reason));
}

test("universal iteration announcements are exact and unique", async () => {
  await withSubject((subject) => {
    for (const point of [BEGIN, END]) {
      const omitted = reconcile(subject, (records) => records.filter((record) =>
        !(record.trace_point === point &&
          record.pattern_id === EXACT_ITERATION_PATTERN)
      ));
      assert.ok(reasons(omitted).has("iteration_announcement_missing"));

      const duplicated = reconcile(subject, (records) => {
        const record = records.find((candidate) =>
          candidate.trace_point === point &&
          candidate.pattern_id === EXACT_ITERATION_PATTERN);
        return [...records, structuredClone(record)];
      });
      assert.ok(reasons(duplicated).has("iteration_announcement_duplicate"));
    }
  });
});

test("universal occurrences refuse omission, duplication, crossing, and surplus",
  async () => {
    await withSubject((subject) => {
      const belongs = (record) => record.trace_point === OCCURRENCE &&
        record.pattern_id === EXACT_ITERATION_PATTERN;
      const omitted = reconcile(subject, (records) => {
        const index = records.findIndex(belongs);
        return records.filter((_, candidate) => candidate !== index);
      });
      assert.ok(reasons(omitted).has("iteration_population_or_completion_mismatch"));

      const duplicated = reconcile(subject, (records) => {
        const record = records.find(belongs);
        return [...records, structuredClone(record)];
      });
      assert.ok(reasons(duplicated).has("member_occurrence_mismatch"));

      const crossed = reconcile(subject, (records) => {
        const occurrences = records.filter(belongs);
        const left = occurrences[0].member_reference_id;
        occurrences[0].member_reference_id = occurrences[1].member_reference_id;
        occurrences[1].member_reference_id = left;
        return records;
      });
      assert.ok(reasons(crossed).has("member_occurrence_mismatch"));

      const surplus = reconcile(subject, (records) => {
        const record = structuredClone(records.find(belongs));
        record.pattern_id = "surplus-for-each-pattern";
        return [...records, record];
      });
      assert.ok(reasons(surplus).has("surplus_iteration_record"));
    });
  });

test("association selections stay bound to their universal occurrences", async () => {
  await withSubject((subject) => {
    const belongs = (record) => record.trace_point === ASSOCIATION &&
      record.pattern_id === EXACT_ITERATION_PATTERN;
    const crossed = reconcile(subject, (records) => {
      const associations = records.filter(belongs);
      const other = associations.find((record) =>
        record.member_occurrence_position !==
          associations[0].member_occurrence_position);
      associations[0].member_occurrence_position =
        other.member_occurrence_position;
      return records;
    });
    assert.ok(reasons(crossed).has("association_occurrence_mismatch"));

    const duplicated = reconcile(subject, (records) => {
      const record = records.find(belongs);
      return [...records, structuredClone(record)];
    });
    assert.ok(reasons(duplicated).has("association_occurrence_mismatch"));

    const surplus = reconcile(subject, (records) => {
      const record = structuredClone(records.find(belongs));
      record.association_index = 999;
      return [...records, record];
    });
    assert.ok(reasons(surplus).has("association_occurrence_mismatch"));
  });
});

test("population completion, member counts, branch paths, and vacuity reconcile",
  async () => {
    await withSubject((subject) => {
      const mutateBegin = (field, value) => reconcile(subject, (records) => {
        const begin = records.find((record) => record.trace_point === BEGIN &&
          record.pattern_id === EXACT_ITERATION_PATTERN);
        begin[field] = value;
        return records;
      });
      assert.ok(reasons(mutateBegin("population_reference_id", "ref-source-a"))
        .has("iteration_population_or_completion_mismatch"));
      assert.ok(reasons(mutateBegin("complete_population_pattern_id", "other"))
        .has("iteration_population_or_completion_mismatch"));
      assert.ok(reasons(mutateBegin("branch_paths", []))
        .has("iteration_population_or_completion_mismatch"));

      const contradicted = reconcile(subject, (records) => {
        const end = records.find((record) => record.trace_point === END &&
          record.pattern_id === EXACT_ITERATION_PATTERN);
        end.member_count += 1;
        end.iteration_vacuous = true;
        return records;
      });
      assert.ok(reasons(contradicted)
        .has("iteration_population_or_completion_mismatch"));
    });
  });

test("unsatisfied and indeterminate association statuses survive lossless normalization",
  async () => {
    const cases = [{
      mutateEvaluationInput: (input) => {
        input.reference_bindings.find(
          ({ role }) => role === "occurrence_criteria"
        ).reference_ids.pop();
        return input;
      },
      expected: "unsatisfied"
    }, {
      mutateProfile: (profile) => {
        const pattern = profile.claim_patterns.find(
          ({ pattern_id: patternId }) =>
            patternId === COVERING_ITERATION_PATTERN
        );
        delete pattern.for_each.association_bindings[0].associated_cardinality;
        return profile;
      },
      expected: "indeterminate"
    }];
    for (const { expected, ...options } of cases) {
      const subject = await createSubject(options);
      try {
        const { evaluation, trace } = realEvaluationTrace(subject);
        const result = reconcileProjectedSelectionTrace({
          evaluation, profile: subject.profile, trace, graph: subject.graph
        });
        assert.deepEqual(result.diagnostics, []);
        const pattern = result.value.pattern_selections.find(
          ({ pattern_instance_id: patternId }) =>
            patternId === COVERING_ITERATION_PATTERN
        );
        assert.equal(pattern.evaluation_status, expected);
        assert.ok(result.value.association_selections.some(
          ({ pattern_instance_id: patternId, association_status: status }) =>
            patternId === COVERING_ITERATION_PATTERN && status === expected
        ));
      } finally {
        await subject.cleanup();
      }
    }
  });

test("caller-authored lossless selections cannot mint a supplement", () => {
  const forged = {
    applicable: true,
    diagnostics: [],
    selection: {
      graph: {}, pattern_selections: [], universal_iterations: [],
      association_selections: []
    }
  };
  const result = buildProjectedSelectionSupplement({
    cycle: Object.freeze({}),
    projectedEvaluation: forged
  });
  assert.equal(result.status, "refused");
  assert.equal(result.refusal.code, "PS_SAME_CYCLE_MISMATCH");
  assert.equal("projected_graph" in result, false);
  assert.equal("supplement_identity" in result, false);
});
