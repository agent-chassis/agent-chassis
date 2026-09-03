export type ControlledContractRefactorMode =
  | { readonly kind: "rename_identity"; readonly old_identity: string;
      readonly new_identity: string; readonly old_node?: unknown;
      readonly new_node?: unknown }
  | { readonly kind: "replace_subgraph";
      readonly correspondence: readonly { readonly old_identity: string | null;
        readonly new_identities: readonly string[] }[];
      readonly reason: string; readonly carrier_operations?: readonly unknown[] };
export interface ControlledContractRefactorCarrier {
  readonly carrier_kind: string; readonly content: unknown;
  readonly content_digest?: string; readonly generation_id?: string | null;
  readonly current?: boolean; readonly mutable?: boolean;
}
export class ControlledContractRefactorError extends Error {
  readonly code: string; readonly limb: "mechanical_failure";
  readonly owner: "controlled_contract_refactor_graph";
  readonly deciding_facts: readonly unknown[]; readonly would_break: string;
  readonly recovery: unknown; readonly details: Readonly<Record<string, unknown>>;
}
export const REFACTOR_GRAPH_SCHEMA_VERSION: "controlled-contract-refactor-graph.v1";
export const REFACTOR_MODES: readonly ["rename_identity", "replace_subgraph"];
export const REFACTOR_GRAPH_LIMITS: Readonly<Record<string, number>>;
export function buildControlledContractRefactorClosure(request: {
  readonly live_carriers: readonly ControlledContractRefactorCarrier[] |
    Readonly<Record<string, unknown>>;
  readonly mode: ControlledContractRefactorMode;
}): Readonly<Record<string, unknown>>;
export const planControlledContractRefactor: typeof buildControlledContractRefactorClosure;
