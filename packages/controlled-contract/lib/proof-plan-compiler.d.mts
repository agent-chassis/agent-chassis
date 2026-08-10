import type { ProofPlan } from "./multi-pack-assessment.d.mts";

export interface ProofPlanCompilerRequest {
  schema_version: "controlled-contract-proof-plan-request.v1";
  requested_intents: string[];
  selected_packs: Array<{
    profile_id: string;
    profile_version: string;
    evaluation_input_path?: string;
    exact_capture?: null | {
      capture_root?: string;
      contract_path?: string;
      evaluation_input_path?: string;
      sources?: Record<string, unknown>;
    };
  }>;
}

export class ProofPlanCompilerError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export const MAX_PROOF_PLAN_BYTES: 131072;
export function buildProofPlan(input: {
  contract: Record<string, unknown>;
  request: ProofPlanCompilerRequest;
  evaluationInputs?: Record<string, Record<string, unknown>>;
}): Promise<Readonly<ProofPlan>>;
export function buildProofPlanFiles(input: {
  inputPath: string;
  requestPath: string;
}): Promise<Readonly<ProofPlan>>;
export function canonicalProofPlanJson(plan: ProofPlan): string;
export function validateProofPlanRequest(value: unknown): boolean;
