import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const _TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../templates"
);

const _ADOPTION_SEED_SOURCE = JSON.parse(
  readFileSync(path.join(_TEMPLATES_DIR, "IN-0001.adoption-seed.json"), "utf8")
);

export function getStaticIn0001AdoptionSeed() {
  return JSON.parse(JSON.stringify(_ADOPTION_SEED_SOURCE));
}

export function renderStaticIn0001AdoptionSeedMarkdown(
  seed = getStaticIn0001AdoptionSeed()
) {
  return `# ${seed.title}\n\n${seed.summary}\n`;
}

export { getContractDir, loadManifest, readContractFile } from "./lib/contract.mjs";
export {
  SIDECAR_ARTIFACT_SCHEMA_FIELD,
  SIDECAR_ARTIFACT_SCHEMA_VERSION,
  SIDECAR_CANONICALITY_VALUES,
  SIDECAR_DIRTY_DETAIL_FIELDS,
  SIDECAR_DIRTY_STATE_VALUES,
  SIDECAR_ENVELOPE_REQUIRED_FIELDS,
  SIDECAR_EVIDENCE_BASIS_VALUES,
  SIDECAR_PROVENANCE_REQUIRED_FIELDS,
  SIDECAR_RESULT_ITEM_REQUIRED_FIELDS,
  SIDECAR_RESULT_SCHEMA_FIELD,
  SIDECAR_SCHEMA_VERSION,
  SIDECAR_SOURCE_KIND_VALUES,
  SIDECAR_STALENESS_VALUES,
  SIDECAR_TRUST_ENVELOPE_FIXTURES,
  assertValidSidecarResultEnvelope,
  classifySidecarArtifactSchema,
  cloneSidecarTrustEnvelopeFixture,
  createSidecarDirtyDetails,
  createSidecarResultEnvelope,
  isSupportedSidecarArtifactSchema,
  isSupportedSidecarSchemaVersion,
  validateSidecarResultEnvelope
} from "./lib/sidecar-schema.mjs";
export {
  SIDECAR_DIRTY_GRAPH_MODE_VALUES,
  SIDECAR_GRAPH_EDGE_KIND_VALUES,
  SIDECAR_GRAPH_EDGE_REQUIRED_FIELDS,
  SIDECAR_GRAPH_EDGE_SOURCE_VALUES,
  SIDECAR_GRAPH_NODE_KIND_VALUES,
  SIDECAR_GRAPH_NODE_REQUIRED_FIELDS,
  SIDECAR_GRAPH_SCHEMA_FIELD,
  SIDECAR_GRAPH_SCHEMA_VERSION,
  SIDECAR_GRAPH_SECTION_FIELD,
  SIDECAR_GRAPH_STATE_REQUIRED_FIELDS,
  SIDECAR_MISSING_UPDATE_HINT_REQUIRED_FIELDS,
  SIDECAR_STRUCTURAL_IMPACT_REQUIRED_FIELDS,
  classifySidecarGraphArtifactSchema,
  createSidecarGraphState,
  isSupportedSidecarGraphSchemaVersion,
  validateSidecarGraphSection,
  validateSidecarGraphState
} from "./lib/sidecar-graph-schema.mjs";
export {
  SIDECAR_PARITY_REQUIRED_TRUST_FIELDS,
  SIDECAR_PARITY_SURFACE_EXPECTATIONS,
  SIDECAR_PARITY_TRANSPORTS,
  compareSidecarCliMcpParity,
  createSidecarParityFixture,
  normalizeSidecarCliJsonOutput,
  normalizeSidecarMcpStructuredContent
} from "./lib/sidecar-parity.mjs";

