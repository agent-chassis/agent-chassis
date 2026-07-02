import path from "node:path";
import { getSidecarGraphImpactPaths } from "../lib/sidecar-graph-impact.mjs";
import { loadCanonicalState, resolveContractContext } from "../lib/wiki.mjs";
import { filterToolDiscoveryTools, loadToolDiscoveryDescriptor } from "../lib/tool-discovery.mjs";
import {
  asStringList,
  buildLintNextAction,
  createLintFindings,
  isLegacyMarkdownWorkRecordPage,
  normalizeDiagnosticPath
} from "./lint-shared.mjs";
import { loadWorkRecordJsonValues } from "./lint-work-record-evidence.mjs";
import {
  lintExecutableArtifacts,
  lintGeneratedViews,
  lintRepoContract
} from "./lint-contract-rules.mjs";
import {
  lintDuplicateIds,
  lintRecordFiles,
  lintTrackerChildSlices
} from "./lint-record-rules.mjs";
import { lintPageFacets } from "./lint-page-rules.mjs";
import {
  lintDocsBacklinks,
  lintInitiativeReadyToClose,
  lintIssueLifecycle,
  lintWriteScopeOverlap
} from "./lint-coordination-rules.mjs";

const LINT_COMPACT_FINDINGS_LIMIT = 20;

