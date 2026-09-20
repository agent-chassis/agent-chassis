

import { JAVASCRIPT_SOURCE_SUFFIXES, SHARED_FALSIFIER_TARGET_CONSTRAINTS, SHARED_WITNESS_VALIDATORS, deepFreeze,
  standardNativeDescriptors, titlePathGrammar } from "./shared.mjs";

const SELECTOR_KIND = "ava_test_title";

export default deepFreeze({
  family_id: "ava",
  runtime: { name: "ava", runner_id: "runner.ava", runner: "ava",
    languages: ["javascript", "typescript"], toolchains: ["node"], dependency_ecosystem: "npm" },
  selector: { kind: SELECTOR_KIND, qualified: true,
    grammar: titlePathGrammar(JAVASCRIPT_SOURCE_SUFFIXES, {
      maxLength: 1, statement: "<canonical JSON array holding the one literal test title>" }) },
  source_suffixes: JAVASCRIPT_SOURCE_SUFFIXES,
  providers: standardNativeDescriptors({ name: "ava", selectorKind: SELECTOR_KIND,
    candidateMechanism: "ava_worker_events", seam: "ava_selected_test_body" }),
  witness_validators: SHARED_WITNESS_VALIDATORS,
  falsifier_target_constraints: SHARED_FALSIFIER_TARGET_CONSTRAINTS
});
