import { readFileSync } from "node:fs";

import { testProofSchemaVocabularyMismatches } from "./test-proof-provider-registry.mjs";
import { VALUE_SCHEMA_DEFINITIONS, projectValueDefinitions } from "./controlled-values-v1.mjs";

const ROOT_URL = new URL("../schema/controlled-acceptance-contract.v1.schema.json", import.meta.url);
const FRAGMENT_URL = new URL("../schema/controlled-acceptance-test-proof-definitions.v1.schema.json", import.meta.url);
const REQUIREMENT_FRAGMENT_URL = new URL("../schema/controlled-acceptance-requirement-definitions.v1.schema.json", import.meta.url);
const PROPOSITION_FRAGMENT_URL = new URL("../schema/controlled-acceptance-proposition-definitions.v1.schema.json", import.meta.url);
const VALUE_FRAGMENT_URL = new URL("../schema/controlled-acceptance-value-definitions.v1.schema.json", import.meta.url);
const PROPOSITION_DEFINITIONS = Object.freeze(["proposition"]);
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
function requireFragmentOf(fragment, names, subject) {
  if (!isObject(fragment) || Object.keys(fragment).length !== 1 || !isObject(fragment.$defs)) {
    throw new Error(`stable-v1 schema composition has a malformed ${subject} fragment: expected only an object $defs`);
  }
  const missing = names.filter(key => !Object.hasOwn(fragment.$defs, key));
  const extra = Object.keys(fragment.$defs).filter(key => !names.includes(key));
  const malformed = names.filter(key => Object.hasOwn(fragment.$defs, key) && !isObject(fragment.$defs[key]));
  if (missing.length || extra.length || malformed.length) {
    throw new Error(`stable-v1 schema composition has invalid ${subject} definitions: ` +
      `missing [${missing.join(", ")}], extra [${extra.join(", ")}], malformed [${malformed.join(", ")}]`);
  }
}

const REQUIREMENT_FRAGMENT = readSchemaWith(readFileSync)(REQUIREMENT_FRAGMENT_URL);
const PROPOSITION_FRAGMENT = readSchemaWith(readFileSync)(PROPOSITION_FRAGMENT_URL);
const VALUE_FRAGMENT = readSchemaWith(readFileSync)(VALUE_FRAGMENT_URL);

export function composeStableContractSchemaV1(root, fragment, requirements = REQUIREMENT_FRAGMENT,
  propositions = PROPOSITION_FRAGMENT, values = VALUE_FRAGMENT) {
  if (!isObject(root) || !isObject(root.$defs)) {
    throw new Error("stable-v1 schema composition has a malformed root: expected an object $defs");
  }
  requireFragmentOf(fragment, PROOF_DEFINITIONS, "test-proof");
  requireFragmentOf(requirements, REQUIREMENT_DEFINITIONS, "authored-requirement");
  requireFragmentOf(propositions, PROPOSITION_DEFINITIONS, "proposition");
  requireFragmentOf(values, VALUE_SCHEMA_DEFINITIONS, "value");
  const stale = [...testProofSchemaVocabularyMismatches("root", root),
    ...testProofSchemaVocabularyMismatches("definitions", fragment)];
  if (stale.length > 0) {
    throw new Error("stable-v1 schema composition disagrees with the provider catalog at " +
      stale.join(", "));
  }
  const definitions = { ...root.$defs };
  for (const member of [fragment, requirements, propositions, values,
    { $defs: projectValueDefinitions(values.$defs, { reference: { $ref: '#/$defs/authored_entity' }, prefix: 'authored_' }) }]) {
    for (const [key, definition] of Object.entries(member.$defs)) {
      if (Object.hasOwn(definitions, key)) {
        throw new Error(`stable-v1 schema composition has a conflicting definition: ${key}`);
      }
      definitions[key] = definition;
    }
  }
  return structuredClone({ ...root, $defs: definitions });
}

export function loadStableContractSchemaV1(read = readFileSync) {
  const readSchema = readSchemaWith(read);
  return composeStableContractSchemaV1(readSchema(ROOT_URL), readSchema(FRAGMENT_URL),
    readSchema(REQUIREMENT_FRAGMENT_URL), readSchema(PROPOSITION_FRAGMENT_URL), readSchema(VALUE_FRAGMENT_URL));
}

export default loadStableContractSchemaV1();
