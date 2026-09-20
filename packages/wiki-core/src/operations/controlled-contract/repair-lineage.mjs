

import {
  claimControlledContractRefactorResource,
  controlledContractRefactorResourceIdentity,
  readControlledContractRefactorResource,
  readControlledContractRefactorState,
  retainControlledContractRefactorResource,
  transitionControlledContractRefactorState
} from "../../lib/controlled-contract-refactor-staging.mjs";
import { ControlledContractToolError } from "../../lib/controlled-contract-tool-shared.mjs";

export const CONTROLLED_CONTRACT_REPAIR_LINEAGE_SCHEMA =
  "controlled-contract-repair-lineage.v3";

const LINEAGE_RESOURCE_KIND = "repair_lineage";

function referenceAttemptPayload(record) {
  return {
    schema_version: "controlled-contract-reference-attempt.v1",
    wk_id: record.wk_id, focus: record.focus,
    attempt_identity: record.identity,
    response_digest: record.workbench.response_digest
  };
}

function attemptEvidenceFailure(message) {
  throw new ControlledContractToolError("controlled_contract_reference_attempt_evidence_invalid",
    message, { changed: null, retry_safe: false });
}

export async function claimControlledContractReferenceAttempt({ repoRoot, record }) {
  return claimControlledContractRefactorResource({ repoRoot,
    resourceKind: LINEAGE_RESOURCE_KIND, payload: referenceAttemptPayload(record) });
}

export async function readControlledContractReferenceAttemptOutcome({ repoRoot, record }) {
  const payload = referenceAttemptPayload(record);
  const identity = controlledContractRefactorResourceIdentity(LINEAGE_RESOURCE_KIND, payload);
  const marker = await readControlledContractRefactorResource({ repoRoot, identity,
    expectedKind: LINEAGE_RESOURCE_KIND });
  if (marker === null) return null;
  const state = await readControlledContractRefactorState({ repoRoot, identity });
  if (state === null || state.status !== "consumed") return null;
  if (state.continuation !== record.identity) attemptEvidenceFailure("attempt state binding changed");
  const receipt = await readControlledContractRefactorResource({ repoRoot,
    identity: state.receipt_identity, expectedKind: "receipt" });

  if (receipt === null) return null;
  if (receipt.payload.schema_version === "controlled-contract-reference-pre-effect-failure.v1") {
    if (receipt.payload.attempt_identity !== record.identity ||
        receipt.payload.response_digest !== record.workbench.response_digest ||
        state.transaction_identity !== identity) attemptEvidenceFailure("failure certificate binding changed");
    return Object.freeze({ state: "effect_free", receipt_identity: receipt.identity });
  }
  return referenceSettlementOutcome(receipt, record, state.transaction_identity);
}

function referenceSettlementOutcome(receipt, record, transactionIdentity) {
  if (receipt.payload.schema_version !== "controlled-contract-authoring-settlement-receipt.v1" ||
      receipt.payload.wk_id !== record.wk_id || receipt.payload.focus !== record.focus ||
      receipt.payload.transaction_identity !== transactionIdentity ||
      receipt.payload.settlement_status !== "committed") {
    attemptEvidenceFailure("settlement receipt does not establish this attempt's outcome");
  }
  return Object.freeze({ state: "published", receipt: Object.freeze({
    ...receipt.payload, receipt_identity: receipt.identity }) });
}

export async function readControlledContractReferenceAppliedReceipt({ repoRoot, record }) {
  const receipt = await readControlledContractRefactorResource({ repoRoot,
    identity: record.workbench.result_digest, expectedKind: "receipt" });
  if (receipt === null) return null;
  return referenceSettlementOutcome(receipt, record, receipt.payload.transaction_identity);
}

export async function certifyControlledContractReferencePreEffectFailure({ repoRoot, record, marker }) {
  const request = { repoRoot, resourceKind: "receipt",
    payload: { schema_version: "controlled-contract-reference-pre-effect-failure.v1",
      attempt_identity: record.identity, response_digest: record.workbench.response_digest } };
  const receiptIdentity = controlledContractRefactorResourceIdentity(request.resourceKind, request.payload);
  await transitionControlledContractRefactorState({ repoRoot, planIdentity: marker.identity,
    status: "consumed", transactionIdentity: marker.identity,
    continuation: record.identity, receiptIdentity });
  await retainControlledContractRefactorResource(request);
}

export function referenceAttemptSettlementRetention({ repoRoot, record, marker }) {
  return async (request) => {
    const identity = controlledContractRefactorResourceIdentity(request.resourceKind, request.payload);
    if (request.resourceKind === "finalized_transaction") {
      await transitionControlledContractRefactorState({ repoRoot, planIdentity: marker.identity,
        status: "finalized", transactionIdentity: identity, continuation: record.identity });
    } else if (request.resourceKind === "receipt") {
      const state = await readControlledContractRefactorState({ repoRoot, identity: marker.identity });
      if (state === null || state.transaction_identity !== request.payload.transaction_identity) {
        attemptEvidenceFailure("settlement receipt changed its finalized transaction");
      }
      await transitionControlledContractRefactorState({ repoRoot, planIdentity: marker.identity,
        status: "consumed", transactionIdentity: state.transaction_identity,
        continuation: record.identity, receiptIdentity: identity });
    } else {
      attemptEvidenceFailure("reference settlement requested an unexpected retained resource");
    }
    return retainControlledContractRefactorResource(request);
  };
}

