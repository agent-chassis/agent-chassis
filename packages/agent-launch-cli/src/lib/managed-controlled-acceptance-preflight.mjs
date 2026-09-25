

const loadClassifyControlledAcceptanceStateOperation = async () => (
  await import("@agent-chassis/wiki-core/src/operations/controlled-contract.mjs")
).classifyControlledAcceptanceStateOperation;
import { loadWorkRecordById } from
  "@agent-chassis/wiki-core/src/lib/work-record-store.mjs";
import { assertControlledAcceptanceStateProjection } from
  "@agent-chassis/wiki-core/src/lib/work-record-proof-posture.mjs";
import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";
import { MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES } from
  "./worktree-provisioning-dispatch-managed.mjs";

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
  const systemOwnerRefusal = (error, responsibleOwner) => {
    const sourceCode = typeof error?.code === "string"
      ? error.code : "controlled_acceptance_internal_failure";
    return refusal({
      subject,
      reason: sourceCode,
      code: MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.PROOF_POSTURE_INVALID,
      recovery: null,
      cause: Object.freeze({
        type: "controlled_acceptance_system_owner_failure",
        code: sourceCode,
        ownership: "system",
        responsible_owner: responsibleOwner,
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
      throw Object.assign(new Error("canonical unit invalid"), {
        code: "controlled_acceptance_selected_unit_absent"
      });
    }
    record = loaded.record;
  } catch (error) {
    return systemOwnerRefusal(error, "managed-controlled-acceptance-source");
  }
  if (selected.work_kind !== "implementation") return Object.freeze({ ok: true });

  const classify = worktreeProvisioningConfig.deps?.classifyControlledAcceptanceState
    ?? await loadClassifyControlledAcceptanceStateOperation();
  let state;
  try {

    state = await classify({ repoRoot: worktreeProvisioningConfig.mainRepo, wkId,
      selectedUnit: sliceId, record });
  } catch (error) {
    return systemOwnerRefusal(error, "classifyControlledAcceptanceStateOperation");
  }
  try {
    assertControlledAcceptanceStateProjection(state, wkId, sliceId);
  } catch (error) {
    const projectionError = new Error(error?.message ??
      "controlled-acceptance state projection is invalid", { cause: error });
    projectionError.code = "controlled_acceptance_state_projection_invalid";
    projectionError.details = structuredClone(error?.details ?? {});
    return systemOwnerRefusal(projectionError,
      "assertControlledAcceptanceStateProjection");
  }

  if (state.semantic.admission.admits) {
    return Object.freeze({ ok: true, controlled_acceptance_state: state });
  }
  const absent = state.semantic.admission.blocked_reason_code ===
    "controlled_acceptance_disposition_missing";
  const blockedReason = state.semantic.admission.blocked_reason_code;
  const sourceNotCurrent = blockedReason === "controlled_acceptance_source_not_current";
  return refusal({
    subject,
    state,
    reason: blockedReason,
    code: absent
      ? MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.DISPOSITION_MISSING
      : sourceNotCurrent
        ? MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES
          .CONTROLLED_ACCEPTANCE_SOURCE_NOT_CURRENT
        : MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES.CONTROLLED_ACCEPTANCE_INCOMPLETE,
    recovery: state.recovery,
    ...(sourceNotCurrent ? { cause: Object.freeze({
      type: "controlled_acceptance_source_failure",
      code: blockedReason,
      structural_code: MANAGED_CONTROLLED_CONTRACT_GENERATION_DIAGNOSTIC_CODES
        .CONTROLLED_ACCEPTANCE_SOURCE_NOT_CURRENT
    }) } : {})
  });
}
