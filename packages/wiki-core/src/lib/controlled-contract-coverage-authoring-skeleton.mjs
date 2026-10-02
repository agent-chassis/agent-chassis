import { composeCoverageAuthoringSkeleton }
  from "@agent-chassis/controlled-contract";
import { CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA,
  CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_ROW_AUTHORING_SCHEMA } from
  "./controlled-contract-tools.mjs";

export function coverageObligationFieldContracts() {
  const fields = CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA
    .properties;
  return structuredClone(Object.fromEntries(
    ["expected_content_digest", "obligations"]
      .map((key) => [key, fields[key]])));
}

export function coverageAcceptanceFieldContracts() {
  const fields = CONTROLLED_CONTRACT_ACCEPTANCE_COVERAGE_ROW_AUTHORING_SCHEMA
    .properties.rows.items.properties;
  return structuredClone({ node_ids: fields.node_ids, axes: fields.axes });
}

export function coverageAdmittedComponentChoices(selectedPacks) {
  return admittedPackComponents(selectedPacks ?? []).map(
    ({ kind, requested_intent, selector }) =>
      ({ kind, requested_intent, selector }));
}

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
  if (surface === "obligation") return Object.freeze({
    mutation: { operation: "workspace_controlled_contract_obligation_coverage_upsert",
      fixed_arguments: { unit: unit.address, ...(unit.focus ? { focus: unit.focus } : {}) },
      request_schema: CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_INPUT_SCHEMA },
    field_contracts: coverageObligationFieldContracts(),
    source_identity: obligation?.sourceIdentity ?? null,
    next_calls: [{ tool: "workspace_controlled_contract_obligation_coverage_query",
      arguments: { unit: unit.address, ...(unit.focus ? { focus: unit.focus } : {}) } }]
  });
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
  return Object.freeze(skeleton);
}

export { composeControlledContractCoverageAuthoringSkeleton };
