import { loadCanonicalState, resolveContractContext } from "./wiki.mjs";
import {
  SIDECAR_ARTIFACT_SCHEMA_FIELD,
  SIDECAR_ARTIFACT_SCHEMA_VERSION
} from "./sidecar-schema.mjs";
import {
  SIDECAR_GRAPH_GENERATOR_IDENTITY_FIELD,
  SIDECAR_GRAPH_SCHEMA_VERSION,
  SIDECAR_GRAPH_SECTION_FIELD
} from "./sidecar-graph-schema.mjs";
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
import {
  artifactIdentityMatches,
  classifyVerifiedSidecarArtifact,
  createArtifactIdentity,
  getVerifiedSidecarArtifactDerivedState,
  readVerifiedSidecarArtifactSnapshot
} from "./sidecar-artifact-query-cache.mjs";

const SIDECAR_GENERATOR_IDENTITY_PATTERN = /^sha256:[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export { artifactIdentityMatches, createArtifactIdentity };

function captureUsableStatus(status) {
  try {
    if (!status || typeof status !== "object" || Array.isArray(status) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(status))) return null;
    const value = (record, field) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, field);
      return descriptor && "value" in descriptor ? descriptor.value : undefined;
    };
    const graphState = value(status, "graph_state");
    if (!graphState || typeof graphState !== "object" || Array.isArray(graphState) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(graphState))) return null;
    const captured = {
      artifact_exists: value(status, "artifact_exists"), artifact_path: value(status, "artifact_path"),
      staleness: value(status, "staleness"), index_action: value(status, "index_action"),
      status_reason: value(status, "status_reason"), index_head: value(status, "index_head"),
      index_tree: value(status, "index_tree"),
      artifact_schema_version: value(status, "artifact_schema_version"),
      graph_available: value(graphState, "graph_available"),
      graph_schema_version: value(graphState, "graph_schema_version")
    };
    return Object.freeze(captured);
  } catch {
    return null;
  }
}

function statusIsUsable(status) {
  return Boolean(status?.artifact_exists === true && typeof status.artifact_path === "string" &&
    status.artifact_path.length > 0 && status.staleness === "fresh" &&
    status.index_action === "use" && status.status_reason === "source_identity_match" &&
    typeof status.index_head === "string" && COMMIT_PATTERN.test(status.index_head) &&
    status.artifact_schema_version === SIDECAR_ARTIFACT_SCHEMA_VERSION &&
    status.graph_available === true && status.graph_schema_version === SIDECAR_GRAPH_SCHEMA_VERSION);
}

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

export function classifyReadSidecarGraphArtifact(artifact) {
  if (arguments.length !== 1) {
    throw new TypeError("artifact classification accepts only the artifact returned by readArtifact");
  }
  return classifyVerifiedSidecarArtifact(artifact);
}

function graphGeneratorIdentityReason(artifact, expectedGeneratorIdentity) {
  const observed =
    artifact?.[SIDECAR_GRAPH_SECTION_FIELD]?.[SIDECAR_GRAPH_GENERATOR_IDENTITY_FIELD];
  if (observed === undefined) return "generator_identity_missing";
  if (typeof observed !== "string" || !SIDECAR_GENERATOR_IDENTITY_PATTERN.test(observed)) {
    return "generator_identity_malformed";
  }
  return observed === expectedGeneratorIdentity ? null : "generator_identity_incompatible";
}

export async function readArtifact({ repoRoot, status }) {
  const capturedStatus = captureUsableStatus(status);
  if (!statusIsUsable(capturedStatus)) {
    return {
      artifact: null,
      evidence: graphArtifactEvidence({
        status: capturedStatus ?? {},
        available: false,
        reason: capturedStatus?.artifact_exists === false || capturedStatus?.staleness === "missing"
          ? "artifact_missing"
          : capturedStatus?.staleness === "rebuild_required" ?
            (capturedStatus.status_reason?.startsWith("generator_identity_") ?
              capturedStatus.status_reason : "artifact_schema_incompatible") : "artifact_status_unusable",
        artifactSchemaVersion: capturedStatus?.artifact_schema_version
      })
    };
  }

  try {
    const snapshot = await readVerifiedSidecarArtifactSnapshot({
      dir: repoRoot,
      artifactRelativePath: capturedStatus.artifact_path
    });
    if (snapshot.read_error) {
      return {
        artifact: null,
        identity: null,
        evidence: graphArtifactEvidence({
          status: capturedStatus,
          available: false,
          reason: "artifact_unreadable",
          readError: snapshot.read_error
        })
      };
    }
    if (!snapshot.exists || !snapshot.artifact) {
      return {
        artifact: null,
        identity: snapshot.identity ?? null,
        evidence: graphArtifactEvidence({
          status: capturedStatus,
          available: false,
          reason: snapshot.exists ? "artifact_format_unusable" : "artifact_missing"
        })
      };
    }
    const generatorIdentityReason = graphGeneratorIdentityReason(
      snapshot.artifact,
      snapshot.expected_generator_identity
    );
    if (!snapshot.verified || !artifactIsCompatible(snapshot.artifact) ||
      generatorIdentityReason || snapshot.identity?.index_head !== capturedStatus.index_head) {
      return {
        artifact: null,
        identity: snapshot.identity,
        evidence: graphArtifactEvidence({
          status: capturedStatus,
          available: false,
          reason: snapshot.expected_generator_identity === null ||
            snapshot.committed_head !== capturedStatus.index_head
            ? "generator_identity_unavailable"
            : generatorIdentityReason ?? "artifact_format_unusable",
          artifactSchemaVersion:
            snapshot.artifact?.cache_metadata?.[SIDECAR_ARTIFACT_SCHEMA_FIELD] ?? null
        })
      };
    }
    return {
      artifact: snapshot.artifact,
      identity: snapshot.identity,
      derived: getVerifiedSidecarArtifactDerivedState(snapshot.artifact),
      evidence: graphArtifactEvidence({
        status: capturedStatus,
        available: true,
        artifactSchemaVersion:
          snapshot.artifact.cache_metadata[SIDECAR_ARTIFACT_SCHEMA_FIELD]
      })
    };
  } catch (error) {
    return {
      artifact: null,
      identity: null,
      evidence: graphArtifactEvidence({
        status: capturedStatus ?? {},
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
