

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { compiledValidators } from "./compiled-validator-cache.mjs";

export const POPULATION_MODULES = Object.freeze([
  "./admitted-proof-packs.mjs",
  "./anonymous-structural-partitioner.mjs",
  "./artifact-set-provenance.mjs",
  "./contract-assessment.mjs",
  "./exact-binding-common.mjs",
  "./integration-prefix-capture-compatibility.mjs",
  "./multi-pack-assessment.mjs",
  "./native-contract-carrier.mjs",
  "./native-contract-carrier-v034.mjs",
  "./native-contract-carrier-v1.mjs",
  "./obligation-coverage-carrier.mjs",
  "./projected-selection-supplement.mjs",
  "./proof-intent-discovery.mjs",
  "./proof-intent-selection.mjs",
  "./proof-pack-binding-assistance.mjs",
  "./proof-plan-compiler.mjs",
  "./test-proof-assessment.mjs",
  "./test-proof-contract.mjs",
  "./test-proof-runtime-evidence-v2.mjs",
  "./verification-profile.mjs",
  "./verification-profile-schema-v1.mjs",
  "./verification-profile-v034.mjs"
]);

export const WIKI_CORE_EVALUATION_INPUT_GROUPS = Object.freeze([
  "wiki-core.controlled-contract-operations.evaluation-input.v1"
]);

export function presentPopulationModules() {
  return POPULATION_MODULES.filter((specifier) =>
    existsSync(fileURLToPath(new URL(specifier, import.meta.url))));
}

for (const specifier of presentPopulationModules()) await import(specifier);

const evaluationInputSchema = JSON.parse(await readFile(new URL(
  "../schema/controlled-contract-verification-profile-input.v1.schema.json",
  import.meta.url
), "utf8"));

for (const groupId of WIKI_CORE_EVALUATION_INPUT_GROUPS) {
  await compiledValidators(groupId, {
    validators: { validateEvaluationInput: evaluationInputSchema }
  });
}
