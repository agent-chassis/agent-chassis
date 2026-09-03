import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import {
  MAX_DISCOVERY_QUERY_BYTES,
  MAX_DISCOVERY_RESULT_BYTES,
  PROOF_INTENT_DISCOVERY_CATALOG,
  ProofIntentDiscoveryError,
  canonicalProofIntentDiscoveryJson,
  discoverProofIntents,
  normalizeProofIntentDiscoveryCatalog,
  validateProofIntentDiscoveryResult
} from "../lib/proof-intent-discovery.mjs";
import { parseArgs } from "../bin/discover-proof-intents.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = new URL("../", import.meta.url);
const exactIdPrefix = "controlled-proof-intent.";
const intentCount = PROOF_INTENT_DISCOVERY_CATALOG.intents.length;

function ids(result) {
  return result.intents.map(({ intent_id: intentId }) => intentId);
}

function childEnvironment() {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.entries(value).reverse().map(([key, child]) => [
      key, reverseObjectKeys(child)
    ])
  );
  return value;
}

test("list mode returns every controlled intent exactly once", () => {
  const result = discoverProofIntents();
  assert.equal(validateProofIntentDiscoveryResult(result), true);
  assert.equal(result.mode, "list");
  assert.equal(result.catalog_intent_count, intentCount);
  assert.equal(result.evaluated_intent_count, intentCount);
  assert.equal(result.total_match_count, intentCount);
  assert.equal(result.returned_count, intentCount);
  assert.equal(result.omitted_count, 0);
  assert.equal(result.truncated, false);
  assert.equal(result.result_limit, null);
  assert.equal(new Set(ids(result)).size, intentCount);
  assert.deepEqual(ids(result), [...ids(result)].sort());
  for (const intent of result.intents) {
    assert.match(intent.intent_id, /^controlled-proof-intent\./u);
    assert.ok(intent.definition.endsWith("."));
    assert.ok(intent.discovery_terms.length >= 3);
    assert.ok(Array.isArray(intent.capable_packs));
    assert.ok(Array.isArray(intent.distinctions));
    assert.equal(intent.match_kind, "catalog_entry");
    assert.deepEqual(intent.matched_terms, []);
    assert.deepEqual(intent.unmatched_terms, []);
    assert.deepEqual(intent.match_reasons, []);
  }
});

test("list mode applies an explicit positive limit with truthful complete-catalog facts", () => {
  assert.ok(intentCount > 28, "the shipped catalog must discriminate the MCP maximum");
  const result = discoverProofIntents({ limit: 28 });
  assert.equal(validateProofIntentDiscoveryResult(result), true);
  assert.equal(result.mode, "list");
  assert.equal(result.query, null);
  assert.equal(result.catalog_intent_count, intentCount);
  assert.equal(result.evaluated_intent_count, intentCount);
  assert.equal(result.total_match_count, intentCount);
  assert.equal(result.returned_count, 28);
  assert.equal(result.omitted_count, intentCount - 28);
  assert.equal(result.truncated, true);
  assert.equal(result.result_limit, 28);
  assert.deepEqual(ids(result), ids(discoverProofIntents()).slice(0, 28));
});

test("every controlled intent is discoverable by its exact id", () => {
  for (const intent of PROOF_INTENT_DISCOVERY_CATALOG.intents) {
    const result = discoverProofIntents({ query: intent.intent_id });
    assert.equal(result.status, "match", intent.intent_id);
    assert.equal(ids(result).filter((intentId) =>
      intentId === intent.intent_id).length, 1, intent.intent_id);
    assert(result.intents.find(({ intent_id: intentId }) =>
      intentId === intent.intent_id).match_reasons.some(
      ({ source, source_value: value }) =>
        source === "intent_id" && value === intent.intent_id
    ));
  }
});

test("representative controlled terms find their exact expected intents", () => {
  for (const [query, expectedId] of [
    ["all-or-nothing settlement", "atomic-failure-boundary"],
    ["disclosed omissions", "lossless-projection"],
    ["baseline candidate behavior", "behavioral-preservation"],
    ["post-terminal interval", "bounded-terminal-stability"],
    ["consumed token replay", "single-use-replay-refusal"],
    ["removed call not restored", "forbidden-operation-noninvocation"],
    ["all required branches", "integration-prefix-safety"]
  ]) {
    const result = discoverProofIntents({ query });
    assert.deepEqual(ids(result), [`${exactIdPrefix}${expectedId}`], query);
    assert(result.intents[0].match_reasons.some(
      ({ source }) => source === "discovery_term"
    ), query);
  }
});

