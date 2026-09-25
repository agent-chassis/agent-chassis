import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, gzipSync, inflateRawSync } from "node:zlib";

const CERTIFICATION_ARCHIVE_NAME = "certification.json.gz";
const CERTIFICATION_BUNDLE_SCHEMA = "controlled-contract-certification-bundle.v1";
const CERTIFICATION_ARTIFACT_MAX_ENCODED_BYTES = 32 * 1024 * 1024;
const CERTIFICATION_ARTIFACT_MAX_DECODED_BYTES = 32 * 1024 * 1024;
const GZIP_LEVEL = 6;
const GZIP_HEADER_BYTES = 10;
const GZIP_TRAILER_BYTES = 8;
const MEMBER_PATH = /^(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.json$/u;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CERTIFICATION_PROFILES_ROOT = path.join(packageRoot, "test/certification/profiles");
const RUNTIME_PROFILES_ROOT = path.join(packageRoot, "profiles");

const RESTORE_RECOVERY =
  "restore the archive bytes from version control; certification generation " +
  "cannot recreate authored certification inputs, and derived results are " +
  "rebuilt only by node packages/controlled-contract/test/support/" +
  "build-admitted-proof-pack-catalog.mjs --destination <existing-empty-directory> " +
  "after every authored input is intact";

class CertificationArtifactError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CertificationArtifactError";
    this.code = code;
    this.details = details;
  }
}

function refuse(label, reason, message, filePath, extra = {}) {
  throw new CertificationArtifactError(`${label}_${reason}`, message, {
    artifact_path: filePath,
    failure_kind: "mechanical",
    recovery: RESTORE_RECOVERY,
    ...extra
  });
}

function asBytes(content) {
  if (typeof content === "string") return Buffer.from(content, "utf8");
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) return Buffer.from(content);
  throw new TypeError("certification content must be a string or bytes");
}

function encodeCertificationArtifact(content) {
  const bytes = asBytes(content);
  if (bytes.length > CERTIFICATION_ARTIFACT_MAX_DECODED_BYTES) {
    throw new CertificationArtifactError("certification_archive_decoded_size_exceeded",
      "certification archive exceeds the decoded size bound", {
        decoded_bytes: bytes.length,
        limit_bytes: CERTIFICATION_ARTIFACT_MAX_DECODED_BYTES
      });
  }
  const encoded = gzipSync(bytes, { level: GZIP_LEVEL });
  if (encoded.length > CERTIFICATION_ARTIFACT_MAX_ENCODED_BYTES) {
    throw new CertificationArtifactError("certification_archive_encoded_size_exceeded",
      "certification archive exceeds the encoded size bound", {
        encoded_bytes: encoded.length,
        limit_bytes: CERTIFICATION_ARTIFACT_MAX_ENCODED_BYTES
      });
  }
  return encoded;
}

function decodeCertificationArtifact(encoded, {
  label = "certification_archive",
  filePath = null
} = {}) {
  const bytes = asBytes(encoded);
  if (bytes.length > CERTIFICATION_ARTIFACT_MAX_ENCODED_BYTES) refuse(label,
    "encoded_size_exceeded", `${label} exceeds the encoded size bound`, filePath,
    { encoded_bytes: bytes.length, limit_bytes: CERTIFICATION_ARTIFACT_MAX_ENCODED_BYTES });
  if (bytes.length < GZIP_HEADER_BYTES + GZIP_TRAILER_BYTES) refuse(label,
    "gzip_truncated", `${label} is shorter than a complete gzip member`, filePath);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 0x08) refuse(label,
    "gzip_framing_invalid", `${label} is not a deflate gzip member`, filePath);
  if (bytes[3] !== 0 || bytes.readUInt32LE(4) !== 0) refuse(label,
    "gzip_framing_invalid",
    `${label} gzip header carries flags, a filename or a timestamp`, filePath);
  let inflated;
  try {
    inflated = inflateRawSync(bytes.subarray(GZIP_HEADER_BYTES), {
      info: true,
      maxOutputLength: CERTIFICATION_ARTIFACT_MAX_DECODED_BYTES
    });
  } catch (error) {
    if (error?.code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError) refuse(label,
      "decoded_size_exceeded", `${label} decodes past the decoded size bound`, filePath,
      { limit_bytes: CERTIFICATION_ARTIFACT_MAX_DECODED_BYTES });
    if (error?.code === "Z_BUF_ERROR") refuse(label, "gzip_truncated",
      `${label} deflate stream is truncated`, filePath);
    refuse(label, "gzip_corrupt", `${label} deflate stream is corrupt: ${error.message}`,
      filePath);
  }
  const decoded = inflated.buffer;
  const trailerStart = GZIP_HEADER_BYTES + inflated.engine.bytesWritten;
  const remaining = bytes.length - trailerStart;
  if (remaining < GZIP_TRAILER_BYTES) refuse(label, "gzip_truncated",
    `${label} gzip trailer is truncated`, filePath);
  if (remaining > GZIP_TRAILER_BYTES) refuse(label, "gzip_framing_invalid",
    `${label} carries bytes after its single gzip member`, filePath,
    { trailing_bytes: remaining - GZIP_TRAILER_BYTES });
  if (bytes.readUInt32LE(trailerStart) !== crc32(decoded) ||
      bytes.readUInt32LE(trailerStart + 4) !== (decoded.length >>> 0)) refuse(label,
    "gzip_integrity_mismatch", `${label} decoded bytes fail the gzip CRC-32 or length check`,
    filePath);
  return decoded;
}

