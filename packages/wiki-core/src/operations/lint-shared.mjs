import { readdir } from "node:fs/promises";
import path from "node:path";
import { SLICE_ID_PATTERN } from "../lib/work-record-schema-constants.mjs";

export function createLintFindings() {
  const findings = [];
  const problems = [];
  const warnings = [];
  const addFinding = (severity, message, details = {}) => {
    const { code = "unspecified", path: findingPath = null, ...rest } = details;
    const finding = {
      severity,
      message,
      code,
      path: findingPath,
      ...rest
    };
    findings.push(finding);
    if (severity === "error") {
      problems.push(message);
    } else if (severity === "warning") {
      warnings.push(message);
    }
  };
  return { findings, problems, warnings, addFinding };
}

export async function* walkFilesUnder(dirPath) {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      yield* walkFilesUnder(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

export function backlinkComment(id, relation) {
  return `<!-- wiki: id=${id} relation=${relation} -->`;
}

export function asStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry));
}

export function isCrossRepoQualifiedReference(ref) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*:/.test(String(ref));
}

export function isCanonicalWorkRecordReference(id, loadedWorkRecordsById, pagesById) {
  const normalizedId = String(id);
  if (isCrossRepoQualifiedReference(normalizedId)) {
    return true;
  }

  const sliceQualifiedMatch = normalizedId.match(/^(WK-\d{4})#(.+)$/);
  if (sliceQualifiedMatch) {
    const [, workRecordId, sliceId] = sliceQualifiedMatch;
    if (!SLICE_ID_PATTERN.test(sliceId)) {
      return false;
    }

    const loadedWorkRecord = loadedWorkRecordsById.get(workRecordId);
    if (!loadedWorkRecord) {
      return false;
    }

    const slices = Array.isArray(loadedWorkRecord.record?.slices)
      ? loadedWorkRecord.record.slices
      : [];
    return slices.some((slice) => slice && slice.id === sliceId);
  }

  if (!/^WK-\d{4}$/.test(normalizedId)) {
    return pagesById.has(normalizedId);
  }

  if (loadedWorkRecordsById.has(normalizedId)) {
    return true;
  }

  const legacyPage = pagesById.get(normalizedId);
  return Boolean(legacyPage && legacyPage.relativePath.startsWith("wiki/issues/"));
}

export function hasBacklink(docPage, expectedId, expectedRelation) {
  return docPage.backlinks.some(
    (backlink) => backlink.id === expectedId && backlink.relation === expectedRelation
  );
}

export function isClosedStatus(status) {
  return ["done", "cancelled", "deprecated", "duplicate", "superseded", "expired", "wont_do"].includes(
    String(status ?? "").toLowerCase()
  );
}

const LEGACY_MARKDOWN_WORK_RECORD_DIRECTORY = "wiki/issues";
const LEGACY_MARKDOWN_WORK_RECORD_PATH_PATTERN = /^wiki\/issues\/WK-\d{4}\.md$/;

export function isLegacyMarkdownWorkRecordDirectory(directory) {
  return String(directory ?? "") === LEGACY_MARKDOWN_WORK_RECORD_DIRECTORY;
}

export function isLegacyMarkdownWorkRecordPage(page) {
  return LEGACY_MARKDOWN_WORK_RECORD_PATH_PATTERN.test(String(page?.relativePath ?? ""));
}

export function buildLintNextAction({ errorCount, warningCount, findingsTruncated }) {
  if (errorCount > 0) {
    const noun = errorCount === 1 ? "error" : "errors";
    return findingsTruncated
      ? `fix the listed ${noun} and rerun lint to reveal the remaining findings`
      : `fix the listed ${noun} and rerun lint`;
  }

  if (warningCount > 0) {
    const noun = warningCount === 1 ? "warning" : "warnings";
    return findingsTruncated
      ? `review the listed ${noun} and rerun lint to confirm there are no additional findings`
      : `review the listed ${noun} and rerun lint`;
  }

  return "no action needed; the repository already passes lint";
}

export function parseDate(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

export function daysSince(date) {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function parseAllocatedId(id) {
  const match = String(id).match(/-(\d{4})$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function formatAllocatedId(definition, value) {
  return `${definition.prefix}-${String(value).padStart(4, "0")}`;
}

export function normalizeDiagnosticPath(targetDir, diagnosticPath) {
  if (!diagnosticPath) {
    return null;
  }

  const value = String(diagnosticPath);
  if (path.isAbsolute(value)) {
    return path.relative(targetDir, value).replaceAll(path.sep, "/");
  }

  return value.replaceAll("\\", "/");
}

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isString(value) {
  return typeof value === "string";
}
