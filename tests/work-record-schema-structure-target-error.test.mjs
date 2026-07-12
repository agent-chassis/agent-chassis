

import assert from "node:assert/strict";
import test from "node:test";

import { validateExpectedEditTargets } from "../packages/wiki-core/src/lib/work-record-schema-structure.mjs";
import {
  WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES,
  WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES
} from "../packages/wiki-core/src/lib/work-record-target-metrics.mjs";

function collect(entry) {
  const diagnostics = [];
  validateExpectedEditTargets(diagnostics, [entry], "expected_edit_targets");
  return diagnostics;
}

function findByPath(diagnostics, path) {
  return diagnostics.find((diagnostic) => diagnostic.path === path);
}

test("invalid expected_edit_targets kind lists every allowed kind value", () => {
  const diagnostics = collect({
    name: "bad-kind",
    path: "packages/example.mjs",
    kind: "not_a_real_kind",
    operation: "modify"
  });

  const diagnostic = findByPath(diagnostics, "expected_edit_targets[0].kind");
  assert.ok(diagnostic, "expected a diagnostic for the invalid kind");

  const allowed = [
    "function",
    "method",
    "class",
    "module",
    "export",
    "test_case",
    "schema_field",
    "docs_section",
    "config_key",
    "other"
  ];
  assert.deepEqual(
    [...WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES],
    allowed,
    "the exported kind constant must contain exactly the ten known kind values"
  );
  for (const value of allowed) {
    assert.ok(
      diagnostic.message.includes(value),
      `kind error message must list allowed value "${value}"`
    );
  }
});

test("invalid expected_edit_targets operation lists every allowed operation value", () => {
  const diagnostics = collect({
    name: "bad-operation",
    path: "packages/example.mjs",
    kind: "function",
    operation: "mutate"
  });

  const diagnostic = findByPath(diagnostics, "expected_edit_targets[0].operation");
  assert.ok(diagnostic, "expected a diagnostic for the invalid operation");

  const allowed = ["create", "modify", "delete", "inspect"];
  assert.deepEqual(
    [...WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES],
    allowed,
    "the exported operation constant must contain exactly the four known operations"
  );
  for (const value of allowed) {
    assert.ok(
      diagnostic.message.includes(value),
      `operation error message must list allowed value "${value}"`
    );
  }
});

test("kind/operation error messages are single-sourced from the exported constants", () => {
  const kindDiagnostic = findByPath(
    collect({
      name: "bad-kind",
      path: "packages/example.mjs",
      kind: "not_a_real_kind",
      operation: "modify"
    }),
    "expected_edit_targets[0].kind"
  );
  const operationDiagnostic = findByPath(
    collect({
      name: "bad-operation",
      path: "packages/example.mjs",
      kind: "function",
      operation: "mutate"
    }),
    "expected_edit_targets[0].operation"
  );

  assert.ok(kindDiagnostic);
  assert.ok(operationDiagnostic);

  assert.ok(
    kindDiagnostic.message.includes(
      WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES.join(", ")
    ),
    "kind message must be derived from WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES"
  );
  assert.ok(
    operationDiagnostic.message.includes(
      WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES.join(", ")
    ),
    "operation message must be derived from WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES"
  );
});
