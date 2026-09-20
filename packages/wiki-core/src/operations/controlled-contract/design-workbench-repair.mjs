

import {
  CONTROLLED_CONTRACT_REPAIR_SEMANTIC_OWNERS,
  censusControlledContractRepairParticipants
} from "./repair-participant-registry.mjs";
import {
  classifyControlledContractTerminalGapCode
} from "./terminal-gap-classification.mjs";
import {
  CONTROLLED_CONTRACT_REPAIR_PREPARABLE_OWNERS,
  controlledContractRepairDigest,
  runControlledContractRepairTransaction
} from "./repair-transaction.mjs";

export const CONTROLLED_CONTRACT_AUTOMATIC_REPAIR_SCHEMA_VERSION =
  "controlled-contract-automatic-repair.v1";

export const CONTROLLED_CONTRACT_MECHANICAL_RESPONSE_KIND = "advance_authoring";

function outcome(fields) {
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_AUTOMATIC_REPAIR_SCHEMA_VERSION,
    attempted: false,
    settled: false,
    replayed: false,
    reason_code: null,
    gap_class: null,
    responsible_owner: null,
    candidate_row_id: null,
    transaction_identity: null,
    receipt_identity: null,
    source_current: true,
    ...fields
  });
}

export function deriveControlledContractRepairCandidate(workbench, {
  census = censusControlledContractRepairParticipants(),
  semanticOwners = CONTROLLED_CONTRACT_REPAIR_SEMANTIC_OWNERS,
  preparableOwners = CONTROLLED_CONTRACT_REPAIR_PREPARABLE_OWNERS,
  descriptors = null
} = {}) {

  const recordSourceDigest = workbench.subject?.record_source_digest ?? null;
  if (typeof recordSourceDigest !== "string" || recordSourceDigest.length === 0) {
    return outcome({ reason_code: "controlled_contract_repair_source_unauthenticated",
      gap_class: "stale_source" });
  }
  if (workbench.mechanically_complete === true) {
    return outcome({ reason_code: "controlled_contract_repair_not_required" });
  }
  const mechanical = workbench.actionable_rows.filter((row) =>
    Array.isArray(row.eligible_response_forms) &&
    row.eligible_response_forms.length === 1 &&
    row.eligible_response_forms[0] === CONTROLLED_CONTRACT_MECHANICAL_RESPONSE_KIND);
  if (mechanical.length === 0) {

    return outcome({ reason_code: "controlled_contract_repair_no_mechanical_candidate",
      gap_class: workbench.actionable_row_count > 0
        ? "unresolved_semantic_choice" : null });
  }
  const bound = new Set(census.roles.filter(({ mutable }) => mutable)
    .map(({ role_id: id }) => id));
  const rows = [];
  const roleOwners = new Map();
  for (const row of mechanical) {
    const descriptor = descriptors?.get(row.row_id) ?? null;
    const owner = descriptor?.semantic_owner ?? null;
    if (owner === null || !Object.hasOwn(semanticOwners, owner)) {
      return outcome({ candidate_row_id: row.row_id, responsible_owner: owner,
        reason_code: "controlled_contract_repair_owner_unregistered",
        gap_class: "tooling_or_internal_invariant" });
    }

    if (!preparableOwners.includes(owner)) {
      return outcome({ candidate_row_id: row.row_id, responsible_owner: owner,
        reason_code: "controlled_contract_repair_participant_missing",
        gap_class: "tooling_or_internal_invariant" });
    }
    const unbound = semanticOwners[owner].filter((role) => !bound.has(role));
    if (unbound.length > 0) {
      return outcome({ candidate_row_id: row.row_id, responsible_owner: owner,
        reason_code: "controlled_contract_repair_role_unbound",
        gap_class: "tooling_or_internal_invariant" });
    }
    for (const role of semanticOwners[owner]) {
      const prior = roleOwners.get(role);
      if (prior !== undefined && prior !== owner) {

        return outcome({ candidate_row_id: row.row_id,
          reason_code: "controlled_contract_repair_role_contended",
          gap_class: "unresolved_semantic_choice" });
      }
      roleOwners.set(role, owner);
    }
    rows.push(Object.freeze({ row_id: row.row_id, semantic_owner: owner,
      owner_context: structuredClone(descriptor.owner_context ?? {}) }));
  }
  const ordered = [...rows].sort((left, right) =>
    left.row_id.localeCompare(right.row_id));
  const affectedRoles = Object.freeze([...roleOwners.keys()].sort());
  return outcome({
    unique: true,
    rows: Object.freeze(ordered),
    affected_roles: affectedRoles,
    starting_generation: workbench.subject.generation_id ?? null,
    starting_manifest_digest: workbench.subject.manifest_digest ?? null,
    record_source_digest: workbench.subject.record_source_digest ?? null,
    candidate_digest: controlledContractRepairDigest({
      rows: ordered.map(({ row_id: rowId, semantic_owner: owner, owner_context: context }) =>
        [rowId, owner, controlledContractRepairDigest(context)]),
      roles: affectedRoles
    }),
    candidate_row_id: ordered.length === 1 ? ordered[0].row_id : null,
    responsible_owner: [...new Set(ordered.map(({ semantic_owner: owner }) => owner))]
      .sort().join("+") || null
  });
}

