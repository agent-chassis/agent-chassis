

import assert from "node:assert/strict";
import test from "node:test";

import {
  captureStructuredDiagnostic,
  projectDiagnostic,
  UNREADABLE_DIAGNOSTIC
} from "../../packages/wiki-core/src/lib/diagnostic-projection.mjs";
import { describeRetentionFailure, errorContent, guardToolHandler } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { projectPublicDiagnostic } from "../../packages/wiki-mcp/src/lib/verify-proof-result-detail.mjs";

const SECRET = "token-secret-value";
const DECLARED = [{ field: "credential", value: SECRET, reason: "secret_material" }];
const STRING_ORIGINAL = `authorization ${SECRET} refused\nUnicode 🚀 !?`;
const OBJECT_ORIGINAL = Object.freeze({
  operation: "fetch",
  attempts: [{ url: `https://host/${SECRET}`, status: 401 }, { url: "https://host/other", status: null }],
  nested: { token: SECRET, depth: { list: [SECRET, 1, true, null] } }
});

test("a valid structured string and nested object project to their exact originals", () => {
  for (const original of [STRING_ORIGINAL, OBJECT_ORIGINAL]) {
    const carrier = captureStructuredDiagnostic(original, { sensitiveValues: DECLARED });

    assert.deepEqual(carrier.sensitive_values, DECLARED);
    const projected = projectDiagnostic(carrier);
    assert.deepEqual(projected.value, original);
    assert.deepEqual(projected.redactions, []);
    assert.doesNotMatch(JSON.stringify(projected), /\[redacted/u);

    if (typeof original === "object") assert.notEqual(projected.value, carrier.value);
  }
});

test("generic errorContent and the proof projection agree with the owner", () => {
  for (const original of [STRING_ORIGINAL, OBJECT_ORIGINAL]) {
    const carrier = captureStructuredDiagnostic(original, { sensitiveValues: DECLARED });
    const envelope = errorContent(carrier).structuredContent;
    assert.deepEqual(envelope.diagnostic, original);
    assert.deepEqual(envelope.diagnostic_redactions, []);
    const redactions = [];
    assert.deepEqual(projectPublicDiagnostic(carrier, "diagnostics", redactions), original);
    assert.deepEqual(projectPublicDiagnostic({ nested: [carrier] }, "diagnostics", redactions),
      { nested: [original] });
    assert.deepEqual(redactions, []);
  }
});

test("a registered tool's thrown carrier reaches the caller as its original diagnostic", async () => {
  for (const original of [STRING_ORIGINAL, OBJECT_ORIGINAL]) {
    const carrier = captureStructuredDiagnostic(original, { sensitiveValues: DECLARED });
    const handler = guardToolHandler(async () => { throw carrier; }, { name: "fixture_tool" });
    const result = await handler({});
    assert.equal(result.isError, true);
    assert.deepEqual(result.structuredContent.diagnostic, original);
    assert.deepEqual(result.structuredContent.diagnostic_redactions, []);
    assert.doesNotMatch(JSON.stringify(result), /\[redacted/u);
  }
});

test("malformed carriers are still refused", () => {
  const refusals = [
    { schema_version: "structured-diagnostic.v1", value: "x",
      sensitive_values: [{ field: "credential", value: "x", reason: "not_a_reason" }] },
    { schema_version: "structured-diagnostic.v1", value: "x" },
    { schema_version: "structured-diagnostic.v1", value: { at: new Date(0) }, sensitive_values: [] },
    { schema_version: "structured-diagnostic.v1", value: Number.NaN, sensitive_values: [] }
  ];
  for (const malformed of refusals) {
    assert.throws(() => projectDiagnostic(malformed),
      { name: "TypeError", message: "structured diagnostic must use the closed schema and redaction vocabulary" });
    assert.throws(() => errorContent(malformed), TypeError);
    assert.throws(() => projectPublicDiagnostic(malformed, "diagnostics", []), TypeError);
  }
  assert.throws(() => captureStructuredDiagnostic("x",
    { sensitiveValues: [{ field: "credential", value: "x", reason: "unknown_reason" }] }),
  /structured diagnostic sensitive values/u);
});

test("non-Error throws keep their specific facts and unreadable values are not invented", () => {
  assert.equal(projectDiagnostic("thrown string /abs/path").value, "thrown string /abs/path");
  assert.equal(projectDiagnostic(42).value, 42);
  assert.equal(projectDiagnostic(null).value, null);
  assert.deepEqual(projectDiagnostic({ code: "E_X", detail: [1, "two"] }).value,
    { code: "E_X", detail: [1, "two"] });
  class Custom {}
  assert.equal(projectDiagnostic(new Custom()).value, "[Custom]");
  const hostile = new Error("baseline");
  Object.defineProperty(hostile, "message", { get() { throw new Error("getter exploded"); } });
  assert.equal(projectDiagnostic(hostile).value, UNREADABLE_DIAGNOSTIC);
});

test("a retention failure description keeps the nested cause, operation and subject", () => {
  const filesystem = Object.assign(new Error("ENOTDIR: not a directory, mkdir '/state/file/x'"),
    { code: "ENOTDIR", errno: -20, syscall: "mkdir", path: "/state/file/x" });
  const outer = Object.assign(new Error("selected-response source could not be retained",
    { cause: filesystem }), { code: "mcp_response.spill_persistence_failed.v1" });
  const described = describeRetentionFailure(outer,
    { operation: "retain_closeout_receipt", subject: { unit: "WK-1" } });
  assert.equal(described.retained, false);
  assert.equal(described.failed_operation, "retain_closeout_receipt");
  assert.deepEqual(described.subject, { unit: "WK-1" });
  assert.equal(described.cause_code, "mcp_response.spill_persistence_failed.v1");
  assert.equal(described.cause.message, outer.message);
  assert.deepEqual(
    [described.cause.cause.code, described.cause.cause.syscall, described.cause.cause.path,
      described.cause.cause.message],
    ["ENOTDIR", "mkdir", "/state/file/x", filesystem.message]);
  assert.equal(Object.hasOwn(described, "cause_serialization_failure"), false);

  for (const field of ["ref_id", "sha256", "source", "next_calls"]) {
    assert.equal(Object.hasOwn(described, field), false, field);
  }
});

test("a non-Error retention cause is kept, and an unserializable one says exactly why", () => {
  const thrown = describeRetentionFailure("disk quota exceeded", { operation: "retain_operator_only_evidence" });
  assert.equal(thrown.cause, "disk quota exceeded");
  assert.equal(thrown.cause_code, null);
  assert.equal(thrown.subject, null);

  const withAccessor = new Error("store failed");
  Object.defineProperty(withAccessor, "detail", { enumerable: true, get: () => "late" });
  const described = describeRetentionFailure(withAccessor, { operation: "retain_operator_only_evidence" });

  assert.equal(described.cause, "store failed");
  assert.match(described.cause_serialization_failure, /detail must be a data property/u);
  assert.equal(JSON.stringify(described).includes("late"), false);
});