test("search ambiguity remains explicit and never becomes selection", () => {
  const result = discoverProofIntents({ query: "authorization attempt" });
  assert.deepEqual(ids(result), [
    `${exactIdPrefix}failed-attempt-nonconsumption`,
    `${exactIdPrefix}refusal-before-effects`
  ]);
  assert.equal(result.total_match_count, 2);
  assert.equal(result.selection_performed, false);
  assert.equal(result.pack_invocation_performed, false);
  assert.equal(result.pack_admission_performed, false);
  assert.equal(result.authority, "non_authoritative");
});

test("all-token matches remain stronger than partial overlap", () => {
  const result = discoverProofIntents({
    query: "authorization attempt irrelevant-noise"
  });
  assert.equal(result.status, "partial_match");
  assert.ok(result.intents.length >= 2);
  assert(result.intents.every(({ match_kind: matchKind }) =>
    matchKind === "partial_match"));
  const exact = discoverProofIntents({ query: "authorization attempt" });
  assert.equal(exact.status, "match");
  assert(exact.intents.every(({ match_kind: matchKind, unmatched_terms: terms }) =>
    matchKind === "exact_match" && terms.length === 0));
});

test("intuitive lossless wording returns actionable partial candidates", () => {
  const result = discoverProofIntents({
    query: "compact output no information loss"
  });
  assert.equal(result.status, "partial_match");
  const candidate = result.intents.find(({ intent_id: intentId }) =>
    intentId === `${exactIdPrefix}lossless-projection`);
  assert.ok(candidate);
  assert.ok(candidate.matched_terms.length > 0);
  assert.ok(candidate.unmatched_terms.length > 0);
  assert.deepEqual(candidate.matched_terms, [...candidate.matched_terms].sort());
  assert.deepEqual(candidate.unmatched_terms,
    result.query.terms.filter((term) => !candidate.matched_terms.includes(term)));
  assert.equal(result.guidance.code,
    "inspect_partial_candidates_and_refine_query");
  assert.equal(result.selection_performed, false);
});

test("misleading aliases, stop words, and one-token overlap preserve ambiguity", () => {
  const oneToken = discoverProofIntents({ query: "the" });
  assert.equal(oneToken.status, "match");
  assert.ok(oneToken.total_match_count > 1);
  assert.equal(oneToken.selection_performed, false);
  for (const query of [
    "the fabricated-stopword", "projection imaginary-alias",
    "authorization misleading"
  ]) {
    const result = discoverProofIntents({ query });
    assert.equal(result.status, "partial_match", query);
    assert.ok(result.total_match_count > 0, query);
    assert.equal(result.total_match_count, result.returned_count, query);
    assert(result.intents.every((intent) =>
      intent.matched_terms.length > 0 && intent.unmatched_terms.length > 0), query);
    assert.equal(result.selection_performed, false, query);
  }
});

test("authored distinctions separate every required commonly confused pair", () => {
  const byId = new Map(PROOF_INTENT_DISCOVERY_CATALOG.intents.map((intent) => [
    intent.intent_id, intent
  ]));
  for (const [leftSuffix, rightSuffix] of [
    ["refusal-before-effects", "bounded-interval-nonmutation"],
    ["behavioral-preservation", "cross-representation-parity"],
    ["lossless-projection", "result-shape-conformance"],
    ["atomic-failure-boundary", "failure-settlement-and-cleanup"],
    ["idempotent-effect-nonduplication", "single-use-replay-refusal"]
  ]) {
    const leftId = `${exactIdPrefix}${leftSuffix}`;
    const rightId = `${exactIdPrefix}${rightSuffix}`;
    const left = byId.get(leftId);
    const right = byId.get(rightId);
    assert.notDeepEqual(left.capable_packs, right.capable_packs);
    assert(left.distinctions.some(({ from_intent_id: intentId }) =>
      intentId === rightId));
    assert(right.distinctions.some(({ from_intent_id: intentId }) =>
      intentId === leftId));
  }
});

test("no-match is explicit and contains complete scan facts", () => {
  const result = discoverProofIntents({ query: "quasar marmalade 998877" });
  assert.equal(result.status, "no_match");
  assert.equal(result.evaluated_intent_count, intentCount);
  assert.equal(result.total_match_count, 0);
  assert.equal(result.returned_count, 0);
  assert.equal(result.omitted_count, 0);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.intents, []);
  assert.equal(result.guidance.code, "refine_query_or_list_catalog");
});

test("the complete catalog is evaluated before limiting and truncation facts are exact", () => {
  const complete = discoverProofIntents({ query: "failure" });
  assert.ok(complete.total_match_count > 1);
  const limited = discoverProofIntents({ query: "failure", limit: 1 });
  assert.equal(limited.evaluated_intent_count, intentCount);
  assert.equal(limited.total_match_count, complete.total_match_count);
  assert.equal(limited.returned_count, 1);
  assert.equal(limited.omitted_count, complete.total_match_count - 1);
  assert.equal(limited.truncated, true);
  assert.deepEqual(ids(limited), ids(complete).slice(0, 1));
});

