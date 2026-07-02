import test from "node:test";
import assert from "node:assert/strict";

import { computeWorkRecordSourceDigest } from "./work-record-schema.mjs";
import {
  normalizeStructuralTargetMetrics,
  validateExpectedEditTargetKind,
  validateExpectedEditTargetOperation
} from "./work-record-target-metrics.mjs";
import { baseWorkRecord } from "../../../../tests/fixtures/work-record-admission.mjs";

const TARGET_PATH = "packages/wiki-core/src/lib/work-record-target-metrics.mjs";
const TARGET_SPAN = {
  start_line: 187,
  end_line: 230,
  line_count: 44
};
const TARGET_FANOUT = {
  direct_reference_count: 3,
  affected_symbol_count: 1
};

function canonicalProvenanceContext() {
  const record = baseWorkRecord({
    id: "WK-0614",
    title: "Regression fixture for target provenance binding",
    repo_paths: [TARGET_PATH],
    write_scope: [TARGET_PATH]
  });
  const selectedUnit = {
    kind: "slice",
    address: "WK-0614#target-evidence-normalization-remediation-tests",
    record_id: record.id,
    slice_id: "target-evidence-normalization-remediation-tests"
  };

  return {
    record,
    selectedUnit,
    sourceRecordDigest: computeWorkRecordSourceDigest(record)
  };
}

function resolvedTargetResolutionEvidence(overrides = {}) {
  const {
    span = TARGET_SPAN,
    fanout = TARGET_FANOUT,
    resolutions = null,
    ...rest
  } = overrides;

  return {
    status: "present",
    provider: {
      id: "portfolio-local.target-resolver",
      version: "1.2.3",
      mode: "local"
    },
    reason: "resolver evidence supplied",
    resolutions:
      resolutions ?? [
        {
          provider: {
            id: "portfolio-local.target-resolver",
            version: "1.2.3",
            mode: "local"
          },
          target: {
            path: TARGET_PATH,
            kind: "function",
            name: "normalizeStructuralTargetMetrics",
            operation: "modify"
          },
          resolution_status: "resolved",
          span,
          fanout
        }
      ],
    ...rest
  };
}

function payloadBoundStructuralTargetMetricsInput({
  expectedPayloadBoundInputDigest = null,
  expectedPayloadDigest = null,
  span = TARGET_SPAN,
  fanout = TARGET_FANOUT
} = {}) {
  const { selectedUnit, sourceRecordDigest } = canonicalProvenanceContext();

  return {
    unit: {
      ...selectedUnit,
      repo: null
    },
    source_record_digest: sourceRecordDigest,
    metric_source_provenance: {
      source_kind: "canonical_work_record",
      canonicality: "canonical",
      evidence_basis: "normalized_target_projection",
      policy_backend: "portfolio-local",
      policy_version: "worker-admission-policy.v1",
      expected_payload_bound_input_digest: expectedPayloadBoundInputDigest,
      expected_payload_digest: expectedPayloadDigest,
      selected_unit: selectedUnit,
      source_record_digest: sourceRecordDigest,
      producer: {
        id: "portfolio-local.target-resolver",
        version: "1.2.3",
        mode: "local"
      }
    },
    expected_edit_targets: [
      {
        path: TARGET_PATH,
        kind: "function",
        name: "normalizeStructuralTargetMetrics",
        operation: "modify"
      }
    ],
    target_resolution_evidence: resolvedTargetResolutionEvidence({
      span,
      fanout
    }),
    file_stats: [
      {
        path: TARGET_PATH,
        loc: 100
      }
    ],
    write_scope: [TARGET_PATH]
  };
}