function decodeUtf8(bytes, label, filePath) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    refuse(label, "utf8_invalid", `${label} is not valid UTF-8: ${error.message}`, filePath);
  }
}

function parseJsonText(text, label, filePath) {
  try {
    return JSON.parse(text);
  } catch (error) {
    refuse(label, "invalid_json", `invalid JSON in ${label} ${filePath}: ${error.message}`,
      filePath);
  }
}

async function readEncoded(filePath, label) {
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile()) refuse(label, "missing", `${label} is not a regular file`, filePath);
    if (metadata.size > CERTIFICATION_ARTIFACT_MAX_ENCODED_BYTES) refuse(label,
      "encoded_size_exceeded", `${label} exceeds the encoded size bound`, filePath,
      { encoded_bytes: metadata.size, limit_bytes: CERTIFICATION_ARTIFACT_MAX_ENCODED_BYTES });
    return await handle.readFile();
  } catch (error) {
    if (error instanceof CertificationArtifactError) throw error;
    refuse(label, "missing", `cannot read ${label} ${filePath}: ${error.message}`, filePath);
  } finally {
    await handle?.close();
  }
}

function certificationArchivePath(directory) {
  return path.join(directory, CERTIFICATION_ARCHIVE_NAME);
}

function serializeCertificationBundle(identity, members) {
  const entries = [...members].map(([memberPath, content]) => {
    if (!MEMBER_PATH.test(memberPath)) throw new CertificationArtifactError(
      "certification_archive_member_path_invalid",
      `certification member path is not a normalized relative JSON path: ${memberPath}`,
      { member_path: memberPath });
    return { path: memberPath, text: decodeUtf8(asBytes(content), "certification_member",
      memberPath) };
  }).sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return `${JSON.stringify({
    schema_version: CERTIFICATION_BUNDLE_SCHEMA,
    profile_id: identity.profile_id,
    profile_version: identity.profile_version,
    members: entries
  }, null, 2)}\n`;
}

function assertBundle(bundle, identity, label, filePath) {
  const malformed = (message) => refuse(label, "bundle_invalid", message, filePath);
  if (bundle === null || typeof bundle !== "object" || Array.isArray(bundle) ||
      Object.keys(bundle).sort().join(",") !==
        "members,profile_id,profile_version,schema_version" ||
      bundle.schema_version !== CERTIFICATION_BUNDLE_SCHEMA ||
      !Array.isArray(bundle.members)) {
    malformed(`${label} is not a ${CERTIFICATION_BUNDLE_SCHEMA} document`);
  }
  if (identity && (bundle.profile_id !== identity.profile_id ||
      bundle.profile_version !== identity.profile_version)) refuse(label,
    "identity_mismatch", `${label} does not certify the identity of its directory`, filePath, {
      expected_profile_id: identity.profile_id,
      expected_profile_version: identity.profile_version,
      actual_profile_id: bundle.profile_id,
      actual_profile_version: bundle.profile_version
    });
  const members = new Map();
  let previous = null;
  for (const member of bundle.members) {
    if (member === null || typeof member !== "object" ||
        Object.keys(member).sort().join(",") !== "path,text" ||
        typeof member.path !== "string" || typeof member.text !== "string" ||
        !MEMBER_PATH.test(member.path)) malformed(`${label} has a malformed member`);
    if (previous !== null && !(previous < member.path)) malformed(
      `${label} members are not unique and sorted by path`);
    previous = member.path;
    members.set(member.path, Buffer.from(member.text, "utf8"));
  }
  return members;
}

