

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  captureDiagnosticEvidence,
  DIAGNOSTIC_EVIDENCE_MAX_DEPTH,
  DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION
} from "../../packages/agent-launch-cli/src/lib/diagnostic-evidence.mjs";

const roundTrip = (value) => JSON.parse(JSON.stringify(value));

test("the encoder module has no imports", () => {
  const source = readFileSync(
    new URL("../../packages/agent-launch-cli/src/lib/diagnostic-evidence.mjs", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /^\s*import\s/mu);
});

test("an own __proto__ property is preserved as an own key, not a prototype", () => {
  const parsed = JSON.parse('{"__proto__": {"polluted": true}, "kept": 1}');
  assert.equal(Object.hasOwn(parsed, "__proto__"), true, "fixture has an own __proto__");
  const defined = {};
  Object.defineProperty(defined, "__proto__", {
    value: "own string", enumerable: true, writable: true, configurable: true
  });
  const error = Object.assign(new Error("carrier"), { detail: parsed });

  for (const [label, input, locate] of [
    ["parsed object", parsed, (value) => value],
    ["defined property", defined, (value) => value],
    ["error detail", error, (value) => value.properties.detail]
  ]) {
    const evidence = captureDiagnosticEvidence(input);
    assert.deepEqual(evidence.capture_failures, [], label);
    for (const encoded of [locate(evidence.value), locate(roundTrip(evidence).value)]) {
      assert.equal(Object.hasOwn(encoded, "__proto__"), true, `${label}: own key kept`);
      assert.equal(Object.getPrototypeOf(encoded), Object.prototype, `${label}: prototype untouched`);
      assert.deepEqual(Object.keys(encoded), Object.keys(input === error ? parsed : input), label);
    }
  }
  const encoded = captureDiagnosticEvidence(parsed).value;
  assert.deepEqual(Object.getOwnPropertyDescriptor(encoded, "__proto__").value, { polluted: true });
  assert.equal(encoded.kept, 1);
  assert.equal({}.polluted, undefined, "no prototype was polluted");
  assert.equal(
    Object.getOwnPropertyDescriptor(captureDiagnosticEvidence(defined).value, "__proto__").value,
    "own string"
  );
});

test("an Error keeps its fields, properties, and cause chain", () => {
  const root = Object.assign(new Error("root"), { code: "EROOT" });
  const error = Object.assign(new TypeError("outer", { cause: root }), { detail: { a: [1, 2n] } });
  const evidence = captureDiagnosticEvidence(error);
  assert.equal(evidence.schema_version, DIAGNOSTIC_EVIDENCE_SCHEMA_VERSION);
  assert.deepEqual(evidence.capture_failures, []);
  const { value } = evidence;
  assert.equal(value.$type, "Error");
  assert.equal(value.constructor, "TypeError");
  assert.equal(value.message, "outer");
  assert.equal(value.stack, error.stack);
  assert.deepEqual(value.properties, { detail: { a: [1, { $type: "bigint", value: "2" }] } });
  assert.equal(value.cause.message, "root");
  assert.equal(value.cause.stack, root.stack);
  assert.deepEqual(value.cause.properties, { code: "EROOT" });
  assert.deepEqual(roundTrip(evidence), evidence);
});

test("the depth budget continues the capture instead of discarding below it", () => {

  let deep = { leaf: "below the cut-off" };
  for (let level = 0; level < DIAGNOSTIC_EVIDENCE_MAX_DEPTH + 5; level += 1) deep = { next: deep };
  const evidence = captureDiagnosticEvidence(deep);
  assert.deepEqual(evidence.capture_failures, []);
  assert.equal(evidence.segments.length, 1);

  const continuationPath = `$${'["next"]'.repeat(DIAGNOSTIC_EVIDENCE_MAX_DEPTH)}`;
  let node = evidence.value;
  for (let level = 0; level < DIAGNOSTIC_EVIDENCE_MAX_DEPTH; level += 1) node = node.next;
  assert.deepEqual(node, {
    $type: "deep_segment",
    segment: 0,
    continues_at: continuationPath
  });

  const [segment] = evidence.segments;
  assert.equal(segment.segment, 0);
  assert.equal(segment.continues_at, continuationPath);
  let below = segment.value;
  for (let level = 0; level < 5; level += 1) below = below.next;
  assert.deepEqual(below, { leaf: "below the cut-off" });
  assert.equal(JSON.stringify(evidence).includes("below the cut-off"), true,
    "the data below the cut-off is retrievable, not merely disclosed as missing");
});

test("an arbitrarily deep value is captured completely across as many segments as it needs", () => {
  const depth = DIAGNOSTIC_EVIDENCE_MAX_DEPTH * 3 + 7;
  let deep = { leaf: "the very bottom" };
  for (let level = 0; level < depth; level += 1) deep = { next: deep };
  const evidence = captureDiagnosticEvidence(deep);
  assert.deepEqual(evidence.capture_failures, []);
  assert.equal(evidence.segments.length, 3);
  assert.equal(JSON.stringify(evidence).includes("the very bottom"), true);

  assert.deepEqual(roundTrip(evidence), evidence);
});

test("a deep CYCLE terminates: a repeat becomes a $ref before it can segment again", () => {
  let root = {};
  let cursor = root;
  for (let level = 0; level < DIAGNOSTIC_EVIDENCE_MAX_DEPTH * 2 + 3; level += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  cursor.back = root;
  cursor.leaf = "deep cyclic leaf";
  const evidence = captureDiagnosticEvidence(root);
  assert.deepEqual(evidence.capture_failures, []);
  assert.equal(evidence.segments.length, 2);
  assert.equal(JSON.stringify(evidence).includes("deep cyclic leaf"), true);
  assert.equal(JSON.stringify(evidence).includes('"$ref"'), true);
});

test("repeated objects, escaped keys, and failing getters are explicit", () => {
  const shared = { s: 1 };
  const value = {
    first: shared,
    second: shared,
    $type: "user",
    get broken() { throw new Error("getter refused"); }
  };
  const evidence = captureDiagnosticEvidence(value);
  assert.deepEqual(evidence.value, {
    first: { s: 1 },
    second: { $ref: '$["first"]' },
    $$type: "user",
    broken: { $type: "capture_failed" }
  });
  assert.deepEqual(evidence.capture_failures.map(({ path, step, error }) =>
    ({ path, step, message: error.message })),
  [{ path: '$["broken"]', step: "get", message: "getter refused" }]);
});
