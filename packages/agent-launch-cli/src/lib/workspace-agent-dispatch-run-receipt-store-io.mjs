import { createHash, randomBytes } from "node:crypto";
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  captureProcessIdentity,
  confirmedDead,
  defaultLivenessDeps
} from "./worktree-lease.mjs";

const LOCK_DIRECTORY = ".receipt-store.lock";
const LOCK_OWNER_FILE = "owner.json";
const SELECTOR_INDEX_ENTRY_BYTES = 130;
const SELECTOR_INDEX_LINE_RE = /^([0-9a-f]{64}) ([0-9a-f]{64})$/u;
const SELECTOR_FIELDS = Object.freeze(["review_run_id", "review_monitor_handle"]);

export const EXACT_REVIEW_RECEIPT_SELECTOR_CONFLICT_CODE =
  "exact_slice_review_receipt_selector_conflict";
export const EXACT_REVIEW_RECEIPT_SELECTOR_INDEX_UNUSABLE_CODE =
  "exact_slice_review_receipt_selector_index_unusable";

export class TypedRefusalError extends Error {
  constructor(message, code, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "TypedRefusalError";
    this.code = code;
  }
}

export function typedRefusal(message, code, cause) {
  return new TypedRefusalError(message, code, cause);
}

export async function inject(faultInjector, boundary) {
  if (typeof faultInjector === "function") await faultInjector(boundary);
}

export async function writeAtomicPublished(targetPath, contents, faultInjector, boundary) {
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await inject(faultInjector, `${boundary}_temp_created`);
    await handle.writeFile(contents, "utf8");
    await inject(faultInjector, `${boundary}_written`);
    await handle.sync();
    await inject(faultInjector, `${boundary}_file_synced`);
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, targetPath);
  await inject(faultInjector, `${boundary}_published`);
  const directoryHandle = await open(path.dirname(targetPath), "r");
  try {
    await directoryHandle.sync();
    await inject(faultInjector, `${boundary}_directory_synced`);
  } finally {
    await directoryHandle.close();
  }
}

export async function writeAtomicImmutable(targetPath, contents, faultInjector) {
  await writeAtomicPublished(targetPath, contents, faultInjector, "event");
}

