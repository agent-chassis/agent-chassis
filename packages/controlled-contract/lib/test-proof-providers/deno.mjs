

import { SHARED_FALSIFIER_TARGET_CONSTRAINTS, SHARED_WITNESS_VALIDATORS, deepFreeze, standardNativeDescriptors,
  titlePathGrammar } from "./shared.mjs";

const DENO_SOURCE_SUFFIXES = Object.freeze([".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"]);

const SELECTOR_KIND = "deno_test_name";

export default deepFreeze({
  family_id: "deno",
  runtime: { name: "deno", runner_id: "runner.deno", runner: "deno test",
    languages: ["javascript", "typescript"], toolchains: ["deno"], dependency_ecosystem: "deno" },
  selector: { kind: SELECTOR_KIND, qualified: true,
    grammar: titlePathGrammar(DENO_SOURCE_SUFFIXES, {
      maxLength: 1, statement: "<canonical JSON array holding the one literal Deno.test name>" }) },
  source_suffixes: DENO_SOURCE_SUFFIXES,
  providers: standardNativeDescriptors({ name: "deno", selectorKind: SELECTOR_KIND,
    candidateMechanism: "deno_test_registrations", seam: "deno_selected_test_body" }),
  witness_validators: SHARED_WITNESS_VALIDATORS,
  falsifier_target_constraints: SHARED_FALSIFIER_TARGET_CONSTRAINTS
});