test("normalizeStructuralTargetMetrics preserves normalized target plan evidence", () => {
  const metrics = normalizeStructuralTargetMetrics({
    expected_edit_targets: [
      {
        path: "./packages/wiki-core/src/lib/work-record-target-metrics.mjs",
        kind: "Module",
        name: "work-record-target-metrics",
        operation: "modify",
        prose: "must be ignored"
      },
      {
        path: "wiki/work-records/WK-0251.json",
        kind: "test_case",
        name: "target-plan regression",
        operation: "create",
        optional: true
      }
    ],
    target_resolution_evidence: {
      status: "present",
      provider: "parser-symbol",
      provider_version: "1.2.3",
      reason: "resolver evidence supplied"
    },
    write_scope: [
      "packages/wiki-core/src/lib/work-record-target-metrics.mjs",
      "packages/wiki-core/src/lib/work-record-target-metrics.mjs"
    ],
    prose: {
      summary: "ignored",
      acceptance_criteria_count: 99
    }
  });

  assert.deepEqual(metrics.expected_edit_target_count, 2);
  assert.deepEqual(metrics.planned_modify_target_count, 1);
  assert.deepEqual(metrics.planned_create_target_count, 1);
  assert.deepEqual(metrics.planned_delete_target_count, 0);
  assert.deepEqual(metrics.planned_inspect_target_count, 0);
  assert.deepEqual(metrics.target_kind_count, 2);
  assert.deepEqual(metrics.resolved_edit_target_count, 0);
  assert.deepEqual(metrics.unresolved_edit_target_count, 1);
  assert.deepEqual(metrics.ambiguous_edit_target_count, 0);
  assert.deepEqual(metrics.target_resolution_evidence_status, "degraded");
  assert.deepEqual(metrics.target_resolution_provider, null);
  assert.deepEqual(metrics.target_resolution_provider_version, null);
  assert.deepEqual(metrics.target_resolution_status_reason, "no structural target provenance supplied");
  assert.deepEqual(metrics.write_scope_without_resolved_targets, 1);
  assert.deepEqual(metrics.targets, [
    {
      index: 0,
      path: "packages/wiki-core/src/lib/work-record-target-metrics.mjs",
      kind: "module",
      name: "work-record-target-metrics",
      operation: "modify",
      optional: false,
      resolution_status: "provider_unavailable",
      resolution_reason: "no structural target provenance supplied",
      provider: null,
      span: null,
      status: "valid",
      evidence: {
        issue: "expected_edit_targets.entry",
        status: "degraded"
      }
    },
    {
      index: 1,
      path: "wiki/work-records/WK-0251.json",
      kind: "test_case",
      name: "target-plan regression",
      operation: "create",
      optional: true,
      resolution_status: "not_applicable",
      resolution_reason: "create target; no pre-existing symbol expected",
      provider: null,
      span: null,
      status: "valid",
      evidence: {
        issue: "expected_edit_targets.entry",
        status: "degraded"
      }
    }
  ]);
});

test("normalizeStructuralTargetMetrics counts supplied resolver statuses", () => {
  const { selectedUnit, sourceRecordDigest } = canonicalProvenanceContext();
  const metrics = normalizeStructuralTargetMetrics({
    unit: selectedUnit,
    source_record_digest: sourceRecordDigest,
    metric_source_provenance: {
      source_kind: "canonical_work_record",
      canonicality: "canonical",
      evidence_basis: "normalized_target_projection",
      policy_backend: "portfolio-local",
      policy_version: "worker-admission-policy.v1",
      selected_unit: selectedUnit,
      source_record_digest: sourceRecordDigest,
      producer: {
        id: "portfolio-local.target-resolver",
        version: "1.2.3",
        mode: "local"
      }
    },
    expected_edit_targets: [
      {
        path: "packages/wiki-core/src/lib/work-record-target-metrics.mjs",
        kind: "function",
        name: "normalizeStructuralTargetMetrics",
        operation: "modify"
      },
      {
        path: "packages/wiki-core/src/lib/work-record-target-metrics.mjs",
        kind: "function",
        name: "missingTarget",
        operation: "inspect"
      },
      {
        path: "packages/wiki-core/src/lib/work-record-target-metrics.test.mjs",
        kind: "test_case",
        name: "ambiguous target",
        operation: "modify"
      }
    ],
    target_resolution_evidence: {
      status: "partial",
      reason: "resolver evidence supplied",
      resolutions: [
        {
          provider: {
            id: "portfolio-local.target-resolver",
            version: "v1",
            mode: "local"
          },
          target: {
            path: "packages/wiki-core/src/lib/work-record-target-metrics.mjs",
            kind: "function",
            name: "normalizeStructuralTargetMetrics",
            operation: "modify"
          },
          resolution_status: "resolved",
          span: {
            start_line: 187,
            end_line: 230,
            line_count: 44
          }
        },
        {
          target: {
            path: "packages/wiki-core/src/lib/work-record-target-metrics.test.mjs",
            kind: "test_case",
            name: "ambiguous target",
            operation: "modify"
          },
          resolution_status: "ambiguous",
          candidates: [
            {
              path: "packages/wiki-core/src/lib/work-record-target-metrics.test.mjs",
              kind: "test_case",
              name: "ambiguous target"
            }
          ]
        }
      ]
    },
    file_stats: [
      {
        path: "packages/wiki-core/src/lib/work-record-target-metrics.mjs",
        loc: 100
      }
    ],
    write_scope: [
      "packages/wiki-core/src/lib/work-record-target-metrics.mjs",
      "packages/wiki-core/src/lib/work-record-target-metrics.test.mjs"
    ]
  });

  assert.equal(metrics.resolved_edit_target_count, 1);
  assert.equal(metrics.unresolved_edit_target_count, 1);
  assert.equal(metrics.ambiguous_edit_target_count, 1);
  assert.equal(metrics.target_span_line_count, 44);
  assert.equal(metrics.max_target_span_line_count, 44);
  assert.equal(metrics.write_scope_without_resolved_targets, 1);
  assert.equal(metrics.targets[0].resolution_status, "resolved");
  assert.equal(metrics.targets[0].provider, "portfolio-local.target-resolver");
  assert.deepEqual(metrics.targets[0].span, {
    start_line: 187,
    end_line: 230,
    line_count: 44
  });
  assert.equal(metrics.targets[1].resolution_status, "provider_unavailable");
  assert.equal(metrics.targets[2].resolution_status, "ambiguous");
});