export {

  TOOL_DISCOVERY_FRAGMENT_DIRNAME,
  TOOL_DISCOVERY_FRAGMENT_DIR,
  TOOL_DISCOVERY_FRAGMENT_KIND,
  TOOL_DISCOVERY_MANIFEST_FILENAME,
  TOOL_DISCOVERY_MANIFEST_PATH,
  TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH,
  TOOL_DISCOVERY_MANIFEST_KIND,

  TOOL_DISCOVERY_DESCRIPTOR_FILENAME,
  TOOL_DISCOVERY_DESCRIPTOR_PATH,
  TOOL_DISCOVERY_DESCRIPTOR_RELATIVE_PATH,
  TOOL_DISCOVERY_AUTHORITY_VALUES,
  TOOL_DISCOVERY_CONTROLLED_TASK_IDS,
  TOOL_DISCOVERY_DIAGNOSTIC_CODES,
  TOOL_DISCOVERY_DIAGNOSTIC_LEVEL_VALUES,
  TOOL_DISCOVERY_ENVELOPE_REQUIRED_FIELDS,
  TOOL_DISCOVERY_INSTALL_STATE_VALUES,
  TOOL_DISCOVERY_INTERFACE_VALUES,
  TOOL_DISCOVERY_RECOMMENDED_ROUTE_VALUES,
  TOOL_DISCOVERY_RESULT_REQUIRED_FIELDS,
  TOOL_DISCOVERY_RUNTIME_POSTURE_VALUES,
  TOOL_DISCOVERY_SCHEMA_VERSION,
  TOOL_DISCOVERY_SIDE_EFFECT_VALUES,
  TOOL_DISCOVERY_SOURCE_KIND_VALUES,
  createToolDiscoveryFreshness,
  digestToolDiscoveryDescriptor,
  filterToolDiscoveryTools,
  loadToolDiscoveryDescriptor,
  normalizeToolDiscoveryDescriptor,
  rankToolDiscoveryTools,
  readToolDiscoveryDescriptorFile,
  validateToolDiscoveryDescriptor
} from "./lib/tool-discovery.mjs";
export {
  SIDECAR_CANONICAL_JOIN_FIXTURES,
  SIDECAR_CANONICAL_JOIN_MATCH_TYPES,
  SIDECAR_CANONICAL_JOIN_RANKING,
  cloneSidecarCanonicalJoinFixture,
  joinSidecarPathsToCanonicalRecords
} from "./lib/sidecar-joins.mjs";
export {
  SIDECAR_DEFAULT_ARTIFACT_FILE,
  SIDECAR_DEFAULT_CACHE_DIR,
  createSidecarStatusArtifact,
  discoverSidecarGitState,
  getSidecarIndexStatus
} from "./lib/sidecar-status.mjs";
export {
  SidecarBuildRefusalError,
  buildSidecarIndex
} from "./lib/sidecar-build.mjs";
export {
  SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS,
  getSidecarGraphImpactDiff,
  getSidecarContextForPath,
  getSidecarImpactPaths
} from "./lib/sidecar-impact.mjs";
export {
  SIDECAR_DIRTY_IGNORED_RUNTIME_PATTERNS,
  SIDECAR_FORBIDDEN_PATH_PATTERNS,
  SIDECAR_INVALID_PATH_FIXTURES,
  SIDECAR_SOURCE_PATH_FIXTURES,
  SIDECAR_UNINDEXED_SOURCE_PATTERNS,
  SidecarPathValidationError,
  filterSidecarSourcePaths,
  getForbiddenSidecarPathMatch,
  getSidecarDirtyIgnoredPathMatch,
  getUnindexedSidecarSourceMatch,
  isForbiddenSidecarSourcePath,
  isSidecarDirtyIgnoredPath,
  isUnindexedSidecarSourcePath,
  matchSidecarPathPattern,
  normalizeSidecarRepoPath,
  parseSidecarPatch,
  parseAndValidateSidecarPatch,
  validateExistingSidecarPath,
  validateParsedSidecarDiffRecords,
  validateVirtualSidecarPath
} from "./lib/sidecar-paths.mjs";
export {
  WORK_RECORD_POLICY_BLAST_RADIUS_LEVEL_VALUES,
  WORK_RECORD_POLICY_CONFIDENCE_VALUES,
  WORK_RECORD_POLICY_SURFACE_KIND_VALUES,
  classifyWorkRecordBlastRadius,
  computeWorkRecordClusters,
  createWorkRecordSplitRecommendation,
  evaluateWorkRecordPolicy,
  normalizeWorkRecordPolicyPath
} from "./lib/work-record-policy.mjs";
export {
  WORK_RECORD_ADMISSION_DECISION_CODES,
  WORK_RECORD_ADMISSION_DECISION_VALUES,
  WORK_RECORD_ADMISSION_SCHEMA_VERSION,
  createWorkRecordAdmissionEnvelope,
  evaluateWorkRecordAdmissionDerivedEvidence
} from "./lib/work-record-admission.mjs";
export {
  WORK_RECORD_DISPATCH_DECISION_CODES,
  WORK_RECORD_DISPATCH_SCHEMA_VERSION,
  WORK_RECORD_DISPATCH_UNIT_KIND_VALUES,
  LOCAL_PREFLIGHT_NON_CLAIM_CONTRACT,
  PREPARATION_AUDIT_ENVELOPE_CONTRACT,
  isBashWrapperPath,
  validateWorkRecordDispatchById,
  validateWorkRecordDispatchReadOnlyById,
  validateWorkRecordDispatchReportById
} from "./lib/work-record-dispatch.mjs";
export {
  WORK_REPORT_INGESTION_DECISION_CODES,
  ingestWorkReport
} from "./lib/work-report-ingestion.mjs";
export {
  WORK_RECORD_AGENT_ROLE_VALUES,
  WORK_RECORD_CLOSURE_FIELD_NAMES,
  WORK_RECORD_DIAGNOSTIC_CODES,
  WORK_RECORD_ESCALATION_KIND_VALUES,
  WORK_RECORD_ESCALATION_PROVENANCE_CANONICALITY_VALUES,
  WORK_RECORD_ESCALATION_PROVENANCE_EVIDENCE_BASIS_VALUES,
  WORK_RECORD_ESCALATION_PROVENANCE_SOURCE_KIND_VALUES,
  WORK_RECORD_ESCALATION_STATUS_VALUES,
  WORK_RECORD_PROJECTION_AUTHORITY,
  WORK_RECORD_PROJECTION_KIND_VALUES,
  WORK_RECORD_RECORD_KIND_VALUES,
  WORK_RECORD_RENDER_SCHEMA_VERSION,
  WORK_RECORD_SCHEMA_VERSION,
  WORK_RECORD_STATUS_VALUES,
  WORK_RECORD_TARGET_UNIT_VALUES,
  WORK_RECORD_WORK_KIND_VALUES,
  WORK_REPORT_SCHEMA_VERSION,
  WORK_REPORT_STATUS_VALUES,
  WORK_REPORT_VALIDATION_STATUS_VALUES,
  canonicalizeWorkRecordJson,
  computeWorkRecordSourceDigest,
  projectWorkRecordSourceContract,
  projectWorkRecordReviewReceiptContract,
  projectWorkRecordPrivateScopePolicyFacts,
  projectSliceReviewReceiptContracts,
  createWorkRecordDiagnostic,
  createWorkRecordValidationResult,
  isMigrationReviewAcknowledged,
  isSupportedWorkRecordSchemaVersion,
  parseWorkRecordJson,
  validateWorkRecord,
  validateWorkReport
} from "./lib/work-record-schema.mjs";
export {
  WORK_RECORD_RENDERER_NAME,
  WORK_RECORD_RENDERER_VERSION,
  WORK_RECORD_RENDER_DIAGNOSTIC_CODES,
  checkWorkRecordRenderProjectionRecord,
  checkWorkRecordRenderRecord,
  renderWorkRecordAgentBrief,
  renderWorkRecordMarkdown,
  renderWorkRecordProjection
} from "./lib/work-record-renderer.mjs";
export {
  WORK_RECORD_MIGRATION_DECISION_CODES,
  migrateWorkRecordMarkdown,
  migrateWorkRecordMarkdownById,
  migrateWorkRecordMarkdownByPath
} from "./lib/work-record-migration.mjs";
export {
  WORK_RECORD_DIRECTORY_NAME,
  buildWorkRecordDuplicateClaimsIndex,
  createWorkRecordStore,
  getWorkRecordDirectory,
  getWorkRecordPath,
  listWorkRecordJsonPaths,
  loadWorkRecordById,
  loadWorkRecordByPath
} from "./lib/work-record-store.mjs";
export { bootstrapRepo } from "./operations/bootstrap.mjs";
export { checkContractSync, syncContract } from "./operations/sync-contract.mjs";
export { allocateId } from "./operations/allocate-id.mjs";
export { createWikiRecord } from "./operations/create.mjs";
export { getWikiRecord, readWikiPage } from "./operations/read.mjs";
export {
  digestWorkRecord,
  evaluateWorkRecordAdmissionDerivedEvidenceById,
  materializeWorkRecordAdmissionDerivedEvidence,
  persistWorkRecordGraphImpactByUnit,
  readWorkRecordById,
  readWorkRecordByPath,
  refreshWorkRecordAdmissionDerivedEvidenceById,
  setWorkRecordClosureByUnit,
  setWorkRecordStatusByUnit,
  setWorkRecordTaskByUnit,
  writeValidatedWorkRecord
} from "./operations/work-records.mjs";
export {
  acceptWorkRecordEscalation,
  authorWorkRecordEscalation,
  proposeWorkRecordEscalation
} from "./operations/work-record-escalations.mjs";
export {
  validateWorkRecordDispatch,
  validateWorkRecordDispatchReport
} from "./operations/validate-dispatch.mjs";
export { createProspectiveWorkRecordStore } from "./lib/work-record-prospective-preflight-store.mjs";
export { preflightProspectiveWorkRecordDispatch } from "./operations/prospective-dispatch-preflight.mjs";
export { ingestWorkReport as ingestWorkReportOperation } from "./operations/work-report-ingestion.mjs";
export {
  checkWorkRecordRenderByPath,
  renderWorkRecordAgentBriefById,
  renderWorkRecordMarkdownById
} from "./operations/work-record-render.mjs";
export { migrateWorkRecordMarkdownOperation } from "./operations/work-record-migration.mjs";
export { lintRepo } from "./operations/lint.mjs";
export { generateViews } from "./operations/generate.mjs";
export { generateAndLint } from "./operations/generate-and-lint.mjs";
export { buildSearchIndex } from "./operations/build-search-index.mjs";
export { searchRepo } from "./operations/search.mjs";
export {
  SearchIndexUnavailableError,
  SEARCH_INDEX_DIAGNOSTIC_CODES,
  SEARCH_INDEX_DIAGNOSTIC_CONTRACT,
  SEARCH_INDEX_STATE_EXISTING,
  SEARCH_INDEX_STATE_REBUILT_IN_MEMORY,
  SEARCH_INDEX_STATE_REWRITTEN
} from "./lib/search.mjs";
export {
  DOCS_POLICY_AUDIENCE_VALUES,
  DOCS_POLICY_DIAGNOSTIC_CODES,
  DOCS_POLICY_DIAGNOSTIC_LEVEL_VALUES,
  DOCS_POLICY_SCHEMA_VERSION,
  getDocsPolicyDefaultPaths,
  isDocsPolicyDiagnosticCode,
  validateDocsPolicy,
  validateDocsPolicyMarkdown
} from "./lib/docs-policy.mjs";
export { validateDocsPolicyOperation } from "./operations/docs-policy.mjs";
export {
  WORK_RECORD_SUMMARY_SCHEMA_VERSION,
  parseWorkRecordSummaryUnit,
  summarizeWorkRecord
} from "./lib/work-record-summary.mjs";
export { getWorkRecordSummary } from "./operations/work-record-summary.mjs";
export {
  CONTROLLED_CONTRACT_ARTIFACT_FILES,
  CONTROLLED_CONTRACT_CARRIER_KINDS,
  CONTROLLED_CONTRACT_MAX_ARTIFACT_BYTES,
  CONTROLLED_CONTRACT_MAX_JSON_BYTES,
  CONTROLLED_CONTRACT_WRITABLE_CARRIER_KINDS,
  ControlledContractToolError,
  controlledContractCarrierFilename,
  normalizeControlledContractIdentity,
  readControlledContractAssessmentArtifactFile,
  readControlledContractCarrierFile,
  readControlledContractGeneration,
  queryControlledContractTestProofBindings,
  resolveControlledContractTestProofRuntimeBindings,
  writeControlledContractCarrierFile
} from "./lib/controlled-contract-tools.mjs";
export {
  deriveWorkRecordTestProofBindingFacts,
  projectWorkRecordTestProofValidation,
  resolveAuthorizedDeclaredTestTarget,
  validateWorkRecordTestProofBindings
} from "./lib/work-record-test-proof-bindings.mjs";
export {
  CONTROLLED_CONTRACT_CARRIER_SET_ARTIFACT_ROLES,
  CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_CODES,
  CONTROLLED_CONTRACT_CARRIER_SET_MANIFEST_SCHEMA_VERSION,
  ControlledContractCarrierSetManifestError,
  canonicalControlledContractCarrierSetManifestBytes,
  computeControlledContractCarrierSetManifestDigest,
  constructControlledContractCarrierSetManifest,
  controlledContractCarrierSetArtifactFilename,
  parseControlledContractCarrierSetManifest
} from "./lib/controlled-contract-carrier-set-manifest.mjs";
export {
  COMMON_PROOF_CAPTURE_CURRENTNESS_RESULTS,
  COMMON_PROOF_CAPTURE_FAMILIES,
  COMMON_PROOF_CAPTURE_FAMILY_IDS,
  COMMON_PROOF_CAPTURE_LAUNCHER_FAMILY_IDS,
  COMMON_PROOF_CAPTURE_LAUNCHER_READ_ONLY_REASON,
  COMMON_PROOF_CAPTURE_LIFECYCLE_STATES,
  COMMON_PROOF_CAPTURE_REPOSITORY_FAMILY_IDS,
  COMMON_PROOF_CAPTURE_OBSERVATION_SCHEMA_VERSION,
  COMMON_PROOF_CAPTURE_RECEIPT_IDENTITY_SCHEMA_VERSION,
  COMMON_PROOF_CAPTURE_REFUSAL_CODES,
  COMMON_PROOF_CAPTURE_SCHEMA_VERSION,
  COMMON_PROOF_CAPTURE_SELECTION_SCHEMA_VERSION,
  COMMON_PROOF_CAPTURE_STORES,
  commonProofCaptureObservation
} from "./lib/common-proof-capture-tools.mjs";
export {
  COMMON_PROOF_CAPTURE_REQUEST_KEYS,
  commonProofCaptureOperation,
  createCommonProofCaptureOperation
} from "./operations/common-proof-capture.mjs";
export {
  assessControlledContractOperation,
  buildProofPlanOperation,
  createControlledContractRefusal,
  describeProofPackOperation,
  discoverControlledProofIntentsOperation,
  inspectProofPackBindingsOperation,
  projectProofPackSelectionTaskContext,
  projectProofPackSelectionSummary,
  queryControlledVocabularyOperation,
  rebaseControlledContractAcceptanceCoverageOperation,
  rebaseControlledContractObligationCoverageOperation,
  readControlledContractAssessmentArtifactOperation,
  readControlledContractCarrierOperation,
  selectProofPacksOperation,
  writeControlledContractCarrierOperation
} from "./operations/controlled-contract.mjs";
export {
  CONTROLLED_CONTRACT_PRIVATE_PATH_MATCH_KINDS,
  CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT,
  CONTROLLED_CONTRACT_PRIVATE_SCOPE_FIELDS,
  classifyControlledContractPrivatePathEntry,
  collectControlledContractPrivateScopeIntersections,
  collectWorkRecordControlledContractPrivateScopeFacts,
  excludeControlledContractPrivatePaths
} from "./lib/controlled-contract-private-path-policy.mjs";
export { queryControlledContractPrivateScopeCensusOperation } from
  "./operations/controlled-contract.mjs";
