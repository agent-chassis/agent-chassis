

import { SHARED_FALSIFIER_TARGET_CONSTRAINTS, SHARED_WITNESS_VALIDATORS, deepFreeze, identifierPathGrammar,
  standardNativeDescriptors } from "./shared.mjs";

const GO_TEST_FUNCTION_RE = /^Test(?:[A-Z0-9_][A-Za-z0-9_]*)?$/u;

const SELECTOR_KIND = "go_test_name";

export default deepFreeze({
  family_id: "go-test",
  runtime: { name: "go-test", runner_id: "runner.go-test", runner: "go test",
    languages: ["go"], toolchains: ["go"], dependency_ecosystem: "go_modules" },
  selector: { kind: SELECTOR_KIND, qualified: true,
    grammar: identifierPathGrammar(["_test.go"], {
      separator: "::", last: GO_TEST_FUNCTION_RE, statement: "<top-level TestXxx function>" }) },
  source_suffixes: [".go"],
  providers: standardNativeDescriptors({ name: "go-test", selectorKind: SELECTOR_KIND,
    candidateMechanism: "go_test_function_probe", seam: "go_selected_test_function" }),
  witness_validators: SHARED_WITNESS_VALIDATORS,
  falsifier_target_constraints: SHARED_FALSIFIER_TARGET_CONSTRAINTS
});