test("normalizeStructuralTargetMetrics downgrades resolved evidence when metric_source_provenance is absent", () => {
  const { selectedUnit, sourceRecordDigest } = canonicalProvenanceContext();
  const metrics = normalizeStructuralTargetMetrics({
    unit: selectedUnit,
    source_record_digest: sourceRecordDigest,
    expected_edit_targets: [
      {
        path: TARGET_PATH,
        kind: "function",
        name: "normalizeStructuralTargetMetrics",
        operation: "modify"
      }
    ],
    target_resolution_evidence: resolvedTargetResolutionEvidence(),
    file_stats: [
      {
        path: TARGET_PATH,
        loc: 100
      }
    ],
    write_scope: [TARGET_PATH]
  });

  assert.equal(metrics.metric_source_provenance.binding_status, "absent");
  assert.equal(metrics.metric_source_provenance.binding_reason, "no structural target provenance supplied");
  assert.deepEqual(metrics.metric_source_provenance.selected_unit, {
    ...selectedUnit,
    repo: null
  });
  assert.equal(metrics.metric_source_provenance.source_record_digest, sourceRecordDigest);
  assert.equal(metrics.target_resolution_evidence_status, "degraded");
  assert.equal(metrics.target_resolution_status_reason, "no structural target provenance supplied");
  assert.equal(metrics.resolved_edit_target_count, 0);
  assert.equal(metrics.unresolved_edit_target_count, 1);
  assert.equal(metrics.target_span_line_count, null);
  assert.equal(metrics.max_target_span_line_count, null);
  assert.equal(metrics.target_span_to_file_ratio, null);
  assert.equal(metrics.target_dependency_fanout_count, null);
  assert.equal(metrics.targets[0].resolution_status, "provider_unavailable");
  assert.equal(metrics.targets[0].resolution_reason, "no structural target provenance supplied");
});

test("normalizeStructuralTargetMetrics rejects partial selected-unit provenance without record binding", () => {
  const { selectedUnit, sourceRecordDigest } = canonicalProvenanceContext();
  const partialSelectedUnit = {
    kind: "slice",
    address: selectedUnit.address,
    slice_id: selectedUnit.slice_id,
    repo: null
  };

  const metrics = normalizeStructuralTargetMetrics({
    unit: selectedUnit,
    source_record_digest: sourceRecordDigest,
    metric_source_provenance: {
      source_kind: "canonical_work_record",
      canonicality: "canonical",
      evidence_basis: "normalized_target_projection",
      policy_backend: "portfolio-local",
      policy_version: "worker-admission-policy.v1",
      selected_unit: partialSelectedUnit,
      source_record_digest: sourceRecordDigest,
      producer: {
        id: "portfolio-local.target-resolver",
        version: "1.2.3",
        mode: "local"
      }
    },
    expected_edit_targets: [
      {
        path: TARGET_PATH,
        kind: "function",
        name: "normalizeStructuralTargetMetrics",
        operation: "modify"
      }
    ],
    target_resolution_evidence: resolvedTargetResolutionEvidence({
      reason: "partial selected-unit provenance regression"
    }),
    file_stats: [
      {
        path: TARGET_PATH,
        loc: 100
      }
    ],
    write_scope: [TARGET_PATH]
  });

  assert.equal(metrics.metric_source_provenance.binding_status, "unavailable");
  assert.equal(metrics.metric_source_provenance.binding_reason, "target evidence is missing selected unit binding");
  assert.deepEqual(metrics.metric_source_provenance.selected_unit, {
    ...partialSelectedUnit,
    record_id: null
  });
  assert.equal(metrics.metric_source_provenance.source_record_digest, sourceRecordDigest);
  assert.equal(metrics.target_resolution_evidence_status, "degraded");
  assert.equal(metrics.target_resolution_status_reason, "target evidence is missing selected unit binding");
  assert.equal(metrics.resolved_edit_target_count, 0);
  assert.equal(metrics.target_span_line_count, null);
  assert.equal(metrics.target_dependency_fanout_count, null);
  assert.equal(metrics.targets[0].resolution_status, "provider_unavailable");
  assert.equal(metrics.targets[0].resolution_reason, "target evidence is missing selected unit binding");
});