export {
  CONTROLLED_CONTRACT_AGENT_PROJECTION_BOUNDS,
  assertControlledContractSemanticProjectionBound,
  consumeControlledContractAssessmentSnapshot,
  consumeControlledContractIntegrationAssessmentSnapshot,
  controlledContractPrettyJsonBytes,
  projectControlledContractIntegrationAssessmentPage,
  projectControlledContractIntegrationAssessmentSummary,
  projectControlledContractProofAssessmentPage,
  projectControlledContractProofAssessmentSummary
} from "./operations/controlled-contract.mjs";
export {
  AGENT_FAQ_SCHEMA_VERSION,
  AGENT_FAQ_CORPUS_FILENAME,
  AGENT_FAQ_CORPUS_RELATIVE_PATH,
  AGENT_FAQ_ACTOR_VALUES,
  loadAgentFaqCorpus,
  listAgentFaqEntries,
  getAgentFaqEntryById,
  filterAgentFaqEntriesByRelatedCode,
  getAgentFaq
} from "./operations/agent-faq.mjs";
export {
  CRASH_DURABLE_STATE_SCHEMA_VERSION,
  CRASH_DURABLE_FAULTS,
  CRASH_DURABLE_EFFECTS,
  CRASH_DURABLE_RESULTS,
  CRASH_DURABLE_LOCK_STATES,
  CRASH_DURABLE_LIVENESS,
  OWNER_ENTRY_FILE,
  CrashDurableFaultError,
  planReplacement,
  planLogicalAppend,
  planLockAcquisition,
  planRetirementClaim,
  planTombstoneCleanup,
  compensationFor,
  classifyRun,
  classifyLockState,
  decideRelease,
  decideRetirement,
  runCrashDurablePlanSync,
  runCrashDurablePlanAsync,
  createSyncEffects,
  createAsyncEffects,
  inspectLockPathSync,
  inspectLockPathAsync
} from "./lib/crash-durable-state.mjs";
