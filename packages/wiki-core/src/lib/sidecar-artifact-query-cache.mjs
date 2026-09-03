import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { parseSidecarArtifactBytes } from "./sidecar-artifact-bytes.mjs";
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
  createGraphIndexes,
  sanitizeGraphForbiddenPaths
} from "./sidecar-graph-impact-graph.mjs";
import { computeSidecarGeneratorIdentity } from "./sidecar-generator-identity.mjs";

const execFileAsync = promisify(execFile);
const MAX_RESOURCE_ENTRIES = 8;
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ARTIFACT_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const GENERATOR_IDENTITY_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const ARTIFACT_IDENTITY_FIELDS = Object.freeze([
  "sha256",
  "byte_length",
  "index_head",
  "artifact_schema_version",
  "graph_schema_version",
  "generator_identity",
  "graph_compatible"
]);

const ARTIFACT_IDENTITY_PROVENANCE = new WeakMap();
const ARTIFACT_PROVENANCE = new WeakMap();
const DERIVED_STATE = new WeakMap();
const settledEntries = new Map();
const inFlightEntries = new Map();
const capacityWaiters = [];
let accessClock = 0;
let statistics = freshStatistics();
let testLoadGate = null;

function freshStatistics() {
  return {
    artifact_reads: 0,
    artifact_parses: 0,
    artifact_hash_proofs: 0,
    cache_hits: 0,
    cache_misses: 0,
    in_flight_coalesces: 0,
    evictions: 0,
    capacity_waits: 0,
    capacity_repository_re_resolutions: 0,
    capacity_head_re_resolutions: 0,
    cache_key_restarts: 0,
    last_cache_miss_repository_identity: null,
    last_cache_miss_committed_head: null,
    rejected_loads: 0,
    artifact_sanitizations: 0,
    graph_index_builds: 0,
    max_resource_entries: 0
  };
}

function resourceEntryCount() {
  return settledEntries.size + inFlightEntries.size;
}

function observeResourceEntries() {
  statistics.max_resource_entries = Math.max(
    statistics.max_resource_entries,
    resourceEntryCount()
  );
}

function wakeCapacityWaiters() {
  while (capacityWaiters.length > 0) {
    capacityWaiters.shift()();
  }
}

function waitForCapacity() {
  statistics.capacity_waits += 1;
  return new Promise((resolve) => capacityWaiters.push(resolve));
}

function oldestSettledKey() {
  let selected = null;
  for (const [key, entry] of settledEntries) {
    if (
      !selected ||
      entry.lastAccess < selected.lastAccess ||
      (entry.lastAccess === selected.lastAccess && key.localeCompare(selected.key) < 0)
    ) {
      selected = { key, lastAccess: entry.lastAccess };
    }
  }
  return selected?.key ?? null;
}

function evictSettled(key) {
  if (settledEntries.delete(key)) {
    statistics.evictions += 1;
    wakeCapacityWaiters();
  }
}

async function reserveCapacity() {
  let waited = false;
  while (resourceEntryCount() >= MAX_RESOURCE_ENTRIES) {
    const evictionKey = oldestSettledKey();
    if (evictionKey !== null) {
      evictSettled(evictionKey);
      continue;
    }
    await waitForCapacity();
    waited = true;
  }
  return waited;
}

function waitForTestLoadRelease() {
  const gate = testLoadGate;
  if (!gate || gate.held >= gate.target) return null;
  gate.held += 1;
  const release = new Promise((resolve) => gate.releases.push(resolve));
  if (gate.held === gate.target) gate.resolveReached();
  return release;
}

function runGit(dir, args) {
  return execFileAsync("git", ["--no-replace-objects", "-C", dir, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
}

function oneLine(value, label) {
  const lines = String(value).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1 || lines[0].includes("\0")) {
    throw new Error(`${label} did not resolve to exactly one value`);
  }
  return lines[0];
}

export async function resolveSidecarRepositoryIdentity({ dir = "." } = {}) {
  const requested = path.resolve(String(dir || "."));
  const first = oneLine(
    (await runGit(requested, ["rev-parse", "--show-toplevel"])).stdout,
    "sidecar repository"
  );
  if (!path.isAbsolute(first)) {
    throw new Error("sidecar repository top level is not absolute");
  }
  const canonical = await realpath(first);
  const second = oneLine(
    (await runGit(canonical, ["rev-parse", "--show-toplevel"])).stdout,
    "canonical sidecar repository"
  );
  if ((await realpath(second)) !== canonical) {
    throw new Error("sidecar repository identity is ambiguous");
  }
  return canonical;
}

async function resolveCommittedHead(repositoryIdentity) {
  const head = oneLine(
    (await runGit(repositoryIdentity, ["rev-parse", "--verify", "HEAD^{commit}"])).stdout,
    "sidecar committed HEAD"
  ).toLowerCase();
  if (!COMMIT_PATTERN.test(head)) {
    throw new Error("sidecar committed HEAD is not a concrete commit");
  }
  return head;
}

function deepPlainFreeze(value, seen = new Set()) {
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
    if (!("value" in descriptor) || !deepPlainFreeze(descriptor.value, seen)) return false;
  }
  if (array && Object.keys(descriptors).length !== value.length + 1) return false;
  Object.freeze(value);
  return true;
}

