import path from "node:path";
import { getManifestRecordBirthKinds, loadManifest } from "../lib/contract.mjs";
import { extractFrontMatter } from "../lib/wiki-frontmatter.mjs";
import { prepareSourceAreaBirth } from "./record-birth-plan.mjs";
import { lintRecordFrontMatter } from "./lint-record-rules.mjs";
import {
  createRecord,
  ensureCoreSurfaces,
  resolveContractContext
} from "../lib/wiki.mjs";

export async function prepareSourceAreaRecordBirth({ kind, title, initial = {}, id, date }) {

  const { validateRecordAuthoringChanges } = await import("../lib/record-authoring-schema.mjs");
  const diagnostics = validateRecordAuthoringChanges(kind, "birth", initial)
    .map(row => ({ ...row, path: row.path.replace(/^changes/u, "initial") }));
  if (diagnostics.length > 0) {
    throw Object.assign(new TypeError("Invalid initial source/area meaning; correct the addressed initial fields"),
      { code: "create_record_initial_invalid", diagnostics });
  }
  const prepared = prepareSourceAreaBirth({ kind, title, initial, id, date });
  const manifest = await loadManifest();
  const definition = manifest.types[kind];
  const relativeFilePath = `${definition.directory}/${id}.md`;
  lintRecordFrontMatter({ definition, frontMatter: extractFrontMatter(prepared.markdown),
    filePath: relativeFilePath, relativeFilePath,
    addFinding: (severity, message, extra) => diagnostics.push({ severity, message, ...extra }) });
  if (diagnostics.length > 0) {
    throw Object.assign(new TypeError("Invalid prospective source/area record; correct the addressed initial fields"),
      { code: "create_record_initial_invalid", diagnostics });
  }
  return prepared;
}

export async function createRecordFromInitial({ repoRoot, kind, title, initial }, birthOptions = {}) {
  const selected = getManifestRecordBirthKinds().find(row => row.kind === kind);
  if (selected === undefined) throw Object.assign(new TypeError(`Unsupported creation kind '${String(kind)}'`),
    { code: "create_record_kind_invalid", details: { changed: false } });
  if (typeof title !== "string" || title.trim() === "") throw Object.assign(new TypeError("title must be nonempty text"),
    { code: "create_record_title_invalid", details: { changed: false } });
  const targetDir = path.resolve(repoRoot);
  const context = await resolveContractContext(targetDir);
  if (!context.metadata) throw Object.assign(new Error("Creation requires local contract metadata; bootstrap or sync-contract first"),
    { code: "create_record_contract_metadata_absent", details: { changed: false } });

  return createRecord({ targetDir, repo: context.repo, type: selected.type, title,
    initial: initial === undefined ? {} : initial, birthOptions });
}

export async function createWikiRecord({
  dir = ".",
  type,
  title,
  id = null
}) {
  if (!type) {
    throw new Error("createWikiRecord requires type");
  }
  if (!title) {
    throw new Error("createWikiRecord requires title");
  }

  const targetDir = path.resolve(String(dir));
  const context = await resolveContractContext(targetDir);
  if (!context.metadata) {
    throw new Error(
      "createWikiRecord requires local contract metadata; run bootstrap or sync-contract first"
    );
  }
  await ensureCoreSurfaces(targetDir, {
    profile: context.profile,
    extensionNamespaces: context.extensionNamespaces
  });
  const record = await createRecord({ targetDir, type, title, id, repo: context.repo });

  return {
    targetDir,
    ...record,
    relativeFile: record.jsonRelativeFile || record.relativeFile,
    absoluteFile: record.jsonAbsoluteFile || record.absoluteFile
  };
}
