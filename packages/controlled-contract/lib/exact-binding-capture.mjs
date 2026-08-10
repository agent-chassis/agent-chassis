import { constants } from "node:fs";
import { open } from "node:fs/promises";
import process from "node:process";

import {
  ExactBindingError,
  canonicalJsonBytes,
  compareCodeUnits,
  deepFreeze,
  sha256
} from "./exact-binding-common.mjs";
import { projectDeterministicPopulation } from "./deterministic-projection.mjs";
import {
  INTERNAL_CAPTURE_AUTHORITY,
  evaluateCaptureFailureExactBindingsV1,
  evaluateCapturedExactBindingsV1
} from "./exact-binding.mjs";
import { assertBoundaryRequest } from "./exact-binding-plain-data.mjs";

const ARTIFACT_MEDIA_TYPE = "application/octet-stream";
const REACHABILITY_MEDIA_TYPE =
  "application/vnd.controlled-contract.complete-reachability-snapshot+json";
const MUTATION_MEDIA_TYPE =
  "application/vnd.controlled-contract.observed-execution-mutations+json";
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY |
  constants.O_NOFOLLOW | (constants.O_CLOEXEC ?? 0);
const FILE_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW |
  (constants.O_CLOEXEC ?? 0);
const FILE_TYPE_MASK = 0o170000n;
const REGULAR_FILE_TYPE = 0o100000n;

function stableStat(stat) {
  if (typeof stat.ctimeNs !== "bigint" || typeof stat.mtimeNs !== "bigint") {
    throw new ExactBindingError(
      "capture_change_metadata_unavailable",
      "nanosecond mtime and ctime metadata are required"
    );
  }
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs
  });
}

function equalStableStat(left, right) {
  return ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"].every(
    (field) => left[field] === right[field]
  );
}

function validateStableArtifactObservation(before, after, byteLength) {
  const first = stableStat(before);
  const second = stableStat(after);
  if (!equalStableStat(first, second)) throw new ExactBindingError(
    "artifact_capture_changed_during_read",
    "artifact identity or change metadata changed during capture"
  );
  if ((first.mode & FILE_TYPE_MASK) !== REGULAR_FILE_TYPE) throw new ExactBindingError(
    "artifact_capture_not_regular",
    "artifact capture accepts only regular files"
  );
  if (BigInt(byteLength) !== first.size || BigInt(byteLength) !== second.size) {
    throw new ExactBindingError(
      "artifact_capture_byte_length_mismatch",
      "captured byte length does not equal both stable file sizes"
    );
  }
  return first;
}

function relativeComponents(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 ||
      relativePath.includes("\0") || relativePath.startsWith("/")) {
    throw new ExactBindingError(
      "artifact_relative_path_invalid", "artifact path must be a nonempty relative path"
    );
  }
  const components = relativePath.split("/");
  if (components.some((part) => part === "" || part === "." || part === "..")) {
    throw new ExactBindingError(
      "artifact_relative_path_invalid",
      "artifact path may not contain empty, current, or parent components"
    );
  }
  return components;
}

function assertDescriptorCapturePlatform(platform) {
  if (platform !== "linux") throw new ExactBindingError(
    "descriptor_capture_primitive_unavailable",
    "the exact-binding v1 descriptor walk is available only on Linux"
  );
}

async function openBelowDescriptor(directoryHandle, component, flags) {
  assertDescriptorCapturePlatform(process.platform);
  const descriptorPath = `/proc/self/fd/${directoryHandle.fd}/${component}`;
  try {
    return await open(descriptorPath, flags);
  } catch (error) {
    throw new ExactBindingError(
      error?.code === "ELOOP" ? "artifact_symlink_refused" :
        "descriptor_relative_open_failed",
      "descriptor-relative confined open failed",
      { cause_code: error?.code ?? "unknown" }
    );
  }
}

class PinnedCaptureRoot {
  #handle;
  #identity;
  #closed = false;

  constructor(handle, identity) {
    this.#handle = handle;
    this.#identity = identity;
  }

