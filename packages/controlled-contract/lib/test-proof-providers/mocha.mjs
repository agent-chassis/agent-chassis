

import { JAVASCRIPT_SOURCE_SUFFIXES, SHARED_FALSIFIER_TARGET_CONSTRAINTS, SHARED_WITNESS_VALIDATORS, deepFreeze,
  standardNativeDescriptors, titlePathGrammar } from "./shared.mjs";

const SELECTOR_KIND = "mocha_title_path";

export default deepFreeze({
  family_id: "mocha",
  runtime: { name: "mocha", runner_id: "runner.mocha", runner: "mocha",
    languages: ["javascript", "typescript"], toolchains: ["node"], dependency_ecosystem: "npm" },
  selector: { kind: SELECTOR_KIND, qualified: true,
    grammar: titlePathGrammar(JAVASCRIPT_SOURCE_SUFFIXES) },
  source_suffixes: JAVASCRIPT_SOURCE_SUFFIXES,
  providers: standardNativeDescriptors({ name: "mocha", selectorKind: SELECTOR_KIND,
    candidateMechanism: "mocha_runner_events", seam: "mocha_selected_test_body" }),
  witness_validators: SHARED_WITNESS_VALIDATORS,
  falsifier_target_constraints: SHARED_FALSIFIER_TARGET_CONSTRAINTS
});
