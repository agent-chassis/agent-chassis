

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assessTestProofContract,
  classifyStableTestProofRuntimeReadiness
} from "@agent-chassis/controlled-contract";
import { readControlledContractCarrierFile } from "@agent-chassis/wiki-core";
import {
  readCanonicalWorkRecord
} from "@agent-chassis/agent-launch-cli/src/lib/backend-worker-scope-authority.mjs";
import {
  assertIntegratedTestProofRuntimeCurrent,
  mintIntegratedWkTestProofRuntimeAuthority
} from
  "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-integrated-test-proof-runtime.mjs";
import { TerminalReviewMaterializationError } from
  "@agent-chassis/agent-launch-cli/src/lib/terminal-review-materialization.mjs";
import {
  declaredValidationBindings,
  executeTestProofReceiptsWithAuthority
} from "./dispatch-terminal-candidate-coordinator.mjs";
import {
  collectAuthorizedNodeTestTargets,
  parseNodeTestUnitAddress,
  resolveNodeTestUnitSections
} from "./work-record-node-test-validation.mjs";
import { MCP_WRITE_SEMANTICS } from "./register-tool.mjs";

export const CONTROLLED_CONTRACT_RUNTIME_PROOF_TOOL_NAME =
  "workspace_controlled_contract_runtime_prove";

export const CONTROLLED_CONTRACT_RUNTIME_PROOF_SCHEMA_VERSION =
  "controlled-contract-runtime-proof.v1";

export const CONTROLLED_CONTRACT_RUNTIME_PROOF_REFUSAL_CODES = Object.freeze({
  INPUT_INVALID: "controlled_contract_runtime_proof_input_invalid",
  FOCUS_UNSUPPORTED: "controlled_contract_runtime_proof_focus_unsupported",
  LIFECYCLE_REFUSED: "controlled_contract_runtime_proof_lifecycle_refused",
  RECORD_UNRESOLVED: "controlled_contract_runtime_proof_record_unresolved",
  TARGET_POPULATION_EMPTY: "controlled_contract_runtime_proof_target_population_empty",
  VERIFICATION_POPULATION_EMPTY:
    "controlled_contract_runtime_proof_verification_population_empty",
  CARRIER_REFUSED: "controlled_contract_runtime_proof_carrier_refused",
  READINESS_REFUSED: "controlled_contract_runtime_proof_readiness_refused",
  EXECUTION_REFUSED: "controlled_contract_runtime_proof_execution_refused",
  ASSESSMENT_REFUSED: "controlled_contract_runtime_proof_assessment_refused",
  MATERIALIZATION_REFUSED: "controlled_contract_runtime_proof_materialization_refused"
});

export class ControlledContractRuntimeProofError extends Error {
  constructor(code, message, {
    cause = null,
    detail = null,
    authorityLimb = null
  } = {}) {
    super(message);
    this.name = "ControlledContractRuntimeProofError";
    this.code = code;
    this.envelope = Object.freeze({
      schema_version: CONTROLLED_CONTRACT_RUNTIME_PROOF_SCHEMA_VERSION,
      status: "refused",
      assessment_scope: "runtime",
      authority: "non_authoritative",
      ...(authorityLimb === null ? {} : { authority_limb: authorityLimb }),
      code,
      message,
      ...(detail === null ? {} : { detail }),
      owner_code: cause?.code ?? null,
      owner_diagnostics: cause?.diagnostics ?? cause?.detail ?? null
    });
    if (cause != null) this.cause = cause;
  }
}

function refuse(code, message, options = {}) {
  throw new ControlledContractRuntimeProofError(code, message, options);
}

const EXACT_SLICE_UNIT_RE = /^WK-[0-9]{4}#SLICE-[0-9]{3}$/u;

export function classifyCompleteRuntimeProofReadiness(contract, wkId) {
  const results = (contract?.test_proofs ?? []).map((binding) => ({
    verification_id: binding.verification_claim_id,
    readiness: classifyStableTestProofRuntimeReadiness(binding)
  }));
  const nonready = results.filter(({ readiness }) => readiness.status !== "ready");
  return Object.freeze({
    status: nonready.length === 0 ? "ready" : "not_ready",
    binding_total: results.length,
    nonready_total: nonready.length,
    nonready_bindings: Object.freeze(nonready.map(({ verification_id: verificationId,
      readiness }) => {
      const candidates = readiness.current_test_ids.slice(0, 16);
      return Object.freeze({
        verification_id: verificationId,
        reason: readiness.reason,
        selected_test_id: readiness.selected_test_id,
        candidate_test_ids: Object.freeze(candidates),
        candidate_total: readiness.candidate_total,
        candidate_test_ids_omitted: readiness.candidate_total - candidates.length,
        recovery_operation: "workspace_controlled_test_proof_patch",
        complete_retrieval: Object.freeze({
          tool: "workspace_controlled_test_proof_query",
          arguments: Object.freeze({ wk_id: wkId, verification_ids: [verificationId] })
        })
      });
    }))
  });
}

