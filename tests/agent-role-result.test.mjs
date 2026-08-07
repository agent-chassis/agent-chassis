import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv from "ajv";

import { resolveAgentRoleResultSchemaPath } from "../packages/agent-launch-core/src/lib/agent-role-result-schema-path.mjs";
import {
  parseAgentRoleResult,
  validateAgentRoleResult
} from "../packages/agent-launch-core/src/lib/agent-role-result.mjs";

const FIXTURE_CONTROL_IDS = Object.freeze([
  "write_scope_total_loc",
  "max_write_file_loc",
  "validation_command_count"
]);

const zeroCounts = Object.freeze({
  total: 0,
  blocking: 0,
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0
});

function basePayload(overrides = {}) {
  return {
    schema_version: "agent-role-result.v1",
    reported_role: "reviewer",
    reported_subject: "WK-0999#SLICE-003",
    reported_outcome: "no_findings",
    summary: "No findings.",
    findings: [],
    finding_counts: { ...zeroCounts },
    reviewed_controls: FIXTURE_CONTROL_IDS.map((control_id) => ({
      control_id,
      result: "pass"
    })),
    ...overrides
  };
}

function finding(overrides = {}) {
  return {
    id: "F-001",
    title: "parser accepts invalid control",
    severity: "high",
    blocking: true,
    affected_paths: [
      { path: "packages/agent-launch-core/src/lib/agent-role-result.mjs", line: 42 }
    ],
    control_id: "write_scope_total_loc",
    ...overrides
  };
}

function terminalFence(payload) {
  return `Coordinator-facing notes before the terminal result.\n\n\`\`\`agent-role-result.v1\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
}

function codes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function assertInvalid(result, code) {
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes(code), `${code} missing from ${JSON.stringify(codes(result))}`);
}

async function compileAgentRoleResultSchema() {
  const schemaPath = resolveAgentRoleResultSchemaPath();
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: true });
  return { schemaPath, validateSchema: ajv.compile(schema) };
}

function assertSchemaValid(validateSchema, payload) {
  assert.equal(
    validateSchema(payload),
    true,
    `schema rejected ${JSON.stringify(payload)} with ${JSON.stringify(validateSchema.errors)}`
  );
}

function assertSchemaInvalid(validateSchema, payload) {
  assert.equal(validateSchema(payload), false, `schema unexpectedly accepted ${JSON.stringify(payload)}`);
}

test("parses valid worker raw JSON as child evidence only", () => {
  const payload = basePayload({
    reported_role: "worker",
    reported_outcome: "completed",
    reviewed_controls: []
  });

  const result = parseAgentRoleResult(JSON.stringify(payload));

  assert.equal(result.valid, true);
  assert.equal(result.candidate.kind, "raw_json");
  assert.equal(result.authority, "child_evidence_only");
  assert.equal(Object.hasOwn(result, "review_result"), false);
  assert.deepEqual(result.claims, {
    reported_role: "worker",
    reported_subject: "WK-0999#SLICE-003",
    reported_outcome: "completed"
  });
  assert.deepEqual(result.result.finding_counts, zeroCounts);
});

test("parses a valid reviewer terminal marked block with reviewed controls", () => {
  const result = parseAgentRoleResult(terminalFence(basePayload()));

  assert.equal(result.valid, true);
  assert.equal(result.candidate.kind, "marked_fence");
  assert.deepEqual(
    result.result.reviewed_controls.map((control) => control.control_id),
    FIXTURE_CONTROL_IDS
  );
});

test("parses a valid redteam changes_requested result with recomputed counts", () => {
  const payload = basePayload({
    reported_role: "redteam",
    reported_outcome: "changes_requested",
    summary: "1 finding requires changes.",
    findings: [finding({ severity: "medium", blocking: false })],
    finding_counts: {
      total: 1,
      blocking: 0,
      critical: 0,
      high: 0,
      medium: 1,
      low: 0,
      info: 0
    }
  });

  const result = parseAgentRoleResult(terminalFence(payload));

  assert.equal(result.valid, true);
  assert.deepEqual(result.result.recomputed_finding_counts, payload.finding_counts);
});

test("rejects missing, malformed, ordinary, multiple, trailing, oversized, and duplicate-key candidates", () => {
  assertInvalid(parseAgentRoleResult("Plain prose with no structured terminal block."), "missing_result");

  assertInvalid(
    parseAgentRoleResult("```agent-role-result.v1\n{\"schema_version\":\n```"),
    "malformed_json"
  );

  assertInvalid(parseAgentRoleResult(`\`\`\`json\n${JSON.stringify(basePayload())}\n\`\`\``), "ordinary_json_code_block");

  assertInvalid(
    parseAgentRoleResult(`\`\`\`json\n{"example": true}\n\`\`\`\n\n${terminalFence(basePayload())}`),
    "multiple_json_candidates"
  );

  assertInvalid(
    parseAgentRoleResult(`\`\`\`json\n{"example": true}\n\`\`\`\n\n${JSON.stringify(basePayload())}`),
    "multiple_json_candidates"
  );
});

