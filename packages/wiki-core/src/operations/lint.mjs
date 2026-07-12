import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSidecarGraphImpactPaths } from "../lib/sidecar-graph-impact.mjs";
import { loadCanonicalState, resolveContractContext } from "../lib/wiki.mjs";
import {
  filterToolDiscoveryTools,
  loadToolDiscoveryDescriptor,
  TOOL_DISCOVERY_FRAGMENT_DIR
} from "../lib/tool-discovery.mjs";
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

export const SESSION_ROLE_TOOL_ACCESS_POLICY_FILENAME = "session-role-tool-access.json";
export const SESSION_ROLE_TOOL_ACCESS_POLICY_PATH = path.join(
  TOOL_DISCOVERY_FRAGMENT_DIR,
  SESSION_ROLE_TOOL_ACCESS_POLICY_FILENAME
);
export const SESSION_ROLE_TOOL_ACCESS_POLICY_RELATIVE_PATH =
  "packages/wiki-core/data/tool-discovery/session-role-tool-access.json";

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

export async function loadSessionRoleToolAccessPolicy() {
  let raw;
  try {
    raw = await readFile(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { present: false, policy: null, parseError: null };
    }
    throw error;
  }
  try {
    return { present: true, policy: JSON.parse(raw), parseError: null };
  } catch (error) {
    return { present: true, policy: null, parseError: error };
  }
}

export function lintSessionRoleToolAccessPolicy({ descriptor, policy, addFinding }) {
  const relativePath = SESSION_ROLE_TOOL_ACCESS_POLICY_RELATIVE_PATH;

  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    addFinding(
      "error",
      `${relativePath}: central role->tool access policy must be a JSON object`,
      { code: "session_role_policy_invalid_shape", path: relativePath }
    );
    return;
  }

  const access = policy.access;
  if (!access || typeof access !== "object" || Array.isArray(access)) {
    addFinding(
      "error",
      `${relativePath}: policy must declare an 'access' object mapping each tool name to the session roles allowed to call it`,
      { code: "session_role_policy_missing_access", path: relativePath }
    );
    return;
  }

  const knownRoles = new Set(KNOWN_SESSION_ROLE_VALUES);
  const knownRolesLabel = KNOWN_SESSION_ROLE_VALUES.join(", ");
  const registeredToolNames = collectRegisteredAgentReachableToolNames(descriptor);
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
}

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

    const sessionRolePolicyLoad = await loadSessionRoleToolAccessPolicy();
    if (sessionRolePolicyLoad.present) {
      if (sessionRolePolicyLoad.parseError) {
        addFinding(
          "error",
          `${SESSION_ROLE_TOOL_ACCESS_POLICY_RELATIVE_PATH}: central role->tool access policy is not valid JSON: ${sessionRolePolicyLoad.parseError.message}`,
          {
            code: "session_role_policy_invalid_json",
            path: SESSION_ROLE_TOOL_ACCESS_POLICY_RELATIVE_PATH
          }
        );
      } else {
        lintSessionRoleToolAccessPolicy({
          descriptor: toolDiscoveryDescriptor,
          policy: sessionRolePolicyLoad.policy,
          addFinding
        });
      }
    }
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
