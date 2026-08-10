import { readFile } from "node:fs/promises";

import Ajv2020 from "ajv/dist/2020.js";

import {
  ExactBindingError,
  canonicalDigest,
  canonicalJsonBytes,
  canonicalValue,
  compareCodeUnits,
  deepFreeze,
  sha256,
  sortedUnique
} from "./deterministic-projection-primitives.mjs";

const packageRoot = new URL("../", import.meta.url);
const schemaNames = Object.freeze([
  "controlled-contract-exact-binding-declaration.v1.schema.json",
  "controlled-contract-exact-binding-sources.v1.schema.json",
  "controlled-contract-exact-binding-assessment-request.v1.schema.json",
  "controlled-contract-exact-binding-certification-result.v1.schema.json",
  "controlled-contract-exact-binding-result.v1.schema.json",
  "controlled-contract-admitted-proof-pack.v2.schema.json"
]);

const schemaValues = await Promise.all(schemaNames.map(async (name) => JSON.parse(
  await readFile(new URL(`schema/${name}`, packageRoot), "utf8")
)));
const ajv = new Ajv2020({ strict: true, allErrors: true });
for (const schema of schemaValues) ajv.addSchema(schema);

const validators = Object.freeze(Object.fromEntries(schemaNames.map((name) => [
  name,
  ajv.getSchema(name)
])));

function assertSchema(schemaName, value, code) {
  const validate = validators[schemaName];
  if (!validate(value)) throw new ExactBindingError(
    code,
    `value does not satisfy ${schemaName}`,
    { diagnostics: structuredClone(validate.errors) }
  );
  return value;
}

export {
  ExactBindingError,
  assertSchema,
  canonicalDigest,
  canonicalJsonBytes,
  canonicalValue,
  compareCodeUnits,
  deepFreeze,
  sha256,
  sortedUnique,
  validators
};
