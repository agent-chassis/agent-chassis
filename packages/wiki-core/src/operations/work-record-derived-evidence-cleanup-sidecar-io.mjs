import path from "node:path";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";

import { detectWorkRecordCleanupSidecarPathCollisions } from "../lib/work-record-derived-evidence-cleanup.mjs";
import {
  computeGraphEvidenceSidecarDigest,
  normalizeGraphEvidenceSidecar,
  serializeGraphEvidenceSidecar,
  verifyGraphSidecarEntryForInlineRef,
  WORK_RECORD_GRAPH_INLINE_REF_KIND
} from "../lib/work-record-graph-evidence-sidecar.mjs";

export function describeCleanupError(error) {
  if (error && typeof error === "object") {
    const parts = [error.code, error.message].filter(Boolean);
    return parts.length > 0 ? parts.join(": ") : String(error);
  }
  return String(error);
}

function createSidecarCollisionDiagnostic(collision) {
  const addresses = Array.isArray(collision?.addresses)
    ? collision.addresses.filter((address) => typeof address === "string" && address.length > 0)
    : [];
  const addressClause = addresses.length > 0 ? ` claimed by ${addresses.join(", ")}` : "";
  return {
    code: "cleanup_sidecar_path_collision",
    severity: "error",
    message:
      `cleanup would write ${collision?.count ?? "multiple"} retained worker-admission entries ` +
      `to the same sidecar path ${collision?.path ?? "(unknown)"}${addressClause}; ` +
      "refusing to overwrite one retained payload with another",
    path: collision?.path ?? "report.sidecars[].path"
  };
}

export function collectSidecarCollisionDiagnostics(report) {
  const collisions = detectWorkRecordCleanupSidecarPathCollisions(report?.sidecars);
  return collisions.map(createSidecarCollisionDiagnostic);
}