export async function lintRepo({
  dir = ".",
  profile: requestedProfile = null,
  extensionNamespaces = null,
  requireJsonOpenWork = false,
  graphImpactProvider = getSidecarGraphImpactPaths,
  verbose = false,
  includeAllFindings = false,
  include_all_findings = false
}) {
  const includeAllLintFindings =
    verbose === true || includeAllFindings === true || include_all_findings === true;
  const targetDir = path.resolve(String(dir));
  const context = await resolveContractContext(targetDir, {
    profile: requestedProfile,
    extensionNamespaces
  });
  const {
    manifest,
    rawMetadata,
    metadata,
    profile,
    extensionNamespaces: resolvedExtensionNamespaces
  } = context;

  const { findings, problems, warnings, addFinding } = createLintFindings();

  const { allocatorState, allocatorStateValid } = await lintRepoContract({
    targetDir,
    manifest,
    rawMetadata,
    metadata,
    profile,
    resolvedExtensionNamespaces,
    requestedProfile,
    extensionNamespaces,
    addFinding
  });

  await lintExecutableArtifacts({ targetDir, addFinding });

  const canonicalState = await loadCanonicalState(targetDir, {
    extensionNamespaces: resolvedExtensionNamespaces
  });
  const topicVocabulary = {
    shared: metadata?.vocab?.topics?.shared || manifest.retrieval?.sharedTopics || [],
    local: metadata?.vocab?.topics?.local || []
  };
  const declaredTopics = new Set([...topicVocabulary.shared, ...topicVocabulary.local]);
  const reservedTopicSlugs = new Set([
    ...resolvedExtensionNamespaces,
    ...canonicalState.areas
      .map((page) => String(page.frontmatter?.id || "").trim().toLowerCase())
      .filter(Boolean)
  ]);
  const canonicalPages = [
    ...canonicalState.issues,
    ...canonicalState.initiatives,
    ...canonicalState.sources,
    ...canonicalState.decisions
  ];
  const allPages = [
    ...canonicalState.docs,
    ...canonicalState.wikiPages,
    ...canonicalState.extensionPages,
    ...canonicalState.issues,
    ...canonicalState.initiatives,
    ...canonicalState.sources,
    ...canonicalState.decisions,
    ...canonicalState.areas
  ];
  const pagesById = canonicalState.pagesById;
  const docsByPath = new Map(canonicalState.docs.map((doc) => [doc.relativePath, doc]));

  const coordinationIssues = canonicalState.issues.filter(
    (issue) => !isLegacyMarkdownWorkRecordPage(issue)
  );
  const issuesByInitiative = new Map();

  for (const page of coordinationIssues) {
    const initiativeId = page.frontmatter?.initiative;
    if (!initiativeId) {
      continue;
    }
    const pages = issuesByInitiative.get(String(initiativeId)) || [];
    pages.push(page);
    issuesByInitiative.set(String(initiativeId), pages);
  }

  lintDuplicateIds({ canonicalPages, addFinding });

  const facetContext = { manifest, metadata };
  let structuredRefreshRouteAvailable = false;
  try {
    const toolDiscoveryDescriptor = await loadToolDiscoveryDescriptor();
    structuredRefreshRouteAvailable =
      filterToolDiscoveryTools(toolDiscoveryDescriptor, {
        tool_name: "workspace_work_record_refresh_admission_metrics"
      }).length > 0;
  } catch {
    structuredRefreshRouteAvailable = false;
  }
  const {
    values: allocatedWorkRecordValues,
    recordsById: allocatedWorkRecordRecordsById
  } = await loadWorkRecordJsonValues(targetDir, addFinding, structuredRefreshRouteAvailable);
  const docsBacklinkSources = new Map();

  const readFirstRefs = (unit) => [
    ...new Set([...asStringList(unit?.read_scope), ...asStringList(unit?.docs)])
  ];
  const addDocsBacklinkSource = ({ sourceId, sourcePath, docs }) => {
    const normalizedSourceId = String(sourceId || "").trim();
    if (!normalizedSourceId) {
      return;
    }

    docsBacklinkSources.set(normalizedSourceId, {
      sourceId: normalizedSourceId,
      sourcePath,
      docs: asStringList(docs)
    });
  };

  for (const page of [...canonicalState.initiatives, ...canonicalState.decisions]) {
    const pageId = String(page.frontmatter?.id || "").trim();
    if (!pageId || allocatedWorkRecordRecordsById.has(pageId)) {
      continue;
    }

    addDocsBacklinkSource({
      sourceId: pageId,
      sourcePath: page.relativePath,
      docs: readFirstRefs(page.frontmatter)
    });
  }

  for (const loaded of allocatedWorkRecordRecordsById.values()) {
    const record = loaded.record;
    if (!record) {
      continue;
    }

    addDocsBacklinkSource({
      sourceId: String(record.id),
      sourcePath:
        normalizeDiagnosticPath(targetDir, loaded.source_path) || loaded.source_path_relative,
      docs: readFirstRefs(record)
    });
  }

  lintTrackerChildSlices({ allocatedWorkRecordRecordsById, targetDir, addFinding });

  lintPageFacets({
    allPages,
    facetContext,
    manifest,
    declaredTopics,
    reservedTopicSlugs,
    allocatedWorkRecordRecordsById,
    targetDir,
    addFinding
  });

  await lintRecordFiles({
    targetDir,
    manifest,
    allocatorState,
    allocatorStateValid,
    allocatedWorkRecordValues,
    allocatedWorkRecordRecordsById,
    pagesById,
    addFinding
  });

  await lintDocsBacklinks({
    docsBacklinkSources,
    canonicalState,
    docsByPath,
    allocatedWorkRecordRecordsById,
    pagesById,
    targetDir,
    addFinding
  });

  lintInitiativeReadyToClose({ canonicalState, issuesByInitiative, addFinding });

  await lintIssueLifecycle({
    issues: canonicalState.issues,
    requireJsonOpenWork,
    graphImpactProvider,
    targetDir,
    addFinding
  });

  lintWriteScopeOverlap({ issues: coordinationIssues, addFinding });

  await lintGeneratedViews({ targetDir, profile, resolvedExtensionNamespaces, addFinding });

  const compactFindings = includeAllLintFindings
    ? findings
    : findings.slice(0, LINT_COMPACT_FINDINGS_LIMIT);
  const compactProblems = includeAllLintFindings
    ? problems
    : problems.slice(0, LINT_COMPACT_FINDINGS_LIMIT);
  const compactWarnings = includeAllLintFindings
    ? warnings
    : warnings.slice(0, LINT_COMPACT_FINDINGS_LIMIT);
  const hasTruncatedFindings =
    !includeAllLintFindings && findings.length > compactFindings.length;

  const result = {
    ok: problems.length === 0,
    valid: problems.length === 0,
    warning_count: warnings.length,
    error_count: problems.length,
    next_action: buildLintNextAction({
      errorCount: problems.length,
      warningCount: warnings.length,
      findingsTruncated: hasTruncatedFindings
    })
  };

  if (compactFindings.length > 0) {
    result.findings = compactFindings;
  }
  if (compactProblems.length > 0) {
    result.problems = compactProblems;
  }
  if (compactWarnings.length > 0) {
    result.warnings = compactWarnings;
  }

  if (includeAllLintFindings) {
    result.targetDir = targetDir;
    result.contractVersion = manifest.contractVersion;
    result.profile = profile;
    result.extensionNamespaces = resolvedExtensionNamespaces;
    result.findings = findings;
    result.problems = problems;
    result.warnings = warnings;
  }

  return result;
}
