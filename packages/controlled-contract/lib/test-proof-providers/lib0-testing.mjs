

import { SHARED_FALSIFIER_TARGET_CONSTRAINTS, SHARED_WITNESS_VALIDATORS, deepFreeze, standardNativeDescriptors,
  titlePathGrammar } from "./shared.mjs";

const LIB0_SOURCE_SUFFIXES = Object.freeze([".js", ".mjs", ".cjs"]);
const LIB0_TEST_FUNCTION_RE = /^(?:test|benchmark)[A-Za-z0-9_$]*$/u;

const SELECTOR_KIND = "lib0_test_function";

export default deepFreeze({
  family_id: "lib0-testing",
  runtime: { name: "lib0-testing", runner_id: "runner.lib0-testing", runner: "lib0/testing",
    languages: ["javascript"], toolchains: ["node"], dependency_ecosystem: "npm" },
  selector: { kind: SELECTOR_KIND, qualified: true,
    grammar: titlePathGrammar(LIB0_SOURCE_SUFFIXES, {
      minLength: 2, maxLength: 2,
      element: (title, index) => index === 0 || LIB0_TEST_FUNCTION_RE.test(title),
      statement: "<canonical JSON array [runTests module key, test function name]>" }) },
  source_suffixes: LIB0_SOURCE_SUFFIXES,
  providers: standardNativeDescriptors({ name: "lib0-testing", selectorKind: SELECTOR_KIND,
    candidateMechanism: "lib0_test_registrations", seam: "lib0_selected_test_body" }),
  witness_validators: SHARED_WITNESS_VALIDATORS,
  falsifier_target_constraints: SHARED_FALSIFIER_TARGET_CONSTRAINTS
});
