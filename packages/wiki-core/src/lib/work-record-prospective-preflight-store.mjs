import path from "node:path";

import {
  createWorkRecordStore,
  getWorkRecordPath
} from "./work-record-store.mjs";

export function createProspectiveWorkRecordStore({ dir = ".", proposedRecord } = {}) {
  const targetDir = path.resolve(String(dir));
  const delegate = createWorkRecordStore(targetDir);
  const subjectPath = getWorkRecordPath(targetDir, proposedRecord.id);
  const subjectResolvedPath = path.resolve(subjectPath);
  const serializedProposedRecord = `${JSON.stringify(proposedRecord, null, 2)}\n`;

  return {
    async readText(filePath) {
      if (path.resolve(String(filePath)) === subjectResolvedPath) {
        return serializedProposedRecord;
      }
      return delegate.readText(filePath);
    },
    async pathExists(filePath) {
      if (path.resolve(String(filePath)) === subjectResolvedPath) {
        return true;
      }
      return delegate.pathExists(filePath);
    },
    async listJsonPaths() {
      const paths = new Map();
      for (const filePath of await delegate.listJsonPaths()) {
        const resolvedPath = path.resolve(filePath);
        paths.set(resolvedPath, resolvedPath);
      }
      paths.set(subjectResolvedPath, subjectResolvedPath);
      return [...paths.values()].sort((left, right) => left.localeCompare(right));
    },
    capabilities: {
      live_worktree: true
    }
  };
}
