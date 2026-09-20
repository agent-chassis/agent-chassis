import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readCommittedBlobBytes } from "./sidecar-committed-blobs.mjs";

const execFileAsync = promisify(execFile);
export const SIDECAR_GENERATOR_IDENTITY_PROTOCOL_VERSION =
  "sidecar-generator-identity.v1";
export const SIDECAR_GRAPH_GENERATOR_DEPENDENCIES = Object.freeze([
  "@bufbuild/protobuf", "@scip-code/scip", "@vscode/tree-sitter-wasm", "web-tree-sitter"
]);

export const SIDECAR_GRAPH_GENERATOR_COMMITTED_PATHS = Object.freeze([
  "package.json",
  "package-lock.json",
  "packages/wiki-core/src/lib/sidecar-status.mjs",
  "packages/wiki-core/src/lib/sidecar-graph-schema.mjs",
  "packages/wiki-core/src/lib/sidecar-graph-impact-artifact.mjs",
  "packages/wiki-core/src/lib/sidecar-build.mjs",
  "packages/wiki-core/src/lib/sidecar-graph-extractors.mjs",
  "packages/wiki-core/src/lib/sidecar-graph-import-facts.mjs",
  "packages/wiki-core/src/lib/sidecar-graph-import-resolution.mjs",
  "packages/wiki-core/src/lib/sidecar-graph-contributions.mjs",
  "packages/wiki-core/src/lib/sidecar-committed-diff.mjs",
  "packages/wiki-core/src/lib/sidecar-incremental.mjs",
  "packages/wiki-core/src/lib/sidecar-store.mjs",
  "packages/wiki-core/src/lib/sidecar-store-schema.mjs",
  "packages/wiki-core/src/lib/sidecar-store-queries.mjs",
  "packages/wiki-core/src/lib/sidecar-store-publication.mjs",
  "packages/wiki-core/src/lib/sidecar-store-codec.mjs",
  "packages/wiki-core/src/lib/sidecar-store-lifecycle.mjs",
  "packages/wiki-core/src/lib/sidecar-repository-identity.mjs",
  "packages/wiki-core/src/lib/sidecar-paths.mjs",
  "packages/wiki-core/src/lib/sidecar-schema.mjs",
  "packages/wiki-core/src/lib/sidecar-scip-overlay.mjs",
  "packages/wiki-core/src/lib/sidecar-scip-normalize.mjs",
  "packages/wiki-core/src/lib/sidecar-scip-provision.mjs",
  "packages/wiki-core/src/lib/sidecar-committed-preparation.mjs",
  "packages/wiki-core/src/lib/sidecar-ensure.mjs",
  "packages/wiki-core/src/lib/sidecar-graph-impact.mjs",
  "packages/wiki-core/src/lib/sidecar-joins.mjs",
  "packages/wiki-core/src/lib/sidecar-graph-impact-shared.mjs",
  "packages/wiki-core/src/lib/sidecar-graph-impact-overlay.mjs",
  "packages/wiki-core/src/lib/sidecar-graph-impact-graph.mjs",
  "packages/wiki-core/src/lib/sidecar-graph-impact-summary.mjs",
  "packages/wiki-core/src/lib/sidecar-impact.mjs",
  "packages/wiki-core/src/lib/sidecar-symbol-query.mjs",
  "packages/wiki-core/src/lib/sidecar-graph-impact-diff.mjs",
  "packages/wiki-core/src/lib/sidecar-graph-impact-hints.mjs",
  "packages/wiki-core/src/lib/sidecar-graph-impact-surfaces-actions.mjs",
  "packages/wiki-core/src/lib/wiki.mjs",
  "packages/wiki-core/src/lib/sidecar-committed-blobs.mjs"
]);
export class SidecarGeneratorIdentityRefusalError extends Error {
  constructor(message, { code, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "SidecarGeneratorIdentityRefusalError";
    this.code = code;
  }
}
async function runPinnedGit(repoRoot, args, options = {}) {
  return execFileAsync("git", ["--no-replace-objects", "-C", repoRoot, ...args], {
    encoding: "buffer",
    maxBuffer: 4 * 1024 * 1024,
    ...options
  });
}
async function captureHead(repoRoot) {
  try {
    const { stdout } = await runPinnedGit(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"]);
    const head = stdout.toString("utf8").trim();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(head)) {
      throw new Error("git returned no single concrete commit object");
    }
    return head.toLowerCase();
  } catch (cause) {
    throw new SidecarGeneratorIdentityRefusalError(
      "graph-generator identity requires one stable committed HEAD",
      { code: "generator_identity_head_unstable", cause }
    );
  }
}
function committedDependencyVersions(lockBytes) {
  let lock;
  try {
    lock = JSON.parse(lockBytes.toString("utf8"));
  } catch (cause) {
    throw new SidecarGeneratorIdentityRefusalError(
      "committed package-lock.json is not valid JSON",
      { code: "generator_identity_package_lock_invalid", cause }
    );
  }
  if (!lock.packages || typeof lock.packages !== "object" || Array.isArray(lock.packages)) {
    throw new SidecarGeneratorIdentityRefusalError(
      "committed package-lock.json has no packages version map",
      { code: "generator_identity_package_lock_invalid" }
    );
  }
  return SIDECAR_GRAPH_GENERATOR_DEPENDENCIES.map((name) => {
    const version = lock.packages[`node_modules/${name}`]?.version;
    if (typeof version !== "string" || version.length === 0) {
      throw new SidecarGeneratorIdentityRefusalError(
        `committed package-lock.json has no resolved version for ${name}`,
        { code: "generator_identity_package_lock_invalid" }
      );
    }
    return Object.freeze({ name, version });
  });
}
function refusal(message, cause = null) {
  return new SidecarGeneratorIdentityRefusalError(message, {
    code: "generator_identity_package_lock_invalid", cause
  });
}
function unreadable(message, cause = null) {
  return new SidecarGeneratorIdentityRefusalError(message, {
    code: "generator_identity_input_unreadable", cause
  });
}
function validIntegrity(value) {
  return typeof value === "string" && value.trim().length > 0 &&
    value.trim().split(/\s+/).every((token) =>
      /^(?:sha256-[A-Za-z0-9+/]{43}=|sha384-[A-Za-z0-9+/]{64}|sha512-[A-Za-z0-9+/]{86}==)$/.test(token));
}
function usableIdentity(record) {
  return Boolean(record) && typeof record === "object" &&
    typeof record.version === "string" && record.version.length > 0 &&
    validIntegrity(record.integrity);
}
function packageRecords(lockBytes) {
  let lock;
  try {
    lock = JSON.parse(lockBytes.toString("utf8"));
  } catch (cause) {
    throw refusal("committed package-lock.json is not valid JSON", cause);
  }
  if (!lock.packages || typeof lock.packages !== "object" || Array.isArray(lock.packages)) {
    throw refusal("committed package-lock.json has no packages version map");
  }
  return lock.packages;
}

function hoistedLookupKeys(placement, name) {
  const keys = [`${placement}/node_modules/${name}`];
  let directory = placement;
  while (directory !== "") {
    directory = directory.includes("/") ? directory.slice(0, directory.lastIndexOf("/")) : "";
    const base = directory.slice(directory.lastIndexOf("/") + 1);
    if (base === "node_modules" || base.startsWith("@")) continue;
    keys.push(directory === "" ? `node_modules/${name}` : `${directory}/node_modules/${name}`);
  }
  return keys;
}
function packagedDependencyIdentity(packages, placement, name) {
  const key = hoistedLookupKeys(placement, name)
    .find((candidate) => Object.hasOwn(packages, candidate));
  const record = key === undefined ? undefined : packages[key];
  if (!usableIdentity(record)) {
    throw refusal(`committed package-lock.json has no usable identity for ${name}`);
  }
  return Object.freeze({ name, version: record.version, integrity: record.integrity });
}
function packagedIdentity(lockBytes) {
  const packages = packageRecords(lockBytes);
  const placements = Object.keys(packages)
    .filter((key) => /(?:^|\/)node_modules\/@agent-chassis\/wiki-core$/.test(key))
    .sort();
  if (placements.length === 0) {
    throw refusal("committed package-lock.json has no @agent-chassis/wiki-core package record");
  }
  const wikiIdentities = placements.map((placement) => {
    const record = packages[placement];
    if (!usableIdentity(record)) {
      throw refusal("committed package-lock.json has no usable wiki-core identity");
    }
    return { version: record.version, integrity: record.integrity };
  });
  const distinctWiki = new Set(wikiIdentities.map((identity) => JSON.stringify(identity)));
  if (distinctWiki.size !== 1) {
    throw refusal("committed package-lock.json has conflicting wiki-core identities");
  }
  const dependencySets = placements.map((placement) =>
    SIDECAR_GRAPH_GENERATOR_DEPENDENCIES
      .map((name) => packagedDependencyIdentity(packages, placement, name))
      .sort((left, right) => left.name.localeCompare(right.name))
  );
  const dependencyShape = JSON.stringify(dependencySets[0]);
  if (dependencySets.some((dependencies) => JSON.stringify(dependencies) !== dependencyShape)) {
    throw refusal("committed package-lock.json has conflicting direct dependency identities");
  }
  return Object.freeze({
    wiki_core: Object.freeze(wikiIdentities[0]),
    dependencies: Object.freeze(dependencySets[0])
  });
}

async function resolveCommittedDescriptors(repoRoot, head, relativePaths) {
  let stdout;
  try {
    ({ stdout } = await runPinnedGit(repoRoot, ["--literal-pathspecs", "ls-tree", "-z",
      "--full-tree", head, "--", ...relativePaths]));
  } catch (cause) {
    throw unreadable("graph-generator inputs are not listable at captured HEAD", cause);
  }
  const declared = new Set(relativePaths);
  const descriptors = new Map();
  for (const entry of stdout.toString("utf8").split("\0")) {
    if (entry.length === 0) continue;
    const match = entry.match(/^([0-7]{6}) ([a-z]+) ([0-9a-fA-F]{40}|[0-9a-fA-F]{64})\t([\s\S]+)$/);
    if (!match || !declared.has(match[4]) || descriptors.has(match[4])) {
      throw unreadable("graph-generator input listing is malformed at captured HEAD");
    }
    descriptors.set(match[4], Object.freeze({
      mode: match[1], type: match[2], object_id: match[3].toLowerCase()
    }));
  }
  return descriptors;
}
async function readDescriptorBytes(repoRoot, descriptors, relativePaths) {
  const selected = relativePaths.map((relativePath) => {
    const descriptor = descriptors.get(relativePath);
    if (!descriptor || descriptor.type !== "blob") {
      throw unreadable(`graph-generator input is not readable at captured HEAD: ${relativePath}`);
    }
    return { relativePath, objectId: descriptor.object_id };
  });
  let objects;
  try {
    objects = await readCommittedBlobBytes({
      repoRoot,
      objectIds: selected.map(({ objectId }) => objectId)
    });
  } catch (cause) {
    throw unreadable("graph-generator committed inputs are not readable", cause);
  }
  return selected.map(({ relativePath, objectId }) => {
    const result = objects.get(objectId);
    if (result?.state !== "available") {
      throw unreadable(`graph-generator input is not readable at captured HEAD: ${relativePath}`);
    }
    return result.bytes;
  });
}
async function packagedGeneratorIdentity(repoRoot, committedHead, descriptors) {
  const [lockBytes] = await readDescriptorBytes(repoRoot, descriptors, ["package-lock.json"]);
  const packaged = packagedIdentity(lockBytes);
  const identityInput = {
    protocol_version: SIDECAR_GENERATOR_IDENTITY_PROTOCOL_VERSION,
    packaged_mode: packaged
  };
  const generatorIdentity = `sha256:${createHash("sha256")
    .update(JSON.stringify(identityInput))
    .digest("hex")}`;
  return Object.freeze({
    committed_head: committedHead,
    generator_identity: generatorIdentity,
    ...identityInput,
    packaged_dependency_versions: packaged.dependencies
  });
}
export async function computeSidecarGeneratorIdentity({ repoRoot }) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    throw new TypeError("computeSidecarGeneratorIdentity requires repoRoot");
  }

  const committedHead = await captureHead(repoRoot);
  const producerPaths = SIDECAR_GRAPH_GENERATOR_COMMITTED_PATHS.slice(2);
  const descriptors = await resolveCommittedDescriptors(
    repoRoot,
    committedHead,
    SIDECAR_GRAPH_GENERATOR_COMMITTED_PATHS
  );
  const presentProducerCount = producerPaths.filter((path) => descriptors.has(path)).length;
  if (presentProducerCount === 0) {
    return packagedGeneratorIdentity(repoRoot, committedHead, descriptors);
  }
  if (presentProducerCount !== producerPaths.length) {
    throw unreadable("graph-generator monorepo inputs are only partially present at captured HEAD");
  }
  const blobs = await readDescriptorBytes(
    repoRoot,
    descriptors,
    SIDECAR_GRAPH_GENERATOR_COMMITTED_PATHS
  );
  const committedFiles = SIDECAR_GRAPH_GENERATOR_COMMITTED_PATHS.map((relativePath, index) => ({
    path: relativePath,
    sha256: createHash("sha256").update(blobs[index]).digest("hex")
  }));
  const lockIndex = SIDECAR_GRAPH_GENERATOR_COMMITTED_PATHS.indexOf("package-lock.json");
  const dependencyVersions = committedDependencyVersions(blobs[lockIndex]);
  const identityInput = {
    protocol_version: SIDECAR_GENERATOR_IDENTITY_PROTOCOL_VERSION,
    committed_files: committedFiles,
    committed_dependency_versions: dependencyVersions
  };
  const generatorIdentity = `sha256:${createHash("sha256")
    .update(JSON.stringify(identityInput))
    .digest("hex")}`;

  return Object.freeze({
    committed_head: committedHead,
    generator_identity: generatorIdentity,
    ...identityInput
  });
}