test("normalizeStructuralTargetMetrics rejects fabricated selected units and source digests", () => {
  const { selectedUnit, sourceRecordDigest } = canonicalProvenanceContext();
  const fakeSelectedUnit = {
    kind: "slice",
    address: "WK-0614#fabricated-slice",
    record_id: "WK-0614",
    slice_id: "fabricated-slice",
    repo: null
  };
  const fakeSourceRecordDigest = "sha256:1111111111111111111111111111111111111111111111111111111111111111";

  const selectedUnitMismatchMetrics = normalizeStructuralTargetMetrics({
    unit: selectedUnit,
    source_record_digest: sourceRecordDigest,
    metric_source_provenance: {
      selected_unit: fakeSelectedUnit,
      source_record_digest: sourceRecordDigest,
      producer: {
        id: "portfolio-local.target-resolver",
        version: "1.2.3",
        mode: "local"
      }
    },
    expected_edit_targets: [
      {
        path: TARGET_PATH,
        kind: "function",
        name: "normalizeStructuralTargetMetrics",
        operation: "modify"
      }
    ],
    target_resolution_evidence: resolvedTargetResolutionEvidence({
      reason: "selected-unit mismatch regression"
    }),
    file_stats: [
      {
        path: TARGET_PATH,
        loc: 100
      }
    ],
    write_scope: [TARGET_PATH]
  });

  assert.equal(selectedUnitMismatchMetrics.metric_source_provenance.binding_status, "unavailable");
  assert.equal(selectedUnitMismatchMetrics.metric_source_provenance.binding_reason, "selected unit mismatch");
  assert.deepEqual(selectedUnitMismatchMetrics.metric_source_provenance.selected_unit, fakeSelectedUnit);
  assert.equal(selectedUnitMismatchMetrics.metric_source_provenance.source_record_digest, sourceRecordDigest);
  assert.equal(selectedUnitMismatchMetrics.target_resolution_evidence_status, "degraded");
  assert.equal(selectedUnitMismatchMetrics.target_resolution_status_reason, "selected unit mismatch");
  assert.equal(selectedUnitMismatchMetrics.resolved_edit_target_count, 0);
  assert.equal(selectedUnitMismatchMetrics.target_span_line_count, null);
  assert.equal(selectedUnitMismatchMetrics.target_dependency_fanout_count, null);
  assert.equal(selectedUnitMismatchMetrics.targets[0].resolution_status, "provider_unavailable");

  const digestMismatchMetrics = normalizeStructuralTargetMetrics({
    unit: selectedUnit,
    source_record_digest: sourceRecordDigest,
    metric_source_provenance: {
      selected_unit: selectedUnit,
      source_record_digest: fakeSourceRecordDigest,
      producer: {
        id: "portfolio-local.target-resolver",
        version: "1.2.3",
        mode: "local"
      }
    },
    expected_edit_targets: [
      {
        path: TARGET_PATH,
        kind: "function",
        name: "normalizeStructuralTargetMetrics",
        operation: "modify"
      }
    ],
    target_resolution_evidence: resolvedTargetResolutionEvidence({
      reason: "digest mismatch regression"
    }),
    file_stats: [
      {
        path: TARGET_PATH,
        loc: 100
      }
    ],
    write_scope: [TARGET_PATH]
  });

  assert.equal(digestMismatchMetrics.metric_source_provenance.binding_status, "unavailable");
  assert.equal(digestMismatchMetrics.metric_source_provenance.binding_reason, "source record digest mismatch");
  assert.deepEqual(digestMismatchMetrics.metric_source_provenance.selected_unit, {
    ...selectedUnit,
    repo: null
  });
  assert.equal(digestMismatchMetrics.metric_source_provenance.source_record_digest, fakeSourceRecordDigest);
  assert.equal(digestMismatchMetrics.target_resolution_evidence_status, "degraded");
  assert.equal(digestMismatchMetrics.target_resolution_status_reason, "source record digest mismatch");
  assert.equal(digestMismatchMetrics.resolved_edit_target_count, 0);
  assert.equal(digestMismatchMetrics.target_span_line_count, null);
  assert.equal(digestMismatchMetrics.target_dependency_fanout_count, null);
  assert.equal(digestMismatchMetrics.targets[0].resolution_status, "provider_unavailable");
});

