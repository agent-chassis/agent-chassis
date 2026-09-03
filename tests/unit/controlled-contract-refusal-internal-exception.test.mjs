

import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROLLED_CONTRACT_INTERNAL_EXCEPTION_DIAGNOSTIC_SCHEMA_VERSION,
  createControlledContractRefusal
} from "../../packages/wiki-core/src/operations/controlled-contract/refusal.mjs";
import { errorContent } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";

function payload(error) {
  return createControlledContractRefusal(error).envelope.warning.payload;
}

function typedRefusal(code, details) {
  return Object.assign(new Error(`refused: ${code}`), { code, details });
}

test("an unexpected internal exception is diagnostically distinguishable", () => {
  const projected = payload(
    new ReferenceError("WORK_RECORD_WRITE_LOCK_STALE_AFTER_MS is not defined"));

  assert.equal(projected.schema_version, "controlled-contract-refusal-payload.v1");
  assert.equal(projected.reason_code, "controlled_contract_operation_failed");

  assert.deepEqual(projected.details.internal_exception, {
    schema_version: CONTROLLED_CONTRACT_INTERNAL_EXCEPTION_DIAGNOSTIC_SCHEMA_VERSION,
    unexpected_internal_exception: true,
    caller_correctable: false,
    exception_class: "ReferenceError",
    summary: "WORK_RECORD_WRITE_LOCK_STALE_AFTER_MS is not defined",
    summary_redactions: [],
    summary_truncated: false,
    cause_class: null,
    cause_summary: null,
    cause_summary_redactions: [],
    cause_summary_truncated: false
  });
});

test("a typed refusal keeps its exact reason code and detail payload", () => {
  const projected = payload(typedRefusal("controlled_contract_carrier_busy", {
    pointer: "/selected_packs/0/profile_id",
    carrier_path: "/home/user/agent-chassis/wiki/contracts/WK-2327.json"
  }));

  assert.equal(projected.reason_code, "controlled_contract_carrier_busy");

  assert.deepEqual(projected.details, {
    pointer: "/selected_packs/0/profile_id",
    carrier_path: "/home/user/agent-chassis/wiki/contracts/WK-2327.json"
  });

  assert.equal("internal_exception" in projected.details, false);
});

test("the diagnostic preserves embedded paths and carries no stack", () => {
  const internalPath = "/home/user/agent-chassis/wiki/.work-record-write.lock";
  const error = new Error(
    `Timed out waiting for work-record write lock at ${internalPath}. Operator action required.`);
  const projected = payload(error);
  const diagnostic = projected.details.internal_exception;

  assert.equal(diagnostic.summary, error.message);
  assert.equal(diagnostic.summary.includes("/home/user"), true);

  assert.deepEqual(Object.keys(diagnostic).sort(), [
    "caller_correctable",
    "cause_class",
    "cause_summary",
    "cause_summary_redactions",
    "cause_summary_truncated",
    "exception_class",
    "schema_version",
    "summary",
    "summary_redactions",
    "summary_truncated",
    "unexpected_internal_exception"
  ].sort());
});

test("hostile-looking prose is not a redaction class", () => {
  const diagnostic = payload(new TypeError(
    "read/write and/or append failed, open '/var/lib/wiki/WK-2327.json'"
  )).details.internal_exception;

  assert.equal(diagnostic.exception_class, "TypeError");
  assert.equal(diagnostic.summary,
    "read/write and/or append failed, open '/var/lib/wiki/WK-2327.json'");
});

test("an oversized or multi-line message is preserved exactly", () => {
  const message = `first line\n  second line ${"x".repeat(4_000)}`;
  const diagnostic = payload(new Error(message))
    .details.internal_exception;

  assert.equal(diagnostic.summary, message);
  assert.equal(diagnostic.summary_truncated, false);
});

test("an Error cause preserves its path without projecting the cause object", () => {
  const cause = new RangeError("offset is out of bounds at /srv/data/x.json");
  const diagnostic = payload(new Error("publication failed", { cause }))
    .details.internal_exception;

  assert.equal(diagnostic.cause_class, "RangeError");
  assert.equal(diagnostic.cause_summary, cause.message);
});

test("a non-Error thrown value is classified rather than stringified into prose", () => {
  const diagnostic = payload("boom at /etc/wiki/config").details.internal_exception;

  assert.equal(diagnostic.exception_class, "string");
  assert.equal(diagnostic.summary, "boom at /etc/wiki/config");
});

test("the refusal still projects through both MCP channels verbatim", () => {
  const refusal = createControlledContractRefusal(
    new ReferenceError("WORK_RECORD_WRITE_LOCK_STALE_AFTER_MS is not defined"));
  const result = errorContent(refusal);

  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, refusal.envelope);

  const text = JSON.parse(result.content[0].text);
  assert.deepEqual(text, JSON.parse(JSON.stringify(refusal.envelope)));
  assert.equal(text.warning.payload.details.internal_exception.exception_class, "ReferenceError");
});
