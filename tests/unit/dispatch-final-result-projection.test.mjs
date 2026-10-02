import assert from "node:assert/strict";
import test from "node:test";

import {
  getPublicFinalResultTextMember,
  projectPublicFinalResult
} from "../../packages/wiki-mcp/src/lib/dispatch-final-result-projection.mjs";

const MEMBERS = Object.freeze([
  "final_result.full_response.text",
  "final_result.advisory_review.advisory_output.text",
  "final_result.findings.text",
  "final_result.no_findings.text"
]);

function sourceWithTexts([full, advisory, findings, noFindings]) {
  return {
    schema_version: "workspace-agent-dispatch-final-result.v1",
    kind: "findings",
    full_response: { text: full, format: "markdown", source: "launcher_capture" },
    advisory_review: { advisory_output: { text: advisory, available: true, usable: true } },
    findings: { text: findings, rows: [{ title: "nested text stays untouched" }] },
    no_findings: { text: noFindings }
  };
}

function ownMember(root, member) {
  return member.split(".").slice(1).reduce((value, key) => value?.[key], root);
}

function parentFor(root, member) {
  return member.split(".").slice(1, -1).reduce((value, key) => value?.[key], root);
}

function reconstructedText(projected, member) {
  const inline = ownMember(projected, member);
  if (typeof inline === "string") return inline;
  const reference = parentFor(projected, member)?.text_reference;
  assert.equal(reference?.reason, "duplicate_text");
  const target = ownMember(projected, reference.member);
  assert.equal(typeof target, "string", `${reference.member} must resolve directly to text`);
  return target;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function countExactStringValues(value, expected) {
  if (value === expected) return 1;
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).reduce(
    (count, child) => count + countExactStringValues(child, expected),
    0
  );
}

test("public final result stores each exact captured string once", () => {
  const repeated = "é\n日本語";
  const canonicallyEquivalentButDistinct = "é\n日本語";
  const projected = projectPublicFinalResult(
    sourceWithTexts([repeated, repeated, canonicallyEquivalentButDistinct, repeated])
  );

  assert.equal(projected.full_response.text, repeated);
  assert.equal(projected.findings.text, canonicallyEquivalentButDistinct);
  assert.deepEqual(projected.advisory_review.advisory_output.text_reference, {
    member: "final_result.full_response.text",
    reason: "duplicate_text"
  });
  assert.deepEqual(projected.no_findings.text_reference, {
    member: "final_result.full_response.text",
    reason: "duplicate_text"
  });
  assert.equal(countExactStringValues(projected, repeated), 1);
  assert.deepEqual(projected.text_projection, {
    source_text_count: 4,
    distinct_text_count: 2,
    omitted_text_count: 2
  });
});

test("public text references reconstruct every original captured member", () => {
  const expected = ["alpha", "beta", "alpha", "beta"];
  const source = sourceWithTexts(expected);
  const projected = projectPublicFinalResult(source);

  assert.deepEqual(MEMBERS.map((member) => reconstructedText(projected, member)), expected);
  assert.deepEqual(MEMBERS.map((member) =>
    getPublicFinalResultTextMember(source, member)), [
    "final_result.full_response.text",
    "final_result.advisory_review.advisory_output.text",
    "final_result.full_response.text",
    "final_result.advisory_review.advisory_output.text"
  ]);
});

test("public projection preserves metadata and internal evidence", () => {
  const source = deepFreeze({
    ...sourceWithTexts(["same", "same", "same", "same"]),
    source: { repo: "agent-chassis/agent-chassis", sha: "a".repeat(40) },
    target: { subject: "WK-2593#SLICE-006", digest: `sha256:${"b".repeat(64)}` },
    enforcement: { enforced: true, isolation_backend: "sandbox", reason: "policy" },
    formal_attestation: { requested: true, available: true, attestation_id: "att-1" },
    structured_role_result: { findings: [{ text: "same" }], valid: true },
    lifecycle: { terminal: true, phase: "finalized" }
  });
  const before = JSON.stringify(source);
  const projected = projectPublicFinalResult(source);

  assert.equal(JSON.stringify(source), before);
  for (const member of ["source", "target", "enforcement", "formal_attestation",
    "structured_role_result", "lifecycle"]) {
    assert.deepEqual(projected[member], source[member]);
  }
  assert.equal(projected.structured_role_result.findings[0].text, "same");
});

test("public schema identifies lossless source projection", () => {
  const projected = projectPublicFinalResult(sourceWithTexts(["a", "b", "c", "d"]));
  assert.equal(projected.schema_version, "workspace-agent-public-final-result.v1");
  assert.equal(projected.source_schema_version, "workspace-agent-dispatch-final-result.v1");
  assert.deepEqual(projected.text_projection, {
    source_text_count: 4,
    distinct_text_count: 4,
    omitted_text_count: 0
  });

  const withoutSourceSchema = projectPublicFinalResult({ kind: "failed" });
  assert.equal(Object.hasOwn(withoutSourceSchema, "source_schema_version"), false);
  assert.equal(projectPublicFinalResult(null), null);
  assert.equal(projectPublicFinalResult("unavailable"), "unavailable");
  const arrayState = ["unavailable"];
  assert.strictEqual(projectPublicFinalResult(arrayState), arrayState);
});