test("normalizeStructuralTargetMetrics rejects matching unit and digest evidence without producer metadata", () => {
  const { selectedUnit, sourceRecordDigest } = canonicalProvenanceContext();
  const metrics = normalizeStructuralTargetMetrics({
    unit: selectedUnit,
    source_record_digest: sourceRecordDigest,
    metric_source_provenance: {
      source_kind: "canonical_work_record",
      canonicality: "canonical",
      evidence_basis: "normalized_target_projection",
      policy_backend: "portfolio-local",
      policy_version: "worker-admission-policy.v1",
      selected_unit: selectedUnit,
      source_record_digest: sourceRecordDigest
    },
    expected_edit_targets: [
      {
        path: TARGET_PATH,
        kind: "function",
        name: "normalizeStructuralTargetMetrics",
        operation: "modify"
      }
    ],
    target_resolution_evidence: resolvedTargetResolutionEvidence({
      reason: "missing producer regression"
    }),
    file_stats: [
      {
        path: TARGET_PATH,
        loc: 100
      }
    ],
    write_scope: [TARGET_PATH]
  });

  assert.equal(metrics.metric_source_provenance.binding_status, "unavailable");
  assert.equal(metrics.metric_source_provenance.binding_reason, "trusted producer metadata is required");
  assert.deepEqual(metrics.metric_source_provenance.selected_unit, {
    ...selectedUnit,
    repo: null
  });
  assert.equal(metrics.metric_source_provenance.source_record_digest, sourceRecordDigest);
  assert.equal(metrics.target_resolution_evidence_status, "degraded");
  assert.equal(metrics.target_resolution_status_reason, "trusted producer metadata is required");
  assert.equal(metrics.resolved_edit_target_count, 0);
  assert.equal(metrics.target_span_line_count, null);
  assert.equal(metrics.target_dependency_fanout_count, null);
  assert.equal(metrics.targets[0].resolution_status, "provider_unavailable");
  assert.equal(metrics.targets[0].resolution_reason, "trusted producer metadata is required");
});

test("normalizeStructuralTargetMetrics preserves producer-present, fully payload-bound trusted target evidence", () => {
  const { selectedUnit, sourceRecordDigest } = canonicalProvenanceContext();
  const payloadBoundInputDigest = normalizeStructuralTargetMetrics(
    payloadBoundStructuralTargetMetricsInput()
  ).metric_source_provenance.payload_bound_input_digest;
  const metrics = normalizeStructuralTargetMetrics(
    payloadBoundStructuralTargetMetricsInput({
      expectedPayloadBoundInputDigest: payloadBoundInputDigest
    })
  );

  assert.equal(metrics.metric_source_provenance.binding_status, "trusted");
  assert.equal(metrics.metric_source_provenance.binding_reason, "trusted structural target evidence");
  assert.equal(metrics.metric_source_provenance.expected_payload_bound_input_digest, payloadBoundInputDigest);
  assert.equal(metrics.metric_source_provenance.payload_bound_input_digest, payloadBoundInputDigest);
  assert.deepEqual(metrics.metric_source_provenance.selected_unit, {
    ...selectedUnit,
    repo: null
  });
  assert.equal(metrics.metric_source_provenance.source_record_digest, sourceRecordDigest);
  assert.equal(metrics.resolved_edit_target_count, 1);
  assert.equal(metrics.unresolved_edit_target_count, 0);
  assert.equal(metrics.target_resolution_evidence_status, "present");
  assert.equal(metrics.target_resolution_status_reason, "resolver evidence supplied");
  assert.equal(metrics.target_span_line_count, 44);
  assert.equal(metrics.max_target_span_line_count, 44);
  assert.equal(metrics.target_span_to_file_ratio, 0.44);
  assert.equal(metrics.target_dependency_fanout_count, 3);
  assert.equal(metrics.targets[0].resolution_status, "resolved");
  assert.deepEqual(metrics.targets[0].span, TARGET_SPAN);
});

test("normalizeStructuralTargetMetrics preserves unresolved target diagnostics and keeps the target out of resolved counts", () => {
  const { selectedUnit, sourceRecordDigest } = canonicalProvenanceContext();
  const metrics = normalizeStructuralTargetMetrics({
    unit: selectedUnit,
    source_record_digest: sourceRecordDigest,
    metric_source_provenance: {
      source_kind: "canonical_work_record",
      canonicality: "canonical",
      evidence_basis: "normalized_target_projection",
      policy_backend: "portfolio-local",
      policy_version: "worker-admission-policy.v1",
      selected_unit: selectedUnit,
      source_record_digest: sourceRecordDigest,
      producer: {
        id: "portfolio-local.target-resolver",
        version: "1.2.3",
        mode: "local"
      }
    },
    expected_edit_targets: [
      {
        path: TARGET_PATH,
        kind: "function",
        name: "normalizeStructuralTargetMetrics",
        operation: "modify"
      }
    ],
    target_resolution_evidence: {
      status: "partial",
      reason: "resolver evidence supplied",
      resolutions: [
        {
          target: {
            path: TARGET_PATH,
            kind: "function",
            name: "normalizeStructuralTargetMetrics",
            operation: "modify"
          },
          resolution_status: "unresolved",
          candidates: [
            {
              path: TARGET_PATH,
              kind: "function",
              name: "normalizeStructuralTargetMetrics"
            }
          ]
        }
      ]
    },
    file_stats: [
      {
        path: TARGET_PATH,
        loc: 100
      }
    ],
    write_scope: [TARGET_PATH]
  });

  assert.equal(metrics.metric_source_provenance.binding_status, "trusted");
  assert.equal(metrics.target_resolution_evidence_status, "partial");
  assert.equal(metrics.target_resolution_status_reason, "resolver evidence supplied");
  assert.equal(metrics.resolved_edit_target_count, 0);
  assert.equal(metrics.unresolved_edit_target_count, 1);
  assert.equal(metrics.target_span_line_count, null);
  assert.equal(metrics.target_dependency_fanout_count, null);
  assert.equal(metrics.targets[0].resolution_status, "unresolved");
  assert.equal(metrics.targets[0].resolution_reason, "no supported target matched the declared target");
  assert.equal(metrics.targets[0].provider, null);
  assert.equal(metrics.targets[0].span, null);
});

