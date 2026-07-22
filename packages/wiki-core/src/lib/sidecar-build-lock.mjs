import { randomUUID } from "node:crypto";
import { link, lstat, open, readFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

export const SIDECAR_BUILD_LOCK_SUFFIX = ".build-lock.json";
export const SIDECAR_BUILD_LOCK_CANDIDATE_SLOT_COUNT = 8;
export const SIDECAR_BUILD_COALESCE_MAX_ATTEMPTS = 100;
export const SIDECAR_BUILD_COALESCE_POLL_MS = 50;

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
