

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeSync
} from "node:fs";
import path from "node:path";

export const MANAGED_ASSIGNMENT_READ_ARTIFACT_SCHEMA_VERSION =
  "managed-assignment-read-artifact.v1";
export const MANAGED_ASSIGNMENT_READ_ARTIFACT_PATH_ENV_VAR =
  "WIKI_MCP_MANAGED_ASSIGNMENT_PATH";
export const MANAGED_ASSIGNMENT_READ_ARTIFACT_FILENAME_PREFIX =
  "managed-assignment-sha256-";

export const PRIVATE_IMMUTABLE_ARTIFACT_MAX_BYTES = 16 * 1024 * 1024;
export const MANAGED_ASSIGNMENT_READ_ARTIFACT_MAX_BYTES = PRIVATE_IMMUTABLE_ARTIFACT_MAX_BYTES;

export const MANAGED_ASSIGNMENT_READ_REFUSAL_CODES = Object.freeze({
  SELECTOR_INVALID: "assignment_read_selector_invalid",
  BINDING_MISMATCH: "assignment_read_binding_mismatch",
  UNAVAILABLE: "assignment_read_unavailable",
  STALE_DIGEST: "assignment_read_stale_digest",
  PUBLICATION_FAILED: "assignment_read_publication_failed"
});

export const MANAGED_WORKER_ASSIGNMENT_FIRST_READ = Object.freeze({ assignment: true });

function sha256Digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export class PrivateImmutableArtifactPublicationError extends Error {
  constructor(message, { cause = null, cleanupFailures = [] } = {}) {
    super(message);
    this.name = "PrivateImmutableArtifactPublicationError";
    this.cause = cause;
    this.cleanupFailures = Object.freeze([...cleanupFailures]);
  }
}

function cleanupFailure(operation, error) {
  return Object.freeze({
    operation,
    code: error?.code ?? null,
    message: error?.message ?? String(error)
  });
}

function removeAcquiredArtifact(artifactPath, cleanupFailures) {
  try {
    unlinkSync(artifactPath);
  } catch (error) {
    if (error?.code !== "ENOENT") return [...cleanupFailures, cleanupFailure("unlink", error)];
  }
  return cleanupFailures;
}

function operationFailureMessage(resourceLabel, error) {
  return `${resourceLabel} publication failed: ${error?.message ?? String(error)}`;
}

export function publishPrivateImmutableArtifact({
  scope,
  directory,
  prefix,
  resourceLabel,
  maxBytes,
  snapshot
}) {
  const digestHex = typeof snapshot?.digest === "string"
    ? snapshot.digest.match(/^sha256:([0-9a-f]{64})$/u)?.[1] ?? null
    : null;
  if (digestHex === null || !(snapshot.bytes instanceof Uint8Array) ||
      snapshot.bytes.byteLength !== snapshot.byte_length ||
      snapshot.byte_length <= 0 || snapshot.byte_length > maxBytes ||
      sha256Digest(snapshot.bytes) !== snapshot.digest) {
    throw new PrivateImmutableArtifactPublicationError(
      `${resourceLabel} snapshot is incomplete before publication`);
  }
  const artifactPath = path.join(directory, `${prefix}${digestHex}.json`);
  const bytes = snapshot.bytes;
  let fd;
  try {
    fd = openSync(
      artifactPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY |
        fsConstants.O_NOFOLLOW,
      0o600
    );
  } catch (error) {
    throw new PrivateImmutableArtifactPublicationError(
      operationFailureMessage(resourceLabel, error), { cause: error });
  }

  let operationError = null;
  let writeStalled = false;
  try {
    let offset = 0;
    while (offset < bytes.byteLength) {
      const written = writeSync(fd, bytes, offset, bytes.byteLength - offset);
      if (written <= 0) {
        writeStalled = true;
        break;
      }
      offset += written;
    }
    if (!writeStalled) {
      fsyncSync(fd);
      fchmodSync(fd, 0o400);
      fsyncSync(fd);
    }
  } catch (error) {
    operationError = error;
  }
  let closeError = null;
  try {
    closeSync(fd);
  } catch (error) {
    closeError = error;
  }
  if (operationError !== null || writeStalled) {
    const cleanupFailures = removeAcquiredArtifact(artifactPath,
      closeError === null ? [] : [cleanupFailure("close", closeError)]);
    throw new PrivateImmutableArtifactPublicationError(
      writeStalled ? `${resourceLabel} write made no progress`
        : operationFailureMessage(resourceLabel, operationError),
      { cause: operationError, cleanupFailures });
  }
  if (closeError !== null) {

    throw new PrivateImmutableArtifactPublicationError(
      operationFailureMessage(resourceLabel, closeError),
      { cause: closeError, cleanupFailures: removeAcquiredArtifact(artifactPath, []) });
  }

  let stats;
  try {
    stats = statSync(artifactPath);
  } catch (error) {
    throw new PrivateImmutableArtifactPublicationError(
      operationFailureMessage(resourceLabel, error),
      { cause: error, cleanupFailures: removeAcquiredArtifact(artifactPath, []) });
  }
  const expectedUid = typeof process.getuid === "function" ? process.getuid() : stats.uid;
  if (!stats.isFile() || stats.uid !== expectedUid ||
      (stats.mode & 0o777) !== 0o400 || stats.size !== snapshot.byte_length) {
    throw new PrivateImmutableArtifactPublicationError(
      `published ${resourceLabel} failed its immutable identity check`,
      { cleanupFailures: removeAcquiredArtifact(artifactPath, []) });
  }
  try {
    scope.adopt(resourceLabel, () => {
      try { unlinkSync(artifactPath); } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    });
  } catch (error) {

    throw new PrivateImmutableArtifactPublicationError(
      operationFailureMessage(resourceLabel, error),
      { cause: error, cleanupFailures: removeAcquiredArtifact(artifactPath, []) });
  }
  return artifactPath;
}

