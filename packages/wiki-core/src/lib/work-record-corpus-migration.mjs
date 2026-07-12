

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { readMarkdownPage, listRecordFiles } from "./wiki-page.mjs";
import { getRecordKindSpec, validateRecordByKind } from "./work-record-kind-registry.mjs";
import { computeWorkRecordSourceDigest } from "./work-record-schema.mjs";

export const CORPUS_MIGRATION_SCHEMA_VERSION = "corpus-migration.v1";

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

function corpusKindFor(kind) {
  return CORPUS_KINDS.find((entry) => entry.kind === kind) ?? null;
}

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

function stringArrayFieldNames(spec) {
  const names = [];
  for (const table of [spec.requiredTopLevel, spec.optionalTopLevel]) {
    for (const [name, descriptor] of Object.entries(table)) {
      if (descriptor.type === "string_array") {
        names.push(name);
      }
    }
  }
  return names;
}

function specKnownFieldNames(spec) {
  return new Set([
    ...Object.keys(spec.requiredTopLevel),
    ...Object.keys(spec.optionalTopLevel)
  ]);
}

function pickSpecFrontmatter(frontmatter, spec) {
  const known = specKnownFieldNames(spec);
  const picked = {};
  for (const [name, value] of Object.entries(frontmatter)) {
    if (known.has(name)) {
      picked[name] = value;
    }
  }
  return picked;
}

function normalizeStringArrayFields(record, spec) {
  const normalized = [];
  for (const name of stringArrayFieldNames(spec)) {
    if (typeof record[name] === "string") {
      record[name] = [record[name]];
      normalized.push(name);
    }
  }
  return normalized;
}

export async function buildMigratedRecord({ repoRoot, kind, id, dir } = {}) {
  const targetRoot = repoRoot ?? process.cwd();
  const corpusKind = corpusKindFor(kind);
  const spec = getRecordKindSpec(kind);
  const directory = dir ?? corpusKind?.definition.directory ?? null;
  const relativePath = directory ? `${directory}/${id}.md` : `${id}.md`;

  if (!corpusKind || !spec) {
    return {
      id,
      kind,
      path: relativePath,
      record: null,
      source_digest: null,
      normalizedFields: [],
      diagnostics: [
        {
          code: "unsupported_record_kind",
          severity: "error",
          message: `Unsupported corpus record kind: ${kind}`,
          path: "record_kind"
        }
      ],
      error: null
    };
  }

  const filePath = path.join(targetRoot, directory, `${id}.md`);

  let page;
  try {
    page = await readMarkdownPage(targetRoot, filePath);
  } catch (error) {
    return {
      id,
      kind,
      path: relativePath,
      record: null,
      source_digest: null,
      normalizedFields: [],
      diagnostics: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }

  if (!page.frontmatter || typeof page.frontmatter !== "object" || Array.isArray(page.frontmatter)) {
    return {
      id,
      kind,
      path: relativePath,
      record: null,
      source_digest: null,
      normalizedFields: [],
      diagnostics: [],
      error: "missing or unparseable frontmatter block"
    };
  }

  const record = {
    ...pickSpecFrontmatter(page.frontmatter, spec),
    record_kind: kind,
    sections: extractSections(page.body, corpusKind.sectionKeys)
  };

  const normalizedFields = normalizeStringArrayFields(record, spec);
  const source_digest = computeWorkRecordSourceDigest(record);
  const diagnostics = validateRecordByKind(record);

  return {
    id,
    kind,
    path: relativePath,
    record,
    source_digest,
    normalizedFields,
    diagnostics,
    error: null
  };
}

function serializeRecord(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export async function migrateCorpus({ repoRoot, write = false } = {}) {
  const targetRoot = repoRoot ?? process.cwd();

  const written = [];
  const drift = [];
  const failures = [];
  let clean = 0;

  for (const { kind, definition } of CORPUS_KINDS) {
    const filePaths = await listRecordFiles(targetRoot, definition);
    filePaths.sort((left, right) => left.localeCompare(right));

    for (const filePath of filePaths) {
      const id = path.basename(filePath, ".md");
      const built = await buildMigratedRecord({
        repoRoot: targetRoot,
        kind,
        id,
        dir: definition.directory
      });

      if (built.error) {
        failures.push({ id, path: built.path, kind, error: built.error });
        continue;
      }

      if (built.normalizedFields.length > 0) {
        drift.push({ id, path: built.path, kind, normalized: built.normalizedFields });
      }

      if (built.diagnostics.length > 0) {
        failures.push({ id, path: built.path, kind, diagnostics: built.diagnostics });
        continue;
      }

      clean += 1;

      if (write === true) {
        const jsonPath = path.join(targetRoot, definition.directory, `${id}.json`);
        await mkdir(path.dirname(jsonPath), { recursive: true });
        await writeFile(jsonPath, serializeRecord(built.record), "utf8");
        written.push({ id, path: `${definition.directory}/${id}.json`, kind });
      }
    }
  }

  return {
    schema_version: CORPUS_MIGRATION_SCHEMA_VERSION,
    written,
    clean,
    drift,
    failures
  };
}