test("rejects trailing prose after a terminal raw JSON object", () => {
  assertInvalid(parseAgentRoleResult(`${JSON.stringify(basePayload())}\nextra prose`), "trailing_prose_after_result");
});

test("rejects oversized payloads without echoing raw response text", () => {
  const result = parseAgentRoleResult(JSON.stringify(basePayload({ summary: "large" })), {
    maxPayloadBytes: 10
  });

  assertInvalid(result, "payload_oversized");
  assert.doesNotMatch(JSON.stringify(result.diagnostics), /agent-role-result\.v1/);
});

test("rejects duplicate JSON keys when detectable", () => {
  const result = parseAgentRoleResult(`{
    "schema_version": "agent-role-result.v1",
    "schema_version": "agent-role-result.v1",
    "reported_role": "worker",
    "reported_subject": "WK-0999#SLICE-003",
    "reported_outcome": "completed",
    "findings": [],
    "finding_counts": ${JSON.stringify(zeroCounts)},
    "reviewed_controls": []
  }`);

  assertInvalid(result, "duplicate_json_key");
});

test("honors maxDiagnosticCount for parser-level invalid results", () => {
  const result = parseAgentRoleResult(`{
    "schema_version": "agent-role-result.v1",
    "schema_version": "agent-role-result.v1",
    "reported_role": "worker",
    "reported_role": "worker",
    "reported_subject": "WK-0999#SLICE-003",
    "reported_outcome": "completed",
    "findings": [],
    "finding_counts": ${JSON.stringify(zeroCounts)},
    "reviewed_controls": []
  }`, {
    maxDiagnosticCount: 1
  });

  assert.equal(result.valid, false);
  assert.deepEqual(codes(result), ["duplicate_json_key"]);
});

test("validates exact top-level fields and rejects authority fields", () => {
  assertInvalid(validateAgentRoleResult(basePayload({ unexpected: true })), "unknown_field");
  assertInvalid(validateAgentRoleResult(basePayload({ terminal_status: "succeeded" })), "authority_field_forbidden");
  assertInvalid(validateAgentRoleResult(basePayload({ status: "done" })), "authority_field_forbidden");
  assertInvalid(validateAgentRoleResult(basePayload({ source_digest_authority: "child" })), "authority_field_forbidden");
});

test("rejects schema mismatch and role/outcome cross-product mismatches", () => {
  assertInvalid(validateAgentRoleResult(basePayload({ schema_version: "agent-role-result.v2" })), "schema_mismatch");
  assertInvalid(
    validateAgentRoleResult(basePayload({ reported_role: "worker", reported_outcome: "no_findings" })),
    "role_outcome_mismatch"
  );
  assertInvalid(
    validateAgentRoleResult(basePayload({ reported_role: "reviewer", reported_outcome: "completed" })),
    "role_outcome_mismatch"
  );
});

test("validates reviewer/redteam finding shape, severity, blocking, affected paths, and duplicate ids", () => {
  assertInvalid(
    validateAgentRoleResult(basePayload({
      reported_outcome: "changes_requested",
      findings: [finding({ severity: "warning" })],
      finding_counts: { ...zeroCounts, total: 1, high: 1, blocking: 1 }
    })),
    "invalid_severity"
  );
  assertInvalid(
    validateAgentRoleResult(basePayload({
      reported_outcome: "changes_requested",
      findings: [finding({ blocking: "yes" })],
      finding_counts: { ...zeroCounts, total: 1, high: 1 }
    })),
    "invalid_blocking"
  );
  assertInvalid(
    validateAgentRoleResult(basePayload({
      reported_outcome: "changes_requested",
      findings: [finding({
        affected_paths: [{ path: "../outside.mjs", line: 1 }]
      })],
      finding_counts: { ...zeroCounts, total: 1, high: 1, blocking: 1 }
    })),
    "invalid_affected_path"
  );
  assertInvalid(
    validateAgentRoleResult(basePayload({
      reported_outcome: "changes_requested",
      findings: [finding(), finding({ id: "F-001", severity: "medium", blocking: false })],
      finding_counts: { ...zeroCounts, total: 2, high: 1, medium: 1, blocking: 1 }
    })),
    "duplicate_finding_id"
  );
});

