

import {
  ControlledContractToolError,
  assertControlledContractOperationInput,
  resolveControlledContractGeneration
} from "../../lib/controlled-contract-tools.mjs";
import { deriveControlledContractAuthoringState } from
  "../../lib/controlled-contract-authoring-state.mjs";
import { DIGEST_PATTERN } from "../../lib/controlled-contract-tool-shared.mjs";
import { buildNextCall } from "../../lib/next-calls-descriptor.mjs";
import { controlledContractOperation } from "./refusal.mjs";

const GENERATION_PERSISTENCE_RECEIPT_SCHEMA_VERSION =
  "controlled-contract-generation-persistence-receipt.v1";
const GENERATION_PERSISTENCE_RECEIPT_KEYS = Object.freeze([
  "bound_tip", "disposition", "final_tip", "generation", "initiative",
  "invocation", "record_id", "record_source_digest", "ref", "schema_version"
]);
const GENERATION_PERSISTENCE_INVOCATION_KEYS = Object.freeze([
  "commit", "commit_created", "ref_write_succeeded"
]);

const GENERATION_PERSISTENCE_AUTHORING_FIELDS = Object.freeze([
  "stage", "next_calls", "next_action", "carriers", "status", "reason_code",
  "missing_carrier", "stale_carrier", "contract_identity", "expected_content_digest"
]);
const GENERATION_PERSISTENCE_REF_PATTERN = /^refs\/heads\/wk\/IN-[0-9]{4}\/WK-[0-9]{4}$/;
const GENERATION_PERSISTENCE_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GENERATION_PERSISTENCE_NULL_OID_PATTERN = /^0+$/;
const GENERATION_PERSISTENCE_REF_UNRESOLVABLE_CODE =
  "agent_launch.controlled_contract_generation.ref_unresolvable.v1";

function generationPersistenceRefusal(code, message, details = {}) {
  return new ControlledContractToolError(code, message, details);
}

function isExactKeySet(value, expected) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected]);
}

function emptyGenerationRefusal(wkId) {
  const state = deriveControlledContractAuthoringState({
    wkId, focus: null, carriers: {}
  });
  return generationPersistenceRefusal(
    "controlled_contract_generation_empty",
    "controlled-contract generation persistence has no complete generation to persist",
    {
      stage: state.stage,
      recovery_route_kind: "controlled_contract_authoring_action",
      recovery_route_callable: true,
      next_calls: structuredClone(state.next_calls ?? [])
    }
  );
}

function projectDirectPersistenceRecovery(error, { wkId }) {
  if (error?.code !== GENERATION_PERSISTENCE_REF_UNRESOLVABLE_CODE) return error;
  const projected = new ControlledContractToolError(error.code, error.message, {
    ...structuredClone(error.details ?? {}),
    recovery_route_kind: "operator_lifecycle_action",
    recovery_route_callable: false,
    next_calls: [
      buildNextCall({
        tool: "workspace_work_record_summary",
        arguments: { id: wkId },
        recommended: true
      }),
      buildNextCall({ tool: "workspace_agent_dispatch" })
    ]
  });
  return projected;
}

function malformedReceiptCommitEffect({ commit, commit_created: commitCreated }) {
  const present = commit !== null;
  if (present && (typeof commit !== "string" ||
      !GENERATION_PERSISTENCE_OID_PATTERN.test(commit) ||
      GENERATION_PERSISTENCE_NULL_OID_PATTERN.test(commit))) return true;
  return commitCreated !== present;
}

