

const loadClassifyControlledAcceptanceStateOperation = async () => (
  await import("@agent-chassis/wiki-core/src/operations/controlled-contract.mjs")
).classifyControlledAcceptanceStateOperation;
import { loadWorkRecordById } from
  "@agent-chassis/wiki-core/src/lib/work-record-store.mjs";
import { assertControlledAcceptanceStateProjection } from
  "@agent-chassis/wiki-core/src/lib/work-record-proof-posture.mjs";
import { coverageUnitAddress } from
  "@agent-chassis/wiki-core/src/lib/controlled-contract-unit-address.mjs";
import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";
import { MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES } from
  "./worktree-provisioning-dispatch-managed.mjs";

const proofAuthoringRecovery = (wkId, sliceId = null) => Object.freeze({
  tool: "workspace_controlled_contract_obligation_coverage_query",
  arguments: Object.freeze({ unit: coverageUnitAddress({ wkId, selectedUnit: sliceId }) }),
  follow_up_tool: "workspace_controlled_contract_obligation_coverage_upsert"
});

function refusal({ subject, state = null, reason, code, recovery, cause = null }) {
  return Object.freeze({
    ok: false,
    refusal: Object.freeze({
      code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      reason,
      detail: Object.freeze({
        subject,
        ...(state === null ? {} : { controlled_acceptance_state: state }),
        cause: cause ?? Object.freeze({
          type: "controlled_acceptance_structural_failure",
          code
        }),
        recovery
      })
    })
  });
}

export async function preflightManagedControlledAcceptance({
  worktreeProvisioningConfig, subject
} = {}) {
  if (worktreeProvisioningConfig === null) return Object.freeze({ ok: true });
  const wkId = typeof subject === "string" ? subject.split("#", 1)[0] : null;
  const sliceId = typeof subject === "string" && subject.includes("#")
    ? subject.slice(subject.indexOf("#") + 1) : null;
  const sourceRefusal = (error) => {
    const sourceCode = typeof error?.code === "string"
      ? error.code : "controlled_acceptance_proof_posture_invalid";
    return refusal({
      subject,
      reason: sourceCode,
      code: MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.PROOF_POSTURE_INVALID,
      recovery: proofAuthoringRecovery(wkId, sliceId),
      cause: Object.freeze({
        type: "controlled_acceptance_source_failure",
        code: sourceCode,
        structural_code:
          MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.PROOF_POSTURE_INVALID,
        details: Object.freeze(structuredClone(error?.details ?? {}))
      })
    });
  };
  let record, selected;
  try {
    const loaded = await loadWorkRecordById({
      dir: worktreeProvisioningConfig.mainRepo, id: wkId
    });
    selected = sliceId === null
      ? loaded.record
      : loaded.record.slices?.find(({ id }) => id === sliceId) ?? null;
    if (loaded.record?.id !== wkId || selected === null) {
      throw new Error("canonical unit invalid");
    }
    record = loaded.record;
  } catch (error) {
    return sourceRefusal(error);
  }
  if (selected.work_kind !== "implementation") return Object.freeze({ ok: true });

  const classify = worktreeProvisioningConfig.deps?.classifyControlledAcceptanceState
    ?? await loadClassifyControlledAcceptanceStateOperation();
  let state;
  try {

    state = await classify({ repoRoot: worktreeProvisioningConfig.mainRepo, wkId,
      selectedUnit: sliceId, record });
  } catch (error) {
    return sourceRefusal(error);
  }
  try {
    assertControlledAcceptanceStateProjection(state, wkId, sliceId);
  } catch {
    return refusal({
      subject,
      reason: "controlled_acceptance_proof_posture_invalid",
      code: MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.PROOF_POSTURE_INVALID,
      recovery: proofAuthoringRecovery(wkId, sliceId)
    });
  }

  if (state.semantic.admission.admits) {
    return Object.freeze({ ok: true, controlled_acceptance_state: state });
  }
  const absent = state.semantic.admission.blocked_reason_code ===
    "controlled_acceptance_disposition_missing";
  return refusal({
    subject,
    state,
    reason: absent
      ? "controlled_acceptance_disposition_missing"
      : "controlled_acceptance_incomplete",
    code: absent
      ? MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.DISPOSITION_MISSING
      : MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.CONTROLLED_ACCEPTANCE_INCOMPLETE,
    recovery: state.recovery
  });
}
