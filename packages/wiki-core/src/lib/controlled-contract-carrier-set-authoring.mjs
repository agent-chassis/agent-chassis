import {
  CONTROLLED_CONTRACT_AUTHORING_REASONS,
  deriveControlledContractAuthoringState,
  projectControlledContractAuthoringRefusal
} from "./controlled-contract-authoring-state.mjs";
import { projectControlledContractAuthoringState } from
  "./controlled-contract-authoring-projections.mjs";
import { deriveWorkRecordTestProofBindingFacts } from
  "./work-record-test-proof-bindings.mjs";
import {
  loadControlledContractPackage,
  isPlainObject,
  controlledContractCarrierFilename,
  controlledContractContentDigest
} from "./controlled-contract-tool-shared.mjs";
import {
  authenticatedSelectedPackEvaluationBasename,
  carrierFromCanonicalSet
} from "./controlled-contract-carrier-set-evaluation.mjs";
import {
  getControlledContractAuthoringContinuation
} from "./controlled-contract-authoring-continuations.mjs";

export async function deriveControlledContractProofPlanBindingImpl({
  repoRoot, wkId, focus = null, plan, canonicalSet = null
}, dependencies) {
  if (!plan) return Object.freeze({ status: "absent", content_digest: null });
  const binding = (status) => Object.freeze({ status, content_digest: plan.content_digest });
  try {
    const loaded = await dependencies.readCanonicalProofPlanInputs({
      repoRoot, wkId, focus, canonicalSet
    });
    const missing = loaded.request.content.selected_packs.some(
      ({ evaluation_input_path: filename }) =>
        typeof filename === "string" && !Object.hasOwn(loaded.evaluationInputs, filename)
    );
    if (missing) return binding("incomplete");
    const { buildProofPlan } = await loadControlledContractPackage();
    const current = await buildProofPlan({
      contract: loaded.contract.content,
      request: loaded.request.content,
      evaluationInputs: loaded.evaluationInputs
    });
    return binding(controlledContractContentDigest(current) === plan.content_digest
      ? "current" : "stale");
  } catch {
    return binding("incomplete");
  }
}

export function deriveControlledContractSelectedPackEvaluationInputs({
  canonicalSet, request
}) {
  const packs = Array.isArray(request?.content?.selected_packs)
    ? request.content.selected_packs.filter(isPlainObject) : [];
  const missing = packs
    .filter(({ evaluation_input_path: filename }) => typeof filename === "string" &&
      !Object.hasOwn(canonicalSet.members_by_basename, filename))
    .map(({ profile_id: profileId, profile_version: profileVersion,
      evaluation_input_path: filename }) => Object.freeze({
      profile_id: profileId,
      profile_version: profileVersion,
      evaluation_input_path: filename
    }));
  return Object.freeze({
    selected_pack_count: packs.length,
    missing_evaluation_inputs: Object.freeze(missing),
    status: packs.length === 0
      ? "absent" : missing.length > 0 ? "incomplete" : "complete"
  });
}

function derivePublishedGenerationExact({ canonicalSet, continuationRecord }) {
  if (continuationRecord?.proof_graph?.status !== "published") return null;
  const expected = continuationRecord.proof_graph.result_member_digests;
  if (!isPlainObject(expected)) return false;
  return canonicalSet.source === "manifest" &&
    canonicalSet.manifest_content_digest ===
      continuationRecord.proof_graph.result_manifest_content_digest &&
    Object.keys(expected).length === canonicalSet.members.length &&
    Object.entries(expected).every(([basename, digest]) =>
      canonicalSet.members_by_basename[basename]?.content_digest === digest);
}

