import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { selectCausalSchemaDiagnostics } from
  "../../lib/bounded-diagnostic-projection.mjs";
import { compiledValidators } from "../../lib/compiled-validator-cache.mjs";
import { canonicalDigest } from "../../lib/deterministic-projection-primitives.mjs";
import {
  NATIVE_CONTRACT_SCHEMA_V1,
  validateAndResolveNativeContractV1
} from "../../lib/native-contract-carrier-v1.mjs";
import { validateStableV1ContractFamily } from
  "../../lib/stable-v1-family-validation.mjs";
import { buildAuthenticationProvenanceFixture } from
  "../proof-packs/authentication-provenance-v1-fixture.mjs";
import { buildStableTestProofPopulation } from
  "../support/stable-v1-proof-pack-runtime.mjs";

const CONTRACT_GROUP = "controlled-contract.native-contract-carrier-v1";
const SCHEMA_PATH = fileURLToPath(new URL(
  "../../schema/controlled-acceptance-contract.v1.schema.json", import.meta.url
));
const COVERAGE_POINTER = "/test_proofs/0/coverage_disposition";
const TEST_ID_POINTER = `${COVERAGE_POINTER}/items/0/test_id`;
const TEST_ID_PATTERN = "^test-[a-z0-9]+(?:-[a-z0-9]+)*$";

const COVERAGE_DEFS_DIGEST =
  "aa425419892df197a665241f368d2f37bb3c5313eaffcc0b559efa8d8b066575";

function buildSilentCoverageContract(testId) {
  const { contract } = buildAuthenticationProvenanceFixture();
  contract.test_proofs = buildStableTestProofPopulation(contract);
  const disposition = contract.test_proofs[0].coverage_disposition;
  disposition.baseline_state = "complete_executed_inventory";
  disposition.items = [{ test_id: testId, disposition: "preserved" }];
  return contract;
}

const rawErrorIdentity = ({ instancePath, schemaPath, keyword, params, message }) =>
  canonicalDigest({ instancePath, schemaPath, keyword, params: params ?? null, message });

const identities = (errors) => errors.map(rawErrorIdentity).sort();

function constError(instancePath, schemaPath, allowedValue) {
  return {
    instancePath, schemaPath, keyword: "const", params: { allowedValue },
    message: "must be equal to constant"
  };
}

function oneOfError(instancePath, schemaPath) {
  return {
    instancePath, schemaPath, keyword: "oneOf", params: { passingSchemas: null },
    message: "must match exactly one schema in oneOf"
  };
}

function patternError(instancePath, schemaPath) {
  return {
    instancePath, schemaPath, keyword: "pattern", params: { pattern: TEST_ID_PATTERN },
    message: `must match pattern "${TEST_ID_PATTERN}"`
  };
}

test("an invalid coverage test_id reports its own pattern failure alone", () => {
  const contract = buildSilentCoverageContract("npm-test-silent");
  const validation = validateAndResolveNativeContractV1(contract);

  assert.equal(validation.schema_valid, false);
  assert.deepEqual(validation.schema_errors, [{
    code: "stable_contract_schema_invalid",
    pointer: TEST_ID_POINTER,
    keyword: "pattern",
    message: `must match pattern "${TEST_ID_PATTERN}"`,
    expected_identity: null,
    actual_identity: null
  }]);

  const family = validateStableV1ContractFamily(contract);
  assert.equal(family.valid, false);
  assert.equal(family.diagnostics.total_count, 1);
  assert.equal(family.diagnostics.returned_count, 1);
  assert.equal(family.diagnostics.omitted_count, 0);
  assert.equal(family.diagnostics.truncated, false);
  assert.equal(family.diagnostics.diagnostics[0].pointer, TEST_ID_POINTER);
  assert.equal(family.diagnostics.diagnostics[0].keyword, "pattern");
  assert.ok(family.diagnostics.diagnostics[0].message.includes(TEST_ID_PATTERN));

  for (const keyword of ["oneOf", "const", "required", "maxItems"]) {
    assert.equal(validation.schema_errors.some((error) => error.keyword === keyword),
      false, keyword);
  }
});

