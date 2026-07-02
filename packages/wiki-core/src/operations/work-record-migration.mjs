import path from "node:path";

import {
  migrateWorkRecordMarkdown,
  migrateWorkRecordMarkdownById,
  migrateWorkRecordMarkdownByPath
} from "../lib/work-record-migration.mjs";

export async function migrateWorkRecordMarkdownOperation({
  dir = ".",
  id,
  path: requestedPath = null,
  recordStore = null,
  migratedAt = null
} = {}) {
  const targetDir = path.resolve(String(dir));

  if (requestedPath) {
    return migrateWorkRecordMarkdownByPath({
      dir: targetDir,
      path: requestedPath,
      recordStore,
      migratedAt: migratedAt || undefined
    });
  }

  if (id) {
    return migrateWorkRecordMarkdownById({
      dir: targetDir,
      id,
      recordStore,
      migratedAt: migratedAt || undefined
    });
  }

  return migrateWorkRecordMarkdown({
    dir: targetDir,
    recordStore,
    migratedAt: migratedAt || undefined
  });
}
