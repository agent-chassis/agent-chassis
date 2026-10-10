import { CREATE_RECORD_ROUTE, creationMaintenanceSubject, saveMaintenanceSubject } from "./record-authoring-maintenance-subject.mjs";

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { createSyncEffects, planReplacement, runCrashDurablePlanSync } from
  "@agent-chassis/wiki-core/src/lib/crash-durable-state.mjs";
import { withSidecarUpdaterLock } from "@agent-chassis/wiki-core/src/lib/sidecar-store-lifecycle.mjs";

import { describeRetentionFailure, getResponseSpillConfig, jsonContent } from "./mcp-response.mjs";
import { readSelectedResponseSource, retainSelectedResponseSource, selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";
import { runRepositoryChecks } from "./work-record-closeout-response.mjs";

export const SAVE_RECORD_ROUTE = "workspace_save_record";
export const SAVE_RECORD_MAINTENANCE_ATTEMPTS_SCHEMA_VERSION = "save-record-maintenance-attempts.v2";
export const SAVE_RECORD_MAINTENANCE_LOCK_TIMEOUT_MS = 1000;
const CHECK_MEMBER = "generate_and_lint";
const APPLICABLE_MEMBERS = Object.freeze([CHECK_MEMBER]);
const OWNER_DIRECTORY = "save-record-maintenance";

const memberOf = ({ checked_corpus: _corpus, ...check }) => ({ member: CHECK_MEMBER,
  state: check.ran !== true ? "not_run" : check.ok === true ? "succeeded" : "failed", check });
const pendingOf = (members) => members.filter((entry) => entry.state === "failed" || entry.state === "not_run")
  .map((entry) => entry.member);

class MaintenanceStateError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}