test("public projection preserves missing and non-string text states", () => {
  const source = {
    full_response: { text: "" },
    advisory_review: { advisory_output: { text: "" } },
    findings: { text: null, nested: { text: "must not move" } },
    no_findings: { text: 17 },
    missing_result: { code: "result_missing" }
  };
  const projected = projectPublicFinalResult(source);

  assert.equal(projected.full_response.text, "");
  assert.deepEqual(projected.advisory_review.advisory_output.text_reference, {
    member: "final_result.full_response.text",
    reason: "duplicate_text"
  });
  assert.equal(projected.findings.text, null);
  assert.equal(projected.findings.nested.text, "must not move");
  assert.equal(projected.no_findings.text, 17);
  assert.deepEqual(projected.text_projection, {
    source_text_count: 2,
    distinct_text_count: 1,
    omitted_text_count: 1
  });
  assert.equal(getPublicFinalResultTextMember(source, MEMBERS[2]), null);
  assert.equal(getPublicFinalResultTextMember(source, MEMBERS[3]), null);
  assert.throws(
    () => getPublicFinalResultTextMember(source, "final_result.unknown.text"),
    /unknown final-result text member/
  );
});

test("complete response size scales with distinct captured texts", () => {
  const large = "review🙂".repeat(4096);
  const allEqual = sourceWithTexts([large, large, large, large]);
  const pairwise = sourceWithTexts([large, large, `${large}A`, `${large}A`]);
  const distinct = sourceWithTexts([large, `${large}A`, `${large}B`, `${large}C`]);
  const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
  const projectedEqual = projectPublicFinalResult(allEqual);

  assert.ok(bytes(projectedEqual) < bytes(projectPublicFinalResult(pairwise)));
  assert.ok(bytes(projectPublicFinalResult(pairwise)) < bytes(projectPublicFinalResult(distinct)));
  assert.ok(bytes(allEqual) - bytes(projectedEqual) > Buffer.byteLength(large, "utf8") * 2);
  assert.deepEqual(projectPublicFinalResult(allEqual), projectedEqual);
  assert.deepEqual(MEMBERS.map((member) => reconstructedText(projectedEqual, member)),
    [large, large, large, large]);
});

test("public projection withholds a missing result's process tail and keeps its diagnosis", () => {
  const PROCESS_TAIL = "codex: RAW-PROCESS-TAIL 🙂 at /opt/runtime/child.mjs:4:2";
  const source = Object.freeze({
    schema_version: "workspace-agent-dispatch-final-result.v1",
    kind: "missing_result",
    full_response: null,
    findings: null,
    no_findings: null,
    missing_result: Object.freeze({
      code: "final_report_not_captured",
      reason: "final_message_file_unreadable",
      detail: Object.freeze({
        path: "/run/final.md", code: "ENOENT", message: "no such file",
        stderr_tail: PROCESS_TAIL, stderr_bytes: Buffer.byteLength(PROCESS_TAIL), stderr_truncated: false
      })
    })
  });
  const original = structuredClone(source);
  const projected = projectPublicFinalResult(source);

  assert.deepEqual(projected.missing_result, {
    code: "final_report_not_captured",
    reason: "final_message_file_unreadable",
    detail: { path: "/run/final.md", code: "ENOENT", message: "no such file",
      stderr_bytes: Buffer.byteLength(PROCESS_TAIL), stderr_truncated: false },
    retained_evidence: { retained: true, owner: "dispatch_run_final_result", audience: "operator",
      fields: ["missing_result.detail.stderr_tail"] }
  });

  assert.equal(JSON.stringify(projected).includes("RAW-PROCESS-TAIL"), false);
  assert.equal(projected.full_response, null);
  assert.deepEqual(projected.text_projection,
    { source_text_count: 0, distinct_text_count: 0, omitted_text_count: 0 });

  assert.deepEqual(source, original);
  assert.equal(source.missing_result.detail.stderr_tail, PROCESS_TAIL);
  assert.deepEqual(projectPublicFinalResult(source), projected, "the same record projects identically");
});

test("authored worker and reviewer text survive publication beside a process tail", () => {
  const authored = "Findings:\n1. [medium] preserve the original cause.\n    at the reviewer's own words";
  const source = {
    ...sourceWithTexts([authored, authored, authored, "No findings."]),
    missing_result: { code: "partial", detail: { stderr_tail: "RAW-TAIL", stdout_tail: "RAW-OUT" } }
  };
  const projected = projectPublicFinalResult(source);

  assert.equal(projected.full_response.text, authored, "authored text is published verbatim");
  assert.equal(reconstructedText(projected, MEMBERS[1]), authored);
  assert.equal(reconstructedText(projected, MEMBERS[2]), authored);
  assert.equal(projected.no_findings.text, "No findings.");
  assert.deepEqual(projected.findings.rows, [{ title: "nested text stays untouched" }]);
  assert.deepEqual(projected.missing_result.retained_evidence.fields,
    ["missing_result.detail.stderr_tail", "missing_result.detail.stdout_tail"]);
  const rendered = JSON.stringify(projected);
  assert.equal(rendered.includes("RAW-TAIL") || rendered.includes("RAW-OUT"), false);
});

test("public projection omits the temporary findings source reference and keeps the source", () => {
  const authored = "Findings\r\n1. keep é \u{1f680} exact";
  const sourceReference = Object.freeze({ ref: "managed-findings.v1.payload.checksum",
    source_kind: "original_managed_findings", authority: "advisory_only", attestation: false });
  const source = sourceWithTexts([authored, authored, "findings", "none"]);
  source.advisory_review.advisory_output.source_reference = sourceReference;
  const before = JSON.stringify(source);
  const projected = projectPublicFinalResult(source);

  assert.equal(Object.hasOwn(projected.advisory_review.advisory_output, "source_reference"), false);
  assert.equal(JSON.stringify(projected).includes(sourceReference.ref), false);
  assert.equal(reconstructedText(projected, MEMBERS[1]), authored, "authored findings are unchanged");
  assert.equal(projected.advisory_review.advisory_output.available, true);
  assert.equal(JSON.stringify(source), before, "the internal source keeps its reference");
  assert.strictEqual(source.advisory_review.advisory_output.source_reference, sourceReference);
});
