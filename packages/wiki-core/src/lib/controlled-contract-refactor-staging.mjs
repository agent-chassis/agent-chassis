import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink
} from "node:fs/promises";
import path from "node:path";

import {
  ControlledContractToolError,
  deepFreezePlainData,
  isPlainObject,
  resolveControlledContractRepository
} from "./controlled-contract-tool-shared.mjs";

const STAGING_SCHEMA = "controlled-contract-refactor-staging.v1";
const STATE_SCHEMA = "controlled-contract-refactor-staging-state.v1";
const RUNTIME_DIRECTORY = ".agent-runs";
const STORE_DIRECTORY = "controlled-contract-refactor-staging";
const STORE_VERSION_DIRECTORY = "v1";
const RESOURCE_SUFFIX = ".json";
const STATE_SUFFIX = ".state.json";
export const CONTROLLED_CONTRACT_REFACTOR_STAGING_TTL_MS = 24 * 60 * 60 * 1000;
export const CONTROLLED_CONTRACT_REFACTOR_STAGING_MAX_BYTES = 64 * 1024 * 1024;

const RESOURCE_KINDS = Object.freeze([
  "plan", "finalized_transaction", "receipt", "repair_lineage"
]);

function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, {
    changed: false,
    limb: "mechanical_failure",
    owner: "controlled_contract_refactor_staging",
    ...details
  });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])])
  );
  return value;
}

function retainedJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
}

