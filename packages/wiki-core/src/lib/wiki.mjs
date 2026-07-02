

import { mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadManifest } from "./contract.mjs";
import {
  WORK_RECORD_SCHEMA_VERSION,
  canonicalizeWorkRecordReadScope,
  validateWorkRecord
} from "./work-record-schema.mjs";

import {
  GENERATED_VIEW_NAMES,
  ensureDirectory,
  normalizeExtensionNamespaces,
  normalizeType,
  pathExists,
  slugify,
  today
} from "./wiki-shared.mjs";
import {
  formatAllocatedId,
  nextAllocatedRecordValue,
  normalizeAllocatedRecordId,
  parseAllocatedIdValue,
  readOrInitializeAllocatorState,
  withAllocatorLock,
  writeAllocatorStateAtomically
} from "./wiki-allocator.mjs";
import { renderTemplate } from "./wiki-scaffold.mjs";
import {
  listRecordFiles,
  readMarkdownPage,
  walkMarkdownFiles
} from "./wiki-page.mjs";

export {
  DEFAULT_PROFILE,
  GENERATED_VIEW_NAMES,
  ensureDirectory,
  normalizeExtensionNamespaces,
  normalizeStringList,
  normalizeType,
  pathExists,
  resolveProfileName,
  slugify,
  today
} from "./wiki-shared.mjs";
export {
  extractFrontMatter,
  extractMarkdownBody
} from "./wiki-frontmatter.mjs";
export {
  expectedFileStem,
  isCanonicalRecordFile,
  listRecordFiles,
  readMarkdownPage,
  walkMarkdownFiles
} from "./wiki-page.mjs";
export {
  extractExplicitRetrievalFacets,
  getSharedTopics,
  inferPageFacets,
  matchesSupportedInferencePath,
  normalizeInferenceConfig,
  normalizeTopicVocabulary,
  resolvePageFacets,
  validateRetrievalRoleValues
} from "./wiki-facets.mjs";
export {
  ensureAllocatorState,
  getAllocatorPaths,
  nextId
} from "./wiki-allocator.mjs";
export {
  buildExpectedMetadata,
  compareContractMetadata,
  readContractMetadata,
  resolveContractContext,
  validateContractMetadataShape,
  writeContractMetadata
} from "./wiki-contract-metadata.mjs";
export {
  buildCoreFileContents,
  ensureAdoptionInitiative,
  ensureCatalog,
  ensureCoreSurfaces,
  readTemplate,
  renderTemplate,
  syncCoreFiles,
  syncTemplates
} from "./wiki-scaffold.mjs";

function buildCreatedIssueWorkRecord({ id, title, date, repo }) {
  return {
    schema_version: WORK_RECORD_SCHEMA_VERSION,
    id,
    repo,
    title,
    record_kind: "work_item",
    work_kind: "implementation",
    status: "inbox",
    priority: "medium",
    owner: "unassigned",
    created: date,
    updated: date,
    resolution: "unresolved",
    docs: [],
    repo_paths: [],
    write_scope: [],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: null,
      target_unit: "none",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: [
        "intended behavior or invariant is explicit",
        "verification plan or regression coverage is identified"
      ],
      validation: []
    },
    sections: {
      summary: "Describe the failure mode, system boundary, capability, or invariant this item tracks.",
      why_it_matters:
        "State the operational impact and what future readers should understand from this work.",
      scope: {
        items: [
          "impacted boundary or area is explicit",
          "intended invariant or behavior is explicit",
          "out-of-scope work is explicit when useful"
        ],
        out_of_scope: []
      },
      tasks: [
        {
          text: "",
          status: "todo"
        }
      ],
      references: [],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices: [],
    escalations: [],
    projections: [],
    migration: null
  };
}

function validateCreatedWorkRecord(record, sourcePath) {
  const diagnostics = validateWorkRecord(record, { sourcePath });
  if (diagnostics.length > 0) {
    const message = diagnostics.map((diagnostic) => diagnostic.message).join("; ");
    throw new Error(`Invalid created work record: ${message}`);
  }
}