export const CONTROLLED_CONTRACT_REPAIR_LINEAGE_STATES = Object.freeze([
  "absent", "in_flight", "retryable", "consumed"
]);

export function controlledContractRepairLineagePayload({
  wkId, focus = null, recordSourceDigest = null, startingGeneration = null,
  startingManifestDigest = null, candidate = null
}) {
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_REPAIR_LINEAGE_SCHEMA,
    wk_id: wkId,
    focus: focus ?? null,
    record_source_digest: recordSourceDigest ?? null,
    starting_generation: startingGeneration ??
      candidate?.starting_generation ?? null,
    starting_manifest_digest: startingManifestDigest ??
      candidate?.starting_manifest_digest ?? null,
    participant_population: candidate?.affected_roles ?? null,
    candidate_digest: candidate?.candidate_digest ?? null,
    attempted: true
  });
}

export function controlledContractRepairLineageIdentity(payload) {
  return controlledContractRefactorResourceIdentity(LINEAGE_RESOURCE_KIND,
    payload);
}

export async function resolveControlledContractRepairLineage({
  repoRoot, payload, identity = null
}) {
  const lineageIdentity = identity ?? controlledContractRepairLineageIdentity(payload);
  const marker = await readControlledContractRefactorResource({
    repoRoot, identity: lineageIdentity, expectedKind: LINEAGE_RESOURCE_KIND
  }).catch(() => null);
  if (marker === null) {
    return Object.freeze({ state: "absent", identity: lineageIdentity,
      transaction_identity: null, receipt_identity: null, receipt: null });
  }
  const settled = await readControlledContractRefactorState({
    repoRoot, identity: lineageIdentity }).catch(() => null);
  if (settled === null) {

    return Object.freeze({ state: "in_flight", identity: lineageIdentity,
      transaction_identity: null, receipt_identity: null, receipt: null });
  }
  if (settled.status !== "consumed") {

    return Object.freeze({ state: "retryable", identity: lineageIdentity,
      transaction_identity: null, receipt_identity: null, receipt: null });
  }
  const receipt = await readControlledContractRefactorResource({
    repoRoot, identity: settled.receipt_identity, expectedKind: "receipt"
  }).catch(() => null);
  if (receipt === null) {

    return Object.freeze({ state: "retryable", identity: lineageIdentity,
      transaction_identity: null, receipt_identity: settled.receipt_identity,
      receipt: null, integrity: "retained_receipt_unavailable" });
  }
  return Object.freeze({
    state: "consumed",
    identity: lineageIdentity,
    transaction_identity: receipt.payload?.transaction_identity ?? null,
    receipt_identity: settled.receipt_identity,
    receipt: receipt.payload,
    resulting_generation: receipt.payload?.target?.generation ?? null,
    resulting_manifest_content_digest:
      receipt.payload?.target?.manifest_content_digest ?? null
  });
}

export async function claimControlledContractRepairLineage({ repoRoot, payload }) {
  const claim = await claimControlledContractRefactorResource({
    repoRoot, resourceKind: LINEAGE_RESOURCE_KIND, payload });
  return Object.freeze({ created: claim.created === true,
    identity: claim.resource.identity });
}

export async function recordControlledContractRepairLineageFailure({
  repoRoot, identity
}) {
  return transitionControlledContractRefactorState({
    repoRoot, planIdentity: identity, status: "finalized",
    transactionIdentity: identity, continuation: identity, receiptIdentity: null
  }).catch(() => null);
}

export async function consumeControlledContractRepairLineage({
  repoRoot, identity, receiptIdentity
}) {
  return transitionControlledContractRefactorState({
    repoRoot, planIdentity: identity, status: "consumed",
    transactionIdentity: identity, continuation: identity,
    receiptIdentity
  });
}

export function projectControlledContractRepairReplay({
  lineage, sourceCurrent = true
}) {
  return Object.freeze({
    schema_version: "controlled-contract-repair-replay.v1",
    replayed: true,
    settled: true,
    lineage_identity: lineage.identity,
    transaction_identity: lineage.transaction_identity,
    receipt_identity: lineage.receipt_identity,
    resulting_generation: lineage.resulting_generation ?? null,
    resulting_manifest_content_digest:
      lineage.resulting_manifest_content_digest ?? null,

    source_current: sourceCurrent,
    grants_dispatch_authority: false,
    effects: Object.freeze({ preparations: 0, validations: 0, commits: 0,
      compensations: 0, generation_transitions: 0, recomputations: 0 })
  });
}
