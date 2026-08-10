import assert from "node:assert/strict";
import test from "node:test";

import {
  auditSchema,
  parseArgs,
  selectAuditCases,
  splitAuditCases,
  validateAuditPayload
} from "./development/tools/run-residue-audit.mjs";

function row(id, residue, { schemaValid = true } = {}) {
  return {
    source_criterion_id: id,
    source_text: `${id} source`,
    payload: {},
    reference_catalog: [],
    compiler: {
      schema_valid: schemaValid,
      diagnostics: [],
      evaluation: {
        residue: residue.map(([text, reason]) => ({
          text,
          reason,
          diagnostic_reasons: [reason]
        }))
      }
    }
  };
}

test("residue audit defaults to a bounded no-retry Vertex run", () => {
  const options = parseArgs(["--dry-run", "--ledger", "/tmp/frozen-ledger.jsonl"]);
  assert.equal(options.model, "gemini-3.6-flash");
  assert.equal(options.thinkingLevel, "LOW");
  assert.equal(options.concurrency, 8);
  assert.equal(options.maxSpansPerCall, 8);
  assert.equal(options.dryRun, true);
});

test("large criterion audits split into bounded calls without dropping spans", () => {
  const item = {
    row: row("WK-1:a", []),
    selection_reasons: ["test"],
    target_residue_texts: Array.from({ length: 19 }, (_, index) => `span-${index + 1}`)
  };
  const parts = splitAuditCases([item], 8);
  assert.deepEqual(parts.map((part) => part.target_residue_texts.length), [8, 8, 3]);
  assert.deepEqual(parts.map((part) => part.audit_part), [1, 2, 3]);
  assert.ok(parts.every((part) => part.audit_parts === 3));
  assert.deepEqual(parts.flatMap((part) => part.target_residue_texts), item.target_residue_texts);
});

test("selection is deterministic and retains the schema-invalid case", () => {
  const rows = [
    row("WK-1:a", [["shared", "unsupported_by_controlled_grammar"]]),
    row("WK-2:a", [["shared", "unsupported_by_controlled_grammar"]]),
    row("WK-3:a", [["unique", "invalid_controlled_claim"]], { schemaValid: false })
  ];
  const first = selectAuditCases(rows);
  const second = selectAuditCases(rows);
  assert.deepEqual(
    first.map((item) => [item.row.source_criterion_id, item.selection_reasons, item.target_residue_texts]),
    second.map((item) => [item.row.source_criterion_id, item.selection_reasons, item.target_residue_texts])
  );
  assert.equal(
    first.find((item) => item.row.source_criterion_id === "WK-3:a").selection_reasons.includes("schema_invalid"),
    true
  );
});

test("schema-invalid criteria without residue still produce one audit invocation", () => {
  const selected = selectAuditCases([
    row("WK-3:a", [], { schemaValid: false })
  ]);
  const parts = splitAuditCases(selected, 8);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].audit_part, 1);
  assert.equal(parts[0].audit_parts, 1);
  assert.deepEqual(parts[0].target_residue_texts, []);
  const schema = auditSchema(parts[0]);
  assert.equal(schema.properties.findings.minItems, 0);
  assert.equal("items" in schema.properties.findings, false);
  assert.equal(schema.required.includes("schema_invalid_assessment"), true);
  assert.throws(
    () => validateAuditPayload({ findings: [] }, parts[0]),
    /schema-invalid criterion/
  );
  assert.doesNotThrow(() => validateAuditPayload({
    findings: [],
    schema_invalid_assessment: {
      primary_cause: "compiler_schema_defect",
      recommended_action: "fix_compiler_or_schema",
      confidence: "high",
      explanation: "The wire grammar admitted an unnormalizable range."
    }
  }, parts[0]));
});

test("audit schema and integrity check require each selected span once", () => {
  const item = {
    row: row("WK-1:a", [["alpha", "unsupported_by_controlled_grammar"]]),
    selection_reasons: ["test"],
    target_residue_texts: ["alpha", "beta"]
  };
  const schema = auditSchema(item);
  assert.equal(schema.properties.findings.minItems, 2);
  const payload = {
    findings: [{ residue_text: "alpha" }, { residue_text: "beta" }]
  };
  assert.doesNotThrow(() => validateAuditPayload(payload, item));
  assert.throws(
    () => validateAuditPayload({ findings: [{ residue_text: "alpha" }] }, item),
    /exactly once/
  );
});