function artifactIdentityFromClassification(rawBytes, artifact, graphClassification) {
  return {
    sha256: createHash("sha256").update(rawBytes).digest("hex"),
    byte_length: rawBytes.length,
    index_head: artifact?.index_head ?? null,
    artifact_schema_version:
      artifact?.cache_metadata?.[SIDECAR_ARTIFACT_SCHEMA_FIELD] ?? null,
    graph_schema_version: graphClassification.graph_state.graph_schema_version ?? null,
    generator_identity:
      artifact?.[SIDECAR_GRAPH_SECTION_FIELD]?.[SIDECAR_GRAPH_GENERATOR_IDENTITY_FIELD] ?? null,
    graph_compatible:
      graphClassification.compatible && graphClassification.graph_state.graph_available === true
  };
}

export function createArtifactIdentity(rawBytes, artifact) {
  return artifactIdentityFromClassification(
    rawBytes,
    artifact,
    classifySidecarGraphArtifactSchema(artifact)
  );
}

function identityIsComplete(identity) {
  return Boolean(
    identity &&
      typeof identity === "object" &&
      !Array.isArray(identity) &&
      typeof identity.sha256 === "string" &&
      ARTIFACT_DIGEST_PATTERN.test(identity.sha256) &&
      Number.isSafeInteger(identity.byte_length) &&
      identity.byte_length > 0 &&
      typeof identity.index_head === "string" &&
      COMMIT_PATTERN.test(identity.index_head) &&
      identity.artifact_schema_version === SIDECAR_ARTIFACT_SCHEMA_VERSION &&
      identity.graph_schema_version === SIDECAR_GRAPH_SCHEMA_VERSION &&
      typeof identity.generator_identity === "string" &&
      GENERATOR_IDENTITY_PATTERN.test(identity.generator_identity) &&
      identity.graph_compatible === true
  );
}

export function artifactIdentityMatches(left, right) {
  const leftProvenance = ARTIFACT_IDENTITY_PROVENANCE.get(left);
  const rightProvenance = ARTIFACT_IDENTITY_PROVENANCE.get(right);
  return Boolean(
    identityIsComplete(left) &&
      identityIsComplete(right) &&
      leftProvenance &&
      rightProvenance &&
      ARTIFACT_IDENTITY_FIELDS.every(
        (field, index) =>
          left[field] === leftProvenance[index] &&
          right[field] === rightProvenance[index] &&
          left[field] === right[field]
      )
  );
}

function artifactIsCompatible(artifact) {
  return Boolean(
    artifact &&
      typeof artifact === "object" &&
      !Array.isArray(artifact) &&
      artifact.cache_metadata?.[SIDECAR_ARTIFACT_SCHEMA_FIELD] ===
        SIDECAR_ARTIFACT_SCHEMA_VERSION &&
      artifact.sources &&
      typeof artifact.sources === "object" &&
      !Array.isArray(artifact.sources)
  );
}

function immutableMap(source) {
  const target = new Map(source);
  return Object.freeze({
    get size() {
      return target.size;
    },
    get: (key) => target.get(key),
    has: (key) => target.has(key),
    entries: () => target.entries(),
    keys: () => target.keys(),
    values: () => target.values(),
    [Symbol.iterator]: () => target[Symbol.iterator]()
  });
}

function immutableIndexes(indexes) {
  for (const ids of indexes.nodeIdsByPath.values()) Object.freeze(ids);
  return Object.freeze({
    nodes: indexes.nodes,
    edges: indexes.edges,
    nodesById: immutableMap(indexes.nodesById),
    edgesById: immutableMap(indexes.edgesById),
    nodeIdsByPath: immutableMap(indexes.nodeIdsByPath)
  });
}