export async function deriveCanonicalControlledContractAuthoringStateImpl({
  repoRoot, wkId, focus = null, continuation = null, request = null
}, dependencies) {
  const canonicalSet = await dependencies.resolveCanonicalControlledContractCarrierSet({
    repoRoot, wkId, focus
  });
  const carriers = await dependencies.readControlledContractAuthoringCarriers({
    repoRoot, wkId, focus, canonicalSet
  });
  const continuationRecord = continuation === null
    ? null : await getControlledContractAuthoringContinuation({
      repoRoot, identity: continuation
    });
  const packageGeneration = continuationRecord === null
    ? null : (await loadControlledContractPackage()).PACKAGE_VERSION ?? null;
  const publishedGenerationExact = derivePublishedGenerationExact({
    canonicalSet, continuationRecord
  });
  const proofPlanBinding = await deriveControlledContractProofPlanBindingImpl({
    repoRoot, wkId, focus, plan: carriers.proof_plan, canonicalSet
  }, dependencies);
  const selectedPackEvaluationInputs =
    deriveControlledContractSelectedPackEvaluationInputs({
      canonicalSet, request: carriers.proof_plan_request
    });
  const verificationRequirements = await deriveAuthoringVerificationRequirements({
    repoRoot, wkId, contract: carriers.contract
  });
  const state = deriveControlledContractAuthoringState({
    wkId, focus, carriers, continuation, continuationRecord, proofPlanBinding,
    selectedPackEvaluationInputs, verificationRequirements, packageGeneration,
    publishedGenerationExact
  });
  return projectControlledContractAuthoringState(state, { request });
}

const TEST_PROOF_REQUIRED_FIELDS = Object.freeze([
  "test_proof_id", "verification_claim_id", "system_under_test_boundary",
  "observable_result", "candidate_execution_provider", "falsifiers",
  "traversal_provider", "coverage_disposition", "prohibited_shortcuts"
]);

async function deriveAuthoringVerificationRequirements({ repoRoot, wkId, contract }) {
  if (!contract?.content) return null;
  let loaded;
  try {
    const { loadWorkRecordById } = await import("./work-record-store.mjs");
    loaded = await loadWorkRecordById({ dir: repoRoot, id: wkId });
  } catch {
    return null;
  }
  if (!loaded?.valid) return null;
  const units = [loaded.record, ...(loaded.record.slices ?? [])];
  const bindingFacts = units.map((selectedUnit) =>
    deriveWorkRecordTestProofBindingFacts({selectedUnit}));
  if (bindingFacts.some(({diagnostics}) => diagnostics.length > 0)) return null;
  const verificationIds = [...new Set(bindingFacts.flatMap(({validation_bindings: bindings}) =>
    bindings.map(({verification_id: identity}) => identity)
  ))].sort();
  if (verificationIds.length === 0) return null;
  const packageApi = await loadControlledContractPackage();
  const claims = new Map(contract.content.claims.map((claim) => [claim.claim_id, claim]));
  const proofs = new Map((contract.content.test_proofs ?? []).map((proof) =>
    [proof.verification_claim_id, proof]));
  return Object.freeze(verificationIds.map((verificationId) => {
    const claim = claims.get(verificationId);
    const observedMethod = claim?.kind === "verification"
      ? claim.verification_method ?? null : null;
    if (!claim || observedMethod !== "test_execution") return Object.freeze({
      verification_id: verificationId,
      observed_method: observedMethod,
      required_method: "test_execution",
      state: "verification_graph_required"
    });
    const proof = proofs.get(verificationId);
    const missingFields = proof
      ? TEST_PROOF_REQUIRED_FIELDS.filter((field) => !Object.hasOwn(proof, field))
        .map((field) => `/test_proof/${field}`)
      : TEST_PROOF_REQUIRED_FIELDS.map((field) => `/test_proof/${field}`);
    if (proof && missingFields.length === 0) {
      try {
        packageApi.resolveStableTestProofProviderBindings(proof);
        const selected = packageApi.queryStableTestProofBindings({
          contract: contract.content, verificationIds: [verificationId]
        });
        if (selected.matched_count === 1) return Object.freeze({
          verification_id: verificationId,
          observed_method: observedMethod,
          required_method: "test_execution",
          state: "complete",
          missing_fields: Object.freeze([])
        });
      } catch (error) {
        for (const diagnostic of error?.details?.diagnostics?.diagnostics ?? []) {
          if (typeof diagnostic.pointer === "string") {
            missingFields.push(`/test_proof${diagnostic.pointer === "/" ? "" : diagnostic.pointer}`);
          }
        }
      }
    }
    return Object.freeze({
      verification_id: verificationId,
      observed_method: observedMethod,
      required_method: "test_execution",
      state: "stable_test_proof_required",
      missing_fields: Object.freeze([...new Set(missingFields)].sort())
    });
  }));
}

