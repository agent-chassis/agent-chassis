

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  isAuthenticatedStdioMcpConduitProducerDescriptor
} from "@agent-chassis/wiki-mcp/src/lib/stdio-mcp-conduit-producer-descriptor.mjs";
import {
  LAUNCHER_READINESS_PRODUCER_DESCRIPTOR
} from "@agent-chassis/wiki-mcp/src/lib/launcher-readiness-observer.mjs";
import {
  WIKI_MCP_COMMON_PROOF_RESOLVER_CAPABILITY_VERSION
} from "./wiki-mcp-common-proof-resolver-capability.mjs";

export const WIKI_MCP_HOST_SERVER_PACKAGE_SUBPATH =
  "@agent-chassis/wiki-mcp/src/server.mjs";

export const WIKI_MCP_READINESS_OBSERVER_PACKAGE_SUBPATH =
  "@agent-chassis/wiki-mcp/src/lib/launcher-readiness-observer.mjs";
export const WIKI_MCP_COMMON_PROOF_RESOLVER_CONSUMER_PACKAGE_SUBPATH =
  "@agent-chassis/wiki-mcp/src/lib/launcher-common-proof-resolver-capability.mjs";

const requireFromLauncher = createRequire(import.meta.url);
const TRUSTED_HOST_SERVER_BINDINGS = new WeakSet();
let corePackageDocsComposition = null;

export const PACKAGE_DOCS_CARRIER_COMPOSITION_ERROR_CODE =
  "package_docs_carrier_composition_incompatible";
export const PACKAGE_DOCS_CARRIER_COMPOSITION_REASONS = Object.freeze([
  "entrypoint_missing",
  "carrier_missing",
  "package_metadata_invalid",
  "manifest_invalid",
  "generation_stale",
  "package_version_mismatch",
  "probe_mismatch",
  "duplicate_bind"
]);

function compositionDiagnostic(reason) {
  const closedReason = PACKAGE_DOCS_CARRIER_COMPOSITION_REASONS.includes(reason)
    ? reason
    : "probe_mismatch";
  return Object.freeze({
    code: PACKAGE_DOCS_CARRIER_COMPOSITION_ERROR_CODE,
    reason: closedReason
  });
}

export class PackageDocsCarrierCompositionError extends Error {
  constructor(reason) {
    super(PACKAGE_DOCS_CARRIER_COMPOSITION_ERROR_CODE);
    this.name = "PackageDocsCarrierCompositionError";
    this.code = PACKAGE_DOCS_CARRIER_COMPOSITION_ERROR_CODE;
    this.detail = compositionDiagnostic(reason);
  }
}

function failComposition(reason) {
  throw new PackageDocsCarrierCompositionError(reason);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readRegularFile(filePath, reason) {
  try {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) failComposition(reason);
    return readFileSync(filePath);
  } catch (error) {
    if (error instanceof PackageDocsCarrierCompositionError) throw error;
    failComposition(reason);
  }
}

const CARRIER_KEYS = [
  "docsRoot", "manifestPath", "packageName", "packageRoot", "packageVersion"
].sort();
const PACKAGE_DOCS_GENERATION_KEYS = [
  "carrier_module_path",
  "carrier_module_sha256",
  "entrypoint",
  "entrypoint_sha256",
  "manifest_path",
  "manifest_sha256",
  "package_json_sha256",
  "package_name",
  "package_version"
].sort();
export const PACKAGE_DOCS_HOST_COMPOSITION_BINDING_SCHEMA_VERSION =
  "launcher-package-docs-host-composition-binding.v1";
const PACKAGE_DOCS_HOST_COMPOSITION_BINDING_MAX_BYTES = 4096;