test("recomputes finding counts and rejects mismatches", () => {
  const result = validateAgentRoleResult(basePayload({
    reported_outcome: "changes_requested",
    summary: "1 finding.",
    findings: [finding({ severity: "low", blocking: false })],
    finding_counts: {
      total: 1,
      blocking: 0,
      critical: 0,
      high: 1,
      medium: 0,
      low: 0,
      info: 0
    }
  }));

  assertInvalid(result, "finding_count_mismatch");
});

test("rejects outcome conflicts with structured findings and detectable summary-count prose", () => {
  assert.equal(
    validateAgentRoleResult(basePayload({
      reported_outcome: "changes_requested",
      summary: "1 blocking finding and 1 low finding.",
      findings: [
        finding({ severity: "high", blocking: true }),
        finding({ id: "F-002", severity: "low", blocking: false })
      ],
      finding_counts: { ...zeroCounts, total: 2, blocking: 1, high: 1, low: 1 }
    })).valid,
    true
  );
  assertInvalid(
    validateAgentRoleResult(basePayload({
      reported_outcome: "no_findings",
      findings: [finding({ severity: "low", blocking: false })],
      finding_counts: { ...zeroCounts, total: 1, low: 1 }
    })),
    "outcome_findings_mismatch"
  );
  assertInvalid(
    validateAgentRoleResult(basePayload({
      reported_outcome: "passed_no_blocking_or_medium_findings",
      findings: [finding({ severity: "medium", blocking: false })],
      finding_counts: { ...zeroCounts, total: 1, medium: 1 }
    })),
    "outcome_findings_mismatch"
  );
  assertInvalid(
    validateAgentRoleResult(basePayload({
      reported_outcome: "changes_requested",
      summary: "No findings.",
      findings: [finding({ severity: "high", blocking: true })],
      finding_counts: { ...zeroCounts, total: 1, high: 1, blocking: 1 }
    })),
    "summary_count_conflict"
  );
  assertInvalid(
    validateAgentRoleResult(basePayload({
      reported_outcome: "changes_requested",
      summary: "1 finding.",
      findings: [
        finding({ severity: "high", blocking: true }),
        finding({ id: "F-002", severity: "low", blocking: false })
      ],
      finding_counts: { ...zeroCounts, total: 2, blocking: 1, high: 1, low: 1 }
    })),
    "summary_count_conflict"
  );
});

test("reviewer/redteam payloads accept each reviewed_controls id", () => {
  for (const reported_role of ["reviewer", "redteam"]) {
    for (const control_id of FIXTURE_CONTROL_IDS) {
      const result = validateAgentRoleResult(basePayload({
        reported_role,
        reviewed_controls: [{ control_id, result: "pass" }]
      }));

      assert.equal(result.valid, true, `${reported_role} should accept ${control_id}`);
      assert.deepEqual(
        result.result.reviewed_controls.map((control) => control.control_id),
        [control_id]
      );
      assert.equal(result.result.reviewed_controls[0].result, "pass");
    }
  }
});

test("reviewer payload accepts several reviewed_controls in one result", () => {
  const result = validateAgentRoleResult(basePayload());

  assert.equal(result.valid, true);
  assert.deepEqual(
    result.result.reviewed_controls.map((control) => control.control_id),
    FIXTURE_CONTROL_IDS
  );
});

test("carries unrecognised, generic, namespaced, prose-like, and wrong-case reviewed_controls", () => {
  for (const control_id of [
    "unknown_control",
    "review",
    "node-engine:write_scope_total_loc",
    "node-engine:validation_command_count",
    "write scope total loc",
    "artifact kind count",
    "Write_Scope_Total_Loc",
    "MAX_WRITE_FILE_LOC",
    "sibling_visibility_count"
  ]) {
    const result = validateAgentRoleResult(basePayload({
      reviewed_controls: [{ control_id, result: "pass" }]
    }));

    assert.equal(
      result.valid,
      true,
      `${control_id} should be carried, got ${JSON.stringify(result.diagnostics)}`
    );
    assert.deepEqual(result.result.reviewed_controls, [{ control_id, result: "pass" }]);
  }
});