  static async open(trustedRootPath) {
    assertDescriptorCapturePlatform(process.platform);
    let handle;
    try {
      handle = await open(trustedRootPath, DIRECTORY_FLAGS);
      const stat = stableStat(await handle.stat({ bigint: true }));
      if ((stat.mode & FILE_TYPE_MASK) !== 0o040000n) throw new ExactBindingError(
        "capture_root_not_directory", "trusted capture root is not a directory"
      );
      return new PinnedCaptureRoot(handle, stat);
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error instanceof ExactBindingError) throw error;
      throw new ExactBindingError(
        "capture_root_open_failed", "trusted capture root could not be pinned",
        { cause_code: error?.code ?? "unknown" }
      );
    }
  }

  async captureArtifact(relativePath) {
    if (this.#closed) throw new ExactBindingError(
      "capture_root_closed", "trusted capture root is closed"
    );
    const currentRoot = stableStat(await this.#handle.stat({ bigint: true }));
    if (currentRoot.dev !== this.#identity.dev || currentRoot.ino !== this.#identity.ino) {
      throw new ExactBindingError(
        "capture_root_identity_changed", "pinned root object identity changed"
      );
    }
    const components = relativeComponents(relativePath);
    const directoryHandles = [];
    let directory = this.#handle;
    let artifact;
    try {
      for (const component of components.slice(0, -1)) {
        const child = await openBelowDescriptor(directory, component, DIRECTORY_FLAGS);
        const childStat = stableStat(await child.stat({ bigint: true }));
        if ((childStat.mode & FILE_TYPE_MASK) !== 0o040000n) {
          await child.close();
          throw new ExactBindingError(
            "artifact_intermediate_not_directory",
            "artifact path intermediate is not a directory"
          );
        }
        directoryHandles.push(child);
        directory = child;
      }
      artifact = await openBelowDescriptor(
        directory, components[components.length - 1], FILE_FLAGS
      );
      const before = await artifact.stat({ bigint: true });
      const bytes = await artifact.readFile();
      const after = await artifact.stat({ bigint: true });
      validateStableArtifactObservation(before, after, bytes.byteLength);
      return Buffer.from(bytes);
    } finally {
      await artifact?.close().catch(() => {});
      for (const handle of directoryHandles.reverse()) await handle.close().catch(() => {});
    }
  }

  async pinDirectory(relativePath) {
    if (this.#closed) throw new ExactBindingError(
      "capture_root_closed", "trusted capture root is closed"
    );
    const components = relativeComponents(relativePath);
    const opened = [];
    let directory = this.#handle;
    try {
      for (const component of components) {
        const child = await openBelowDescriptor(directory, component, DIRECTORY_FLAGS);
        const stat = stableStat(await child.stat({ bigint: true }));
        if ((stat.mode & FILE_TYPE_MASK) !== 0o040000n) {
          await child.close();
          throw new ExactBindingError(
            "artifact_intermediate_not_directory", "pinned component is not a directory"
          );
        }
        opened.push(child);
        directory = child;
      }
      const retained = opened.pop();
      for (const handle of opened.reverse()) await handle.close();
      return new PinnedCaptureRoot(
        retained,
        stableStat(await retained.stat({ bigint: true }))
      );
    } catch (error) {
      for (const handle of opened.reverse()) await handle.close().catch(() => {});
      throw error;
    }
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await this.#handle.close();
  }
}

function normalizeReachabilitySnapshot(snapshot) {
  const subjectReferenceId = normalizeSnapshotText(
    snapshot.subject_reference_id, "reachability_subject_reference_id"
  );
  const nodes = snapshot.nodes.map(({ reference_id: referenceId }) => ({
    reference_id: normalizeSnapshotText(referenceId, "reachability_node_reference_id")
  })).sort((left, right) => compareCodeUnits(left.reference_id, right.reference_id));
  if (new Set(nodes.map(({ reference_id: id }) => id)).size !== nodes.length) {
    throw new ExactBindingError(
      "reachability_node_reference_duplicate",
      "reachability node references must remain unique after normalization"
    );
  }
  const nodeIds = new Set(nodes.map(({ reference_id: id }) => id));
  const edges = snapshot.edges.map((edge) => {
    const normalized = {
      from_reference_id: normalizeSnapshotText(
        edge.from_reference_id, "reachability_edge_from_reference_id"
      ),
      to_reference_id: normalizeSnapshotText(
        edge.to_reference_id, "reachability_edge_to_reference_id"
      )
    };
    if (!nodeIds.has(normalized.from_reference_id) ||
        !nodeIds.has(normalized.to_reference_id)) throw new ExactBindingError(
      "reachability_edge_endpoint_missing",
      "reachability edges must name captured nodes"
    );
    return normalized;
  }).sort((left, right) =>
    compareCodeUnits(
      `${left.from_reference_id}\0${left.to_reference_id}`,
      `${right.from_reference_id}\0${right.to_reference_id}`
    ));
  if (new Set(edges.map((edge) =>
    `${edge.from_reference_id}\0${edge.to_reference_id}`)).size !== edges.length) {
    throw new ExactBindingError(
      "reachability_edge_duplicate", "reachability edges must be unique"
    );
  }
  return {
    complete: snapshot.complete,
    subject_reference_id: subjectReferenceId,
    nodes,
    edges
  };
}

