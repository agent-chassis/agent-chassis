import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  expectedFileStem,
  extractFrontMatter,
  listRecordFiles,
  pathExists
} from "../lib/wiki.mjs";
import {
  asStringList,
  formatAllocatedId,
  isCanonicalWorkRecordReference,
  isLegacyMarkdownWorkRecordDirectory,
  normalizeDiagnosticPath,
  parseAllocatedId
} from "./lint-shared.mjs";

export function lintDuplicateIds({ canonicalPages, addFinding }) {
  const seenIds = new Map();
  for (const page of canonicalPages) {
    const id = page.frontmatter?.id;
    if (!id) {
      continue;
    }
    const normalizedId = String(id);
    if (seenIds.has(normalizedId)) {
      addFinding(
        "error",
        `${page.relativePath}: duplicate id ${normalizedId} (already used by ${seenIds.get(normalizedId)})`,
        { code: "duplicate_id", path: page.relativePath }
      );
      continue;
    }
    seenIds.set(normalizedId, page.relativePath);
  }
}

export function lintTrackerChildSlices({ allocatedWorkRecordRecordsById, targetDir, addFinding }) {
  for (const loaded of allocatedWorkRecordRecordsById.values()) {
    const record = loaded.record;
    if (!record || record.work_kind !== "tracker") {
      continue;
    }

    const childReferences = Array.isArray(record.children) ? record.children : [];
    if (childReferences.length === 0) {
      continue;
    }

    const sliceChildren = childReferences.filter(
      (child) => child && child.relation === "implements_slice"
    );
    if (sliceChildren.length === 0) {
      continue;
    }

    const slices = Array.isArray(record.slices) ? record.slices : [];
    if (slices.length > 0) {
      continue;
    }

    const nonLocalSliceChildren = sliceChildren.filter(
      (child) => !isIndependentChildWorkRecord({ parent: record, child, allocatedWorkRecordRecordsById })
    );
    if (nonLocalSliceChildren.length === 0) {
      continue;
    }

    const recordPath = normalizeDiagnosticPath(targetDir, loaded.source_path) || loaded.source_path_relative;
    const childIds = nonLocalSliceChildren
      .map((child) => child && child.id)
      .filter((childId) => typeof childId === "string" && childId.length > 0);
    const childList = childIds.length > 0 ? childIds.join(", ") : "child WKs";

    addFinding(
      "warning",
      `${recordPath}: tracker ${record.id} has implements_slice child WKs (${childList}) but no local slices; tracker-local slices should be used unless a child WK needs independent lifecycle or ownership.`,
      {
        code: "tracker_child_slice_without_slices",
        path: recordPath,
        record_id: record.id,
        child_ids: childIds
      }
    );
  }
}

function isIndependentChildWorkRecord({ parent, child, allocatedWorkRecordRecordsById }) {
  if (!child || typeof child.id !== "string" || child.id.length === 0) {
    return false;
  }

  const loadedChild = allocatedWorkRecordRecordsById.get(child.id);
  const childRecord = loadedChild?.record;
  if (!childRecord || childRecord.id !== child.id || childRecord.record_kind !== "work_item") {
    return false;
  }

  return workRecordLinksBackToTracker(childRecord, parent.id);
}

function workRecordLinksBackToTracker(record, trackerId) {
  const relationshipFields = [record.related, record.depends_on, record.blocks];
  return relationshipFields.some((values) =>
    Array.isArray(values) && values.some((value) => value === trackerId)
  );
}

