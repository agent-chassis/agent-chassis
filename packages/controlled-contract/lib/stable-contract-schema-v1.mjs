import { readFileSync } from "node:fs";

import { testProofSchemaVocabularyMismatches } from "./test-proof-provider-registry.mjs";

const ROOT_URL = new URL("../schema/controlled-acceptance-contract.v1.schema.json", import.meta.url);
const FRAGMENT_URL = new URL("../schema/controlled-acceptance-test-proof-definitions.v1.schema.json", import.meta.url);
const REQUIREMENT_FRAGMENT_URL = new URL("../schema/controlled-acceptance-requirement-definitions.v1.schema.json", import.meta.url);
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

const REQUIREMENT_DEFINITIONS = Object.freeze([
  "authored_requirements",
  "authored_requirement_row_id",
  "authored_requirement_collection_row_id",
  "authored_constraint_id",
  "authored_entity",
  "authored_pending_value",
  "authored_applicability",
  "authored_statement_object",
  "authored_requirement_statement",
  "authored_requirement_membership",
  "authored_requirement_source",
  "authored_requirement_row",
  "authored_requirement_collection",
  "authored_unresolved_meaning",
  "authored_grammar_exception"
]);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const readSchemaWith = read => url => {
  try { return JSON.parse(read(url, "utf8")); }
  catch (cause) { throw new Error(`cannot read stable-v1 schema member ${url.pathname}`, { cause }); }
};
const isFragmentOf = (fragment, names) => isObject(fragment) && Object.keys(fragment).length === 1 &&
  isObject(fragment.$defs) && Object.keys(fragment.$defs).length === names.length &&
  names.every(key => isObject(fragment.$defs[key]));

const REQUIREMENT_FRAGMENT = readSchemaWith(readFileSync)(REQUIREMENT_FRAGMENT_URL);

export function composeStableContractSchemaV1(root, fragment, requirements = REQUIREMENT_FRAGMENT) {
  if (!isObject(root) || !isObject(root.$defs) || !isFragmentOf(fragment, PROOF_DEFINITIONS) ||
      !isFragmentOf(requirements, REQUIREMENT_DEFINITIONS)) {
    throw new Error("stable-v1 schema composition has malformed or incomplete definitions");
  }
  const stale = [...testProofSchemaVocabularyMismatches("root", root),
    ...testProofSchemaVocabularyMismatches("definitions", fragment)];
  if (stale.length > 0) {
    throw new Error("stable-v1 schema composition disagrees with the provider catalog at " +
      stale.join(", "));
  }
  for (const key of [...Object.keys(fragment.$defs), ...Object.keys(requirements.$defs)]) {
    if (Object.hasOwn(root.$defs, key)) {
      throw new Error(`stable-v1 schema composition has a conflicting definition: ${key}`);
    }
  }
  return structuredClone({ ...root, $defs: { ...root.$defs, ...fragment.$defs, ...requirements.$defs } });
}

export function loadStableContractSchemaV1(read = readFileSync) {
  const readSchema = readSchemaWith(read);
  return composeStableContractSchemaV1(readSchema(ROOT_URL), readSchema(FRAGMENT_URL), readSchema(REQUIREMENT_FRAGMENT_URL));
}

export default loadStableContractSchemaV1();