export async function resolveControlledContractAuthoringContinuationMutationImpl({
  repoRoot, wkId, focus = null, continuation, canonicalSet = null
}, dependencies) {
  canonicalSet ??= await dependencies.resolveCanonicalControlledContractCarrierSet({
    repoRoot, wkId, focus
  });
  let carriers = await dependencies.readControlledContractAuthoringCarriers({
    repoRoot, wkId, focus, canonicalSet
  });
  let continuationRecord = await getControlledContractAuthoringContinuation({
    repoRoot, identity: continuation
  });
  const packageGeneration = continuationRecord === null
    ? null : (await loadControlledContractPackage()).PACKAGE_VERSION ?? null;
  const publishedGenerationExact = derivePublishedGenerationExact({
    canonicalSet, continuationRecord
  });
  const continuationState = deriveControlledContractAuthoringState({
    wkId, focus, carriers, continuation, continuationRecord, packageGeneration,
    publishedGenerationExact
  });
  if (continuationState.status === "refused") return Object.freeze({
    refused: continuationState, carriers, canonicalSet
  });
  if (continuationRecord.proof_graph !== null) {
    if (continuationRecord.proof_graph.status === "published") {
      return Object.freeze({
        mode: "proof_graph_replay",
        continuationRecord,
        carriers,
        canonicalSet
      });
    }

    const selected = continuationRecord.skeleton.selected_pack;
    const selectedEvaluation = carrierFromCanonicalSet({
      canonicalSet, wkId, focus, carrierKind: "evaluation_input",
      basename: authenticatedSelectedPackEvaluationBasename({
        wkId, focus, selectedPack: selected,
        request: canonicalSet.members_by_basename[controlledContractCarrierFilename({
          wkId, focus, carrierKind: "proof_plan_request"
        })]?.content ?? null
      })
    });
    carriers = Object.freeze({ ...carriers, evaluation_input: selectedEvaluation });
    const byKind = new Map(continuationRecord.proof_graph.expected_sources.map(
      (entry) => [entry.carrier_kind, entry]));
    for (const kind of ["contract", "evaluation_input", "proof_plan_request"]) {
      const expectation = byKind.get(kind);
      const actual = carriers[kind] ?? null;
      const matches = expectation?.presence === "present"
        ? actual !== null && actual.content_digest === expectation.expected_content_digest
        : expectation?.presence === "absent" && actual === null;
      if (!matches) return Object.freeze({
        refused: projectControlledContractAuthoringRefusal({
          reasonCode: CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationCarrierConflict,
          wkId,
          focus,
          details: {
            carrier_kind: kind,
            expected_presence: expectation?.presence ?? null,
            expected_content_digest: expectation?.expected_content_digest ?? null,
            actual_content_digest: actual?.content_digest ?? null
          }
        }),
        carriers,
        canonicalSet
      });
    }
    return Object.freeze({
      mode: "proof_graph",
      proposal: continuationRecord.proof_graph.proposal,
      proposalDigest: continuationRecord.proof_graph.proposal_digest,
      continuationRecord,
      carriers,
      canonicalSet
    });
  }
  const skeleton = continuationRecord.skeleton;
  if (carriers.evaluation_input &&
      JSON.stringify(carriers.evaluation_input.content) !== JSON.stringify(skeleton.evaluation_input)) {
    return Object.freeze({
      refused: deriveControlledContractAuthoringState({
        wkId, focus, carriers, continuation, continuationRecord
      }),
      carriers,
      canonicalSet
    });
  }
  if (carriers.proof_plan_request &&
      JSON.stringify(carriers.proof_plan_request.content) !== JSON.stringify(skeleton.proof_plan_request)) {
    return Object.freeze({
      refused: deriveControlledContractAuthoringState({
        wkId, focus, carriers, continuation, continuationRecord
      }),
      carriers,
      canonicalSet
    });
  }
  if (!carriers.evaluation_input) return Object.freeze({
    carrierKind: "evaluation_input", content: skeleton.evaluation_input,
    expectedContentDigest: null, continuationRecord, carriers, canonicalSet
  });
  if (!carriers.proof_plan_request) return Object.freeze({
    carrierKind: "proof_plan_request", content: skeleton.proof_plan_request,
    expectedContentDigest: null, continuationRecord, carriers, canonicalSet
  });
  return Object.freeze({
    carrierKind: null, continuationRecord, carriers, canonicalSet
  });
}
