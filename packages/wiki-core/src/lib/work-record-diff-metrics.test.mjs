import test from "node:test";
import assert from "node:assert/strict";

import {
  compareChangedLineBudget,
  normalizeDiffFootprintMetrics
} from "./work-record-diff-metrics.mjs";

test("normalizeDiffFootprintMetrics and compareChangedLineBudget stay input-driven", () => {
  const absentMetrics = normalizeDiffFootprintMetrics({
    write_scope: ["packages/wiki-core/src/lib/work-record-diff-metrics.mjs"]
  });

  assert.deepEqual(absentMetrics, {
    changed_file_count: null,
    changed_line_count: null,
    added_line_count: null,
    deleted_line_count: null,
    hunk_count: null,
    expected_changed_line_budget: null,
    changed_line_budget_status: "not_comparable",
    changed_line_budget_delta: null,
    changed_line_budget_exceeded: null,
    diff_footprint_evidence_status: "absent",
    diff_footprint_status_reason: "no diff_footprint_metrics field supplied",
    per_file_diff_footprint: []
  });

  const malformedInput = {
    diff_footprint_metrics: {
      expected_changed_line_budget: "5",
      per_file_diff_footprint: [
        {
          path: "./packages/wiki-core/src/lib/work-record-diff-metrics.mjs",
          changed_line_count: 4,
          added_line_count: 2,
          deleted_line_count: 2,
          hunk_count: 1
        },
        "not-an-entry"
      ]
    }
  };
  const malformedMetrics = normalizeDiffFootprintMetrics(malformedInput);

  const originalEnv = {
    GIT_DIR: process.env.GIT_DIR,
    GIT_WORK_TREE: process.env.GIT_WORK_TREE,
    HOME: process.env.HOME
  };
  process.env.GIT_DIR = "/tmp/not-a-real-git-dir";
  process.env.GIT_WORK_TREE = "/tmp/not-a-real-work-tree";
  process.env.HOME = "/tmp/not-a-real-home";
  const malformedMetricsWithDifferentEnv = normalizeDiffFootprintMetrics(malformedInput);
  process.env.GIT_DIR = originalEnv.GIT_DIR;
  process.env.GIT_WORK_TREE = originalEnv.GIT_WORK_TREE;
  process.env.HOME = originalEnv.HOME;

  assert.deepEqual(malformedMetricsWithDifferentEnv, malformedMetrics);
  assert.equal(malformedMetrics.diff_footprint_evidence_status, "degraded");
  assert.equal(
    malformedMetrics.diff_footprint_status_reason,
    "diff-footprint evidence contains invalid counts or malformed entries"
  );
  assert.deepEqual(malformedMetrics.per_file_diff_footprint, [
    {
      index: 0,
      path: "packages/wiki-core/src/lib/work-record-diff-metrics.mjs",
      changed_line_count: 4,
      changed_line_count_source: "supplied",
      added_line_count: 2,
      deleted_line_count: 2,
      hunk_count: 1,
      status: "present",
      evidence: {
        issue: "per_file_diff_footprint.entry",
        status: "present",
        reason: "per-file diff footprint supplied"
      }
    },
    {
      index: 1,
      status: "invalid",
      evidence: {
        issue: "per_file_diff_footprint.entry",
        status: "invalid",
        reason: "per_file_diff_footprint entries must be objects"
      }
    }
  ]);

  const perFileMetrics = normalizeDiffFootprintMetrics({
    diff_footprint_metrics: {
      changed_line_count: 9,
      per_file_diff_footprint: [
        {
          path: "./packages/wiki-core/src/lib/work-record-diff-metrics.mjs",
          changed_line_count: 4,
          added_line_count: 2,
          deleted_line_count: 2,
          hunk_count: 1
        },
        {
          path: "tests/work-record-diff-metrics.test.mjs",
          changed_lines: 5,
          insertions: 3,
          deletions: 2,
          hunks: 2
        }
      ]
    }
  });

  assert.equal(perFileMetrics.diff_footprint_evidence_status, "present");
  assert.equal(perFileMetrics.diff_footprint_status_reason, "diff-footprint evidence supplied");
  assert.equal(perFileMetrics.changed_file_count, 2);
  assert.equal(perFileMetrics.changed_line_count, 9);
  assert.equal(perFileMetrics.added_line_count, 5);
  assert.equal(perFileMetrics.deleted_line_count, 4);
  assert.equal(perFileMetrics.hunk_count, 3);
  assert.deepEqual(perFileMetrics.per_file_diff_footprint, [
    {
      index: 0,
      path: "packages/wiki-core/src/lib/work-record-diff-metrics.mjs",
      changed_line_count: 4,
      changed_line_count_source: "supplied",
      added_line_count: 2,
      deleted_line_count: 2,
      hunk_count: 1,
      status: "present",
      evidence: {
        issue: "per_file_diff_footprint.entry",
        status: "present",
        reason: "per-file diff footprint supplied"
      }
    },
    {
      index: 1,
      path: "tests/work-record-diff-metrics.test.mjs",
      changed_line_count: 5,
      changed_line_count_source: "supplied",
      added_line_count: 3,
      deleted_line_count: 2,
      hunk_count: 2,
      status: "present",
      evidence: {
        issue: "per_file_diff_footprint.entry",
        status: "present",
        reason: "per-file diff footprint supplied"
      }
    }
  ]);

  assert.deepEqual(compareChangedLineBudget(7, 10), {
    actual_changed_line_count: 7,
    expected_changed_line_budget: 10,
    changed_line_budget_status: "within_budget",
    changed_line_budget_delta: -3,
    changed_line_budget_exceeded: false
  });

  assert.deepEqual(compareChangedLineBudget(12, 10), {
    actual_changed_line_count: 12,
    expected_changed_line_budget: 10,
    changed_line_budget_status: "exceeds_budget",
    changed_line_budget_delta: 2,
    changed_line_budget_exceeded: true
  });

  const budgetMetrics = normalizeDiffFootprintMetrics({
    diff_footprint_metrics: {
      changed_line_count: 12,
      expected_changed_line_budget: 10,
      per_file_diff_footprint: [
        {
          path: "packages/wiki-core/src/lib/work-record-diff-metrics.mjs",
          changed_line_count: 12,
          added_line_count: 8,
          deleted_line_count: 4,
          hunk_count: 2
        }
      ]
    }
  });

  assert.equal(budgetMetrics.expected_changed_line_budget, 10);
  assert.equal(budgetMetrics.changed_line_budget_status, "exceeds_budget");
  assert.equal(budgetMetrics.changed_line_budget_delta, 2);
  assert.equal(budgetMetrics.changed_line_budget_exceeded, true);
});