test("still refuses empty, wrong-type, malformed, and duplicate reviewed_controls", () => {
  for (const control_id of ["", "   ", 42, null, true, {}, []]) {
    assertInvalid(
      validateAgentRoleResult(basePayload({
        reviewed_controls: [{ control_id, result: "pass" }]
      })),
      "invalid_reviewed_control"
    );
  }

  assertInvalid(
    validateAgentRoleResult(basePayload({ reviewed_controls: "write_scope_total_loc" })),
    "invalid_reviewed_controls"
  );
  assertInvalid(
    validateAgentRoleResult(basePayload({
      reviewed_controls: [{ control_id: "unknown_control", result: "pass", extra: true }]
    })),
    "unknown_field"
  );
  assertInvalid(
    validateAgentRoleResult(basePayload({
      reviewed_controls: [{ control_id: "unknown_control", result: "warn" }]
    })),
    "invalid_reviewed_control_result"
  );

  for (const control_id of ["validation_command_count", "unknown_control"]) {
    assertInvalid(
      validateAgentRoleResult(basePayload({
        reviewed_controls: [
          { control_id, result: "pass" },
          { control_id, result: "pass" }
        ]
      })),
      "duplicate_reviewed_control"
    );
  }
});

test("preserves result:\"fail\" reviewed_controls as valid parser evidence for the backend non-clean boundary", () => {
  const result = validateAgentRoleResult(basePayload({
    reported_outcome: "changes_requested",
    summary: "1 finding requires changes.",
    findings: [finding({ severity: "medium", blocking: false })],
    finding_counts: { ...zeroCounts, total: 1, medium: 1 },
    reviewed_controls: [
      { control_id: "write_scope_total_loc", result: "pass" },
      { control_id: "validation_command_count", result: "fail" }
    ]
  }));

  assert.equal(result.valid, true);
  assert.deepEqual(result.result.reviewed_controls, [
    { control_id: "write_scope_total_loc", result: "pass" },
    { control_id: "validation_command_count", result: "fail" }
  ]);
});

test("still refuses a reviewed_controls payload over the declared byte bound", () => {
  const oversized = basePayload({
    reviewed_controls: Array.from({ length: 400 }, (_, index) => ({
      control_id: `unrecognised_control_${index}`,
      result: "pass"
    }))
  });

  const result = parseAgentRoleResult(terminalFence(oversized), { maxPayloadBytes: 512 });

  assertInvalid(result, "payload_oversized");
});

test("rejects worker review fields and does not treat worker output as attestation evidence", () => {
  const result = validateAgentRoleResult(basePayload({
    reported_role: "worker",
    reported_outcome: "completed",
    findings: [finding({ severity: "low", blocking: false })],
    finding_counts: { ...zeroCounts, total: 1, low: 1 },
    reviewed_controls: [{ control_id: "write_scope_total_loc", result: "pass" }]
  }));

  assertInvalid(result, "worker_findings_not_empty");
  assertInvalid(result, "worker_reviewed_controls_not_empty");
  assert.equal(Object.hasOwn(result, "review_result"), false);
});

test("worker payload rejects every reviewed_controls id and never becomes attestation evidence", () => {
  for (const control_id of [...FIXTURE_CONTROL_IDS, "unknown_control", "node-engine:review"]) {
    const result = validateAgentRoleResult(basePayload({
      reported_role: "worker",
      reported_outcome: "completed",
      summary: "No findings.",
      findings: [],
      finding_counts: { ...zeroCounts },
      reviewed_controls: [{ control_id, result: "pass" }]
    }));

    assertInvalid(result, "worker_reviewed_controls_not_empty");
    assert.equal(Object.hasOwn(result, "review_result"), false);
  }
});

test("agent-role-result JSON Schema path resolver points at the checked-in schema artifact", async () => {
  const { schemaPath, validateSchema } = await compileAgentRoleResultSchema();

  assert.match(schemaPath, /packages\/agent-launch-core\/data\/agent-role-result\.v1\.schema\.json$/);
  assertSchemaValid(validateSchema, basePayload());
});