export function readPrivateImmutableArtifact({ artifactPath, prefix, maxBytes }) {
  if (typeof artifactPath !== "string" || !path.isAbsolute(artifactPath)) return null;
  const digestHex = path.basename(artifactPath).match(new RegExp(
    `^${prefix}([0-9a-f]{64})\\.json$`, "u"))?.[1] ?? null;
  if (digestHex === null) return null;
  const directory = path.dirname(artifactPath);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === null || realpathSync(directory) !== directory) return null;
  const directoryStats = lstatSync(directory);
  const fileStats = lstatSync(artifactPath);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink() ||
      directoryStats.uid !== uid || (directoryStats.mode & 0o777) !== 0o700 ||
      !fileStats.isFile() || fileStats.isSymbolicLink() || fileStats.uid !== uid ||
      (fileStats.mode & 0o777) !== 0o400 || fileStats.size <= 0 ||
      fileStats.size > maxBytes) {
    return null;
  }
  const fd = openSync(artifactPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let bytes;
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== fileStats.dev || opened.ino !== fileStats.ino ||
        opened.size !== fileStats.size || (opened.mode & 0o777) !== 0o400) {
      return null;
    }
    bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
        (after.mode & 0o777) !== 0o400 || bytes.byteLength !== opened.size) {
      return null;
    }
  } finally {
    closeSync(fd);
  }
  const digest = sha256Digest(bytes);
  return digest === `sha256:${digestHex}` ? Object.freeze({ digest, bytes }) : null;
}

export function createManagedAssignmentReadSnapshot(assignment) {
  const presentation = {
    schema_version: MANAGED_ASSIGNMENT_READ_ARTIFACT_SCHEMA_VERSION,
    identity: {
      assigned_unit: assignment.unit_address,
      role: assignment.role,
      canonical_source_digest: assignment.source_digest ?? null,
      run_id: assignment.run_id ?? null
    },
    guidance: assignment.assignment_guidance
  };
  const bytes = new Uint8Array(Buffer.from(JSON.stringify(presentation), "utf8"));
  return Object.freeze({
    schema_version: MANAGED_ASSIGNMENT_READ_ARTIFACT_SCHEMA_VERSION,
    assigned_unit: assignment.unit_address,
    role: assignment.role,
    bytes,
    byte_length: bytes.byteLength,
    digest: sha256Digest(bytes)
  });
}

export function resolveManagedAssignmentDelivery({
  advisoryReviewInput = null,
  workerAssignment = null,
  renderAdvisoryReviewStartup,
  unmanagedPrompt
}) {
  if (advisoryReviewInput !== null) {
    return Object.freeze({
      prompt: renderAdvisoryReviewStartup(advisoryReviewInput),
      conduitWorkerAssignment: null
    });
  }
  if (workerAssignment !== null) {
    return Object.freeze({
      prompt: workerAssignment.prompt,
      conduitWorkerAssignment: workerAssignment
    });
  }
  return Object.freeze({ prompt: unmanagedPrompt(), conduitWorkerAssignment: null });
}