async function writeTextFileAtomically(filePath, content) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempDir = await mkdtemp(path.join(directory, ".record-tmp-"));
  const tempPath = path.join(tempDir, path.basename(filePath));

  try {
    await writeFile(tempPath, content, {
      encoding: "utf8",
      flag: "wx"
    });
    await rename(tempPath, filePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeJsonFileAtomically(filePath, value) {
  await writeTextFileAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function snapshotCleanupSidecarState(filePath) {
  try {
    return {
      existedBefore: true,
      priorContent: await readFile(filePath, "utf8")
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        existedBefore: false,
        priorContent: null
      };
    }
    throw error;
  }
}

function createCleanupSidecarDiagnostic({ code, message, path: diagnosticPath = null, index = null }) {
  return {
    code,
    severity: "error",
    message,
    path: diagnosticPath,
    ...(index === null ? {} : { index })
  };
}

function normalizeCleanupSidecarRelativePath(relativePath) {
  const normalized = String(relativePath ?? "").replaceAll("\\", "/");
  if (!normalized || path.posix.isAbsolute(normalized)) {
    return null;
  }

  const canonical = path.posix.normalize(normalized);
  if (
    canonical === "." ||
    canonical === ".." ||
    canonical.startsWith("../") ||
    canonical.includes("/../") ||
    !canonical.startsWith("wiki/work-records/evidence/")
  ) {
    return null;
  }

  return canonical;
}

function resolveCleanupSidecarPath(targetDir, relativePath) {
  const normalizedRelativePath = normalizeCleanupSidecarRelativePath(relativePath);
  if (!normalizedRelativePath) {
    return {
      ok: false,
      diagnostic: createCleanupSidecarDiagnostic({
        code: "cleanup_sidecar_invalid_path",
        message: `cleanup sidecar path must stay under wiki/work-records/evidence: ${String(relativePath ?? "")}`,
        path: "report.sidecar_entries[].path"
      })
    };
  }

  const absolutePath = path.resolve(targetDir, normalizedRelativePath);
  const relativeToTarget = path.relative(targetDir, absolutePath);
  if (relativeToTarget.startsWith("..") || path.isAbsolute(relativeToTarget)) {
    return {
      ok: false,
      diagnostic: createCleanupSidecarDiagnostic({
        code: "cleanup_sidecar_invalid_path",
        message: `cleanup sidecar path resolves outside the configured repository: ${normalizedRelativePath}`,
        path: "report.sidecar_entries[].path"
      })
    };
  }

  return {
    ok: true,
    relativePath: normalizedRelativePath,
    absolutePath
  };
}

function describeRollbackError(error) {
  return error && typeof error === "object" && (error.code || error.message)
    ? ` (${[error.code, error.message].filter(Boolean).join(": ")})`
    : "";
}

async function recheckGraphSidecarBeforeRollback(writtenEntry) {
  let currentContent;
  try {
    currentContent = await readFile(writtenEntry.path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        ok: false,
        diagnostic: createCleanupSidecarDiagnostic({
          code: "graph_sidecar_rollback_skipped_concurrent_update",
          message:
            "skipped graph sidecar rollback because the file was removed by a concurrent update: " +
            writtenEntry.path,
          path: writtenEntry.path
        })
      };
    }
    return {
      ok: false,
      diagnostic: createCleanupSidecarDiagnostic({
        code: "graph_sidecar_rollback_recheck_failed",
        message:
          "skipped graph sidecar rollback because the file could not be safely rechecked: " +
          `${writtenEntry.path}${describeRollbackError(error)}`,
        path: writtenEntry.path
      })
    };
  }

  if (currentContent !== writtenEntry.writtenContent) {
    return {
      ok: false,
      diagnostic: createCleanupSidecarDiagnostic({
        code: "graph_sidecar_rollback_skipped_concurrent_update",
        message:
          "skipped graph sidecar rollback because a concurrent update changed it since this writer wrote it: " +
          writtenEntry.path,
        path: writtenEntry.path
      })
    };
  }

  return { ok: true };
}

export async function rollbackCleanupSidecarWrites(writtenEntries) {
  const diagnostics = [];
  for (let index = writtenEntries.length - 1; index >= 0; index -= 1) {
    const writtenEntry = writtenEntries[index];

    if (writtenEntry.recheckConcurrentUpdate) {
      const recheck = await recheckGraphSidecarBeforeRollback(writtenEntry);
      if (!recheck.ok) {
        diagnostics.push(recheck.diagnostic);
        continue;
      }
    }

    try {
      if (writtenEntry.existedBefore) {
        await writeTextFileAtomically(writtenEntry.path, writtenEntry.priorContent);
      } else {
        await rm(writtenEntry.path, { force: true });
      }
    } catch (error) {
      diagnostics.push(
        createCleanupSidecarDiagnostic({
          code: "cleanup_sidecar_rollback_failed",
          message: `failed to restore cleanup sidecar after write failure: ${writtenEntry.path}${describeRollbackError(error)}`,
          path: writtenEntry.path
        })
      );
    }
  }
  return diagnostics;
}

export async function persistCleanupSidecars(targetDir, sidecarEntries) {
  const writtenEntries = [];
  const sidecarDiagnostics = [];

  for (const [index, sidecarEntry] of sidecarEntries.entries()) {
    if (!sidecarEntry || typeof sidecarEntry !== "object" || !sidecarEntry.entry || typeof sidecarEntry.entry !== "object" || Array.isArray(sidecarEntry.entry)) {
      sidecarDiagnostics.push(
        createCleanupSidecarDiagnostic({
          code: "cleanup_sidecar_entry_invalid",
          message: "cleanup sidecar entry must include a JSON object payload",
          path: `report.sidecar_entries[${index}].entry`,
          index
        })
      );
      break;
    }

    const resolved = resolveCleanupSidecarPath(targetDir, sidecarEntry.path);
    if (!resolved.ok) {
      sidecarDiagnostics.push({
        ...resolved.diagnostic,
        index
      });
      break;
    }

    let previousState;
    try {
      previousState = await snapshotCleanupSidecarState(resolved.absolutePath);
    } catch {
      sidecarDiagnostics.push(
        createCleanupSidecarDiagnostic({
          code: "cleanup_sidecar_snapshot_failed",
          message: `failed to snapshot existing cleanup sidecar before write: ${resolved.relativePath}`,
          path: `report.sidecar_entries[${index}].path`,
          index
        })
      );
      break;
    }

    try {
      await writeJsonFileAtomically(resolved.absolutePath, sidecarEntry.entry);
      writtenEntries.push({
        path: resolved.absolutePath,
        ...previousState
      });
    } catch {
      sidecarDiagnostics.push(
        createCleanupSidecarDiagnostic({
          code: "cleanup_sidecar_write_failed",
          message: `failed to write cleanup sidecar: ${resolved.relativePath}`,
          path: `report.sidecar_entries[${index}].entry`,
          index
        })
      );
      break;
    }
  }

  if (sidecarDiagnostics.length > 0) {
    const rollbackDiagnostics = await rollbackCleanupSidecarWrites(writtenEntries);
    return {
      ok: false,
      diagnostics: [...sidecarDiagnostics, ...rollbackDiagnostics],
      writtenEntries,
      writtenPaths: writtenEntries.map((entry) => entry.path)
    };
  }

  return {
    ok: true,
    diagnostics: [],
    writtenEntries,
    writtenPaths: writtenEntries.map((entry) => entry.path)
  };
}

function graphSidecarAddress(entry) {
  return typeof entry?.unit?.address === "string" ? entry.unit.address : null;
}

function mergeGraphSidecarFile(existing, built) {
  if (!existing) {
    return { ok: true, merged: built, diagnostics: [] };
  }

  let base;
  try {
    base = normalizeGraphEvidenceSidecar(existing, { recordId: built.record_id });
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        createCleanupSidecarDiagnostic({
          code: "graph_sidecar_existing_invalid",
          message: `existing graph sidecar is not a valid work-record-graph-evidence-sidecar.v1 file: ${describeCleanupError(error)}`,
          path: "graph_sidecar.path"
        })
      ]
    };
  }

  for (const [sliceKey, entry] of Object.entries(built.slices ?? {})) {
    const existingEntry = base.slices[sliceKey];
    if (existingEntry && graphSidecarAddress(existingEntry) !== graphSidecarAddress(entry)) {
      return {
        ok: false,
        diagnostics: [
          createCleanupSidecarDiagnostic({
            code: "graph_sidecar_slice_key_collision",
            message:
              `graph sidecar slice key ${sliceKey} already maps to ${graphSidecarAddress(existingEntry)}; ` +
              `refusing to overwrite it with ${graphSidecarAddress(entry)}`,
            path: "graph_sidecar.slices"
          })
        ]
      };
    }
    base.slices[sliceKey] = entry;
  }
  if (built.record) {
    base.record = built.record;
  }
  base.updated_at = built.updated_at ?? base.updated_at;
  return { ok: true, merged: base, diagnostics: [] };
}