function assertControlledContractGenerationReceipt(receipt, { wkId, generation }) {
  if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw generationPersistenceRefusal(
      "controlled_contract_generation_receipt_missing",
      "generation persistence returned no authoritative receipt"
    );
  }
  const authoringFields = GENERATION_PERSISTENCE_AUTHORING_FIELDS
    .filter((field) => Object.hasOwn(receipt, field));
  if (authoringFields.length > 0) {
    throw generationPersistenceRefusal(
      "controlled_contract_generation_receipt_invalid",
      "generation persistence returned authoring state instead of a persistence receipt",
      { authoring_fields: authoringFields }
    );
  }
  if (receipt.schema_version !== GENERATION_PERSISTENCE_RECEIPT_SCHEMA_VERSION ||
      !isExactKeySet(receipt, GENERATION_PERSISTENCE_RECEIPT_KEYS)) {
    throw generationPersistenceRefusal(
      "controlled_contract_generation_receipt_invalid",
      "generation persistence result is not one exact persistence receipt",
      {
        schema_version: typeof receipt.schema_version === "string"
          ? receipt.schema_version : null,
        fields: Object.keys(receipt).sort()
      }
    );
  }
  if (receipt.record_id !== wkId ||
      typeof receipt.initiative !== "string" ||
      receipt.ref !== `refs/heads/wk/${receipt.initiative}/${wkId}` ||
      !GENERATION_PERSISTENCE_REF_PATTERN.test(receipt.ref) ||
      typeof receipt.record_source_digest !== "string" ||
      !DIGEST_PATTERN.test(receipt.record_source_digest) ||
      typeof receipt.bound_tip !== "string" ||
      !GENERATION_PERSISTENCE_OID_PATTERN.test(receipt.bound_tip) ||
      typeof receipt.final_tip !== "string" ||
      !GENERATION_PERSISTENCE_OID_PATTERN.test(receipt.final_tip) ||
      (receipt.disposition !== "created" && receipt.disposition !== "observed") ||
      receipt.invocation === null || typeof receipt.invocation !== "object" ||
      Array.isArray(receipt.invocation) ||
      !isExactKeySet(receipt.invocation, GENERATION_PERSISTENCE_INVOCATION_KEYS) ||
      typeof receipt.invocation.commit_created !== "boolean" ||
      typeof receipt.invocation.ref_write_succeeded !== "boolean" ||
      malformedReceiptCommitEffect(receipt.invocation)) {
    throw generationPersistenceRefusal(
      "controlled_contract_generation_receipt_invalid",
      "generation persistence receipt does not name one exact authoritative ref effect",
      { record_id: receipt.record_id ?? null, ref: receipt.ref ?? null }
    );
  }
  const receiptGeneration = receipt.generation;
  const malformedGeneration = receiptGeneration === null ||
    typeof receiptGeneration !== "object" || Array.isArray(receiptGeneration);
  if (malformedGeneration ||
      receiptGeneration.count !== generation.count ||
      receiptGeneration.digest !== generation.generation_digest) {
    throw generationPersistenceRefusal(
      "controlled_contract_generation_receipt_mismatch",
      "generation persistence receipt does not identify the exact authoritative bytes",
      {
        expected_count: generation.count,
        actual_count: malformedGeneration ? null : receiptGeneration.count ?? null,
        expected_generation_digest: generation.generation_digest,
        actual_generation_digest: malformedGeneration ? null : receiptGeneration.digest ?? null
      }
    );
  }
  const expectedDescriptors = generation.descriptors.map(
    ({ path: carrierPath, content_digest: contentDigest }) => ({
      path: carrierPath, content_digest: contentDigest
    }));
  if (!Array.isArray(receiptGeneration.descriptors) ||
      JSON.stringify(receiptGeneration.descriptors) !== JSON.stringify(expectedDescriptors)) {
    throw generationPersistenceRefusal(
      "controlled_contract_generation_receipt_mismatch",
      "generation persistence receipt does not name the exact persisted carrier population",
      { expected_paths: expectedDescriptors.map(({ path: carrierPath }) => carrierPath) }
    );
  }
}

export async function persistControlledContractGenerationOperation(input, {
  resolveGenerationBinding,
  persistGeneration
} = {}) {
  return controlledContractOperation(async () => {
    assertControlledContractOperationInput(input, ["repoRoot", "wkId"]);
    if (typeof resolveGenerationBinding !== "function" ||
        typeof persistGeneration !== "function") {
      throw new ControlledContractToolError(
        "controlled_contract_generation_persistence_unavailable",
        "server-owned controlled-contract generation persistence composition is unavailable"
      );
    }
    let generation;
    try {
      generation = await resolveControlledContractGeneration({
        repoRoot: input.repoRoot,
        wkId: input.wkId
      });
    } catch (error) {
      if (error?.code !== "controlled_contract_generation_empty") throw error;
      throw emptyGenerationRefusal(input.wkId);
    }
    let receipt;
    try {
      const binding = await resolveGenerationBinding({
        repoRoot: input.repoRoot,
        wkId: input.wkId,
        generation
      });
      receipt = await persistGeneration({ binding });
    } catch (error) {
      throw projectDirectPersistenceRecovery(error, { wkId: input.wkId });
    }
    assertControlledContractGenerationReceipt(receipt, {
      wkId: input.wkId,
      generation
    });
    const authoritative = await resolveControlledContractGeneration({
      repoRoot: input.repoRoot,
      wkId: input.wkId
    });
    if (authoritative.generation_digest !== generation.generation_digest ||
        authoritative.count !== generation.count ||
        JSON.stringify(authoritative.descriptors) !== JSON.stringify(generation.descriptors)) {
      throw generationPersistenceRefusal(
        "controlled_contract_generation_authoritative_mismatch",
        "authoritative controlled-contract carriers changed before persistence confirmation",
        {
          expected_generation_digest: generation.generation_digest,
          actual_generation_digest: authoritative.generation_digest,
          expected_count: generation.count,
          actual_count: authoritative.count
        }
      );
    }
    return receipt;
  });
}
