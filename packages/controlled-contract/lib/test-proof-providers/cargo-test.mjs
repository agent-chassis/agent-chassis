

import { SHARED_FALSIFIER_TARGET_CONSTRAINTS, SHARED_WITNESS_VALIDATORS, deepFreeze, identifierPathGrammar,
  standardNativeDescriptors } from "./shared.mjs";

const SELECTOR_KIND = "cargo_test_path";

export default deepFreeze({
  family_id: "cargo-test",
  runtime: { name: "cargo-test", runner_id: "runner.cargo-test", runner: "cargo test",
    languages: ["rust"], toolchains: ["rust"], dependency_ecosystem: "cargo" },
  selector: { kind: SELECTOR_KIND, qualified: true,
    grammar: identifierPathGrammar([".rs"], {
      separator: "::", statement: "<test function path within the source file>" }) },
  source_suffixes: [".rs"],
  providers: standardNativeDescriptors({ name: "cargo-test", selectorKind: SELECTOR_KIND,
    candidateMechanism: "cargo_test_function_guard", seam: "cargo_selected_test_function" }),
  witness_validators: SHARED_WITNESS_VALIDATORS,
  falsifier_target_constraints: SHARED_FALSIFIER_TARGET_CONSTRAINTS
});
