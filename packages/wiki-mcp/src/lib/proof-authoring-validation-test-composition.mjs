

import { readFile } from "node:fs/promises";

export const PROOF_AUTHORING_VALIDATION_TEST_COMPOSITION_SCHEMA_VERSION =
  "proof-authoring-validation-test-composition.v1";
export const PROOF_AUTHORING_CATALOG_TEST_FAILURE_CODE =
  "proof_authoring_catalog_test_failure";
export const PROOF_AUTHORING_WORKBENCH_TEST_FAILURE_CODE =
  "proof_authoring_workbench_test_failure";
export const PROOF_AUTHORING_CATALOG_UNMARKED_FAILURE_CODE =
  "ERR_MODULE_NOT_FOUND";
export const PROOF_AUTHORING_WORKBENCH_UNMARKED_FAILURE_CODE = "ENOENT";
export const PROOF_AUTHORING_CURRENTNESS_REFUSAL_CODE =
  "controlled_acceptance_source_not_current";

const COMPOSITIONS = new WeakMap();

function failure(code, owner) {
  const error = new Error(`${owner} deliberately failed in the closed test composition`);
  error.code = code;
  error.details = Object.freeze({
    ownership: "system",
    responsible_owner: owner,
    composition: PROOF_AUTHORING_VALIDATION_TEST_COMPOSITION_SCHEMA_VERSION
  });
  throw error;
}

async function productionShapedFailure(boundary) {
  if (boundary === "catalog-unmarked-module") {
    await import(new URL("./fixtures/proof-catalog-owner-missing.mjs", import.meta.url));
  } else {
    await readFile(new URL("./fixtures/design-workbench-owner-missing.json", import.meta.url));
  }
  throw new Error("the deliberately absent owner fixture unexpectedly resolved");
}

function currentnessRefusal() {
  const error = new Error("canonical source changed during independent classification");
  error.code = PROOF_AUTHORING_CURRENTNESS_REFUSAL_CODE;
  error.details = Object.freeze({
    changed: false,
    expected_content_digest: "sha256:" + "1".repeat(64),
    actual_content_digest: "sha256:" + "2".repeat(64)
  });
  throw error;
}

export function buildProofAuthoringValidationFailureTestComposition(boundary) {
  if (!["catalog", "workbench", "catalog-unmarked-module",
    "workbench-unmarked-read", "workbench-source-currentness"].includes(boundary)) {
    throw new TypeError("proof-authoring validation failure boundary is unsupported");
  }
  const composition = Object.freeze({
    schema_version: PROOF_AUTHORING_VALIDATION_TEST_COMPOSITION_SCHEMA_VERSION,
    failure_boundary: boundary
  });
  COMPOSITIONS.set(composition, boundary);
  return composition;
}

export function proofAuthoringValidationTestCompositionDeps(composition) {
  if (composition === null) return Object.freeze({});
  const boundary = COMPOSITIONS.get(composition);
  if (boundary === undefined || !Object.isFrozen(composition)) {
    throw new TypeError("proof-authoring validation test composition is unbranded or malformed");
  }
  return Object.freeze(boundary === "catalog" ? {
    resolveProofAuthoring: async () => failure(
      PROOF_AUTHORING_CATALOG_TEST_FAILURE_CODE, "proof-authoring-executable-map")
  } : boundary === "workbench" ? {
    inspectControlledContractDesignWorkbench: async () => failure(
      PROOF_AUTHORING_WORKBENCH_TEST_FAILURE_CODE, "controlled-contract-design-workbench")
  } : boundary === "catalog-unmarked-module" ? {
    resolveProofAuthoring: async () => productionShapedFailure(boundary)
  } : boundary === "workbench-source-currentness" ? {
    inspectControlledContractDesignWorkbench: async () => currentnessRefusal()
  } : {
    inspectControlledContractDesignWorkbench: async () => productionShapedFailure(boundary)
  });
}
