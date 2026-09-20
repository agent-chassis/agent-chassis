

import { CONTROLLED_CONTRACT_AUTHORING_TOOLS } from
  "../../lib/controlled-contract-authoring-state.mjs";
import { coverageUnitAddress } from "../../lib/controlled-contract-unit-address.mjs";

function frozen(value) {
  return Object.freeze(value);
}

function authoredCall(tool, fixedArguments, requiredAuthoredFields) {
  return frozen({
    tool,
    fixed_arguments: frozen({ ...fixedArguments }),
    required_authored_fields: frozen([...requiredAuthoredFields])
  });
}

export function coverageUnitArguments({ wkId, focus = null, selectedUnit = null }) {
  return frozen({
    unit: coverageUnitAddress({ wkId, selectedUnit }),
    ...(focus === null ? {} : { focus })
  });
}

function fixedCall(tool, args) {
  return frozen({ tool, arguments: frozen({ ...args }) });
}

export function obligationCoverageDescribeCalls({ resolved, sourceIdentity }) {
  if (resolved === null || typeof resolved !== "object" || !Object.hasOwn(resolved, "revision")) {
    throw new TypeError("obligation coverage calls require the bound combined revision");
  }
  const fixed = coverageUnitArguments(resolved);
  const digestFixed = { ...fixed, expected_content_digest: resolved.revision };
  return frozen([
    fixedCall("workspace_controlled_contract_obligation_coverage_query", fixed),
    authoredCall("workspace_controlled_contract_obligation_coverage_upsert", digestFixed, ["obligations"]),
    ...(resolved.source === null ? [] : [
      authoredCall("workspace_controlled_contract_obligation_coverage_remove", digestFixed,
        ["obligation_id", "removal_scope"]),
      fixedCall("workspace_validate_proof", fixed)
    ])
  ]);
}

export function coverageSelectorRecovery({ family, input }) {
  const fixed = coverageUnitArguments(input);
  return frozen(family === "obligation"
    ? [fixedCall("workspace_controlled_contract_obligation_coverage_query", fixed)]
    : []);
}

export function proofCatalogDiscoveryRecovery() {
  return frozen([fixedCall(CONTROLLED_CONTRACT_AUTHORING_TOOLS.intentDiscovery, {})]);
}

export function authoringStateRecovery(input) {
  return frozen({
    tool: CONTROLLED_CONTRACT_AUTHORING_TOOLS.state,
    arguments: frozen({
      unit: input.wkId,
      ...(input.focus === null || input.focus === undefined ? {} : { focus: input.focus })
    })
  });
}

export function attachOwnerProducedRecovery(error, {
  input,
  ownerState = null,
  upstreamDescribe = null
}) {
  if (error === null || typeof error !== "object") return error;
  const ownerCalls = Array.isArray(ownerState?.next_calls) && ownerState.next_calls.length > 0
    ? ownerState.next_calls
    : Array.isArray(upstreamDescribe?.next_calls) && upstreamDescribe.next_calls.length > 0
      ? upstreamDescribe.next_calls
      : [authoringStateRecovery(input)];
  error.details = {
    ...(error.details ?? {}),
    recovery_owner: ownerState?.stage === "proof_authoring_required"
      ? "controlled_contract_proof_authoring"
      : upstreamDescribe === null
        ? "controlled_contract_authoring_state"
        : "controlled_contract_obligation_coverage",
    next_calls: structuredClone(ownerCalls)
  };
  return error;
}

export function noAgentRouteBlocker() {
  return frozen({
    state: "no_agent_route",
    owner: "WK-2427",
    operator_action: "Inspect WK-2427 with workspace_work_record_summary and complete it through its supported operator lifecycle."
  });
}
