import { createHash } from "node:crypto";
import path from "node:path";

import { loadCanonicalState, resolveContractContext } from "./wiki.mjs";
import {
  SIDECAR_ARTIFACT_SCHEMA_FIELD,
  SIDECAR_ARTIFACT_SCHEMA_VERSION
} from "./sidecar-schema.mjs";
import {
  SIDECAR_GRAPH_GENERATOR_IDENTITY_FIELD,
  SIDECAR_GRAPH_SCHEMA_VERSION,
  SIDECAR_GRAPH_SECTION_FIELD,
  classifySidecarGraphArtifactSchema
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
import { readSidecarArtifactBytes } from "./sidecar-artifact-bytes.mjs";
import { computeSidecarGeneratorIdentity } from "./sidecar-generator-identity.mjs";

const SIDECAR_GENERATOR_IDENTITY_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ARTIFACT_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ARTIFACT_IDENTITY_FIELDS = Object.freeze([
  "sha256", "byte_length", "index_head", "artifact_schema_version",
  "graph_schema_version", "generator_identity", "graph_compatible"]);
const ARTIFACT_IDENTITY_PROVENANCE = new WeakMap();
const READ_ARTIFACT_COMPATIBILITY_PROVENANCE = new WeakMap();

function plainDataTree(value, { freeze = false } = {}, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) return false;
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return false;
    if (array && key === "length") continue;
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !plainDataTree(descriptor.value, { freeze }, seen)) return false;
  }
  if (array && Object.keys(descriptors).length !== value.length + 1) return false;
  if (freeze) Object.freeze(value);
  return true;
}

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

function artifactIdentityFromClassification(rawBytes, artifact, graphClassification) {
  const generatorIdentity =
    artifact?.[SIDECAR_GRAPH_SECTION_FIELD]?.[SIDECAR_GRAPH_GENERATOR_IDENTITY_FIELD] ?? null;
  return {
    sha256: createHash("sha256").update(rawBytes).digest("hex"),
    byte_length: rawBytes.length,
    index_head: artifact?.index_head ?? null,
    artifact_schema_version:
      artifact?.cache_metadata?.[SIDECAR_ARTIFACT_SCHEMA_FIELD] ?? null,
    graph_schema_version: graphClassification.graph_state.graph_schema_version ?? null,
    generator_identity: generatorIdentity,
    graph_compatible: graphClassification.compatible &&
      graphClassification.graph_state.graph_available === true
  };
}

export function createArtifactIdentity(rawBytes, artifact) {
  return artifactIdentityFromClassification(rawBytes, artifact,
    classifySidecarGraphArtifactSchema(artifact));
}

function identityIsComplete(identity) {
  return Boolean(identity && typeof identity === "object" && !Array.isArray(identity) &&
    typeof identity.sha256 === "string" && ARTIFACT_DIGEST_PATTERN.test(identity.sha256) &&
    Number.isSafeInteger(identity.byte_length) && identity.byte_length > 0 &&
    typeof identity.index_head === "string" && COMMIT_PATTERN.test(identity.index_head) &&
    identity.artifact_schema_version === SIDECAR_ARTIFACT_SCHEMA_VERSION &&
    identity.graph_schema_version === SIDECAR_GRAPH_SCHEMA_VERSION && typeof identity.generator_identity === "string" &&
    SIDECAR_GENERATOR_IDENTITY_PATTERN.test(identity.generator_identity) &&
    identity.graph_compatible === true);
}

export function artifactIdentityMatches(left, right) {
  const leftProvenance = ARTIFACT_IDENTITY_PROVENANCE.get(left);
  const rightProvenance = ARTIFACT_IDENTITY_PROVENANCE.get(right);
  return Boolean(identityIsComplete(left) && identityIsComplete(right) &&
    leftProvenance && rightProvenance && ARTIFACT_IDENTITY_FIELDS.every((field, index) =>
      left[field] === leftProvenance[index] && right[field] === rightProvenance[index] &&
      left[field] === right[field]));
}

export function classifyReadSidecarGraphArtifact(artifact) {
  if (arguments.length !== 1) {
    throw new TypeError("artifact classification accepts only the artifact returned by readArtifact");
  }
  const provenance = READ_ARTIFACT_COMPATIBILITY_PROVENANCE.get(artifact);
  return classifySidecarGraphArtifactSchema(artifact, provenance?.identity &&
    ARTIFACT_IDENTITY_PROVENANCE.has(provenance.identity)
    ? { expectedGeneratorIdentity: provenance.expectedGeneratorIdentity }
    : {});
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
    const { rawBytes, artifact } = await readSidecarArtifactBytes(
      path.join(repoRoot, capturedStatus.artifact_path)
    );
    if (!plainDataTree(artifact, { freeze: true })) {
      return {
        artifact: null,
        identity: null,
        evidence: graphArtifactEvidence({
          status: capturedStatus,
          available: false,
          reason: "artifact_format_unusable"
        })
      };
    }
    let expected;
    try {
      expected = await computeSidecarGeneratorIdentity({ repoRoot });
      if (expected.committed_head !== capturedStatus.index_head) expected = null;
    } catch {
      expected = null;
    }
    if (!expected) {
      return {
        artifact: null,
        identity: createArtifactIdentity(rawBytes, artifact),
        evidence: graphArtifactEvidence({
          status: capturedStatus,
          available: false,
          reason: "generator_identity_unavailable"
        })
      };
    }
    const generatorIdentityReason = graphGeneratorIdentityReason(
      artifact,
      expected.generator_identity
    );
    const identity = artifactIdentityFromClassification(rawBytes, artifact,
      classifySidecarGraphArtifactSchema(artifact, {
        expectedGeneratorIdentity: expected.generator_identity
      }));
    if (!artifactIsCompatible(artifact) || generatorIdentityReason ||
      identity.index_head !== capturedStatus.index_head || !identityIsComplete(identity)) {
      return {
        artifact: null,
        identity,
        evidence: graphArtifactEvidence({
          status: capturedStatus,
          available: false,
          reason: generatorIdentityReason ?? "artifact_format_unusable",
          artifactSchemaVersion:
            artifact?.cache_metadata?.[SIDECAR_ARTIFACT_SCHEMA_FIELD] ?? null
        })
      };
    }
    Object.freeze(identity);
    ARTIFACT_IDENTITY_PROVENANCE.set(identity,
      Object.freeze(ARTIFACT_IDENTITY_FIELDS.map((field) => identity[field])));
    READ_ARTIFACT_COMPATIBILITY_PROVENANCE.set(artifact, Object.freeze({
      expectedGeneratorIdentity: expected.generator_identity,
      identity,
      sha256: identity.sha256,
      byte_length: identity.byte_length
    }));
    return {
      artifact,
      identity,
      evidence: graphArtifactEvidence({
        status: capturedStatus,
        available: true,
        artifactSchemaVersion: artifact.cache_metadata[SIDECAR_ARTIFACT_SCHEMA_FIELD]
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