function normalizeMutationSnapshot(snapshot) {
  const subjectReferenceId = normalizeSnapshotText(
    snapshot.subject_reference_id, "mutation_subject_reference_id"
  );
  const mutations = snapshot.mutations.map((mutation) => {
    const normalized = {
      mutation_id: normalizeSnapshotText(mutation.mutation_id, "mutation_id"),
      operation: mutation.operation,
      target_reference_id: normalizeSnapshotText(
        mutation.target_reference_id, "mutation_target_reference_id"
      )
    };
    if (mutation.before_sha256 !== undefined) {
      normalized.before_sha256 = mutation.before_sha256;
    }
    if (mutation.after_sha256 !== undefined) {
      normalized.after_sha256 = mutation.after_sha256;
    }
    const hasBefore = normalized.before_sha256 !== undefined;
    const hasAfter = normalized.after_sha256 !== undefined;
    const digestShapeValid = normalized.operation === "create"
      ? !hasBefore && hasAfter
      : normalized.operation === "delete"
        ? hasBefore && !hasAfter
        : hasBefore && hasAfter &&
          normalized.before_sha256 !== normalized.after_sha256;
    if (!digestShapeValid) throw new ExactBindingError(
      "mutation_digest_shape_invalid",
      "mutation before/after digests do not discriminate the operation"
    );
    return normalized;
  });
  const ids = mutations.map(({ mutation_id: id }) => id);
  if (new Set(ids).size !== ids.length) throw new ExactBindingError(
    "mutation_id_duplicate", "mutation identifiers must be unique"
  );
  return {
    complete: snapshot.complete,
    subject_reference_id: subjectReferenceId,
    mutations: mutations.sort((left, right) =>
      compareCodeUnits(left.mutation_id, right.mutation_id))
  };
}

function normalizeSnapshotText(value, label) {
  if (typeof value !== "string") throw new ExactBindingError(
    "snapshot_text_invalid", `${label} must be a string`
  );
  const normalized = value.normalize("NFC");
  if (normalized.includes("\0")) throw new ExactBindingError(
    "snapshot_text_nul_refused", `${label} contains NUL`
  );
  return normalized;
}

function evaluationReferenceMap(evaluationInput) {
  return new Map((evaluationInput.reference_bindings ?? []).map((binding) => [
    binding.role,
    [...binding.reference_ids].sort(compareCodeUnits)
  ]));
}

function coverageFor(requirement, source, evaluationInput, declaration, bytes) {
  const roleReferences = evaluationReferenceMap(evaluationInput);
  return requirement.role_coverage.map((coverage) => {
    let referenceIds;
    if (coverage.projection === "artifact_subject") {
      referenceIds = roleReferences.get(coverage.role) ?? [];
    } else if (coverage.projection === "snapshot_subject") {
      referenceIds = [source.snapshot.subject_reference_id];
    } else if (coverage.projection === "projection_result_population") {
      const relation = declaration.relations.find(({ operator, result_requirement_id: id }) =>
        operator === "deterministic_projection" && id === requirement.requirement_id
      );
      referenceIds = projectDeterministicPopulation(
        relation.transformer_id, bytes, coverage.population_id
      );
    } else if (source.kind === "complete_reachability_snapshot") {
      referenceIds = source.snapshot.nodes.map(({ reference_id: id }) => id);
    } else {
      referenceIds = source.snapshot.mutations.map(({ mutation_id: id }) => id);
    }
    return {
      role: coverage.role,
      coverage: "exact",
      projection: coverage.projection,
      ...(coverage.population_id === undefined
        ? {} : { population_id: coverage.population_id }),
      reference_ids: [...referenceIds].sort(compareCodeUnits)
    };
  }).sort((left, right) => compareCodeUnits(left.role, right.role));
}