export async function lintRecordFiles({
  targetDir,
  manifest,
  allocatorState,
  allocatorStateValid,
  allocatedWorkRecordValues,
  allocatedWorkRecordRecordsById,
  pagesById,
  addFinding
}) {
  for (const [type, definition] of Object.entries(manifest.types)) {
    if (allocatorStateValid && definition.idStrategy === "allocated") {
      const rawStateValue = allocatorState?.[definition.stateKey];
      if (!Number.isInteger(rawStateValue) || rawStateValue < 0) {
        addFinding(
          "error",
          `Allocator state is malformed for '${definition.stateKey}' in wiki/.id-state.json`,
          { code: "invalid_allocator_state", path: "wiki/.id-state.json" }
        );
      } else {
        const materializedValues = await loadAllocatedRecordValues(
          targetDir,
          definition,
          type === "issue" ? allocatedWorkRecordValues : []
        );
        const highestMaterialized =
          materializedValues.length > 0 ? Math.max(...materializedValues) : 0;
        const materializedSet = new Set(materializedValues);
        const missingIds = [];

        for (let value = 1; value <= rawStateValue; value += 1) {
          if (!materializedSet.has(value)) {
            missingIds.push(formatAllocatedId(definition, value));
          }
        }

        if (highestMaterialized > rawStateValue) {
          addFinding(
            "error",
            `Allocator state for ${type} is behind canonical records: state=${rawStateValue} highest_materialized=${highestMaterialized}`,
            { code: "allocator_state_behind_records", path: "wiki/.id-state.json" }
          );
        }

        if (missingIds.length > 0) {
          const interiorGaps = missingIds.filter(
            (id) => parseAllocatedId(id) <= highestMaterialized
          );
          const gapKind =
            interiorGaps.length > 0 ? "interior gaps" : "trailing unused reservations";
          addFinding(
            "error",
            `Allocator inconsistency for ${type}: ${gapKind} detected (${missingIds.join(", ")})`,
            { code: "allocator_gap", path: definition.directory }
          );
        }
      }
    }

    if (isLegacyMarkdownWorkRecordDirectory(definition.directory)) {
      continue;
    }

    const files = await listRecordFiles(targetDir, definition);
    for (const filePath of files) {
      const relativeFilePath = path.relative(targetDir, filePath).replaceAll(path.sep, "/");
      const content = await readFile(filePath, "utf8");
      const frontMatter = extractFrontMatter(content);
      if (!frontMatter) {
        addFinding("error", `Missing YAML front matter: ${filePath}`, {
          code: "missing_frontmatter",
          path: relativeFilePath
        });
        continue;
      }

      for (const requiredField of definition.requiredFrontMatter) {
        if (
          !(requiredField in frontMatter) ||
          frontMatter[requiredField] === null ||
          frontMatter[requiredField] === ""
        ) {
          addFinding("error", `Missing field '${requiredField}' in ${filePath}`, {
            code: "missing_required_field",
            path: relativeFilePath
          });
        }
      }

      for (const fieldName of definition.arrayFrontMatter || []) {
        if (
          fieldName in frontMatter &&
          frontMatter[fieldName] !== null &&
          !Array.isArray(frontMatter[fieldName])
        ) {
          addFinding("error", `Field '${fieldName}' must be a list in ${filePath}`, {
            code: "invalid_array_field",
            path: relativeFilePath
          });
        }
      }

      for (const fieldName of definition.objectFrontMatter || []) {
        if (
          fieldName in frontMatter &&
          frontMatter[fieldName] !== null &&
          (typeof frontMatter[fieldName] !== "object" || Array.isArray(frontMatter[fieldName]))
        ) {
          addFinding("error", `Field '${fieldName}' must be an object in ${filePath}`, {
            code: "invalid_object_field",
            path: relativeFilePath
          });
        }
      }

      for (const [fieldName, allowedValues] of Object.entries(
        definition.enumFrontMatter || {}
      )) {
        if (
          fieldName in frontMatter &&
          frontMatter[fieldName] !== null &&
          frontMatter[fieldName] !== "" &&
          !allowedValues.includes(String(frontMatter[fieldName]).toLowerCase())
        ) {
          addFinding(
            "error",
            `Field '${fieldName}' has unsupported value '${frontMatter[fieldName]}' in ${filePath}`,
            {
              code: "invalid_enum_value",
              path: relativeFilePath
            }
          );
        }
      }

      const expectedStem = expectedFileStem(frontMatter, filePath, definition);
      const actualStem = path.basename(filePath, ".md");
      if (expectedStem && expectedStem !== actualStem) {
        addFinding(
          "error",
          `Canonical filename mismatch in ${filePath}: expected ${expectedStem}.md`,
          { code: "canonical_filename_mismatch", path: relativeFilePath }
        );
      }

      for (const fieldName of ["depends_on", "blocks", "related"]) {
        for (const relatedId of asStringList(frontMatter[fieldName])) {
          if (!isCanonicalWorkRecordReference(relatedId, allocatedWorkRecordRecordsById, pagesById)) {
            addFinding(
              "error",
              `${relativeFilePath}: referenced ${fieldName} entry does not exist: ${relatedId}`,
              { code: "missing_related_id", path: relativeFilePath }
            );
          }
        }
      }

      if (frontMatter.initiative) {
        const initiativeId = String(frontMatter.initiative);
        const initiativePage = pagesById.get(initiativeId);
        if (!initiativePage) {
          addFinding(
            "error",
            `${relativeFilePath}: referenced initiative does not exist: ${initiativeId}`,
            { code: "missing_initiative", path: relativeFilePath }
          );
        } else if (!initiativePage.relativePath.startsWith("wiki/initiatives/")) {
          addFinding(
            "error",
            `${relativeFilePath}: initiative must point to an initiative page: ${initiativeId}`,
            { code: "invalid_initiative_target", path: relativeFilePath }
          );
        }
      }

      if (frontMatter.supersedes) {
        const decisionId = String(frontMatter.supersedes);
        if (!pagesById.has(decisionId)) {
          addFinding(
            "error",
            `${relativeFilePath}: referenced supersedes entry does not exist: ${decisionId}`,
            { code: "missing_supersedes_target", path: relativeFilePath }
          );
        }
      }

      if (frontMatter.superseded_by) {
        const decisionId = String(frontMatter.superseded_by);
        if (!pagesById.has(decisionId)) {
          addFinding(
            "error",
            `${relativeFilePath}: referenced superseded_by entry does not exist: ${decisionId}`,
            { code: "missing_superseded_by_target", path: relativeFilePath }
          );
        }
      }

      for (const relativeRepoPath of asStringList(frontMatter.write_scope)) {
        const absoluteRepoPath = path.join(targetDir, relativeRepoPath);
        if (!(await pathExists(absoluteRepoPath))) {
          addFinding(
            "warning",
            `${relativeFilePath}: write_scope path does not exist in repo: ${relativeRepoPath}`,
            { code: "stale_write_scope", path: relativeFilePath }
          );
        }
      }
    }
  }
}

async function loadAllocatedRecordValues(targetDir, definition, extraValues = []) {
  const files = await listRecordFiles(targetDir, definition);
  const values = [];

  for (const filePath of files) {
    const stem = path.basename(filePath, ".md");
    const match = stem.match(new RegExp(`^${definition.prefix}-(\\d{4})$`));
    if (!match) {
      continue;
    }
    values.push(Number.parseInt(match[1], 10));
  }

  values.push(...extraValues);
  return values.sort((left, right) => left - right);
}