export function createSaveRecordMaintenance({ workspace, responseEnv = process.env, generateAndLint,
  authorityIdentity, lockTimeoutMs = SAVE_RECORD_MAINTENANCE_LOCK_TIMEOUT_MS, effects = createSyncEffects() }) {
  const ownerDir = path.join(getResponseSpillConfig(responseEnv).stateDir, OWNER_DIRECTORY);
  const lockPath = path.join(ownerDir, "coordination.sqlite");
  const inFlight = new Map();

  const responseOwner = (envelope, options) => jsonContent(envelope, { env: responseEnv, ...options,
    selectedAccess: () => ({ operator_only: true }) });
  const authority = (unit, route) => ({ ...authorityIdentity(unit), route });
  const retain = ({ unit, carrier, queryIdentity, observationIdentity, route = SAVE_RECORD_ROUTE }) => retainSelectedResponseSource({
    binding: { route, repository: workspace.repo, unit, query_identity: queryIdentity,
      observation_identity: observationIdentity, authority_identity: authority(unit, route) }, carrier }, { responseOwner });
  const indexPath = (source) => path.join(ownerDir, `${createHash("sha256")
    .update(JSON.stringify([workspace.repo, source.ref_id]), "utf8").digest("hex")}.json`);

  function readIndex(source, original) {
    const file = indexPath(source);
    if (!existsSync(file)) return { schema_version: SAVE_RECORD_MAINTENANCE_ATTEMPTS_SCHEMA_VERSION,
      original: { ...source, unit: original.unit, ...(original.revision === undefined ? {} : { revision: original.revision }),
        producer: original.producer }, attempts: [] };
    let index;
    try { index = JSON.parse(readFileSync(file, "utf8")); } catch { index = null; }

    if (index?.schema_version !== SAVE_RECORD_MAINTENANCE_ATTEMPTS_SCHEMA_VERSION || !Array.isArray(index.attempts) ||
        index.original?.ref_id !== source.ref_id) {
      throw new MaintenanceStateError("save_record_maintenance_state_corrupt",
        "the maintenance attempt index for this save result is unreadable; it was left as found",
        { actor: "operator", action: "inspect the maintenance attempt index before retrying" });
    }
    return index;
  }
  function writeIndex(source, index) {
    mkdirSync(ownerDir, { recursive: true });
    const targetPath = indexPath(source);
    const run = runCrashDurablePlanSync(planReplacement({ targetPath,
      privatePath: `${targetPath}.${process.pid}.${Date.now()}.private`,
      bytes: `${JSON.stringify(index, null, 2)}\n` }), effects);
    if (run.failed_fault !== null) throw new MaintenanceStateError("save_record_maintenance_state_unwritable",
      "the maintenance attempt index could not be durably published", { failed_fault: run.failed_fault });
  }

  const corpusRecord = (original) => original.kind === "work_item" ? original.unit.split("#")[0] : null;

  function checkedSource(original, check) {
    const corpus = check.checked_corpus ?? null;
    const record = corpusRecord(original);
    const captured = corpus !== null && record !== null ? corpus.records?.[record] ?? null : null;
    return { unit: original.unit, saved_revision: original.revision ?? null,
      ...(original.producer === "create" ? { created_source: original.source, created_read_identity: original.read_identity,
        ...(captured === null ? { checked_source_unavailable: { code: record === null
          ? "creation_checked_page_identity_unavailable" : "creation_checked_record_identity_unavailable" } } : {}) } : {}),
      saved_record_source_digest: original.record_source_digest ?? null,
      checked_corpus: corpus === null ? null : { schema_version: corpus.schema_version,
        digest: corpus.digest, work_record_count: corpus.work_record_count },
      checked_record_source_digest: captured,
      moved_since_save: captured === null || original.record_source_digest == null ? null
        : captured !== original.record_source_digest };
  }

  async function runAttempt({ source, original, observedAttempt }) {
    const index = readIndex(source, original);
    const last = index.attempts.at(-1) ?? null;

    if (last !== null && last.state === "settled" && (last.ordinal > (observedAttempt?.ordinal ?? 0) ||
        (last.ordinal === observedAttempt?.ordinal && observedAttempt.state === "running"))) {
      return { outcome: "joined_attempt", attempt: last, attempts: index.attempts };
    }
    if (last?.state === "settled" && last.pending.length === 0) {
      return { outcome: "no_retry_needed", attempt: last, attempts: index.attempts };
    }

    if (last?.state === "running") last.state = "outcome_unknown";
    const settledBefore = index.attempts.findLast((entry) => entry.state === "settled") ?? null;
    const pending = settledBefore === null ? [...APPLICABLE_MEMBERS] : settledBefore.pending;
    const attempt = { ordinal: (last?.ordinal ?? 0) + 1, state: "running", members: pending, pending, outcome: null };
    index.attempts.push(attempt);
    writeIndex(source, index);

    const record = corpusRecord(original);
    const check = await runRepositoryChecks({ workspaceDir: workspace.dir, generateAndLint,
      identifyRecords: record === null ? [] : [record] });
    const members = [memberOf(check)];
    const result = { operation: attempt.ordinal === 1 ? original.producer === "create" ? "creation_maintenance" : "save_maintenance" : "maintenance_retry",
      unit: original.unit, original_save: source, attempt: attempt.ordinal, members,
      checked_source: checkedSource(original, check),
      effects: { canonical_mutation_repeated: false, checks_ran: check.ran === true } };
    attempt.pending = pendingOf(members);
    try {
      attempt.outcome = retain({ unit: original.unit, carrier: result,
        queryIdentity: { operation: "maintenance_attempt", unit: original.unit, attempt: attempt.ordinal },
        observationIdentity: { original: source } });
    } catch (error) {
      attempt.retention_failure = describeRetentionFailure(error, { operation: "retain_save_record_maintenance_attempt",
        subject: { unit: original.unit, attempt: attempt.ordinal } });
    }
    attempt.state = "settled";
    writeIndex(source, index);
    return { outcome: attempt.pending.length === 0 ? "maintenance_succeeded" : "maintenance_failed",
      attempt, attempts: index.attempts, result };
  }

  async function attemptFor({ source, original }) {
    const key = indexPath(source);
    if (inFlight.has(key)) return { ...(await inFlight.get(key)), joined: true };
    mkdirSync(ownerDir, { recursive: true });
    const observedAttempt = readIndex(source, original).attempts.at(-1) ?? null;
    const running = withSidecarUpdaterLock(lockPath, () => runAttempt({ source, original, observedAttempt }),
      { timeoutMs: lockTimeoutMs }).catch((error) => {
      if (error?.code !== "contention") throw error;
      return { outcome: "maintenance_attempt_in_progress", attempt: null,
        attempts: readIndex(source, original).attempts,
        retry: { unit: original.unit, maintenance_retry: { save_result: source } } };
    });
    inFlight.set(key, running);
    try { return await running; } finally { inFlight.delete(key); }
  }

  async function settleInitial(saved, creationSubject = null) {
    const creation = creationSubject !== null;
    const published = creation ? saved.outcome === "created" && saved.effects?.published === true : saved.outcome === "saved";
    if (!published) {
      return { complete: { ...saved, maintenance: { applicable: false, members: [] } },
        original: { available: false, locator: null, reason: "nothing_published" } };
    }
    const subject = creation ? creationSubject : saveMaintenanceSubject(saved);
    const original = { ...subject, ...(creation && saved.revision !== undefined ? { revision: saved.revision } : {}),
      producer: creation ? "create" : "save" };
    const route = creation ? CREATE_RECORD_ROUTE : SAVE_RECORD_ROUTE;
    let source;
    try {
      source = retain({ unit: subject.unit, carrier: saved, route,
        queryIdentity: creation ? { operation: "create", unit: subject.unit, subject }
          : { operation: "save", unit: subject.unit },
        observationIdentity: creation ? { source: subject.source, read_identity: subject.read_identity }
          : { revision: saved.revision, prior_revision: saved.prior_revision } });
    } catch (error) {

      const record = corpusRecord(original);
      const check = await runRepositoryChecks({ workspaceDir: workspace.dir, generateAndLint,
        identifyRecords: record === null ? [] : [record] });
      return { complete: { ...saved, maintenance: { applicable: true, attempt: null, members: [memberOf(check)],
        checked_source: checkedSource(original, check) } },
      original: { available: false, locator: null, reason: creation ? "creation_receipt_unavailable" : "save_receipt_unavailable",
        retention_failure: describeRetentionFailure(error, { operation: creation ? "retain_create_record_result" : "retain_save_record_result",
          subject: { unit: subject.unit, ...(saved.revision === undefined ? {} : { revision: saved.revision }) } }) } };
    }
    let settled;
    try {
      settled = await attemptFor({ source, original });
    } catch (error) {

      return { complete: { ...saved, maintenance: { applicable: true, attempt: null,
        state: "maintenance_attempt_outcome_unknown",
        cause: { code: error?.code ?? null, message: error?.message ?? null },
        members: APPLICABLE_MEMBERS.map((member) => ({ member, state: "not_run" })) } },
      original: { available: true, locator: source } };
    }
    const maintenance = settled.result === undefined
      ? { applicable: true, attempt: null, state: settled.outcome,
        members: APPLICABLE_MEMBERS.map((member) => ({ member, state: "not_run" })) }
      : { applicable: true, attempt: settled.attempt.ordinal, members: settled.result.members,
        checked_source: settled.result.checked_source,
        ...(settled.attempt.outcome === null ? { outcome_retention_failure: settled.attempt.retention_failure }
          : { outcome: settled.attempt.outcome }) };
    return { complete: { ...saved, maintenance }, original: { available: true, locator: source } };
  }

  async function retry({ unit, saveResult: source }) {
    const { binding, carrier } = authenticated(source, unit, true);
    const original = binding.route === CREATE_RECORD_ROUTE
      ? { ...binding.query_identity.subject, ...(carrier.revision === undefined ? {} : { revision: carrier.revision }), producer: "create" }
      : { ...saveMaintenanceSubject(carrier), producer: "save" };
    const settled = await attemptFor({ source, original });
    return { ...settled, unit, original_save: source,
      original: { ...(original.producer === "create" ? { producer: "create", source: original.source,
        read_identity: original.read_identity } : { revision: carrier.revision, prior_revision: carrier.prior_revision }),
        effects: carrier.effects },
      effects: { canonical_mutation_repeated: false, checks_ran: settled.result?.effects.checks_ran ?? false } };
  }

  function retainObservation(carrier) {
    try {
      const source = retain({ unit: carrier.unit, carrier,
        queryIdentity: { operation: "save_observation", unit: carrier.unit },
        observationIdentity: { original: carrier.original?.locator ?? carrier.original_save ?? null,
          attempt: carrier.maintenance?.attempt ?? carrier.attempt?.ordinal ?? null } });
      return { available: true, locator: source };
    } catch (error) {
      return { available: false, locator: null, retention_failure: describeRetentionFailure(error,
        { operation: "retain_save_observation", subject: { unit: carrier.unit } }) };
    }
  }

  function authenticated(source, requestedUnit = null, originalOnly = false) {
    const retained = readSelectedResponseSource(source, { env: responseEnv, route: SAVE_RECORD_ROUTE,
      expected: { repository: workspace.repo } });
    const { binding, carrier } = retained;
    const operation = binding.query_identity?.operation;
    const creation = binding.route === CREATE_RECORD_ROUTE && operation === "create";
    const save = binding.route === SAVE_RECORD_ROUTE && operation === "save";
    const observation = binding.route === SAVE_RECORD_ROUTE &&
      ["save_observation", "maintenance_attempt"].includes(operation);
    if ((!creation && !save && !(observation && !originalOnly)) ||
        (requestedUnit !== null && binding.unit !== requestedUnit) ||
        binding.query_identity.unit !== binding.unit) throw selectedResponseQueryInvalidError(SAVE_RECORD_ROUTE,
      "source_binding_mismatch", { binding_field: "query_identity" });
    const verified = readSelectedResponseSource(source, { env: responseEnv, route: SAVE_RECORD_ROUTE,
      expected: { route: binding.route, repository: workspace.repo, unit: binding.unit,
        authority_identity: authority(binding.unit, binding.route), query_identity: binding.query_identity } });
    if (creation) {
      const subject = binding.query_identity.subject;
      const checked = creationMaintenanceSubject({ unit: subject?.unit, kind: subject?.kind,
        source: subject?.source, readIdentity: subject?.read_identity, recordSourceDigest: subject?.record_source_digest });
      if (checked.unit !== binding.unit || carrier.outcome !== "created" || carrier.effects?.published !== true ||
          (carrier.unit !== undefined && carrier.unit !== binding.unit) ||
          (carrier.kind !== undefined && carrier.kind !== subject.kind) ||
          (subject.read_identity?.repository !== undefined && subject.read_identity.repository !== workspace.repo)) throw selectedResponseQueryInvalidError(
        SAVE_RECORD_ROUTE, "source_binding_mismatch", { binding_field: "subject" });
    } else if (carrier.unit !== binding.unit) throw selectedResponseQueryInvalidError(SAVE_RECORD_ROUTE,
      "source_binding_mismatch", { binding_field: "unit" });
    return verified;
  }
  function readOriginal(source) { return authenticated(source); }

  async function settleCreation(created, subject) {
    if (created.outcome !== "created" || created.effects?.published !== true) return {
      complete: { ...created, maintenance: created.effects?.published === true
        ? { applicable: true, members: APPLICABLE_MEMBERS.map(member => ({ member, state: "not_run" })) }
        : { applicable: false, members: [] } },
      original: { available: false, locator: null, reason: created.effects?.published === true
        ? "creation_receipt_unavailable" : "publication_not_established" } };
    const projected = creationMaintenanceSubject(subject);
    if (["source", "area"].includes(projected.kind) && Object.hasOwn(created, "revision")) {
      throw new TypeError("Source and area creation do not supply a save revision");
    }
    if ((created.unit !== undefined && created.unit !== projected.unit) ||
        (created.kind !== undefined && created.kind !== projected.kind) ||
        (projected.read_identity.repository !== undefined && projected.read_identity.repository !== workspace.repo)) {
      throw new TypeError("Creation producer result and subject are mismatched");
    }
    return settleInitial(created, projected);
  }

  const receiptUnavailable = () => ({
    original: { available: false, locator: null, reason: "save_receipt_unavailable" },
    maintenance: { applicable: true, members: APPLICABLE_MEMBERS.map((member) => ({ member, state: "not_run" })) }
  });
  return Object.freeze({ settleInitial, settleCreation, retry, retainObservation, readOriginal, receiptUnavailable });
}
