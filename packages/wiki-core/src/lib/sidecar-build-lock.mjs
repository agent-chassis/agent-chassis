import { randomUUID } from "node:crypto";
import { link, lstat, open, readFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

export const SIDECAR_BUILD_LOCK_SUFFIX = ".build-lock.json";
export const SIDECAR_BUILD_LOCK_CANDIDATE_SLOT_COUNT = 8;
export const SIDECAR_BUILD_COALESCE_MAX_ATTEMPTS = 100;
export const SIDECAR_BUILD_COALESCE_POLL_MS = 50;
export const SIDECAR_BUILD_LEASE_MAX_MS = 60_000, SIDECAR_BUILD_LEASE_MAX_GENERATIONS = SIDECAR_BUILD_LOCK_CANDIDATE_SLOT_COUNT, SIDECAR_BUILD_LEASE_MAX_FOLLOW_ATTEMPTS = 100;
export const SIDECAR_BUILD_LEASE_OUTCOMES = { ACQUIRED: "acquired", FOLLOWING: "following", TAKEOVER: "takeover", SUPERSEDED: "superseded", TIMEOUT: "timeout", EXHAUSTED: "exhausted", INVALID_STATE: "invalid_state", PUBLISHED: "published", RENEWED: "renewed", RELEASED: "released" };

const SIDECAR_BUILD_LOCK_TTL_MS = 60_000;
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const ACTIVE_BUILD_LOCK_OWNER_TOKENS = new Set();

const ACTIVE_SIDECAR_BUILD_LEADERS = new Map();

const LEADERSHIP_OUTCOME_PUBLISHED = "published";
const LEADERSHIP_OUTCOME_FAILED = "failed";

const LOCK_EVIDENCE_SELF_ACTIVE = "self_active";
const LOCK_EVIDENCE_FOREIGN_ACTIVE = "foreign_active";
const LOCK_EVIDENCE_FOREIGN_ACTIVE_STALE = "foreign_active_stale";
const LOCK_EVIDENCE_INACTIVE_RESIDUE = "inactive_residue";
const LOCK_EVIDENCE_UNTRUSTED = "untrusted";
const LOCK_EVIDENCE_READ_FAILED = "read_failed";

const LOCK_EVIDENCE_DIAGNOSTIC_CODES = {
  [LOCK_EVIDENCE_FOREIGN_ACTIVE]: "published_lock_foreign_active",
  [LOCK_EVIDENCE_FOREIGN_ACTIVE_STALE]: "published_lock_foreign_active_stale",
  [LOCK_EVIDENCE_INACTIVE_RESIDUE]: "published_lock_inactive_residue",
  [LOCK_EVIDENCE_UNTRUSTED]: "published_lock_untrusted",
  [LOCK_EVIDENCE_READ_FAILED]: "published_lock_read_failed"
};

function lockDiagnostic(code) {
  return { code };
}

function leadershipKey(lockPath, anchorCommit) {
  return JSON.stringify([lockPath, anchorCommit]);
}

export function claimSidecarBuildLeadership(lockPath, anchorCommit, { coalescible = false } = {}) {
  if (coalescible !== true || typeof anchorCommit !== "string" || anchorCommit.length === 0) {
    return { leader: true, entry: null, follow: null };
  }
  const key = leadershipKey(lockPath, anchorCommit);
  const active = ACTIVE_SIDECAR_BUILD_LEADERS.get(key);
  if (active) {

    return { leader: false, entry: null, follow: active };
  }
  const entry = { key, token: randomUUID(), outcome: null, artifact: null };
  ACTIVE_SIDECAR_BUILD_LEADERS.set(key, entry);
  return { leader: true, entry, follow: null };
}

export function settleSidecarBuildLeadershipPublished(entry, artifact) {
  if (!entry || entry.outcome !== null) {
    return;
  }
  entry.artifact = artifact;
  entry.outcome = LEADERSHIP_OUTCOME_PUBLISHED;
}

export function settleSidecarBuildLeadershipFailed(entry) {
  if (!entry || entry.outcome !== null) {
    return;
  }
  entry.outcome = LEADERSHIP_OUTCOME_FAILED;
}

export function releaseSidecarBuildLeadership(entry) {
  if (!entry || typeof entry.token !== "string" || entry.token.length === 0) {
    return;
  }
  const active = ACTIVE_SIDECAR_BUILD_LEADERS.get(entry.key);
  if (active && active.token === entry.token) {
    ACTIVE_SIDECAR_BUILD_LEADERS.delete(entry.key);
  }
}

export function activeSidecarBuildLeaderCount() {
  return ACTIVE_SIDECAR_BUILD_LEADERS.size;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function isKnownActiveBuildLock(record) {
  return Boolean(
    record?.pid === process.pid &&
      typeof record.owner_token === "string" &&
      ACTIVE_BUILD_LOCK_OWNER_TOKENS.has(record.owner_token)
  );
}

function classifyPublishedLockEvidence(existing) {
  if (!existing || existing.readFailed) {
    return LOCK_EVIDENCE_READ_FAILED;
  }
  const record = existing.malformed ? null : existing.record;
  if (
    !record ||
    !Number.isInteger(record.pid) ||
    record.pid <= 0 ||
    !Object.prototype.hasOwnProperty.call(record, "anchor") ||
    !Number.isFinite(Date.parse(record.started_at))
  ) {
    return LOCK_EVIDENCE_UNTRUSTED;
  }
  if (isKnownActiveBuildLock(record)) {
    return LOCK_EVIDENCE_SELF_ACTIVE;
  }
  if (record.pid === process.pid) {

    return LOCK_EVIDENCE_INACTIVE_RESIDUE;
  }
  if (!isProcessAlive(record.pid)) {
    return LOCK_EVIDENCE_INACTIVE_RESIDUE;
  }
  if (Date.now() - Date.parse(record.started_at) > SIDECAR_BUILD_LOCK_TTL_MS) {
    return LOCK_EVIDENCE_FOREIGN_ACTIVE_STALE;
  }
  return LOCK_EVIDENCE_FOREIGN_ACTIVE;
}

async function readBuildLock(lockPath) {
  let rawBytes;
  try {
    rawBytes = await readFile(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    return { record: null, rawBytes: null, readFailed: true, malformed: false };
  }
  let parsed;
  try {
    parsed = JSON.parse(FATAL_UTF8_DECODER.decode(rawBytes));
  } catch {
    return { record: null, rawBytes, readFailed: false, malformed: true };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof parsed.owner_token !== "string" ||
    parsed.owner_token.length === 0
  ) {
    return { record: null, rawBytes, readFailed: false, malformed: true };
  }
  return { record: parsed, rawBytes, readFailed: false, malformed: false };
}

function existingLockDisposition(lockPath, existing) {
  const evidence = classifyPublishedLockEvidence(existing);
  const code = LOCK_EVIDENCE_DIAGNOSTIC_CODES[evidence];
  return {
    owned: false,
    lockPath,
    evidence,

    diagnostics: code ? [lockDiagnostic(code)] : []
  };
}

function candidatePathForSlot(lockPath, slot) {
  return path.join(
    path.dirname(lockPath),
    `.${path.basename(lockPath)}.slot-${String(slot).padStart(2, "0")}.candidate`
  );
}

async function claimCandidateSlot(lockPath) {
  for (let slot = 0; slot < SIDECAR_BUILD_LOCK_CANDIDATE_SLOT_COUNT; slot += 1) {
    const candidatePath = candidatePathForSlot(lockPath, slot);
    try {
      const handle = await open(candidatePath, "wx");
      return { candidatePath, handle };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }
  }
  return null;
}

async function observePublishedLock(lockPath) {
  let beforeStat;
  try {
    beforeStat = await lstat(lockPath);
  } catch {
    return {
      observed: { record: null, rawBytes: null, readFailed: true },
      fileIdentity: null,
      fileIdentityStable: false,
      fileIdentityMatches: () => false
    };
  }
  const observed = await readBuildLock(lockPath);
  let afterStat;
  try {
    afterStat = await lstat(lockPath);
  } catch {
    return {
      observed: { ...(observed ?? {}), readFailed: true },
      fileIdentity: null,
      fileIdentityStable: false,
      fileIdentityMatches: () => false
    };
  }
  const fileIdentityStable = Boolean(
    observed &&
      !observed.readFailed &&
      beforeStat.isFile() &&
      afterStat.isFile() &&
      beforeStat.dev === afterStat.dev &&
      beforeStat.ino === afterStat.ino
  );
  const fileIdentity = fileIdentityStable ? { dev: afterStat.dev, ino: afterStat.ino } : null;
  return {
    observed,
    fileIdentity,
    fileIdentityStable,
    fileIdentityMatches: (expected) =>
      Boolean(
        fileIdentityStable &&
          expected &&
          fileIdentity.dev === expected.dev &&
          fileIdentity.ino === expected.ino
      )
  };
}

async function publishBuildLockCandidate(lockPath, record) {
  const slotClaim = await claimCandidateSlot(lockPath);
  if (!slotClaim) {
    return {
      claimed: false,
      slotsExhausted: true,
      diagnostics: [lockDiagnostic("lock_candidate_slots_exhausted")]
    };
  }

  const { candidatePath } = slotClaim;
  const serialized = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
  const diagnostics = [];
  let handle = slotClaim.handle;
  let claimed = false;
  let primaryError = null;
  let candidateIdentity = null;
  let verifiedPublication = null;
  try {
    const candidateStat = await handle.stat();
    candidateIdentity = { dev: candidateStat.dev, ino: candidateStat.ino };
    await handle.writeFile(serialized);
    await handle.sync();
    try {
      await handle.close();
    } catch (error) {
      diagnostics.push(lockDiagnostic("lock_candidate_close_failed"));
      throw error;
    }
    handle = null;

    ACTIVE_BUILD_LOCK_OWNER_TOKENS.add(record.owner_token);
    await link(candidatePath, lockPath);
    const published = await observePublishedLock(lockPath);
    claimed = Boolean(
      published.fileIdentityStable &&
        published.fileIdentityMatches(candidateIdentity) &&
        published.observed?.rawBytes?.equals(serialized) &&
        published.observed.record?.owner_token === record.owner_token
    );
    if (!claimed) {
      diagnostics.push(lockDiagnostic("published_lock_claim_verification_failed"));
    } else {
      verifiedPublication = published;
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (!claimed) {
      ACTIVE_BUILD_LOCK_OWNER_TOKENS.delete(record.owner_token);
    }
    if (handle) {
      try {
        await handle.close();
      } catch {
        diagnostics.push(lockDiagnostic("lock_candidate_close_failed"));
      }
    }
    if (candidateIdentity) {

      try {
        await lstat(candidatePath);
        diagnostics.push(lockDiagnostic("lock_candidate_retained"));
      } catch {
        diagnostics.push(lockDiagnostic("lock_candidate_retention_unverified"));
      }
    }
  }

  if (claimed) {
    return {
      claimed: true,
      slotsExhausted: false,
      rawBytes: verifiedPublication.observed.rawBytes,
      fileIdentity: verifiedPublication.fileIdentity,
      diagnostics
    };
  }
  if (!primaryError) {
    return { claimed: false, slotsExhausted: false, diagnostics };
  }
  const publicationError = new Error("sidecar build lock candidate publication failed");
  if (typeof primaryError?.code === "string") {
    publicationError.code = primaryError.code;
  }
  publicationError.lockDiagnostics = diagnostics;
  throw publicationError;
}

export async function acquireSidecarBuildLock(lockPath, anchorCommit) {

  const existingBeforeCandidate = await readBuildLock(lockPath);
  if (existingBeforeCandidate !== null) {
    return existingLockDisposition(lockPath, existingBeforeCandidate);
  }

  const record = {
    pid: process.pid,
    anchor: anchorCommit ?? null,
    started_at: new Date().toISOString(),
    owner_token: randomUUID()
  };
  try {
    const publication = await publishBuildLockCandidate(lockPath, record);
    if (!publication.claimed) {
      return {
        owned: false,
        lockPath,
        diagnostics: publication.diagnostics
      };
    }
    return {
      owned: true,
      lockPath,
      record,
      rawBytes: publication.rawBytes,
      fileIdentity: publication.fileIdentity,
      diagnostics: publication.diagnostics
    };
  } catch (error) {
    if (error?.code === "EEXIST") {
      const existingAfterRace = await readBuildLock(lockPath);
      return existingLockDisposition(lockPath, existingAfterRace);
    }
    return {
      owned: false,
      lockPath,
      diagnostics: [
        ...(error?.lockDiagnostics ?? []),
        lockDiagnostic("lock_candidate_publication_failed")
      ]
    };
  }
}

function observedLockBelongsToOwner(observed, lock) {
  return Boolean(
    observed?.rawBytes &&
      observed.rawBytes.equals(lock.rawBytes) &&
      observed.record?.owner_token === lock.record.owner_token
  );
}

export async function releaseSidecarBuildLock(lock) {
  const diagnostics = [];
  if (!lock?.owned || !lock.lockPath) {
    return diagnostics;
  }
  try {
    const releaseObservation = await observePublishedLock(lock.lockPath);
    const current = releaseObservation.observed;
    if (current?.readFailed) {
      diagnostics.push(lockDiagnostic("published_lock_release_read_failed"));
      return diagnostics;
    }
    if (
      !releaseObservation.fileIdentityMatches(lock.fileIdentity) ||
      !observedLockBelongsToOwner(current, lock)
    ) {
      diagnostics.push(lockDiagnostic("published_lock_release_ownership_lost"));
      return diagnostics;
    }
  } catch {
    diagnostics.push(lockDiagnostic("published_lock_release_observation_failed"));
  } finally {
    ACTIVE_BUILD_LOCK_OWNER_TOKENS.delete(lock.record?.owner_token);
  }

  return diagnostics;
}

export function appendSidecarBuildLockDiagnostics(envelope, diagnostics) {
  const codes = [];
  const seen = new Set();
  if (Array.isArray(diagnostics)) {
    for (const entry of diagnostics) {
      const code = entry?.code;
      if (typeof code !== "string" || seen.has(code)) {
        continue;
      }
      seen.add(code);
      codes.push(code);
      if (codes.length === 8) {
        break;
      }
    }
  }
  if (codes.length === 0) {
    return envelope;
  }
  envelope.derived_evidence.push({
    kind: "sidecar_build_lock_advisory",
    codes,
    provenance: {
      source_kind: "code_index",
      canonicality: "derived",
      evidence_basis: "unknown"
    }
  });
  return envelope;
}

async function readLeaseJson(filePath) { try { const raw = await readFile(filePath);
  return { value: JSON.parse(FATAL_UTF8_DECODER.decode(raw)) }; } catch (error) { return error?.code === "ENOENT" ? null : { invalid: true }; } }

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForCoalescedSidecarArtifact({ follow }) {
  if (!follow) {
    return null;
  }
  for (let attempt = 0; attempt < SIDECAR_BUILD_COALESCE_MAX_ATTEMPTS; attempt += 1) {
    if (follow.outcome === LEADERSHIP_OUTCOME_PUBLISHED) {
      return follow.artifact;
    }
    if (follow.outcome === LEADERSHIP_OUTCOME_FAILED) {
      return null;
    }
    await delay(SIDECAR_BUILD_COALESCE_POLL_MS);
  }
  return null;
}

const LEASE_PROTOCOL = "sidecar-build-lease.v1";
const LEASE_IDENTITY_FIELDS = ["repository_identity", "head_commit", "schema_identity", "generator_identity", "scip_input_identity"];
function normalizeLeaseIdentity(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) throw new Error("invalid identity");
  const normalized = {};
  for (const field of LEASE_IDENTITY_FIELDS) {
    if (typeof identity[field] !== "string" || !identity[field]) throw new Error("invalid identity");
    normalized[field] = identity[field];
  }
  return normalized;
}
function validIdentityDigest(value) {
  if (typeof value !== "string" || !value || value.length > 96) return false;
  for (const character of value) {
    const lower = character >= "a" && character <= "z", upper = character >= "A" && character <= "Z";
    if (!lower && !upper && !(character >= "0" && character <= "9") && character !== "-" && character !== "_") return false;
  }
  return true;
}
export function deriveSidecarBuildLeadershipKey(identity, identityDigest) {
  normalizeLeaseIdentity(identity);
  if (!validIdentityDigest(identityDigest)) throw new Error("invalid identity digest");
  return identityDigest;
}
const leasePaths = (lockPath, key, generation) => {
  const base = `${lockPath}.xproc-${key}.g${generation}`;
  return { lease: `${base}.lease.json`, terminal: `${base}.terminal.json`, heartbeatBase: `${base}.heartbeat` };
};
const heartbeatPath = (paths, sequence) => `${paths.heartbeatBase}-${sequence}.json`;
function validLeaseRecord(record, key, identity, generation, kind, ownerToken) {
  return Boolean(record?.protocol === LEASE_PROTOCOL && record.kind === kind && record.leadership_key === key &&
    record.generation === generation && typeof record.owner_token === "string" && record.owner_token &&
    (!ownerToken || record.owner_token === ownerToken) && JSON.stringify(record.identity) === JSON.stringify(identity));
}
async function readLeaseState(lockPath, key, identity) {
  let current = null;
  for (let generation = 1; generation <= SIDECAR_BUILD_LEASE_MAX_GENERATIONS; generation += 1) {
    const paths = leasePaths(lockPath, key, generation);
    const lease = await readLeaseJson(paths.lease), terminal = await readLeaseJson(paths.terminal); if (lease?.invalid || terminal?.invalid) return { invalid: true, reason: "malformed_state" };
    let heartbeat = null, heartbeatCount = 0, heartbeatGap = false;
    for (let sequence = 1; sequence <= SIDECAR_BUILD_LEASE_MAX_GENERATIONS; sequence += 1) {
      const entry = await readLeaseJson(heartbeatPath(paths, sequence));
      if (entry?.invalid) return { invalid: true, reason: "malformed_state" };
      if (!entry) { heartbeatGap = true; continue; }
      if (heartbeatGap) return { invalid: true, reason: "partial_state" };
      heartbeat = entry.value; heartbeatCount = sequence;
    }
    if (!lease) {
      if (heartbeat || terminal) return { invalid: true, reason: "partial_state" };
      continue;
    }
    if (generation !== (current?.generation ?? 0) + 1 || !validLeaseRecord(lease.value, key, identity, generation, "lease") ||
        !Number.isFinite(lease.value.acquired_at) || !Number.isFinite(lease.value.expires_at) || lease.value.expires_at < lease.value.acquired_at || lease.value.expires_at - lease.value.acquired_at > SIDECAR_BUILD_LEASE_MAX_MS) return { invalid: true, reason: "incompatible_lease" };
    if (heartbeat && (!validLeaseRecord(heartbeat, key, identity, generation, "heartbeat", lease.value.owner_token) ||
        !Number.isFinite(heartbeat.renewed_at) || !Number.isFinite(heartbeat.expires_at) || heartbeat.expires_at < heartbeat.renewed_at || heartbeat.expires_at - heartbeat.renewed_at > SIDECAR_BUILD_LEASE_MAX_MS)) return { invalid: true, reason: "incompatible_heartbeat" };
    const publication = terminal?.value?.kind === "publication" ? terminal.value : null, release = terminal?.value?.kind === "release" ? terminal.value : null;
    if (terminal && !publication && !release) return { invalid: true, reason: "incompatible_terminal" };
    if (publication && (!validLeaseRecord(publication, key, identity, generation, "publication", lease.value.owner_token) || typeof publication.publication_identity !== "string" || !publication.publication_identity || typeof publication.publication_digest !== "string" || !publication.publication_digest || !Number.isFinite(publication.published_at))) return { invalid: true, reason: "incompatible_publication" };
    if (release && (!validLeaseRecord(release, key, identity, generation, "release", lease.value.owner_token) || !Number.isFinite(release.released_at))) return { invalid: true, reason: "incompatible_release" };
    current = { generation, paths, lease: lease.value, heartbeat, heartbeatCount,
      publication, release };
  }
  return { invalid: false, current };
}
async function writeLeaseRecord(lockPath, record) {
  try {
    const publication = await publishBuildLockCandidate(lockPath, record);
    return { created: publication.claimed, reason: publication.claimed ? null : publication.slotsExhausted ? "candidate_exhausted" : "publication_failed" };
  } catch (error) {
    return { created: false, reason: error?.code === "EEXIST" ? "preexisting_record" : "publication_failed" };
  } finally { ACTIVE_BUILD_LOCK_OWNER_TOKENS.delete(record.owner_token); }
}
function boundedInteger(value, fallback, minimum, maximum) {
  if (!Number.isInteger(value)) return fallback;
  if (value < minimum) return minimum;
  return value > maximum ? maximum : value;
}
const leaseExpired = (current) => Boolean(current.release || (current.heartbeat?.expires_at ?? current.lease.expires_at) <= Date.now());
const ownsCurrent = (state, lease) => Boolean(!state.invalid && state.current && state.current.generation === lease.generation &&
  state.current.lease.owner_token === lease.ownerToken && state.current.lease.leadership_key === lease.key);
const validLeaseHandle = (lease) => Boolean(lease?.lockPath && validIdentityDigest(lease.key) && lease.identity && Number.isInteger(lease.generation) && lease.ownerToken);
const leaseResult = (outcome, lockPath, identity, key, record) => ({ outcome,
  lease: { lockPath, identity, key, generation: record.generation, ownerToken: record.owner_token } });
const auxiliaryRecord = (kind, lease, fields = {}) => ({ protocol: LEASE_PROTOCOL, kind, leadership_key: lease.key,
  generation: lease.generation, owner_token: lease.ownerToken, identity: lease.identity, ...fields });
export async function acquireSidecarBuildLease({ lockPath, identity, identityDigest, leaseMs, maxTakeoverAttempts } = {}) {
  let normalized, key;
  try { normalized = normalizeLeaseIdentity(identity); key = deriveSidecarBuildLeadershipKey(normalized, identityDigest); }
  catch { return { outcome: "invalid_state", reason: "invalid_identity" }; }
  if (typeof lockPath !== "string" || !lockPath) return { outcome: "invalid_state", reason: "invalid_lock_path" };
  const duration = boundedInteger(leaseMs, 10_000, 250, SIDECAR_BUILD_LEASE_MAX_MS);
  const attempts = boundedInteger(maxTakeoverAttempts, 8, 1, SIDECAR_BUILD_LEASE_MAX_GENERATIONS);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await readLeaseState(lockPath, key, normalized);
    if (state.invalid) return { outcome: "invalid_state", reason: state.reason };
    if (state.current?.publication || (state.current && !leaseExpired(state.current))) return { outcome: "following",
      follow: { lockPath, identity: normalized, identityDigest: key, key, generation: state.current.generation } };
    const generation = (state.current?.generation ?? 0) + 1;
    if (generation > SIDECAR_BUILD_LEASE_MAX_GENERATIONS) return { outcome: "exhausted", key };
    const now = Date.now(), record = { protocol: LEASE_PROTOCOL, kind: "lease", leadership_key: key, generation,
      owner_token: randomUUID(), identity: normalized, acquired_at: now, expires_at: now + duration };
    const written = await writeLeaseRecord(leasePaths(lockPath, key, generation).lease, record);
    if (written.reason === "candidate_exhausted") return { outcome: "exhausted", key };
    if (written.reason === "publication_failed") return { outcome: "invalid_state", reason: written.reason };
    if (written.created) {
      const result = leaseResult(generation === 1 ? "acquired" : "takeover", lockPath, normalized, key, record);
      const after = await readLeaseState(lockPath, key, normalized);
      return ownsCurrent(after, result.lease) ? result : { outcome: "invalid_state", reason: "leadership_fenced" };
    }
  }
  return { outcome: "exhausted", key };
}
export async function renewSidecarBuildLease(lease, { leaseMs } = {}) {
  if (!validLeaseHandle(lease)) return { outcome: "invalid_state", reason: "invalid_lease" };
  const before = await readLeaseState(lease.lockPath, lease.key, lease.identity);
  if (!ownsCurrent(before, lease) || before.current.publication || before.current.release || leaseExpired(before.current)) return { outcome: "invalid_state", reason: "leadership_fenced" };
  const sequence = before.current.heartbeatCount + 1;
  if (sequence > SIDECAR_BUILD_LEASE_MAX_GENERATIONS) return { outcome: "exhausted", key: lease.key };
  const now = Date.now(), record = auxiliaryRecord("heartbeat", lease, { renewed_at: now,
    expires_at: now + boundedInteger(leaseMs, 10_000, 250, SIDECAR_BUILD_LEASE_MAX_MS) });
  const written = await writeLeaseRecord(heartbeatPath(before.current.paths, sequence), record);
  if (written.reason === "candidate_exhausted") return { outcome: "exhausted", key: lease.key };
  if (written.reason === "publication_failed") return { outcome: "invalid_state", reason: written.reason };
  const after = await readLeaseState(lease.lockPath, lease.key, lease.identity);
  return ownsCurrent(after, lease) && after.current.heartbeatCount >= sequence ? { outcome: "renewed", lease } : { outcome: "invalid_state", reason: "leadership_fenced" };
}
export async function publishSidecarBuildLease({ lease, publicationIdentity, publicationDigest } = {}) {
  if (!validLeaseHandle(lease) || typeof publicationIdentity !== "string" || !publicationIdentity || typeof publicationDigest !== "string" || !publicationDigest) return { outcome: "invalid_state", reason: "invalid_publication" };
  const before = await readLeaseState(lease.lockPath, lease.key, lease.identity);
  if (!ownsCurrent(before, lease) || before.current.publication || before.current.release || leaseExpired(before.current)) return { outcome: "invalid_state", reason: "leadership_fenced" };
  const record = auxiliaryRecord("publication", lease, { publication_identity: publicationIdentity, publication_digest: publicationDigest, published_at: Date.now() });
  const written = await writeLeaseRecord(before.current.paths.terminal, record);
  if (written.reason === "candidate_exhausted") return { outcome: "exhausted", key: lease.key };
  if (written.reason === "publication_failed") return { outcome: "invalid_state", reason: written.reason };
  const after = await readLeaseState(lease.lockPath, lease.key, lease.identity), publication = after.current?.publication;
  return ownsCurrent(after, lease) && publication?.publication_identity === publicationIdentity && publication.publication_digest === publicationDigest ?
    { outcome: "published", publication } : { outcome: "invalid_state", reason: "leadership_fenced" };
}
export async function followSidecarBuildLease({ lockPath, identity, identityDigest, generation, publicationIdentity,
  publicationDigest, timeoutMs, pollMs, leaseMs, maxTakeoverAttempts } = {}) {
  let normalized, key;
  try { normalized = normalizeLeaseIdentity(identity); key = deriveSidecarBuildLeadershipKey(normalized, identityDigest); }
  catch { return { outcome: "invalid_state", reason: "invalid_identity" }; }
  if (typeof lockPath !== "string" || !lockPath || !Number.isInteger(generation) || generation < 1 || generation > SIDECAR_BUILD_LEASE_MAX_GENERATIONS || typeof publicationIdentity !== "string" || !publicationIdentity || typeof publicationDigest !== "string" || !publicationDigest) return { outcome: "invalid_state", reason: "invalid_follow_request" };
  const poll = boundedInteger(pollMs, 50, 10, 1_000), timeout = boundedInteger(timeoutMs, 5_000, poll, 30_000);
  let attempts = (timeout + poll - 1) / poll;
  if (attempts > SIDECAR_BUILD_LEASE_MAX_FOLLOW_ATTEMPTS) attempts = SIDECAR_BUILD_LEASE_MAX_FOLLOW_ATTEMPTS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await readLeaseState(lockPath, key, normalized);
    if (state.invalid || !state.current) return { outcome: "invalid_state", reason: state.reason ?? "missing_lease" };
    if (state.current.generation !== generation) return state.current.generation > generation ? { outcome: "superseded", key, generation, currentGeneration: state.current.generation } : { outcome: "invalid_state", reason: "generation_mismatch" };
    if (state.current.publication) {
      const publication = state.current.publication;
      if (publication.publication_identity !== publicationIdentity || publication.publication_digest !== publicationDigest) return { outcome: "invalid_state", reason: "publication_mismatch" };
      return { outcome: "following", generation: state.current.generation, publication };
    }
    if (leaseExpired(state.current)) { const takeover = await acquireSidecarBuildLease({ lockPath, identity: normalized, identityDigest: key, leaseMs, maxTakeoverAttempts });
      if (takeover.outcome !== "following") return takeover; if (takeover.follow?.generation !== generation) return { outcome: "superseded", key, generation, currentGeneration: takeover.follow?.generation ?? null }; }
    if (attempt + 1 < attempts) await delay(poll);
  }
  return { outcome: "timeout", key };
}
export async function releaseSidecarBuildLease(lease) {
  if (!validLeaseHandle(lease)) return { outcome: "invalid_state", reason: "invalid_lease" };
  const before = await readLeaseState(lease.lockPath, lease.key, lease.identity);
  if (!ownsCurrent(before, lease)) return { outcome: "invalid_state", reason: "leadership_fenced" };
  if (before.current.release) return { outcome: "released" }; if (before.current.publication) return { outcome: "invalid_state", reason: "terminal_decided" };
  const record = auxiliaryRecord("release", lease, { released_at: Date.now() });
  const written = await writeLeaseRecord(before.current.paths.terminal, record);
  if (written.reason === "candidate_exhausted") return { outcome: "exhausted", key: lease.key };
  if (written.reason === "publication_failed") return { outcome: "invalid_state", reason: written.reason };
  const after = await readLeaseState(lease.lockPath, lease.key, lease.identity);
  return ownsCurrent(after, lease) && after.current.release ? { outcome: "released" } : { outcome: "invalid_state", reason: "leadership_fenced" };
}
