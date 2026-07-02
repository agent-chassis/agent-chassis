import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  WORK_RECORD_RENDER_SCHEMA_VERSION,
  WORK_RECORD_SCHEMA_VERSION
} from "../lib/work-record-schema.mjs";
import {
  checkWorkRecordRenderProjectionRecord,
  checkWorkRecordRenderRecord,
  renderWorkRecordAgentBrief,
  renderWorkRecordMarkdown
} from "../lib/work-record-renderer.mjs";
import { loadWorkRecordById, loadWorkRecordByPath } from "../lib/work-record-store.mjs";

async function readJsonFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function toPosixRelativePath(targetDir, absolutePath) {
  return path.relative(targetDir, absolutePath).split(path.sep).join("/");
}

async function loadRenderableWorkRecord({ dir = ".", id = null, path: requestedPath = null, recordStore = null } = {}) {
  if (requestedPath) {
    return loadWorkRecordByPath({
      dir,
      path: requestedPath,
      recordStore
    });
  }

  return loadWorkRecordById({
    dir,
    id,
    recordStore
  });
}

export async function renderWorkRecordMarkdownById({
  dir = ".",
  id,
  path: requestedPath = null,
  recordStore = null,
  generatedAt = null,
  outputPath = null,
  sliceId = null
} = {}) {
  const loaded = await loadRenderableWorkRecord({
    dir,
    id,
    path: requestedPath,
    recordStore
  });

  if (!loaded.valid || !loaded.record) {
    return {
      ...loaded,
      markdown: null,
      projection: null
    };
  }

  const rendered = renderWorkRecordMarkdown(loaded.record, {
    generatedAt: generatedAt || undefined,
    outputPath: outputPath || undefined,
    sliceId
  });

  return {
    ...loaded,
    ...rendered
  };
}

export async function renderWorkRecordAgentBriefById({
  dir = ".",
  id,
  path: requestedPath = null,
  recordStore = null,
  generatedAt = null,
  outputPath = null,
  sliceId = null
} = {}) {
  const loaded = await loadRenderableWorkRecord({
    dir,
    id,
    path: requestedPath,
    recordStore
  });

  if (!loaded.valid || !loaded.record) {
    return {
      ...loaded,
      brief: null,
      projection: null
    };
  }

  const rendered = renderWorkRecordAgentBrief(loaded.record, {
    generatedAt: generatedAt || undefined,
    outputPath: outputPath || undefined,
    sliceId
  });

  return {
    ...loaded,
    ...rendered
  };
}

export async function checkWorkRecordRenderByPath({
  dir = ".",
  path: requestedPath,
  sourceDir = null
} = {}) {
  const targetDir = path.resolve(String(dir));
  const absolutePath = path.isAbsolute(String(requestedPath))
    ? path.resolve(String(requestedPath))
    : path.resolve(targetDir, String(requestedPath));
  const sourcePath = toPosixRelativePath(targetDir, absolutePath);

  let payload;
  try {
    payload = await readJsonFile(absolutePath);
  } catch (error) {
    return {
      valid: false,
      diagnostics: [
        {
          code: "invalid_projection_record",
          severity: "error",
          message: `Failed to parse render projection at ${sourcePath}: ${error.message}`,
          path: sourcePath
        }
      ],
      source_path: sourcePath
    };
  }

  if (payload && payload.schema_version === WORK_RECORD_RENDER_SCHEMA_VERSION) {
    let sourceRecord = null;
    let sourceMissing = false;
    if (payload.source_record_id) {
      const loader = await loadWorkRecordById({
        dir: sourceDir ? path.resolve(String(sourceDir)) : targetDir,
        id: payload.source_record_id
      });
      if (loader.valid && loader.record) {
        sourceRecord = loader.record;
      } else {
        sourceMissing = true;
      }
    }
    const checked = checkWorkRecordRenderProjectionRecord(payload, { sourceRecord });
    if (sourceMissing) {
      checked.diagnostics = [
        ...checked.diagnostics,
        {
          code: "source_record_missing",
          severity: "warning",
          message: `canonical source record ${payload.source_record_id} not found; digest comparison skipped`,
          path: "source_record_id"
        }
      ];
    }
    return {
      ...checked,
      source_path: sourcePath
    };
  }

  if (payload && payload.schema_version === WORK_RECORD_SCHEMA_VERSION) {
    const checked = checkWorkRecordRenderRecord(payload, { sourcePath: absolutePath });
    return {
      ...checked,
      source_path: sourcePath
    };
  }

  return {
    valid: false,
    diagnostics: [
      {
        code: "invalid_projection_record",
        severity: "error",
        message: "Render payload schema_version must be work-record.v1 or work-record-render.v1",
        path: "schema_version"
      }
    ],
    source_path: sourcePath
  };
}
