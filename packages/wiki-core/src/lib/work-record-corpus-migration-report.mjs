

import path from "node:path";
import { readMarkdownPage, listRecordFiles } from "./wiki-page.mjs";
import { validateRecordByKind } from "./work-record-kind-registry.mjs";

export const CORPUS_MIGRATION_REPORT_SCHEMA_VERSION = "corpus-migration-report.v1";

const CORPUS_KINDS = Object.freeze([
  {
    kind: "decision",
    definition: Object.freeze({
      prefix: "DEC",
      directory: "wiki/decisions",
      filenameStrategy: "id_only"
    }),

    sectionKeys: Object.freeze(["context", "decision", "consequences"])
  },
  {
    kind: "initiative",
    definition: Object.freeze({
      prefix: "IN",
      directory: "wiki/initiatives",
      filenameStrategy: "id_only"
    }),

    sectionKeys: Object.freeze(["summary", "goals", "milestones"])
  }
]);

function sectionMapFromBody(markdownBody) {
  const sections = new Map();
  const lines = String(markdownBody ?? "").replaceAll("\r\n", "\n").split("\n");
  let currentSection = null;
  let sawTitle = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!sawTitle && /^#\s+/.test(trimmed)) {
      sawTitle = true;
      continue;
    }
    const sectionMatch = trimmed.match(/^##\s+(.+?)\s*$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim().toLowerCase();
      sections.set(currentSection, []);
      continue;
    }
    if (currentSection) {
      sections.get(currentSection).push(line);
    }
  }

  return sections;
}

function extractSections(markdownBody, sectionKeys) {
  const map = sectionMapFromBody(markdownBody);
  const sections = {};
  for (const key of sectionKeys) {
    if (!map.has(key)) {
      continue;
    }
    sections[key] = map
      .get(key)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join(" ");
  }
  return sections;
}

function buildCandidateRecord(kind, page, sectionKeys) {
  const frontmatter =
    page.frontmatter && typeof page.frontmatter === "object" && !Array.isArray(page.frontmatter)
      ? page.frontmatter
      : {};
  return {
    ...frontmatter,
    record_kind: kind,
    sections: extractSections(page.body, sectionKeys)
  };
}

function recordIdFor(page, filePath) {
  const fromFrontmatter = page.frontmatter?.id;
  if (typeof fromFrontmatter === "string" && fromFrontmatter.trim() !== "") {
    return fromFrontmatter;
  }
  return path.basename(filePath, ".md");
}

export async function buildCorpusMigrationReport({ repoRoot } = {}) {
  const targetDir = repoRoot ?? process.cwd();

  const examined = [];
  const drift = [];
  const failures = [];
  let cleanCount = 0;

  for (const { kind, definition, sectionKeys } of CORPUS_KINDS) {
    const filePaths = await listRecordFiles(targetDir, definition);
    filePaths.sort((left, right) => left.localeCompare(right));

    for (const filePath of filePaths) {
      const relativePath = path.relative(targetDir, filePath).replaceAll(path.sep, "/");
      let page;
      try {
        page = await readMarkdownPage(targetDir, filePath);
      } catch (error) {
        failures.push({
          id: path.basename(filePath, ".md"),
          path: relativePath,
          kind,
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }

      if (!page.frontmatter || typeof page.frontmatter !== "object") {
        failures.push({
          id: path.basename(filePath, ".md"),
          path: relativePath,
          kind,
          error: "missing or unparseable frontmatter block"
        });
        continue;
      }

      const id = recordIdFor(page, filePath);
      examined.push({ id, path: relativePath, kind });

      const candidate = buildCandidateRecord(kind, page, sectionKeys);
      const diagnostics = validateRecordByKind(candidate);

      if (diagnostics.length === 0) {
        cleanCount += 1;
        continue;
      }
      drift.push({ id, path: relativePath, kind, diagnostics });
    }
  }

  return {
    schema_version: CORPUS_MIGRATION_REPORT_SCHEMA_VERSION,
    totalExamined: examined.length,
    cleanCount,
    driftCount: drift.length,
    failureCount: failures.length,
    drift,
    failures
  };
}