function normalizeForStrictSchema(payload) {
  const p = JSON.parse(JSON.stringify(payload));
  if (!Object.hasOwn(p, "summary")) p.summary = null;
  if (Array.isArray(p.findings)) {
    p.findings = p.findings.map((f) =>
      f && typeof f === "object" && !Array.isArray(f) && !Object.hasOwn(f, "control_id")
        ? { ...f, control_id: null }
        : f
    );
  }
  return p;
}

function findingNoControl(overrides = {}) {
  const f = finding(overrides);
  delete f.control_id;
  return f;
}

test("agent-role-result JSON Schema is a conservative superset (post-normalization) of validator-valid payloads", async () => {
  const { validateSchema } = await compileAgentRoleResultSchema();
  const validatorValidPayloads = [
    ...["completed", "partial", "blocked", "failed"].map((reported_outcome) => basePayload({
      reported_role: "worker",
      reported_outcome,
      summary: `Worker reported ${reported_outcome}.`,
      findings: [],
      finding_counts: { ...zeroCounts },
      reviewed_controls: []
    })),
    basePayload({
      reported_role: "reviewer",
      reported_outcome: "no_findings",
      findings: [],
      finding_counts: { ...zeroCounts },
      reviewed_controls: []
    }),
    basePayload({
      reported_role: "reviewer",
      reported_outcome: "passed_no_blocking_or_medium_findings",
      summary: "1 low finding.",
      findings: [finding({ severity: "low", blocking: false })],
      finding_counts: { ...zeroCounts, total: 1, low: 1 },
      reviewed_controls: [{ control_id: "write_scope_total_loc", result: "pass" }]
    }),
    basePayload({
      reported_role: "reviewer",
      reported_outcome: "changes_requested",
      summary: "1 high finding.",
      findings: [finding({ severity: "high", blocking: true })],
      finding_counts: { ...zeroCounts, total: 1, blocking: 1, high: 1 },
      reviewed_controls: [{ control_id: "validation_command_count", result: "fail" }]
    }),
    basePayload({
      reported_role: "redteam",
      reported_outcome: "no_findings",
      findings: [],
      finding_counts: { ...zeroCounts },
      reviewed_controls: FIXTURE_CONTROL_IDS.map((control_id) => ({
        control_id,
        result: "pass"
      }))
    }),
    basePayload({
      reported_role: "redteam",
      reported_outcome: "passed_no_blocking_or_medium_findings",
      summary: "2 informational findings.",
      findings: [
        finding({ severity: "low", blocking: false }),
        finding({ id: "F-002", severity: "info", blocking: false, control_id: "artifact_kind_count" })
      ],
      finding_counts: { ...zeroCounts, total: 2, low: 1, info: 1 },
      reviewed_controls: [{ control_id: "artifact_kind_count", result: "pass" }]
    }),
    basePayload({
      reported_role: "redteam",
      reported_outcome: "changes_requested",
      summary: "1 medium finding.",
      findings: [finding({ severity: "medium", blocking: false, affected_paths: [{ path: "README.md", line: null }] })],
      finding_counts: { ...zeroCounts, total: 1, medium: 1 },
      reviewed_controls: [{ control_id: "expected_changed_line_budget", result: "fail" }]
    })
  ];

  const absentOptionalPayloads = [
    (() => {
      const p = basePayload({
        reported_role: "worker",
        reported_outcome: "completed",
        findings: [],
        finding_counts: { ...zeroCounts },
        reviewed_controls: []
      });
      delete p.summary;
      return p;
    })(),
    (() => {
      const p = basePayload({
        reported_role: "reviewer",
        reported_outcome: "changes_requested",
        findings: [findingNoControl({ severity: "high", blocking: true })],
        finding_counts: { ...zeroCounts, total: 1, blocking: 1, high: 1 },
        reviewed_controls: [{ control_id: "write_scope_total_loc", result: "pass" }]
      });
      delete p.summary;
      return p;
    })(),
    basePayload({
      reported_role: "redteam",
      reported_outcome: "passed_no_blocking_or_medium_findings",
      summary: "1 low finding with no mapped control.",
      findings: [findingNoControl({ severity: "low", blocking: false })],
      finding_counts: { ...zeroCounts, total: 1, low: 1 },
      reviewed_controls: [{ control_id: "artifact_kind_count", result: "pass" }]
    })
  ];

  for (const payload of [...validatorValidPayloads, ...absentOptionalPayloads]) {
    assert.equal(validateAgentRoleResult(payload).valid, true, JSON.stringify(payload));
    assertSchemaValid(validateSchema, normalizeForStrictSchema(payload));
  }
});