test("normalizeStructuralTargetMetrics rejects self-asserted payload digest alias authority in caller-controlled provenance", () => {
  const tamperedSpan = {
    start_line: TARGET_SPAN.start_line,
    end_line: TARGET_SPAN.end_line - 1,
    line_count: TARGET_SPAN.line_count - 1
  };
  const tamperedPayloadBoundInputDigest = normalizeStructuralTargetMetrics(
    payloadBoundStructuralTargetMetricsInput({
      span: tamperedSpan
    })
  ).metric_source_provenance.payload_bound_input_digest;
  const metrics = normalizeStructuralTargetMetrics(
    payloadBoundStructuralTargetMetricsInput({
      expectedPayloadDigest: tamperedPayloadBoundInputDigest,
      span: tamperedSpan
    })
  );

  assert.equal(metrics.metric_source_provenance.binding_status, "unavailable");
  assert.equal(metrics.metric_source_provenance.binding_reason, "expected payload-bound input digest alias is not authoritative");
  assert.equal(metrics.metric_source_provenance.expected_payload_bound_input_digest, null);
  assert.equal(metrics.target_resolution_evidence_status, "degraded");
  assert.equal(metrics.target_resolution_status_reason, "expected payload-bound input digest alias is not authoritative");
  assert.equal(metrics.resolved_edit_target_count, 0);
  assert.equal(metrics.target_span_line_count, null);
  assert.equal(metrics.target_dependency_fanout_count, null);
  assert.equal(metrics.targets[0].resolution_status, "provider_unavailable");
  assert.equal(metrics.targets[0].resolution_reason, "expected payload-bound input digest alias is not authoritative");
});

test("normalizeStructuralTargetMetrics rejects tampered target spans even when unit, digest, and producer metadata match", () => {
  const payloadBoundInputDigest = normalizeStructuralTargetMetrics(
    payloadBoundStructuralTargetMetricsInput()
  ).metric_source_provenance.payload_bound_input_digest;
  const metrics = normalizeStructuralTargetMetrics(
    payloadBoundStructuralTargetMetricsInput({
      expectedPayloadBoundInputDigest: payloadBoundInputDigest,
      span: {
        start_line: TARGET_SPAN.start_line,
        end_line: TARGET_SPAN.end_line - 1,
        line_count: TARGET_SPAN.line_count - 1
      }
    })
  );

  assert.equal(metrics.metric_source_provenance.binding_status, "unavailable");
  assert.equal(metrics.metric_source_provenance.binding_reason, "structural target payload digest mismatch");
  assert.equal(metrics.metric_source_provenance.expected_payload_bound_input_digest, payloadBoundInputDigest);
  assert.notEqual(metrics.metric_source_provenance.payload_bound_input_digest, payloadBoundInputDigest);
  assert.equal(metrics.target_resolution_evidence_status, "degraded");
  assert.equal(metrics.target_resolution_status_reason, "structural target payload digest mismatch");
  assert.equal(metrics.resolved_edit_target_count, 0);
  assert.equal(metrics.target_span_line_count, null);
  assert.equal(metrics.target_dependency_fanout_count, null);
  assert.equal(metrics.targets[0].resolution_status, "provider_unavailable");
  assert.equal(metrics.targets[0].resolution_reason, "structural target payload digest mismatch");
});

