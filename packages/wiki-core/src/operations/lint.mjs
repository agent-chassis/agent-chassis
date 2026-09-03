import path from "node:path";

import { getSidecarGraphImpactPaths } from "../lib/sidecar-graph-impact.mjs";
import { createWorkRecordCorpusSnapshot } from "../lib/work-record-corpus-snapshot.mjs";
import { buildWorkRecordDuplicateClaimsIndex } from "../lib/work-record-store.mjs";
import { loadCanonicalState, resolveContractContext } from "../lib/wiki.mjs";
import {
  buildGeneratedViewsFromCanonicalState,
  resolveOperationDate
} from "./generate.mjs";
import {
  filterToolDiscoveryTools,
  loadToolDiscoveryDescriptor,
  TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH
} from "../lib/tool-discovery.mjs";
import {
  evaluateToolDispositionCompatibility,
  loadSessionRoleToolAccessPolicy,
  resolveToolAudience,
  resolveToolTierVisibility,
  SESSION_ROLE_TOOL_ACCESS_POLICY_FILENAME,
  SESSION_ROLE_TOOL_ACCESS_POLICY_PATH,
  SESSION_ROLE_TOOL_ACCESS_POLICY_RELATIVE_PATH,
  SESSION_ROLE_TOOL_DISPOSITION_VALUES,
  validateSessionRoleToolAccessPolicy
} from "../lib/tool-discovery/gating.mjs";
import {
  evaluateAgentToolConformance,
  evaluateAgentToolTokenBudgetDebt,
  loadToolDiscoveryManifest
} from "../lib/tool-discovery/descriptor.mjs";
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

export const KNOWN_SESSION_ROLE_VALUES = Object.freeze([
  "orchestrator",
  "reviewer",
  "worker",
  "redteam",
  "operator"
]);

export {
  SESSION_ROLE_TOOL_ACCESS_POLICY_FILENAME,
  SESSION_ROLE_TOOL_ACCESS_POLICY_PATH,
  SESSION_ROLE_TOOL_ACCESS_POLICY_RELATIVE_PATH
};

export function collectRegisteredAgentReachableToolNames(descriptor) {
  const names = new Set();
  const tools = Array.isArray(descriptor?.tools) ? descriptor.tools : [];
  for (const entry of tools) {
    if (
      entry &&
      entry.kind === "mcp_tool" &&
      entry.install_state === "installed" &&
      entry.runtime_posture === "supported" &&
      typeof entry.tool_name === "string" &&
      entry.tool_name.trim() !== ""
    ) {
      names.add(entry.tool_name);
    }
  }
  return names;
}