function classifyOwnerFailure(error) {
  if (typeof error?.code !== "string" || error.code.length === 0) {
    return "tooling_or_internal_invariant";
  }
  const classified = classifyControlledContractTerminalGapCode(error.code);
  if (classified !== "tooling_or_internal_invariant") return classified;
  return error?.details?.changed === false
    ? "owner_refusal" : "tooling_or_internal_invariant";
}

export async function attemptControlledContractAutomaticRepair({
  input, workbench, descriptors,
  census = censusControlledContractRepairParticipants(),
  runTransaction = runControlledContractRepairTransaction,

  qualification = null
}) {
  const candidate = qualification ??
    deriveControlledContractRepairCandidate(workbench, { census, descriptors });
  if (candidate.unique !== true) return candidate;
  let receipt = null;
  try {
    receipt = await runTransaction({ input, candidate, census });
  } catch (error) {
    return outcome({ attempted: true, settled: false,
      candidate_row_id: candidate.candidate_row_id,
      responsible_owner: candidate.responsible_owner,
      reason_code: error?.code ?? "controlled_contract_repair_owner_failed",
      gap_class: classifyOwnerFailure(error) });
  }

  if (receipt.replay?.replayed === true) {
    return outcome({ replayed: true, settled: true,
      candidate_row_id: candidate.candidate_row_id,
      responsible_owner: candidate.responsible_owner,
      transaction_identity: receipt.replay.transaction_identity,
      receipt_identity: receipt.replay.receipt_identity,
      source_current: receipt.replay.source_current,
      reason_code: "controlled_contract_repair_lineage_already_settled" });
  }
  return outcome({ attempted: true, settled: true,
    candidate_row_id: candidate.candidate_row_id,
    responsible_owner: candidate.responsible_owner,
    transaction_identity: receipt.receipt.transaction_identity,
    receipt_identity: receipt.receipt.receipt_identity,
    transaction: receipt });
}

export function projectControlledContractRepairOutcome(result) {
  const transaction = result.transaction ?? null;
  return Object.freeze({
    schema_version: result.schema_version,
    attempted: result.attempted,
    settled: result.settled,
    replayed: result.replayed,
    reason_code: result.reason_code,
    responsible_owner: result.responsible_owner,
    candidate_row_id: result.candidate_row_id,
    transaction_identity: result.transaction_identity,
    receipt_identity: result.receipt_identity,
    starting_generation: transaction?.source_identity.starting_generation ?? null,
    resulting_generation: transaction?.receipt.target.generation ?? null,
    participant_count: transaction?.participant_count ?? 0,
    prepared_role_count: transaction?.prepared_role_count ?? 0,
    settlement_participants: transaction?.settlement_participants ?? Object.freeze([]),
    contribution_count: transaction?.contribution_count ?? 0,
    committed_participants: transaction?.receipt.committed_participants ??
      Object.freeze([]),

    repair_attempt_limit: 1,
    recomputation_count: result.settled === true && result.replayed !== true ? 1 : 0,
    retained_detail: transaction === null ? null : Object.freeze({
      resource_kind: "receipt",
      resource_identity: transaction.receipt.receipt_identity
    })
  });
}