test("normalizeStructuralTargetMetrics rejects tampered target fanout even when unit, digest, and producer metadata match", () => {
  const payloadBoundInputDigest = normalizeStructuralTargetMetrics(
    payloadBoundStructuralTargetMetricsInput()
  ).metric_source_provenance.payload_bound_input_digest;
  const metrics = normalizeStructuralTargetMetrics(
    payloadBoundStructuralTargetMetricsInput({
      expectedPayloadBoundInputDigest: payloadBoundInputDigest,
      fanout: {
        direct_reference_count: TARGET_FANOUT.direct_reference_count + 1,
        affected_symbol_count: TARGET_FANOUT.affected_symbol_count
      }
    })
  );

  assert.equal(metrics.metric_source_provenance.binding_status, "unavailable");
  assert.equal(metrics.metric_source_provenance.binding_reason, "structural target payload digest mismatch");
  assert.equal(metrics.metric_source_provenance.expected_payload_bound_input_digest, payloadBoundInputDigest);
  assert.notEqual(metrics.metric_source_provenance.payload_bound_input_digest, payloadBoundInputDigest);
  assert.equal(metrics.target_resolution_evidence_status, "degraded");
  assert.equal(metrics.target_resolution_status_reason, "structural target payload digest mismatch");
  assert.equal(metrics.resolved_edit_target_count, 0);
  assert.equal(metrics.target_span_line_count, null);
  assert.equal(metrics.target_dependency_fanout_count, null);
  assert.equal(metrics.targets[0].resolution_status, "provider_unavailable");
  assert.equal(metrics.targets[0].resolution_reason, "structural target payload digest mismatch");
});

test("normalizeStructuralTargetMetrics treats stale target provenance as unavailable and keeps the stale digest on record", () => {
  const { selectedUnit, sourceRecordDigest } = canonicalProvenanceContext();
  const staleSourceRecordDigest = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
  const metrics = normalizeStructuralTargetMetrics({
    unit: selectedUnit,
    source_record_digest: sourceRecordDigest,
    metric_source_provenance: {
      source_kind: "canonical_work_record",
      canonicality: "canonical",
      evidence_basis: "normalized_target_projection",
      policy_backend: "portfolio-local",
      policy_version: "worker-admission-policy.v1",
      selected_unit: selectedUnit,
      source_record_digest: staleSourceRecordDigest,
      producer: {
        id: "portfolio-local.target-resolver",
        version: "1.2.3",
        mode: "local"
      }
    },
    expected_edit_targets: [
      {
        path: TARGET_PATH,
        kind: "function",
        name: "normalizeStructuralTargetMetrics",
        operation: "modify"
      }
    ],
    target_resolution_evidence: resolvedTargetResolutionEvidence({
      reason: "stale target provenance regression"
    }),
    file_stats: [
      {
        path: TARGET_PATH,
        loc: 100
      }
    ],
    write_scope: [TARGET_PATH]
  });

  assert.equal(metrics.metric_source_provenance.binding_status, "unavailable");
  assert.equal(metrics.metric_source_provenance.binding_reason, "source record digest mismatch");
  assert.deepEqual(metrics.metric_source_provenance.selected_unit, {
    ...selectedUnit,
    repo: null
  });
  assert.equal(metrics.metric_source_provenance.source_record_digest, staleSourceRecordDigest);
  assert.equal(metrics.target_resolution_evidence_status, "degraded");
  assert.equal(metrics.target_resolution_status_reason, "source record digest mismatch");
  assert.equal(metrics.resolved_edit_target_count, 0);
  assert.equal(metrics.unresolved_edit_target_count, 1);
  assert.equal(metrics.target_span_line_count, null);
  assert.equal(metrics.target_dependency_fanout_count, null);
  assert.equal(metrics.targets[0].resolution_status, "provider_unavailable");
  assert.equal(metrics.targets[0].resolution_reason, "source record digest mismatch");
});

test("normalizeStructuralTargetMetrics treats graph-impact fanout problems as a binding blocker", () => {
  const { selectedUnit, sourceRecordDigest } = canonicalProvenanceContext();
  const metrics = normalizeStructuralTargetMetrics({
    unit: selectedUnit,
    source_record_digest: sourceRecordDigest,
    metric_source_provenance: {
      source_kind: "canonical_work_record",
      canonicality: "canonical",
      evidence_basis: "normalized_target_projection",
      policy_backend: "portfolio-local",
      policy_version: "worker-admission-policy.v1",
      selected_unit: selectedUnit,
      source_record_digest: sourceRecordDigest,
      producer: {
        id: "portfolio-local.target-resolver",
        version: "1.2.3",
        mode: "local"
      }
    },
    expected_edit_targets: [
      {
        path: TARGET_PATH,
        kind: "function",
        name: "normalizeStructuralTargetMetrics",
        operation: "modify"
      }
    ],
    target_resolution_evidence: resolvedTargetResolutionEvidence({
      reason: "graph-impact fanout regression",
      fanout: {
        direct_reference_count: 4,
        affected_symbol_count: 1
      }
    }),
    file_stats: [
      {
        path: TARGET_PATH,
        loc: 100
      }
    ],
    write_scope: [TARGET_PATH]
  });

  assert.equal(metrics.metric_source_provenance.binding_status, "unavailable");
  assert.equal(metrics.metric_source_provenance.binding_reason, "expected payload-bound input digest is required");
  assert.equal(metrics.target_resolution_evidence_status, "degraded");
  assert.equal(metrics.target_resolution_status_reason, "expected payload-bound input digest is required");
  assert.equal(metrics.resolved_edit_target_count, 0);
  assert.equal(metrics.unresolved_edit_target_count, 0);
  assert.equal(metrics.target_span_line_count, null);
  assert.equal(metrics.target_dependency_fanout_count, null);
  assert.equal(metrics.targets[0].resolution_status, "provider_unavailable");
  assert.equal(metrics.targets[0].resolution_reason, "expected payload-bound input digest is required");
});