function inspectCorePackageDocsComposition(entrypoint, carrier) {
  if (typeof entrypoint !== "string" || !path.isAbsolute(entrypoint)) {
    failComposition("entrypoint_missing");
  }
  const entrypointBytes = readRegularFile(entrypoint, "entrypoint_missing");
  if (carrier === null || typeof carrier !== "object" || Array.isArray(carrier) ||
      Object.keys(carrier).sort().join("\0") !== CARRIER_KEYS.join("\0")) {
    failComposition("carrier_missing");
  }
  const { packageName, packageVersion, packageRoot, docsRoot, manifestPath } = carrier;
  if (packageName !== "@agent-chassis/core" || typeof packageVersion !== "string" ||
      packageVersion.length === 0 || typeof packageRoot !== "string" ||
      !path.isAbsolute(packageRoot) || docsRoot !== path.join(packageRoot, "docs") ||
      manifestPath !== path.join(docsRoot, "public-docs-manifest.json") ||
      entrypoint !== path.join(packageRoot, "bin", "wiki-mcp")) {
    failComposition("carrier_missing");
  }
  const carrierModulePath = path.join(packageRoot, "lib", "package-docs-carrier.mjs");
  const carrierModuleBytes = readRegularFile(carrierModulePath, "carrier_missing");
  const packageJsonBytes = readRegularFile(
    path.join(packageRoot, "package.json"), "carrier_missing");
  const manifestBytes = readRegularFile(manifestPath, "manifest_invalid");
  let packageJson;
  try {
    packageJson = JSON.parse(packageJsonBytes.toString("utf8"));
  } catch {
    failComposition("package_metadata_invalid");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    failComposition("manifest_invalid");
  }
  if (manifest?.schema_version !== "public-docs-manifest.v1" ||
      !Number.isInteger(manifest?.entry_count) || !Array.isArray(manifest?.entries) ||
      manifest.entry_count !== manifest.entries.length) {
    failComposition("manifest_invalid");
  }
  if (packageJson?.name !== packageName || packageJson?.version !== packageVersion ||
      manifest?.package?.name !== packageName ||
      manifest?.package?.version !== packageVersion) {
    failComposition("package_version_mismatch");
  }
  return Object.freeze({
    carrier_module_path: carrierModulePath,
    carrier_module_sha256: sha256(carrierModuleBytes),
    entrypoint,
    entrypoint_sha256: sha256(entrypointBytes),
    manifest_path: manifestPath,
    manifest_sha256: sha256(manifestBytes),
    package_json_sha256: sha256(packageJsonBytes),
    package_name: packageName,
    package_version: packageVersion
  });
}

function samePackageDocsGeneration(left, right) {
  if (left === null && right === null) return true;
  return left !== null && right !== null &&
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((key) => left[key] === right[key]);
}

export function bindCorePackageDocsHostComposition({ entrypoint, packageDocsCarrier } = {}) {
  if (corePackageDocsComposition !== null) failComposition("duplicate_bind");
  const generation = inspectCorePackageDocsComposition(entrypoint, packageDocsCarrier);
  corePackageDocsComposition = Object.freeze({
    entrypoint,
    packageDocsCarrier,
    generation
  });
}

export function projectCorePackageDocsHostComposition() {
  if (corePackageDocsComposition === null) return null;
  return Object.freeze({ ...corePackageDocsComposition.generation });
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === keys.join("\0");
}

export function serializePackageDocsHostCompositionBinding(binding, packageDocsGeneration) {
  if (!isTrustedWikiMcpHostServerBinding(binding) ||
      binding.packageDocsGeneration === null ||
      !samePackageDocsGeneration(binding.packageDocsGeneration, packageDocsGeneration)) {
    failComposition("generation_stale");
  }
  const bytes = `${JSON.stringify({
    schema_version: PACKAGE_DOCS_HOST_COMPOSITION_BINDING_SCHEMA_VERSION,
    ...packageDocsGeneration
  })}\n`;
  if (Buffer.byteLength(bytes, "utf8") >
      PACKAGE_DOCS_HOST_COMPOSITION_BINDING_MAX_BYTES) {
    failComposition("probe_mismatch");
  }
  return bytes;
}

function readPackageDocsHostCompositionBinding(fd) {
  const chunks = [];
  let length = 0;
  while (length <= PACKAGE_DOCS_HOST_COMPOSITION_BINDING_MAX_BYTES) {
    const byte = Buffer.allocUnsafe(1);
    let read;
    try {
      read = readSync(fd, byte, 0, 1, null);
    } catch {
      failComposition("probe_mismatch");
    }
    if (read !== 1) failComposition("probe_mismatch");
    if (byte[0] === 0x0a) break;
    chunks.push(byte);
    length += 1;
  }
  if (length > PACKAGE_DOCS_HOST_COMPOSITION_BINDING_MAX_BYTES) {
    failComposition("probe_mismatch");
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    failComposition("probe_mismatch");
  }
  const expectedKeys = [
    "schema_version", ...PACKAGE_DOCS_GENERATION_KEYS
  ].sort();
  if (!exactKeys(parsed, expectedKeys) ||
      parsed.schema_version !== PACKAGE_DOCS_HOST_COMPOSITION_BINDING_SCHEMA_VERSION) {
    failComposition("probe_mismatch");
  }
  const { schema_version: _schemaVersion, ...generation } = parsed;
  return Object.freeze(generation);
}

export function bindSpawnedPackageDocsCarrierFromLauncher({
  packageDocsCarrier = null,
  launcherReadyFd = Number.parseInt(
    String(process.env.WIKI_MCP_LAUNCHER_READY_FD ?? ""), 10)
} = {}) {
  if (packageDocsCarrier === null || !Number.isInteger(launcherReadyFd) ||
      launcherReadyFd < 3) {
    return packageDocsCarrier;
  }
  const transportedGeneration = readPackageDocsHostCompositionBinding(launcherReadyFd);
  const currentGeneration = inspectCorePackageDocsComposition(
    path.join(packageDocsCarrier.packageRoot, "bin", "wiki-mcp"),
    packageDocsCarrier
  );
  if (!samePackageDocsGeneration(transportedGeneration, currentGeneration)) {
    failComposition("generation_stale");
  }
  return packageDocsCarrier;
}

