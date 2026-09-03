import {
  VERIFICATION_BUNDLE_VOCABULARY,
  buildStableTestProofBindingTemplate,
  buildVerificationBundleTemplate,
  classifyStableTestProofRuntimeReadiness
} from "@agent-chassis/controlled-contract";

const DIGEST_PATTERN = /^(?:sha256:)?[0-9a-f]{64}$/;

export const CONTROLLED_CONTRACT_AUTHORING_TOOLS = Object.freeze({
  state: "workspace_controlled_contract_authoring_state",
  skeleton: "workspace_controlled_proof_authoring_skeleton",
  continuation: "workspace_controlled_contract_authoring_continue",
  intentDiscovery: "workspace_controlled_proof_intents_discover",
  packSelection: "workspace_controlled_proof_packs_select",
  planBuild: "workspace_controlled_proof_plan_build",
  assessment: "workspace_controlled_contract_assess",
  authoringDescription: "workspace_controlled_contract_authoring_describe",
  testProofDescription: "workspace_controlled_test_proof_authoring_describe",
  testProofQuery: "workspace_controlled_test_proof_query",
  testProofPatch: "workspace_controlled_test_proof_patch",
  verificationBundlePatch: "workspace_controlled_verification_bundle_patch",
  carrierQuery: "workspace_controlled_contract_carrier_query",
  packBindingsInspect: "workspace_controlled_proof_pack_bindings_inspect",
  proofGraphContinue: "workspace_controlled_contract_proof_graph_continue"
});

export const CONTROLLED_CONTRACT_PROOF_AUTHORING_CONTINUATION = Object.freeze({
  step: "intent_discovery",
  tool: "workspace_controlled_proof_intents_discover",
  purpose: "discover the exact proof intents this contract could bind"
});

export const CONTROLLED_CONTRACT_AUTHORING_REASONS = Object.freeze({
  continuationInvalid: "controlled_contract_authoring_continuation_invalid",
  continuationUnknown: "controlled_contract_authoring_continuation_unknown",
  continuationTampered: "controlled_contract_authoring_continuation_tampered",
  continuationStale: "controlled_contract_authoring_continuation_stale",
  continuationCrossWk: "controlled_contract_authoring_continuation_cross_wk",
  continuationCrossFocus: "controlled_contract_authoring_continuation_cross_focus",
  continuationCarrierConflict: "controlled_contract_authoring_continuation_carrier_conflict",
  proofGraphProposalIncomplete:
    "controlled_contract_proof_graph_proposal_incomplete",
  proofGraphCrossCarrierIdentityConflict:
    "controlled_contract_proof_graph_cross_carrier_identity_conflict",
  proofGraphBoundExceeded: "controlled_contract_proof_graph_bound_exceeded"
});

export const CONTROLLED_CONTRACT_PROOF_PLAN_BINDING_STATUSES = Object.freeze([
  "absent",
  "current",
  "stale",
  "incomplete"
]);

export const CONTROLLED_CONTRACT_AUTHORING_STAGES = Object.freeze([
  "contract_required",
  "verification_graph_required",
  "stable_test_proof_required",
  "proof_graph_required",
  "proof_authoring_required",
  "evaluation_input_ready",
  "proof_plan_request_ready",
  "evaluation_input_population_incomplete",
  "proof_plan_ready",
  "proof_plan_rebuild_required",
  "complete"
]);

export const CONTROLLED_CONTRACT_AUTHORING_TERMINAL_STAGE = "complete";

const ACTION_BYTE_LIMIT = 12288;
const MAX_DISCLOSED_IDENTITIES = 16;

const MAX_DISCLOSED_MISSING_INPUTS = 4;

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value, null, 2), "utf8");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function call(tool, arguments_) {
  return Object.freeze({ tool, arguments: Object.freeze(arguments_) });
}

function identityArguments(wkId, focus) {
  return focus === null ? { wk_id: wkId } : { wk_id: wkId, focus };
}

function carrierIdentity(carrier) {
  if (!carrier) return null;
  return Object.freeze({
    carrier_kind: carrier.carrier_kind,
    content_digest: carrier.content_digest
  });
}

