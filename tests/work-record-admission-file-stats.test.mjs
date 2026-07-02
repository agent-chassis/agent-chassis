import test from "node:test";
import assert from "node:assert/strict";

import { createWorkRecordAdmissionEnvelope } from "../packages/wiki-core/src/index.mjs";

function baseDispatchReadiness() {
  return {
    schema_version: "dispatch-readiness.v1",
    record_id: "WK-0184",
    unit: {
      kind: "work_item",
      address: "WK-0184",
      record_id: "WK-0184",
      slice_id: null
    },
    decision_code: "dispatchable",
    dispatchable: true,
    reasons: [],
    accepted_escalations: [],
    blast_radius: {
      level: "low",
      reasons: [],
      accepted_escalation_id: null
    },
    clusters: [],
    state: {
      graph_available: true,
      dirty_state: "clean",
      staleness: "fresh",
      graph_state: {
        graph_available: true,
        edge_source: "base_index",
        dirty_graph_mode: "base_index_only",
        unavailable_paths: []
      }
    }
  };
}

function graphImpactFixture() {
  return {
    dirty_state: "dirty_worktree",
    staleness: "stale",
    graph_state: {
      graph_available: true,
      edge_source: "dirty_overlay",
      dirty_graph_mode: "overlay_parsed",
      unavailable_paths: []
    },
    graph_nodes: [],
    structural_impacts: [],
    missing_update_hints: [],
    open_write_scope_overlaps: [],
    summary: {
      derived_evidence: {
        affected_surfaces: {},
        likely_tests: [],
        docs_contracts: []
      }
    }
  };
}

function baseBreadthInputs(overrides = {}) {
  const defaultProfile = {
    profile_id: "worker-admission.work_unit_atomicity.default",
    profile_version: "v1",
    thresholds: {
      review_when_write_scope_count_above: 1,
      review_when_write_scope_total_loc_above: 200,
      review_when_max_write_file_loc_above: 600,
      review_when_acceptance_criteria_count_above: 10,
      review_when_validation_command_count_above: 2,
      review_when_declared_runtime_mode_count_above: 1,
      review_when_artifact_kind_count_above: 1,
      review_when_expected_changed_line_budget_above: 200,
      deny_when_write_scope_count_above: 4,
      deny_when_write_scope_total_loc_above: 1200,
      deny_when_max_write_file_loc_above: 1200
    }
  };

  const profile = {
    ...defaultProfile,
    ...(overrides.policy_profile ?? overrides.policyProfile ?? {}),
    thresholds: {
      ...defaultProfile.thresholds,
      ...((overrides.policy_profile ?? overrides.policyProfile ?? {}).thresholds ?? {})
    }
  };

  return {
    work_unit_metrics: {
      write_scope_count: 1,
      write_scope_existing_file_count: 1,
      write_scope_directory_count: 0,
      write_scope_total_loc: 80,
      max_write_file_loc: 80,
      acceptance_criteria_count: 1,
      validation_command_count: 1,
      declared_runtime_mode_count: 1,
      artifact_kind_count: 1,
      expected_changed_line_budget: 120,
      unknown_metric_count: 0,
      ...(overrides.work_unit_metrics ?? overrides.workUnitMetrics ?? {})
    },
    file_stats: overrides.file_stats ?? overrides.fileStats ?? [
      {
        path: "packages/wiki-core/src/lib/admission-helper.mjs",
        loc: 80,
        existing_file: true,
        is_directory: false
      }
    ],
    validation_command_metadata:
      overrides.validation_command_metadata ?? overrides.validationCommandMetadata ?? [
        {
          kind: "validation_command",
          form: "shell",
          command: "npm test -- tests/work-record-admission.test.mjs"
        }
      ],
    runtime_mode_metadata: overrides.runtime_mode_metadata ?? overrides.runtimeModeMetadata ?? [{ mode: "local" }],
    artifact_kind_metadata: overrides.artifact_kind_metadata ?? overrides.artifactKindMetadata ?? [{ kind: "test" }],
    metric_source_provenance:
      overrides.metric_source_provenance ?? overrides.metricSourceProvenance ?? {
        source_kind: "canonical_work_record",
        canonicality: "canonical",
        evidence_basis: "normalized_record_projection",
        policy_backend: "portfolio-local",
        policy_version: "worker-admission-policy.v1"
      },
    policy_profile: profile
  };
}

