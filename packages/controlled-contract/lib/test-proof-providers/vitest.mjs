

import { JAVASCRIPT_SOURCE_SUFFIXES, SHARED_FALSIFIER_TARGET_CONSTRAINTS, SHARED_WITNESS_VALIDATORS, deepFreeze,
  standardNativeDescriptors, titlePathGrammar } from "./shared.mjs";

const SELECTOR_KIND = "vitest_title_path";

export default deepFreeze({
  family_id: "vitest",
  runtime: { name: "vitest", runner_id: "runner.vitest", runner: "vitest",
    languages: ["javascript", "typescript"], toolchains: ["node"], dependency_ecosystem: "npm" },
  selector: { kind: SELECTOR_KIND, qualified: true,
    grammar: titlePathGrammar(JAVASCRIPT_SOURCE_SUFFIXES) },
  source_suffixes: JAVASCRIPT_SOURCE_SUFFIXES,
  providers: standardNativeDescriptors({ name: "vitest", selectorKind: SELECTOR_KIND,
    candidateMechanism: "vitest_runner_tasks", seam: "vitest_selected_test_attempt" }),
  witness_validators: SHARED_WITNESS_VALIDATORS,
  falsifier_target_constraints: SHARED_FALSIFIER_TARGET_CONSTRAINTS
});
