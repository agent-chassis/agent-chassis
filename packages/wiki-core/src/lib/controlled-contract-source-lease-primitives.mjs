import { randomUUID } from "node:crypto";
import {
  readFile,
  rename,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  assertCanonicalWorkRecordReadLease
} from "../operations/work-records-store-io.mjs";
import {
  DIGEST_PATTERN,
  fail,
  isPlainObject,
  controlledContractCarrierFilename,
  classifyControlledContractCarrierBasename,
  canonicalJsonBytes,
  resolveControlledContractRepository,
  inspectCarrierFile,
  parseCarrierJson
} from "./controlled-contract-tool-shared.mjs";
import {
  resolveManifestControlledContractCarrierFilename
} from "./controlled-contract-carrier-set-evaluation.mjs";

export function assertExpectedDigest(value) {
  if (value !== null && (typeof value !== "string" || !DIGEST_PATTERN.test(value))) {
    fail(
      "controlled_contract_expected_digest_invalid",
      "expected_content_digest must be null for absence or an exact sha256 digest"
    );
  }
}

function sourceLockRecord(owner, filename) {
  return {
    schema_version: "controlled-contract-source-lock.v1",
    operation_token: owner.operationToken,
    process_id: process.pid,
    process_start_identity: owner.processStart,
    carrier: path.basename(filename)
  };
}

function validSourceLockRecord(value) {
  return isPlainObject(value) &&
    value.schema_version === "controlled-contract-source-lock.v1" &&
    typeof value.operation_token === "string" &&
    /^[0-9a-f-]{36}$/u.test(value.operation_token) &&
    Number.isSafeInteger(value.process_id) && value.process_id > 0 &&
    typeof value.process_start_identity === "string" &&
    value.process_start_identity.length > 0 &&
    typeof value.carrier === "string" && path.basename(value.carrier) === value.carrier;
}

export async function acquireCarrierLock(file, owner, { processStartIdentity }) {
  const lock = `${file}.cas-lock`;
  const record = sourceLockRecord(owner, file);
  try {
    await writeFile(lock, canonicalJsonBytes(record), { flag: "wx", mode: 0o600 });
    return { lock, record };
  } catch (error) {
    if (error?.code !== "EEXIST") fail("controlled_contract_carrier_busy",
      "canonical carrier lock could not be created", { cause_code: error?.code ?? null });
  }
  let existing;
  try {
    existing = parseCarrierJson((await readFile(lock)).toString("utf8"));
  } catch {
    fail("controlled_contract_carrier_busy",
      "canonical carrier owner is unverifiable and remains untouched");
  }
  if (!validSourceLockRecord(existing)) fail("controlled_contract_carrier_busy",
    "canonical carrier owner is unverifiable and remains untouched");
  let observedStart;
  try {
    observedStart = await processStartIdentity(existing.process_id);
  } catch {
    fail("controlled_contract_carrier_busy",
      "canonical carrier owner liveness is unverifiable and remains untouched");
  }
  if (observedStart === existing.process_start_identity) fail(
    "controlled_contract_carrier_busy", "canonical carrier has a live concurrent writer");
  const quarantine = `${lock}.stale-${existing.operation_token}-${randomUUID()}`;
  try {
    await rename(lock, quarantine);
    await writeFile(lock, canonicalJsonBytes(record), { flag: "wx", mode: 0o600 });
  } catch (error) {
    fail("controlled_contract_carrier_busy", "source-lock recovery lost ownership race", {
      cause_code: error?.code ?? null
    });
  }
  await rm(quarantine, { force: true });
  return { lock, record };
}

export async function assertControlledContractCarrierExpectedDigestImpl({
  repoRoot,
  wkId,
  focus = null,
  carrierKind,
  expectedContentDigest,
  pack = null,
  preferPack = false,
  canonicalSet = null
}, { resolveCanonicalControlledContractCarrierSet }) {
  assertExpectedDigest(expectedContentDigest);
  canonicalSet ??= await resolveCanonicalControlledContractCarrierSet({
    repoRoot, wkId, focus
  });
  const filename = resolveManifestControlledContractCarrierFilename({
    canonicalSet, wkId, focus, carrierKind, pack, preferPack
  });
  const actualDigest = canonicalSet.members_by_basename[filename]?.content_digest ?? null;
  if (actualDigest !== expectedContentDigest) fail(
    "controlled_contract_stale_content_digest", "canonical carrier content changed", {
      expected_content_digest: expectedContentDigest,
      actual_content_digest: actualDigest
    });
  return Object.freeze({
    store: await resolveControlledContractRepository(repoRoot),
    file: null,
    filename,
    actualDigest,
    canonical_generation: canonicalSet.generation
  });
}