test("work unit atomicity records incomplete and invalid file_stats evidence without collapsing valid counts", () => {
  const missingStateResult = createWorkRecordAdmissionEnvelope({
    dispatch_readiness: baseDispatchReadiness(),
    graph_impact: graphImpactFixture(),
    node_engine_api_key: null,
    ...baseBreadthInputs({
      work_unit_metrics: {
        write_scope_count: 2,
        write_scope_existing_file_count: 1,
        write_scope_directory_count: 0,
        write_scope_total_loc: 120,
        max_write_file_loc: 80,
        acceptance_criteria_count: 1,
        validation_command_count: 1,
        declared_runtime_mode_count: 1,
        artifact_kind_count: 1,
        expected_changed_line_budget: 120,
        unknown_metric_count: 0
      },
      file_stats: [
        {
          path: "packages/wiki-core/src/lib/admission-helper-a.mjs",
          loc: 40,
          existing_file: true,
          is_directory: false
        },
        {
          path: "packages/wiki-core/src/lib/admission-helper-b.mjs",
          loc: 80
        }
      ],
      policy_profile: {
        thresholds: {
          review_when_write_scope_count_above: 10,
          review_when_write_scope_total_loc_above: 1000,
          review_when_max_write_file_loc_above: 1000,
          review_when_acceptance_criteria_count_above: 10,
          review_when_validation_command_count_above: 10,
          review_when_declared_runtime_mode_count_above: 10,
          review_when_artifact_kind_count_above: 10,
          review_when_expected_changed_line_budget_above: 1000,
          deny_when_write_scope_count_above: 10,
          deny_when_write_scope_total_loc_above: 1000,
          deny_when_max_write_file_loc_above: 1000
        }
      }
    })
  });

  assert.equal(missingStateResult.components.work_unit_atomicity.decision, "review_required");
  assert.ok(missingStateResult.metrics.work_unit_atomicity.unknown_metric_count > 0);
  assert.equal(missingStateResult.metrics.work_unit_atomicity.write_scope_count, 2);
  assert.equal(missingStateResult.metrics.work_unit_atomicity.write_scope_total_loc, 120);
  assert.equal(missingStateResult.metrics.work_unit_atomicity.max_write_file_loc, 80);
  assert.equal(missingStateResult.metrics.work_unit_atomicity.evidence_issues.file_stats.missing_file_state_count, 2);
  assert.equal(
    missingStateResult.components.work_unit_atomicity.request.evidence.source_issues.file_stats.missing_file_state_count,
    2
  );
  assert.equal(
    missingStateResult.components.work_unit_atomicity.request.evidence.source_issues.file_stats.missing_file_state_entries[0].field_path,
    "file_stats[1].existing_file"
  );
  assert.equal(
    missingStateResult.components.work_unit_atomicity.request.evidence.source_issues.file_stats.missing_file_state_entries[0].reason_code,
    "worker_admission.work_unit_atomicity.file_stats_existing_file_missing.v1"
  );
  assert.equal(
    missingStateResult.components.work_unit_atomicity.request.evidence.source_inputs.file_stats[1].existing_file,
    null
  );
  assert.equal(
    missingStateResult.components.work_unit_atomicity.request.evidence.source_inputs.file_stats[1].is_directory,
    null
  );
  assert.equal(missingStateResult.components.work_unit_atomicity.request.evidence.source_inputs.file_stats[1].evidence.existing_file, "missing");
  assert.equal(missingStateResult.components.work_unit_atomicity.request.evidence.source_inputs.file_stats[1].evidence.is_directory, "missing");

  const invalidEntryResult = createWorkRecordAdmissionEnvelope({
    dispatch_readiness: baseDispatchReadiness(),
    graph_impact: graphImpactFixture(),
    node_engine_api_key: null,
    ...baseBreadthInputs({
      work_unit_metrics: {
        write_scope_count: 2,
        write_scope_existing_file_count: 2,
        write_scope_directory_count: 0,
        write_scope_total_loc: 70,
        max_write_file_loc: 60,
        acceptance_criteria_count: 1,
        validation_command_count: 1,
        declared_runtime_mode_count: 1,
        artifact_kind_count: 1,
        expected_changed_line_budget: 120,
        unknown_metric_count: 0
      },
      file_stats: [
        {
          path: "packages/wiki-core/src/lib/admission-helper-a.mjs",
          loc: 60,
          existing_file: true,
          is_directory: false
        },
        "not-an-object",
        {
          path: "packages/wiki-core/src/lib/admission-helper-c.mjs",
          loc: 10,
          existing_file: true,
          is_directory: false
        }
      ],
      policy_profile: {
        thresholds: {
          review_when_write_scope_count_above: 10,
          review_when_write_scope_total_loc_above: 1000,
          review_when_max_write_file_loc_above: 1000,
          review_when_acceptance_criteria_count_above: 10,
          review_when_validation_command_count_above: 10,
          review_when_declared_runtime_mode_count_above: 10,
          review_when_artifact_kind_count_above: 10,
          review_when_expected_changed_line_budget_above: 1000,
          deny_when_write_scope_count_above: 10,
          deny_when_write_scope_total_loc_above: 1000,
          deny_when_max_write_file_loc_above: 1000
        }
      }
    })
  });

  assert.equal(invalidEntryResult.components.work_unit_atomicity.decision, "review_required");
  assert.ok(invalidEntryResult.metrics.work_unit_atomicity.unknown_metric_count > 0);
  assert.equal(invalidEntryResult.metrics.work_unit_atomicity.write_scope_count, 2);
  assert.equal(invalidEntryResult.metrics.work_unit_atomicity.evidence_issues.file_stats.invalid_count, 1);
  assert.equal(invalidEntryResult.components.work_unit_atomicity.request.evidence.source_issues.file_stats.invalid_count, 1);
  assert.equal(
    invalidEntryResult.components.work_unit_atomicity.request.evidence.source_issues.file_stats.invalid_entries[0].field_path,
    "file_stats[1]"
  );
  assert.equal(
    invalidEntryResult.components.work_unit_atomicity.request.evidence.source_issues.file_stats.invalid_entries[0].reason_code,
    "worker_admission.work_unit_atomicity.file_stats_entry_invalid.v1"
  );
  assert.equal(invalidEntryResult.components.work_unit_atomicity.request.evidence.source_inputs.file_stats[1].status, "invalid");
  assert.equal(
    invalidEntryResult.components.work_unit_atomicity.request.evidence.source_inputs.file_stats[1].evidence.reason_code,
    "worker_admission.work_unit_atomicity.file_stats_entry_invalid.v1"
  );
});