async function writeAllocatedIssueRecord({
  targetDir,
  recordId,
  record: inputRecord
}) {

  const record = canonicalizeWorkRecordReadScope(inputRecord);

  const markdownRelativeFile = path.join("wiki", "issues", `${recordId}.md`);
  const markdownAbsoluteFile = path.join(targetDir, markdownRelativeFile);
  const jsonRelativeFile = path.join("wiki", "work-records", `${recordId}.json`);
  const jsonAbsoluteFile = path.join(targetDir, jsonRelativeFile);

  await ensureDirectory(path.dirname(jsonAbsoluteFile));

  if (await pathExists(markdownAbsoluteFile)) {
    throw new Error(`Canonical record already exists: ${markdownRelativeFile}`);
  }
  if (await pathExists(jsonAbsoluteFile)) {
    throw new Error(`Canonical record already exists: ${jsonRelativeFile}`);
  }

  const tempDir = await mkdtemp(path.join(targetDir, "wiki", ".record-tmp-"));
  const tempJsonPath = path.join(tempDir, `${recordId}.json`);

  try {
    validateCreatedWorkRecord(record, jsonRelativeFile);
    await writeFile(tempJsonPath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    await rename(tempJsonPath, jsonAbsoluteFile);
  } catch (error) {
    await rm(jsonAbsoluteFile, { force: true });
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return {
    markdownRelativeFile,
    markdownAbsoluteFile,
    jsonRelativeFile,
    jsonAbsoluteFile
  };
}

export async function createRecord({ targetDir, type, title, id = null, repo = null }) {
  const manifest = await loadManifest();
  const normalizedType = normalizeType(type, manifest);
  const definition = manifest.types[normalizedType];
  const date = today();

  if (definition.idStrategy === "allocated") {
    return withAllocatorLock(targetDir, async () => {
      const state = await readOrInitializeAllocatorState(targetDir, manifest);
      const stateValue = Number.parseInt(state[definition.stateKey] ?? 0, 10);
      const nextValue = await nextAllocatedRecordValue(targetDir, definition, stateValue);
      const requestedId = normalizeAllocatedRecordId(id, definition, normalizedType);
      if (requestedId && requestedId !== formatAllocatedId(definition, nextValue)) {
        throw new Error(
          `Cannot create ${normalizedType} with ${requestedId}; expected ${formatAllocatedId(definition, nextValue)}`
        );
      }

      const idValue = requestedId ? parseAllocatedIdValue(requestedId, definition) : nextValue;
      const recordId = formatAllocatedId(definition, idValue);
      const issueRecord = normalizedType === "issue"
        ? buildCreatedIssueWorkRecord({ id: recordId, title, date, repo })
        : null;

      const createdPaths = issueRecord
        ? await writeAllocatedIssueRecord({
            targetDir,
            recordId,
            record: issueRecord
          })
        : await (async () => {
            const rendered = await renderTemplate({
              type: normalizedType,
              title,
              id: recordId,
              date
            });
            const relativeFile = path.join(definition.directory, `${recordId}.md`);
            const absoluteFile = path.join(targetDir, relativeFile);
            await ensureDirectory(path.dirname(absoluteFile));
            if (await pathExists(absoluteFile)) {
              throw new Error(`Canonical record already exists: ${relativeFile}`);
            }

            const tempDir = await mkdtemp(path.join(path.dirname(absoluteFile), ".record-tmp-"));
            const tempPath = path.join(tempDir, `${recordId}.md`);
            try {
              await writeFile(tempPath, rendered, { encoding: "utf8", flag: "wx" });
              await rename(tempPath, absoluteFile);
            } finally {
              await rm(tempDir, { recursive: true, force: true });
            }

            return {
              markdownRelativeFile: relativeFile,
              markdownAbsoluteFile: absoluteFile,
              jsonRelativeFile: null,
              jsonAbsoluteFile: null
            };
          })();

      try {
        state[definition.stateKey] = Math.max(stateValue, idValue);
        await writeAllocatorStateAtomically(targetDir, state);
      } catch (error) {
        await rm(createdPaths.markdownAbsoluteFile, { force: true });
        if (createdPaths.jsonAbsoluteFile) {
          await rm(createdPaths.jsonAbsoluteFile, { force: true });
        }
        throw error;
      }

      return {
        id: recordId,
        relativeFile: createdPaths.jsonRelativeFile || createdPaths.markdownRelativeFile,
        absoluteFile: createdPaths.jsonAbsoluteFile || createdPaths.markdownAbsoluteFile,
        jsonRelativeFile: createdPaths.jsonRelativeFile,
        jsonAbsoluteFile: createdPaths.jsonAbsoluteFile,
        type: normalizedType
      };
    });
  }

  if (id != null) {
    throw new Error(`${normalizedType} does not accept explicit IDs`);
  }

  const slugId = slugify(title) || "replace-me";
  const rendered = await renderTemplate({
    type: normalizedType,
    title,
    id: slugId,
    date
  });
  const relativeFile = path.join(definition.directory, `${slugId}.md`);
  const absoluteFile = path.join(targetDir, relativeFile);
  await ensureDirectory(path.dirname(absoluteFile));
  if (await pathExists(absoluteFile)) {
    throw new Error(`Canonical record already exists: ${relativeFile}`);
  }
  await writeFile(absoluteFile, rendered, { encoding: "utf8", flag: "wx" });

  return {
    id: slugId,
    relativeFile,
    absoluteFile,
    jsonRelativeFile: null,
    jsonAbsoluteFile: null,
    type: normalizedType
  };
}

export async function loadCanonicalState(
  targetDir,
  { extensionNamespaces = [], workRecords = null } = {}
) {
  const manifest = await loadManifest();
  const wikiDir = path.join(targetDir, "wiki");
  const topLevelWikiPaths = await loadTopLevelWikiPaths(wikiDir);
  const docsDir = path.join(targetDir, "docs");
  const normalizedExtensions = normalizeExtensionNamespaces(extensionNamespaces);

  const [
    issues,
    initiatives,
    areas,
    sources,
    decisions,
    docs,
    wikiPages,
    extensionPages,
    workRecordLoads
  ] =
    await Promise.all([
      readPagesForType(targetDir, manifest.types.issue),
      readPagesForType(targetDir, manifest.types.initiative),
      readPagesForType(targetDir, manifest.types.area),
      readPagesForType(targetDir, manifest.types.source),
      readPagesForType(targetDir, manifest.types.decision),
      readPagesFromPaths(targetDir, await walkMarkdownFiles(docsDir)),
      readPagesFromPaths(targetDir, topLevelWikiPaths),
      readExtensionPages(targetDir, normalizedExtensions),
      workRecords === null ? readCanonicalWorkRecordLoads(targetDir) : workRecords
    ]);

  const pagesById = new Map();
  for (const page of [...issues, ...initiatives, ...sources, ...decisions]) {
    const id = page.frontmatter?.id;
    if (id) {
      pagesById.set(String(id), page);
    }
  }

  return {
    issues,
    initiatives,
    areas,
    sources,
    decisions,
    docs,
    wikiPages,
    extensionPages,

    workRecords: workRecordLoads,
    extensionNamespaces: normalizedExtensions,
    pagesById
  };
}

async function loadTopLevelWikiPaths(wikiDir) {
  if (!(await pathExists(wikiDir))) {
    return [];
  }

  const entries = await readdir(wikiDir, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        !GENERATED_VIEW_NAMES.has(entry.name)
    )
    .map((entry) => path.join(wikiDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function readPagesForType(targetDir, definition) {
  const filePaths = await listRecordFiles(targetDir, definition);
  return readPagesFromPaths(targetDir, filePaths);
}

async function readPagesFromPaths(targetDir, filePaths) {
  return Promise.all(filePaths.map((filePath) => readMarkdownPage(targetDir, filePath)));
}

async function readExtensionPages(targetDir, extensionNamespaces) {
  const filePaths = [];
  for (const namespace of extensionNamespaces) {
    const namespaceDir = path.join(targetDir, "wiki", namespace);
    filePaths.push(...(await walkMarkdownFiles(namespaceDir)));
  }
  return readPagesFromPaths(targetDir, filePaths);
}

async function readCanonicalWorkRecordLoads(targetDir) {
  const {
    getWorkRecordDirectory,
    listWorkRecordJsonPaths,
    loadWorkRecordByPath
  } = await import("./work-record-store.mjs");

  const workRecordDirectory = getWorkRecordDirectory(targetDir);
  const discoveredPaths = await listWorkRecordJsonPaths(targetDir);
  const canonicalWorkRecordPaths = discoveredPaths.filter((workRecordPath) => {
    return (
      path.dirname(workRecordPath) === workRecordDirectory &&
      /^WK-\d{4}\.json$/.test(path.basename(workRecordPath))
    );
  });

  return Promise.all(
    canonicalWorkRecordPaths.map((workRecordPath) =>
      loadWorkRecordByPath({ dir: targetDir, path: workRecordPath })
    )
  );
}
