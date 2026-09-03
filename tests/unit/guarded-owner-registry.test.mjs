import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  GUARDED_OWNER_REGISTRY_DIAGNOSTICS as CODES,
  GuardedOwnerRegistryError,
  defineGuardedOwnerCategoryAdapter,
  deriveGuardedOwnerPopulation,
  loadGuardedOwnerRegistry,
  validateGuardedOwnerReferences,
  validateGuardedOwnerRegistryDefinition
} from "../../packages/wiki-core/src/lib/guarded-owner-registry.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const DATA_PATH = path.join(
  REPO_ROOT,
  "packages/wiki-core/data/guarded-owner-registry.v1.json"
);

const clone = (value) => structuredClone(value);
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const hasCode = (code) => (error) => error instanceof GuardedOwnerRegistryError && error.code === code;

async function registry() {
  return JSON.parse(await readFile(DATA_PATH, "utf8"));
}

function singleBinding(source, categoryId = source.bindings[0].category_id) {
  const result = clone(source);
  result.bindings = [result.bindings.find((binding) => binding.category_id === categoryId)];
  result.supported_categories = [categoryId];
  result.owner_references = result.owner_references.filter((reference) =>
    result.bindings[0].owner_reference_ids.includes(reference.reference_id)
  );
  return result;
}

test("the closed registry binds each guarded class to one owner and current owner proof", async () => {
  const value = await loadGuardedOwnerRegistry();
  assert.equal(value.closed, true);
  assert.equal(value.bindings.length, 10);
  assert.equal(new Set(value.bindings.map((entry) => entry.guarded_class_id)).size, 10);
  assert.equal(new Set(value.bindings.map((entry) => entry.diagnostic_id)).size, 10);
  assert.deepEqual(
    new Set(value.bindings.map((entry) => entry.semantic_owner)),
    new Set([
      "WK-2257", "WK-2258", "WK-2357", "WK-2359", "WK-2382", "WK-2391", "WK-2405", "WK-2428",
      "decision:family_adapter_boundary", "decision:launcher_neutrality"
    ])
  );
  const trackedPaths = [...new Set(value.owner_references.map((reference) => reference.path))];
  await validateGuardedOwnerReferences(value, { repositoryRoot: REPO_ROOT, trackedPaths });
});

test("guarded bindings retain their exact current witnesses", async () => {
  const value = await loadGuardedOwnerRegistry();
  const referenceById = new Map(value.owner_references.map((reference) =>
    [reference.reference_id, reference]));
  const bindingByOwner = new Map(value.bindings.map((binding) =>
    [binding.semantic_owner, binding]));
  const expected = new Map([
    ["WK-2359", [
      "ref-wk2359-witness-dispatch-ergonomics",
      "ref-wk2359-witness-backend-routing",
      "ref-wk2359-witness-internal-exception",
      "ref-wk2359-witness-response-dedup",
      "ref-wk2359-witness-compact-read",
      "ref-wk2391-preflight-witness"
    ]],
    ["WK-2382", [
      "ref-wk2382-witness-handler-boundary",
      "ref-wk2382-witness-census"
    ]]
  ]);

  for (const [owner, referenceIds] of expected) {
    const binding = bindingByOwner.get(owner);
    assert.deepEqual(binding.owner_reference_ids, referenceIds);
    assert.ok(referenceIds.every((referenceId) => referenceById.has(referenceId)));
  }
  assert.equal(referenceById.get("ref-wk2359-witness-dispatch-ergonomics").path,
    referenceById.get("ref-wk2428-recovery-witness").path);
  assert.equal(referenceById.get("ref-wk2359-witness-backend-routing").path,
    "tests/integration/workspace-agent-advisory-review-production-composition.test.mjs");
  assert.equal(referenceById.get("ref-wk2405-findings-witness").path,
    "tests/integration/workspace-agent-advisory-material.test.mjs");
});

