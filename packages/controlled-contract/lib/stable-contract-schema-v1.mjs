import { readFileSync } from "node:fs";

import { testProofSchemaVocabularyMismatches } from "./test-proof-provider-registry.mjs";

const ROOT_URL = new URL("../schema/controlled-acceptance-contract.v1.schema.json", import.meta.url);
const FRAGMENT_URL = new URL("../schema/controlled-acceptance-test-proof-definitions.v1.schema.json", import.meta.url);
const PROOF_DEFINITIONS = Object.freeze([
  "test_proof_id",
  "boundary_id",
  "observable_id",
  "falsifier_id",
  "provider_id",
  "provider_version",
  "repo_module_path",
  "mutation_id",
  "execution_provider_identity",
  "falsification_provider_binding",
  "traversal_provider_binding",
  "system_under_test_boundary",
  "observable_result",
  "falsifier",
  "test_selector",
  "test_proof_binding"
]);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function composeStableContractSchemaV1(root, fragment) {
  if (!isObject(root) || !isObject(root.$defs) || !isObject(fragment) ||
      Object.keys(fragment).length !== 1 || !isObject(fragment.$defs) ||
      Object.keys(fragment.$defs).length !== PROOF_DEFINITIONS.length ||
      PROOF_DEFINITIONS.some(key => !isObject(fragment.$defs[key]))) {
    throw new Error("stable-v1 schema composition has malformed or incomplete definitions");
  }
  const stale = [...testProofSchemaVocabularyMismatches("root", root),
    ...testProofSchemaVocabularyMismatches("definitions", fragment)];
  if (stale.length > 0) {
    throw new Error("stable-v1 schema composition disagrees with the provider catalog at " +
      stale.join(", "));
  }
  for (const key of Object.keys(fragment.$defs)) {
    if (Object.hasOwn(root.$defs, key)) {
      throw new Error(`stable-v1 schema composition has a conflicting definition: ${key}`);
    }
  }
  return structuredClone({ ...root, $defs: { ...root.$defs, ...fragment.$defs } });
}

export function loadStableContractSchemaV1(read = readFileSync) {
  const readSchema = url => {
    try { return JSON.parse(read(url, "utf8")); }
    catch (cause) { throw new Error(`cannot read stable-v1 schema member ${url.pathname}`, { cause }); }
  };
  return composeStableContractSchemaV1(readSchema(ROOT_URL), readSchema(FRAGMENT_URL));
}

export default loadStableContractSchemaV1();
