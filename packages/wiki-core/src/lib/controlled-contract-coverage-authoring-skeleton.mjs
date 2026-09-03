import { composeCoverageAuthoringSkeleton }
  from "../../../controlled-contract/current.mjs";

function deletePath(value, path) {
  const parts = path.split(".");
  let parent = value;
  for (const part of parts.slice(0, -1)) {
    if (!parent || typeof parent !== "object") return;
    parent = parent[part];
  }
  if (parent && typeof parent === "object") delete parent[parts.at(-1)];
}

function admittedPackComponents(selectedPacks) {
  return selectedPacks.flatMap((pack) =>
    (pack.requested_intents ?? []).flatMap((requestedIntent) =>
      (pack.selectors ?? []).map((selector) => ({
        kind: "pack_mapping",
        pack_id: pack.pack_id,
        requested_intent: requestedIntent,
        profile_id: pack.profile_id,
        profile_version: pack.profile_version,
        selector: {
          kind: selector.kind,
          component_id: selector.component_id
        },
        evaluation_stage: selector.evaluation_stage
      }))));
}

function composeControlledContractCoverageAuthoringSkeleton({
  surface,
  unit,
  criterionIdentities,
  contract,
  proofPlan,
  carrier,
  mutation,
  obligation
}) {
  const stableArguments = structuredClone(mutation.fixedArguments);
  for (const path of mutation.receiptFedDigestFields) {
    deletePath(stableArguments, path);
  }
  const skeleton = composeCoverageAuthoringSkeleton({
    surface,
    server: {
      unitAddress: unit.address,
      selectedUnit: unit.selectedUnit,
      focus: unit.focus,
      selectedUnitDigest: unit.digest,
      criterionIdentities: structuredClone(criterionIdentities),
      contractContentDigest: contract.contentDigest,
      contractNodes: structuredClone(contract.nodes),
      proofPlanContentDigest: proofPlan.contentDigest,
      selectedPacks: structuredClone(proofPlan.selectedPacks),
      carrierStatus: carrier.status,
      changedBindings: structuredClone(carrier.changedBindings),
      mutation: {
        operation: mutation.operation,
        stableArguments,
        receiptFedDigestFields: structuredClone(mutation.receiptFedDigestFields)
      },
      ...(surface === "obligation" ? { obligation: {
        mechanisms: structuredClone(obligation.mechanisms),
        gapAlternatives: structuredClone(obligation.gapAlternatives),
        packComponents: admittedPackComponents(proofPlan.selectedPacks),
        expectedAuthoringIdentity: obligation.expectedAuthoringIdentity,
        sourceIdentity: structuredClone(obligation.sourceIdentity)
      } } : {})
    }
  });
  return Object.freeze({
    ...skeleton,
    execution_handoff: Object.freeze({
      mode: mutation.receiptFedDigestFields.length === 0
        ? "complete_population_create" : "sequential_single_row",
      receipt_source: mutation.receiptFedDigestFields.length === 0
        ? null : "immediately_prior_mutation_receipt",
      final_verification_operations: Object.freeze([
        `workspace_controlled_contract_${surface}_coverage_query`,
        `workspace_controlled_contract_${surface}_coverage_describe`
      ])
    })
  });
}

export { composeControlledContractCoverageAuthoringSkeleton };
