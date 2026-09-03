

const AUTHORING_STATE_TOOL = "workspace_controlled_contract_authoring_state";

function frozen(value) {
  return Object.freeze(value);
}

export function coverageUnitArguments({ wkId, focus = null, selectedUnit = null }) {
  return frozen({
    unit: selectedUnit === null ? wkId : `${wkId}#${selectedUnit}`,
    ...(focus === null ? {} : { focus })
  });
}

function authoredCall(tool, fixedArguments, requiredAuthoredFields) {
  return frozen({
    tool,
    fixed_arguments: frozen({ ...fixedArguments }),
    required_authored_fields: frozen([...requiredAuthoredFields])
  });
}

function fixedCall(tool, args) {
  return frozen({ tool, arguments: frozen({ ...args }) });
}

export function coverageAuthoringActionProjection({
  family, status, nextCalls, criterionCount
}) {
  const carrierState = status.endsWith("_absent") ? "absent"
    : status.endsWith("_stale") ? "stale" : "current";
  const operations = carrierState === "absent" ? ["create"]
    : carrierState === "stale" ? ["rebase"] : ["patch", "upsert"];
  const prefix = `workspace_controlled_contract_${family}_coverage_`;
  const selected = operations.map((operation) => ({
    operation,
    call: nextCalls.find(({ tool }) => tool === `${prefix}${operation}`)
  })).find(({ call }) => call !== undefined) ?? null;
  if (selected === null) return null;
  const { call, operation } = selected;
  return frozen({
    kind: carrierState === "absent" ? "atomic_initial_create"
      : carrierState === "stale" ? "owner_selected_recovery"
        : operation === "patch" ? "atomic_patch" : "single_row_upsert",
    tool: call.tool,
    fixed_arguments: frozen(structuredClone(
      call.fixed_arguments ?? call.arguments ?? {}
    )),
    required_authored_fields: frozen(carrierState === "absent"
      ? ["authored_rows"] : structuredClone(call.required_authored_fields ?? [])),
    required_population: frozen(carrierState === "absent" ? {
      mode: "complete_population",
      request_field: "authored_rows",
      required_rows: criterionCount,
      identity_field: "row_slot_identity"
    } : operation === "patch" ? {
      mode: "typed_patch_operations",
      request_field: "operations",
      required_rows: null,
      identity_field: "row_slot_identity"
    } : carrierState === "current" ? {
      mode: "single_row_upsert",
      request_field: "row",
      selector_field: family === "obligation"
        ? "obligation_selector" : "criterion_selector",
      required_rows: 1,
      identity_field: null
    } : {
      mode: "server_fixed_recovery",
      request_field: null,
      required_rows: 0,
      identity_field: null
    }),
    completion_predicate: frozen({
      verification_tool: `workspace_controlled_contract_${family}_coverage_describe`,
      expected_carrier_state: "current",
      expected_currentness: true
    })
  });
}

export function obligationCoverageDescribeCalls({ resolved, sourceIdentity }) {
  const fixed = coverageUnitArguments(resolved);
  if (resolved.source === null) return frozen([authoredCall(
    "workspace_controlled_contract_obligation_coverage_create",
    {
      ...fixed,
      expected_authoring_identity: resolved.authoringIdentity,
      expected_content_digest: null
    },
    ["rows"]
  )]);
  if (!resolved.sourceCurrent) return frozen([fixedCall(
    "workspace_controlled_contract_obligation_coverage_rebase",
    {
      ...fixed,
      mode: "attempt",
      expected_authoring_identity: resolved.authoringIdentity,
      source_identity: sourceIdentity
    }
  )]);
  const digestFixed = { ...fixed, expected_content_digest: resolved.source.content_digest };
  return frozen([
    fixedCall("workspace_controlled_contract_obligation_coverage_query", fixed),
    authoredCall("workspace_controlled_contract_obligation_coverage_upsert",
      digestFixed, ["obligation_selector", "row"]),
    authoredCall("workspace_controlled_contract_obligation_coverage_remove",
      digestFixed, ["obligation_selector"])
  ]);
}

export function acceptanceCoverageDescribeCalls({
  resolved,
  carrierIdentity,
  sourceIdentity,
  unitDigest,
  changedBindings
}) {
  const fixed = coverageUnitArguments(resolved);
  if (resolved.carrier === null) return frozen([authoredCall(
    "workspace_controlled_contract_acceptance_coverage_create",
    {
      ...fixed,
      carrier_identity: carrierIdentity,
      source_identity: sourceIdentity,
      expected_unit_digest: unitDigest,
      expected_content_digest: null
    },
    ["rows"]
  )]);
  if (changedBindings.length > 0) return frozen([
    fixedCall("workspace_controlled_contract_acceptance_coverage_rebase", {
      ...fixed,
      mode: "attempt",
      carrier_identity: carrierIdentity,
      source_identity: sourceIdentity,
      expected_unit_digest: unitDigest
    })
  ]);
  const mutationFixed = {
    ...fixed,
    carrier_identity: carrierIdentity,
    source_identity: sourceIdentity,
    expected_content_digest: resolved.carrier.content_digest
  };
  return frozen([
    fixedCall("workspace_controlled_contract_acceptance_coverage_query", fixed),
    authoredCall("workspace_controlled_contract_acceptance_coverage_upsert",
      mutationFixed, ["criterion_selector", "row"]),
    authoredCall("workspace_controlled_contract_acceptance_coverage_remove",
      mutationFixed, ["criterion_selector"])
  ]);
}

export function coverageSelectorRecovery({ family, input }) {
  const fixed = coverageUnitArguments(input);
  const prefix = `workspace_controlled_contract_${family}_coverage`;
  return frozen([
    fixedCall(`${prefix}_describe`, fixed),
    fixedCall(`${prefix}_query`, fixed)
  ]);
}

export function authoringStateRecovery(input) {
  return frozen({
    tool: AUTHORING_STATE_TOOL,
    arguments: frozen({
      wk_id: input.wkId,
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