export function __inspectCorePackageDocsCompositionForTest(input = {}) {
  return inspectCorePackageDocsComposition(input.entrypoint, input.packageDocsCarrier);
}

export function resolveWikiMcpHostServerPath() {
  if (corePackageDocsComposition !== null) {
    return corePackageDocsComposition.entrypoint;
  }
  try {
    return requireFromLauncher.resolve(WIKI_MCP_HOST_SERVER_PACKAGE_SUBPATH);
  } catch {
    return null;
  }
}

function mintHostServerBinding(entrypoint) {
  const binding = Object.freeze({
    entrypoint,
    producerDescriptor: LAUNCHER_READINESS_PRODUCER_DESCRIPTOR,
    packageDocsGeneration: corePackageDocsComposition?.generation ?? null
  });
  if (typeof entrypoint === "string" && entrypoint.length > 0 &&
      entrypoint === resolveWikiMcpHostServerPath() &&
      isAuthenticatedStdioMcpConduitProducerDescriptor(
        LAUNCHER_READINESS_PRODUCER_DESCRIPTOR)) {
    TRUSTED_HOST_SERVER_BINDINGS.add(binding);
  }
  return binding;
}

export function resolveWikiMcpHostServerBinding() {
  return mintHostServerBinding(resolveWikiMcpHostServerPath());
}

export function resolveWikiMcpReadinessObserverPath() {
  try {
    return requireFromLauncher.resolve(WIKI_MCP_READINESS_OBSERVER_PACKAGE_SUBPATH);
  } catch {
    return null;
  }
}

export function resolveWikiMcpCommonProofResolverConsumerPath() {
  try {
    return requireFromLauncher.resolve(WIKI_MCP_COMMON_PROOF_RESOLVER_CONSUMER_PACKAGE_SUBPATH);
  } catch {
    return null;
  }
}

export const WIKI_MCP_PRODUCER_GENERATION_PROBE_TIMEOUT_MS = 10_000;

const PRODUCER_GENERATION_TOKEN_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/u;
const PRODUCER_PROBE_MARKER = "WIKI_MCP_CAPABILITY_PROBE:";

