const VERIFY_PROOF_EXECUTION_SCHEMA_VERSION =
  "workspace-agent-verify-proof-receipt-population.v1";
const VERIFY_PROOF_EXECUTION_FAILURE_CODES = Object.freeze({
  INPUT_INVALID: "agent_launch.verify_proof.input_invalid.v1",
  BINDING_RESOLUTION: "agent_launch.verify_proof.binding_resolution_failed.v1",
  ATTEMPT_CONTEXT: "agent_launch.verify_proof.attempt_context_failed.v1",
  ATTEMPT_EXECUTION: "agent_launch.verify_proof.attempt_execution_failed.v1",
  RECEIPT_INCOMPLETE: "agent_launch.verify_proof.receipt_incomplete.v1",
  RECEIPT_CROSS_BOUND: "agent_launch.verify_proof.receipt_cross_bound.v1"
});

class VerifyProofExecutionError extends Error {
  constructor(code, message, details = {}, cause = null) {
    super(message, cause === null ? undefined : { cause });
    this.name = "VerifyProofExecutionError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

function fail(code, message, details = {}, cause = null) {
  throw new VerifyProofExecutionError(code, message, details, cause);
}

async function executeVerifyProofReceiptPopulation(input = {}) {
  const allowed = new Set([
    "proofAuthority", "targets", "validationBindings", "resolveBindings",
    "mintAttemptContext", "runAttempt", "extractReceipt", "assertCurrentIdentity"
  ]);
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !allowed.has(key))) fail(
    VERIFY_PROOF_EXECUTION_FAILURE_CODES.INPUT_INVALID,
    "verify-proof execution refuses caller-selected identity or process authority"
  );
  const { proofAuthority, targets, validationBindings, resolveBindings,
    mintAttemptContext, runAttempt, extractReceipt,
    assertCurrentIdentity = null } = input;
  const proofWkId = proofAuthority?.wk_id ?? proofAuthority?.record_id;
  if (!proofAuthority || typeof proofAuthority.worktree_path !== "string" ||
      typeof proofWkId !== "string" || !Array.isArray(targets) ||
      targets.length === 0 || targets.some((target) => typeof target !== "string" ||
        target.length === 0) || new Set(targets).size !== targets.length ||
      !validationBindings || typeof validationBindings !== "object" ||
      Array.isArray(validationBindings) ||
      Object.keys(validationBindings).some((target) => !targets.includes(target)) ||
      typeof resolveBindings !== "function" ||
      typeof mintAttemptContext !== "function" || typeof runAttempt !== "function" ||
      typeof extractReceipt !== "function" ||
      (assertCurrentIdentity !== null && typeof assertCurrentIdentity !== "function")) fail(
    VERIFY_PROOF_EXECUTION_FAILURE_CODES.INPUT_INVALID,
    "verify-proof execution requires launcher-resolved authority, targets, and providers"
  );
  const receiptsByTarget = {};
  const evidenceByTarget = {};
  for (const target of targets) {
    const verificationIds = validationBindings[target] ?? Object.freeze([]);
    if (!Array.isArray(verificationIds) || verificationIds.some((id) =>
      typeof id !== "string" || id.length === 0) ||
      new Set(verificationIds).size !== verificationIds.length) fail(
      VERIFY_PROOF_EXECUTION_FAILURE_CODES.INPUT_INVALID,
      "verify-proof validation bindings must be unique server-resolved identities",
      { target }
    );
    let selection = null;
    if (verificationIds.length > 0) {
      try {
        selection = await resolveBindings({
          repoRoot: proofAuthority.worktree_path,
          wkId: proofWkId,
          verificationIds
        });
      } catch (error) {
        fail(VERIFY_PROOF_EXECUTION_FAILURE_CODES.BINDING_RESOLUTION,
          "verify-proof could not resolve the exact controlled-contract bindings",
          { target, verification_ids: verificationIds }, error);
      }
    }
    const receipts = [];
    const evidence = [];
    for (const verificationId of verificationIds) {
      let context;
      try {
        context = mintAttemptContext({
          authority: proofAuthority,
          target,
          authorizedTargets: targets,
          controlledContractSelection: selection,
          verificationId
        });
      } catch (error) {
        fail(VERIFY_PROOF_EXECUTION_FAILURE_CODES.ATTEMPT_CONTEXT,
          "verify-proof could not mint the exact attempt context",
          { target, verification_id: verificationId }, error);
      }
      if (assertCurrentIdentity !== null) await assertCurrentIdentity();
      let attempt;
      let receipt;
      try {
        attempt = await runAttempt({ context });
      } catch (error) {
        fail(VERIFY_PROOF_EXECUTION_FAILURE_CODES.ATTEMPT_EXECUTION,
          "verify-proof candidate, falsifier, or traversal execution failed",
          { target, verification_id: verificationId }, error);
      }
      try {
        receipt = extractReceipt(attempt);
      } catch (error) {
        fail(VERIFY_PROOF_EXECUTION_FAILURE_CODES.RECEIPT_INCOMPLETE,
          "verify-proof attempt did not yield complete authenticated runtime evidence",
          { target, verification_id: verificationId }, error);
      }
      if (assertCurrentIdentity !== null) await assertCurrentIdentity();
      if (receipt?.evidence_identity?.verification_id !== verificationId ||
          receipt?.evidence_identity?.command_target !== target ||
          (attempt?.evidence !== undefined &&
            attempt.evidence?.evidence_identity?.verification_id !== verificationId)) {
        fail(VERIFY_PROOF_EXECUTION_FAILURE_CODES.RECEIPT_CROSS_BOUND,
          "verify-proof receipt is bound to a different verification or target",
          { target, verification_id: verificationId });
      }
      receipts.push(receipt);
      if (attempt?.evidence !== undefined) evidence.push(attempt.evidence);
    }
    receiptsByTarget[target] = Object.freeze(receipts);
    evidenceByTarget[target] = Object.freeze(evidence);
  }
  return Object.freeze({
    schema_version: VERIFY_PROOF_EXECUTION_SCHEMA_VERSION,
    authority: "advisory_execution_facts",
    advisory: true,
    admission_effect: "none",
    review_effect: "none",
    lifecycle_effect: "none",
    receipts_by_target: Object.freeze(receiptsByTarget),
    evidence_by_target: Object.freeze(evidenceByTarget)
  });
}

export {
  VERIFY_PROOF_EXECUTION_FAILURE_CODES,
  VERIFY_PROOF_EXECUTION_SCHEMA_VERSION,
  VerifyProofExecutionError,
  executeVerifyProofReceiptPopulation
};