export async function persistCleanupGraphSidecar(targetDir, graphBundle) {
  if (!graphBundle || !graphBundle.sidecar || !graphBundle.path) {
    return { ok: true, diagnostics: [], writtenEntries: [], writtenPaths: [] };
  }

  const resolved = resolveCleanupSidecarPath(targetDir, graphBundle.path);
  if (!resolved.ok) {
    return { ok: false, diagnostics: [resolved.diagnostic], writtenEntries: [], writtenPaths: [] };
  }

  let previousState;
  try {
    previousState = await snapshotCleanupSidecarState(resolved.absolutePath);
  } catch {
    return {
      ok: false,
      diagnostics: [
        createCleanupSidecarDiagnostic({
          code: "graph_sidecar_snapshot_failed",
          message: `failed to snapshot existing graph sidecar before write: ${resolved.relativePath}`,
          path: "graph_sidecar.path"
        })
      ],
      writtenEntries: [],
      writtenPaths: []
    };
  }

  let existing = null;
  if (previousState.existedBefore) {
    try {
      existing = JSON.parse(previousState.priorContent);
    } catch (error) {
      return {
        ok: false,
        diagnostics: [
          createCleanupSidecarDiagnostic({
            code: "graph_sidecar_existing_unparseable",
            message: `existing graph sidecar is not valid JSON: ${describeCleanupError(error)}`,
            path: "graph_sidecar.path"
          })
        ],
        writtenEntries: [],
        writtenPaths: []
      };
    }
  }

  const mergeResult = mergeGraphSidecarFile(existing, graphBundle.sidecar);
  if (!mergeResult.ok) {
    return { ok: false, diagnostics: mergeResult.diagnostics, writtenEntries: [], writtenPaths: [] };
  }
  const merged = mergeResult.merged;

  for (const { inline_ref: inlineRef } of graphBundle.inline_refs ?? []) {
    const verification = verifyGraphSidecarEntryForInlineRef(merged, inlineRef);
    if (!verification.ok) {
      return {
        ok: false,
        diagnostics: verification.diagnostics.map((diagnostic) =>
          createCleanupSidecarDiagnostic({
            code: diagnostic.code ?? "graph_sidecar_verify_failed",
            message: diagnostic.message ?? "graph sidecar verification failed",
            path: "graph_sidecar.inline_refs"
          })
        ),
        writtenEntries: [],
        writtenPaths: []
      };
    }
  }

  let current;
  try {
    current = await snapshotCleanupSidecarState(resolved.absolutePath);
  } catch {
    current = previousState;
  }
  if (
    current.existedBefore !== previousState.existedBefore ||
    current.priorContent !== previousState.priorContent
  ) {
    return {
      ok: false,
      diagnostics: [
        createCleanupSidecarDiagnostic({
          code: "graph_sidecar_stale",
          message: `graph sidecar ${resolved.relativePath} changed during cleanup; refusing to clobber a concurrent edit`,
          path: "graph_sidecar.path"
        })
      ],
      writtenEntries: [],
      writtenPaths: []
    };
  }

  delete merged.graph_sidecar_digest;

  const finalDigest = computeGraphEvidenceSidecarDigest(merged);
  const serialized = serializeGraphEvidenceSidecar(merged);
  try {
    await writeTextFileAtomically(resolved.absolutePath, serialized);
  } catch {
    return {
      ok: false,
      diagnostics: [
        createCleanupSidecarDiagnostic({
          code: "graph_sidecar_write_failed",
          message: `failed to write graph sidecar: ${resolved.relativePath}`,
          path: "graph_sidecar.path"
        })
      ],
      writtenEntries: [],
      writtenPaths: []
    };
  }

  const writtenEntries = [
    { path: resolved.absolutePath, ...previousState, writtenContent: serialized, recheckConcurrentUpdate: true }
  ];
  return {
    ok: true,
    diagnostics: [],
    writtenEntries,
    writtenPaths: [resolved.absolutePath],
    relativePath: resolved.relativePath,
    finalDigest
  };
}

export function applyFinalGraphSidecarDigest({ record, report, sidecarRelativePath, finalDigest }) {
  if (typeof finalDigest !== "string" || !finalDigest || !sidecarRelativePath) {
    return;
  }

  if (report && typeof report.graph_sidecar === "object" && report.graph_sidecar !== null) {
    if (report.graph_sidecar.path === sidecarRelativePath) {
      report.graph_sidecar.digest = finalDigest;
    }
  }

  const entries = Array.isArray(record?.derived_evidence) ? record.derived_evidence : [];
  for (const entry of entries) {
    const ref = entry && typeof entry === "object" ? entry.graph_impact_summary_ref : null;
    if (
      ref &&
      typeof ref === "object" &&
      ref.kind === WORK_RECORD_GRAPH_INLINE_REF_KIND &&
      ref.sidecar_path === sidecarRelativePath &&
      Object.prototype.hasOwnProperty.call(ref, "graph_sidecar_digest")
    ) {
      ref.graph_sidecar_digest = finalDigest;
    }
  }
}