function selectedResources({ carriers, continuationRecord }) {
  const selected = {};
  for (const kind of ["contract", "evaluation_input", "proof_plan_request", "proof_plan"]) {
    const value = carrierIdentity(carriers[kind]);
    if (value) selected[kind] = value;
  }
  const pack = continuationRecord?.skeleton?.selected_pack;
  if (pack) selected.proof_pack = Object.freeze({
    profile_id: pack.profile_id,
    profile_version: pack.profile_version
  });
  return Object.freeze(selected);
}

function unresolved(...identities) {
  const values = [...new Set(identities.flat().filter(Boolean))].sort();
  return Object.freeze({ identities: Object.freeze(values), count: values.length });
}

function boundedAction(action) {
  const projected = structuredClone(action);
  const holes = projected.author_semantics ?? [];
  for (const hole of holes) {
    if (!Array.isArray(hole.compatible_values)) continue;
    hole.compatible_value_total = hole.compatible_values.length;
    hole.compatible_values_omitted = 0;
  }
  while (bytes(projected) > ACTION_BYTE_LIMIT) {
    const widest = holes
      .filter((hole) => Array.isArray(hole.compatible_values) &&
        hole.compatible_values.length > 0)
      .sort((left, right) =>
        right.compatible_values.length - left.compatible_values.length)[0];
    if (widest === undefined) break;
    widest.compatible_values_omitted = widest.compatible_value_total;
    widest.compatible_values = [];
  }
  return deepFreeze(projected);
}

function boundedRemediationAction(action) {
  const projected = boundedAction(action);
  return bytes(projected) <= ACTION_BYTE_LIMIT ? projected : null;
}

function boundedIdentities(values) {
  const sorted = [...new Set(values.filter((value) => typeof value === "string"))].sort();
  return {
    identities: sorted.slice(0, MAX_DISCLOSED_IDENTITIES),
    omitted: Math.max(sorted.length - MAX_DISCLOSED_IDENTITIES, 0),
    total: sorted.length
  };
}

const POPULATION_DISCLOSURE_BYTE_LIMIT = 2048;

function boundedPopulationDisclosure(decisions) {
  const projected = structuredClone(decisions);
  for (const field of ["bound_evaluation_input_paths", "missing_evaluation_inputs"]) {
    while (bytes(projected) > POPULATION_DISCLOSURE_BYTE_LIMIT &&
        projected[field].length > 0) {
      projected[field] = projected[field].slice(0, -1);
      projected[`${field}_omitted`] += 1;
    }
  }
  return deepFreeze(projected);
}

function carrierContent(carrier) {
  const content = carrier?.content;
  return content && typeof content === "object" && !Array.isArray(content)
    ? content : null;
}

function selectedPacks(carriers) {
  const packs = carrierContent(carriers.proof_plan_request)?.selected_packs;
  return Array.isArray(packs)
    ? packs.filter((pack) => pack && typeof pack === "object") : [];
}

function selectedPackRecoveryCall({ wkId, focus, recovery }) {
  if (!recovery || recovery.status !== "recoverable" ||
      !recovery.selected_pack || typeof recovery.selected_pack !== "object" ||
      Array.isArray(recovery.selected_pack) ||
      typeof recovery.selected_pack.profile_id !== "string" ||
      typeof recovery.selected_pack.profile_version !== "string" ||
      typeof recovery.selected_pack.evaluation_input_path !== "string" ||
      !Array.isArray(recovery.requested_intents)) return null;

  const semanticInput = Object.hasOwn(recovery, "evaluation_input")
    ? { evaluation_input: structuredClone(recovery.evaluation_input) }
    : Object.hasOwn(recovery, "bindings")
      ? { bindings: structuredClone(recovery.bindings) }
      : null;
  if (semanticInput === null) return null;

  const action = {
    tool: CONTROLLED_CONTRACT_AUTHORING_TOOLS.skeleton,
    arguments: {
      ...identityArguments(wkId, focus),
      selected_pack: {
        profile_id: recovery.selected_pack.profile_id,
        profile_version: recovery.selected_pack.profile_version
      },
      requested_intents: structuredClone(recovery.requested_intents),
      ...semanticInput
    }
  };
  if (Array.isArray(recovery.author_semantics) &&
      recovery.author_semantics.length > 0) {
    action.author_semantics = structuredClone(recovery.author_semantics);
  }
  return boundedAction(action);
}

