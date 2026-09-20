

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  TEST_PROOF_PROVIDER_CATALOG,
  TEST_PROOF_PROVIDER_REGISTRY_VERSION,
  TEST_RUNTIME_RUNNER_CATALOG,
  TestProofProviderCatalogError,
  composeTestProofProviderFamilies,
  testProofProviderFamily
} from "../../packages/controlled-contract/lib/test-proof-provider-registry.mjs";
import { TEST_PROOF_PROVIDER_FAMILIES } from
  "../../packages/controlled-contract/lib/test-proof-providers/index.mjs";

const INVENTORY = Object.freeze({
  "node:test": "runner.node-test", jest: "runner.jest", vitest: "runner.vitest",
  mocha: "runner.mocha", ava: "runner.ava", "deno test": "runner.deno",
  "lib0/testing": "runner.lib0-testing", pytest: "runner.pytest", stestr: "runner.stestr",
  "go test": "runner.go-test", "cargo test": "runner.cargo-test"
});
const CAPABILITIES = ["candidate_execution", "falsifier_execution", "boundary_traversal"];

test("provider families accommodate the eleven runner inventory", () => {
  const runners = TEST_RUNTIME_RUNNER_CATALOG.runners;
  assert.deepEqual(Object.fromEntries(runners.map(({ runner, runner_id: id }) => [runner, id])), INVENTORY);
  assert.deepEqual([...new Set(runners.flatMap(({ languages }) => languages))].sort(),
    ["go", "javascript", "python", "rust", "typescript"]);
  assert.equal(TEST_PROOF_PROVIDER_REGISTRY_VERSION, "1.3.0");
  assert.equal(TEST_RUNTIME_RUNNER_CATALOG.registry_version, TEST_PROOF_PROVIDER_REGISTRY_VERSION);
  assert.match(TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(Object.isFrozen(TEST_PROOF_PROVIDER_CATALOG.providers[0]));
  for (const runner of runners) {
    const family = testProofProviderFamily(runner.selector_kind);
    assert.ok(family, runner.runner_id);
    assert.ok(runner.toolchains.length > 0, runner.runner_id);
    assert.equal(typeof runner.dependency_ecosystem, "string");
    assert.ok(family.source_suffixes.length > 0, runner.runner_id);

    for (const capability of CAPABILITIES) {
      const descriptor = family.providers[capability];
      assert.deepEqual(descriptor.capabilities, [capability], `${runner.runner_id} ${capability}`);
      assert.equal(descriptor.selector_kind, runner.selector_kind);
      assert.equal(runner.proof_providers[capability], descriptor.provider_id);
      assert.equal(descriptor.provider_version, capability === "falsifier_execution" &&
        runner.runner_id === "runner.node-test" ? "2.0.0" : "1.0.0");
    }
  }
  assert.equal(TEST_PROOF_PROVIDER_CATALOG.providers.length, 11 * CAPABILITIES.length);

  assert.ok(runners.filter(({ languages }) => languages.includes("typescript")).length >= 3);
});

test("composition refuses ambiguous or incomplete families", () => {
  const [node, pytest] = TEST_PROOF_PROVIDER_FAMILIES;
  const refuses = (families) => assert.throws(() => composeTestProofProviderFamilies(families),
    (error) => error instanceof TestProofProviderCatalogError &&
      error.code === "test_proof_provider_catalog_invalid");
  refuses([node, node]);
  refuses([node, { ...pytest, runtime: node.runtime }]);
  refuses([node, { ...pytest, providers: pytest.providers.slice(1) }]);
  refuses([node, { ...pytest, providers: [...pytest.providers, pytest.providers[0]] }]);
  refuses([node, { ...pytest, witness_validators: { falsifier_result: {}, boundary_trace: {} } }]);
  refuses([node, { ...pytest, selector: { ...pytest.selector, grammar: null } }]);
  assert.equal(composeTestProofProviderFamilies([node, pytest]).providers.length, 6);

  const source = readFileSync(new URL(
    "../../packages/controlled-contract/lib/test-proof-provider-registry.mjs", import.meta.url), "utf8");
  for (const literal of [...Object.keys(INVENTORY), ...Object.values(INVENTORY), "python", "rust",
    "typescript", ".py", ".rs", ".ts", "pytest", "jest"]) {
    assert.equal(source.includes(`"${literal}"`), false, literal);
  }
  assert.equal(/agent-launch|test-execution|runner-integrations/u.test(source), false);
});