export function lintSessionRoleToolAccessPolicy({ descriptor, policy, addFinding }) {
  const relativePath = SESSION_ROLE_TOOL_ACCESS_POLICY_RELATIVE_PATH;

  const structuralDiagnostics = validateSessionRoleToolAccessPolicy(policy);
  for (const diagnostic of structuralDiagnostics) {
    addFinding(diagnostic.level, diagnostic.message, {
      code: diagnostic.code,
      path: diagnostic.path
    });
  }
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return;

  const access = policy.access;
  if (!access || typeof access !== "object" || Array.isArray(access)) {
    return;
  }

  const knownRoles = new Set(KNOWN_SESSION_ROLE_VALUES);
  const knownRolesLabel = KNOWN_SESSION_ROLE_VALUES.join(", ");
  const registeredToolNames = collectRegisteredAgentReachableToolNames(descriptor);
  const registeredToolsByName = new Map(
    (Array.isArray(descriptor?.tools) ? descriptor.tools : [])
      .filter((entry) => registeredToolNames.has(entry?.tool_name))
      .map((entry) => [entry.tool_name, entry])
  );
  const grantedToolNames = new Set();

  for (const [toolName, grantedRoles] of Object.entries(access)) {
    if (!Array.isArray(grantedRoles)) {
      addFinding(
        "error",
        `${relativePath}: tool '${toolName}' must map to an array of session roles`,
        { code: "session_role_policy_invalid_grant_list", path: relativePath }
      );
      continue;
    }

    let hasKnownRole = false;
    for (const role of grantedRoles) {
      if (typeof role !== "string" || role.trim() === "") {
        addFinding(
          "error",
          `${relativePath}: tool '${toolName}' contains a non-string/empty role grant`,
          { code: "session_role_policy_invalid_grant_entry", path: relativePath }
        );
        continue;
      }

      if (!knownRoles.has(role)) {
        addFinding(
          "error",
          `${relativePath}: tool '${toolName}' grants unknown role '${role}'; valid roles: ${knownRolesLabel}`,
          { code: "session_role_policy_unknown_role", path: relativePath }
        );
        continue;
      }
      hasKnownRole = true;
    }

    if (!registeredToolNames.has(toolName)) {
      addFinding(
        "error",
        `${relativePath}: policy grants access to '${toolName}', which resolves to no registered agent-reachable tool (dangling policy entry)`,
        { code: "session_role_policy_dangling_tool", path: relativePath }
      );
    }

    if (hasKnownRole) {
      grantedToolNames.add(toolName);
    }
  }

  if (Array.isArray(policy.roles)) {
    for (const role of policy.roles) {
      if (!knownRoles.has(role)) {
        addFinding(
          "error",
          `${relativePath}: declared role '${role}' is not a known session role; valid roles: ${knownRolesLabel}`,
          { code: "session_role_policy_unknown_role", path: relativePath }
        );
      }
    }
  }

  for (const toolName of registeredToolNames) {
    if (!grantedToolNames.has(toolName)) {
      addFinding(
        "error",
        `${relativePath}: registered agent-reachable tool '${toolName}' is granted to no session role; the fail-closed role gate would strand it (grant it to at least one role)`,
        { code: "session_role_policy_tool_unassigned", path: relativePath }
      );
    }
  }

  const dispositions = policy.dispositions;
  if (!dispositions || typeof dispositions !== "object" || Array.isArray(dispositions)) {
    return;
  }

  const knownDispositions = new Set(SESSION_ROLE_TOOL_DISPOSITION_VALUES);
  const classifiedToolNames = new Set();
  for (const [toolName, dispositionList] of Object.entries(dispositions)) {
    if (!registeredToolNames.has(toolName)) {
      addFinding(
        "error",
        `${relativePath}: disposition for '${toolName}' resolves to no registered agent-reachable supported operation`,
        { code: "session_role_policy_dangling_disposition", path: relativePath }
      );
      continue;
    }
    if (
      !Array.isArray(dispositionList) ||
      dispositionList.length !== 1 ||
      !knownDispositions.has(dispositionList[0])
    ) {
      continue;
    }

    classifiedToolNames.add(toolName);
    const disposition = dispositionList[0];
    const grantedRoles = Array.isArray(access[toolName]) ? access[toolName] : [];
    const descriptorEntry = registeredToolsByName.get(toolName);
    const compatibilityConflicts = evaluateToolDispositionCompatibility({
      disposition,
      grantedRoles,
      audience: resolveToolAudience(descriptorEntry),
      tierVisibility: resolveToolTierVisibility(descriptorEntry)
    });
    for (const conflict of compatibilityConflicts) {
      addFinding(
        "error",
        `${relativePath}: operation '${toolName}' disposition '${disposition}' is incompatible: ${conflict.message}`,
        {
          code: conflict.kind === "axis"
            ? "session_role_policy_disposition_axis_conflict"
            : "session_role_policy_disposition_grant_conflict",
          path: relativePath
        }
      );
    }
  }

  for (const toolName of registeredToolNames) {
    if (!classifiedToolNames.has(toolName)) {
      addFinding(
        "error",
        `${relativePath}: registered agent-reachable supported operation '${toolName}' is outside the startup-static disposition population`,
        { code: "session_role_policy_supported_operation_unclassified", path: relativePath }
      );
    }
  }
}

export const TOOL_PAYLOAD_DEFAULT_BYTE_BUDGET = 4096;

export const TOOL_PAYLOAD_BYTE_BUDGET_OVERRIDES = Object.freeze({

  workspace_work_record_ready_slice: 10240
});

