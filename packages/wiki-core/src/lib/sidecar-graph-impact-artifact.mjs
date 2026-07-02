import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadCanonicalState, resolveContractContext } from "./wiki.mjs";
import {
  SIDECAR_ARTIFACT_SCHEMA_FIELD,
  SIDECAR_ARTIFACT_SCHEMA_VERSION
} from "./sidecar-schema.mjs";
import {
  SidecarPathValidationError,
  validateVirtualSidecarPath
} from "./sidecar-paths.mjs";
import { buildSidecarIndex } from "./sidecar-build.mjs";
import {
  asStringList,
  pageKindForPath,
  provenance,
  uniqueStrings
} from "./sidecar-graph-impact-shared.mjs";

export class SidecarGraphIndexUnbuildableError extends Error {
  constructor(message, { code = "graph_index_unbuildable", cause = null, status = null } = {}) {
    super(message);
    this.name = "SidecarGraphIndexUnbuildableError";
    this.code = code;
    if (cause) {
      this.cause = cause;
    }
    this.envelope = {
      kind: "sidecar_graph_index_unbuildable",
      code,
      remediation:
        "build or fix the repo code index (run `code-index build` / `code-index rebuild`) before requesting graph impact",
      ...(status?.status_reason ? { status_reason: status.status_reason } : {}),
      ...(cause ? { build_error: cause instanceof Error ? cause.message : String(cause) } : {})
    };
  }
}

export async function rebuildGraphIndexAtHead({ targetDir, cacheDir }) {
  try {
    return await buildSidecarIndex({ dir: targetDir, cacheDir, rebuild: true });
  } catch (error) {
    throw new SidecarGraphIndexUnbuildableError(
      `repo code index could not be built for graph impact: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    );
  }
}

export async function loadCanonicalRecords(targetDir, { profile, extensionNamespaces } = {}) {
  const context = await resolveContractContext(targetDir, {
    profile,
    extensionNamespaces
  });
  const state = await loadCanonicalState(targetDir, {
    extensionNamespaces: context.extensionNamespaces
  });
  const pages = [
    ...state.docs,
    ...state.decisions,
    ...state.areas,
    ...state.issues,
    ...state.initiatives,
    ...state.sources,
    ...state.wikiPages,
    ...state.extensionPages
  ];

  return pages.map((page) => ({
    ...page,
    id: page.frontmatter?.id ?? null,
    pageKind: pageKindForPath(page.relativePath)
  }));
}

export function artifactIsCompatible(artifact) {
  return (
    artifact &&
    typeof artifact === "object" &&
    !Array.isArray(artifact) &&
    artifact.cache_metadata?.[SIDECAR_ARTIFACT_SCHEMA_FIELD] === SIDECAR_ARTIFACT_SCHEMA_VERSION &&
    artifact.sources &&
    typeof artifact.sources === "object" &&
    !Array.isArray(artifact.sources)
  );
}

export async function readArtifact({ repoRoot, status }) {
  if (!status.artifact_exists || status.staleness === "missing") {
    return {
      artifact: null,
      evidence: graphArtifactEvidence({
        status,
        available: false,
        reason: "artifact_missing"
      })
    };
  }

  if (status.staleness === "rebuild_required") {
    return {
      artifact: null,
      evidence: graphArtifactEvidence({
        status,
        available: false,
        reason: "artifact_schema_incompatible",
        artifactSchemaVersion: status.artifact_schema_version
      })
    };
  }

  try {
    const artifact = JSON.parse(await readFile(path.join(repoRoot, status.artifact_path), "utf8"));
    if (!artifactIsCompatible(artifact)) {
      return {
        artifact: null,
        evidence: graphArtifactEvidence({
          status,
          available: false,
          reason: "artifact_format_unusable",
          artifactSchemaVersion:
            artifact?.cache_metadata?.[SIDECAR_ARTIFACT_SCHEMA_FIELD] ?? null
        })
      };
    }
    return {
      artifact,
      evidence: graphArtifactEvidence({
        status,
        available: true,
        artifactSchemaVersion: artifact.cache_metadata[SIDECAR_ARTIFACT_SCHEMA_FIELD]
      })
    };
  } catch (error) {
    return {
      artifact: null,
      evidence: graphArtifactEvidence({
        status,
        available: false,
        reason: "artifact_unreadable",
        readError: error instanceof Error ? error.message : String(error)
      })
    };
  }
}

function graphArtifactEvidence({
  status,
  available,
  reason = null,
  artifactSchemaVersion = null,
  readError = null
}) {
  return {
    kind: "sidecar_graph_artifact",
    artifact_path: status.artifact_path,
    artifact_available_for_query: available,
    ...(reason ? { reason } : {}),
    artifact_schema_version: artifactSchemaVersion,
    expected_artifact_schema_version: SIDECAR_ARTIFACT_SCHEMA_VERSION,
    ...(readError ? { read_error: readError } : {}),
    provenance: provenance({ evidenceBasis: status.index_tree ? "git_tree" : "unknown" })
  };
}

export function sourcePathsFromArtifact(artifact) {
  if (!artifactIsCompatible(artifact)) {
    return [];
  }
  return uniqueStrings([
    ...asStringList(artifact.sources.files?.map?.((entry) => entry.path)),
    ...asStringList(artifact.sources.symlinks?.map?.((entry) => entry.path)),
    ...asStringList(artifact.sources.gitlinks?.map?.((entry) => entry.path))
  ]).filter((sourcePath) => {
    try {
      validateVirtualSidecarPath(sourcePath);
      return true;
    } catch (error) {
      if (error instanceof SidecarPathValidationError) {
        return false;
      }
      throw error;
    }
  });
}