function identityFor(resourceKind, payload) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical({
    resource_kind: resourceKind,
    payload
  }))).digest("hex")}`;
}

function identityHex(identity) {
  return typeof identity === "string" && /^sha256:[0-9a-f]{64}$/u.test(identity)
    ? identity.slice(7) : null;
}

async function ensureDirectory(parent, name) {
  const directory = path.join(parent, name);
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const entry = await lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink() ||
      await realpath(directory) !== directory) {
    fail("controlled_contract_refactor_staging_unavailable",
      "refactor staging is not one repository-confined real directory");
  }
  return directory;
}

async function store(repoRoot, { create = true } = {}) {
  const { repository } = await resolveControlledContractRepository(repoRoot);
  const runtime = path.join(repository, RUNTIME_DIRECTORY);
  try {
    if (!create) {
      const entry = await lstat(runtime);
      if (!entry.isDirectory() || entry.isSymbolicLink()) return null;
    }
    const runtimeRoot = create ? await ensureDirectory(repository, RUNTIME_DIRECTORY) : runtime;
    const root = create ? await ensureDirectory(runtimeRoot, STORE_DIRECTORY)
      : path.join(runtimeRoot, STORE_DIRECTORY);
    const directory = create ? await ensureDirectory(root, STORE_VERSION_DIRECTORY)
      : path.join(root, STORE_VERSION_DIRECTORY);
    if (!create) {
      const entry = await lstat(directory);
      if (!entry.isDirectory() || entry.isSymbolicLink() ||
          await realpath(directory) !== directory) return null;
    }
    return Object.freeze({ repository, directory });
  } catch (error) {
    if (!create && error?.code === "ENOENT") return null;
    if (error instanceof ControlledContractToolError) throw error;
    fail("controlled_contract_refactor_staging_unavailable",
      "refactor staging is unavailable", { cause_code: error?.code ?? null });
  }
}

function resourcePath(retainedStore, identity) {
  const hex = identityHex(identity);
  return hex === null ? null : path.join(retainedStore.directory, `${hex}${RESOURCE_SUFFIX}`);
}

function statePath(retainedStore, identity) {
  const hex = identityHex(identity);
  return hex === null ? null : path.join(retainedStore.directory, `${hex}${STATE_SUFFIX}`);
}

async function readRealFile(filename, { missing = false } = {}) {
  try {
    const entry = await lstat(filename);
    if (!entry.isFile() || entry.isSymbolicLink() || await realpath(filename) !== filename) {
      fail("controlled_contract_refactor_staging_tampered",
        "refactor staging entry is not one real file");
    }
    const bytes = await readFile(filename);
    if (bytes.byteLength > CONTROLLED_CONTRACT_REFACTOR_STAGING_MAX_BYTES) {
      fail("controlled_contract_refactor_staging_tampered",
        "refactor staging entry exceeds its private retention bound", {
          actual_bytes: bytes.byteLength,
          maximum_bytes: CONTROLLED_CONTRACT_REFACTOR_STAGING_MAX_BYTES
        });
    }
    return bytes;
  } catch (error) {
    if (missing && error?.code === "ENOENT") return null;
    if (error instanceof ControlledContractToolError) throw error;
    fail("controlled_contract_refactor_staging_unavailable",
      "refactor staging entry is unreadable", { cause_code: error?.code ?? null });
  }
}

function parse(bytes) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!isPlainObject(value)) throw new TypeError("not an object");
    return value;
  } catch (error) {
    fail("controlled_contract_refactor_staging_tampered",
      "refactor staging entry is malformed JSON", { cause_code: error?.code ?? null });
  }
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeExclusive(retainedStore, filename, value) {
  const bytes = retainedJsonBytes(value);
  if (bytes.byteLength > CONTROLLED_CONTRACT_REFACTOR_STAGING_MAX_BYTES) fail(
    "controlled_contract_refactor_staging_too_large",
    "the private prospective refactor transaction exceeds its retention bound", {
      actual_bytes: bytes.byteLength,
      maximum_bytes: CONTROLLED_CONTRACT_REFACTOR_STAGING_MAX_BYTES
    });
  const temporary = path.join(retainedStore.directory,
    `.refactor-staging-${randomUUID()}`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await link(temporary, filename);
    await unlink(temporary);
    await syncDirectory(retainedStore.directory);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    }
    throw error;
  }
}

async function writeReplacement(retainedStore, filename, value) {
  const bytes = retainedJsonBytes(value);
  const temporary = path.join(retainedStore.directory,
    `.refactor-staging-${randomUUID()}`);
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, filename);
  await syncDirectory(retainedStore.directory);
}

function authenticateResource(value, identity, now) {
  const keys = ["schema_version", "identity", "resource_kind", "created_at",
    "expires_at", "payload"].sort();
  if (!isPlainObject(value) || JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(keys) || value.schema_version !== STAGING_SCHEMA ||
      value.identity !== identity || !RESOURCE_KINDS.includes(value.resource_kind) ||
      !Number.isSafeInteger(value.created_at) ||
      !Number.isSafeInteger(value.expires_at) || value.expires_at <= value.created_at ||
      !isPlainObject(value.payload) || identityFor(value.resource_kind, value.payload) !== identity) {
    fail("controlled_contract_refactor_staging_tampered",
      "retained refactor resource failed authentication");
  }
  if (value.expires_at <= now) fail("controlled_contract_refactor_staging_expired",
    "retained refactor resource expired without canonical mutation", {
      resource_identity: identity,
      expired_at: value.expires_at
    });
  return deepFreezePlainData(structuredClone(value));
}

async function garbageCollect(retainedStore, now) {
  const names = await readdir(retainedStore.directory);
  for (const name of names.filter((entry) => /^[0-9a-f]{64}\.json$/u.test(entry))) {
    const filename = path.join(retainedStore.directory, name);
    const bytes = await readRealFile(filename, { missing: true });
    if (bytes === null) continue;
    const value = parse(bytes);
    if (Number.isSafeInteger(value.expires_at) && value.expires_at <= now) {
      const identity = `sha256:${name.slice(0, 64)}`;
      await unlink(filename).catch((error) => { if (error?.code !== "ENOENT") throw error; });
      await unlink(statePath(retainedStore, identity)).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
  }
}

export function controlledContractRefactorResourceIdentity(resourceKind, payload) {
  return identityFor(resourceKind, payload);
}

export async function claimControlledContractRefactorResource({
  repoRoot, resourceKind, payload, now = Date.now(),
  ttlMs = CONTROLLED_CONTRACT_REFACTOR_STAGING_TTL_MS
}) {
  if (!isPlainObject(payload) || !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(ttlMs) || ttlMs < 1 ||
      !RESOURCE_KINDS.includes(resourceKind)) {
    fail("controlled_contract_refactor_staging_invalid",
      "refactor staging requires one closed resource request");
  }
  const retainedStore = await store(repoRoot);
  await garbageCollect(retainedStore, now);
  const identity = identityFor(resourceKind, payload);
  const filename = resourcePath(retainedStore, identity);
  const existing = await readRealFile(filename, { missing: true });
  if (existing !== null) {
    return Object.freeze({ created: false,
      resource: authenticateResource(parse(existing), identity, now) });
  }
  const record = { schema_version: STAGING_SCHEMA, identity, resource_kind: resourceKind,
    created_at: now, expires_at: now + ttlMs, payload: structuredClone(payload) };
  let created = true;
  try {
    await writeExclusive(retainedStore, filename, record);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    created = false;
  }
  return Object.freeze({ created,
    resource: authenticateResource(parse(await readRealFile(filename)), identity, now) });
}

export async function retainControlledContractRefactorResource(request) {
  return (await claimControlledContractRefactorResource(request)).resource;
}

export async function readControlledContractRefactorResource({ repoRoot, identity,
  expectedKind = null, now = Date.now() }) {
  if (identityHex(identity) === null) return null;
  const retainedStore = await store(repoRoot, { create: false });
  if (retainedStore === null) return null;
  const bytes = await readRealFile(resourcePath(retainedStore, identity), { missing: true });
  if (bytes === null) return null;
  const value = authenticateResource(parse(bytes), identity, now);
  await garbageCollect(retainedStore, now);
  if (expectedKind !== null && value.resource_kind !== expectedKind) fail(
    "controlled_contract_refactor_staging_tampered",
    "retained refactor resource kind does not match the requested contract");
  return value;
}

function authenticateState(value, identity) {
  if (value.schema_version !== STATE_SCHEMA || value.plan_identity !== identity ||
      !["finalized", "consumed"].includes(value.status) ||
      typeof value.transaction_identity !== "string" ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
        "schema_version", "plan_identity", "status", "transaction_identity",
        "continuation", "receipt_identity", "state_digest"
      ].sort()) || value.state_digest !== identityFor("state", {
        plan_identity: value.plan_identity, status: value.status,
        transaction_identity: value.transaction_identity,
        continuation: value.continuation, receipt_identity: value.receipt_identity
      })) fail("controlled_contract_refactor_staging_tampered",
    "retained refactor state failed authentication");
  return deepFreezePlainData(value);
}

export async function readControlledContractRefactorState({ repoRoot, identity }) {
  const retainedStore = await store(repoRoot, { create: false });
  if (retainedStore === null || identityHex(identity) === null) return null;
  const bytes = await readRealFile(statePath(retainedStore, identity), { missing: true });
  if (bytes === null) return null;
  return authenticateState(parse(bytes), identity);
}

export async function transitionControlledContractRefactorState({ repoRoot, planIdentity,
  status, transactionIdentity, continuation, receiptIdentity = null }) {
  const retainedStore = await store(repoRoot);
  const body = { plan_identity: planIdentity, status,
    transaction_identity: transactionIdentity, continuation,
    receipt_identity: receiptIdentity };
  const value = { schema_version: STATE_SCHEMA, ...body,
    state_digest: identityFor("state", body) };
  const filename = statePath(retainedStore, planIdentity);
  const existing = await readRealFile(filename, { missing: true });
  if (existing !== null) {
    const observed = authenticateState(parse(existing), planIdentity);
    if (JSON.stringify(canonical(observed)) === JSON.stringify(canonical(value))) return observed;
    if (observed.status === "finalized" && status === "consumed" &&
        observed.plan_identity === planIdentity &&
        observed.transaction_identity === transactionIdentity &&
        observed.continuation === continuation && observed.receipt_identity === null) {
      await writeReplacement(retainedStore, filename, value);
      return readControlledContractRefactorState({ repoRoot, identity: planIdentity });
    }
    fail("controlled_contract_refactor_plan_stale",
      "refactor plan already has a different durable transition");
  }
  try {
    await writeExclusive(retainedStore, filename, value);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const observed = parse(await readRealFile(filename));
  if (JSON.stringify(canonical(observed)) !== JSON.stringify(canonical(value))) fail(
    "controlled_contract_refactor_plan_stale",
    "concurrent refactor finalization selected another transition");
  return deepFreezePlainData(observed);
}

export async function clearControlledContractRefactorStagingForTest({ repoRoot }) {
  const retainedStore = await store(repoRoot, { create: false });
  if (retainedStore === null) return;
  const names = await readdir(retainedStore.directory);
  for (const name of names) await unlink(path.join(retainedStore.directory, name));
}
