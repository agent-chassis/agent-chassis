

import path from "node:path";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import {
  buildCompactInlineGraphEvidenceRef,
  computeGraphEvidenceSidecarDigest,
  createGraphEvidenceSidecar,
  graphEvidenceSidecarPathForRecord,
  normalizeGraphEvidenceSidecar,
  serializeGraphEvidenceSidecar,
  upsertGraphEvidenceSidecarEntry
} from "../lib/work-record-graph-evidence-sidecar.mjs";

export async function writeTextFileAtomically(filePath, content) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempDir = await mkdtemp(path.join(directory, ".graph-sidecar-tmp-"));
  const tempPath = path.join(tempDir, path.basename(filePath));
  try {
    await writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, filePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function loadExistingGraphSidecar({ absolutePath, recordId }) {
  let priorText;
  try {
    priorText = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { ok: true, sidecar: null, existedBefore: false, priorText: null };
    }
    return {
      ok: false,
      diagnostic: {
        code: "graph_sidecar_unreadable",
        severity: "error",
        message: `failed to read existing graph sidecar: ${recordId}.graph.json`,
        path: "graph_sidecar"
      }
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(priorText);
  } catch {
    return {
      ok: false,
      diagnostic: {
        code: "graph_sidecar_invalid_json",
        severity: "error",
        message: `existing graph sidecar is not valid JSON: ${recordId}.graph.json`,
        path: "graph_sidecar"
      }
    };
  }

  try {
    const sidecar = normalizeGraphEvidenceSidecar(parsed, { recordId });
    return { ok: true, sidecar, existedBefore: true, priorText };
  } catch (error) {
    return {
      ok: false,
      diagnostic: {
        code: "graph_sidecar_invalid",
        severity: "error",
        message: error?.message || `existing graph sidecar is structurally invalid: ${recordId}.graph.json`,
        path: "graph_sidecar"
      }
    };
  }
}

export async function buildGraphSidecarWrite({ targetDir, recordId, sidecarEntry, generatedAt }) {
  const relativePath = graphEvidenceSidecarPathForRecord(recordId);
  const absolutePath = path.resolve(targetDir, relativePath);

  const existing = await loadExistingGraphSidecar({ absolutePath, recordId });
  if (!existing.ok) {
    return existing;
  }

  const baseSidecar = existing.sidecar ?? createGraphEvidenceSidecar(recordId, { generatedAt });
  let nextSidecar;
  try {
    nextSidecar = upsertGraphEvidenceSidecarEntry(baseSidecar, sidecarEntry, { updatedAt: generatedAt });
  } catch (error) {
    return {
      ok: false,
      diagnostic: {
        code: "graph_sidecar_collision",
        severity: "error",
        message: error?.message || "graph sidecar entry could not be merged without clobbering a sibling entry",
        path: "graph_sidecar"
      }
    };
  }

  const text = serializeGraphEvidenceSidecar(nextSidecar);
  const digest = computeGraphEvidenceSidecarDigest(nextSidecar);
  const inlineRef = buildCompactInlineGraphEvidenceRef(sidecarEntry, {
    sidecarPath: relativePath,
    sidecarDigest: digest
  });

  return {
    ok: true,
    relativePath,
    absolutePath,
    text,
    digest,
    inlineRef,
    existedBefore: existing.existedBefore,
    priorText: existing.priorText
  };
}

export async function rollbackGraphSidecarWrite({ absolutePath, existedBefore, priorText, expectedText }) {
  let currentText = null;
  let currentlyExists = true;
  try {
    currentText = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      currentlyExists = false;
    } else {

      return {
        rolledBack: false,
        diagnostic: {
          code: "graph_sidecar_rollback_recheck_failed",
          severity: "warning",
          message:
            "could not reread the graph sidecar before rollback; left it in place rather than risk clobbering a concurrent update. Rerun cleanup-derived-evidence to reconcile any orphan replay payload.",
          path: "graph_sidecar"
        }
      };
    }
  }

  if (!currentlyExists || currentText !== expectedText) {
    return {
      rolledBack: false,
      diagnostic: {
        code: "graph_sidecar_rollback_skipped_concurrent_update",
        severity: "warning",
        message:
          "graph sidecar changed after this writer's write; left it in place rather than clobbering a concurrent update. The canonical record was not written, so this writer's sidecar entry may be an orphan replay payload — rerun cleanup-derived-evidence to reconcile.",
        path: "graph_sidecar"
      }
    };
  }

  try {
    if (existedBefore) {
      await writeTextFileAtomically(absolutePath, priorText);
    } else {
      await rm(absolutePath, { force: true });
    }
    return { rolledBack: true, diagnostic: null };
  } catch {

    return {
      rolledBack: false,
      diagnostic: {
        code: "graph_sidecar_rollback_failed",
        severity: "warning",
        message:
          "failed to roll back the graph sidecar after a canonical write failure; it is inert replay/debug data — rerun cleanup-derived-evidence to reconcile.",
        path: "graph_sidecar"
      }
    };
  }
}

export async function recheckGraphSidecarUnchanged({ absolutePath, existedBefore, priorText }) {
  let currentText = null;
  let currentlyExists = true;
  try {
    currentText = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      currentlyExists = false;
    } else {
      return {
        ok: false,
        diagnostic: {
          code: "graph_sidecar_recheck_failed",
          severity: "error",
          message: "failed to reread the existing graph sidecar before writing it",
          path: "graph_sidecar"
        }
      };
    }
  }

  const changed = existedBefore ? !currentlyExists || currentText !== priorText : currentlyExists;
  if (changed) {
    return {
      ok: false,
      diagnostic: {
        code: "graph_sidecar_stale",
        severity: "error",
        message:
          "graph sidecar changed between load and write; refusing to clobber a concurrent or manual edit",
        path: "graph_sidecar"
      }
    };
  }

  return { ok: true };
}
