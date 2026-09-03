import assert from "node:assert/strict";
import test from "node:test";

import * as current from "../current.mjs";

const {
  CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS,
  CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY,
  assessmentCollectionDescriptor
} = current;

const REMOVED_DIGEST_FIELDS = new Set([
  "detail_digest", "result_digest", "population_digest", "requirement_digest"
]);

test("assessment descriptors expose only task-relevant public semantics", () => {
  assert.deepEqual(CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS, {
    proof: [
      {
        collection: "per_pack_outcomes",
        stable_id: "pack_id",
        fields: [
          "pack_id", "profile_id", "profile_version", "state",
          "profile_discrimination", "exact_binding"
        ],
        selectors: ["id", "state"]
      },
      {
        collection: "diagnostics",
        stable_id: "diagnostic_id",
        fields: ["diagnostic_id", "code", "state", "axis", "subject_id"],
        selectors: ["id", "code", "state"]
      },
      {
        collection: "proof_exclusions",
        stable_id: "exclusion_id",
        fields: ["exclusion_id"],
        selectors: ["id"]
      },
      {
        collection: "missing_inputs",
        stable_id: "missing_input_id",
        fields: ["missing_input_id", "code"],
        selectors: ["id", "code"]
      },
      {
        collection: "cross_carrier_integrity",
        stable_id: "integrity_finding_id",
        fields: [
          "integrity_finding_id", "kind", "identity", "carrier_kind", "pointer",
          "field", "content_digest", "generation_id", "expected_generation"
        ],
        selectors: ["id", "kind", "identity", "carrier_kind", "generation_id"]
      }
    ],
    integration_test_design: [
      {
        collection: "axes",
        stable_id: "axis",
        fields: ["axis", "state", "applicability", "counts"],
        selectors: ["id", "axis", "state"]
      },
      {
        collection: "gaps",
        stable_id: "diagnostic_id",
        fields: ["diagnostic_id", "code", "state", "axis", "subject_id"],
        selectors: ["id", "axis", "state", "code"]
      },
      {
        collection: "requirement_coverage",
        stable_id: "requirement_id",
        fields: ["requirement_id", "state", "obligation_count"],
        selectors: ["id", "state"]
      },
      {
        collection: "scenario_coverage",
        stable_id: "scenario_id",
        fields: ["scenario_id", "state"],
        selectors: ["id", "state"]
      },
      {
        collection: "interaction_coverage",
        stable_id: "interaction_id",
        fields: ["interaction_id", "state", "scenario_count"],
        selectors: ["id", "state"]
      },
      {
        collection: "review_question_results",
        stable_id: "question_id",
        fields: ["question_id", "state", "axis"],
        selectors: ["id", "axis", "state"]
      },
      {
        collection: "unsupported_axes",
        stable_id: "axis",
        fields: ["axis", "state"],
        selectors: ["id", "axis"]
      },
      {
        collection: "diagnostic_code_summaries",
        stable_id: "code",
        fields: ["code", "state", "count"],
        selectors: ["id", "code", "state"]
      }
    ]
  });
  assert.deepEqual(CONTROLLED_CONTRACT_ASSESSMENT_PROJECTION_VOCABULARY, {
    semantic_scope: "task_relevant_public",
    compact_omission: {
      cause: "delivery_bound",
      complete_path: "typed_continuation"
    },
    continuation: {
      collection_rows: "typed_collection",
      structured_values: "typed_field_projection",
      scalar_values: "offset_length_total_range"
    },
    accounting: {
      total: "total",
      returned: "returned",
      remaining: "remaining",
      continuation: "continuation"
    },
    exact_cardinality_fields: [
      "counts", "matched_count", "returned_count", "omitted_count", "total"
    ],
    authority: "non_authorizing"
  });
  assert.equal(Object.hasOwn(current, "CONTROLLED_CONTRACT_COMPLETENESS_EXEMPTIONS"), false);
  assert.equal(
    Object.hasOwn(current, "CONTROLLED_CONTRACT_COMPLETENESS_EXEMPTION_REASONS"),
    false
  );
  for (const [family, rows] of Object.entries(
    CONTROLLED_CONTRACT_ASSESSMENT_COLLECTION_DESCRIPTORS
  )) {
    assert.equal(new Set(rows.map(({ collection }) => collection)).size, rows.length);
    for (const row of rows) {
      assert.equal(assessmentCollectionDescriptor(family, row.collection), row);
      assert.ok(row.selectors.includes("id"));
      assert.ok(row.fields.includes(row.stable_id));
      assert.equal(new Set(row.fields).size, row.fields.length);
      assert.deepEqual(row.fields.filter((field) => REMOVED_DIGEST_FIELDS.has(field)), []);
    }
  }
});
