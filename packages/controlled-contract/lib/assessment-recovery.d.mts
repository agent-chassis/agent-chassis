export type ControlledContractAssessmentRecoveryReasonCode =
  | "controlled_contract_proof_plan_request_missing"
  | "controlled_contract_evaluation_input_missing"
  | "controlled_contract_proof_plan_missing"
  | "controlled_contract_proof_plan_stale";

export interface ControlledContractAssessmentRecoveryIdentity {
  carrier_kind: "contract";
  wk_id: string;
  focus: string | null;
  content_digest: string;
}

export interface ControlledContractAssessmentRecoveryInput {
  reasonCode: ControlledContractAssessmentRecoveryReasonCode;
  contractIdentity: ControlledContractAssessmentRecoveryIdentity;
  staleContentDigest?: string;
}

export class ControlledContractAssessmentRecoveryError extends Error {
  code: "controlled_contract_assessment_recovery_invalid";
}

export function buildControlledContractAssessmentRecovery(
  input: ControlledContractAssessmentRecoveryInput
): Readonly<Record<string, unknown>>;
