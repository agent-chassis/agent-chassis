import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  checkedWeightAdd
} from "../lib/proof-aware-planning-carrier.mjs";
import {
  PLANNING_POLICY
} from "../lib/proof-aware-planning-policy.mjs";
import {
  constructProofAwarePlanningCarrier
} from "../lib/proof-aware-unit2-construction.mjs";

const load = async (name) => JSON.parse(await readFile(new URL(
  `../lib/${name}`, import.meta.url
), "utf8"));
const policySchema = await load(
  "proof-aware-planning-policy.experimental.v1.schema.json"
);
const carrierSchema = await load(
  "proof-aware-resolved-carrier.experimental.v2.schema.json"
);
const resultSchema = await load(
  "proof-aware-unit2-construction-result.experimental.v2.schema.json"
);

function resultValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addSchema(carrierSchema);
  return ajv.compile(resultSchema);
}

test("all private Unit 2 schemas compile strictly and the frozen policy validates", () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  assert.equal(ajv.compile(policySchema)(PLANNING_POLICY), true);
  ajv.addSchema(carrierSchema);
  assert.equal(typeof ajv.compile(resultSchema), "function");
});

test("failure schema forbids topology and unknown or chunk fields", () => {
  const validate = resultValidator();
  const baseline = constructProofAwarePlanningCarrier({ input_version: "unknown" });
  assert.equal(validate(baseline), true, JSON.stringify(validate.errors));
  for (const [field, value] of [["resolved_carrier", {}], ["orbit_input", {}],
    ["weights", {}], ["chunk", 0], ["chunks", []], ["unknown", true]]) {
    const attacked = { ...structuredClone(baseline), [field]: value };
    assert.equal(validate(attacked), false, field);
  }
});

test("authority exclusions are mandatory categorical false values", () => {
  const validate = resultValidator();
  const baseline = constructProofAwarePlanningCarrier({ input_version: "unknown" });
  assert.equal(validate(baseline), true, JSON.stringify(validate.errors));
  assert.equal(Object.keys(baseline.authority.mandatory_exclusions).length, 10);
  for (const key of Object.keys(baseline.authority.mandatory_exclusions)) {
    const omitted = structuredClone(baseline);
    delete omitted.authority.mandatory_exclusions[key];
    assert.equal(validate(omitted), false, `omitted:${key}`);
    const substituted = structuredClone(baseline);
    substituted.authority.mandatory_exclusions[key] = true;
    assert.equal(validate(substituted), false, `true:${key}`);
  }
});

test("checked weight arithmetic refuses unsafe integer overflow", () => {
  assert.deepEqual(checkedWeightAdd(
    { behavior: 1, verification: 2, capture: 3, serialization: 4 },
    { behavior: 4, verification: 3, capture: 2, serialization: 1 }
  ), { behavior: 5, verification: 5, capture: 5, serialization: 5 });
  assert.throws(() => checkedWeightAdd(
    { behavior: Number.MAX_SAFE_INTEGER, verification: 0, capture: 0,
      serialization: 0 },
    { behavior: 1, verification: 0, capture: 0, serialization: 0 }
  ), /PA_WEIGHT_OVERFLOW/u);
});

test("Unit 2 remains unreachable through package exports and payload census", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json",
    import.meta.url), "utf8"));
  const serialized = JSON.stringify({ exports: manifest.exports, files: manifest.files,
    bin: manifest.bin });
  assert.doesNotMatch(serialized, /proof-aware-(?:planning|unit2|resolved)/u);
});