test("validateExpectedEditTargetKind and validateExpectedEditTargetOperation reject unsupported values", () => {
  assert.deepEqual(validateExpectedEditTargetKind("class"), {
    value: "class",
    status: "valid"
  });
  assert.deepEqual(validateExpectedEditTargetOperation("delete"), {
    value: "delete",
    status: "valid"
  });

  assert.deepEqual(validateExpectedEditTargetKind("helper"), {
    value: null,
    status: "invalid",
    evidence: {
      issue: "expected_edit_targets.kind",
      status: "invalid",
      reason: "unsupported expected_edit_targets.kind"
    }
  });
  assert.deepEqual(validateExpectedEditTargetOperation("rewrite"), {
    value: null,
    status: "invalid",
    evidence: {
      issue: "expected_edit_targets.operation",
      status: "invalid",
      reason: "unsupported expected_edit_targets.operation"
    }
  });
});

test("normalizeStructuralTargetMetrics marks missing target fields as invalid and keeps explicit empty plans distinct", () => {
  const invalidMetrics = normalizeStructuralTargetMetrics({
    expected_edit_targets: [
      {
        path: "packages/wiki-core/src/lib/work-record-target-metrics.mjs",
        kind: "method"
      },
      "not-an-object"
    ]
  });

  assert.deepEqual(invalidMetrics.expected_edit_target_count, 2);
  assert.deepEqual(invalidMetrics.target_resolution_evidence_status, "degraded");
  assert.deepEqual(invalidMetrics.target_resolution_status_reason, "no structural target provenance supplied");
  assert.deepEqual(invalidMetrics.planned_create_target_count, 0);
  assert.deepEqual(invalidMetrics.planned_modify_target_count, 0);
  assert.deepEqual(invalidMetrics.planned_delete_target_count, 0);
  assert.deepEqual(invalidMetrics.planned_inspect_target_count, 0);
  assert.deepEqual(invalidMetrics.targets, [
    {
      index: 0,
      path: "packages/wiki-core/src/lib/work-record-target-metrics.mjs",
      kind: "method",
      name: null,
      operation: null,
      optional: false,
      resolution_status: "not_applicable",
      resolution_reason: "no structural target provenance supplied",
      provider: null,
      span: null,
      status: "invalid",
      evidence: {
        issue: "expected_edit_targets.entry",
        status: "invalid",
        reason: "expected_edit_targets entry is missing required path, kind, name, or operation evidence"
      }
    },
    {
      index: 1,
      status: "invalid",
      evidence: {
        issue: "expected_edit_targets.entry",
        status: "invalid",
        reason: "expected_edit_targets entries must be objects"
      }
    }
  ]);

  const absentMetrics = normalizeStructuralTargetMetrics({
    write_scope: ["packages/wiki-core/src/lib/work-record-target-metrics.mjs"]
  });
  const explicitEmptyMetrics = normalizeStructuralTargetMetrics({
    expected_edit_targets: [],
    write_scope: ["packages/wiki-core/src/lib/work-record-target-metrics.mjs"]
  });

  assert.deepEqual(absentMetrics.expected_edit_target_count, 0);
  assert.deepEqual(absentMetrics.target_resolution_evidence_status, "degraded");
  assert.deepEqual(absentMetrics.target_resolution_status_reason, "no structural target provenance supplied");
  assert.deepEqual(absentMetrics.write_scope_without_resolved_targets, 1);
  assert.deepEqual(absentMetrics.targets, []);

  assert.deepEqual(explicitEmptyMetrics.expected_edit_target_count, 0);
  assert.deepEqual(explicitEmptyMetrics.target_resolution_evidence_status, "degraded");
  assert.deepEqual(explicitEmptyMetrics.target_resolution_status_reason, "no structural target provenance supplied");
  assert.deepEqual(explicitEmptyMetrics.write_scope_without_resolved_targets, 1);
  assert.deepEqual(explicitEmptyMetrics.targets, []);
});
