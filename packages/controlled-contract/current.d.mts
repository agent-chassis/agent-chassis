export {
  assessContractFiles,
  assessExactBoundContractFiles,
  assessStructuralContractFile,
  compactAssessmentOutput
} from "./lib/contract-assessment.mjs";

export {
  ProofPlanError,
  assessProofPlan,
  assessProofPlanFiles,
  compactMultiPackAssessment,
  writeMultiPackAssessmentBundle
} from "./lib/multi-pack-assessment.mjs";

export {
  MAX_DISCOVERY_QUERY_BYTES,
  MAX_DISCOVERY_RESULT_BYTES,
  MAX_DISCOVERY_RETURNED_INTENTS,
  PROOF_INTENT_DISCOVERY_CATALOG,
  PROOF_INTENT_DISCOVERY_CATALOG_DIGEST,
  ProofIntentDiscoveryError,
  canonicalProofIntentDiscoveryJson,
  discoverProofIntents
} from "./lib/proof-intent-discovery.mjs";

export {
  MAX_BINDING_ASSISTANCE_BYTES,
  ProofPackBindingAssistanceError,
  canonicalProofPackBindingAssistanceJson,
  inspectProofPackBindings
} from "./lib/proof-pack-binding-assistance.mjs";

export function inspectProofPackBindingsPage(input: {
  contract: Record<string, unknown>; profileId: string; profileVersion: string;
  requestedIntents?: string[] | null;
  evaluationInput?: Record<string, unknown> | null;
  roles?: string[]; statuses?: string[];
  offset?: number; maximumItems?: number;
}): Promise<Readonly<Record<string, unknown>>>;

export {
  MAX_PROOF_PLAN_BYTES,
  ProofPlanCompilerError,
  buildProofPlan,
  buildProofPlanFiles,
  canonicalProofPlanJson
} from "./lib/proof-plan-compiler.mjs";

export {
  PROOF_INTENT_ARTIFACT,
  PROOF_INTENT_DIGESTS,
  MAX_AUTHORING_PROJECTION_BYTES,
  ProofIntentSelectionError,
  compactProofIntentSelection,
  describeProofPackAuthoring,
  selectProofPacks
} from "./lib/proof-intent-selection.mjs";

export const NATIVE_CONTRACT_SCHEMA_V034: Readonly<Record<string, unknown>>;
export const PROFILE_ID_V034: string;
export const SCHEMA_VERSION_V034: string;
export const VOCABULARY_VERSION_V034: string;
export function buildNativeContractSchemaV034(...args: unknown[]): unknown;
export function controlledComplementV034(...args: unknown[]): unknown;
export function validateAndResolveNativeContractV034(...args: unknown[]): unknown;

export const EVALUATION_INPUT_VERSION_V034: string;
export const PROFILE_SCHEMA_VERSION_V034: string;
export const RESULT_VERSION_V034: string;
export const VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034:
  Readonly<Record<string, unknown>>;
export const VERIFICATION_PROFILE_RESULT_SCHEMA_V034:
  Readonly<Record<string, unknown>>;
export const VERIFICATION_PROFILE_SCHEMA_V034:
  Readonly<Record<string, unknown>>;
export function evaluateVerificationProfileV034(...args: unknown[]): unknown;
export function profileDigestV034(...args: unknown[]): string;
export function validateProfileSchemaV034(...args: unknown[]): boolean;
export function validateProfileSemanticsV034(...args: unknown[]): unknown;

export const CONTROLLED_VOCABULARY: Readonly<Record<string, unknown>>;
export const VOCABULARY_DIGESTS: Readonly<Record<string, string>>;
export function buildAdvisoryVocabularyView(...args: unknown[]): unknown;
export function describeVocabularyTerms(...args: unknown[]): unknown;
export function searchVocabulary(...args: unknown[]): unknown;
export function validateVocabulary(...args: unknown[]): unknown;

export class AdmittedProofPackError extends Error {
  code: string;
  details: Record<string, unknown>;
}
export function loadAdmittedProofPack(
  profileId: string
): Promise<Readonly<Record<string, unknown>>>;
export function readProofPackCatalog():
  Promise<Readonly<Record<string, unknown>>>;