async function captureRequirement(
  requirement, source, evaluationInput, declaration, pinnedRoot
) {
  let bytes;
  let mediaType;
  if (requirement.binding_kind === "artifact_bytes") {
    if (source.kind !== "artifact_file") throw new ExactBindingError(
      "binding_source_kind_mismatch", "artifact requirement needs an artifact source"
    );
    bytes = await pinnedRoot.captureArtifact(source.relative_path);
    mediaType = ARTIFACT_MEDIA_TYPE;
  } else if (requirement.binding_kind === "complete_reachability_snapshot") {
    if (source.kind !== "complete_reachability_snapshot") throw new ExactBindingError(
      "binding_source_kind_mismatch", "reachability requirement needs a graph snapshot"
    );
    bytes = canonicalJsonBytes(normalizeReachabilitySnapshot(source.snapshot));
    mediaType = REACHABILITY_MEDIA_TYPE;
  } else {
    if (source.kind !== "observed_execution_mutation_snapshot") {
      throw new ExactBindingError(
        "binding_source_kind_mismatch", "mutation requirement needs a mutation snapshot"
      );
    }
    bytes = canonicalJsonBytes(normalizeMutationSnapshot(source.snapshot));
    mediaType = MUTATION_MEDIA_TYPE;
  }
  const contentDigest = sha256(bytes);
  return {
    bytes: Buffer.from(bytes),
    binding: {
      binding_id: `binding-${requirement.requirement_id}`,
      requirement_id: requirement.requirement_id,
      capture_id: `capture-${sha256(canonicalJsonBytes({
        requirement_id: requirement.requirement_id,
        binding_kind: requirement.binding_kind,
        content_sha256: contentDigest
      }))}`,
      binding_kind: requirement.binding_kind,
      media_type: mediaType,
      content_sha256: contentDigest,
      source_descriptor_sha256: sha256(canonicalJsonBytes(source)),
      byte_length: bytes.byteLength,
      role_coverage: coverageFor(requirement, source, evaluationInput, declaration, bytes)
    }
  };
}

async function captureAndEvaluateExactBindingsV1({
  request,
  declaration,
  evaluationInput,
  context,
  expectedContext = context,
  pinnedRoot
}) {
  assertBoundaryRequest(request);
  const sources = request.exactBindingSources;
  const declaredIds = new Set(declaration.requirements.map(
    ({ requirement_id: id }) => id
  ));
  const extra = Object.keys(sources).filter((id) => !declaredIds.has(id));
  if (extra.length > 0) return evaluateCaptureFailureExactBindingsV1({
    declaration, evaluationInput, context, expectedContext
  }, {
    code: "binding_source_extra",
    message: "source map contains an undeclared requirement"
  }, INTERNAL_CAPTURE_AUTHORITY);

  const bindings = [];
  const capturedBytesByRequirement = new Map();
  for (const requirement of declaration.requirements) {
    const source = sources[requirement.requirement_id];
    if (!source) continue;
    try {
      const captured = await captureRequirement(
        requirement, source, evaluationInput, declaration, pinnedRoot
      );
      bindings.push(captured.binding);
      capturedBytesByRequirement.set(requirement.requirement_id, captured.bytes);
    } catch (error) {
      return evaluateCaptureFailureExactBindingsV1({
        declaration, evaluationInput, context, expectedContext
      }, {
        code: ID_SAFE_CAPTURE_CODES.has(error?.code)
          ? error.code : "exact_binding_capture_failed",
        message: error?.message ?? "exact binding capture failed",
        requirement_id: requirement.requirement_id
      }, INTERNAL_CAPTURE_AUTHORITY);
    }
  }
  return evaluateCapturedExactBindingsV1({
    declaration,
    evaluationInput,
    context,
    expectedContext,
    bindings,
    capturedBytesByRequirement
  }, INTERNAL_CAPTURE_AUTHORITY);
}

const ID_SAFE_CAPTURE_CODES = new Set([
  "artifact_capture_byte_length_mismatch",
  "artifact_capture_changed_during_read",
  "artifact_capture_not_regular",
  "artifact_intermediate_not_directory",
  "artifact_relative_path_invalid",
  "artifact_symlink_refused",
  "binding_source_kind_mismatch",
  "capture_change_metadata_unavailable",
  "capture_root_closed",
  "capture_root_identity_changed",
  "descriptor_capture_primitive_unavailable",
  "descriptor_relative_open_failed",
  "mutation_id_duplicate",
  "mutation_digest_shape_invalid",
  "reachability_edge_duplicate",
  "reachability_edge_endpoint_missing",
  "reachability_node_reference_duplicate",
  "snapshot_text_invalid",
  "snapshot_text_nul_refused"
]);

export {
  PinnedCaptureRoot,
  assertDescriptorCapturePlatform,
  captureAndEvaluateExactBindingsV1,
  normalizeMutationSnapshot,
  normalizeReachabilitySnapshot,
  validateStableArtifactObservation
};
