import { CONTROLLED_VOCABULARY } from
  "../../vocabulary/controlled-contract-vocabulary.v1.mjs";

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
  evaluateVerificationProfileV1,
  profileDigest
} from "../../lib/verification-profile-v1.mjs";
import {
  projectedEvaluationEnvelopeFor
} from "../../lib/exact-binding-runtime-registry.mjs";
import {
  createGraphSelectionTrace,
  evaluateProjectedEvaluationBinding,
  hasTrustedProjectedSelection
} from "../../lib/projected-evaluation-binding.mjs";

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
      provider_version: "1.0.0",
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
        provider_version: "1.0.0",
        capability: "falsifier_execution"
      }
    }],
    traversal_provider: {
      mode: "provider",
      provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0",
      capability: "boundary_traversal",
      boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace"
    },
    coverage_disposition: {
      baseline_id: `coverage-baseline-${suffix}`,
      baseline_state: "complete_executed_inventory",
      items: [{ test_id: `test-${suffix}`, disposition: "preserved" }]
    },
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

function stableProjectedProofSubjectProvenV1(subject) {
  if (subject.exactBindingResult?.satisfaction !== "satisfied" ||
      subject.declaration?.profile_id !== subject.profile?.profile_id ||
      subject.declaration?.profile_version !== subject.profile?.profile_version ||
      subject.declaration?.profile_digest !== profileDigest(subject.profile)) return false;
  const selection = createGraphSelectionTrace();
  const evaluation = evaluateStableProofPackFixtureV1({
    contract: subject.contract,
    profile: subject.profile,
    evaluation_input: subject.evaluationInput
  }, { graphSelectionSink: selection.sink });
  if (evaluation.satisfaction !== "satisfied") return false;
  const binding = evaluateProjectedEvaluationBinding({
    declaredOptIn: subject.declaration.projected_evaluation_binding,
    envelope: projectedEvaluationEnvelopeFor(subject.exactBindingResult),
    exactBindingResult: subject.exactBindingResult,
    expectedContext: subject.context,
    contract: subject.contract,
    profile: subject.profile,
    evaluation,
    trace: selection.snapshot()
  });
  return hasTrustedProjectedSelection(binding);
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
  evaluateStableProofPackFixtureV1,
  stableProjectedProofSubjectProvenV1
};