test("restoring the declared coverage test_id validates without diagnostics", () => {
  const contract = buildSilentCoverageContract("test-npm-silent");
  const validation = validateAndResolveNativeContractV1(contract);

  assert.equal(validation.schema_valid, true);
  assert.deepEqual(validation.schema_errors, []);
  assert.deepEqual(validation.diagnostics, []);
  assert.equal(validation.valid, true);
  assert.equal(validation.family, "stable_v1");

  const family = validateStableV1ContractFamily(contract);
  assert.equal(family.valid, true);
  assert.equal(family.stage, "complete");
  assert.equal(family.diagnostics.total_count, 0);
});

test("nested discriminated oneOf families resolve recursively", () => {
  const errors = [
    oneOfError("/a", "#/oneOf"),
    constError("/a/kind", "#/oneOf/0/properties/kind/const", "alpha"),
    oneOfError("/a/b", "#/oneOf"),
    constError("/a/b/kind", "#/oneOf/0/properties/kind/const", "one"),
    constError("/a/b/kind", "#/oneOf/2/properties/kind/const", "three"),
    oneOfError("/a/b/c", "#/oneOf"),
    constError("/a/b/c/kind", "#/oneOf/1/properties/kind/const", "second"),
    patternError("/a/b/c/value", "#/$defs/value/pattern"),
    patternError("/a/b/c/value", "#/$defs/value/pattern")
  ];
  const families = [
    { pointer: "/a", keyword: "oneOf", branch_count: 2 },
    { pointer: "/a/b", keyword: "oneOf", branch_count: 3 },
    { pointer: "/a/b/c", keyword: "oneOf", branch_count: 2 }
  ];

  const selected = selectCausalSchemaDiagnostics({ errors, branch_families: families });
  assert.deepEqual(selected, [patternError("/a/b/c/value", "#/$defs/value/pattern")]);
});

test("an unproven oneOf family keeps its complete raw population", () => {
  const exhausted = [
    oneOfError("/x", "#/oneOf"),
    constError("/x/kind", "#/oneOf/0/properties/kind/const", "one"),
    constError("/x/kind", "#/oneOf/1/properties/kind/const", "two"),
    constError("/x/kind", "#/oneOf/2/properties/kind/const", "three")
  ];
  const families = [{ pointer: "/x", keyword: "oneOf", branch_count: 3 }];
  assert.deepEqual(
    selectCausalSchemaDiagnostics({ errors: exhausted, branch_families: families }),
    exhausted
  );

  const contradictory = [
    oneOfError("/x", "#/oneOf"),
    constError("/x/kind", "#/oneOf/0/properties/kind/const", "one"),
    constError("/x/kind", "#/oneOf/1/properties/kind/const", "two"),
    constError("/x/mode", "#/oneOf/1/properties/mode/const", "fast"),
    constError("/x/mode", "#/oneOf/2/properties/mode/const", "slow")
  ];
  assert.deepEqual(
    selectCausalSchemaDiagnostics({ errors: contradictory, branch_families: families }),
    contradictory
  );

  assert.deepEqual(
    selectCausalSchemaDiagnostics({ errors: contradictory, branch_families: [] }),
    contradictory
  );
});

test("a non-exclusive anyOf family is never collapsed", () => {
  const errors = [
    { instancePath: "/y", schemaPath: "#/anyOf", keyword: "anyOf",
      params: {}, message: "must match a schema in anyOf" },
    constError("/y/kind", "#/anyOf/0/properties/kind/const", "one"),
    patternError("/y/value", "#/anyOf/1/properties/value/pattern")
  ];
  const families = [{ pointer: "/y", keyword: "anyOf", branch_count: 2 }];
  assert.deepEqual(
    selectCausalSchemaDiagnostics({ errors, branch_families: families }), errors
  );
});

