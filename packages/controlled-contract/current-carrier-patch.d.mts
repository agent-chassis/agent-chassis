export type ControlledContractCarrierKind =
  "contract" | "evaluation_input" | "proof_plan_request";

export interface ControlledContractCarrierPatchOperation {
  op: "upsert" | "remove";
  target: string;
  id?: string;
  value?: unknown;
}

export const CONTROLLED_CONTRACT_CARRIER_PATCH_LIMITS: Readonly<{
  operations: 64;
  operation_bytes: 16384;
  request_bytes: 65536;
}>;
export const CONTROLLED_CONTRACT_CARRIER_TARGETS: Readonly<
  Record<ControlledContractCarrierKind, Readonly<Record<string, string>>>
>;
export function carrierValueId(
  target: string, rule: string, value: unknown
): unknown;
export function carrierPatchRequestProjection(
  carrierKind: string,
  operations: readonly ControlledContractCarrierPatchOperation[]
): { carrier_kind: string; operations: readonly ControlledContractCarrierPatchOperation[] };
export function applyControlledContractCarrierPatch(input: {
  content: Record<string, unknown>;
  carrierKind: string;
  operations: readonly ControlledContractCarrierPatchOperation[];
}): Readonly<{ content: Record<string, unknown> }>;
