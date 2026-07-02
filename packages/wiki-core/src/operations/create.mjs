import path from "node:path";
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import {
  createRecord,
  ensureCoreSurfaces,
  resolveContractContext
} from "../lib/wiki.mjs";

function normalizeCreatedIssueRecord(record) {
  const sections = record.sections && typeof record.sections === "object" ? record.sections : {};
  const scope = sections.scope && typeof sections.scope === "object" ? sections.scope : {};

  const normalizedRecord = {
    ...record,
    derived_evidence: [],
    acceptance: {
      ...record.acceptance,
      criteria: [],
      validation: []
    },
    sections: {
      ...sections,
      summary: "",
      why_it_matters: "",
      scope: {
        ...scope,
        items: [],
        out_of_scope: []
      },
      tasks: [],
      references: [],
      agent_notes: "",
      closure: null
    }
  };

  delete normalizedRecord.resolution;

  return normalizedRecord;
}

async function rewriteJsonRecordAtomically(filePath, record) {
  const tempDir = await mkdtemp(path.join(path.dirname(filePath), ".record-tmp-"));
  const tempPath = path.join(tempDir, path.basename(filePath));

  try {
    await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    await rename(tempPath, filePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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

  if (type === "issue" && record.jsonAbsoluteFile) {
    const createdRecord = JSON.parse(await readFile(record.jsonAbsoluteFile, "utf8"));
    await rewriteJsonRecordAtomically(
      record.jsonAbsoluteFile,
      normalizeCreatedIssueRecord(createdRecord)
    );
  }

  return {
    targetDir,
    ...record,
    relativeFile: record.jsonRelativeFile || record.relativeFile,
    absoluteFile: record.jsonAbsoluteFile || record.absoluteFile
  };
}
