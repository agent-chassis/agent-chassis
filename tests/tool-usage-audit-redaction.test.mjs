import test from "node:test";
import assert from "node:assert/strict";
import { redactPath, redactPayload } from "../packages/wiki-mcp/src/lib/tool-usage-audit/redaction.mjs";

test("traversal-bearing docs and wiki path args redact raw path fields", () => {
  for (const rawPath of ["docs/../secret.md", "wiki/issues/../work-records/WK-1437.json"]) {
    const redacted = redactPath(rawPath);

    assert.equal(redacted.path, undefined);
    assert.equal(typeof redacted.path_category, "string");
    assert.equal(typeof redacted.path_digest, "string");
  }
});

test("normalized canonical docs and work-record paths preserve raw path fields", () => {
  for (const rawPath of ["docs/mcp-integration.md", "wiki/work-records/WK-1437.json"]) {
    const redacted = redactPath(rawPath);

    assert.equal(redacted.path_category, "safe_repo_relative_canonical");
    assert.equal(redacted.path, rawPath);
    assert.equal(typeof redacted.path_digest, "string");
  }
});

test("payload redaction does not expose traversal path references", () => {
  const payload = redactPayload({
    path: "docs/../secret.md",
    workRecordPath: "wiki/issues/../work-records/WK-1437.json",
    canonicalDocPath: "docs/mcp-integration.md",
    canonicalWorkRecordPath: "wiki/work-records/WK-1437.json"
  });

  const referencesByDigest = new Map(payload.path_references.map((entry) => [entry.path_digest, entry]));

  for (const rawPath of ["docs/../secret.md", "wiki/issues/../work-records/WK-1437.json"]) {
    const redacted = redactPath(rawPath);
    assert.equal(referencesByDigest.get(redacted.path_digest)?.path, undefined);
  }

  for (const rawPath of ["docs/mcp-integration.md", "wiki/work-records/WK-1437.json"]) {
    const redacted = redactPath(rawPath);
    assert.equal(referencesByDigest.get(redacted.path_digest)?.path, rawPath);
  }
});