test("catalog and key reordering normalize to the identical intrinsic substrate", async () => {
  const raw = JSON.parse(await readFile(
    new URL("proof-intents/catalog.json", packageRoot), "utf8"
  ));
  const reordered = reverseObjectKeys({
    ...raw,
    intents: [...raw.intents].reverse().map((intent) => ({
      ...intent,
      discovery_terms: [...intent.discovery_terms].reverse(),
      capable_packs: [...intent.capable_packs].reverse(),
      distinctions: [...intent.distinctions].reverse()
    }))
  });
  assert.deepEqual(normalizeProofIntentDiscoveryCatalog(reordered),
    normalizeProofIntentDiscoveryCatalog(raw));
});

test("case, punctuation, catalog order, and repetition do not change equivalent results", () => {
  const baseline = discoverProofIntents({ query: "lossless projection" });
  const normalizedVariant = discoverProofIntents({
    query: "  LOSSLESS---PROJECTION!!!  "
  });
  assert.deepEqual(normalizedVariant, baseline);
  assert.equal(canonicalProofIntentDiscoveryJson(normalizedVariant),
    canonicalProofIntentDiscoveryJson(baseline));
  assert.equal(canonicalProofIntentDiscoveryJson(
    discoverProofIntents({ query: "lossless projection" })
  ), canonicalProofIntentDiscoveryJson(baseline));
});

test("query reordering and Unicode compatibility normalization are byte deterministic", () => {
  const ordered = discoverProofIntents({ query: "compact output loss" });
  const reordered = discoverProofIntents({ query: "loss compact output" });
  const unicode = discoverProofIntents({ query: "ｌｏｓｓ ＣＯＭＰＡＣＴ output" });
  assert.deepEqual(reordered, ordered);
  assert.deepEqual(unicode, ordered);
  assert.equal(canonicalProofIntentDiscoveryJson(reordered),
    canonicalProofIntentDiscoveryJson(ordered));
});

test("partial-match limiting retains complete-catalog ambiguity facts", () => {
  const complete = discoverProofIntents({ query: "the unmatched-token" });
  const limited = discoverProofIntents({
    query: "unmatched-token the",
    limit: 1
  });
  assert.equal(complete.status, "partial_match");
  assert.equal(limited.evaluated_intent_count, complete.catalog_intent_count);
  assert.equal(limited.total_match_count, complete.total_match_count);
  assert.equal(limited.returned_count, 1);
  assert.equal(limited.omitted_count, complete.total_match_count - 1);
  assert.equal(limited.truncated, true);
  assert.deepEqual(ids(limited), ids(complete).slice(0, 1));
});

test("results are caller-detached, deeply frozen, canonical, and bounded", () => {
  const request = { query: "failure", limit: 2 };
  const result = discoverProofIntents(request);
  const bytes = Buffer.from(canonicalProofIntentDiscoveryJson(result), "utf8");
  request.query = "runtime evidence";
  request.limit = 1;
  assert.equal(result.query.normalized_text, "failure");
  assert.equal(Object.isFrozen(result.intents[0].discovery_terms), true);
  assert.throws(() => result.intents.push({ intent_id: "forged" }), TypeError);
  assert.throws(() => {
    result.intents[0].discovery_terms[0] = "forged";
  }, TypeError);
  assert.ok(bytes.byteLength <= MAX_DISCOVERY_RESULT_BYTES);
  assert.equal(bytes.at(-1), 10);
  assert.deepEqual(discoverProofIntents({ query: "failure", limit: 2 }), result);
});

