

import { lstat, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadManifest } from "./contract.mjs";
import {
  getKindRecordPath,
  writeValidatedKindRecord
} from "./kind-record-store.mjs";
import { WORK_RECORD_PUBLICATION_STATES, persistenceOutcomeFields } from
  "../operations/work-record-persistence-diagnostics.mjs";
import { controlledContractContentDigest } from "./controlled-contract-tools.mjs";
import { extractFrontMatter, extractMarkdownBody } from "./wiki-frontmatter.mjs";

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
  getAllocatorPaths,
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

function buildCreatedDecisionRecord({ id, title, date, actor }) {
  return {
    id,
    record_kind: "decision",
    title,
    status: "proposed",
    date,
    owners: [],
    updated: date,
    updated_by: actor,
    sections: {
      context: "",
      decision: "",
      consequences: ""
    }
  };
}

function buildCreatedInitiativeRecord({ id, title, date, actor }) {
  return {
    id,
    record_kind: "initiative",
    title,
    status: "todo",
    priority: "medium",
    owner: "unassigned",
    created: date,
    updated: date,
    updated_by: actor,
    sections: {
      summary: "",
      goals: "",
      milestones: ""
    }
  };
}

async function writeCreatedKindRecord({ targetDir, recordId, kind, record }) {
  const jsonRelativeFile = await getKindRecordPath(kind, recordId);
  if (!jsonRelativeFile) {
    throw new Error(`Cannot resolve canonical path for ${kind} ${recordId}`);
  }
  const markdownRelativeFile = jsonRelativeFile.replace(/\.json$/, ".md");
  const jsonAbsoluteFile = path.join(targetDir, jsonRelativeFile);
  const markdownAbsoluteFile = path.join(targetDir, markdownRelativeFile);

  await assertCreatedPathAbsent(jsonAbsoluteFile, jsonRelativeFile);
  await assertCreatedPathAbsent(markdownAbsoluteFile, markdownRelativeFile);

  const result = await writeValidatedKindRecord({ repoRoot: targetDir, record });
  if (!result.ok || !result.written) {
    const message = (result.diagnostics ?? [])
      .map((diagnostic) => diagnostic.message)
      .join("; ");
    const prefix = result.publication_state === WORK_RECORD_PUBLICATION_STATES.PUBLISHED
      ? `Published ${kind} record; persistence failed`
      : result.publication_state === WORK_RECORD_PUBLICATION_STATES.UNKNOWN
        ? `Publication uncertain for created ${kind} record`
        : result.diagnostics.some(diagnostic => diagnostic.category === "kind_record_write_failed")
          ? `Could not publish created ${kind} record` : `Invalid created ${kind} record`;
    throw Object.assign(new Error(`${prefix}: ${message}`),
      { code: result.diagnostics[0].code, diagnostics: result.diagnostics,
        details: { publication_state: result.publication_state ?? WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED, persistence: result } });
  }

  return {
    markdownRelativeFile,
    markdownAbsoluteFile,
    jsonRelativeFile,
    jsonAbsoluteFile,
    record, revision: result.source_digest
  };
}

