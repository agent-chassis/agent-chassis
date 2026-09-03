import type {
  ControlledContractCarrierKind, ControlledContractCarrierPatchOperation
} from "./current-carrier-patch.mjs";

export type ProofGraphCarrierOperation =
  | ({ kind: "carrier_patch"; carrier_kind: ControlledContractCarrierKind } &
      Partial<ControlledContractCarrierPatchOperation>)
  | {
      kind: "verification_bundle";
      op: "upsert" | "remove";
      verification_id: string;
      bundle: Record<string, unknown>;
    };

/**
 * One server-owned present/absent source expectation. Source authority is
 * derived from authenticated canonical state by the server owner; this shape is
 * never a proposal field and a caller never authors it.
 */
export interface ProofGraphExpectedSource {
  carrier_kind: ControlledContractCarrierKind;
  presence: "present" | "absent";
  expected_content_digest: string | null;
}

export interface ControlledProofGraphProposal {
  schema_version: "controlled-proof-graph-proposal.v1";
  wk_id: string;
  focus: string | null;
  contract_content_digest: string;
  selected_pack: { profile_id: string; profile_version: string };
  requested_intents: string[];
  skeleton_continuation: {
    continuation: Record<string, unknown>;
    unresolved_required_roles: Array<Record<string, unknown>>;
  };
  carrier_operations: ProofGraphCarrierOperation[];
}

export interface AdmittedControlledProofGraphProposal
  extends ControlledProofGraphProposal {
  routes: ReadonlyArray<{
    kind: "carrier_patch" | "verification_bundle";
    index: number;
    carrier_kind: ControlledContractCarrierKind;
  }>;
  addressed_carrier_kinds: readonly ControlledContractCarrierKind[];
  server_projection: Record<string, unknown>;
  projection_bytes: number;
  operation_count: number;
  carrier_patch_operation_count: number;
  verification_bundle_operation_count: number;
}

export const PROOF_GRAPH_PROPOSAL_SCHEMA_VERSION:
  "controlled-proof-graph-proposal.v1";
export const PROOF_GRAPH_PROPOSAL_FIELDS: readonly string[];
export const PROOF_GRAPH_PROPOSAL_LIMITS: Readonly<{
  carrier_operations: 64;
  projection_bytes: 1048576;
}>;
export const PROOF_GRAPH_CARRIER_KINDS:
  readonly ControlledContractCarrierKind[];
export const PROOF_GRAPH_OPERATION_KINDS:
  readonly ("carrier_patch" | "verification_bundle")[];
export class ProofGraphProposalError extends Error {
  code: string;
  details: Record<string, unknown>;
}
export function projectProofGraphProposal(
  proposal: ControlledProofGraphProposal
): Record<string, unknown>;
export function measureProofGraphProposalBytes(
  serverProjection: Record<string, unknown>
): number;
export function validateProofGraphProposal(
  proposal: ControlledProofGraphProposal
): Readonly<AdmittedControlledProofGraphProposal>;

export interface ProofGraphProspectiveCarrier {
  carrier_kind: ControlledContractCarrierKind;
  presence_before: "present" | "absent";
  presence_after: "present";
  changed: boolean;
  content: Record<string, unknown>;
  canonical_bytes: string;
  byte_length: number;
  content_digest: string;
  prior_content_digest: string | null;
}

export interface ProofGraphCrossCarrierBinding {
  semantic_key: string;
  reference_id: string;
  type_term: string | null;
  identity_kind: string | null;
  contract_pointer: string;
  evaluation_input_pointers: string[];
}

export interface ProofGraphUnresolvedPointer {
  carrier_kind: ControlledContractCarrierKind | null;
  pointer: string;
  reason: string;
  role?: string | null;
}

export interface ControlledProofGraphCompositionResult {
  schema_version: "controlled-proof-graph-composition.v1";
  status: "composed" | "incomplete";
  reason_code: null | "controlled_contract_proof_graph_proposal_incomplete";
  wk_id: string;
  focus: string | null;
  selected_pack: { profile_id: string; profile_version: string };
  requested_intents: string[];
  contract_content_digest: string;
  proposal_operation_count: number;
  proposal_projection_bytes: number;
  permitted_cross_carrier_join: Readonly<Record<string, string>>;
  counts: Readonly<Record<string, number>>;
  carriers: ProofGraphProspectiveCarrier[];
  manifest_inputs: Array<{
    carrier_kind: ControlledContractCarrierKind;
    presence_before: "present" | "absent";
    content_digest: string;
    byte_length: number;
  }>;
  cross_carrier_bindings: ProofGraphCrossCarrierBinding[];
  delegated_validations: string[];
  proof_plan_digest: string | null;
  /**
   * Why the whole-request proof plan was or was not derived. The carrier set
   * holds one evaluation input, so a request that already selects other packs
   * names them here instead of refusing or silently reporting no plan.
   */
  proof_plan_derivation: Readonly<{
    status: "derived" | "carrier_set_incomplete" |
      "selected_pack_evaluation_input_outside_carrier_set";
    derived_from_evaluation_input_paths: string[];
    unavailable_selected_packs: Array<{
      profile_id: string | null;
      profile_version: string | null;
      evaluation_input_path: string | null;
    }>;
  }>;
  unresolved_pointers: ProofGraphUnresolvedPointer[];
  no_op: boolean;
  authority: "non_authoritative";
  carriers_written: false;
  semantics_chosen: false;
  proof_claimed: false;
  dispatch_authorized: false;
}

export const PROOF_GRAPH_COMPOSITION_SCHEMA_VERSION:
  "controlled-proof-graph-composition.v1";
export const PROOF_GRAPH_CARRIER_ORDER:
  readonly ControlledContractCarrierKind[];
export const PROOF_GRAPH_PERMITTED_CROSS_CARRIER_JOIN:
  Readonly<Record<string, string>>;
export const PROOF_GRAPH_FORBIDDEN_CROSS_CARRIER_JOIN_TARGETS:
  Readonly<Record<string, string>>;
export class ProofGraphCompositionError extends Error {
  code: string;
  details: Record<string, unknown>;
}
export function composeProofGraphCarrierSet(input: {
  proposal: ControlledProofGraphProposal;
  /**
   * The server-owned source declaration, derived by its single wiki-core owner
   * from the validated skeleton and the authenticated canonical carrier
   * identities. Composition consumes it and derives no source authority of its
   * own; a caller never authors it and it is never a proposal field.
   */
  expected_sources: readonly ProofGraphExpectedSource[];
  sources?: Partial<Record<
    ControlledContractCarrierKind, Record<string, unknown>
  >> | null;
}): Promise<Readonly<ControlledProofGraphCompositionResult>>;