test("agent-role-result validator treats a null optional as equivalent to absent (F1/F4 option-c)", async () => {
  const { validateSchema } = await compileAgentRoleResultSchema();

  const nullSummary = basePayload({ summary: null });
  const nullSummaryResult = validateAgentRoleResult(nullSummary);
  assert.equal(nullSummaryResult.valid, true);
  assert.equal(nullSummaryResult.result.summary, null);
  assertSchemaValid(validateSchema, nullSummary);

  const nullControl = basePayload({
    reported_outcome: "changes_requested",
    summary: "1 high finding, no mapped control.",
    findings: [finding({ severity: "high", blocking: true, control_id: null })],
    finding_counts: { ...zeroCounts, total: 1, blocking: 1, high: 1 },
    reviewed_controls: [{ control_id: "write_scope_total_loc", result: "pass" }]
  });
  const nullControlResult = validateAgentRoleResult(nullControl);
  assert.equal(nullControlResult.valid, true, JSON.stringify(nullControlResult.diagnostics));
  assert.equal(nullControlResult.result.findings[0].control_id, null);
  assertSchemaValid(validateSchema, nullControl);

  assertInvalid(validateAgentRoleResult(basePayload({ summary: 42 })), "invalid_summary");
});

test("agent-role-result JSON Schema rejects structural, enum, and authority-field violations", async () => {
  const { validateSchema } = await compileAgentRoleResultSchema();

  assertSchemaInvalid(validateSchema, (() => {
    const payload = basePayload();
    delete payload.findings;
    return payload;
  })());
  assertSchemaInvalid(validateSchema, basePayload({ status: "done" }));
  assertSchemaInvalid(validateSchema, basePayload({ reported_role: "orchestrator" }));
  assertSchemaInvalid(validateSchema, basePayload({
    reviewed_controls: [{ control_id: "write_scope_total_loc", result: "warn" }]
  }));
  assertSchemaInvalid(validateSchema, basePayload({
    reported_outcome: "changes_requested",
    findings: [finding({ severity: "warning" })],
    finding_counts: { ...zeroCounts, total: 1, blocking: 1, high: 1 }
  }));
  assertSchemaInvalid(validateSchema, basePayload({
    finding_counts: { ...zeroCounts, extra: 0 }
  }));
  assertSchemaInvalid(validateSchema, basePayload({
    reported_outcome: "changes_requested",
    findings: [finding({ extra: true })],
    finding_counts: { ...zeroCounts, total: 1, blocking: 1, high: 1 }
  }));
  assertSchemaInvalid(validateSchema, basePayload({
    reviewed_controls: [{ control_id: "write_scope_total_loc", result: "pass", extra: true }]
  }));
});

test("emitted input_schema accepts an unenumerated reviewed control", async () => {
  const { validateSchema } = await compileAgentRoleResultSchema();

  for (const control_id of [
    "write_scope_test_count",
    "sibling_visibility_count",
    "node-engine:write_scope_total_loc",
    "Write_Scope_Total_Loc",
    "totally_made_up_control"
  ]) {
    const payload = basePayload({
      reviewed_controls: [{ control_id, result: "pass" }],
      findings: []
    });

    assertSchemaValid(validateSchema, normalizeForStrictSchema(payload));
    const result = validateAgentRoleResult(payload);
    assert.equal(result.valid, true, `${control_id}: ${JSON.stringify(result.diagnostics)}`);
    assert.deepEqual(result.result.reviewed_controls, [{ control_id, result: "pass" }]);
  }

  const findingPayload = basePayload({
    reported_outcome: "changes_requested",
    summary: "1 high finding.",
    findings: [finding({ severity: "high", blocking: true, control_id: "write_scope_test_count" })],
    finding_counts: { ...zeroCounts, total: 1, blocking: 1, high: 1 },
    reviewed_controls: [{ control_id: "write_scope_test_count", result: "fail" }]
  });
  assertSchemaValid(validateSchema, normalizeForStrictSchema(findingPayload));
  assert.equal(validateAgentRoleResult(findingPayload).valid, true);
});

