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

const _ADOPTION_WORK_RECORD_TEMPLATE_CACHE = new Map();

function loadAdoptionWorkRecordTemplate(filename) {

  const safeName = path.basename(String(filename));
  if (!_ADOPTION_WORK_RECORD_TEMPLATE_CACHE.has(safeName)) {
    const parsed = JSON.parse(
      readFileSync(path.join(_TEMPLATES_DIR, safeName), "utf8")
    );
    _ADOPTION_WORK_RECORD_TEMPLATE_CACHE.set(safeName, parsed);
  }
  return JSON.parse(JSON.stringify(_ADOPTION_WORK_RECORD_TEMPLATE_CACHE.get(safeName)));
}

function renderBulletList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

export function getStaticIn0001AdoptionSeed() {
  return JSON.parse(JSON.stringify(_ADOPTION_SEED_SOURCE));
}

export function getStaticIn0001AdoptionSeedWorkRecords(
  seed = getStaticIn0001AdoptionSeed()
) {
  if (Array.isArray(seed.seed_work_record_templates) && seed.seed_work_record_templates.length > 0) {
    return seed.seed_work_record_templates.map((filename) =>
      loadAdoptionWorkRecordTemplate(filename)
    );
  }
  const records = Array.isArray(seed.seed_work_records)
    ? seed.seed_work_records
    : [];
  return JSON.parse(JSON.stringify(records));
}

function renderSeedWorkRecords(records) {
  if (!records.length) {
    return "_No executable work-record seed is bundled with this adoption seed._";
  }
  return records
    .map((record) => {
      const recordKind = [record.work_kind, record.record_kind]
        .filter(Boolean)
        .join(" ");
      const header = recordKind
        ? `- \`${record.id}\` (${recordKind}): ${record.title}`
        : `- \`${record.id}\`: ${record.title}`;
      const slices = Array.isArray(record.slices) ? record.slices : [];
      if (!slices.length) {
        return header;
      }
      const sliceLines = slices
        .map((slice) => {
          const sliceKind = slice.work_kind ? ` (${slice.work_kind})` : "";
          return `  - \`${record.id}#${slice.id}\`${sliceKind}: ${slice.title}`;
        })
        .join("\n");
      return `${header}\n${sliceLines}`;
    })
    .join("\n");
}

export function renderStaticIn0001AdoptionSeedMarkdown(
  seed = getStaticIn0001AdoptionSeed()
) {
  const targetSurfaces = seed.target_surfaces
    .map(
      (surface) =>
        `- \`${surface.path}\` (${surface.write_mode}): ${surface.purpose}`
    )
    .join("\n");
  const ownedWork = seed.owned_work
    .map((work) => `- ${work.title}: ${work.description}`)
    .join("\n");
  const seedWorkRecords = renderSeedWorkRecords(
    getStaticIn0001AdoptionSeedWorkRecords(seed)
  );

  return `# ${seed.title}

${seed.summary}

## Target Surfaces

${targetSurfaces}

## Executable Work Records

The dispatchable adoption contract is the seeded canonical work record(s) below.
Use these records — not the Owned Work summary — as the executable units a worker
is assigned and that dispatch readiness validates against.

${seedWorkRecords}

## Owned Work

The Owned Work list is a human-readable summary of the adoption backlog. It is
not dispatchable by itself; see Executable Work Records above for the canonical
records that own each surface and readiness check.

${ownedWork}

## Required Checks

${renderBulletList(seed.required_checks)}

## Non-Goals

${renderBulletList(seed.non_goals)}

## Idempotency

- Preserve existing canonical records and repo-specific edits.
- Create missing bootstrap surfaces only.
- Rerun safely without duplicating seeded content.
`;
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
  SidecarPathValidationError,
  filterSidecarSourcePaths,
  getForbiddenSidecarPathMatch,
  getSidecarDirtyIgnoredPathMatch,
  isForbiddenSidecarSourcePath,
  isSidecarDirtyIgnoredPath,
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
export {
  ADOPTION_VERIFY_SCHEMA_VERSION,
  ADOPTION_VERIFY_REQUIRED_CHECK_IDS,
  runAdoptionVerify
} from "./operations/adoption-verify.mjs";
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
