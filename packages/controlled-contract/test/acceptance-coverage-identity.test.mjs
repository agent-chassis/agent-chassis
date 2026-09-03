import assert from "node:assert/strict";
import test from "node:test";

import {
  compareCriterionIdentitySets,
  deriveCriterionIdentitySet,
  normalizeCriterionIdentityEntry,
  AcceptanceCoverageIdentityError
} from "../lib/acceptance-coverage-identity.mjs";
import { unsupportedObjectKeys } from "../lib/deterministic-projection-primitives.mjs";

const digests = {
  contractDigest: "contract-1",
  proofPlanDigest: "proof-1",
  selectedPackDigest: "pack-1",
  mappingDigest: "mapping-1"
};

function make(criteria, overrides = {}) {
  return deriveCriterionIdentitySet({
    criteria,
    selectedUnitDigest: "unit-1",
    bindings: { ...digests, ...overrides }
  });
}

test("derives ordered text identities and records unit provenance only", () => {
  const set = make(["first", "second"]);
  assert.equal(set.identities[0].source, "derived");
  assert.notEqual(set.identities[0].identity, set.identities[1].identity);
  assert.equal(set.provenance.selectedUnitDigest, "unit-1");
  const churned = deriveCriterionIdentitySet({
    criteria: ["first", "second"], selectedUnitDigest: "unit-2", bindings: digests
  });
  assert.deepEqual(set.identities, churned.identities);
});

test("addition, removal, reorder, and text change are stale", () => {
  const base = make(["a", "b"]);
  for (const changed of [["a", "b", "c"], ["a"], ["b", "a"], ["a changed", "b"]]) {
    const result = compareCriterionIdentitySets(base, make(changed));
    assert.equal(result.current, false);
    assert.equal(result.stale, true);
    assert.ok(result.staleCriteria.length > 0);
  }
});

test("each bound digest mutation makes a set stale", () => {
  const base = make(["a"]);
  for (const name of Object.keys(digests)) {
    const result = compareCriterionIdentitySets(base, make(["a"], { [name]: `${name}-2` }));
    assert.equal(result.current, false);
    assert.equal(result.stale, true);
    assert.deepEqual(result.bindingChanges, [name]);

    const unchanged = compareCriterionIdentitySets(base, base);
    assert.equal(unchanged.stale, false);
  }
});

test("only the declared typed identity spelling is preferred", () => {
  const accepted = make([{ text: "typed", typed_identity: "wk1915:criterion:1" }]);
  assert.deepEqual(accepted.identities.map(({ identity, source }) => ({ identity, source })), [
    { identity: "wk1915:criterion:1", source: "typed" }
  ]);
  for (const field of ["typedIdentity", "criterionIdentity", "criterion_identity", "identity"]) {
    assert.throws(() => make([{ text: field, [field]: "undeclared" }]), (error) => {
      assert.equal(error.code, "criterion_identity_input_invalid");
      return true;
    });
  }
  assert.throws(() => make([{ text: "object", typed_identity: { value: "undeclared" } }]),
    (error) => error.code === "criterion_identity_input_invalid");
  const absent = make([{ text: "derived" }]);
  assert.deepEqual(absent.identities.map(({ identity, source }) => ({ identity, source })), [
    { identity: absent.identities[0].identity, source: "derived" }
  ]);
});

test("duplicate typed identities produce a duplicate outcome, not a change", () => {
  const set = make([
    { text: "first", typed_identity: "duplicate" },
    { text: "second", typed_identity: "duplicate" }
  ]);
  assert.deepEqual(compareCriterionIdentitySets(set, set), {
    current: false,
    stale: true,
    bindingChanges: [],
    staleCriteria: [{ identity: "duplicate", reason: "duplicate" }]
  });
});

test("typed identities are preferred and absent typed identities derive", () => {
  const set = make([{ text: "typed", typed_identity: "wk1915:criterion:1" }, { text: "derived" }]);
  assert.deepEqual(set.identities.map(({ identity, source }) => ({ identity, source })), [
    { identity: "wk1915:criterion:1", source: "typed" },
    { identity: set.identities[1].identity, source: "derived" }
  ]);
});

test("unchanged sets are current", () => {
  const set = make(["a", "b"]);
  assert.deepEqual(compareCriterionIdentitySets(set, make(["a", "b"])), {
    current: true, stale: false, bindingChanges: [], staleCriteria: []
  });
});

test("RV-006 fails closed for malformed identities and unknown criterion keys", () => {
  assert.equal(make([{ text: "absent" }]).identities[0].source, "derived");
  for (const typed_identity of ["", null, 42, { value: "bad" }]) {
    assert.throws(() => make([{ text: "malformed", typed_identity }]), (error) => {
      assert.ok(error instanceof AcceptanceCoverageIdentityError);
      assert.equal(error.code, "criterion_identity_input_invalid");
      return true;
    });
  }
  for (const key of ["typedIdentity", "criterion_identity", "identity"]) {
    assert.throws(() => make([{ text: "unknown", [key]: "bad" }]), (error) => {
      assert.equal(error.code, "criterion_identity_input_invalid");
      assert.deepEqual(error.details.unsupportedKeys, [key]);
      return true;
    });
  }
});

test("normalizes exact identity entries and shares closed-key inspection", () => {
  assert.deepEqual(normalizeCriterionIdentityEntry({
    position: 0, text: "criterion", identity: "derived:x", source: "derived"
  }), { position: 0, text: "criterion", identity: "derived:x", source: "derived" });
  assert.deepEqual(unsupportedObjectKeys({ text: "criterion", typed_identity: "id" }, [
    "text", "typed_identity"
  ]), []);
  assert.deepEqual(unsupportedObjectKeys({ text: "criterion", typo: true }, ["text"]), ["typo"]);
  assert.throws(() => normalizeCriterionIdentityEntry({
    position: 0, text: "criterion", identity: "id", source: "derived", extra: true
  }), (error) => error.code === "criterion_identity_entry_invalid");
});
