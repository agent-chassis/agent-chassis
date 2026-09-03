import { readFile } from "node:fs/promises";

import { compiledValidators } from "./compiled-validator-cache.mjs";

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

const schemaNames = Object.freeze([
  "controlled-contract-exact-binding-declaration.v1.schema.json",
  "controlled-contract-exact-binding-sources.v1.schema.json",
  "controlled-contract-exact-binding-assessment-request.v1.schema.json",
  "controlled-contract-exact-binding-certification-result.v1.schema.json",
  "controlled-contract-exact-binding-result.v1.schema.json",
  "controlled-contract-admitted-proof-pack.v2.schema.json"
]);
const schemaUrls = Object.freeze({
  "controlled-contract-exact-binding-declaration.v1.schema.json":
    new URL("../schema/controlled-contract-exact-binding-declaration.v1.schema.json",
      import.meta.url),
  "controlled-contract-exact-binding-sources.v1.schema.json":
    new URL("../schema/controlled-contract-exact-binding-sources.v1.schema.json",
      import.meta.url),
  "controlled-contract-exact-binding-assessment-request.v1.schema.json":
    new URL("../schema/controlled-contract-exact-binding-assessment-request.v1.schema.json",
      import.meta.url),
  "controlled-contract-exact-binding-certification-result.v1.schema.json":
    new URL("../schema/controlled-contract-exact-binding-certification-result.v1.schema.json",
      import.meta.url),
  "controlled-contract-exact-binding-result.v1.schema.json":
    new URL("../schema/controlled-contract-exact-binding-result.v1.schema.json",
      import.meta.url),
  "controlled-contract-admitted-proof-pack.v2.schema.json":
    new URL("../schema/controlled-contract-admitted-proof-pack.v2.schema.json",
      import.meta.url)
});

const schemaValues = await Promise.all(schemaNames.map(async (name) => JSON.parse(
  await readFile(schemaUrls[name], "utf8")
)));
const validators = Object.freeze(await compiledValidators(
  "controlled-contract.exact-binding-common.v1", {
    schemas: schemaValues,
    validators: Object.fromEntries(schemaNames.map((name) => [name, { ref: name }]))
  }
));

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