export async function releaseCarrierLock(locked) {
  let current;
  try {
    current = parseCarrierJson((await readFile(locked.lock)).toString("utf8"));
  } catch {
    return;
  }
  if (current.operation_token === locked.record.operation_token &&
      current.process_id === locked.record.process_id &&
      current.process_start_identity === locked.record.process_start_identity) {
    await unlink(locked.lock).catch(() => {});
  }
}

const CONTROLLED_SOURCE_LEASES = new WeakMap();

export function sourceLeaseFailure(code, message, details = {}) {
  fail(`controlled_contract_source_lease_${code}`, message, details);
}

export function canonicalEvaluationBasenames({ wkId, focus, request }) {
  const names = new Set([
    controlledContractCarrierFilename({ wkId, focus, carrierKind: "evaluation_input" })
  ]);
  if (!Array.isArray(request?.selected_packs)) sourceLeaseFailure(
    "source_invalid", "canonical proof-plan request has no selected_packs population");
  for (const selected of request.selected_packs) {
    const basename = selected?.evaluation_input_path;
    const classified = classifyControlledContractCarrierBasename({ wkId, basename });
    if (classified.member !== true || classified.carrier_kind !== "evaluation_input" ||
        (classified.pack_namespace !== null && classified.focus !== (focus ?? null))) {
      sourceLeaseFailure("source_invalid",
        "canonical proof-plan request references a non-canonical evaluation input",
        { basename: typeof basename === "string" ? basename : null });
    }
    names.add(basename);
  }
  return [...names].sort();
}

export async function assertControlledContractSourceLeaseImpl(lease, {
  repoRoot, wkId, focus, repository
}, { resolveCanonicalControlledContractCarrierSet }) {
  const state = lease !== null && typeof lease === "object"
    ? CONTROLLED_SOURCE_LEASES.get(lease) : null;
  if (!state?.active) sourceLeaseFailure("expired",
    "carrier-set publication requires one live server-owned source lease");
  if (state.store.repository !== path.resolve(repoRoot) || state.wkId !== wkId ||
      state.focus !== (focus ?? null) || state.repository !== repository) sourceLeaseFailure(
    "identity_mismatch", "source lease repository, WK, focus, or durable repository identity differs");
  try {
    assertCanonicalWorkRecordReadLease(state.recordLease, {
      dir: state.store.repository, id: wkId
    });
  } catch (error) {
    sourceLeaseFailure("expired", "source lease no longer owns the canonical work-record lock",
      { cause_code: error?.code ?? null });
  }
  if (Date.now() > state.expiresAt) sourceLeaseFailure("expired",
    "source lease expired before manifest publication");
  if (state.snapshot.canonical_set_source) {
    const current = await resolveCanonicalControlledContractCarrierSet({
      repoRoot: state.store.repository, wkId, focus
    });
    if (current.source !== state.snapshot.canonical_set_source ||
        current.manifest_content_digest !== state.snapshot.manifest_content_digest) {
      sourceLeaseFailure("source_stale",
        "canonical generation manifest changed during authoring", {
          expected_manifest_digest: state.snapshot.manifest_content_digest,
          actual_manifest_digest: current.manifest_content_digest
        });
    }
    for (const [basename, expectedDigest] of Object.entries(
      state.snapshot.canonical_member_digests
    )) {
      const actualDigest = current.members_by_basename[basename]?.content_digest ?? null;
      if (actualDigest !== expectedDigest) sourceLeaseFailure("source_stale",
        "a manifest-selected canonical source changed during authoring", {
          basename,
          expected_content_digest: expectedDigest,
          actual_content_digest: actualDigest
        });
    }
    return state;
  }
  for (const [basename, expectedDigest] of Object.entries(state.snapshot.source_digests)) {
    if (basename === "work-record") continue;
    const inspected = await inspectCarrierFile(path.join(state.store.contracts, basename), {
      required: false
    });
    const actualDigest = inspected?.digest ?? null;
    if (actualDigest !== expectedDigest) sourceLeaseFailure("source_stale",
      "a canonical controlled-contract source changed during authoring",
      { basename, expected_content_digest: expectedDigest, actual_content_digest: actualDigest });
  }
  return state;
}

export function activateControlledContractSourceLease(token, state) {
  CONTROLLED_SOURCE_LEASES.set(token, state);
}