function proofExecutionReadiness(contract, authoringIdentity) {
  const proofs = Array.isArray(contract?.test_proofs) ? contract.test_proofs : [];
  const projected = proofs.map((binding) => {
    const readiness = classifyStableTestProofRuntimeReadiness(binding);
    const candidates = readiness.current_test_ids.slice(0, MAX_DISCLOSED_IDENTITIES);
    const queryArguments = {
      wk_id: authoringIdentity.wk_id,
      ...(authoringIdentity.focus === null ? {} : { focus: authoringIdentity.focus }),
      verification_ids: [binding.verification_claim_id]
    };
    return Object.freeze({
      verification_id: binding.verification_claim_id,
      status: readiness.status,
      reason: readiness.reason,
      selected_test_id: readiness.selected_test_id,
      candidate_test_ids: Object.freeze(candidates),
      candidate_total: readiness.candidate_total,
      candidate_test_ids_omitted: readiness.candidate_total - candidates.length,
      complete_retrieval: call(
        CONTROLLED_CONTRACT_AUTHORING_TOOLS.testProofQuery,
        queryArguments
      )
    });
  }).sort((left, right) => left.verification_id.localeCompare(right.verification_id));
  const bounded = projected.slice(0, MAX_DISCLOSED_IDENTITIES);
  return Object.freeze({
    status: projected.every(({ status }) => status === "ready") ? "ready" : "not_ready",
    authority: "non_authorizing_evidence",
    admissibility_effect: "none",
    bindings: Object.freeze(bounded),
    binding_total: projected.length,
    bindings_omitted: projected.length - bounded.length
  });
}

function authoringEvidence(carriers) {
  const contract = carrierContent(carriers.contract);
  const request = carrierContent(carriers.proof_plan_request);
  if (contract === null && request === null) return null;
  const residue = Array.isArray(contract?.residue) ? contract.residue : [];
  const residueIdentities = boundedIdentities(residue.map(
    ({ residue_id: identity }) => identity));
  const intents = Array.isArray(request?.requested_intents)
    ? request.requested_intents : [];
  const readiness = contract === null ? null
    : proofExecutionReadiness(contract, carriers.authoring_identity);
  return Object.freeze({
    residue_count: residue.length,
    residue_identities: Object.freeze(residueIdentities.identities),
    residue_identities_omitted: residueIdentities.omitted,
    selected_pack_count: selectedPacks(carriers).length,
    requested_intent_count: intents.length,
    ...(readiness === null ? {} : { proof_execution_readiness: readiness }),
    non_authorizing_evidence: Object.freeze([
      ...(residue.length > 0 ? ["residue"] : []),
      ...(readiness === null ? [] : ["proof_execution_readiness"])
    ])
  });
}

function response({ stage, carriers, continuationRecord = null, unresolvedDecisions,
  nextCall = null, nextActions = null, stopCondition = null }) {
  const result = {
    schema_version: "controlled-contract-authoring-state.v1",
    stage,
    selected_resources: selectedResources({ carriers, continuationRecord }),
    unresolved_decisions: unresolvedDecisions
  };
  if (continuationRecord) result.continuation = continuationRecord.identity;
  const evidence = authoringEvidence(carriers);
  if (evidence) result.authoring_evidence = evidence;

  if (nextCall) result.next_calls = Object.freeze([nextCall]);
  if (nextActions) result.next_actions = Object.freeze(nextActions);
  if (!nextCall && !nextActions) result.stop_condition = stopCondition;
  return Object.freeze(result);
}