export async function probeSpawnedWikiMcpProducerGeneration({
  execPath = process.execPath,
  observerPath = resolveWikiMcpReadinessObserverPath(),
  capabilityPath = resolveWikiMcpCommonProofResolverConsumerPath(),
  binding = resolveWikiMcpHostServerBinding(),
  timeoutMs = WIKI_MCP_PRODUCER_GENERATION_PROBE_TIMEOUT_MS
} = {}) {
  if (typeof observerPath !== "string" || observerPath.length === 0 ||
      typeof capabilityPath !== "string" || capabilityPath.length === 0) {
    return Object.freeze({ ok: false, generation: null, reason: "producer_module_unresolved" });
  }
  let currentPackageDocsGeneration = null;
  if (binding?.packageDocsGeneration !== null && binding?.packageDocsGeneration !== undefined) {
    try {
      currentPackageDocsGeneration = inspectCorePackageDocsComposition(
        binding.entrypoint, corePackageDocsComposition?.packageDocsCarrier);
    } catch (error) {
      if (error instanceof PackageDocsCarrierCompositionError) {
        return Object.freeze({ ok: false, generation: null, reason: error.detail.reason,
          package_docs_diagnostic: error.detail });
      }
      return Object.freeze({ ok: false, generation: null, reason: "producer_probe_failed" });
    }
    if (!samePackageDocsGeneration(
      currentPackageDocsGeneration, binding.packageDocsGeneration)) {
      return Object.freeze({ ok: false, generation: null, reason: "generation_stale",
        package_docs_diagnostic: compositionDiagnostic("generation_stale") });
    }
  }
  const packageDocsProbeSource = currentPackageDocsGeneration === null
    ? "const package_docs = null;\n"
    : `import { createCorePackageDocsCarrier } from ` +
      `${JSON.stringify(pathToFileURL(currentPackageDocsGeneration.carrier_module_path).href)};\n` +
      `import { readFile as readPackageDocsFile } from \"node:fs/promises\";\n` +
      `import { createHash as createPackageDocsHash } from \"node:crypto\";\n` +
      `const probedCarrier = await createCorePackageDocsCarrier();\n` +
      `const packageDocsHash = async (p) => createPackageDocsHash(\"sha256\").update(await readPackageDocsFile(p)).digest(\"hex\");\n` +
      `const package_docs = {carrier_module_path:${JSON.stringify(currentPackageDocsGeneration.carrier_module_path)},` +
      `carrier_module_sha256:await packageDocsHash(${JSON.stringify(currentPackageDocsGeneration.carrier_module_path)}),` +
      `entrypoint:${JSON.stringify(binding.entrypoint)},entrypoint_sha256:await packageDocsHash(${JSON.stringify(binding.entrypoint)}),` +
      `manifest_path:probedCarrier.manifestPath,manifest_sha256:await packageDocsHash(probedCarrier.manifestPath),` +
      `package_json_sha256:await packageDocsHash(${JSON.stringify(path.join(path.dirname(path.dirname(binding.entrypoint)), "package.json"))}),` +
      `package_name:probedCarrier.packageName,package_version:probedCarrier.packageVersion};\n`;
  const source =
    `import { LAUNCHER_READINESS_PROTOCOL_GENERATION } from ` +
    `${JSON.stringify(pathToFileURL(observerPath).href)};\n` +
    `import { LAUNCHER_COMMON_PROOF_RESOLVER_CAPABILITY_VERSION } from ` +
    `${JSON.stringify(pathToFileURL(capabilityPath).href)};\n` +
    packageDocsProbeSource +
    `process.stdout.write(${JSON.stringify(PRODUCER_PROBE_MARKER)} + JSON.stringify({generation: LAUNCHER_READINESS_PROTOCOL_GENERATION,` +
    ` capability_version: LAUNCHER_COMMON_PROOF_RESOLVER_CAPABILITY_VERSION,package_docs}));\n`;
  const probed = await new Promise((resolve) => {
    execFile(execPath, ["--input-type=module", "-e", source], {

      env: {},
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 64 * 1024,
      windowsHide: true
    }, (error, stdout) => resolve({ error, stdout }));
  });
  if (probed.error) {
    return Object.freeze({ ok: false, generation: null, reason: "producer_probe_failed" });
  }
  const stdout = String(probed.stdout ?? "");
  const markerIndex = stdout.lastIndexOf(PRODUCER_PROBE_MARKER);
  let payload;
  try {
    if (markerIndex < 0) throw new Error("probe marker absent");
    payload = JSON.parse(
      stdout.slice(markerIndex + PRODUCER_PROBE_MARKER.length).trim()
    );
  } catch {
    return Object.freeze({ ok: false, generation: null, reason: "producer_generation_malformed" });
  }
  const generation = payload?.generation;
  if (!PRODUCER_GENERATION_TOKEN_RE.test(generation)) {
    return Object.freeze({ ok: false, generation: null, reason: "producer_generation_malformed" });
  }
  if (payload.capability_version !== WIKI_MCP_COMMON_PROOF_RESOLVER_CAPABILITY_VERSION) {
    return Object.freeze({ ok: false, generation,
      reason: "common_proof_resolver_capability_version_mismatch" });
  }
  if (!samePackageDocsGeneration(payload.package_docs, currentPackageDocsGeneration)) {
    return Object.freeze({ ok: false, generation, reason: "probe_mismatch",
      package_docs_diagnostic: compositionDiagnostic("probe_mismatch") });
  }
  return Object.freeze({ ok: true, generation, reason: null,
    common_proof_resolver_capability_version: payload.capability_version,
    package_docs_generation: currentPackageDocsGeneration });
}

export function assertWikiMcpHostServerSpawnPin(binding, packageDocsGeneration) {
  if (!isTrustedWikiMcpHostServerBinding(binding)) failComposition("probe_mismatch");
  if (binding.packageDocsGeneration === null) {
    if (packageDocsGeneration !== null) failComposition("probe_mismatch");
    return binding;
  }
  let current;
  try {
    current = inspectCorePackageDocsComposition(
      binding.entrypoint, corePackageDocsComposition?.packageDocsCarrier);
  } catch (error) {
    if (error instanceof PackageDocsCarrierCompositionError) throw error;
    failComposition("probe_mismatch");
  }
  if (!samePackageDocsGeneration(current, packageDocsGeneration) ||
      !samePackageDocsGeneration(current, binding.packageDocsGeneration)) {
    failComposition("generation_stale");
  }
  return binding;
}

export function isTrustedWikiMcpHostServerBinding(binding) {
  return binding !== null && typeof binding === "object" &&
    Object.isFrozen(binding) && TRUSTED_HOST_SERVER_BINDINGS.has(binding) &&
    typeof binding.entrypoint === "string" && binding.entrypoint.length > 0 &&
    binding.entrypoint === resolveWikiMcpHostServerPath() &&
    binding.packageDocsGeneration === (corePackageDocsComposition?.generation ?? null) &&
    binding.producerDescriptor === LAUNCHER_READINESS_PRODUCER_DESCRIPTOR &&
    isAuthenticatedStdioMcpConduitProducerDescriptor(binding.producerDescriptor);
}