function authenticateSnapshot({ artifact, identity, expectedGeneratorIdentity }) {
  Object.freeze(identity);
  ARTIFACT_IDENTITY_PROVENANCE.set(
    identity,
    Object.freeze(ARTIFACT_IDENTITY_FIELDS.map((field) => identity[field]))
  );
  ARTIFACT_PROVENANCE.set(
    artifact,
    Object.freeze({ expectedGeneratorIdentity, identity })
  );
  statistics.artifact_sanitizations += 1;
  const sanitized = sanitizeGraphForbiddenPaths(artifact.graph);
  deepPlainFreeze(sanitized.graph);
  deepPlainFreeze(sanitized.evidence);
  statistics.graph_index_builds += 1;
  const derived = Object.freeze({
    sanitized_graph: sanitized.graph,
    sanitization_evidence: sanitized.evidence,
    graph_indexes: immutableIndexes(createGraphIndexes(sanitized.graph))
  });
  DERIVED_STATE.set(artifact, derived);
  return Object.freeze({ artifact, identity });
}

export function classifyVerifiedSidecarArtifact(artifact) {
  const provenance = ARTIFACT_PROVENANCE.get(artifact);
  return classifySidecarGraphArtifactSchema(
    artifact,
    provenance?.identity && ARTIFACT_IDENTITY_PROVENANCE.has(provenance.identity)
      ? { expectedGeneratorIdentity: provenance.expectedGeneratorIdentity }
      : {}
  );
}

export function getVerifiedSidecarArtifactDerivedState(artifact) {
  return DERIVED_STATE.get(artifact) ?? null;
}

function exactIdentityKey(repositoryIdentity, committedHead, identity) {
  return JSON.stringify([
    repositoryIdentity,
    committedHead,
    ...ARTIFACT_IDENTITY_FIELDS.map((field) => identity[field])
  ]);
}

function lookupKey(repositoryIdentity, committedHead, artifactRelativePath) {
  return JSON.stringify([repositoryIdentity, committedHead, artifactRelativePath]);
}

function artifactPathFor(repositoryIdentity, artifactRelativePath) {
  const absolute = path.resolve(repositoryIdentity, artifactRelativePath);
  const relative = path.relative(repositoryIdentity, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("sidecar artifact path must be a repository-relative file path");
  }
  return absolute;
}

async function readBytes(artifactPath) {
  statistics.artifact_reads += 1;
  return readFile(artifactPath);
}

async function loadSnapshot({ repositoryIdentity, committedHead, artifactRelativePath }) {
  const artifactPath = artifactPathFor(repositoryIdentity, artifactRelativePath);
  let rawBytes;
  try {
    rawBytes = await readBytes(artifactPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return Object.freeze({ exists: false, artifact: null, identity: null, read_error: null });
    }
    return Object.freeze({
      exists: true,
      artifact: null,
      identity: null,
      read_error: error instanceof Error ? error.message : String(error)
    });
  }

  let artifact;
  try {
    statistics.artifact_parses += 1;
    artifact = parseSidecarArtifactBytes(rawBytes);
  } catch (error) {
    return Object.freeze({
      exists: true,
      artifact: null,
      identity: null,
      read_error: error instanceof Error ? error.message : String(error)
    });
  }
  if (!deepPlainFreeze(artifact)) {
    return Object.freeze({
      exists: true,
      artifact: null,
      identity: null,
      read_error: "sidecar artifact is not a plain immutable data tree"
    });
  }

  let expected = null;
  try {
    expected = await computeSidecarGeneratorIdentity({ repoRoot: repositoryIdentity });
    if (expected.committed_head !== committedHead) expected = null;
  } catch {
    expected = null;
  }
  const graphClassification = classifySidecarGraphArtifactSchema(
    artifact,
    expected ? { expectedGeneratorIdentity: expected.generator_identity } : {}
  );
  const identity = artifactIdentityFromClassification(rawBytes, artifact, graphClassification);
  const valid = Boolean(
    expected &&
      artifactIsCompatible(artifact) &&
      identity.index_head === committedHead &&
      identity.generator_identity === expected.generator_identity &&
      identityIsComplete(identity)
  );
  if (!valid) {
    return Object.freeze({
      exists: true,
      artifact,
      identity: Object.freeze(identity),
      expected_generator_identity: expected?.generator_identity ?? null,
      read_error: null,
      verified: false
    });
  }

  let stabilityBytes;
  try {
    stabilityBytes = await readBytes(artifactPath);
    statistics.artifact_hash_proofs += 1;
  } catch (error) {
    return Object.freeze({
      exists: true,
      artifact: null,
      identity: null,
      read_error: error instanceof Error ? error.message : String(error)
    });
  }
  const stabilityDigest = createHash("sha256").update(stabilityBytes).digest("hex");
  const [afterRepository, afterHead] = await Promise.all([
    resolveSidecarRepositoryIdentity({ dir: repositoryIdentity }),
    resolveCommittedHead(repositoryIdentity)
  ]);
  if (
    afterRepository !== repositoryIdentity ||
    afterHead !== committedHead ||
    stabilityBytes.length !== identity.byte_length ||
    stabilityDigest !== identity.sha256
  ) {
    return Object.freeze({
      exists: true,
      artifact: null,
      identity: null,
      read_error: "sidecar artifact or repository identity changed during verification"
    });
  }

  const snapshot = authenticateSnapshot({
    artifact,
    identity,
    expectedGeneratorIdentity: expected.generator_identity
  });
  return Object.freeze({
    exists: true,
    artifact: snapshot.artifact,
    identity: snapshot.identity,
    expected_generator_identity: expected.generator_identity,
    read_error: null,
    verified: true,
    exact_identity_key: exactIdentityKey(repositoryIdentity, committedHead, snapshot.identity)
  });
}