function verificationBundleAction({
  wkId,
  focus,
  contract,
  expectedContentDigest,
  verificationId,
  omitWhenOversize = false
}) {
  const template = buildVerificationBundleTemplate({
    contract,
    verificationId
  });
  const action = {
    ...call(CONTROLLED_CONTRACT_AUTHORING_TOOLS.verificationBundlePatch, {
      ...identityArguments(wkId, focus),
      expected_content_digest: expectedContentDigest,
      operations: [{
        op: "upsert",
        verification_id: verificationId,
        bundle: structuredClone(template.bundle)
      }]
    }),
    bundle_schema_version: VERIFICATION_BUNDLE_VOCABULARY.schema_version,
    author_semantics: template.author_semantics.map(({ pointer, ...rest }) =>
      ({ pointer: `/operations/0/bundle${pointer}`, ...rest }))
  };
  return omitWhenOversize ? boundedRemediationAction(action) : boundedAction(action);
}

function verificationGraphRequired({ wkId, focus, carriers, requirements }) {
  const identities = requirements.map(({ verification_id: identity }) => identity).sort();
  const [selected] = identities;
  const observed = new Map(requirements.map(({ verification_id: identity,
    observed_method: method }) => [identity, method ?? null]));
  const action = verificationBundleAction({
    wkId,
    focus,
    contract: carrierContent(carriers.contract),
    expectedContentDigest: carriers.contract.content_digest,
    verificationId: selected
  });
  const bounded = boundedIdentities(identities);
  return response({
    stage: "verification_graph_required",
    carriers,
    unresolvedDecisions: Object.freeze({
      identities: Object.freeze(bounded.identities),
      count: bounded.total,
      omitted_identity_count: bounded.omitted,
      addressed_verification_id: selected,
      observed_method: observed.get(selected) ?? null,
      required_method: "test_execution"
    }),
    nextCall: action
  });
}

export function deriveControlledContractCarrierValidationRemediation({
  wkId,
  focus = null,
  expectedContentDigest,
  candidate,
  diagnostics
}) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
      !Array.isArray(candidate.claims) || !Array.isArray(candidate.test_proofs) ||
      typeof expectedContentDigest !== "string" ||
      !DIGEST_PATTERN.test(expectedContentDigest)) return null;
  const entries = Array.isArray(diagnostics)
    ? diagnostics
    : diagnostics?.diagnostics;
  if (!Array.isArray(entries)) return null;
  const missing = entries.find((entry) =>
    entry?.code === "stable_test_proof_missing");
  const verificationId = missing?.expected_identity;
  if (typeof verificationId !== "string" || verificationId.length === 0) return null;
  const claim = candidate.claims.find((entry) =>
    entry?.claim_id === verificationId);
  if (claim?.kind !== "verification" || claim.verification_method !== "test_execution" ||
      candidate.test_proofs.some((entry) =>
        entry?.verification_claim_id === verificationId)) return null;
  return verificationBundleAction({
    wkId,
    focus,
    contract: candidate,
    expectedContentDigest,
    verificationId,
    omitWhenOversize: true
  });
}

function stableTestProofRequired({ wkId, focus, carriers, requirements }) {
  const identities = requirements.map(({ verification_id: identity }) => identity).sort();
  const [selected] = identities;
  const requirement = requirements.find(
    ({ verification_id: identity }) => identity === selected);
  const template = buildStableTestProofBindingTemplate({
    contract: carrierContent(carriers.contract),
    verificationId: selected
  });
  const action = boundedAction({
    ...call(CONTROLLED_CONTRACT_AUTHORING_TOOLS.testProofPatch, {
      ...identityArguments(wkId, focus),
      expected_content_digest: carriers.contract.content_digest,
      operations: [{
        op: "replace",
        verification_id: selected,
        binding: structuredClone(template.binding)
      }]
    }),
    author_semantics: template.author_semantics.map(({ pointer, ...rest }) =>
      ({ pointer: `/operations/0/binding${pointer}`, ...rest }))
  });
  const bounded = boundedIdentities(identities);
  const missing = boundedIdentities(requirement?.missing_fields ?? []);
  return response({
    stage: "stable_test_proof_required",
    carriers,
    unresolvedDecisions: Object.freeze({
      identities: Object.freeze(bounded.identities),
      count: bounded.total,
      omitted_identity_count: bounded.omitted,
      addressed_verification_id: selected,
      observed_method: requirement?.observed_method ?? null,
      required_method: "test_execution",
      missing_fields: Object.freeze(missing.identities),
      missing_field_count: missing.total
    }),
    nextCall: action
  });
}

