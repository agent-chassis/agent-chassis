import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeAdvisoryDispositions } from
  "../../packages/wiki-core/src/lib/review-disposition.mjs";

const row = (reviewRunId, findingId, disposition) =>
  ({ review_run_id: reviewRunId, finding_id: findingId, disposition });

test("shared advisory dispositions preserve membership and normalization", async () => {
  const evidence = { reviews: [
    { run_id: "run-b", findings: [{ id: "F2" }, { id: "F1" }, { id: "F3" }] },
    { run_id: "run-a", findings: [{ id: "F1" }] },
    { run_id: "run-empty" }
  ] };
  const evidenceBefore = structuredClone(evidence);

  const omitted = normalizeAdvisoryDispositions(undefined, undefined);
  assert.deepEqual(omitted, []);
  assert.ok(Object.isFrozen(omitted));
  const empty = normalizeAdvisoryDispositions([], evidence);
  assert.deepEqual(empty, []);
  assert.ok(Object.isFrozen(empty));

  const input = [
    { disposition: "reject", finding_id: "F3", review_run_id: "run-b" },
    row("run-b", "F1", "accept"),
    row("run-a", "F1", "defer"),
    row("run-b", "F2", "accept")
  ];
  const inputBefore = structuredClone(input);
  const normalized = normalizeAdvisoryDispositions(input, evidence);
  assert.deepEqual(normalized, [row("run-b", "F3", "reject"), row("run-b", "F1", "accept"),
    row("run-a", "F1", "defer"), row("run-b", "F2", "accept")]);
  assert.deepEqual(Object.keys(normalized[0]), ["review_run_id", "finding_id", "disposition"]);

  assert.ok(Object.isFrozen(normalized) && normalized.every((entry) => Object.isFrozen(entry)));
  assert.ok(normalized.every((entry, index) => entry !== input[index]));
  assert.ok(!Object.isFrozen(input) && input.every((entry) => !Object.isFrozen(entry)));
  assert.deepEqual([input, evidence], [inputBefore, evidenceBefore]);
  input[1].disposition = "reject";
  input.pop();
  assert.deepEqual([normalized.length, normalized[1].disposition], [4, "accept"]);
  const repeat = normalizeAdvisoryDispositions(inputBefore, evidence);
  assert.deepEqual(repeat, normalized);
  assert.ok(repeat !== normalized && repeat[0] !== normalized[0]);

  const valid = row("run-b", "F1", "accept");
  const refused = [
    ["null input", null],
    ["object input", { 0: valid, length: 1 }],
    ["null row", [null]],
    ["array row", [["run-b", "F1", "accept"]]],
    ["missing key", [{ review_run_id: "run-b", finding_id: "F1" }]],
    ["extra key", [{ ...valid, rationale: "extra" }]],
    ["non-string run", [row(1, "F1", "accept")]],
    ["non-string finding", [row("run-b", 1, "accept")]],
    ["unknown judgment", [row("run-b", "F1", "approve")]],
    ["unknown run", [row("run-z", "F1", "accept")]],
    ["known finding on the wrong run", [row("run-a", "F2", "accept")]],
    ["unknown finding on a known run", [row("run-b", "F9", "accept")]],
    ["finding on a run without findings", [row("run-empty", "F1", "accept")]],
    ["same-pair duplicate", [valid, { ...valid }]],
    ["conflicting same-pair judgment", [valid, row("run-b", "F1", "reject")]],
    ["valid leading row before an invalid trailing row", [valid, row("run-b", "F9", "accept")]]
  ];
  for (const [label, dispositions] of refused) {
    assert.equal(normalizeAdvisoryDispositions(dispositions, evidence), null, label);
  }
  assert.deepEqual(evidence, evidenceBefore);

  const source = (relative) => readFile(new URL(`../../packages/${relative}`, import.meta.url), "utf8");
  const backend = await source("agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs");
  assert.match(backend,
    /import \{\n  normalizeAdvisoryDispositions\n\} from "@agent-chassis\/wiki-core\/src\/lib\/review-disposition\.mjs";/u);
  assert.doesNotMatch(backend, /function normalizeAdvisoryDispositions|ORCHESTRATOR_ADVISORY_DISPOSITIONS/u);
  assert.equal(backend.split("normalizeAdvisoryDispositions(dispositions, recoveryEvidence)").length, 2);
  assert.equal(backend.split("normalizeAdvisoryDispositions(dispositions, evidence)").length, 2);
  assert.doesNotMatch(await source("wiki-core/src/lib/review-disposition.mjs"), /\bimport\b|\brequire\(/u);
});