async function verifyWarmEntry(entry) {
  try {
    const rawBytes = await readBytes(entry.artifactPath);
    statistics.artifact_hash_proofs += 1;
    const digest = createHash("sha256").update(rawBytes).digest("hex");
    const [repositoryIdentity, committedHead] = await Promise.all([
      resolveSidecarRepositoryIdentity({ dir: entry.repositoryIdentity }),
      resolveCommittedHead(entry.repositoryIdentity)
    ]);
    return (
      repositoryIdentity === entry.repositoryIdentity &&
      committedHead === entry.committedHead &&
      rawBytes.length === entry.result.identity.byte_length &&
      digest === entry.result.identity.sha256 &&
      entry.exactIdentityKey ===
        exactIdentityKey(repositoryIdentity, committedHead, entry.result.identity)
    );
  } catch {
    return false;
  }
}

async function readWithoutAdmission({ dir, artifactRelativePath }) {
  const artifactPath = path.resolve(String(dir || "."), artifactRelativePath);
  try {
    const rawBytes = await readBytes(artifactPath);
    statistics.artifact_parses += 1;
    const artifact = parseSidecarArtifactBytes(rawBytes);
    if (!deepPlainFreeze(artifact)) throw new Error("artifact is not plain data");
    return Object.freeze({
      repository_identity: null,
      committed_head: null,
      cache_state: "bypass",
      exists: true,
      artifact,
      identity: Object.freeze(createArtifactIdentity(rawBytes, artifact)),
      expected_generator_identity: null,
      read_error: null,
      verified: false
    });
  } catch (error) {
    return Object.freeze({
      repository_identity: null,
      committed_head: null,
      cache_state: "bypass",
      exists: error?.code !== "ENOENT",
      artifact: null,
      identity: null,
      expected_generator_identity: null,
      read_error: error?.code === "ENOENT" ? null : error instanceof Error ? error.message : String(error),
      verified: false
    });
  }
}