test("oversized queries and all substrate or execution overrides fail closed", () => {
  assert.doesNotThrow(() => discoverProofIntents({
    query: "x".repeat(MAX_DISCOVERY_QUERY_BYTES)
  }));
  assert.doesNotThrow(() => discoverProofIntents({
    query: "é".repeat(MAX_DISCOVERY_QUERY_BYTES / 2)
  }));
  for (const query of [
    "x".repeat(MAX_DISCOVERY_QUERY_BYTES + 1),
    `${"é".repeat(MAX_DISCOVERY_QUERY_BYTES / 2)}x`
  ]) {
    assert.throws(() => discoverProofIntents({ query, limit: 2 }), (error) => {
      assert.ok(error instanceof ProofIntentDiscoveryError);
      assert.equal(error.code, "proof_intent_discovery_query_too_large");
      assert.deepEqual({
        cause: error.details.cause,
        measurement: error.details.measurement,
        byte_length: error.details.byte_length,
        maximum_bytes: error.details.maximum_bytes,
        rejected_query: error.details.rejected_query
      }, {
        cause: "proof_intent_discovery_query_too_large",
        measurement: "utf8_bytes",
        byte_length: MAX_DISCOVERY_QUERY_BYTES + 1,
        maximum_bytes: MAX_DISCOVERY_QUERY_BYTES,
        rejected_query: "[bounded-oversized-query]"
      });
      assert.equal(error.details.replacement_call.tool,
        "workspace_controlled_proof_intents_discover");
      assert.equal(error.details.replacement_call.arguments.limit, 2);
      assert.ok(Buffer.byteLength(
        error.details.replacement_call.arguments.query, "utf8"
      ) <= MAX_DISCOVERY_QUERY_BYTES);
      assert.doesNotThrow(() => discoverProofIntents(
        error.details.replacement_call.arguments
      ));
      return true;
    });
  }
  for (const key of [
    "path", "root", "catalog", "executable", "module", "environment"
  ]) assert.throws(() => discoverProofIntents({ query: "failure", [key]: "x" }),
    (error) => error.code === "proof_intent_discovery_option_unsupported", key);
  assert.throws(() => discoverProofIntents({ query: "failure" }, {
    catalog: {}
  }), (error) => error.code === "proof_intent_discovery_arguments_invalid");
  for (const limit of [0, -1, 257, 1.5, "28"]) {
    assert.throws(() => discoverProofIntents({ limit }),
      (error) => error.code === "proof_intent_discovery_limit_invalid", String(limit));
  }
  for (const flag of [
    "--path", "--root", "--catalog", "--executable", "--module", "--environment"
  ]) assert.throws(() => parseArgs([flag, "x"]), /unknown argument/u, flag);
});

test("environment state cannot override the intrinsic catalog", () => {
  const baseline = canonicalProofIntentDiscoveryJson(discoverProofIntents({
    query: "failure cleanup"
  }));
  const variable = "CONTROLLED_CONTRACT_PROOF_INTENT_CATALOG";
  const previous = process.env[variable];
  process.env[variable] = "/tmp/forged-catalog.json";
  try {
    assert.equal(canonicalProofIntentDiscoveryJson(discoverProofIntents({
      query: "failure cleanup"
    })), baseline);
  } finally {
    if (previous === undefined) delete process.env[variable];
    else process.env[variable] = previous;
  }
});

test("the runtime discovery module has no route into selection or pack admission", async () => {
  const source = await readFile(new URL(
    "lib/proof-intent-discovery.mjs", packageRoot
  ), "utf8");
  assert.doesNotMatch(source,
    /proof-intent-selection|admitted-proof-packs|loadAdmittedProofPack|selectProofPacks/u);
  const result = discoverProofIntents({ query: "protected effect nonmutation" });
  assert.equal(result.selection_performed, false);
  assert.equal(result.pack_invocation_performed, false);
  assert.equal(result.pack_admission_performed, false);
});

test("the bounded CLI emits byte-identical canonical search results", async () => {
  const cli = new URL("bin/discover-proof-intents.mjs", packageRoot);
  const first = await execFileAsync(process.execPath, [
    cli.pathname, "--query", "LOSSLESS---PROJECTION"
  ], {
    env: childEnvironment(), maxBuffer: MAX_DISCOVERY_RESULT_BYTES + 1024
  });
  const second = await execFileAsync(process.execPath, [
    cli.pathname, "--query", "lossless projection"
  ], {
    env: childEnvironment(), maxBuffer: MAX_DISCOVERY_RESULT_BYTES + 1024
  });
  assert.equal(first.stdout, second.stdout);
  assert.deepEqual(JSON.parse(first.stdout), discoverProofIntents({
    query: "lossless projection"
  }));
});

test("the bounded CLI does not echo an oversized unknown argument", async () => {
  const cli = new URL("bin/discover-proof-intents.mjs", packageRoot);
  const unknown = `--${"x".repeat(MAX_DISCOVERY_RESULT_BYTES + 1)}`;
  await assert.rejects(execFileAsync(process.execPath, [cli.pathname, unknown], {
    env: childEnvironment(), maxBuffer: MAX_DISCOVERY_RESULT_BYTES * 2
  }), (error) => {
    assert.equal(error.code, 1);
    assert.ok(Buffer.byteLength(error.stderr, "utf8") <=
      MAX_DISCOVERY_RESULT_BYTES);
    assert.equal(error.stderr.includes(unknown), false);
    assert.equal(JSON.parse(error.stderr).message, "unknown argument");
    return true;
  });
});
