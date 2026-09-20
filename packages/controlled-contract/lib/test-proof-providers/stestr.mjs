

import { SHARED_FALSIFIER_TARGET_CONSTRAINTS, SHARED_WITNESS_VALIDATORS, deepFreeze, identifierPathGrammar,
  standardNativeDescriptors } from "./shared.mjs";

const SELECTOR_KIND = "stestr_test_id";

export default deepFreeze({
  family_id: "stestr",
  runtime: { name: "stestr", runner_id: "runner.stestr", runner: "stestr",
    languages: ["python"], toolchains: ["python"], dependency_ecosystem: "python" },
  selector: { kind: SELECTOR_KIND, qualified: true,
    grammar: identifierPathGrammar([".py"], {
      separator: ".", minLength: 2, statement: "<TestCase class>.<test method>" }) },
  source_suffixes: [".py"],
  providers: standardNativeDescriptors({ name: "stestr", selectorKind: SELECTOR_KIND,
    candidateMechanism: "stestr_unittest_results", seam: "stestr_selected_test_method" }),
  witness_validators: SHARED_WITNESS_VALIDATORS,
  falsifier_target_constraints: SHARED_FALSIFIER_TARGET_CONSTRAINTS
});