test("emitted input_schema still refuses empty control ids and shape violations", async () => {
  const { validateSchema } = await compileAgentRoleResultSchema();

  assertSchemaInvalid(validateSchema, basePayload({
    reviewed_controls: [{ control_id: "", result: "pass" }]
  }));
  assertSchemaInvalid(validateSchema, basePayload({
    reviewed_controls: [{ control_id: 42, result: "pass" }]
  }));
  assertSchemaInvalid(validateSchema, basePayload({
    reviewed_controls: [{ control_id: null, result: "pass" }]
  }));
  assertSchemaInvalid(validateSchema, basePayload({
    reviewed_controls: [{ control_id: "write_scope_test_count", result: "warn" }]
  }));
  assertSchemaInvalid(validateSchema, basePayload({
    reviewed_controls: [{ control_id: "write_scope_test_count", result: "pass", extra: true }]
  }));
  assertSchemaInvalid(validateSchema, basePayload({
    reviewed_controls: [{ control_id: "write_scope_test_count" }]
  }));

  assertSchemaValid(validateSchema, normalizeForStrictSchema(basePayload({
    reported_outcome: "changes_requested",
    summary: "1 high finding.",
    findings: [finding({ severity: "high", blocking: true, control_id: null })],
    finding_counts: { ...zeroCounts, total: 1, blocking: 1, high: 1 }
  })));
  assertSchemaInvalid(validateSchema, basePayload({
    reported_outcome: "changes_requested",
    summary: "1 high finding.",
    findings: [finding({ severity: "high", blocking: true, control_id: "" })],
    finding_counts: { ...zeroCounts, total: 1, blocking: 1, high: 1 }
  }));
});

test("agent-role-result JSON Schema leaves cross-field semantics to validateAgentRoleResult", async () => {
  const { validateSchema } = await compileAgentRoleResultSchema();
  const countAndPathPayload = basePayload({
    reported_outcome: "no_findings",
    summary: "No findings.",
    findings: [finding({ affected_paths: [{ path: "/absolute/path.mjs", line: 1 }] })],
    finding_counts: { ...zeroCounts }
  });
  const outcomePayload = basePayload({
    reported_outcome: "changes_requested",
    summary: "No findings.",
    findings: [],
    finding_counts: { ...zeroCounts }
  });

  assertSchemaValid(validateSchema, countAndPathPayload);
  assertInvalid(validateAgentRoleResult(countAndPathPayload), "invalid_affected_path");
  assertInvalid(validateAgentRoleResult(countAndPathPayload), "finding_count_mismatch");

  assertSchemaValid(validateSchema, outcomePayload);
  assertInvalid(validateAgentRoleResult(outcomePayload), "outcome_findings_mismatch");

  const roleOutcomePayload = basePayload({ reported_role: "reviewer", reported_outcome: "completed" });
  assertSchemaValid(validateSchema, roleOutcomePayload);
  assertInvalid(validateAgentRoleResult(roleOutcomePayload), "role_outcome_mismatch");

  const workerControlsPayload = basePayload({
    reported_role: "worker",
    reported_outcome: "completed",
    findings: [],
    finding_counts: { ...zeroCounts },
    reviewed_controls: [{ control_id: "write_scope_total_loc", result: "pass" }]
  });
  assertSchemaValid(validateSchema, workerControlsPayload);
  assertInvalid(validateAgentRoleResult(workerControlsPayload), "worker_reviewed_controls_not_empty");
});

test("agent-role-result JSON Schema carries no oneOf/allOf/anyOf combinators (LLM structured-output subset)", async () => {
  const schemaPath = resolveAgentRoleResultSchemaPath();
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));

  for (const keyword of ["oneOf", "allOf", "anyOf"]) {
    assert.equal(
      Object.hasOwn(schema, keyword),
      false,
      `top-level ${keyword} is rejected by the Anthropic input_schema subset`
    );
  }

  const combinators = [];
  (function walk(node, at) {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${at}[${index}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "oneOf" || key === "allOf" || key === "anyOf") {
          combinators.push(`${at}.${key}`);
        }
        walk(value, `${at}.${key}`);
      }
    }
  })(schema, "$");
  assert.deepEqual(combinators, [], `schema must carry no combinators; found ${combinators.join(", ")}`);
});
