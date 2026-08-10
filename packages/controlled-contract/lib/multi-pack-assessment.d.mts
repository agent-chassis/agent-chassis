import type { ProofIntentDigests } from "./proof-intent-selection.d.mts";

export interface ProofPlanPackRequest {
  profile_id: string;
  profile_version: string;
  requested_intents: string[];
  evaluation_input: null | { path: string };
  exact_binding: null | {
    capture_root: string;
    contract_path: string;
    evaluation_input_path: string;
    sources: Record<string, unknown>;
  };
  source_digests: Record<string, string | null>;
}

export interface ProofPlan {
  schema_version: "controlled-contract-proof-plan.v1";
  requested_intents: string[];
  digests: Omit<ProofIntentDigests, "algorithm"> & { contract: string };
  packs: ProofPlanPackRequest[];
}

export interface MultiPackAssessment {
  schema_version: "controlled-contract-multi-pack-assessment.v1";
  assessment_identity: string;
  requested_proof_intents: string[];
  selected_pack_count: number;
  evaluated_pack_count: number;
  structure: "proven" | "not_proven" | "invalid";
  profile_discrimination: "proven" | "not_proven" | "not_assessed";
  exact_binding: "proven" | "not_proven" | "not_assessed";
  assessment_scope: "planning";
  authority: "non_authoritative";
  overall_code: string;
  per_pack: Array<Record<string, unknown>>;
  diagnostics: Array<Record<string, unknown>>;
  proof_exclusions: Array<Record<string, unknown>>;
  missing_inputs: Array<Record<string, unknown>>;
  digests: Record<string, string>;
  lossless_report: { content_reference: string; files: string[] };
}

export class ProofPlanError extends Error {
  code: string;
  details: Record<string, unknown>;
}

export function assessProofPlan(input: {
  inputPath: string;
  proofPlan: ProofPlan;
  planDirectory?: string;
}): Promise<Readonly<{ assessment: MultiPackAssessment; reports: Record<string, unknown> }>>;
export function assessProofPlanFiles(input: {
  inputPath: string;
  proofPlanPath: string;
}): Promise<Readonly<{ assessment: MultiPackAssessment; reports: Record<string, unknown> }>>;
export function compactMultiPackAssessment(
  assessment: MultiPackAssessment
): Readonly<Record<string, unknown>>;
export function writeMultiPackAssessmentBundle(
  projected: Readonly<{
    assessment: MultiPackAssessment;
    reports: Record<string, unknown>;
  }>,
  options: { repositoryRoot: string }
): Promise<Readonly<{
  reused: boolean;
  directory: string;
  content_reference: string;
}>>;