async function readCertificationArchive(directory, {
  identity = null,
  label = "certification_archive"
} = {}) {
  const filePath = certificationArchivePath(directory);
  const decoded = decodeCertificationArtifact(await readEncoded(filePath, label),
    { label, filePath });
  const bundle = parseJsonText(decodeUtf8(decoded, label, filePath), label, filePath);
  return Object.freeze({
    path: filePath,
    profile_id: bundle?.profile_id,
    profile_version: bundle?.profile_version,
    members: assertBundle(bundle, identity, label, filePath)
  });
}

function certificationMember(archive, memberPath, { label = "certification_member" } = {}) {
  const bytes = archive.members.get(memberPath);
  if (bytes === undefined) refuse(label, "missing",
    `${label} ${memberPath} is absent from ${archive.path}`, archive.path,
    { member_path: memberPath });
  const text = decodeUtf8(bytes, label, `${archive.path}#${memberPath}`);
  return {
    value: parseJsonText(text, label, `${archive.path}#${memberPath}`),
    text,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    source_base64: bytes.toString("base64")
  };
}

async function writeCertificationArchive(directory, identity, members) {
  await mkdir(directory, { recursive: true });
  await writeFile(certificationArchivePath(directory),
    encodeCertificationArtifact(serializeCertificationBundle(identity, members)));
}

const certificationJsonBytes = (value) => `${JSON.stringify(value, null, 2)}\n`;

function certificationDirectory({ profile_id: id, profile_version: version },
  root = CERTIFICATION_PROFILES_ROOT) {
  return path.join(root, id, version);
}

function runtimeProfileDirectory({ profile_id: id, profile_version: version },
  root = RUNTIME_PROFILES_ROOT) {
  return path.join(root, id, version);
}

async function readCertificationDocument(identity, memberPath, { root } = {}) {
  const archive = await readCertificationArchive(certificationDirectory(identity, root),
    { identity });
  return certificationMember(archive, memberPath).value;
}

async function readRuntimeDocument(identity, fileName, { root } = {}) {
  return JSON.parse(await readFile(
    path.join(runtimeProfileDirectory(identity, root), fileName), "utf8"
  ));
}

const DECLARED_PATH =
  /^packages\/controlled-contract\/test\/certification\/profiles\/([^/]+)\/([^/]+)\/(.+)$/u;

async function readDeclaredCertificationDocument(declaredPath, { root } = {}) {
  const match = DECLARED_PATH.exec(declaredPath);
  if (!match || match[3].split("/").includes("..")) {
    throw new CertificationArtifactError("certification_declared_path_invalid",
      `declared path is not a certification archive member: ${declaredPath}`,
      { declared_path: declaredPath });
  }
  return readCertificationDocument({ profile_id: match[1], profile_version: match[2] },
    match[3], { root });
}

const RUNTIME_DOCUMENTS = new Set([
  "admission.json", "component-exclusion-applicability.json",
  "evaluation-input.template.json", "parameter-contract.json", "profile.json"
]);

async function readDefinitionDocument(identity, name, options = {}) {
  return RUNTIME_DOCUMENTS.has(name)
    ? readRuntimeDocument(identity, name, options)
    : readCertificationDocument(identity, name, options);
}

export {
  CERTIFICATION_ARCHIVE_NAME,
  CERTIFICATION_ARTIFACT_MAX_DECODED_BYTES,
  CERTIFICATION_ARTIFACT_MAX_ENCODED_BYTES,
  CERTIFICATION_BUNDLE_SCHEMA,
  CERTIFICATION_PROFILES_ROOT,
  CertificationArtifactError,
  RUNTIME_PROFILES_ROOT,
  certificationArchivePath,
  certificationDirectory,
  certificationJsonBytes,
  certificationMember,
  decodeCertificationArtifact,
  encodeCertificationArtifact,
  readCertificationArchive,
  readCertificationDocument,
  readDeclaredCertificationDocument,
  readDefinitionDocument,
  readRuntimeDocument,
  runtimeProfileDirectory,
  serializeCertificationBundle,
  writeCertificationArchive
};