async function assertCreatedPathAbsent(absoluteFile, relativeFile) {
  try { await lstat(absoluteFile); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw Object.assign(new Error(`Canonical record already exists: ${relativeFile}`),
    { code: "create_record_target_exists", details: { changed: false, path: relativeFile } });
}

async function readCreatedMarkdown({ absoluteFile, relativeFile, rendered }) {
  let bytes;
  try {
    bytes = await readFile(absoluteFile, "utf8");
    if (bytes !== rendered) throw Object.assign(new Error("Published creation source moved before readback"),
      { code: "create_record_readback_moved" });
    return { path: relativeFile, content_digest: controlledContractContentDigest(bytes),
      frontmatter: extractFrontMatter(bytes), body: extractMarkdownBody(bytes) };
  } catch (error) {
    error.details = { ...error.details, publication_state: WORK_RECORD_PUBLICATION_STATES.PUBLISHED,
      changed: true, retry_safe: false, path: relativeFile };
    throw error;
  }
}

async function publishCreatedWorkItem({ targetDir, recordId, title, date, repo, initial, birthOptions }) {
  const { withCanonicalWorkRecordBirthLease } = await import("../operations/work-records-store-io.mjs");
  const { resolveBirthProofAuthoringSource } = await import("../operations/controlled-contract/proof-authoring-source.mjs");
  const { prepareRecordAuthoringChange } = await import("../operations/record-authoring-plan.mjs");
  const { settlePreparedRecordAuthoring } = await import("../operations/controlled-contract/proof-authoring-targets.mjs");
  const { loadControlledContractProofAuthoring } = await import("../operations/controlled-contract/package-runtime.mjs");
  const { observeRecordAuthoringAssessment } = await import("../operations/save-record.mjs");
  const markdownRelativeFile = path.join("wiki", "issues", `${recordId}.md`);
  const markdownAbsoluteFile = path.join(targetDir, markdownRelativeFile);
  await assertCreatedPathAbsent(markdownAbsoluteFile, markdownRelativeFile);
  const target = { repoRoot: targetDir, wkId: recordId, selectedUnit: null, focus: null };
  return withCanonicalWorkRecordBirthLease({ dir: targetDir, id: recordId, title, date, repo }, async ({ lease, canonical_record_path }) => {
    const source = await resolveBirthProofAuthoringSource({ ...target, recordLease: lease });
    const plan = await prepareRecordAuthoringChange({ capturedSource: source, context: "birth", changes: initial ?? {},
      owners: { pkg: await loadControlledContractProofAuthoring(), ...birthOptions.owners, now: () => date } });
    if (!plan.ok) throw Object.assign(new TypeError("Invalid initial record meaning; correct the addressed initial fields"),
      { code: "create_record_initial_invalid", diagnostics: plan.diagnostics, details: { changed: false } });
    const settled = await settlePreparedRecordAuthoring({ input: target, initial: source, preparation: plan.preparation,
      options: { ...birthOptions, observeCommitted: snapshot => observeRecordAuthoringAssessment(target, snapshot, birthOptions) } });
    return { markdownRelativeFile, markdownAbsoluteFile,
      jsonRelativeFile: path.relative(targetDir, canonical_record_path), jsonAbsoluteFile: canonical_record_path,
      revision: settled.snapshot.authoringIdentity, record: settled.snapshot.record,
      record_source_digest: settled.snapshot.recordSourceDigest,
      bindings: plan.bindings, entries: plan.entries, criterion_identity_changes: plan.criterion_identity_changes,
      changed_fields: plan.changed_fields, receipt: settled.receipt, ...settled.observed };
  });
}

export async function createRecord({ targetDir, type, title, id = null, repo = null, initial, birthOptions = {} }) {
  const manifest = await loadManifest();
  const normalizedType = normalizeType(type, manifest);
  const definition = manifest.types[normalizedType];
  const date = birthOptions.now?.() ?? today();
  if (initial !== undefined) {
    const { validateRecordAuthoringChanges } = await import("./record-authoring-schema.mjs");
    const diagnostics = validateRecordAuthoringChanges(normalizedType === "issue" ? "work_item" : normalizedType, "birth", initial);
    if (diagnostics.length) throw Object.assign(new TypeError("Invalid initial record meaning; correct the addressed initial fields"),
      { code: "create_record_initial_invalid", diagnostics, details: { changed: false } });
    if (Object.hasOwn(initial, "title") && initial.title !== title) throw Object.assign(
      new TypeError("initial.title must agree with the authoritative creation title"), {
        code: "create_record_initial_invalid", details: { changed: false }, diagnostics: [{
          code: "create_record_title_conflict", severity: "error", path: "initial.title",
          message: "initial.title must agree with the authoritative creation title" }] });
    if (normalizedType === "source" || normalizedType === "area") {
      const { prepareSourceAreaRecordBirth } = await import("../operations/create.mjs");
      await prepareSourceAreaRecordBirth({ kind: normalizedType, title, initial, date, id: "prospective" });
      if (normalizedType === "area" && !slugify(title)) throw Object.assign(new TypeError("Area title produces an empty slug; supply a title with slug characters"),
        { code: "create_record_area_slug_empty", details: { changed: false } });
    }
  }

  if (definition.idStrategy === "allocated") {
    let allocation = null, published = null, allocatorAdvanced = false;
    try { return await withAllocatorLock(targetDir, async () => {
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
      allocation = { id: recordId, type: normalizedType, allocator_state_advanced: false,
        relativeFile: normalizedType === "issue"
          ? path.relative(targetDir, (await import("./work-record-store.mjs")).getWorkRecordPath(targetDir, recordId))
          : path.join(definition.directory, `${recordId}.${normalizedType === "source" ? "md" : "json"}`) };

      const actor = os.userInfo().username;

      const createdPaths = normalizedType === "issue"
        ? await publishCreatedWorkItem({ targetDir, recordId, title, date,
            repo: repo ?? (await import("./wiki-contract-metadata.mjs").then(owner => owner.resolveContractContext(targetDir))).repo,
            initial, birthOptions })
        : normalizedType === "decision" || normalizedType === "initiative"
        ? await writeCreatedKindRecord({
            targetDir,
            recordId,
            kind: normalizedType,
            record: await (async () => {
              const record = normalizedType === "decision"
                ? buildCreatedDecisionRecord({ id: recordId, title, date, actor })
                : buildCreatedInitiativeRecord({ id: recordId, title, date, actor });
              if (initial === undefined) return record;
              const { planKindRecordAuthoringChange } = await import("../operations/record-authoring-plan.mjs");
              const plan = planKindRecordAuthoringChange({ record, changes: initial, actor, now: date, context: "birth" });
              if (!plan.ok) throw Object.assign(new TypeError("Invalid initial kind record meaning"),
                { code: "create_record_initial_invalid", diagnostics: plan.diagnostics, details: { changed: false } });
              return plan.updatedRecord;
            })()
          })
        : await (async () => {
            const rendered = initial === undefined ? await renderTemplate({ type: normalizedType, title, id: recordId, date })
              : (await import("../operations/create.mjs").then(owner => owner.prepareSourceAreaRecordBirth({
                kind: normalizedType, title, initial, id: recordId, date }))).markdown;
            const relativeFile = path.join(definition.directory, `${recordId}.md`);
            const absoluteFile = path.join(targetDir, relativeFile);
            await ensureDirectory(path.dirname(absoluteFile));
            await assertCreatedPathAbsent(absoluteFile, relativeFile);

            const tempDir = await mkdtemp(path.join(path.dirname(absoluteFile), ".record-tmp-"));
            const tempPath = path.join(tempDir, `${recordId}.md`);
            let primary = null;
            let publicationState = WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED;
            try {
              await writeFile(tempPath, rendered, { encoding: "utf8", flag: "wx" });
              publicationState = WORK_RECORD_PUBLICATION_STATES.UNKNOWN;
              await rename(tempPath, absoluteFile);
              publicationState = WORK_RECORD_PUBLICATION_STATES.PUBLISHED;
            } catch (error) {
              primary = error;
              error.details = { ...error.details, publication_state: publicationState };
              throw error;
            } finally {
              try { await rm(tempDir, { recursive: true, force: true }); }
              catch (error) {
                if (primary === null) {
                  error.details = { ...error.details, publication_state: publicationState };
                  throw error;
                }
                primary.cleanup_failures = [...(primary.cleanup_failures ?? []),
                  { step: "source_stage_cleanup", code: error.code ?? null, message: error.message, error }];
              }
            }

            return {
              markdownRelativeFile: relativeFile,
              markdownAbsoluteFile: absoluteFile,
              jsonRelativeFile: null,
              jsonAbsoluteFile: null,
              ...(initial === undefined ? {} : { source: await readCreatedMarkdown({ absoluteFile, relativeFile, rendered }) })
            };
          })();

      published = createdPaths;
      state[definition.stateKey] = Math.max(stateValue, idValue);
      try { await writeAllocatorStateAtomically(targetDir, state); }
      catch (error) {

        try {
          const observed = JSON.parse(await readFile(getAllocatorPaths(targetDir).statePath, "utf8"));
          allocatorAdvanced = Number.isInteger(observed[definition.stateKey])
            ? observed[definition.stateKey] >= idValue : null;
        } catch (observation) {
          allocatorAdvanced = null;
          error.allocator_observation = { code: observation.code ?? null, message: observation.message };
        }
        throw error;
      }
      allocatorAdvanced = true;

      return {
        ...createdPaths,
        ...persistenceOutcomeFields(WORK_RECORD_PUBLICATION_STATES.PUBLISHED, { ok: true }),
        allocator_state_advanced: true,
        id: recordId,
        relativeFile: createdPaths.jsonRelativeFile || createdPaths.markdownRelativeFile,
        absoluteFile: createdPaths.jsonAbsoluteFile || createdPaths.markdownAbsoluteFile,
        jsonRelativeFile: createdPaths.jsonRelativeFile,
        jsonAbsoluteFile: createdPaths.jsonAbsoluteFile,
        type: normalizedType
      };
    }, { faultInjector: birthOptions.allocatorLockFaultInjector }); }
    catch (error) {
      if (allocation !== null) {
        const details = error.details ?? {};
        const state = published !== null || details.changed === true || details.publication_outcome === "established"
          ? WORK_RECORD_PUBLICATION_STATES.PUBLISHED
          : details.changed === false || details.settlement_status === "compensated"
            ? WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED : details.publication_state ?? WORK_RECORD_PUBLICATION_STATES.UNKNOWN;
        error.creation = { ...allocation, ...persistenceOutcomeFields(state), allocator_state_advanced: allocatorAdvanced,
          consumed_id: state === WORK_RECORD_PUBLICATION_STATES.PUBLISHED || allocatorAdvanced === true
            ? allocation.id : state === WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED && allocatorAdvanced === false ? null : "unknown",
          ...(published === null ? {} : { relativeFile: published.jsonRelativeFile || published.markdownRelativeFile,
            revision: published.revision ?? null, receipt: published.receipt ?? null }),
          recovery: "Inspect the allocated subject and reported participant effects; do not repeat creation blindly." };
      }
      throw error;
    }
  }

  if (id != null) {
    throw new Error(`${normalizedType} does not accept explicit IDs`);
  }

  const slugId = slugify(title) || "replace-me";
  const rendered = initial === undefined ? await renderTemplate({ type: normalizedType, title, id: slugId, date })
    : (await import("../operations/create.mjs").then(owner => owner.prepareSourceAreaRecordBirth({
      kind: normalizedType, title, initial, id: slugId, date }))).markdown;
  const relativeFile = path.join(definition.directory, `${slugId}.md`);
  const absoluteFile = path.join(targetDir, relativeFile);
  await ensureDirectory(path.dirname(absoluteFile));
  await assertCreatedPathAbsent(absoluteFile, relativeFile);
  let source;
  try {
    await writeFile(absoluteFile, rendered, { encoding: "utf8", flag: "wx" });
    if (initial !== undefined) source = await readCreatedMarkdown({ absoluteFile, relativeFile, rendered });
  } catch (error) {
    error.creation = { id: slugId, type: normalizedType, relativeFile,
      ...persistenceOutcomeFields(error.details?.publication_state ?? (error.code === "EEXIST"
        ? WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED : WORK_RECORD_PUBLICATION_STATES.UNKNOWN)),
      recovery: "Inspect the exact area subject before further action; do not repeat creation blindly." };
    throw error;
  }

  return {
    id: slugId,
    relativeFile,
    absoluteFile,
    jsonRelativeFile: null,
    jsonAbsoluteFile: null,
    ...(source === undefined ? {} : { source }),
    ...persistenceOutcomeFields(WORK_RECORD_PUBLICATION_STATES.PUBLISHED, { ok: true }),
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
  const { createWorkRecordCorpusSnapshot } = await import(
    "./work-record-corpus-snapshot.mjs"
  );
  const snapshot = await createWorkRecordCorpusSnapshot({ dir: targetDir });
  try {
    return snapshot.loads;
  } finally {
    snapshot.release();
  }
}