function replacementStateCall(wkId, focus, continuation = null) {
  return call(CONTROLLED_CONTRACT_AUTHORING_TOOLS.state,
    {
      ...identityArguments(wkId, focus),
      ...(continuation === null ? {} : { continuation })
    });
}

function refusal(reasonCode, wkId, focus, details = {}, continuation = null) {
  return Object.freeze({
    schema_version: "controlled-contract-authoring-refusal.v1",
    status: "refused",
    reason_code: reasonCode,
    details: Object.freeze(details),
    replacement_call: replacementStateCall(wkId, focus, continuation)
  });
}

export function projectControlledContractAuthoringRefusal({
  reasonCode, wkId, focus = null, details = {}, continuation = null
}) {
  return refusal(reasonCode, wkId, focus, details, continuation);
}

export function validateControlledContractAuthoringContinuation({
  wkId,
  focus = null,
  contract,
  continuation,
  continuationRecord,
  packageGeneration = null,
  sourceExpectations = null,
  proposalDigest = null,
  semanticBindings = null
}) {
  if (typeof continuation !== "string" || !DIGEST_PATTERN.test(continuation)) {
    return refusal(CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationInvalid,
      wkId, focus);
  }
  if (!continuationRecord) {
    return refusal(CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationUnknown,
      wkId, focus);
  }
  if (continuationRecord.identity !== continuation) {
    return refusal(CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationTampered,
      wkId, focus);
  }
  if (continuationRecord.wk_id !== wkId) {
    return refusal(CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationCrossWk,
      wkId, focus, { continuation_wk_id: continuationRecord.wk_id });
  }
  if ((continuationRecord.focus ?? null) !== focus) {
    return refusal(CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationCrossFocus,
      wkId, focus, { continuation_focus: continuationRecord.focus ?? null });
  }
  const expectedContractDigest = continuationRecord.proof_graph?.status === "published"
    ? continuationRecord.proof_graph.result_contract_content_digest
    : continuationRecord.contract_content_digest;
  if (!contract || expectedContractDigest !== contract.content_digest ||
      continuationRecord.package_continuation.contract_digest !==
        continuationRecord.skeleton.contract_digest) {
    return refusal(CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationStale,
      wkId, focus, {
        current_content_digest: contract?.content_digest ?? null,
        continuation_content_digest: expectedContractDigest
      });
  }
  const packageIdentity = continuationRecord.package_continuation?.identity;
  if ((continuationRecord.package_generation != null && packageGeneration !== null &&
       continuationRecord.package_generation !== packageGeneration) ||
      packageIdentity && (
        packageIdentity.package_version !== continuationRecord.package_generation ||
        !contentEqual(packageIdentity.pack,
          continuationRecord.skeleton.selected_pack) ||
        !contentEqual(packageIdentity.intents,
          continuationRecord.skeleton.requested_intents) ||
        !contentEqual(packageIdentity.chosen_bindings,
          continuationRecord.semantic_bindings)
      )) {
    return refusal(CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationTampered,
      wkId, focus, { continuation_package_generation:
        continuationRecord.package_generation ?? null });
  }
  if (continuationRecord.proof_graph) {
    if (continuationRecord.proof_graph.package_generation !==
        continuationRecord.package_generation ||
        (proposalDigest !== null && continuationRecord.proof_graph.proposal_digest !==
          proposalDigest)) {
      return refusal(CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationStale,
        wkId, focus, { proposal_digest: proposalDigest });
    }
    if (sourceExpectations !== null && !contentEqual(
      continuationRecord.proof_graph.expected_sources, sourceExpectations
    )) return refusal(CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationCarrierConflict,
      wkId, focus, { carrier_kind: "canonical_source_set" });
    if (semanticBindings !== null && !contentEqual(
      continuationRecord.semantic_bindings, semanticBindings
    )) return refusal(CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationTampered,
      wkId, focus, { field: "semantic_bindings" });
  }
  return null;
}

function contentEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function proofAuthoringRequired({ carriers }) {
  return response({
    stage: "proof_authoring_required",
    carriers,
    unresolvedDecisions: unresolved(
      "requested_intents", "selected_proof_pack", "required_role_bindings"
    ),
    nextCall: call(CONTROLLED_CONTRACT_AUTHORING_TOOLS.intentDiscovery, {}),
    nextActions: [CONTROLLED_CONTRACT_PROOF_AUTHORING_CONTINUATION]
  });
}

export function deriveControlledContractAuthoringState({
  wkId,
  focus = null,
  carriers = {},
  continuation = null,
  continuationRecord = null,
  proofPlanBinding = null,
  selectedPackEvaluationInputs = null,
  proofPackAuthoring = null,
  verificationRequirements = null,
  packageGeneration = null,
  publishedGenerationExact = null,
  sourceExpectations = null,
  proposalDigest = null,
  semanticBindings = null
}) {
  const contract = carriers.contract ?? null;
  const evaluation = carriers.evaluation_input ?? null;
  const request = carriers.proof_plan_request ?? null;
  const plan = carriers.proof_plan ?? null;
  const normalized = { contract, evaluation_input: evaluation,
    proof_plan_request: request, proof_plan: plan,
    authoring_identity: Object.freeze({ wk_id: wkId, focus }) };
  const baseArguments = identityArguments(wkId, focus);

  if (continuation !== null) {
    const refused = validateControlledContractAuthoringContinuation({
      wkId, focus, contract, continuation, continuationRecord,
      packageGeneration, sourceExpectations, proposalDigest, semanticBindings
    });
    if (refused) return refused;
  }

  const publishedGeneration = continuationRecord?.proof_graph?.status === "published";
  if (publishedGeneration && publishedGenerationExact !== true) {
    return refusal(CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationCarrierConflict,
      wkId, focus, { carrier_kind: "canonical_generation" });
  }

  if (!contract) return response({
    stage: "contract_required",
    carriers: normalized,
    unresolvedDecisions: Object.freeze({
      identities: Object.freeze(["controlled_contract"]),
      count: 1,
      failed_prerequisite: "canonical_contract_absent"
    }),
    nextCall: call(CONTROLLED_CONTRACT_AUTHORING_TOOLS.authoringDescription,
      { carrier_kind: "contract" })
  });

  if (verificationRequirements) {
    const graph = verificationRequirements.filter(({ state }) =>
      state === "verification_graph_required");
    if (graph.length > 0) return verificationGraphRequired({
      wkId, focus, carriers: normalized, requirements: graph
    });
    const proofs = verificationRequirements.filter(({ state }) =>
      state === "stable_test_proof_required");
    if (proofs.length > 0) return stableTestProofRequired({
      wkId, focus, carriers: normalized, requirements: proofs
    });
  }

  if (!evaluation && proofPackAuthoring?.status === "recoverable") {
    const action = selectedPackRecoveryCall({
      wkId, focus, recovery: proofPackAuthoring
    });
    if (action) return response({
      stage: "evaluation_input_ready",
      carriers: normalized,
      unresolvedDecisions: unresolved("evaluation_input_persistence"),
      nextCall: action
    });
  }

  if (continuationRecord?.proof_graph &&
      continuationRecord.proof_graph.status !== "published") {
    const graph = continuationRecord.proof_graph;
    const pointers = [...new Set(graph.unresolved_pointers ?? [])].sort();
    const identities = [...new Set(graph.missing_graph_identities ?? [])].sort();
    return response({
      stage: "proof_graph_required",
      carriers: normalized,
      continuationRecord,
      unresolvedDecisions: Object.freeze({
        identities: Object.freeze(identities),
        count: identities.length,
        semantic_pointers: Object.freeze(pointers),
        semantic_pointer_count: pointers.length
      }),
      nextCall: call(CONTROLLED_CONTRACT_AUTHORING_TOOLS.proofGraphContinue, {
        ...baseArguments,
        continuation
      })
    });
  }

  if (continuationRecord) {
    const skeleton = continuationRecord.skeleton;
    if (!publishedGeneration && evaluation &&
        !contentEqual(evaluation.content, skeleton.evaluation_input)) {
      return refusal(CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationCarrierConflict,
        wkId, focus, { carrier_kind: "evaluation_input",
          content_digest: evaluation.content_digest });
    }
    if (!publishedGeneration && request &&
        !contentEqual(request.content, skeleton.proof_plan_request)) {
      return refusal(CONTROLLED_CONTRACT_AUTHORING_REASONS.continuationCarrierConflict,
        wkId, focus, { carrier_kind: "proof_plan_request",
          content_digest: request.content_digest });
    }
    if (!publishedGeneration && (!evaluation || !request)) return response({
      stage: !evaluation ? "evaluation_input_ready" : "proof_plan_request_ready",
      carriers: normalized,
      continuationRecord,
      unresolvedDecisions: unresolved(!evaluation ? "evaluation_input_persistence" :
        "proof_plan_request_persistence"),
      nextCall: call(CONTROLLED_CONTRACT_AUTHORING_TOOLS.continuation, {
        ...baseArguments,
        continuation,
        expected_stage: !evaluation ? "evaluation_input_ready" :
          "proof_plan_request_ready"
      })
    });
  }

  const packs = selectedPacks(normalized);

  if (!request || (!evaluation && packs.length <= 1)) {
    return proofAuthoringRequired({ carriers: normalized });
  }

  const missingInputs = selectedPackEvaluationInputs?.missing_evaluation_inputs ?? [];
  if ((selectedPackEvaluationInputs?.status === "incomplete" ||
       proofPlanBinding?.status === "incomplete") && packs.length > 0) {
    const paths = boundedIdentities(packs.map(
      ({ evaluation_input_path: value }) => value));
    const disclosed = missingInputs.slice(0, MAX_DISCLOSED_MISSING_INPUTS);
    return response({
      stage: "evaluation_input_population_incomplete",
      carriers: normalized,
      unresolvedDecisions: boundedPopulationDisclosure({
        identities: ["evaluation_input_population"],
        count: 1,
        failed_prerequisite: "selected_pack_evaluation_input_absent",
        selected_pack_count: packs.length,
        missing_evaluation_inputs: disclosed.map((entry) => ({ ...entry })),
        missing_evaluation_input_count: missingInputs.length,
        missing_evaluation_inputs_omitted: missingInputs.length - disclosed.length,
        bound_evaluation_input_paths: [...paths.identities],
        bound_evaluation_input_paths_omitted: paths.omitted
      }),
      nextCall: call(CONTROLLED_CONTRACT_AUTHORING_TOOLS.carrierQuery, {
        ...baseArguments,
        carrier_kind: "proof_plan_request",
        target: "selected_packs"
      })
    });
  }

  if (!plan) return response({
    stage: "proof_plan_ready",
    carriers: normalized,
    continuationRecord,
    unresolvedDecisions: unresolved("proof_plan_compilation"),
    nextCall: call(CONTROLLED_CONTRACT_AUTHORING_TOOLS.planBuild, {
      ...baseArguments,
      expected_content_digest: null
    })
  });

  if (proofPlanBinding?.status !== "current") return response({
    stage: "proof_plan_rebuild_required",
    carriers: normalized,
    continuationRecord,
    unresolvedDecisions: Object.freeze({
      identities: Object.freeze(["proof_plan_compilation"]),
      count: 1,
      changed_input: "canonical_proof_plan_sources",
      proof_plan_source_binding_status: proofPlanBinding?.status ?? "unclassified"
    }),
    nextCall: call(CONTROLLED_CONTRACT_AUTHORING_TOOLS.planBuild, {
      ...baseArguments,
      expected_content_digest: proofPlanBinding?.content_digest ?? plan.content_digest
    })
  });

  return response({
    stage: "complete",
    carriers: normalized,
    continuationRecord,
    unresolvedDecisions: unresolved(),
    stopCondition: "controlled_contract_authoring_complete"
  });
}