export async function publishImmutableEvidenceOnce(
  targetPath,
  contents,
  faultInjector,
  boundary,
  linkFile = link
) {
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${randomBytes(6).toString("hex")}`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await inject(faultInjector, `${boundary}_temp_created`);
    await handle.writeFile(contents, "utf8");
    await inject(faultInjector, `${boundary}_written`);
    await handle.sync();
    await inject(faultInjector, `${boundary}_file_synced`);
  } finally {
    await handle.close();
  }
  let published = true;
  try {
    await linkFile(temporaryPath, targetPath);
  } catch (error) {
    if (error?.code !== "EEXIST") {
      await rm(temporaryPath, { force: true });
      throw new TypedRefusalError(
        "immutable evidence publication link failed",
        error?.code,
        error
      );
    }
    published = false;
  }
  await rm(temporaryPath, { force: true });
  await inject(faultInjector, `${boundary}_published`);
  const directoryHandle = await open(path.dirname(targetPath), "r");
  try {
    await directoryHandle.sync();
    await inject(faultInjector, `${boundary}_directory_synced`);
  } finally {
    await directoryHandle.close();
  }
  return published;
}

export async function syncDirectory(dir) {
  const directoryHandle = await open(dir, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

function captureOwnerIdentity(deps) {
  try {
    return captureProcessIdentity(process.pid, deps);
  } catch {

    return null;
  }
}

function ownerIdentityIsReclaimable(currentOwner, deps) {
  const identity = currentOwner?.identity ?? null;
  if (identity === null || typeof identity !== "object") {

    return false;
  }
  if (!Number.isInteger(identity.pid) || identity.pid <= 0 ||
      typeof identity.starttime !== "string" || typeof identity.boot_id !== "string") {
    return false;
  }
  try {

    return confirmedDead(identity, deps) === true;
  } catch {
    return false;
  }
}

export async function acquireStoreLock(dir, faultInjector, deps = defaultLivenessDeps) {
  const lockPath = path.join(dir, LOCK_DIRECTORY);
  const token = randomBytes(16).toString("hex");

  const owner = Object.freeze({ pid: process.pid, token, identity: captureOwnerIdentity(deps) });
  const candidatePath = path.join(dir, `${LOCK_DIRECTORY}.candidate-${process.pid}-${token}`);
  await mkdir(candidatePath, { mode: 0o700 });
  const ownerHandle = await open(path.join(candidatePath, LOCK_OWNER_FILE), "wx", 0o600);
  try {
    await ownerHandle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
    await ownerHandle.sync();
  } finally {
    await ownerHandle.close();
  }
  await syncDirectory(candidatePath);
  await syncDirectory(dir);
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      await rename(candidatePath, lockPath);
      await syncDirectory(dir);
      try {
        await inject(faultInjector, "lock_acquired");
      } catch (error) {
        const abandonedPath = path.join(dir, `${LOCK_DIRECTORY}.released-${token}`);
        await rename(lockPath, abandonedPath);
        await syncDirectory(dir);
        await rm(abandonedPath, { recursive: true });
        await syncDirectory(dir);
        throw error;
      }
      return async () => {
        const current = JSON.parse(await readFile(path.join(lockPath, LOCK_OWNER_FILE), "utf8"));
        if (current.token !== token) throw new Error("exact slice review receipt store lock ownership changed");
        const releasedPath = path.join(dir, `${LOCK_DIRECTORY}.released-${token}`);
        await rename(lockPath, releasedPath);
        await syncDirectory(dir);
        await rm(releasedPath, { recursive: true });
        await syncDirectory(dir);
      };
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "ENOTEMPTY") {
        await rm(candidatePath, { recursive: true, force: true });
        throw error;
      }
      let currentOwner;
      try {
        currentOwner = JSON.parse(await readFile(path.join(lockPath, LOCK_OWNER_FILE), "utf8"));
      } catch (readError) {
        if (readError?.code === "ENOENT") {
          await delay(10);
          continue;
        }
        await rm(candidatePath, { recursive: true, force: true });
        throw new Error("exact slice review receipt store lock is malformed", { cause: readError });
      }

      if (!currentOwner || !Number.isInteger(currentOwner.pid) || currentOwner.pid <= 0 ||
          typeof currentOwner.token !== "string" || !/^[0-9a-f]{32}$/u.test(currentOwner.token)) {
        await rm(candidatePath, { recursive: true, force: true });
        throw new Error("exact slice review receipt store lock is malformed");
      }
      if (ownerIdentityIsReclaimable(currentOwner, deps)) {

        const claimedMarker = path.join(dir, `${LOCK_DIRECTORY}.claimed-${currentOwner.token}`);
        const reapedPath = path.join(dir, `${LOCK_DIRECTORY}.reaped-${currentOwner.token}`);
        try {
          await rename(path.join(lockPath, LOCK_OWNER_FILE), claimedMarker);
          await rename(lockPath, reapedPath);
          await syncDirectory(dir);
          await rm(reapedPath, { recursive: true, force: true });
          await rm(claimedMarker, { force: true });
          await syncDirectory(dir);
        } catch (reapError) {
          if (reapError?.code !== "ENOENT" && reapError?.code !== "EEXIST" &&
              reapError?.code !== "ENOTEMPTY") {
            await rm(candidatePath, { recursive: true, force: true });
            throw reapError;
          }
        }
        await delay(10);
        continue;
      }
      await delay(10);
    }
  }
  await rm(candidatePath, { recursive: true, force: true });
  throw new Error("exact slice review receipt store lock acquisition timed out");
}

export const CLEANUP_SECONDARY_EVIDENCE_FIELD = "cleanup_failures";

function cleanupEvidence(step, order, error) {
  return Object.freeze({
    step,
    order,
    code: error?.code ?? null,
    message: error instanceof Error ? error.message : String(error),
    error
  });
}

function attachCleanupEvidence(primary, secondary) {
  if (secondary.length === 0) return primary;

  if (primary instanceof Error || (primary && typeof primary === "object")) {
    const existing = Array.isArray(primary[CLEANUP_SECONDARY_EVIDENCE_FIELD])
      ? primary[CLEANUP_SECONDARY_EVIDENCE_FIELD]
      : [];
    primary[CLEANUP_SECONDARY_EVIDENCE_FIELD] = Object.freeze([
      ...existing,
      ...secondary.map(({ step, error }, index) =>
        cleanupEvidence(step, existing.length + index, error))
    ]);
  }
  return primary;
}

export async function runWithCleanupPrecedence(body, cleanups) {
  let primary = null;
  let hasPrimary = false;
  let result;
  try {
    result = await body();
  } catch (error) {
    primary = error;
    hasPrimary = true;
  }

  const failures = [];
  for (const { step, cleanup } of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      failures.push({ step, error });
    }
  }

  if (hasPrimary) throw attachCleanupEvidence(primary, failures);
  if (failures.length > 0) {
    throw attachCleanupEvidence(failures[0].error, failures.slice(1));
  }
  return result;
}

export async function withStoreLock(dir, faultInjector, body, {
  deps = defaultLivenessDeps, cleanups = []
} = {}) {
  if (typeof body !== "function") {
    throw new Error("withStoreLock requires a bounded operation");
  }
  const release = await acquireStoreLock(dir, faultInjector, deps);
  return runWithCleanupPrecedence(body, [
    ...cleanups,
    { step: "receipt_store_lock_release", cleanup: release }
  ]);
}

export function unitPartitionDigest(unitAddress) {
  return createHash("sha256").update(`exact-slice-review-receipt-partition\0${unitAddress}`, "utf8").digest("hex");
}

function selectorDigest(field, value) {
  return createHash("sha256").update(`exact-slice-review-receipt-selector\0${field}\0${value}`, "utf8").digest("hex");
}

export function receiptSelectorDigests(receipt) {
  const selectors = SELECTOR_FIELDS.map((field) => selectorDigest(field, receipt[field]));
  if (receipt?.review_dispatch_identity && receipt?.attempt_lineage_identity) {
    selectors.push(selectorDigest(
      "review_dispatch_attempt",
      `${receipt.review_dispatch_identity.review_dispatch_id}\0${receipt.attempt_lineage_identity.attempt_id}`
    ));
  }
  return selectors;
}

export function recordSelectorEntry(entries, selector, identity) {
  const held = entries.get(selector) ?? null;
  if (held !== null && held !== identity) {
    throw typedRefusal("exact slice review receipt conflicts with an existing immutable selector binding", EXACT_REVIEW_RECEIPT_SELECTOR_CONFLICT_CODE);
  }
  entries.set(selector, identity);
}

export function selectorIndexLine(selector, identity) {
  return `${selector} ${identity}\n`;
}

export function serializeSelectorIndex(entries) {
  return [...entries.keys()].sort().map((selector) => selectorIndexLine(selector, entries.get(selector))).join("");
}

export function parseSelectorIndex(raw) {
  if (raw.length % SELECTOR_INDEX_ENTRY_BYTES !== 0) {
    throw typedRefusal("exact slice review receipt selector index is truncated", EXACT_REVIEW_RECEIPT_SELECTOR_INDEX_UNUSABLE_CODE);
  }
  const entries = new Map();
  for (let offset = 0; offset < raw.length; offset += SELECTOR_INDEX_ENTRY_BYTES) {
    const entry = raw.subarray(offset, offset + SELECTOR_INDEX_ENTRY_BYTES).toString("utf8");
    const match = entry.endsWith("\n") ? SELECTOR_INDEX_LINE_RE.exec(entry.slice(0, -1)) : null;
    if (match === null) {
      throw typedRefusal(`exact slice review receipt selector index entry is malformed at byte ${offset}`, EXACT_REVIEW_RECEIPT_SELECTOR_INDEX_UNUSABLE_CODE);
    }
    recordSelectorEntry(entries, match[1], match[2]);
  }
  return entries;
}
