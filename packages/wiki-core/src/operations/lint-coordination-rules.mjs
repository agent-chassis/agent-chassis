import path from "node:path";
import { existsSync } from "node:fs";
import { deriveMarkdownBlastRadiusEvidence } from "../lib/work-record-policy.mjs";
import { findUncheckedChecklistItems } from "./lint-markdown-projection.mjs";
import {
  asStringList,
  backlinkComment,
  daysSince,
  hasBacklink,
  isCanonicalWorkRecordReference,
  isCrossRepoQualifiedReference,
  isClosedStatus,
  isLegacyMarkdownWorkRecordPage,
  parseDate
} from "./lint-shared.mjs";

function isDocsTreePath(relativePath) {
  return String(relativePath).replace(/\/+$/, "").startsWith("docs/");
}

export function readScopeRefExists(targetDir, relativePath) {
  let resolvedTargetDir = targetDir;
  let resolvedRelativePath = relativePath;

  if (typeof relativePath === "object" && relativePath !== null) {
    resolvedRelativePath = targetDir;
    resolvedTargetDir =
      relativePath.repoRoot ??
      relativePath.root ??
      relativePath.rootDir ??
      relativePath.baseDir ??
      relativePath.workspaceRoot ??
      relativePath.workspaceRootPath ??
      relativePath.cwd ??
      relativePath.targetDir ??
      relativePath.docsRoot ??
      relativePath.internalRoot ??
      null;
  }

  const normalized = String(resolvedRelativePath).replace(/\/+$/, "");
  if (!normalized || !resolvedTargetDir) {
    return false;
  }

  if (isCrossRepoQualifiedReference(normalized)) {
    return true;
  }

  const pathOnly = normalized.replace(/#.*$/, "");
  if (!pathOnly) {
    return false;
  }

  return existsSync(path.join(resolvedTargetDir, pathOnly));
}

export async function lintDocsBacklinks({
  docsBacklinkSources,
  canonicalState,
  docsByPath,
  allocatedWorkRecordRecordsById,
  pagesById,
  targetDir,
  addFinding
}) {
  const backlinkRelation = "tracks";

  for (const source of docsBacklinkSources.values()) {
    for (const relatedRef of source.docs) {

      if (isDocsTreePath(relatedRef)) {
        const docRelativePath = String(relatedRef).replace(/#.*$/, "");
        const doc = docsByPath.get(docRelativePath);
        if (!doc) {
          addFinding(
            "error",
            `${source.sourcePath}: referenced docs entry does not exist: ${relatedRef}`,
            { code: "missing_docs_target", path: source.sourcePath }
          );
          continue;
        }
        if (!hasBacklink(doc, source.sourceId, "tracks")) {
          addFinding(
            "error",
            `${doc.relativePath}: missing wiki backlink for ${source.sourceId} referenced by ${source.sourcePath}; add this comment where appropriate: ${backlinkComment(source.sourceId, "tracks")}`,
            {
              code: "missing_docs_backlink",
              path: doc.relativePath,
              source_id: source.sourceId,
              backlink_id: source.sourceId,
              relation: backlinkRelation,
              backlink_comment: backlinkComment(source.sourceId, backlinkRelation)
            }
          );
        }
        continue;
      }

      if (!(await readScopeRefExists(targetDir, relatedRef))) {
        addFinding(
          "error",
          `${source.sourcePath}: referenced read_scope entry does not exist: ${relatedRef}`,
          { code: "missing_docs_target", path: source.sourcePath }
        );
      }
    }
  }

  for (const source of canonicalState.sources) {
    for (const docRelativePath of asStringList(source.frontmatter?.related_docs)) {
      const doc = docsByPath.get(docRelativePath);
      if (!doc) {
        addFinding(
          "error",
          `${source.relativePath}: related_docs entry does not exist: ${docRelativePath}`,
          { code: "missing_related_docs_target", path: source.relativePath }
        );
        continue;
      }
      const backlinkId = String(source.frontmatter?.id ?? "").trim();
      if (!hasBacklink(doc, backlinkId, backlinkRelation)) {
        addFinding(
          "error",
          `${doc.relativePath}: missing wiki backlink for ${backlinkId} referenced by ${source.relativePath}; add this comment where appropriate: ${backlinkComment(backlinkId, backlinkRelation)}`,
          {
            code: "missing_docs_backlink",
            path: doc.relativePath,
            source_id: backlinkId,
            backlink_id: backlinkId,
            relation: backlinkRelation,
            backlink_comment: backlinkComment(backlinkId, backlinkRelation)
          }
        );
      }
    }

    for (const relatedWorkId of asStringList(source.frontmatter?.related_work)) {
      if (!isCanonicalWorkRecordReference(relatedWorkId, allocatedWorkRecordRecordsById, pagesById)) {
        addFinding(
          "error",
          `${source.relativePath}: related_work entry does not exist: ${relatedWorkId}`,
          { code: "missing_related_work_target", path: source.relativePath }
        );
      }
    }
  }
}

export function lintInitiativeReadyToClose({ canonicalState, issuesByInitiative, addFinding }) {
  for (const initiative of canonicalState.initiatives) {
    const childIssues = issuesByInitiative.get(String(initiative.frontmatter?.id)) || [];
    if (
      childIssues.length > 0 &&
      !isClosedStatus(initiative.frontmatter?.status) &&
      childIssues.every((issue) => isClosedStatus(issue.frontmatter?.status))
    ) {
      addFinding(
        "warning",
        `${initiative.relativePath}: initiative has only closed child issues and may be ready to close`,
        { code: "initiative_ready_to_close", path: initiative.relativePath }
      );
    }
  }
}

export async function lintIssueLifecycle({
  issues,
  requireJsonOpenWork,
  graphImpactProvider,
  targetDir,
  addFinding
}) {
  for (const issue of issues) {
    const status = String(issue.frontmatter?.status ?? "").toLowerCase();
    const resolution = String(issue.frontmatter?.resolution ?? "").toLowerCase();
    const owner = String(issue.frontmatter?.owner ?? "").trim();
    const writeScope = asStringList(issue.frontmatter?.write_scope);
    const repoPaths = asStringList(issue.frontmatter?.repo_paths);
    const pathHint = issue.relativePath;
    const isLegacyMarkdown = isLegacyMarkdownWorkRecordPage(issue);

    if (isLegacyMarkdown) {
      await applyRequireJsonOpenWorkGate({
        issue,
        status,
        requireJsonOpenWork,
        graphImpactProvider,
        targetDir,
        addFinding
      });
      continue;
    }

    if (["in_progress", "blocked", "review"].includes(status) && !owner) {
      addFinding(
        "warning",
        `${pathHint}: active issue is missing owner`,
        { code: "active_issue_missing_owner", path: pathHint }
      );
    }

    if (["in_progress", "blocked", "review"].includes(status) && (writeScope.length === 0 && repoPaths.length > 0)) {
      addFinding(
        "warning",
        `${pathHint}: active issue has repo_paths but no write_scope`,
        { code: "active_issue_missing_write_scope", path: pathHint }
      );
    }

    if (
      ["done", "cancelled", "deprecated", "duplicate", "superseded", "wont_do"].includes(status) &&
      (!issue.frontmatter?.resolution || String(issue.frontmatter.resolution) === "unresolved")
    ) {
      addFinding(
        "warning",
        `${pathHint}: closed issue should set a non-default resolution`,
        { code: "closed_issue_missing_resolution", path: pathHint }
      );
    }

    const uncheckedChecklistItems = findUncheckedChecklistItems(issue.body);
    if ((isClosedStatus(status) || resolution === "resolved") && uncheckedChecklistItems.length > 0) {
      const lineHint = uncheckedChecklistItems.map((item) => item.line).join(", ");
      addFinding(
        "error",
        `${pathHint}: closed issue contains unchecked checklist item(s) on line(s): ${lineHint}`,
        { code: "closed_issue_unchecked_checklist", path: pathHint }
      );
    }

    const updatedAt = parseDate(issue.frontmatter?.updated);
    if (["in_progress", "blocked", "review"].includes(status) && updatedAt) {
      const ageDays = daysSince(updatedAt);
      if (ageDays >= 14) {
        addFinding(
          "warning",
          `${pathHint}: active issue has not been updated in ${ageDays} day(s)`,
          { code: "stale_active_issue", path: pathHint }
        );
      }
    }

    await applyRequireJsonOpenWorkGate({
      issue,
      status,
      requireJsonOpenWork,
      graphImpactProvider,
      targetDir,
      addFinding
    });
  }
}

async function applyRequireJsonOpenWorkGate({
  issue,
  status,
  requireJsonOpenWork,
  graphImpactProvider,
  targetDir,
  addFinding
}) {
  if (!requireJsonOpenWork || isClosedStatus(status)) {
    return;
  }

  const recordId = String(issue.frontmatter?.id || path.basename(issue.relativePath, ".md"));
  const expectedJsonPath = `wiki/work-records/${recordId}.json`;
  const jsonFilePath = path.join(targetDir, expectedJsonPath);
  if (existsSync(jsonFilePath)) {
    return;
  }

  addFinding(
    "error",
    `${issue.relativePath}: open Markdown work item requires ${expectedJsonPath}; use WK-0166 on-demand migration`,
    {
      code: "missing_json_record",
      path: expectedJsonPath,
      source_path: issue.relativePath,
      blast_radius: await deriveMarkdownBlastRadiusEvidence(
        {
          id: recordId,
          docs: issue.frontmatter?.docs,
          repo_paths: issue.frontmatter?.repo_paths,
          write_scope: issue.frontmatter?.write_scope,
          related: issue.frontmatter?.related
        },
        {
          dir: targetDir,
          graphImpactProvider
        }
      ),
      dispatch_authority: "informational"
    }
  );
}

export function lintWriteScopeOverlap({ issues, addFinding }) {
  const activeIssues = issues.filter((issue) =>
    ["todo", "in_progress", "blocked", "review"].includes(
      String(issue.frontmatter?.status ?? "").toLowerCase()
    )
  );
  for (let index = 0; index < activeIssues.length; index += 1) {
    const left = activeIssues[index];
    const leftScope = new Set(asStringList(left.frontmatter?.write_scope));
    if (leftScope.size === 0) {
      continue;
    }
    for (let rightIndex = index + 1; rightIndex < activeIssues.length; rightIndex += 1) {
      const right = activeIssues[rightIndex];
      const rightScope = new Set(asStringList(right.frontmatter?.write_scope));
      const overlap = [...leftScope].filter((entry) => rightScope.has(entry));
      if (overlap.length > 0) {
        addFinding(
          "warning",
          `${left.relativePath}: write_scope overlaps ${right.relativePath}: ${overlap.join(", ")}`,
          { code: "write_scope_overlap", path: left.relativePath }
        );
      }
    }
  }
}