export async function readVerifiedSidecarArtifactSnapshot({
  dir = ".",
  artifactRelativePath
} = {}) {
  if (typeof artifactRelativePath !== "string" || artifactRelativePath.length === 0) {
    throw new TypeError("artifactRelativePath is required");
  }

  cacheSelection: while (true) {
    let repositoryIdentity;
    let committedHead;
    try {
      repositoryIdentity = await resolveSidecarRepositoryIdentity({ dir });
      committedHead = await resolveCommittedHead(repositoryIdentity);
    } catch {
      return readWithoutAdmission({ dir, artifactRelativePath });
    }
    const key = lookupKey(repositoryIdentity, committedHead, artifactRelativePath);

    while (true) {
      const settled = settledEntries.get(key);
      if (settled) {
        if (await verifyWarmEntry(settled)) {
          settled.lastAccess = ++accessClock;
          statistics.cache_hits += 1;
          return Object.freeze({
            repository_identity: repositoryIdentity,
            committed_head: committedHead,
            cache_state: "hit",
            ...settled.result
          });
        }
        evictSettled(key);
        continue;
      }

      const inFlight = inFlightEntries.get(key);
      if (inFlight) {
        statistics.in_flight_coalesces += 1;
        return inFlight.promise;
      }

      const waitedForCapacity = await reserveCapacity();
      if (waitedForCapacity) {
        let currentRepositoryIdentity;
        let currentCommittedHead;
        try {
          currentRepositoryIdentity = await resolveSidecarRepositoryIdentity({ dir });
          statistics.capacity_repository_re_resolutions += 1;
          currentCommittedHead = await resolveCommittedHead(currentRepositoryIdentity);
          statistics.capacity_head_re_resolutions += 1;
        } catch {
          return readWithoutAdmission({ dir, artifactRelativePath });
        }
        if (
          currentRepositoryIdentity !== repositoryIdentity ||
          currentCommittedHead !== committedHead
        ) {
          statistics.cache_key_restarts += 1;
          continue cacheSelection;
        }

        continue;
      }
      if (settledEntries.has(key) || inFlightEntries.has(key)) continue;

      statistics.cache_misses += 1;
      statistics.last_cache_miss_repository_identity = repositoryIdentity;
      statistics.last_cache_miss_committed_head = committedHead;
      let resolveLoad;
      const promise = new Promise((resolve) => {
        resolveLoad = resolve;
      });
      inFlightEntries.set(key, { promise });
      observeResourceEntries();

      let loaded;
      try {
        const testLoadRelease = waitForTestLoadRelease();
        if (testLoadRelease) await testLoadRelease;
        loaded = await loadSnapshot({
          repositoryIdentity,
          committedHead,
          artifactRelativePath
        });
        const result = Object.freeze({
          repository_identity: repositoryIdentity,
          committed_head: committedHead,
          cache_state: loaded.verified ? "miss" : "bypass",
          ...loaded
        });
        inFlightEntries.delete(key);
        if (loaded.verified) {
          settledEntries.set(key, {
            repositoryIdentity,
            committedHead,
            artifactPath: artifactPathFor(repositoryIdentity, artifactRelativePath),
            exactIdentityKey: loaded.exact_identity_key,
            result: loaded,
            lastAccess: ++accessClock
          });
        } else {
          statistics.rejected_loads += 1;
        }
        resolveLoad(result);
        wakeCapacityWaiters();
        return result;
      } catch (error) {
        inFlightEntries.delete(key);
        statistics.rejected_loads += 1;
        const result = Object.freeze({
          repository_identity: repositoryIdentity,
          committed_head: committedHead,
          cache_state: "bypass",
          exists: true,
          artifact: null,
          identity: null,
          expected_generator_identity: null,
          read_error: error instanceof Error ? error.message : String(error),
          verified: false
        });
        resolveLoad(result);
        wakeCapacityWaiters();
        return result;
      }
    }
  }
}

export function __holdSidecarArtifactQueryCacheLoadsForTests(count) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_RESOURCE_ENTRIES) {
    throw new TypeError(`test load gate count must be between 1 and ${MAX_RESOURCE_ENTRIES}`);
  }
  if (testLoadGate) throw new Error("sidecar artifact query cache test load gate is already active");
  if (resourceEntryCount() > 0) {
    throw new Error("sidecar artifact query cache test load gate requires an empty cache");
  }

  let resolveReached;
  const reached = new Promise((resolve) => {
    resolveReached = resolve;
  });
  const gate = {
    target: count,
    held: 0,
    releases: [],
    resolveReached
  };
  testLoadGate = gate;

  return Object.freeze({
    reached,
    releaseOne() {
      const release = gate.releases.shift();
      if (!release) return false;
      release();
      if (gate.releases.length === 0 && gate.held === gate.target && testLoadGate === gate) {
        testLoadGate = null;
      }
      return true;
    },
    releaseAll() {
      while (gate.releases.length > 0) gate.releases.shift()();
      if (testLoadGate === gate) testLoadGate = null;
    }
  });
}

export function __observeSidecarArtifactQueryCacheForTests() {
  return Object.freeze({
    ...statistics,
    settled_entries: settledEntries.size,
    in_flight_entries: inFlightEntries.size,
    resource_entries: resourceEntryCount(),
    capacity: MAX_RESOURCE_ENTRIES
  });
}

export function __resetSidecarArtifactQueryCacheForTests() {
  if (inFlightEntries.size > 0) {
    throw new Error("cannot reset sidecar artifact query cache while loads are in flight");
  }
  settledEntries.clear();
  testLoadGate = null;
  accessClock = 0;
  statistics = freshStatistics();
  wakeCapacityWaiters();
}