test("registry data carries no semantic, predicate, validator, selector-rule, witness-body, or copied-authority content", async () => {
  const serialized = JSON.stringify(await registry());
  for (const forbidden of [
    "semantic_disposition",
    "witness_body",
    "carrier_validator",
    "authentication_predicate",
    "recovery_predicate",
    "common_proof_selection_rule",
    "copied_owner_authority"
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("malformed reference identities, paths, digests, and proof selectors fail loudly", async () => {
  const baseline = await registry();
  for (const mutate of [
    (value) => { value.owner_references[0].reference_id = "not-a-reference"; },
    (value) => { value.owner_references[0].path = "../outside.test.mjs"; },
    (value) => { value.owner_references[0].content_digest = "sha256:short"; },
    (value) => { value.owner_references[0].selector = "node --test tests/unit/other.test.mjs"; }
  ]) {
    const value = clone(baseline);
    mutate(value);
    assert.throws(() => validateGuardedOwnerRegistryDefinition(value), hasCode(CODES.MALFORMED_REFERENCE));
  }
});

test("duplicate bindings, contradictory owners, and copied mechanical entries remain distinct diagnostics", async () => {
  const baseline = await registry();

  const duplicate = clone(baseline);
  duplicate.bindings.push(clone(duplicate.bindings[0]));
  assert.throws(() => validateGuardedOwnerRegistryDefinition(duplicate), hasCode(CODES.DUPLICATE_BINDING));

  const contradictory = clone(baseline);
  const contradiction = clone(contradictory.bindings[0]);
  contradiction.binding_id = "contradictory_binding";
  contradiction.diagnostic_id = "guarded_owner_contradictory_test";
  contradiction.semantic_owner = "WK-2257";
  contradictory.bindings.push(contradiction);
  assert.throws(
    () => validateGuardedOwnerRegistryDefinition(contradictory),
    hasCode(CODES.CONTRADICTORY_OWNERSHIP)
  );

  const copied = clone(baseline);
  const copy = clone(copied.bindings[0]);
  copy.binding_id = "copied_binding";
  copy.guarded_class_id = "copied_guarded_class";
  copy.diagnostic_id = "guarded_owner_copied_test";
  copied.bindings.push(copy);
  assert.throws(
    () => validateGuardedOwnerRegistryDefinition(copied),
    hasCode(CODES.COPIED_MECHANICAL_ENTRY)
  );
});

test("unsupported categories, broad selectors, anonymous allowlists, and missing owner bindings are rejected", async () => {
  const baseline = await registry();

  const unsupported = clone(baseline);
  unsupported.bindings[0].category_id = "unregistered_category";
  unsupported.bindings[0].discovery_rule.adapter_id = "unregistered_category";
  assert.throws(() => validateGuardedOwnerRegistryDefinition(unsupported), hasCode(CODES.UNSUPPORTED_CATEGORY));

  const broad = clone(baseline);
  broad.bindings[0].discovery_rule.roots = ["packages"];
  assert.throws(() => validateGuardedOwnerRegistryDefinition(broad), hasCode(CODES.BROAD_SELECTOR));

  const anonymous = clone(baseline);
  anonymous.allowlist = [];
  assert.throws(() => validateGuardedOwnerRegistryDefinition(anonymous), hasCode(CODES.FORBIDDEN_CONTENT));

  const missing = clone(baseline);
  missing.bindings[0].owner_reference_ids = ["ref-missing-owner-proof"];
  assert.throws(() => validateGuardedOwnerRegistryDefinition(missing), hasCode(CODES.MISSING_OWNER_REFERENCE));
  const missingCategory = clone(baseline);
  const removed = missingCategory.bindings.pop();
  missingCategory.owner_references = missingCategory.owner_references.filter((reference) =>
    !removed.owner_reference_ids.includes(reference.reference_id)
  );
  assert.throws(() => validateGuardedOwnerRegistryDefinition(missingCategory), hasCode(CODES.UNSUPPORTED_CATEGORY));
  await assert.rejects(deriveGuardedOwnerPopulation(missingCategory, {
    repositoryRoot: "/repo", trackedPaths: [], categoryAdapters: new Map()
  }), hasCode(CODES.UNSUPPORTED_CATEGORY));
});

test("unresolved facts require an exact owner, source, falsifier, remediation, finite bound, and population bound", async () => {
  const baseline = await registry();
  const bounded = clone(baseline);
  bounded.unresolved_fact_limit = 1;
  bounded.unresolved_facts.push({
    fact_id: "bounded_fact",
    source_identity: "packages/wiki-core/src/lib/example.mjs:4:2:catch:1",
    semantic_owner: "WK-2359",
    remediation_wk: "WK-2359#SLICE-001",
    falsifying_test_reference_id: "ref-wk2359-witness-dispatch-ergonomics",
    expires: "repository_milestone:WK-2359"
  });
  assert.equal(validateGuardedOwnerRegistryDefinition(bounded), bounded);
  const dangling = clone(bounded);
  dangling.unresolved_facts[0].falsifying_test_reference_id = "ref-does-not-exist";
  assert.throws(() => validateGuardedOwnerRegistryDefinition(dangling), hasCode(CODES.MISSING_OWNER_REFERENCE));

  const unbounded = clone(bounded);
  unbounded.unresolved_facts[0].expires = "never";
  assert.throws(() => validateGuardedOwnerRegistryDefinition(unbounded), hasCode(CODES.UNBOUNDED_FACT));

  const overflow = clone(bounded);
  overflow.unresolved_fact_limit = 0;
  assert.throws(() => validateGuardedOwnerRegistryDefinition(overflow), hasCode(CODES.UNBOUNDED_FACT));
});

test("stale and moved owner-proof locations fail with the moved target disclosed when mechanically found", async () => {
  const value = singleBinding(await registry());
  const proof = Buffer.from("owner-produced-proof\n");
  value.owner_references[0] = {
    reference_id: value.owner_references[0].reference_id,
    reference_kind: "owner_proof",
    path: "tests/unit/old-proof.test.mjs",
    content_digest: digest(proof),
    selector: "node --test tests/unit/old-proof.test.mjs"
  };
  const read = async (absolutePath) => {
    if (absolutePath.endsWith("new-proof.test.mjs")) return proof;
    return Buffer.from("different\n");
  };
  await assert.rejects(
    validateGuardedOwnerReferences(value, {
      repositoryRoot: "/repo",
      trackedPaths: ["tests/unit/new-proof.test.mjs"],
      read
    }),
    (error) => hasCode(CODES.SOURCE_LOCATION_STALE)(error) && error.details.moved_to === "tests/unit/new-proof.test.mjs"
  );
  await assert.rejects(
    validateGuardedOwnerReferences(value, {
      repositoryRoot: "/repo",
      trackedPaths: ["tests/unit/unrelated.test.mjs"],
      read
    }),
    (error) => hasCode(CODES.SOURCE_LOCATION_STALE)(error) && error.details.moved_to === null
  );
});

test("missing and digest-mismatched owner proofs fail with separate stable diagnostics", async () => {
  const value = singleBinding(await registry());
  const trackedPaths = [value.owner_references[0].path];
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  await assert.rejects(
    validateGuardedOwnerReferences(value, {
      repositoryRoot: "/repo",
      trackedPaths,
      read: async () => { throw missing; }
    }),
    hasCode(CODES.MISSING_OWNER_REFERENCE)
  );
  await assert.rejects(
    validateGuardedOwnerReferences(value, {
      repositoryRoot: "/repo",
      trackedPaths,
      read: async () => Buffer.from("changed owner proof")
    }),
    hasCode(CODES.OWNER_REFERENCE_DIGEST_MISMATCH)
  );
});

test("category adapters surface new and moved matching production sites from the full declared tracked population", async () => {
  const value = singleBinding(await registry(), "durability_liveness");
  const binding = value.bindings[0];
  const adapter = defineGuardedOwnerCategoryAdapter(binding.category_id, ({ source }) =>
    source.includes("GUARDED") ? [{ line: 1, column: 1, kind: "guarded_site" }] : []
  );
  const adapters = new Map([[binding.category_id, adapter]]);
  const sources = new Map([
    ["packages/wiki-core/src/lib/original.mjs", "GUARDED\n"],
    ["packages/wiki-core/src/lib/new.mjs", "GUARDED\n"],
    ["packages/wiki-core/src/lib/moved.mjs", "GUARDED\n"],
    ["packages/wiki-core/src/lib/inert.mjs", "ordinary\n"]
  ]);
  const read = async (absolutePath) => sources.get(path.relative("/repo", absolutePath));

  const initial = await deriveGuardedOwnerPopulation(value, {
    repositoryRoot: "/repo",
    trackedPaths: ["packages/wiki-core/src/lib/original.mjs", "packages/wiki-core/src/lib/inert.mjs"],
    categoryAdapters: adapters,
    read
  });
  assert.equal(initial.length, 1);

  const expanded = await deriveGuardedOwnerPopulation(value, {
    repositoryRoot: "/repo",
    trackedPaths: ["packages/wiki-core/src/lib/original.mjs", "packages/wiki-core/src/lib/new.mjs"],
    categoryAdapters: adapters,
    read
  });
  assert.equal(expanded.length, 2);
  assert.ok(expanded.some((site) => site.source_identity.startsWith("packages/wiki-core/src/lib/new.mjs:")));

  const moved = await deriveGuardedOwnerPopulation(value, {
    repositoryRoot: "/repo",
    trackedPaths: ["packages/wiki-core/src/lib/moved.mjs"],
    categoryAdapters: adapters,
    read
  });
  assert.equal(moved.length, 1);
  assert.ok(moved[0].source_identity.startsWith("packages/wiki-core/src/lib/moved.mjs:"));
});

test("a declared guarded category cannot run without its exact adapter", async () => {
  const value = singleBinding(await registry());
  await assert.rejects(
    deriveGuardedOwnerPopulation(value, {
      repositoryRoot: "/repo",
      trackedPaths: [],
      categoryAdapters: new Map(),
      read: async () => ""
    }),
    hasCode(CODES.MISSING_ADAPTER)
  );
});