export function measureToolPayloadBytes(tool) {
  const description = typeof tool?.description === "string" ? tool.description : "";
  const schema = tool?.inputSchema ?? tool?.input_schema ?? null;
  const serializedSchema = schema === null ? "" : JSON.stringify(schema) ?? "";
  return (
    Buffer.byteLength(description, "utf8") + Buffer.byteLength(serializedSchema, "utf8")
  );
}

export function resolveToolPayloadByteBudget(
  toolName,
  overrides = TOOL_PAYLOAD_BYTE_BUDGET_OVERRIDES
) {
  const override = overrides?.[toolName];
  return Number.isFinite(override) ? override : TOOL_PAYLOAD_DEFAULT_BYTE_BUDGET;
}

export function lintToolPayloadByteBudgets({
  tools,
  addFinding,
  defaultBudget = TOOL_PAYLOAD_DEFAULT_BYTE_BUDGET,
  overrides = TOOL_PAYLOAD_BYTE_BUDGET_OVERRIDES
}) {
  if (!Array.isArray(tools)) {
    return;
  }
  for (const tool of tools) {
    const toolName = typeof tool?.name === "string" ? tool.name : "";
    if (toolName === "") {
      continue;
    }
    const override = overrides?.[toolName];
    const budget = Number.isFinite(override) ? override : defaultBudget;
    const bytes = measureToolPayloadBytes(tool);
    if (bytes <= budget) {
      continue;
    }
    const allowance = Number.isFinite(override)
      ? `its declared allowance of ${budget}`
      : `the default per-tool budget of ${budget}`;
    addFinding(
      "error",
      `tool '${toolName}' publishes ${bytes} bytes of description plus input schema, exceeding ${allowance} by ${
        bytes - budget
      }; every session pays this before asking anything, so shorten the prose or single-source a repeated sentence rather than raising the budget`,
      { code: "tool_payload_byte_budget_exceeded", path: toolName }
    );
  }
}