test("independent errors survive a proven selection at the same pointer", () => {
  const independent = {
    instancePath: "/a/kind", schemaPath: "#/$defs/kind/type", keyword: "type",
    params: { type: "string" }, message: "must be string"
  };
  const retainedBranchError = {
    instancePath: "/a/kind", schemaPath: "#/oneOf/1/properties/kind/minLength",
    keyword: "minLength", params: { limit: 3 },
    message: "must NOT have fewer than 3 characters"
  };
  const errors = [
    oneOfError("/a", "#/oneOf"),
    constError("/a/kind", "#/oneOf/0/properties/kind/const", "alpha"),
    independent,
    retainedBranchError
  ];
  const families = [{ pointer: "/a", keyword: "oneOf", branch_count: 2 }];
  assert.deepEqual(
    selectCausalSchemaDiagnostics({ errors, branch_families: families }),
    [independent, retainedBranchError]
  );
});

test("causal selection is independent of raw error order", async () => {
  const contract = buildSilentCoverageContract("npm-test-silent");
  const { validateSchema } = await compiledValidators(CONTRACT_GROUP, {
    validators: { validateSchema: NATIVE_CONTRACT_SCHEMA_V1 }
  });
  assert.equal(validateSchema(contract), false);
  const raw = [...validateSchema.errors];
  const families = [
    { pointer: COVERAGE_POINTER, keyword: "oneOf", branch_count: 2 },
    { pointer: `${COVERAGE_POINTER}/items/0`, keyword: "oneOf", branch_count: 3 }
  ];

  const forward = selectCausalSchemaDiagnostics({ errors: raw, branch_families: families });
  const reversed = selectCausalSchemaDiagnostics({
    errors: [...raw].reverse(), branch_families: [...families].reverse()
  });
  assert.deepEqual(identities(forward), identities(reversed));
  assert.equal(forward.length, 1);
  assert.equal(forward[0].keyword, "pattern");
});

test("repeated end-to-end validation returns the identical projection", () => {
  const first = validateStableV1ContractFamily(buildSilentCoverageContract("npm-test-silent"));
  const second = validateStableV1ContractFamily(buildSilentCoverageContract("npm-test-silent"));
  const third = validateStableV1ContractFamily(buildSilentCoverageContract("npm-test-silent"));

  assert.deepEqual(first.diagnostics, second.diagnostics);
  assert.deepEqual(second.diagnostics, third.diagnostics);
  assert.equal(canonicalDigest(first.diagnostics), canonicalDigest(third.diagnostics));
});

test("the schema, raw Ajv validity, and accepted-carrier semantics are untouched",
  async () => {
    const onDisk = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
    assert.deepEqual(onDisk, NATIVE_CONTRACT_SCHEMA_V1);
    assert.equal(canonicalDigest({
      coverage_disposition: onDisk.$defs.coverage_disposition,
      coverage_item: onDisk.$defs.coverage_item,
      test_id: onDisk.$defs.test_id
    }), COVERAGE_DEFS_DIGEST);

    const { validateSchema } = await compiledValidators(CONTRACT_GROUP, {
      validators: { validateSchema: NATIVE_CONTRACT_SCHEMA_V1 }
    });
    const invalid = buildSilentCoverageContract("npm-test-silent");
    assert.equal(validateSchema(invalid), false);

    assert.equal(validateSchema.errors.length, 11);
    assert.equal(validateAndResolveNativeContractV1(invalid).schema_errors.length, 1);

    const valid = buildSilentCoverageContract("test-npm-silent");
    assert.equal(validateSchema(valid), true);
    const resolved = validateAndResolveNativeContractV1(valid);
    assert.equal(resolved.valid, true);
    assert.equal(resolved.facts.test_proof_count, valid.test_proofs.length);
    assert.equal(resolved.facts.operative_residue_count, valid.residue.length);
  });
