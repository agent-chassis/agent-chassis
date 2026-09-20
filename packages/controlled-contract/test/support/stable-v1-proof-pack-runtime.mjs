import { CONTROLLED_VOCABULARY } from
  "../../vocabulary/controlled-contract-vocabulary.v1.mjs";
import { TEST_PROOF_PROVIDER_CATALOG } from "../../lib/test-proof-provider-registry.mjs";

function currentProviderVersion(providerId) {
  const descriptor = TEST_PROOF_PROVIDER_CATALOG.providers.find(
    ({ provider_id: id }) => id === providerId);
  if (!descriptor) throw new Error(`current provider registry has no ${providerId} descriptor`);
  return descriptor.provider_version;
}

export {
  EVALUATION_INPUT_VERSION_V1,
  PROFILE_SCHEMA_VERSION_V1,
  RESULT_VERSION_V1,
  validateEvaluationInputSchemaV1,
  validateProfileSchemaV1,
  validateResultSchemaV1
} from "../../lib/verification-profile-schema-v1.mjs";
export {
  evaluateVerificationProfileV1,
  profileDigest,
  validateProfileSemanticsV1
} from "../../lib/verification-profile-v1.mjs";

import {
  StableVerificationError,
  evaluateVerificationProfileV1
} from "../../lib/verification-profile-v1.mjs";

function proofForTestClaim(contract, claim) {
  const suffix = claim.claim_id.replace(/^claim-/u, "");
  const proposition = contract.propositions.find(
    ({ proposition_id: propositionId }) => propositionId === claim.proposition_id
  );
  if (!proposition) throw new Error(
    `stable proof-pack fixture claim ${claim.claim_id} has no proposition`
  );
  return {
    test_proof_id: `test-proof-${suffix}`,
    verification_claim_id: claim.claim_id,
    system_under_test_boundary: {
      boundary_id: `sut-boundary-${suffix}`,
      kind: "module",
      runtime_module_path:
        "packages/controlled-contract/lib/verification-profile-v1.mjs",
      subject_reference_ids: [proposition.subject_reference_id]
    },
    observable_result: {
      observable_id: `observable-${suffix}`,
      kind: "return_value",
      proposition_id: claim.proposition_id
    },
    candidate_execution_provider: {
      provider_id: "launcher.node-test",
      provider_version: currentProviderVersion("launcher.node-test"),
      capability: "candidate_execution"
    },
    falsifiers: [{
      falsifier_id: `falsifier-${suffix}`,
      strategy: "dependency_failure",
      proposition_id: claim.falsifying_proposition_id,
      expected_outcome: "verification_fails",
      mutation: {
        mutation_id: `mutation-${suffix}`,
        mechanism: "module_substitution",
        target_kind: "module",
        module_path: "packages/controlled-contract/lib/verification-profile-v1.mjs"
      },
      execution_provider: {
        provider_id: "launcher.node-test-module-fault",
        provider_version: currentProviderVersion("launcher.node-test-module-fault"),
        capability: "falsifier_execution"
      }
    }],
    traversal_provider: {
      mode: "provider",
      provider_id: "launcher.node-test-v8-coverage",
      provider_version: currentProviderVersion("launcher.node-test-v8-coverage"),
      capability: "boundary_traversal",
      boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace"
    },
    test_selector: { name: `stable proof-pack fixture ${suffix}`, nesting: 0 },
    prohibited_shortcuts: ["coverage_percentage_only", "source_text_inspection"]
  };
}

function buildStableTestProofPopulation(contract) {
  return contract.claims.filter(
    ({ kind, verification_method: method }) =>
      kind === "verification" && method === "test_execution"
  ).map((claim) => proofForTestClaim(contract, claim)).sort(
    (left, right) => left.verification_claim_id < right.verification_claim_id ? -1 : 1
  );
}

function evaluateStableProofPackFixtureV1(payload, options) {
  const subject = structuredClone(payload);
  if (Array.isArray(subject.contract?.claims) &&
      Array.isArray(subject.contract?.test_proofs)) {
    subject.contract.test_proofs = buildStableTestProofPopulation(subject.contract);
  }
  try {
    return evaluateVerificationProfileV1(subject, options);
  } catch (error) {
    if (!(error instanceof StableVerificationError)) throw error;
    return Object.freeze({
      satisfaction: "invalid",
      satisfaction_trace: null,
      diagnostics: error.details?.diagnostics?.diagnostics ?? [],
      total_count: error.details?.diagnostics?.total_count ?? 1,
      returned_count: error.details?.diagnostics?.returned_count ?? 1,
      omitted_count: error.details?.diagnostics?.omitted_count ?? 0,
      truncated: error.details?.diagnostics?.truncated ?? false
    });
  }
}

function controlledComplementV1(operator) {
  const descriptor = CONTROLLED_VOCABULARY.operators.find(
    ({ term }) => term === operator
  );
  return descriptor?.controlled_complement?.kind === "operator"
    ? descriptor.controlled_complement.term
    : null;
}

export {
  buildStableTestProofPopulation,
  controlledComplementV1,
  evaluateStableProofPackFixtureV1
};
