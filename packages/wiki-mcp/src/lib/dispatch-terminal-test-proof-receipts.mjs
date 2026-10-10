

import {
  resolveControlledContractTestProofRuntimeBindings
} from "../../../wiki-core/src/lib/controlled-contract-tools.mjs";
import {
  projectWorkRecordTestProofValidation
} from "../../../wiki-core/src/lib/work-record-test-proof-bindings.mjs";
import { extractTestProofRuntimeEvidenceReceipt } from
  "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt.mjs";
import { runWorkspaceAgentTestProofAttempt } from
  "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-validation-runner.mjs";
import {
  mintLauncherTestProofAttemptContext
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs";
import {
  executeVerifyProofReceiptPopulation,
  VERIFY_PROOF_EXECUTION_FAILURE_CODES,
  VerifyProofExecutionError
} from
  "../../../agent-launch-core/src/lib/workspace-agent-verify-proof-capability.mjs";

export function declaredValidationBindings(record) {
  return projectWorkRecordTestProofValidation({ selectedUnit: record }).validation_bindings;
}

export const TERMINAL_TEST_PROOF_RUNTIME_REFUSAL_CODES = Object.freeze({
  RECEIPT_INCOMPLETE:
    "agent_launch.terminal_candidate_test_proof.receipt_incomplete.v1"
});

function failTerminalTestProofReceiptIncomplete(message, cause = null) {
  const error = cause === null ? new Error(message) : new Error(message, { cause });
  error.code = TERMINAL_TEST_PROOF_RUNTIME_REFUSAL_CODES.RECEIPT_INCOMPLETE;
  throw error;
}

export function bindTerminalTestProofVerificationIds(validations, bindings, receiptsByTarget = {}) {
  return Object.freeze(validations.map((entry) => {
    const verificationIds = bindings[entry.target] ?? Object.freeze([]);
    const receipts = receiptsByTarget[entry.target] ?? Object.freeze([]);
    const receiptIds = receipts.map((receipt) => receipt?.evidence_identity?.verification_id);
    if (verificationIds.length !== receipts.length || verificationIds.some(
      (verificationId, index) => receiptIds[index] !== verificationId
    )) {
      failTerminalTestProofReceiptIncomplete(
        "terminal test-proof verification identities require complete exact runtime-evidence receipts"
      );
    }
    return Object.freeze({
      ...entry,
      verification_ids: verificationIds,
      test_proof_evidence_authority: "advisory_execution_facts",
      ...(verificationIds.length > 0
        ? { test_proof_runtime_evidence: Object.freeze([...receipts]) }
        : {})
    });
  }));
}

export async function executeTestProofReceiptsWithAuthority({
  proofAuthority,
  targets,
  validationBindings,
  assertCurrentIdentity = null
}) {
  const proofWkId = proofAuthority?.wk_id ?? proofAuthority?.record_id;
  const selections = new Map();
  try {
    for (const target of targets) {
      const verificationIds = validationBindings[target] ?? Object.freeze([]);
      if (verificationIds.length === 0) continue;
      let selection;
      try {
        selection = await resolveControlledContractTestProofRuntimeBindings({
          repoRoot: proofAuthority.worktree_path,
          wkId: proofWkId,
          verificationIds
        });
      } catch (error) {
        throw new VerifyProofExecutionError(
          VERIFY_PROOF_EXECUTION_FAILURE_CODES.BINDING_RESOLUTION,
          "verify-proof could not resolve the exact controlled-contract bindings",
          { target, verification_ids: verificationIds },
          error
        );
      }
      if (selection?.status !== "complete" ||
          selection.requested_count !== verificationIds.length ||
          selection.matched_count !== verificationIds.length ||
          !Array.isArray(selection.bindings)) {
        throw new VerifyProofExecutionError(
          VERIFY_PROOF_EXECUTION_FAILURE_CODES.BINDING_RESOLUTION,
          "verify-proof preflight did not resolve the complete exact binding population",
          { target, verification_ids: verificationIds }
        );
      }
      for (const verificationId of verificationIds) {
        const matches = selection.bindings.filter(
          (binding) => binding?.verification_claim_id === verificationId
        );
        if (matches.length !== 1) throw new VerifyProofExecutionError(
          VERIFY_PROOF_EXECUTION_FAILURE_CODES.BINDING_RESOLUTION,
          "verify-proof preflight resolved a missing or duplicate binding",
          { target, verification_id: verificationId }
        );

      }
      selections.set(JSON.stringify(verificationIds), selection);
    }
    return await executeVerifyProofReceiptPopulation({
      proofAuthority,
      targets,
      validationBindings,
      resolveBindings: async ({ verificationIds }) =>
        selections.get(JSON.stringify(verificationIds)),
      mintAttemptContext: mintLauncherTestProofAttemptContext,
      runAttempt: runWorkspaceAgentTestProofAttempt,
      extractReceipt: extractTestProofRuntimeEvidenceReceipt,
      assertCurrentIdentity
    });
  } catch (error) {
    if (error?.code?.startsWith("agent_launch.verify_proof.")) {
      failTerminalTestProofReceiptIncomplete(error.message, error);
    }
    throw error;
  }
}