test("work unit atomicity rejects string-valued file state evidence", () => {
  const stringStateResult = createWorkRecordAdmissionEnvelope({
    dispatch_readiness: baseDispatchReadiness(),
    graph_impact: graphImpactFixture(),
    node_engine_api_key: null,
    ...baseBreadthInputs({
      work_unit_metrics: {
        write_scope_count: 1,
        write_scope_existing_file_count: 1,
        write_scope_directory_count: 0,
        write_scope_total_loc: 45,
        max_write_file_loc: 45,
        acceptance_criteria_count: 1,
        validation_command_count: 1,
        declared_runtime_mode_count: 1,
        artifact_kind_count: 1,
        expected_changed_line_budget: 120,
        unknown_metric_count: 0
      },
      file_stats: [
        {
          path: "packages/wiki-core/src/lib/admission-helper-string-state.mjs",
          loc: 45,
          existing_file: "false",
          is_directory: "true"
        }
      ],
      policy_profile: {
        thresholds: {
          review_when_write_scope_count_above: 10,
          review_when_write_scope_total_loc_above: 1000,
          review_when_max_write_file_loc_above: 1000,
          review_when_acceptance_criteria_count_above: 10,
          review_when_validation_command_count_above: 10,
          review_when_declared_runtime_mode_count_above: 10,
          review_when_artifact_kind_count_above: 10,
          review_when_expected_changed_line_budget_above: 1000,
          deny_when_write_scope_count_above: 10,
          deny_when_write_scope_total_loc_above: 1000,
          deny_when_max_write_file_loc_above: 1000
        }
      }
    })
  });

  assert.notEqual(stringStateResult.components.work_unit_atomicity.decision, "allow");
  assert.equal(stringStateResult.components.work_unit_atomicity.decision, "review_required");
  assert.ok(stringStateResult.metrics.work_unit_atomicity.unknown_metric_count > 0);
  assert.equal(stringStateResult.metrics.work_unit_atomicity.evidence_issues.file_stats.invalid_file_state_count, 2);
  assert.equal(stringStateResult.components.work_unit_atomicity.request.evidence.source_issues.file_stats.invalid_file_state_count, 2);
  assert.equal(
    stringStateResult.components.work_unit_atomicity.request.evidence.source_issues.file_stats.invalid_file_state_entries[0].field_path,
    "file_stats[0].existing_file"
  );
  assert.equal(
    stringStateResult.components.work_unit_atomicity.request.evidence.source_issues.file_stats.invalid_file_state_entries[0].reason_code,
    "worker_admission.work_unit_atomicity.file_stats_existing_file_invalid.v1"
  );
  assert.equal(
    stringStateResult.components.work_unit_atomicity.request.evidence.source_issues.file_stats.invalid_file_state_entries[0].raw_value,
    "false"
  );
  assert.equal(
    stringStateResult.components.work_unit_atomicity.request.evidence.source_issues.file_stats.invalid_file_state_entries[1].field_path,
    "file_stats[0].is_directory"
  );
  assert.equal(
    stringStateResult.components.work_unit_atomicity.request.evidence.source_issues.file_stats.invalid_file_state_entries[1].reason_code,
    "worker_admission.work_unit_atomicity.file_stats_is_directory_invalid.v1"
  );
  assert.equal(
    stringStateResult.components.work_unit_atomicity.request.evidence.source_issues.file_stats.invalid_file_state_entries[1].raw_value,
    "true"
  );
  assert.equal(stringStateResult.components.work_unit_atomicity.request.evidence.source_inputs.file_stats[0].existing_file, null);
  assert.equal(stringStateResult.components.work_unit_atomicity.request.evidence.source_inputs.file_stats[0].is_directory, null);
  assert.equal(stringStateResult.components.work_unit_atomicity.request.evidence.source_inputs.file_stats[0].evidence.existing_file, "invalid");
  assert.equal(stringStateResult.components.work_unit_atomicity.request.evidence.source_inputs.file_stats[0].evidence.is_directory, "invalid");
});