async function lintRepoImpl({
  dir = ".",
  profile: requestedProfile = null,
  extensionNamespaces = null,
  requireJsonOpenWork = false,
  graphImpactProvider = getSidecarGraphImpactPaths,
  verbose = false,
  includeAllFindings = false,
  include_all_findings = false,
  clock = null,
  instrumentation = null
}, captured = null) {
  const includeAllLintFindings =
    verbose === true || includeAllFindings === true || include_all_findings === true;
  const targetDir = path.resolve(String(dir));
  const context = captured?.context || (await resolveContractContext(targetDir, {
    profile: requestedProfile,
    extensionNamespaces
  }));
  const operationDate = captured?.operationDate || resolveOperationDate(clock);
  const workRecordSnapshot = captured?.workRecordSnapshot ||
    (await createWorkRecordCorpusSnapshot({ dir: targetDir, instrumentation }));
  const ownsSnapshot = !captured?.workRecordSnapshot;
  try {
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

  await lintExecutableArtifacts({
    targetDir,
    addFinding,
    getCanonicalPrefix: (requestedPath) => workRecordSnapshot.getCanonicalPrefix(requestedPath),
    instrumentation
  });

  let canonicalState = captured?.canonicalState || null;
  if (canonicalState === null) {
    if (typeof instrumentation?.increment === "function") {
      instrumentation.increment("canonical_state_load_count", 1);
    }
    canonicalState = await loadCanonicalState(targetDir, {
      extensionNamespaces: resolvedExtensionNamespaces,
      workRecords: workRecordSnapshot.loads
    });
  }
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
    const [toolDiscoveryDescriptor, toolDiscoveryManifest] = await Promise.all([
      loadToolDiscoveryDescriptor(),
      loadToolDiscoveryManifest()
    ]);
    structuredRefreshRouteAvailable =
      filterToolDiscoveryTools(toolDiscoveryDescriptor, {
        tool_name: "workspace_work_record_refresh_admission_metrics"
      }).length > 0;

    const sessionRolePolicyLoad = await loadSessionRoleToolAccessPolicy();
    for (const diagnostic of sessionRolePolicyLoad.diagnostics) {
      addFinding(diagnostic.level, diagnostic.message, {
        code: diagnostic.code,
        path: diagnostic.path
      });
    }
    if (sessionRolePolicyLoad.policy && sessionRolePolicyLoad.diagnostics.length === 0) {
      lintSessionRoleToolAccessPolicy({
        descriptor: toolDiscoveryDescriptor,
        policy: sessionRolePolicyLoad.policy,
        addFinding
      });
      const conformance = evaluateAgentToolConformance(
        toolDiscoveryDescriptor,
        toolDiscoveryManifest,
        { accessPolicy: sessionRolePolicyLoad.policy }
      );
      for (const toolName of conformance.debt_added) {
        addFinding(
          "error",
          `${TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH}: agent-tool conformance debt grew or changed at '${toolName}'; new/changed role-visible tools must carry complete routing controls`,
          {
            code: "agent_tool_conformance_debt_added",
            path: TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH
          }
        );
      }
      const tokenBudgetDebt = evaluateAgentToolTokenBudgetDebt(
        toolDiscoveryDescriptor,
        toolDiscoveryManifest
      ).raw_discovery_notes;
      for (const toolName of tokenBudgetDebt.added_entry_names) {
        addFinding(
          "error",
          `${TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH}: raw discovery-note budget debt grew at '${toolName}'; new or enlarged prose cannot consume the historical aggregate allowance`,
          {
            code: "agent_tool_notes_budget_debt_added",
            path: TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH
          }
        );
      }
    }
  } catch (error) {
    structuredRefreshRouteAvailable = false;
    addFinding(
      "error",
      `${TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH}: agent-tool descriptor/conformance validation failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        code: "agent_tool_conformance_invalid",
        path: TOOL_DISCOVERY_MANIFEST_RELATIVE_PATH
      }
    );
  }
  const {
    values: allocatedWorkRecordValues,
    recordsById: allocatedWorkRecordRecordsById
  } = await loadWorkRecordJsonValues(
    targetDir,
    addFinding,
    structuredRefreshRouteAvailable,
    workRecordSnapshot
  );

  const duplicateClaimsIndex = await buildWorkRecordDuplicateClaimsIndex({ dir: targetDir });
  for (const [recordId, claimants] of duplicateClaimsIndex) {
    if (claimants.length < 2) {
      continue;
    }
    const relativeClaimants = claimants.map((claimant) =>
      normalizeDiagnosticPath(targetDir, claimant) || claimant
    );
    addFinding(
      "error",
      `Record id ${recordId} is also claimed by ${relativeClaimants.join(", ")}`,
      {
        code: "duplicate_record_id",
        path: relativeClaimants[0],
        record_id: recordId,
        claimants: relativeClaimants
      }
    );
  }
  const docsBacklinkSources = new Map();

  const readFirstRefs = (unit) => [
    ...new Set([...asStringList(unit?.read_scope), ...asStringList(unit?.docs)])
  ];
  const addDocsBacklinkSource = ({ sourceId, sourcePath, docs, status }) => {
    const normalizedSourceId = String(sourceId || "").trim();
    if (!normalizedSourceId) {
      return;
    }

    docsBacklinkSources.set(normalizedSourceId, {
      sourceId: normalizedSourceId,
      sourcePath,
      docs: asStringList(docs),
      status
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
      docs: readFirstRefs(page.frontmatter),
      status: page.frontmatter?.status
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
      docs: readFirstRefs(record),
      status: record.status
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

  const generatedBuild = captured?.generatedBuild ||
    (await buildGeneratedViewsFromCanonicalState({
      targetDir,
      context,
      canonicalState,
      operationDate,
      instrumentation
    }));
  await lintGeneratedViews({
    targetDir,
    profile,
    resolvedExtensionNamespaces,
    addFinding,
    generatedBuild
  });

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
  } finally {
    if (ownsSnapshot) {
      workRecordSnapshot.release();
    }
  }
}

export async function lintRepo(options = {}) {
  return lintRepoImpl(options, null);
}

export async function lintRepoFromCapturedCorpus(options = {}, captured) {
  return lintRepoImpl(options, captured);
}