function boundedReceiptIdentity(receipt) {
  return Object.freeze({
    evidence_id: receipt.evidence_identity.evidence_id,
    verification_id: receipt.evidence_identity.verification_id,
    test_id: receipt.evidence_identity.test_id,
    command_id: receipt.evidence_identity.command_id,
    command_target: receipt.evidence_identity.command_target,
    attempt: receipt.evidence_identity.attempt,
    source_snapshot_digest: receipt.evidence_identity.source_snapshot_digest,
    execution_status: receipt.execution_result.status
  });
}

export async function runControlledContractRuntimeProof({
  repoRoot,
  unit,
  focus = null,
  runtimeRoot = null
} = {}) {
  if (typeof repoRoot !== "string" || !path.isAbsolute(repoRoot)) refuse(
    CONTROLLED_CONTRACT_RUNTIME_PROOF_REFUSAL_CODES.INPUT_INVALID,
    "runtime proof requires one resolved workspace repository");
  if (typeof unit !== "string" || !EXACT_SLICE_UNIT_RE.test(unit)) refuse(
    CONTROLLED_CONTRACT_RUNTIME_PROOF_REFUSAL_CODES.INPUT_INVALID,
    "runtime proof selects one exact integrated implementation slice",
    { detail: { unit: typeof unit === "string" ? unit : null } });

  if (focus !== null && focus !== undefined) refuse(
    CONTROLLED_CONTRACT_RUNTIME_PROOF_REFUSAL_CODES.FOCUS_UNSUPPORTED,
    "post-integration runtime proof binds the same-WK root controlled-contract generation",
    { detail: { focus } });

  const ownedRuntimeRoot = runtimeRoot === null
    ? mkdtempSync(path.join(os.tmpdir(), "controlled-contract-runtime-proof-"))
    : runtimeRoot;
  try {
    return await mintIntegratedWkTestProofRuntimeAuthority({
      mainRepo: repoRoot,
      unit,
      checkoutRoot: path.join(ownedRuntimeRoot, "private")
    }, async ({ authority, lifecycle, checkout }) => {
      const { sliceId } = parseNodeTestUnitAddress(unit);
      const record = readCanonicalWorkRecord(checkout.checkout_path, unit);
      const selectedUnit = record === null ? null : resolveNodeTestUnitSections(record, sliceId);
      if (selectedUnit === null) refuse(
        CONTROLLED_CONTRACT_RUNTIME_PROOF_REFUSAL_CODES.RECORD_UNRESOLVED,
        "the integrated tip carries no canonical work contract for the exact slice",
        { detail: { unit } });
      const targets = [...collectAuthorizedNodeTestTargets(selectedUnit)].sort();
      if (targets.length === 0) refuse(
        CONTROLLED_CONTRACT_RUNTIME_PROOF_REFUSAL_CODES.TARGET_POPULATION_EMPTY,
        "the exact slice declares no authorized node_test target to execute",
        { detail: { unit } });
      const validationBindings = declaredValidationBindings(selectedUnit);
      const verificationCount = targets.reduce(
        (count, target) => count + (validationBindings[target]?.length ?? 0), 0);
      if (verificationCount === 0) refuse(
        CONTROLLED_CONTRACT_RUNTIME_PROOF_REFUSAL_CODES.VERIFICATION_POPULATION_EMPTY,
        "the exact slice binds no verification identity to its declared targets",
        { detail: { unit, targets } });

      let carrier;
      try {
        carrier = await readControlledContractCarrierFile({
          repoRoot: checkout.checkout_path,
          wkId: lifecycle.state.record_id,
          focus: null,
          carrierKind: "contract"
        });
      } catch (error) {
        refuse(CONTROLLED_CONTRACT_RUNTIME_PROOF_REFUSAL_CODES.CARRIER_REFUSED,
          "the integrated tip carries no canonical controlled-contract to assess",
          { cause: error });
      }

      const readiness = classifyCompleteRuntimeProofReadiness(
        carrier.content, lifecycle.state.record_id
      );
      if (readiness.status !== "ready") refuse(
        CONTROLLED_CONTRACT_RUNTIME_PROOF_REFUSAL_CODES.READINESS_REFUSED,
        "the exact integrated root carrier cannot mint one complete runtime receipt population",
        { detail: readiness, authorityLimb: "mechanical_failure" }
      );

      let executed;
      try {
        executed = await executeTestProofReceiptsWithAuthority({
          proofAuthority: authority,
          targets,
          validationBindings,
          assertCurrentIdentity: () => assertIntegratedTestProofRuntimeCurrent(authority)
        });
      } catch (error) {
        refuse(CONTROLLED_CONTRACT_RUNTIME_PROOF_REFUSAL_CODES.EXECUTION_REFUSED,
          "the declared attempt population did not yield a complete receipt population",
          { cause: error });
      }

      const receipts = targets.flatMap((target) =>
        [...(executed.evidence_by_target[target] ?? [])]);
      const projected = targets.flatMap((target) =>
        [...(executed.receipts_by_target[target] ?? [])]);

      let assessment;
      try {
        assessment = assessTestProofContract(carrier.content, {
          runtime: { receipts }
        });
      } catch (error) {
        refuse(CONTROLLED_CONTRACT_RUNTIME_PROOF_REFUSAL_CODES.ASSESSMENT_REFUSED,
          "the authenticated receipt population did not prove runtime truth",
          { cause: error });
      }
      return Object.freeze({
        schema_version: CONTROLLED_CONTRACT_RUNTIME_PROOF_SCHEMA_VERSION,
        status: "proven",
        assessment_scope: "runtime",
        authority: "non_authoritative",
        unit,
        record_id: lifecycle.state.record_id,
        slice_id: lifecycle.state.slice_id,
        lifecycle_state: lifecycle.state.lifecycle_state,
        wk_ref: lifecycle.wk_ref,
        wk_tip: lifecycle.wk_tip,
        contract_filename: carrier.filename,
        contract_content_digest: carrier.content_digest,
        executed_targets: targets,

        assessed_verifications: assessment.assessment_identity.verifications.map(
          ({ verification_id: verificationId, test_id: testId }) => Object.freeze({
            verification_id: verificationId, test_id: testId })),
        receipt_identities: projected.map(boundedReceiptIdentity),
        assessment
      });
    });
  } catch (error) {
    if (error instanceof ControlledContractRuntimeProofError) throw error;

    if (error instanceof TerminalReviewMaterializationError) {
      refuse(CONTROLLED_CONTRACT_RUNTIME_PROOF_REFUSAL_CODES.MATERIALIZATION_REFUSED,
        "the private exact-commit checkout could not be materialized, verified, or removed",
        { cause: error });
    }
    refuse(CONTROLLED_CONTRACT_RUNTIME_PROOF_REFUSAL_CODES.LIFECYCLE_REFUSED,
      "the exact integrated slice lifecycle did not authorize a runtime proof",
      { cause: error });
    return null;
  } finally {
    if (runtimeRoot === null) rmSync(ownedRuntimeRoot, { recursive: true, force: true });
  }
}

export function registerControlledContractRuntimeProofTool({
  registerTool,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  workspaceRepos,
  focusSchema
}) {
  registerTool(
    CONTROLLED_CONTRACT_RUNTIME_PROOF_TOOL_NAME,
    {
      writeSemantics: MCP_WRITE_SEMANTICS.NONE,
      description:
        "Execute one exact integrated implementation slice's declared candidate, falsifier, and traversal population against the authenticated integrated WK tip and return a runtime-scoped controlled-contract-assessment.v3. Post-integration only: `unit` must select one integrated slice, never a whole WK. It spawns launcher-owned test processes and writes only its private checkout. The result is non-authoritative runtime evidence and is not a proof-pack authoring, selection, assessment, admission, or authority surface; `workspace_controlled_contract_assess` remains the planning-only route.",

      inputSchema: z.object({
        repo: z.string().optional(),
        unit: z.string().regex(/^WK-[0-9]{4}#SLICE-[0-9]{3}$/),
        focus: focusSchema
      }).strict()
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        return jsonContent(await runControlledContractRuntimeProof({
          repoRoot: workspace.dir,
          unit: args.unit,
          focus: args.focus ?? null
        }));
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
